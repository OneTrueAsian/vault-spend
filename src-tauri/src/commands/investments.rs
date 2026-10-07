//! Commands: holdings, portfolio history, investment plans, allocation targets and live prices.

use super::*;

#[derive(Serialize)]
pub struct HoldingDto {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub symbol: String,
    pub name: String,
    pub shares: String,
    pub price: String,
    pub cost_basis: String,
    pub asset_class: Option<String>,
    pub value: String,
    pub gain_loss: String,
    pub prev_close: Option<String>,
    pub day_gain_loss: Option<String>,
}

#[tauri::command]
// Same reasoning as `create_bucket` above — mirrors `Store::create_holding`.
#[allow(clippy::too_many_arguments)]
pub fn create_holding(
    account_id: i64,
    symbol: String,
    name: String,
    shares: String,
    price: String,
    cost_basis: String,
    asset_class: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let state = state.lock()?;
    let shares = parse_amount(&shares)?;
    let price = parse_amount(&price)?;
    let cost_basis = parse_amount(&cost_basis)?;
    if shares <= Decimal::ZERO {
        return Err("Shares must be greater than zero.".to_string());
    }
    if price <= Decimal::ZERO {
        return Err("Price must be greater than zero.".to_string());
    }
    if cost_basis < Decimal::ZERO {
        return Err("Cost basis can't be negative.".to_string());
    }
    let id = state
        .store
        .create_holding(account_id, &symbol, &name, shares, price, cost_basis, asset_class.as_deref())
        .map_err(|e| e.to_string())?;
    // Best effort: a missed snapshot only leaves a gap in the value history.
    let _ = state.store.record_portfolio_snapshot(chrono::Local::now().date_naive());
    Ok(id)
}

#[tauri::command]
pub fn list_holdings(state: tauri::State<AppStateHandle>) -> Result<Vec<HoldingDto>, String> {
    let state = state.lock()?;
    let today = chrono::Local::now().date_naive();
    let holdings = state.store.list_holdings(today).map_err(|e| e.to_string())?;
    Ok(holdings
        .into_iter()
        .map(|h| HoldingDto {
            id: h.id,
            account_id: h.account_id,
            account_name: h.account_name,
            symbol: h.symbol,
            name: h.name,
            shares: h.shares.to_string(),
            price: h.price.to_string(),
            cost_basis: h.cost_basis.to_string(),
            asset_class: h.asset_class,
            value: h.value.to_string(),
            gain_loss: h.gain_loss.to_string(),
            prev_close: h.prev_close.map(|d| d.to_string()),
            day_gain_loss: h.day_gain_loss.map(|d| d.to_string()),
        })
        .collect())
}

#[derive(Serialize)]
pub struct PortfolioPointDto {
    pub date: String,
    pub value: String,
}

/// The portfolio's recorded value over time — see `Store::record_portfolio_snapshot`.
#[tauri::command]
pub fn portfolio_history(state: tauri::State<AppStateHandle>) -> Result<Vec<PortfolioPointDto>, String> {
    let state = state.lock()?;
    let history = state.store.portfolio_history().map_err(|e| e.to_string())?;
    Ok(history
        .into_iter()
        .map(|(date, value)| PortfolioPointDto {
            date: date.to_string(),
            value: value.to_string(),
        })
        .collect())
}

#[derive(Serialize)]
pub struct ContributionMonthDto {
    pub month: String,
    pub money_in: String,
    pub money_out: String,
}

/// One investment account's saved projection assumptions. `withdraw_month` is
/// `"YYYY-MM"` (what a month picker sends and shows).
#[derive(Serialize)]
pub struct InvestmentPlanDto {
    pub monthly_contribution: Option<String>,
    pub annual_return_pct: String,
    pub withdraw_month: Option<String>,
    pub withdraw_years: Option<u32>,
}

/// Everything the accumulation view needs about one investment account except
/// its current value (which the account list already carries) and its value
/// history (its own command): what went in and out by month, and the plan.
#[derive(Serialize)]
pub struct InvestmentAccumulationDto {
    pub account_id: i64,
    pub months: Vec<ContributionMonthDto>,
    pub total_in: String,
    pub total_out: String,
    pub net: String,
    pub first_deposit: Option<String>,
    pub deposit_count: usize,
    pub plan: InvestmentPlanDto,
}

