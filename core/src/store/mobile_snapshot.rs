//! Read-only, coherent financial projection. The authenticated runtime must bind this Store and
//! context to the same unlocked profile; this API itself does not grant mobile access.
use super::{Store, StoredAccount};
use crate::mobile_snapshot::{self as contract, *};
use chrono::{DateTime, Datelike, Duration, NaiveDate, SecondsFormat, Utc};
use rust_decimal::{Decimal as Money, RoundingStrategy};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

mod budgets;
mod comparisons;
mod ledger;
mod refresh;
pub use refresh::{MOBILE_REFRESH_INTERVAL, MobileRefreshDenied, MobileSnapshotRefreshGate, MobileSnapshotRefreshPermit};
#[cfg(test)]
mod tests;

/// Supplied by the pairing runtime, never inferred from database paths or numeric row IDs.
/// Keep alias_key secret; it is only for stable aliases, not authorization or encryption.
pub struct MobileSnapshotContext {
    pub installation_id: String,
    pub profile_id: String,
    pub profile_name: String,
    pub profile_icon: Option<String>,
    pub epoch: String,
    pub sequence: u64,
    pub generated_at: DateTime<Utc>,
    pub alias_key: [u8; 32],
}
impl Drop for MobileSnapshotContext {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.alias_key.zeroize();
    }
}
impl MobileSnapshotContext {
    fn alias(&self, kind: &str, id: i64) -> String {
        let mut hash = Sha256::new();
        hash.update(b"vault-spend-mobile-alias-v1");
        hash.update(self.alias_key);
        for part in [self.profile_id.as_bytes(), kind.as_bytes(), &id.to_le_bytes()] {
            hash.update((part.len() as u64).to_le_bytes());
            hash.update(part);
        }
        hash.finalize()[..16].iter().map(|b| format!("{b:02x}")).collect()
    }
}

/// Safe to return to callers: never contains SQL, database paths, or financial values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MobileSnapshotError {
    Database,
    InvalidSnapshot,
    Busy,
}
impl std::fmt::Display for MobileSnapshotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Database => "mobile_snapshot_database_unavailable",
            Self::InvalidSnapshot => "mobile_snapshot_invalid_or_too_large",
            Self::Busy => "mobile_snapshot_connection_busy",
        })
    }
}
impl std::error::Error for MobileSnapshotError {}
impl From<rusqlite::Error> for MobileSnapshotError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Database
    }
}
fn money(v: Money) -> String {
    v.round_dp_with_strategy(12, RoundingStrategy::MidpointAwayFromZero)
        .normalize()
        .to_string()
}
fn available() -> Availability {
    Availability {
        state: "available".into(),
        reason: None,
    }
}
fn unavailable(reason: &str) -> Availability {
    Availability {
        state: "unavailable".into(),
        reason: Some(reason.into()),
    }
}
fn contribution(a: &StoredAccount) -> Money {
    match a.account.account_type.group() {
        "credit" => a.current_balance - a.starting_balance,
        "loan" => -a.current_balance,
        _ => a.current_balance,
    }
}
fn month(d: NaiveDate) -> String {
    d.format("%Y-%m").to_string()
}
fn next_month(d: NaiveDate) -> NaiveDate {
    if d.month() == 12 {
        NaiveDate::from_ymd_opt(d.year() + 1, 1, 1).unwrap()
    } else {
        NaiveDate::from_ymd_opt(d.year(), d.month() + 1, 1).unwrap()
    }
}
struct QueryOnly<'a> {
    conn: &'a rusqlite::Connection,
    previous: bool,
}
impl Drop for QueryOnly<'_> {
    fn drop(&mut self) {
        let _ = self.conn.pragma_update(None, "query_only", self.previous);
    }
}

impl Store {
    /// Reads a single SQLite snapshot, forbids accidental writes, and validates the complete output.
    /// A failed/oversized refresh must keep the phone's previous snapshot, never shorten history.
    pub fn build_mobile_snapshot(&self, context: &MobileSnapshotContext, as_of: NaiveDate) -> Result<MobileSnapshotV1, MobileSnapshotError> {
        if !self.conn.is_autocommit() {
            return Err(MobileSnapshotError::Busy);
        }
        let previous = self.conn.query_row("PRAGMA query_only", [], |r| r.get(0))?;
        self.conn.pragma_update(None, "query_only", true)?;
        let guard = QueryOnly { conn: &self.conn, previous };
        let transaction = self.conn.unchecked_transaction()?;
        let snapshot = self.project_mobile_snapshot(context, as_of)?;
        transaction.rollback()?;
        drop(guard);
        contract::serialize_mobile_snapshot(&snapshot).map_err(|_| MobileSnapshotError::InvalidSnapshot)?;
        Ok(snapshot)
    }

