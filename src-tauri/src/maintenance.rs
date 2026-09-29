//! The housekeeping that used to run from the page every time it mounted: roll each account into
//! the new month, add this month's automatic sinking-fund contributions, and leave today's point on
//! the portfolio value chart. It now runs in Rust as part of opening a profile, so a database write
//! can never come from a page that outlives its session, and a locked runtime has no way to start it.
//! What it did is handed to the freshly mounted page once, to show its usual one-time notes.
use crate::commands::{RolledAccountDto, SinkingFundContributionDto};
use budget_core::store::Store;
use chrono::NaiveDate;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaintenanceStep {
    MonthlyRollover,
    SinkingFunds,
    PortfolioSnapshot,
}

impl MaintenanceStep {
    /// Fixed wording: the page shows this, so it must never carry database error text.
    pub fn warning(self) -> &'static str {
        match self {
            MaintenanceStep::MonthlyRollover => {
                "This month's balance rollover didn't finish. It will be tried again the next time the profile opens."
            }
            MaintenanceStep::SinkingFunds => {
                "This month's automatic goal contributions didn't finish. They will be tried again the next time the profile opens."
            }
            MaintenanceStep::PortfolioSnapshot => "Today's investment value point wasn't recorded.",
        }
    }
}

/// What the housekeeping did, for the page's one-time notes. Lives only in memory, only while the
/// profile that produced it stays open.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct MaintenanceSummary {
    pub rolled: Vec<RolledAccountDto>,
    pub contributions: Vec<SinkingFundContributionDto>,
    pub warnings: Vec<String>,
}

/// Runs each step whether or not an earlier one failed: a failure is logged and reported as a fixed
/// warning, and the step is safe to repeat the next time the profile opens.
fn run_steps(
    rollover: impl FnOnce() -> Result<Vec<(i64, String, rust_decimal::Decimal)>, String>,
    contributions: impl FnOnce() -> Result<Vec<(i64, String, rust_decimal::Decimal)>, String>,
    snapshot: impl FnOnce() -> Result<(), String>,
) -> MaintenanceSummary {
    let mut summary = MaintenanceSummary::default();
    let mut fail = |step: MaintenanceStep, error: String| {
        eprintln!("startup housekeeping step {step:?} failed (continuing anyway): {error}");
        summary.warnings.push(step.warning().to_string());
    };
    let mut rolled = Vec::new();
    let mut contributed = Vec::new();
    match rollover() {
        Ok(found) => rolled = found,
        Err(error) => fail(MaintenanceStep::MonthlyRollover, error),
    }
    match contributions() {
        Ok(found) => contributed = found,
        Err(error) => fail(MaintenanceStep::SinkingFunds, error),
    }
    if let Err(error) = snapshot() {
        fail(MaintenanceStep::PortfolioSnapshot, error);
    }
    summary.rolled = rolled
        .into_iter()
        .map(|(account_id, account_name, balance)| RolledAccountDto {
            account_id,
            account_name,
            new_balance: balance.to_string(),
        })
        .collect();
    summary.contributions = contributed
        .into_iter()
        .map(|(bucket_id, bucket_name, amount)| SinkingFundContributionDto {
            bucket_id,
            bucket_name,
            amount: amount.to_string(),
        })
        .collect();
    summary
}

/// The once-per-open housekeeping. Every step is idempotent for the calendar month (or day), so a
/// second call — another unlock, a profile switched back to — reports nothing and changes nothing.
pub fn run_open_profile_maintenance(store: &Store, today: NaiveDate) -> MaintenanceSummary {
    run_steps(
        || store.roll_forward_monthly_balances(today).map_err(|e| e.to_string()),
        || store.apply_sinking_fund_contributions(today).map_err(|e| e.to_string()),
        || store.record_portfolio_snapshot(today).map(|_| ()).map_err(|e| e.to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use budget_core::models::AccountType;
    use budget_core::store::Store;

    fn day(text: &str) -> chrono::NaiveDate {
        text.parse().unwrap()
    }

    fn seeded_store() -> Store {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store
            .create_bucket("Car Insurance", None, None, None, Some("50.00".parse().unwrap()), None, None)
            .unwrap();
        store
    }

    #[test]
    fn opening_a_profile_rolls_the_month_and_contributes_once() {
        let store = seeded_store();

        let first = run_open_profile_maintenance(&store, day("2026-09-04"));
        let second = run_open_profile_maintenance(&store, day("2026-09-20"));

        assert_eq!(first.rolled.len(), 1);
        assert_eq!(first.rolled[0].account_name, "Everyday Checking");
        assert_eq!(first.contributions.len(), 1);
        assert_eq!(first.contributions[0].bucket_name, "Car Insurance");
        assert!(first.warnings.is_empty(), "{:?}", first.warnings);
        assert_eq!(
            second,
            MaintenanceSummary::default(),
            "housekeeping already done this month must be silent: {second:?}"
        );
        assert_eq!(
            store.list_buckets().unwrap()[0].saved_amount,
            "50.00".parse().unwrap(),
            "no double contribution"
        );
    }

    #[test]
    fn a_later_month_runs_the_housekeeping_again() {
        let store = seeded_store();
        run_open_profile_maintenance(&store, day("2026-09-04"));

        let october = run_open_profile_maintenance(&store, day("2026-10-02"));

        assert_eq!(october.rolled.len(), 1);
        assert_eq!(october.contributions.len(), 1);
    }

    #[test]
    fn a_failing_step_is_reported_without_stopping_the_others() {
        let store = seeded_store();
        let today = day("2026-09-04");

        let summary = run_steps(
            || store.roll_forward_monthly_balances(today).map_err(|e| e.to_string()),
            || Err(rusqlite_style_error()),
            || store.record_portfolio_snapshot(today).map(|_| ()).map_err(|e| e.to_string()),
        );

        assert_eq!(summary.rolled.len(), 1, "the steps that can run still run");
        assert!(summary.contributions.is_empty());
        assert_eq!(summary.warnings, vec![MaintenanceStep::SinkingFunds.warning().to_string()]);
    }

    fn rusqlite_style_error() -> String {
        "no such table: buckets (SQL: SELECT secret FROM buckets)".to_string()
    }

    #[test]
    fn warnings_never_carry_database_error_text() {
        for step in [
            MaintenanceStep::MonthlyRollover,
            MaintenanceStep::SinkingFunds,
            MaintenanceStep::PortfolioSnapshot,
        ] {
            let text = step.warning();
            assert!(!text.contains("SQL") && !text.contains("no such"), "{text}");
        }
    }
}