fn accumulation_dto(store: &Store, account_id: i64, today: chrono::NaiveDate) -> Result<InvestmentAccumulationDto, String> {
    let contributions = store.account_contributions(account_id, today).map_err(|e| e.to_string())?;
    let plan = store.get_investment_plan(account_id).map_err(|e| e.to_string())?;
    Ok(InvestmentAccumulationDto {
        account_id,
        months: contributions
            .months
            .into_iter()
            .map(|m| ContributionMonthDto {
                month: m.month,
                money_in: m.money_in.to_string(),
                money_out: m.money_out.to_string(),
            })
            .collect(),
        total_in: contributions.total_in.to_string(),
        total_out: contributions.total_out.to_string(),
        net: contributions.net.to_string(),
        first_deposit: contributions.first_deposit.map(|d| d.to_string()),
        deposit_count: contributions.deposit_count,
        plan: InvestmentPlanDto {
            monthly_contribution: plan.monthly_contribution.map(|m| m.to_string()),
            annual_return_pct: plan.annual_return_pct.to_string(),
            withdraw_month: plan.withdraw_month.map(|d| d.format("%Y-%m").to_string()),
            withdraw_years: plan.withdraw_years,
        },
    })
}

/// One investment account's contributions and saved plan — see
/// `Store::account_contributions` and `Store::get_investment_plan`.
#[tauri::command]
pub fn investment_accumulation(account_id: i64, state: tauri::State<AppStateHandle>) -> Result<InvestmentAccumulationDto, String> {
    let state = state.lock()?;
    accumulation_dto(&state.store, account_id, chrono::Local::now().date_naive())
}

/// The same for every investment account (alphabetical), for the Investments
/// tab's summary table.
#[tauri::command]
pub fn list_investment_accumulation(state: tauri::State<AppStateHandle>) -> Result<Vec<InvestmentAccumulationDto>, String> {
    let state = state.lock()?;
    let today = chrono::Local::now().date_naive();
    let accounts = state.store.list_accounts(today).map_err(|e| e.to_string())?;
    accounts
        .into_iter()
        .filter(|a| a.account.account_type == AccountType::Investment)
        .map(|a| accumulation_dto(&state.store, a.id, today))
        .collect()
}

/// One investment account's recorded values over time — real daily snapshots
/// only, see `Store::account_value_history`.
#[tauri::command]
pub fn account_value_history(account_id: i64, state: tauri::State<AppStateHandle>) -> Result<Vec<PortfolioPointDto>, String> {
    let state = state.lock()?;
    let history = state.store.account_value_history(account_id).map_err(|e| e.to_string())?;
    Ok(history
        .into_iter()
        .map(|(date, value)| PortfolioPointDto {
            date: date.to_string(),
            value: value.to_string(),
        })
        .collect())
}

/// Saves one investment account's projection assumptions. A blank monthly
/// amount means "use the recent average"; a blank withdraw month or years
/// clears it. An inflation, when given, is saved in the same step (the shared
/// "today's dollars" setting): both are saved or neither is. Anything the store
/// refuses comes back as its message and saves nothing.
#[tauri::command]
pub fn set_investment_plan(
    account_id: i64,
    monthly_contribution: Option<String>,
    annual_return_pct: String,
    withdraw_month: Option<String>,
    withdraw_years: Option<u32>,
    inflation_pct: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock()?;
    let monthly_contribution = match monthly_contribution.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => Some(s.parse::<Decimal>().map_err(|_| "The monthly amount has to be a number.".to_string())?),
        None => None,
    };
    let annual_return_pct = annual_return_pct
        .trim()
        .parse::<Decimal>()
        .map_err(|_| "The assumed return has to be a number.".to_string())?;
    let withdraw_month = match withdraw_month.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => Some(
            chrono::NaiveDate::parse_from_str(&format!("{s}-01"), "%Y-%m-%d")
                .map_err(|_| "Pick the withdraw month as a month and year.".to_string())?,
        ),
        None => None,
    };
    let inflation_pct = match inflation_pct.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => Some(s.parse::<Decimal>().map_err(|_| "Inflation has to be a number.".to_string())?),
        None => None,
    };
    let plan = budget_core::store::InvestmentPlan {
        monthly_contribution,
        annual_return_pct,
        withdraw_month,
        withdraw_years,
    };
    state
        .store
        .set_investment_plan_with_inflation(account_id, &plan, inflation_pct, chrono::Local::now().date_naive())
        .map_err(|e| e.to_string())
}