    fn project_mobile_snapshot(&self, c: &MobileSnapshotContext, as_of: NaiveDate) -> Result<MobileSnapshotV1, MobileSnapshotError> {
        let accounts = self.list_accounts(as_of)?;
        let holdings: Vec<_> = self
            .list_holdings(as_of)?
            .into_iter()
            .filter(|h| {
                accounts
                    .iter()
                    .any(|a| a.id == h.account_id && a.account.account_type.group() == "investment")
            })
            .collect();
        let assets = self.list_assets()?;
        let family = self.list_family_members()?;
        let members = family
            .iter()
            .map(|m| Member {
                id: c.alias("member", m.id),
                name: m.name.clone(),
            })
            .collect();
        let mut ledger = ledger::read(self, as_of)?;
        let budgets = budgets::read(self, &mut ledger.history, &ledger.raw, as_of)?;
        let property: Money = assets.iter().map(|a| a.value).sum();
        let worth = self.net_worth_breakdown_as_of(as_of)?;
        let average = self.average_monthly_spend(as_of)?;
        let overview = Overview {
            net_worth: money(worth.net_worth + property),
            cash: money(worth.cash),
            debt_contribution: money(worth.debt),
            investments: money(worth.investments),
            other_accounts: money(worth.net_worth - worth.cash - worth.debt - worth.investments),
            property_value: money(property),
            property_valued_from: assets.iter().map(|a| a.valued_on.to_string()).min(),
            property_valued_through: assets.iter().map(|a| a.valued_on.to_string()).max(),
            average_monthly_spend: Some(money(average)),
            runway_months: (average > Money::ZERO).then(|| money(worth.cash / average)),
        };
        let exported_accounts = accounts
            .iter()
            .map(|a| Account {
                id: c.alias("account", a.id),
                name: a.account.name.clone(),
                account_type: a.account.account_type.as_str().into(),
                balance: money(a.current_balance),
                starting_balance: money(a.starting_balance),
                net_worth_contribution: money(contribution(a)),
                owed: matches!(a.account.account_type.group(), "credit" | "loan").then(|| money(-contribution(a))),
                balance_basis: if holdings.iter().any(|h| h.account_id == a.id) && a.account.account_type.group() == "investment" {
                    "holdings"
                } else {
                    "ledger"
                }
                .into(),
                checkpoint_date: a.checkpoint_date.map(|d| d.to_string()),
                member_id: a.member_id.map(|id| c.alias("member", id)),
                icon: a.icon_key.clone(),
            })
            .collect();
        let mut investment_accounts = Vec::new();
        let mut accumulation = Vec::new();
        for a in accounts.iter().filter(|a| a.account.account_type.group() == "investment") {
            let positions: Vec<_> = holdings.iter().filter(|h| h.account_id == a.id).collect();
            let count = positions.len() as u32;
            let all_day = count > 0 && positions.iter().all(|h| h.day_gain_loss.is_some());
            investment_accounts.push(InvestmentSummary {
                account_id: c.alias("account", a.id),
                value: money(a.current_balance),
                cost_basis: (count > 0).then(|| money(positions.iter().map(|h| h.cost_basis).sum())),
                unrealized_gain: (count > 0).then(|| money(positions.iter().map(|h| h.gain_loss).sum())),
                day_change: all_day.then(|| money(positions.iter().filter_map(|h| h.day_gain_loss).sum())),
                coverage: QuoteCoverage {
                    state: if all_day {
                        "complete"
                    } else if count > 0 {
                        "partial"
                    } else {
                        "unavailable"
                    }
                    .into(),
                    valued_positions: count,
                    total_positions: count,
                    quote_timestamp: None,
                    previous_close_date: all_day.then(|| as_of.to_string()),
                },
            });
            let contributions = self.account_contributions(a.id, as_of)?;
            let plan = self.get_investment_plan(a.id)?;
            let value_history = self
                .account_value_history(a.id)?
                .into_iter()
                .filter(|(d, _)| *d <= as_of)
                .map(|(date, value)| ValuePoint {
                    date: date.to_string(),
                    value: money(value),
                })
                .collect();
            accumulation.push(Accumulation {
                account_id: c.alias("account", a.id),
                months: contributions
                    .months
                    .into_iter()
                    .map(|m| ContributionMonth {
                        month: m.month,
                        money_in: money(m.money_in),
                        money_out: money(m.money_out),
                    })
                    .collect(),
                total_in: money(contributions.total_in),
                total_out: money(contributions.total_out),
                net: money(contributions.net),
                first_deposit: contributions.first_deposit.map(|d| d.to_string()),
                deposit_count: contributions.deposit_count.try_into().map_err(|_| MobileSnapshotError::InvalidSnapshot)?,
                plan: AccumulationPlan {
                    monthly_contribution: plan.monthly_contribution.map(money),
                    annual_return_pct: money(plan.annual_return_pct),
                    withdraw_month: plan.withdraw_month.map(month),
                    withdraw_years: plan.withdraw_years,
                },
                value_history,
            });
        }
        let all_basis = !investment_accounts.is_empty() && investment_accounts.iter().all(|a| a.cost_basis.is_some());
        let all_day = !investment_accounts.is_empty() && investment_accounts.iter().all(|a| a.day_change.is_some());
        let investments = Investments {
            value: money(worth.investments),
            cost_basis: all_basis.then(|| money(holdings.iter().map(|h| h.cost_basis).sum())),
            unrealized_gain: all_basis.then(|| money(holdings.iter().map(|h| h.gain_loss).sum())),
            day_change: all_day.then(|| money(holdings.iter().filter_map(|h| h.day_gain_loss).sum())),
            coverage: QuoteCoverage {
                state: if all_day {
                    "complete"
                } else if !holdings.is_empty() {
                    "partial"
                } else {
                    "unavailable"
                }
                .into(),
                valued_positions: investment_accounts.iter().map(|a| a.coverage.valued_positions).sum(),
                total_positions: investment_accounts.iter().map(|a| a.coverage.total_positions).sum(),
                quote_timestamp: None,
                previous_close_date: all_day.then(|| as_of.to_string()),
            },
            accounts: investment_accounts,
        };
        ledger.history.portfolio = self
            .portfolio_history()?
            .into_iter()
            .filter(|(d, _)| *d <= as_of)
            .map(|(date, value)| ValuePoint {
                date: date.to_string(),
                value: money(value),
            })
            .collect();
        // Recorded value history and manual goal deposits can predate the ledger.
        let contribution_first: Option<String> =
            self.conn
                .query_row("SELECT MIN(date) FROM bucket_contributions WHERE date <= ?1", [as_of.to_string()], |r| {
                    r.get(0)
                })?;
        let first = ledger
            .history
            .from_month
            .clone()
            .into_iter()
            .chain(
                budgets
                    .iter()
                    .filter(|b| b.month <= month(as_of) && (b.source_month.is_some() || !b.lines.is_empty()))
                    .map(|b| b.month.clone()),
            )
            .chain(ledger.history.portfolio.iter().map(|p| p.date[..7].to_string()))
            .chain(accumulation.iter().flat_map(|a| a.value_history.iter().map(|v| v.date[..7].to_string())))
            .chain(contribution_first.map(|s| s[..7].to_string()))
            .min();
        ledger::fill_months(&mut ledger.history, first.as_deref(), as_of);
        for m in &ledger.history.months {
            let date = if m.month == month(as_of) {
                as_of
            } else {
                next_month(NaiveDate::parse_from_str(&(m.month.clone() + "-01"), "%Y-%m-%d").map_err(|_| MobileSnapshotError::Database)?)
                    .pred_opt()
                    .unwrap()
            };
            let point = self.net_worth_breakdown_as_of(date)?;
            ledger.history.net_worth.push(NetWorthPoint {
                date: date.to_string(),
                net_worth: money(point.net_worth + property),
                cash: money(point.cash),
                debt_contribution: money(point.debt),
                investments: money(point.investments),
                property_value: money(property),
                valuation_basis: "current_saved_values".into(),
            });
        }
        let mut member_worth: BTreeMap<Option<i64>, Money> = BTreeMap::new();
        for a in &accounts {
            *member_worth.entry(a.member_id).or_default() += contribution(a);
        }
        for a in &assets {
            *member_worth.entry(a.member_id).or_default() += a.value;
        }
        ledger.history.member_net_worth = member_worth
            .into_iter()
            .map(|(id, value)| MemberWorth {
                member_id: id.map(|id| c.alias("member", id)),
                label: id
                    .and_then(|id| family.iter().find(|m| m.id == id))
                    .map(|m| m.name.clone())
                    .unwrap_or_else(|| "Unassigned".into()),
                value: money(value),
            })
            .collect();
        ledger::alias_breakdowns(&mut ledger.history, c);
        let trend = self.cash_flow_forecast(as_of, 1)?;
        let forecast = self.bill_aware_forecast(as_of, 90)?;
        let mut schedule: BTreeMap<String, (Money, Money)> = BTreeMap::new();
        for e in &forecast.events {
            let sums = schedule.entry(e.date.to_string()).or_default();
            if e.amount > Money::ZERO {
                sums.0 += e.amount
            } else {
                sums.1 -= e.amount
            }
        }
        let goals = self
            .list_buckets_as_of(as_of)?
            .into_iter()
            .map(|b| GoalSummary {
                id: c.alias("goal", b.id),
                name: b.name,
                target: b.target_amount.map(money),
                saved: money(b.saved_amount),
                target_date: b.target_date.map(|d| d.to_string()),
                monthly_contribution: b.sinking_amount.map(money),
                monthly_pace: money(b.monthly_pace),
                tracks_account: b.tracks_account,
                linked_account_id: b.account_id.map(|id| c.alias("account", id)),
                member_id: b.member_id.map(|id| c.alias("member", id)),
            })
            .collect();
        let recurring = self.recurring_totals()?;
        let comparisons = comparisons::read(self, as_of)?;
        let sections = Sections {
            overview: available(),
            accounts: available(),
            investments: Availability {
                state: if investments.accounts.is_empty() { "unavailable" } else { "partial" }.into(),
                reason: Some("saved_prices_without_per_position_timestamps".into()),
            },
            budgets: available(),
            reports: available(),
            comparisons: if !comparisons.configured {
                unavailable("setup_required")
            } else if let Some(problem) = &comparisons.problem {
                Availability {
                    state: "partial".into(),
                    reason: Some(problem.clone()),
                }
            } else {
                available()
            },
            calculators: available(),
        };
        Ok(MobileSnapshotV1 {
            schema_version: 1,
            minimum_viewer_version: 1,
            installation_id: c.installation_id.clone(),
            profile: Profile {
                id: c.profile_id.clone(),
                name: c.profile_name.clone(),
                icon: c.profile_icon.clone(),
            },
            epoch: c.epoch.clone(),
            sequence: c.sequence.to_string(),
            generated_at: c.generated_at.to_rfc3339_opts(SecondsFormat::Secs, true),
            as_of_date: as_of.to_string(),
            currency: "USD".into(),
            sections,
            members,
            overview,
            accounts: exported_accounts,
            investments,
            budgets,
            history: ledger.history,
            comparisons,
            calculators: Calculators {
                inflation_pct: money(self.get_inflation_pct()?),
                accumulation,
                debts: accounts
                    .iter()
                    .filter(|a| matches!(a.account.account_type.group(), "credit" | "loan"))
                    .map(|a| DebtInput {
                        account_id: c.alias("account", a.id),
                        owed: money(-contribution(a)),
                        annual_rate_pct: a.interest_rate.map(money),
                        excluded: a.excluded_from_debt_payoff,
                    })
                    .collect(),
                forecast: Forecast {
                    through_date: (as_of + Duration::days(90)).to_string(),
                    start_balance: money(forecast.start_balance),
                    trend_daily_net: money(trend[1].balance - trend[0].balance),
                    everyday_daily_net: money(forecast.daily_baseline),
                    uses_recurring: forecast.uses_recurring,
                    schedule: schedule
                        .into_iter()
                        .map(|(date, (incoming, outgoing))| ScheduledFlow {
                            date,
                            money_in: money(incoming),
                            money_out: money(outgoing),
                        })
                        .collect(),
                },
                goals,
                recurring: RecurringSummary {
                    monthly_income: money(recurring.monthly_income),
                    monthly_expense: money(recurring.monthly_expense),
                    annual_income: money(recurring.annual_income),
                    annual_expense: money(recurring.annual_expense),
                },
            },
        })
    }
}
