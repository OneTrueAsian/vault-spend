//! A thin, optional client for Twelve Data's `/quote` endpoint — the
//! third live-price provider alongside Alpha Vantage (`live_prices.rs`)
//! and Finnhub (`finnhub.rs`); only one is ever active at a time (see
//! `live_price_provider.rs`). Mirrors the other two modules' shape
//! exactly: a pure, network-free parser fully unit tested against Twelve
//! Data's exact response shapes, plus a thin untested `fetch_quote` HTTP
//! wrapper — same accepted gap those modules' own doc comments explain.
use rust_decimal::Decimal;
use serde_json::Value;
use std::str::FromStr;

const BASE_URL: &str = "https://api.twelvedata.com/quote";

/// Twelve Data's free-tier daily cap — the one number their own pricing
/// page and support docs actually agree on (800 credits/day, reset at
/// midnight UTC; one `/quote` call for one symbol costs one credit). Their
/// docs are inconsistent about whether there's *also* a separate 8-
/// requests/minute throttle on top of that, so — deliberately — that
/// figure isn't modeled here as a proactive check: if it's real and ever
/// actually hit, it surfaces as a normal per-symbol 429 in the existing
/// `failed` list (see commands.rs), the same as any other transient
/// provider error already handled, rather than this app enforcing an
/// unconfirmed limit against itself.
pub const TWELVE_DATA_DAILY_LIMIT: i64 = 800;

/// Fetches the current price for `symbol` using `api_key`. `Ok(None)`
/// means Twelve Data has no data for that symbol (a 404) — not an error,
/// same "nothing to update" contract as the other two providers'
/// `fetch_quote`.
pub async fn fetch_quote(client: &reqwest::Client, api_key: &str, symbol: &str) -> Result<Option<Decimal>, String> {
    let response = client
        .get(BASE_URL)
        .query(&[("symbol", symbol), ("apikey", api_key)])
        .send()
        .await
        .map_err(|e| format!("network error fetching a quote for {symbol}: {e}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| format!("failed to read the response for {symbol}: {e}"))?;
    parse_quote_response(status, &body)
}

/// Parses a `/quote` response body given its HTTP status. Pure and
/// network-free on purpose, same reasoning as the other two providers'
/// parsers.
///
/// **The quirk this exists to handle**: unlike Alpha Vantage and Finnhub,
/// Twelve Data ties its HTTP status code directly to a `{"code", "message",
/// "status"}` error body on every failure (their own docs: "a standardized
/// error response format"), so a non-200 status is always treated as a
/// real error using that message. An unknown/unsupported symbol comes back
/// as a 404 specifically — mapped to `Ok(None)`, the same "no data" outcome
/// as Alpha Vantage's empty `Global Quote` and Finnhub's all-zero quote,
/// not a hard error, since a typo'd symbol shouldn't look identical to a
/// bad key or a spent quota to the caller.
///
/// 403 (distinct from 401's "your key itself is bad") means the key is
/// valid but this specific symbol isn't included in the current plan —
/// same idea as Finnhub's identical quirk (see that module's parser for
/// the real report this pattern was first found from), so it gets the
/// same plain-English treatment instead of echoing Twelve Data's raw JSON
/// error body into the UI.
pub fn parse_quote_response(status: u16, body: &str) -> Result<Option<Decimal>, String> {
    if status == 404 {
        return Ok(None); // recognized "not found" — unknown/unsupported symbol
    }
    if status == 401 {
        return Err(format!("Twelve Data rejected the API key: {body}"));
    }
    if status == 403 {
        return Err("Twelve Data's plan doesn't include this symbol".to_string());
    }
    if status == 429 {
        return Err(format!("Twelve Data's rate limit was hit: {body}"));
    }
    if status != 200 {
        return Err(format!("unexpected response from Twelve Data (HTTP {status}): {body}"));
    }

    let value: Value = serde_json::from_str(body).map_err(|e| format!("unexpected response from Twelve Data: {e}"))?;

    let price = value
        .get("price")
        .and_then(Value::as_str)
        .ok_or_else(|| "Twelve Data's response was missing a price field".to_string())?;
    Decimal::from_str(price)
        .map(Some)
        .map_err(|_| format!("Twelve Data returned an unparseable price: {price}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_quote_response_returns_price_from_a_successful_response() {
        let body = r#"{
            "symbol": "AAPL",
            "name": "Apple Inc",
            "exchange": "NASDAQ",
            "price": "148.85001",
            "change": "-0.23999",
            "percent_change": "-0.16097",
            "is_market_open": false
        }"#;

        let price = parse_quote_response(200, body).unwrap();

        assert_eq!(price, Some("148.85001".parse().unwrap()));
    }

    #[test]
    fn parse_quote_response_returns_none_for_a_not_found_symbol() {
        let body = r#"{"code": 404, "message": "Requested data could not be found.", "status": "error"}"#;

        let price = parse_quote_response(404, body).unwrap();

        assert_eq!(price, None);
    }

    #[test]
    fn parse_quote_response_error_matrix() {
        struct Case {
            label: &'static str,
            status: u16,
            body: &'static str,
            expected_substring: Option<&'static str>,
            case_insensitive: bool,
        }
        let cases = [
            Case {
                label: "invalid api key status",
                status: 401,
                body: r#"{"code": 401, "message": "Invalid apikey.", "status": "error"}"#,
                expected_substring: Some("apikey"),
                case_insensitive: true,
            },
            Case {
                label: "plan-restricted symbol status",
                status: 403,
                body: r#"{"code": 403, "message": "You do not have permission to access this endpoint.", "status": "error"}"#,
                expected_substring: Some("plan"),
                case_insensitive: false,
            },
            Case {
                label: "rate limit status",
                status: 429,
                body: r#"{"code": 429, "message": "API rate limit reached.", "status": "error"}"#,
                expected_substring: Some("rate limit"),
                case_insensitive: false,
            },
            Case {
                label: "malformed json",
                status: 200,
                body: "not json at all",
                expected_substring: None,
                case_insensitive: false,
            },
            Case {
                label: "unexpected status",
                status: 500,
                body: r#"{"code": 500, "message": "internal error", "status": "error"}"#,
                expected_substring: None,
                case_insensitive: false,
            },
        ];

        for case in cases {
            let result = parse_quote_response(case.status, case.body);
            assert!(result.is_err(), "case: {}", case.label);
            if let Some(substring) = case.expected_substring {
                let err = result.unwrap_err();
                let err = if case.case_insensitive { err.to_lowercase() } else { err };
                assert!(err.contains(substring), "case: {}", case.label);
            }
        }
    }

    #[test]
    fn parse_quote_response_returns_an_error_when_a_200_response_is_missing_a_price_field() {
        let result = parse_quote_response(200, r#"{"symbol": "AAPL"}"#);

        assert!(result.is_err());
    }

    /// Same regression this module's Finnhub counterpart guards against: a
    /// plan-restricted 403 must never echo the raw JSON error body into the
    /// app's UI.
    #[test]
    fn parse_quote_response_403_never_leaks_the_raw_json_body() {
        let result = parse_quote_response(
            403,
            r#"{"code": 403, "message": "You do not have permission to access this endpoint.", "status": "error"}"#,
        );

        let message = result.unwrap_err();
        assert!(!message.contains('{'), "expected no raw JSON in the message, got: {message}");
        assert!(!message.contains("403"), "expected no raw HTTP status in the message, got: {message}");
    }
}
