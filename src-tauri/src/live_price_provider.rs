//! The single active live-price data provider — only one of these is ever
//! configured at a time, sharing the one `api_key` column in
//! `live_price_settings` (see `Store::set_live_price_settings`). Lets
//! `commands.rs`'s `fetch_live_quote`/`refresh_live_prices` dispatch to
//! whichever module without branching logic sprinkled through them.
use rust_decimal::Decimal;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LivePriceProvider {
    AlphaVantage,
    Finnhub,
    TwelveData,
    StockData,
}

impl LivePriceProvider {
    /// The DB/wire identifier — what's stored in `live_price_settings.provider`
    /// and sent to/from the frontend. Mirrors `AccountType::as_str`
    /// (core/src/models.rs) for consistency with this codebase's existing
    /// "plain string crosses the core/src-tauri boundary" convention.
    pub fn as_str(self) -> &'static str {
        match self {
            LivePriceProvider::AlphaVantage => "alpha_vantage",
            LivePriceProvider::Finnhub => "finnhub",
            LivePriceProvider::TwelveData => "twelve_data",
            LivePriceProvider::StockData => "stockdata_org",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "alpha_vantage" => Some(LivePriceProvider::AlphaVantage),
            "finnhub" => Some(LivePriceProvider::Finnhub),
            "twelve_data" => Some(LivePriceProvider::TwelveData),
            "stockdata_org" => Some(LivePriceProvider::StockData),
            _ => None,
        }
    }

    /// User-facing display name, for error/status messages.
    pub fn label(self) -> &'static str {
        match self {
            LivePriceProvider::AlphaVantage => "Alpha Vantage",
            LivePriceProvider::Finnhub => "Finnhub",
            LivePriceProvider::TwelveData => "Twelve Data",
            LivePriceProvider::StockData => "StockData.org",
        }
    }

    /// This provider's confirmed daily request cap, or `None` when it has
    /// no daily cap to enforce (Finnhub — a real per-*minute* limit, not a
    /// per-day one). The single source of truth for which providers get a
    /// proactive local hard-stop; `commands.rs`'s `get_live_price_settings`,
    /// `fetch_live_quote`, and `refresh_live_prices` all read this instead
    /// of each re-deriving it.
    pub fn daily_limit(self) -> Option<i64> {
        match self {
            LivePriceProvider::AlphaVantage => Some(crate::live_prices::ALPHA_VANTAGE_DAILY_LIMIT),
            LivePriceProvider::Finnhub => None,
            LivePriceProvider::TwelveData => Some(crate::twelve_data::TWELVE_DATA_DAILY_LIMIT),
            LivePriceProvider::StockData => Some(crate::stockdata::STOCKDATA_DAILY_LIMIT),
        }
    }

    /// How many symbols this provider can price in a single request —
    /// `None` means "no batching, one request per symbol" (every provider
    /// except StockData.org today). `refresh_live_prices` (commands.rs)
    /// uses this to compute how many requests a refresh actually costs for
    /// quota-recording purposes, separately from `fetch_quotes` below
    /// actually doing the chunking.
    pub fn max_batch_size(self) -> Option<usize> {
        match self {
            LivePriceProvider::StockData => Some(crate::stockdata::MAX_SYMBOLS_PER_REQUEST),
            _ => None,
        }
    }
}

/// Dispatches to whichever provider's own single-symbol `fetch_quote` —
/// used by `fetch_live_quote`'s New Holding autofill, which is inherently
/// one-symbol-at-a-time regardless of what any provider's batch endpoint
/// can do.
pub async fn fetch_quote(provider: LivePriceProvider, client: &reqwest::Client, api_key: &str, symbol: &str) -> Result<Option<Decimal>, String> {
    match provider {
        LivePriceProvider::AlphaVantage => crate::live_prices::fetch_quote(client, api_key, symbol).await,
        LivePriceProvider::Finnhub => crate::finnhub::fetch_quote(client, api_key, symbol).await,
        LivePriceProvider::TwelveData => crate::twelve_data::fetch_quote(client, api_key, symbol).await,
        LivePriceProvider::StockData => crate::stockdata::fetch_quote(client, api_key, symbol).await,
    }
}

