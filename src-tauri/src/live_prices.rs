//! A thin, optional client for Alpha Vantage's `GLOBAL_QUOTE` endpoint —
//! this app's only network dependency, used solely to look up a stock's
//! current price when the user has opted in (see `get_live_price_settings`
//! in commands.rs). Kept separate from `core/` since this is an external-
//! integration concern, not budgeting domain logic — the same reasoning
//! that keeps `backups.rs`/`config.rs`/`profiles.rs` out of `core/` too.
use rust_decimal::Decimal;
use serde_json::Value;
use std::str::FromStr;

const BASE_URL: &str = "https://www.alphavantage.co/query";

/// Alpha Vantage's free-tier cap, confirmed from their own pricing page —
/// commands.rs checks this against `Store::live_price_requests_used_today`
/// before every request so this app stops pulling data on its own once the
/// budget is spent, rather than waiting to be told no by the API.
pub const ALPHA_VANTAGE_DAILY_LIMIT: i64 = 25;

/// Fetches the current price for `symbol` using `api_key`. `Ok(None)` means
/// Alpha Vantage recognized the request but has no data for that symbol
/// (almost always an invalid/unknown ticker) — that is *not* an error, and
/// callers should treat it as "nothing to update," not "retry."
pub async fn fetch_quote(client: &reqwest::Client, api_key: &str, symbol: &str) -> Result<Option<Decimal>, String> {
    let response = client
        .get(BASE_URL)
        .query(&[("function", "GLOBAL_QUOTE"), ("symbol", symbol), ("apikey", api_key)])
        .send()
        .await
        .map_err(|e| format!("network error fetching a quote for {symbol}: {e}"))?;
    let body = response
        .text()
        .await
        .map_err(|e| format!("failed to read the response for {symbol}: {e}"))?;
    parse_global_quote_response(&body)
}

/// Parses a `GLOBAL_QUOTE` response body. Pure and network-free on purpose
/// so the tricky part — Alpha Vantage's response shapes — is fully unit
/// tested without hitting the network (`fetch_quote`'s own HTTP round trip
/// is the one part of this module that isn't, the same kind of gap this
/// project already accepts for `relocate_data_file`'s native folder picker).
///
/// **The quirk this exists to handle**: rate-limit and invalid-key
/// responses come back as HTTP 200 with a JSON body carrying a `"Note"`,
/// `"Information"`, or `"Error Message"` key instead of `"Global Quote"` —
/// there's no HTTP-level error to catch. Treating those as a plain miss
/// (falling straight through to `Ok(None)`) would make a rate limit or a
/// typo'd API key look identical to "this symbol doesn't exist," so they're
/// checked first and surfaced as distinct, readable errors.
pub fn parse_global_quote_response(body: &str) -> Result<Option<Decimal>, String> {
    let value: Value = serde_json::from_str(body).map_err(|e| format!("unexpected response from Alpha Vantage: {e}"))?;

    if let Some(note) = value.get("Note").and_then(Value::as_str) {
        return Err(note.to_string());
    }
    if let Some(info) = value.get("Information").and_then(Value::as_str) {
        return Err(info.to_string());
    }
    if let Some(err) = value.get("Error Message").and_then(Value::as_str) {
        return Err(err.to_string());
    }

    let quote = match value.get("Global Quote").and_then(Value::as_object) {
        Some(obj) if !obj.is_empty() => obj,
        _ => return Ok(None), // recognized shape, but no data — unknown/invalid symbol
    };

    let price = quote
        .get("05. price")
        .and_then(Value::as_str)
        .ok_or_else(|| "Alpha Vantage's response was missing a price field".to_string())?;
    Decimal::from_str(price)
        .map(Some)
        .map_err(|_| format!("Alpha Vantage returned an unparseable price: {price}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_global_quote_response_returns_price_from_a_successful_response() {
        let body = r#"{
            "Global Quote": {
                "01. symbol": "GOOGL",
                "02. open": "174.0000",
                "03. high": "176.5000",
                "04. low": "173.8000",
                "05. price": "175.5000",
                "06. volume": "12345678",
                "07. latest trading day": "2026-08-28",
                "08. previous close": "174.2000",
                "09. change": "1.3000",
                "10. change percent": "0.7462%"
            }
        }"#;

        let price = parse_global_quote_response(body).unwrap();

        assert_eq!(price, Some("175.5000".parse().unwrap()));
    }

    #[test]
    fn parse_global_quote_response_returns_none_for_an_empty_quote_object() {
        let body = r#"{ "Global Quote": {} }"#;

        let price = parse_global_quote_response(body).unwrap();

        assert_eq!(price, None);
    }

    #[test]
    fn parse_global_quote_response_error_matrix() {
        struct Case {
            label: &'static str,
            body: &'static str,
            expected_substring: Option<&'static str>,
        }
        let cases = [
            Case {
                label: "rate limit Note field",
                body: r#"{ "Note": "Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day." }"#,
                expected_substring: Some("25 requests per day"),
            },
            Case {
                label: "rate limit Information field",
                body: r#"{ "Information": "Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day." }"#,
                expected_substring: Some("25 requests per day"),
            },
            Case {
                label: "invalid api key Error Message field",
                body: r#"{ "Error Message": "the parameter apikey is invalid" }"#,
                expected_substring: Some("apikey is invalid"),
            },
            Case {
                label: "malformed json",
                body: "not json at all",
                expected_substring: None,
            },
        ];

        for case in cases {
            let result = parse_global_quote_response(case.body);
            assert!(result.is_err(), "case: {}", case.label);
            if let Some(substring) = case.expected_substring {
                assert!(result.unwrap_err().contains(substring), "case: {}", case.label);
            }
        }
    }
}
