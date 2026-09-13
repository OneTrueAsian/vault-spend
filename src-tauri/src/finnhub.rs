//! A thin, optional client for Finnhub's `/quote` endpoint — the second
//! live-price provider alongside Alpha Vantage (`live_prices.rs`); only
//! one is ever active at a time (see `live_price_provider.rs`). Mirrors
//! `live_prices.rs`'s shape exactly: a pure, network-free parser fully
//! unit tested against Finnhub's exact response shapes, plus a thin
//! untested `fetch_quote` HTTP wrapper — same accepted gap that module's
//! own doc comment explains.
use rust_decimal::Decimal;
use serde_json::Value;
use std::str::FromStr;

const BASE_URL: &str = "https://finnhub.io/api/v1/quote";

/// Fetches the current price for `symbol` using `api_key`. `Ok(None)`
/// means Finnhub recognized the request but has no data for that symbol
/// (every price field comes back zeroed out) — not an error, same
/// "nothing to update" contract as `live_prices::fetch_quote`.
pub async fn fetch_quote(client: &reqwest::Client, api_key: &str, symbol: &str) -> Result<Option<Decimal>, String> {
    let response = client
        .get(BASE_URL)
        .query(&[("symbol", symbol), ("token", api_key)])
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
/// network-free on purpose, same reasoning as
/// `live_prices::parse_global_quote_response`.
///
/// **The quirk this exists to handle**: unlike Alpha Vantage, Finnhub
/// signals an invalid key (401) and a rate limit (429) as real HTTP
/// status codes rather than HTTP-200-with-a-JSON-key, so `status` is
/// checked before the body is treated as a quote at all. A recognized
/// success response with every price field zeroed out (`c: 0`, etc.) is
/// Finnhub's "no data for this symbol" shape — mapped to `Ok(None)`, the
/// same as Alpha Vantage's empty `Global Quote` object. Some unsupported
/// symbols instead return HTTP 200 with an `{"error": "..."}` body —
/// surfaced as a real error, the same as Alpha Vantage's `"Error Message"`.
pub fn parse_quote_response(status: u16, body: &str) -> Result<Option<Decimal>, String> {
    if status == 401 {
        return Err(format!("Finnhub rejected the API key: {body}"));
    }
    if status == 429 {
        return Err(format!("Finnhub's rate limit was hit: {body}"));
    }
    if status != 200 {
        return Err(format!("unexpected response from Finnhub (HTTP {status}): {body}"));
    }

    let value: Value = serde_json::from_str(body).map_err(|e| format!("unexpected response from Finnhub: {e}"))?;

    if let Some(err) = value.get("error").and_then(Value::as_str) {
        return Err(err.to_string());
    }

    let price_value = value.get("c").ok_or_else(|| "Finnhub's response was missing a price field".to_string())?;
    let price_f64 = price_value
        .as_f64()
        .ok_or_else(|| "Finnhub's response had a non-numeric price field".to_string())?;
    if price_f64 == 0.0 {
        return Ok(None); // recognized shape, but no data — unknown/unsupported symbol
    }
    Decimal::from_str(&price_value.to_string())
        .map(Some)
        .map_err(|_| format!("Finnhub returned an unparseable price: {price_value}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_quote_response_returns_price_from_a_successful_response() {
        let body = r#"{"c": 261.74, "d": 3.75, "dp": 1.45, "h": 264.89, "l": 260.36, "o": 261.07, "pc": 257.99, "t": 1582641000}"#;

        let price = parse_quote_response(200, body).unwrap();

        assert_eq!(price, Some("261.74".parse().unwrap()));
    }

    #[test]
    fn parse_quote_response_returns_none_for_an_all_zero_quote() {
        let body = r#"{"c": 0, "d": 0, "dp": 0, "h": 0, "l": 0, "o": 0, "pc": 0, "t": 0}"#;

        let price = parse_quote_response(200, body).unwrap();

        assert_eq!(price, None);
    }

    #[test]
    fn parse_quote_response_returns_an_error_for_an_error_body() {
        let body = r#"{"error": "Symbol not supported."}"#;

        let result = parse_quote_response(200, body);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Symbol not supported"));
    }

    #[test]
    fn parse_quote_response_error_matrix() {
        struct Case {
            label: &'static str,
            status: u16,
            body: &'static str,
            expected_substring: Option<&'static str>,
        }
        let cases = [
            Case {
                label: "invalid api key status",
                status: 401,
                body: r#"{"error":"API key not valid"}"#,
                expected_substring: Some("API key"),
            },
            Case {
                label: "rate limit status",
                status: 429,
                body: "",
                expected_substring: Some("rate limit"),
            },
            Case {
                label: "malformed json",
                status: 200,
                body: "not json at all",
                expected_substring: None,
            },
            Case {
                label: "unexpected status",
                status: 500,
                body: "internal server error",
                expected_substring: None,
            },
        ];

        for case in cases {
            let result = parse_quote_response(case.status, case.body);
            assert!(result.is_err(), "case: {}", case.label);
            if let Some(substring) = case.expected_substring {
                assert!(result.unwrap_err().contains(substring), "case: {}", case.label);
            }
        }
    }
}
