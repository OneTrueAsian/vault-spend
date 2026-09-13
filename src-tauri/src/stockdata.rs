//! A thin, optional client for StockData.org's `/v1/data/quote` endpoint —
//! the fourth live-price provider alongside Alpha Vantage
//! (`live_prices.rs`), Finnhub (`finnhub.rs`), and Twelve Data
//! (`twelve_data.rs`); only one is ever active at a time (see
//! `live_price_provider.rs`). Mirrors the other three modules' shape —
//! pure, network-free parser fully unit tested, thin untested HTTP
//! wrapper — with one structural difference: StockData.org's endpoint
//! accepts several comma-separated symbols in one request (its free tier
//! caps that at `MAX_SYMBOLS_PER_REQUEST`), so this module exposes both a
//! single-symbol `fetch_quote` (used by `fetch_live_quote`'s New Holding
//! autofill, which is inherently one-symbol-at-a-time) and a
//! `fetch_quotes_batch` that the dispatch-level
//! `live_price_provider::fetch_quotes` chunks calls to.
use rust_decimal::Decimal;
use serde_json::Value;
use std::collections::HashMap;
use std::str::FromStr;

const BASE_URL: &str = "https://api.stockdata.org/v1/data/quote";

/// StockData.org's free-tier daily cap (their pricing page, confirmed
/// live) — 100 requests/day. This is a *request* cap, not a per-symbol
/// one: each request can price up to `MAX_SYMBOLS_PER_REQUEST` symbols at
/// once.
pub const STOCKDATA_DAILY_LIMIT: i64 = 100;

/// StockData.org's free-tier symbols-per-request cap (their pricing page,
/// confirmed live) — see `live_price_provider::LivePriceProvider::max_batch_size`.
pub const MAX_SYMBOLS_PER_REQUEST: usize = 3;

/// Fetches the current price for one `symbol`. `Ok(None)` means
/// StockData.org has no data for that symbol — same "nothing to update"
/// contract as the other three providers' `fetch_quote`.
pub async fn fetch_quote(client: &reqwest::Client, api_key: &str, symbol: &str) -> Result<Option<Decimal>, String> {
    let quotes = fetch_quotes_batch(client, api_key, &[symbol.to_string()]).await?;
    Ok(quotes.get(symbol).copied().flatten())
}