/// The inflation percentage behind "today's dollars" (3 until edited).
#[tauri::command]
pub fn get_inflation_pct(state: tauri::State<AppStateHandle>) -> Result<String, String> {
    let state = state.lock()?;
    state.store.get_inflation_pct().map(|d| d.to_string()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct AllocationTargetDto {
    pub asset_class: String,
    pub percent: String,
}

#[tauri::command]
pub fn list_allocation_targets(state: tauri::State<AppStateHandle>) -> Result<Vec<AllocationTargetDto>, String> {
    let state = state.lock()?;
    let targets = state.store.list_allocation_targets().map_err(|e| e.to_string())?;
    Ok(targets
        .into_iter()
        .map(|(asset_class, percent)| AllocationTargetDto {
            asset_class,
            percent: percent.to_string(),
        })
        .collect())
}

/// Sets (or, at 0, clears) one asset class's target share — see `Store::set_allocation_target`.
#[tauri::command]
pub fn set_allocation_target(asset_class: String, percent: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    let percent = parse_amount(&percent)?;
    state.store.set_allocation_target(&asset_class, percent).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_holding_price(id: i64, price: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    let price = parse_amount(&price)?;
    if price <= Decimal::ZERO {
        return Err("Price must be greater than zero.".to_string());
    }
    let today = chrono::Local::now().date_naive();
    state.store.update_holding_price(id, price, today).map_err(|e| e.to_string())?;
    let _ = state.store.record_portfolio_snapshot(today);
    Ok(())
}

#[tauri::command]
pub fn delete_holding(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.delete_holding(id).map_err(|e| e.to_string())?;
    let _ = state.store.record_portfolio_snapshot(chrono::Local::now().date_naive());
    Ok(())
}

#[derive(Serialize)]
pub struct LivePriceSettingsDto {
    pub enabled: bool,
    pub provider: String,
    pub last_refreshed_at: Option<String>,
    pub requests_used_today: i64,
    /// `None` when the active provider has no daily cap to enforce
    /// (Finnhub — a real per-*minute* limit, not a per-day one; see
    /// `live_price_provider.rs`). `Some(25)` for Alpha Vantage.
    pub requests_limit: Option<i64>,
}

/// The opt-in live-price feature's current state — the API key itself is
/// never sent back to the frontend once saved (write-only, standard
/// credential handling). `requests_used_today`/`requests_limit` let the
/// Settings UI show (and warn about) today's usage without a separate
/// command.
#[tauri::command]
pub fn get_live_price_settings(state: tauri::State<AppStateHandle>) -> Result<LivePriceSettingsDto, String> {
    let state = state.lock()?;
    let settings = state.store.get_live_price_settings().map_err(|e| e.to_string())?;
    let today = chrono::Local::now().date_naive();
    let requests_used_today = state.store.live_price_requests_used_today(today).map_err(|e| e.to_string())?;
    let provider = crate::live_price_provider::LivePriceProvider::parse(&settings.provider)
        .unwrap_or(crate::live_price_provider::LivePriceProvider::AlphaVantage);
    Ok(LivePriceSettingsDto {
        enabled: settings.api_key.is_some(),
        provider: provider.as_str().to_string(),
        last_refreshed_at: settings.last_refreshed_at.map(|t| t.format("%Y-%m-%d %H:%M").to_string()),
        requests_used_today,
        requests_limit: provider.daily_limit(),
    })
}

/// Saves (or, with `api_key: None`/an empty string, clears) the chosen
/// provider and its API key together. Purely local persistence — no
/// network call, so a typo'd key isn't caught here; "Refresh now" on the
/// Settings tab is what actually exercises it and would surface the
/// provider's own error message.
#[tauri::command]
pub fn set_live_price_settings(provider: String, api_key: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    let provider =
        crate::live_price_provider::LivePriceProvider::parse(&provider).ok_or_else(|| format!("unknown live-price provider: {provider}"))?;
    let api_key = api_key.filter(|k| !k.trim().is_empty());
    state
        .store
        .set_live_price_settings(provider.as_str(), api_key.as_deref())
        .map_err(|e| e.to_string())
}

/// Looks up one live quote — used only by the New Holding form's autofill,
/// so it deliberately does not write a price anywhere. Returns `Ok(None)`
/// (not an error) when the feature isn't enabled or the provider has no
/// data for the symbol, since either way the form should just leave Price
/// for the user to fill in by hand. For Alpha Vantage, once today's
/// request budget is spent, this returns an `Err` instead of attempting
/// the call at all — see `refresh_live_prices` below for the same budget
/// check on the main path. Finnhub has no such proactive local check (its
/// real limit is per-minute, not per-day — see `live_price_provider.rs`).
///
/// Locks `state` only in short scoped blocks that close before the network
/// `.await` below — `AppStateHandle`'s `std::sync::MutexGuard` isn't `Send`,
/// so holding it across an await point would fail to compile against
/// Tauri's multi-threaded async runtime.
#[tauri::command]
pub async fn fetch_live_quote(
    symbol: String,
    state: tauri::State<'_, AppStateHandle>,
    paths: tauri::State<'_, crate::config::AppPaths>,
) -> Result<Option<String>, String> {
    let today = chrono::Local::now().date_naive();
    let generation = paths.current_generation();
    let (api_key, provider, used_today) = {
        let state = state.lock()?;
        let settings = state.store.get_live_price_settings().map_err(|e| e.to_string())?;
        let used_today = state.store.live_price_requests_used_today(today).map_err(|e| e.to_string())?;
        (settings.api_key, settings.provider, used_today)
    };
    let Some(api_key) = api_key else {
        return Ok(None);
    };
    let provider =
        crate::live_price_provider::LivePriceProvider::parse(&provider).unwrap_or(crate::live_price_provider::LivePriceProvider::AlphaVantage);

    if let Some(limit) = provider.daily_limit() {
        if used_today >= limit {
            return Err(format!(
                "Today's {} limit ({limit}/day) has been reached — enter the price manually, or try again tomorrow.",
                provider.label()
            ));
        }
    }

    let client = reqwest::Client::new();
    let result = crate::live_price_provider::fetch_quote(provider, &client, &api_key, &symbol).await;
    // Same generation guard as `refresh_live_prices` — the profile that
    // was live when this request started may not be the one live now.
    // Checked here first as a cheap early-out, then checked *again* just
    // below once the lock is actually held — a profile switch can acquire
    // the lock and bump the generation in the gap between this check
    // passing and `state.lock()` below actually returning (that lock call
    // blocks, uncontended-or-not, and a switch can run to completion
    // during the wait), so only the check taken while holding the same
    // lock the switch uses is actually atomic with it.
    if paths.current_generation() != generation {
        return Ok(None);
    }
    {
        let state = state.lock()?;
        if paths.current_generation() != generation {
            return Ok(None);
        }
        // Recorded unconditionally for every provider — for one with no
        // daily_limit() (Finnhub) this is an informational-only "requests
        // used today" count with no limit attached, not a budget check.
        state.store.record_live_price_request(today).map_err(|e| e.to_string())?;
    }
    Ok(result?.map(|p| p.to_string()))
}

#[derive(Serialize)]
pub struct FailedQuote {
    pub symbol: String,
    pub error: String,
}

#[derive(Serialize)]
pub struct LivePriceRefreshSummary {
    pub updated: Vec<String>,
    pub failed: Vec<FailedQuote>,
}

/// Refreshes every distinct symbol currently held (see
/// `Store::list_distinct_holding_symbols` — a symbol held in more than one
/// account still costs exactly one request). Called once on launch and
/// every 2 hours while the app stays open (see App.tsx), plus on demand via
/// the Settings tab's "Refresh now".
///
/// **For Alpha Vantage, stops pulling data once today's budget is spent**
/// — checked locally against `Store::live_price_requests_used_today`
/// before any request goes out, not just reacted to after the fact. If
/// fewer than `symbols.len()` requests remain today, only that many are
/// actually attempted; the rest land in `failed` with a "Skipped — limit"
/// message instead of being sent and failing anyway. This is a proactive
/// cap, not just error handling: opening and closing the app repeatedly
/// through the day (each launch triggers a refresh) accumulates against
/// the same per-profile counter, so it still stops at the daily total
/// regardless of how many separate launches it took to get there (see
/// `LivePriceProvider::daily_limit` — Alpha Vantage is 25/day, Twelve
/// Data is 800/day). **Finnhub has no such cap** — its real limit is 60
/// requests/*minute*, not a day, and this app's usage pattern (one
/// request per distinct symbol, refreshed at most every 2 hours) never
/// comes close to it; if it's ever actually exceeded, that 429 just lands
/// in `failed` like any other per-symbol error, with no proactive skip.
/// Symbols are fetched one at a time, not concurrently, so the running
/// total stays accurate mid-batch.
///
/// Same locking discipline as `fetch_live_quote` above: the network calls
/// below run with no lock held at all, and results are written back in
/// short, separate locks — one per request (to record it against today's
/// count as it happens, unconditionally for both providers), then one
/// more at the end for the price/timestamp writes.
#[tauri::command]
pub async fn refresh_live_prices(
    state: tauri::State<'_, AppStateHandle>,
    paths: tauri::State<'_, crate::config::AppPaths>,
) -> Result<LivePriceRefreshSummary, String> {
    let today = chrono::Local::now().date_naive();
    let generation = paths.current_generation();
    let (api_key, provider, symbols, used_today) = {
        let state = state.lock()?;
        let settings = state.store.get_live_price_settings().map_err(|e| e.to_string())?;
        let symbols = state.store.list_distinct_holding_symbols().map_err(|e| e.to_string())?;
        let used_today = state.store.live_price_requests_used_today(today).map_err(|e| e.to_string())?;
        (settings.api_key, settings.provider, symbols, used_today)
    };
    let provider =
        crate::live_price_provider::LivePriceProvider::parse(&provider).unwrap_or(crate::live_price_provider::LivePriceProvider::AlphaVantage);
    let api_key = api_key.ok_or_else(|| format!("Live prices aren't enabled — add a {} API key in Settings.", provider.label()))?;

    let limit = provider.daily_limit();
    let mut symbols = symbols;
    let skipped = match limit {
        Some(limit) => {
            let remaining = (limit - used_today).max(0) as usize;
            if symbols.len() > remaining {
                symbols.split_off(remaining)
            } else {
                Vec::new()
            }
        }
        None => Vec::new(),
    };
    let to_attempt = symbols;
    let attempted_any = !to_attempt.is_empty();

    let mut failed: Vec<FailedQuote> = skipped
        .into_iter()
        .map(|symbol| FailedQuote {
            symbol,
            error: format!(
                "Skipped — today's {} limit ({}/day) would be exceeded.",
                provider.label(),
                limit.expect("skipped is only ever non-empty when a limit exists")
            ),
        })
        .collect();

    let client = reqwest::Client::new();
    let results = crate::live_price_provider::fetch_quotes(provider, &client, &api_key, &to_attempt).await;
    // One HTTP request per symbol for a provider with no batching, one per
    // up-to-`max_batch_size()`-symbol chunk for one that does (StockData.org
    // today) — matches what `fetch_quotes` above actually sent, so
    // `record_live_price_request`'s "one request actually sent" contract
    // holds even though a batching provider prices several symbols per call.
    let request_count = match provider.max_batch_size() {
        None => to_attempt.len(),
        Some(batch_size) => to_attempt.len().div_ceil(batch_size),
    };

    let mut quotes = Vec::new();
    for (symbol, result) in results {
        match result {
            Ok(Some(price)) => quotes.push((symbol, price)),
            Ok(None) => failed.push(FailedQuote {
                symbol,
                error: "no data returned for this symbol".to_string(),
            }),
            Err(error) => failed.push(FailedQuote { symbol, error }),
        }
    }

    // The network calls above ran with no lock held (see this function's
    // own doc comment) and could take long enough for the user to switch,
    // restore, or relocate to a different profile in the meantime — in
    // which case `state` below is now some other database entirely. Their
    // results belong to the profile this refresh *started* against, not
    // whatever's live now, so a generation mismatch here discards them
    // rather than recording a request/price update against the wrong
    // profile's data (the concrete bug this guards against: a refresh
    // that failed against profile A recording as if it happened, or an
    // A-only price update landing on profile B's holdings).
    //
    // Checked here first as a cheap early-out, then checked *again* just
    // below once the lock is actually held — a profile switch can acquire
    // the lock, swap `state`, and bump the generation in the gap between
    // this check passing and `state.lock()` below actually returning, so
    // only the check taken while holding the same lock the switch uses is
    // actually atomic with it.
    if paths.current_generation() != generation {
        return Ok(LivePriceRefreshSummary {
            updated: Vec::new(),
            failed: Vec::new(),
        });
    }

    let mut updated = Vec::new();
    {
        let state = state.lock()?;
        if paths.current_generation() != generation {
            return Ok(LivePriceRefreshSummary {
                updated: Vec::new(),
                failed: Vec::new(),
            });
        }
        for _ in 0..request_count {
            // Recorded unconditionally for every provider — informational
            // only for Finnhub (and, above its daily cap, StockData.org's
            // request count), which have no limit to check it against.
            state.store.record_live_price_request(today).map_err(|e| e.to_string())?;
        }
        for (symbol, price) in quotes {
            state
                .store
                .update_holding_prices_for_symbol(&symbol, price, today)
                .map_err(|e| e.to_string())?;
            updated.push(symbol);
        }
        // The prices just moved, so today's portfolio value did too.
        let _ = state.store.record_portfolio_snapshot(today);
        // Only bump "last refreshed" if a request actually went out — a
        // refresh that was entirely skipped for being over budget didn't
        // actually refresh anything.
        if attempted_any {
            state
                .store
                .set_live_prices_last_refreshed(chrono::Local::now().naive_local())
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(LivePriceRefreshSummary { updated, failed })
}