/// Prices every symbol in `symbols`, using `fetch_quote` in a plain loop
/// for a provider with no batching (`max_batch_size() == None` — zero
/// behavior change from before this function existed, for the three
/// original providers), or chunking into `max_batch_size()`-sized groups
/// and calling StockData.org's batch endpoint for one that has it. Always
/// returns exactly one entry per input symbol, in order — a failure
/// fetching one chunk fails every symbol in that chunk (unavoidable: they
/// shared one HTTP request), but never touches symbols in other chunks.
///
/// Deliberately hardcodes the `Some(n)` branch to `stockdata::fetch_quotes_batch`
/// rather than a second per-provider dispatch table, since StockData.org
/// is the only batching provider that exists right now — worth
/// generalizing only if/when a second one shows up.
pub async fn fetch_quotes(
    provider: LivePriceProvider,
    client: &reqwest::Client,
    api_key: &str,
    symbols: &[String],
) -> Vec<(String, Result<Option<Decimal>, String>)> {
    match provider.max_batch_size() {
        None => {
            let mut results = Vec::with_capacity(symbols.len());
            for symbol in symbols {
                let result = fetch_quote(provider, client, api_key, symbol).await;
                results.push((symbol.clone(), result));
            }
            results
        }
        Some(batch_size) => {
            let mut results = Vec::with_capacity(symbols.len());
            for chunk in symbols.chunks(batch_size) {
                match crate::stockdata::fetch_quotes_batch(client, api_key, chunk).await {
                    Ok(mut quotes) => {
                        for symbol in chunk {
                            let price = quotes.remove(symbol).flatten();
                            results.push((symbol.clone(), Ok(price)));
                        }
                    }
                    Err(error) => {
                        for symbol in chunk {
                            results.push((symbol.clone(), Err(error.clone())));
                        }
                    }
                }
            }
            results
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [LivePriceProvider; 4] = [
        LivePriceProvider::AlphaVantage,
        LivePriceProvider::Finnhub,
        LivePriceProvider::TwelveData,
        LivePriceProvider::StockData,
    ];

    #[test]
    fn as_str_and_parse_round_trip_for_every_provider() {
        for p in ALL {
            assert_eq!(LivePriceProvider::parse(p.as_str()), Some(p));
        }
    }

    #[test]
    fn parse_returns_none_for_an_unknown_provider_string() {
        assert_eq!(LivePriceProvider::parse("yahoo_finance"), None);
    }

    #[test]
    fn parse_is_case_insensitive() {
        assert_eq!(LivePriceProvider::parse("FINNHUB"), Some(LivePriceProvider::Finnhub));
        assert_eq!(LivePriceProvider::parse("TWELVE_DATA"), Some(LivePriceProvider::TwelveData));
    }

    #[test]
    fn daily_limit_is_only_none_for_finnhub() {
        assert_eq!(LivePriceProvider::AlphaVantage.daily_limit(), Some(25));
        assert_eq!(LivePriceProvider::Finnhub.daily_limit(), None);
        assert_eq!(LivePriceProvider::TwelveData.daily_limit(), Some(800));
        assert_eq!(LivePriceProvider::StockData.daily_limit(), Some(100));
    }

    #[test]
    fn max_batch_size_is_only_set_for_stockdata() {
        assert_eq!(LivePriceProvider::AlphaVantage.max_batch_size(), None);
        assert_eq!(LivePriceProvider::Finnhub.max_batch_size(), None);
        assert_eq!(LivePriceProvider::TwelveData.max_batch_size(), None);
        assert_eq!(LivePriceProvider::StockData.max_batch_size(), Some(3));
    }
}