/// Fetches current prices for up to `MAX_SYMBOLS_PER_REQUEST` symbols in
/// one request (a comma-separated `symbols=` query param) — callers
/// wanting more than that must chunk themselves. Returns one entry per
/// requested symbol (`None` for any StockData.org didn't return data
/// for), so a caller never has to distinguish "absent from the response"
/// from "no data" itself.
pub async fn fetch_quotes_batch(client: &reqwest::Client, api_key: &str, symbols: &[String]) -> Result<HashMap<String, Option<Decimal>>, String> {
    let joined = symbols.join(",");
    let response = client
        .get(BASE_URL)
        .query(&[("symbols", joined.as_str()), ("api_token", api_key)])
        .send()
        .await
        .map_err(|e| format!("network error fetching a quote for {joined}: {e}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| format!("failed to read the response for {joined}: {e}"))?;
    parse_quotes_response(status, &body, symbols)
}

/// Parses a `/v1/data/quote` response body given its HTTP status and the
/// symbols that were requested.
///
/// **The quirk this exists to handle**: unlike Twelve Data's dedicated 404,
/// StockData.org signals "no data for this symbol" as HTTP 200 with that
/// symbol simply *absent* from the `data` array (their own docs: "if no
/// results are found, the data object will be empty") — there's no
/// per-symbol marker in the response at all, so "requested but missing"
/// has to be computed by set difference against `requested`, not read off
/// the response. An invalid key (401) and a rate limit (429) are real HTTP
/// status codes, same as Finnhub/Twelve Data, with the message nested
/// under `{"error": {"message": ...}}` rather than a bare string.
pub fn parse_quotes_response(status: u16, body: &str, requested: &[String]) -> Result<HashMap<String, Option<Decimal>>, String> {
    if status == 401 {
        return Err(format!("StockData.org rejected the API key: {body}"));
    }
    if status == 429 {
        return Err(format!("StockData.org's rate limit was hit: {body}"));
    }
    if status != 200 {
        return Err(format!("unexpected response from StockData.org (HTTP {status}): {body}"));
    }

    let value: Value = serde_json::from_str(body).map_err(|e| format!("unexpected response from StockData.org: {e}"))?;
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "StockData.org's response was missing a data array".to_string())?;

    let mut result: HashMap<String, Option<Decimal>> = requested.iter().map(|s| (s.clone(), None)).collect();
    for entry in data {
        let ticker = entry
            .get("ticker")
            .and_then(Value::as_str)
            .ok_or_else(|| "StockData.org's response had a quote with no ticker".to_string())?;
        let price_value = entry
            .get("price")
            .ok_or_else(|| format!("StockData.org's response for {ticker} was missing a price"))?;
        price_value
            .as_f64()
            .ok_or_else(|| format!("StockData.org's response for {ticker} had a non-numeric price"))?;
        let decimal = Decimal::from_str(&price_value.to_string())
            .map_err(|_| format!("StockData.org returned an unparseable price for {ticker}: {price_value}"))?;
        result.insert(ticker.to_string(), Some(decimal));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn symbols(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parse_quotes_response_returns_a_price_per_symbol_from_a_successful_response() {
        let body = r#"{
            "meta": {"requested": 2, "returned": 2},
            "data": [
                {"ticker": "AAPL", "price": 176.29},
                {"ticker": "TSLA", "price": 245.5}
            ]
        }"#;

        let quotes = parse_quotes_response(200, body, &symbols(&["AAPL", "TSLA"])).unwrap();

        assert_eq!(quotes.get("AAPL"), Some(&Some("176.29".parse().unwrap())));
        assert_eq!(quotes.get("TSLA"), Some(&Some("245.5".parse().unwrap())));
    }

    #[test]
    fn parse_quotes_response_returns_none_for_a_symbol_absent_from_the_data_array() {
        // Two requested, only one actually returned — StockData.org's own
        // documented behavior for an unknown/unsupported symbol.
        let body = r#"{
            "meta": {"requested": 2, "returned": 1},
            "data": [{"ticker": "AAPL", "price": 176.29}]
        }"#;

        let quotes = parse_quotes_response(200, body, &symbols(&["AAPL", "NOTREAL"])).unwrap();

        assert_eq!(quotes.get("AAPL"), Some(&Some("176.29".parse().unwrap())));
        assert_eq!(quotes.get("NOTREAL"), Some(&None));
    }

    #[test]
    fn parse_quotes_response_returns_none_for_every_symbol_when_data_is_empty() {
        let body = r#"{"meta": {"requested": 1, "returned": 0}, "data": []}"#;

        let quotes = parse_quotes_response(200, body, &symbols(&["NOTREAL"])).unwrap();

        assert_eq!(quotes.get("NOTREAL"), Some(&None));
    }

    #[test]
    fn parse_quotes_response_error_matrix() {
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
                body: r#"{"error": {"code": "invalid_api_token", "message": "Invalid API token."}}"#,
                expected_substring: Some("api key"),
                case_insensitive: true,
            },
            Case {
                label: "rate limit status",
                status: 429,
                body: r#"{"error": {"code": "rate_limit_reached", "message": "Too many requests in the past 60 seconds."}}"#,
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
                body: r#"{"error": {"message": "internal error"}}"#,
                expected_substring: None,
                case_insensitive: false,
            },
        ];

        for case in cases {
            let result = parse_quotes_response(case.status, case.body, &symbols(&["AAPL"]));
            assert!(result.is_err(), "case: {}", case.label);
            if let Some(substring) = case.expected_substring {
                let err = result.unwrap_err();
                let err = if case.case_insensitive { err.to_lowercase() } else { err };
                assert!(err.contains(substring), "case: {}", case.label);
            }
        }
    }

    #[test]
    fn parse_quotes_response_returns_an_error_when_a_returned_quote_is_missing_a_price() {
        let body = r#"{"meta": {"requested": 1, "returned": 1}, "data": [{"ticker": "AAPL"}]}"#;

        let result = parse_quotes_response(200, body, &symbols(&["AAPL"]));

        assert!(result.is_err());
    }
}
