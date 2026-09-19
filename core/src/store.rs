use crate::models::{Account, AccountType, Transaction};
use crate::rules::{Rule, RuleSet};
use chrono::{Datelike, NaiveDate, NaiveDateTime};
use rusqlite::{Connection, params};
use rust_decimal::Decimal;
use std::path::Path;
use std::str::FromStr;

/// The starter categories offered before the user has created or used any
/// of their own — seeded once into the `categories` table on a fresh
/// database (see `Store::seed_default_categories_if_missing`).
const DEFAULT_CATEGORIES: [&str; 10] = [
    "Rent",
    "Groceries",
    "Dining Out",
    "Utilities",
    "Transportation",
    "Entertainment",
    "Shopping",
    "Income",
    "Transfer",
    "Business Expense",
];

/// How a transaction's current category was decided — kept so a rule-guess
/// can later be told apart from something the user confirmed by hand.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CategorySource {
    Rule,
    User,
    Classifier,
}

impl CategorySource {
    pub fn as_str(self) -> &'static str {
        match self {
            CategorySource::Rule => "rule",
            CategorySource::User => "user",
            CategorySource::Classifier => "classifier",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "rule" => Some(CategorySource::Rule),
            "user" => Some(CategorySource::User),
            "classifier" => Some(CategorySource::Classifier),
            _ => None,
        }
    }
}

/// A transaction as it exists in the store, with the row id needed to
/// correct its category later, and which account it belongs to.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredTransaction {
    pub id: i64,
    /// The other leg's id when this transaction is one half of a linked
    /// transfer whose other half is also live (see `Store::link_transfer`).
    pub transfer_counterpart_id: Option<i64>,
    pub transaction: Transaction,
    pub category_source: Option<CategorySource>,
    pub confidence: Option<f64>,
    pub account_id: i64,
    pub account_name: String,
    pub applied_to_debt: Option<AppliedDebtPayment>,
    /// Overrides how much of this transaction counts toward its own
    /// account's balance — only ever meaningful (and only ever set) on a
    /// loan-account transaction recorded directly there, e.g. a mortgage
    /// payment that bundles principal, interest, and escrow. `None` means
    /// no override: the full `transaction.amount` counts, same as every
    /// other account type. See `Store::account_balance_as_of`.
    pub principal_amount: Option<Decimal>,
    pub split_count: i64,
    pub tags: Vec<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
}

/// Which debt account this transaction's amount was applied toward paying
/// down (see `Store::apply_debt_payment`) — only ever set on the source
/// (e.g. checking-account) side of an applied payment, never on the
/// generated transaction it created on the debt account itself.
#[derive(Debug, Clone, PartialEq)]
pub struct AppliedDebtPayment {
    pub debt_account_id: i64,
    pub debt_account_name: String,
    pub amount: Decimal,
}

/// One line of a split transaction (see `Store::set_transaction_splits`) —
/// `category` is nullable the same way `transactions.category` is (a
/// deleted category nulls it out here too, rather than leaving a dangling
/// reference or forcing the split to vanish).
#[derive(Debug, Clone, PartialEq)]
pub struct TransactionSplit {
    pub id: i64,
    pub category: Option<String>,
    pub amount: Decimal,
    pub note: Option<String>,
}

/// An account as it exists in the store, with the row id `save_transactions`
/// and `all_transactions` reference it by, plus its balance — computed by
/// `account_balance_as_of` from starting balance and transactions for
/// every account type, though what it *means* (and which direction a
/// transaction moves it) differs by type:
/// - Checking/savings/investment/other: `current_balance` is the literal
///   balance (a deposit is a positive transaction, a withdrawal negative).
/// - Credit: `starting_balance` is the credit limit, so owed starts at $0;
///   `current_balance` is available credit (a charge is negative and
///   reduces it, a payment is positive and restores it).
/// - Loan: `starting_balance` is the amount *currently owed* (not the
///   original principal), so the whole thing is debt from day one, same
///   as a fresh cash account's balance counts in full. `current_balance`
///   is what's still owed — a payment is a **positive** transaction and
///   reduces it, same sign convention as a credit payment; a negative
///   transaction represents new borrowing and increases what's owed. This
///   is the one account type where a transaction's sign is *subtracted*
///   rather than added — see `account_balance_as_of`.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredAccount {
    pub id: i64,
    pub account: Account,
    pub starting_balance: Decimal,
    pub current_balance: Decimal,
    pub institution: Option<String>,
    pub mask: Option<String>,
    /// Annual interest rate as a percentage (e.g. `24.99` for 24.99% APR) —
    /// only meaningful for credit/loan accounts, used by
    /// `Store::debt_payoff_projection`. `None` if never set.
    pub interest_rate: Option<Decimal>,
    /// Opts a debt account out of `debt_payoff_projection` without
    /// deleting it — e.g. a credit card the user pays off in full every
    /// month shouldn't be treated as debt to pay down.
    pub excluded_from_debt_payoff: bool,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    /// The most recent `balance_resets` checkpoint at or before "today"
    /// (see `latest_checkpoint`), if any — a transaction dated on or
    /// before this can't move `current_balance`, since a checkpoint's own
    /// value already accounts for everything through its date. `None`
    /// means every transaction ever recorded still counts toward
    /// `current_balance` (no rollover or manual correction has happened
    /// yet).
    pub checkpoint_date: Option<NaiveDate>,
    /// An explicit icon choice (one of the keys `accountIcons.tsx`'s picker
    /// offers, e.g. `"mortgage"`/`"crypto"`/`"joint-account"`) overriding the
    /// icon otherwise guessed from `account_type` — same convention as
    /// `StoredBucket::icon_key`. `None` means "keep guessing from the type."
    pub icon_key: Option<String>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SaveReport {
    pub inserted: usize,
}

/// A savings bucket (a named goal, e.g. "Emergency Fund"), with its saved
/// amount computed fresh from its contributions rather than stored as a
/// running total — so it's never out of sync with the contribution log.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredBucket {
    pub id: i64,
    pub name: String,
    pub target_amount: Option<Decimal>,
    pub saved_amount: Decimal,
    pub target_date: Option<NaiveDate>,
    pub account_id: Option<i64>,
    pub account_name: Option<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    pub sinking_amount: Option<Decimal>,
    pub color: Option<String>,
    pub icon_key: Option<String>,
    /// Progress follows the linked account's balance instead of manual
    /// contributions (see `Store::list_buckets_as_of`). Only takes effect
    /// while `account_id` is set.
    pub tracks_account: bool,
    /// Net dollars per month the goal has been gaining over the trailing 90
    /// days — the pace `Store::list_buckets_as_of` fills in so the UI can
    /// project a finish date. Always zero from plain `list_buckets`.
    pub monthly_pace: Decimal,
}

/// A registered category name plus its explicit icon override, if any — see
/// `Store::list_categories_with_icons`.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredCategory {
    pub name: String,
    pub icon_key: Option<String>,
}

/// SQL yielding the id of every transaction that is a leg of a *linked
/// transfer* (see `Store::link_transfer`) whose two legs are both still live.
///
/// A linked pair is money moving between the user's own accounts — neither
/// income nor spending, whatever category either leg carries — so every
/// spend/income-shaped query excludes these ids exactly as it excludes the
/// "Transfer" category. Requiring *both* legs to be live means deleting one
/// leg (and later undoing that) never leaves its orphaned partner silently
/// vanishing from totals: the surviving leg counts again until it's restored.
const LIVE_TRANSFER_LEG_IDS_SQL: &str = "SELECT l.out_transaction_id FROM transfer_links l
         JOIN transactions o ON o.id = l.out_transaction_id
         JOIN transactions i ON i.id = l.in_transaction_id
         WHERE o.deleted_at IS NULL AND i.deleted_at IS NULL
     UNION
     SELECT l.in_transaction_id FROM transfer_links l
         JOIN transactions o ON o.id = l.out_transaction_id
         JOIN transactions i ON i.id = l.in_transaction_id
         WHERE o.deleted_at IS NULL AND i.deleted_at IS NULL";

/// Two unlinked transactions that look like the two legs of one transfer —
/// see `Store::transfer_candidates`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransferCandidate {
    /// The outgoing leg (negative amount).
    pub out_id: i64,
    /// The incoming leg (positive amount).
    pub in_id: i64,
}

/// One persisted categorization rule (see `rules::Rule`) plus how many
/// current transactions its pattern matches — what Settings' rules manager
/// lists. `match_count` counts every live transaction whose description
/// contains the pattern, including ones a longer, more specific rule
/// actually wins, so read it as "how much this pattern touches", not "how
/// many transactions it categorized".
#[derive(Debug, Clone, PartialEq)]
pub struct StoredRule {
    pub pattern: String,
    pub category: String,
    pub match_count: usize,
}

/// What saving a rule would do to transactions already on the books — see
/// `Store::preview_rule`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RulePreview {
    /// Live transactions whose description contains the pattern.
    pub matching: usize,
    /// The subset that would actually be re-categorized: never one you
    /// categorized yourself, never a split purchase, never one a more
    /// specific rule owns, and not one already in the target category.
    pub would_change: usize,
}

/// A budgeted category's monthly target and which group it's organized
/// under (Income/Fixed/Flexible/Non-monthly).
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetLine {
    pub category: String,
    pub budget_group: String,
    pub monthly_amount: Decimal,
    pub cap_enabled: bool,
    /// Unspent budget carries into the next month — see
    /// `Store::monthly_budget_actuals`.
    pub rollover_enabled: bool,
}

/// One row of the Budget page's "suggest from my recent average" preview
/// — see `Store::suggest_budgets_from_average`.
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetSuggestion {
    pub category: String,
    /// The group the line would land in: the one it already has for the
    /// month being budgeted, otherwise Flexible.
    pub budget_group: String,
    /// What the month already budgets for it, if anything.
    pub current: Option<Decimal>,
    /// Average monthly spend over the window, rounded to a whole dollar.
    pub suggested: Decimal,
}

/// The suggestions plus how much history they rest on.
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetSuggestions {
    /// How many whole months the averages cover — fewer than asked for when
    /// the history is short, 0 when there is nothing before the month.
    pub months_used: u32,
    pub lines: Vec<BudgetSuggestion>,
}

/// A budgeted category's target vs. actual spend for one specific
/// calendar month (see `Store::monthly_budget_actuals`).
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetActual {
    pub category: String,
    pub budget_group: String,
    pub budgeted: Decimal,
    pub actual: Decimal,
    pub cap_enabled: bool,
    pub rollover_enabled: bool,
    /// Unspent budget carried in from earlier months (zero unless
    /// `rollover_enabled`). What the month has to spend is `budgeted +
    /// rollover`; `budgeted` itself stays the amount that was planned.
    pub rollover: Decimal,
}

/// One category's target vs. one family member's share of the actual
/// spend behind it, for one specific calendar month (see
/// `Store::monthly_budget_actuals_by_member`) — `budgeted` is always the
/// category's one shared target (there's no per-member budget), repeated
/// on every member's row for that category. `member_id`/`member_name` are
/// both `None` for the unattributed share, not omitted.
#[derive(Debug, Clone, PartialEq)]
pub struct MemberBudgetActual {
    pub category: String,
    pub budget_group: String,
    pub budgeted: Decimal,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    pub actual: Decimal,
}

/// A budgeted category that's at or near its monthly limit (see
/// `Store::budget_alerts_for_month`) — `level` is `"warning"` (>= 80% of
/// budget spent, or >= 90% if `cap_enabled`) or `"over"` (> 100%).
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetAlert {
    pub category: String,
    pub budget_group: String,
    pub budgeted: Decimal,
    pub actual: Decimal,
    pub pct: Decimal,
    pub level: String,
    pub cap_enabled: bool,
}

/// One transaction flagged as an anomaly (see `Store::anomaly_flags`) —
/// `kind` is `"large"` or `"duplicate"`, `detail` is a human-readable
/// explanation of why.
#[derive(Debug, Clone, PartialEq)]
pub struct AnomalyFlag {
    pub transaction_id: i64,
    pub kind: String,
    pub detail: String,
}

/// A proactive note for the Dashboard (see `Store::dashboard_insights`) —
/// `severity` is `"warning"` or `"info"`; `kind` is `"pace"` (on pace to
/// exceed a budget), `"category_jump"` (a month-over-month spending jump),
/// or `"large_expense"` (an unusually large charge this month).
#[derive(Debug, Clone, PartialEq)]
pub struct Insight {
    pub severity: String,
    pub kind: String,
    pub message: String,
}

/// A "large" anomaly (see `Store::anomaly_flags`) with enough transaction
/// detail to display directly — used by `Store::large_expenses_in_range`
/// for the cash-flow chart's per-month drill-down, so the frontend doesn't
/// need to separately fetch and cross-reference the full transaction.
#[derive(Debug, Clone, PartialEq)]
pub struct LargeExpense {
    pub transaction_id: i64,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
    pub category: Option<String>,
    pub detail: String,
}

/// One line item contributing to a category's actual spend for a month
/// (see `Store::transactions_for_category_in_month`) — either a whole
/// transaction, or one split line of a split transaction (`is_split`),
/// kept as its own entry with just that split's own amount/note rather
/// than the parent transaction's full amount, matching how
/// `monthly_budget_actuals` attributes a split line to its own category
/// instead of the parent's.
#[derive(Debug, Clone, PartialEq)]
pub struct CategoryTransaction {
    pub transaction_id: i64,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
    pub account_name: String,
    pub is_split: bool,
    pub split_note: Option<String>,
}

/// What a setup-data import actually did (see `Store::apply_setup_import`)
/// — counts per section, plus a human-readable reason for every row that
/// was skipped rather than applied (e.g. a bucket name that already
/// exists).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct SetupImportOutcome {
    pub accounts_created: usize,
    pub categories_created: usize,
    pub budgets_set: usize,
    pub buckets_created: usize,
    pub holdings_created: usize,
    pub skipped: Vec<String>,
}

/// A recurring bill or income line — manually maintained, not detected
/// from transaction history (a real pattern-detection feature is a much
/// harder, fuzzier problem than this). `next_date` is computed fresh from
/// `anchor_date` + `cadence` relative to today every time this is read,
/// rather than stored — so it never goes stale the way a stored
/// "next date" would once its occurrence passes.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredRecurring {
    pub id: i64,
    pub merchant: String,
    pub category: Option<String>,
    pub amount: Decimal,
    pub cadence: String,
    pub anchor_date: NaiveDate,
    pub next_date: NaiveDate,
    pub account_id: Option<i64>,
    pub account_name: Option<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    pub status: String,
}

/// A recurring item's amount moving from one price to another — see
/// `RecurringMatch::price_change`. Both are signed like the item itself
/// (a bill is negative).
#[derive(Debug, Clone, PartialEq)]
pub struct PriceChange {
    pub from: Decimal,
    pub to: Decimal,
}

/// How one recurring item lines up with the transactions actually posted —
/// see `Store::recurring_matches`.
#[derive(Debug, Clone, PartialEq)]
pub struct RecurringMatch {
    pub recurring_id: i64,
    /// `"paid"` (the latest due date has a matching charge), `"pending"`
    /// (due, nothing posted yet, still inside the grace period), `"missed"`
    /// (past the grace period with no charge, though earlier ones exist),
    /// `"unmatched"` (no matching charge in recent history at all — nothing
    /// to judge by, so never called missed), `"upcoming"` (hasn't started).
    pub state: String,
    /// The latest due date on or before today; `None` while `"upcoming"`.
    pub last_due: Option<NaiveDate>,
    pub last_paid_date: Option<NaiveDate>,
    pub last_paid_amount: Option<Decimal>,
    /// The latest charge differs from what came before it (or from the amount
    /// on file when there is only one) — subscription creep. Never set for a
    /// bill that varies month to month.
    pub price_change: Option<PriceChange>,
}

/// The opt-in "keep running in the tray" behaviour — see `src-tauri`'s
/// tray and reminder code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackgroundSettings {
    /// Closing the window hides it to the tray, and bills due soon are
    /// reminded about even while the window is closed.
    pub tray_enabled: bool,
    /// Vault Spend starts (hidden, in the tray) when the user signs in.
    pub autostart_enabled: bool,
}

/// A bill that's due soon and hasn't been reminded about yet — see
/// `Store::reminders_to_send`.
#[derive(Debug, Clone, PartialEq)]
pub struct BillReminder {
    pub recurring_id: i64,
    pub merchant: String,
    /// Negative, like the bill itself.
    pub amount: Decimal,
    pub due_date: NaiveDate,
}

/// One cell of the Reports page's category-by-month table — see
/// `Store::category_spending_by_month`.
#[derive(Debug, Clone, PartialEq)]
pub struct CategoryMonthAmount {
    /// "YYYY-MM".
    pub month: String,
    pub category: String,
    /// Spending as a positive number.
    pub amount: Decimal,
}

/// Where an account's reconciliation stands against a statement — see
/// `Store::reconciliation_status`.
#[derive(Debug, Clone, PartialEq)]
pub struct ReconciliationStatus {
    /// The account's opening balance plus every transaction marked cleared.
    pub cleared_balance: Decimal,
    /// Statement balance minus `cleared_balance`; zero means it reconciles.
    pub difference: Decimal,
    pub cleared_count: usize,
}

/// One transaction as the account detail page and the reconcile list show it.
#[derive(Debug, Clone, PartialEq)]
pub struct AccountTransaction {
    pub id: i64,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
    pub category: Option<String>,
    pub cleared: bool,
}

/// One budgeted expense category that overspent its month — see
/// `Store::month_review`.
#[derive(Debug, Clone, PartialEq)]
pub struct OverBudgetLine {
    pub category: String,
    pub budgeted: Decimal,
    pub actual: Decimal,
}

/// What the month-end review walks through for one month — see
/// `Store::month_review`.
#[derive(Debug, Clone, PartialEq)]
pub struct MonthReview {
    pub year: i32,
    pub month: u32,
    pub income: Decimal,
    /// Spending as a positive number.
    pub expenses: Decimal,
    pub prev_income: Decimal,
    pub prev_expenses: Decimal,
    /// Biggest overage first.
    pub over_budget: Vec<OverBudgetLine>,
    pub uncategorized_count: usize,
    /// Sum of the uncategorized transactions' absolute amounts.
    pub uncategorized_total: Decimal,
    pub reviewed: bool,
}

/// A pattern detected in transaction history that looks recurring but isn't yet
/// tracked in `recurring` — see `Store::detect_recurring_candidates`.
#[derive(Debug, Clone, PartialEq)]
pub struct RecurringCandidate {
    pub merchant: String,
    pub category: Option<String>,
    pub amount: Decimal,
    pub cadence: String,
    pub anchor_date: NaiveDate,
    pub occurrence_count: usize,
}

/// Recurring spend/income totaled onto a common monthly and annual
/// footing across every cadence — see `Store::recurring_totals`.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct RecurringTotals {
    pub monthly_expense: Decimal,
    pub monthly_income: Decimal,
    pub annual_expense: Decimal,
    pub annual_income: Decimal,
}

/// An investment holding, with `value` and `gain_loss` computed fresh
/// from `shares`/`price`/`cost_basis` (never stored — a manually-entered
/// price should always immediately recompute both).
#[derive(Debug, Clone, PartialEq)]
pub struct StoredHolding {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub symbol: String,
    pub name: String,
    pub shares: Decimal,
    pub price: Decimal,
    pub cost_basis: Decimal,
    pub asset_class: Option<String>,
    pub value: Decimal,
    pub gain_loss: Decimal,
    /// The price this holding was last known at before the calendar day
    /// its price was most recently updated on — i.e. today's baseline, once
    /// at least one price update has landed today. `None` until a price
    /// update actually happens (a holding just created today, or one never
    /// repriced since, has no "today" to measure movement across yet).
    pub prev_close: Option<Decimal>,
    /// `(price - prev_close) * shares` — how much this holding has moved
    /// since `prev_close`, computed fresh like `gain_loss`. `None` exactly
    /// when `prev_close` is `None`.
    pub day_gain_loss: Option<Decimal>,
}

/// Opt-in live-price configuration (see `Store::get_live_price_settings`).
/// `api_key` being `None` means the feature is off — holding prices stay
/// fully manual, exactly like before this existed. `provider` is the raw
/// stored identifier (`"alpha_vantage"`/`"finnhub"`) — kept as a plain
/// `String` here rather than an enum so `core` stays free of any
/// src-tauri-side concern; `src-tauri::live_price_provider::LivePriceProvider`
/// is what actually interprets it.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredLivePriceSettings {
    pub api_key: Option<String>,
    pub provider: String,
    pub last_refreshed_at: Option<NaiveDateTime>,
}

/// Global per-profile feature toggles, shown as switches under Settings.
/// All default to *on* — this table only ever hides a feature that
/// otherwise already ships enabled, so an existing profile that's never
/// touched Settings sees no behavior change. `envelope_caps_enabled: false`
/// doesn't erase any category's stored `cap_enabled` flag (see
/// `Store::set_budget_cap`) — it just suspends that flag's effect on the
/// 90% threshold in `budget_alerts_for_month`, so re-enabling the feature
/// later restores exactly what was capped before. `rollover_enabled: false`
/// works the same way for unspent-budget rollover: each category's own
/// `budgets.rollover_enabled` choice is left alone, but no unspent amount is
/// carried into the next month (see `monthly_budget_actuals`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StoredAppSettings {
    pub apply_to_debt_enabled: bool,
    pub split_purchases_enabled: bool,
    pub envelope_caps_enabled: bool,
    pub rollover_enabled: bool,
}

/// A manually-tracked asset outside the accounts model — real estate, a
/// vehicle, or anything else with a value worth counting toward net worth
/// but no transaction history of its own. See `Store::total_assets_value`
/// for how (and deliberately how not) this feeds into net worth.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredAsset {
    pub id: i64,
    pub name: String,
    pub asset_type: String,
    pub value: Decimal,
    pub valued_on: NaiveDate,
    pub notes: Option<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
}

/// One debt's projected payoff (see `Store::debt_payoff_projection`) —
/// `payoff_date` is `None` if it isn't projected to clear within the
/// simulation's cap.
#[derive(Debug, Clone, PartialEq)]
pub struct DebtPayoffLine {
    pub account_id: i64,
    pub account_name: String,
    pub starting_balance: Decimal,
    pub payoff_date: Option<NaiveDate>,
    pub total_interest_paid: Decimal,
}

/// The full result of `Store::debt_payoff_projection` — `total_months` and
/// `total_interest_paid` describe the plan as a whole (every debt clear,
/// and what interest that costs in total), `None` if not every debt
/// resolves within the simulation's cap.
#[derive(Debug, Clone, PartialEq)]
pub struct DebtPayoffPlan {
    pub per_account: Vec<DebtPayoffLine>,
    pub total_months: Option<u32>,
    pub total_interest_paid: Decimal,
}

/// One day's projected total cash balance (see
/// `Store::cash_flow_forecast`).
#[derive(Debug, Clone, PartialEq)]
pub struct ForecastPoint {
    pub date: NaiveDate,
    pub balance: Decimal,
}

/// One dated bill or paycheck from the Recurring list that the bill-aware
/// forecast places on its due date. `amount` is signed like a transaction:
/// negative is money out.
#[derive(Debug, Clone, PartialEq)]
pub struct ForecastEvent {
    pub date: NaiveDate,
    pub label: String,
    pub amount: Decimal,
}

/// See `Store::bill_aware_forecast`.
#[derive(Debug, Clone, PartialEq)]
pub struct BillAwareForecast {
    /// `false` when there was nothing active in Recurring to place on the
    /// calendar, so `points` is just the plain trend forecast.
    pub uses_recurring: bool,
    /// Cash (checking + savings) in the accounts right now.
    pub start_balance: Decimal,
    /// End-of-day balance for today (index 0) and each day after it.
    pub points: Vec<ForecastPoint>,
    /// Every recurring occurrence in the window, in date order.
    pub events: Vec<ForecastEvent>,
    /// Net everyday cash flow per day from history *other than* the
    /// recurring items and transfers — usually negative (groceries, gas,
    /// dining out), applied to every projected day.
    pub daily_baseline: Decimal,
}

/// A household member a piece of data can be attributed to (see
/// `Store::create_family_member`) — deliberately just a name, no color or
/// login of its own; this is an attribution label, not an account.
#[derive(Debug, Clone, PartialEq)]
pub struct FamilyMember {
    pub id: i64,
    pub name: String,
}

/// Tables that have existed since this database's very first schema
/// version — present in literally every real Vault Spend/Penny
/// Worth/Pennywise/Meadow database ever created, unlike a table added by
/// a later migration a very old real file might predate (opening it
/// through `Store::open` would still add those transparently, same as any
/// other migration).
const CORE_TABLE_NAMES: [&str; 7] = [
    "accounts",
    "transactions",
    "budgets",
    "buckets",
    "recurring",
    "assets",
    "live_price_settings",
];

/// Checks whether `path` already looks like a genuine, previously-
/// initialized budgeting database, *without* opening it through
/// `Store::open` first — that constructor's migrations create any table
/// found missing, so by the time it returns successfully even a garbage,
/// corrupted, or completely unrelated (but validly-formed) SQLite file
/// would look identical to real data. This reads `sqlite_master` on the
/// file exactly as found on disk, before anything has a chance to "heal"
/// it, so a user importing the wrong file gets a clear rejection instead
/// of silently adopting an empty profile that looks fine until they
/// notice their data isn't there.
///
/// Deliberately not filename- or extension-based: this app's own database
/// filename has changed with every product rename (meadow.db ->
/// pennywise.db -> pennyworth.db -> vaultspend.db), and a future rename
/// will change it again, so "does this look right" has to come from the
/// file's actual structure, not what it's called.
pub fn looks_like_a_vault_spend_database(path: impl AsRef<Path>) -> Result<(), String> {
    let path = path.as_ref();
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("{} doesn't look like a valid SQLite database: {e}", path.display()))?;
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .map_err(|e| format!("{} doesn't look like a valid SQLite database: {e}", path.display()))?;
    let existing: std::collections::HashSet<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("{} doesn't look like a valid SQLite database: {e}", path.display()))?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| format!("{} doesn't look like a valid SQLite database: {e}", path.display()))?;
    let missing: Vec<&str> = CORE_TABLE_NAMES.iter().filter(|t| !existing.contains(**t)).copied().collect();
    if !missing.is_empty() {
        return Err(format!(
            "{} doesn't look like a budgeting data file (missing table(s): {}).",
            path.display(),
            missing.join(", ")
        ));
    }
    Ok(())
}

pub struct Store {
    conn: Connection,
    /// Where to append a human-readable line for every account-affecting
    /// change (see `log_activity`) — `Some` only in a debug ("test") build
    /// with a real on-disk database, so a real release build shipped to a
    /// user never writes one. `None` for `open_in_memory` regardless of
    /// build type, since there's no sibling directory to put it in and no
    /// real user data to explain.
    activity_log_path: Option<std::path::PathBuf>,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let path = path.as_ref();
        let activity_log_path = if cfg!(debug_assertions) {
            path.parent().map(|dir| dir.join("account-changes.log"))
        } else {
            None
        };
        let store = Store {
            conn: Connection::open(path)?,
            activity_log_path,
        };
        store.init_schema()?;
        Ok(store)
    }

    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let store = Store {
            conn: Connection::open_in_memory()?,
            activity_log_path: None,
        };
        store.init_schema()?;
        Ok(store)
    }

    /// An account's name for a log line — never the reason a real
    /// operation fails, so a lookup miss (shouldn't happen; only called
    /// right after touching a row that references this very account)
    /// falls back to a placeholder instead of propagating an error.
    fn account_name_for_log(&self, account_id: i64) -> String {
        self.conn
            .query_row("SELECT name FROM accounts WHERE id = ?1", params![account_id], |row| row.get(0))
            .unwrap_or_else(|_| format!("account #{account_id}"))
    }

    /// "Today" for a log-only snapshot of an account's current balance (see
    /// `displayed_balance_for_log`) — the log already crosses a real
    /// wall-clock boundary deliberately for its own timestamp (see
    /// `log_activity`, and `chrono`'s `clock` feature being enabled just
    /// for this file); every date `core`'s actual business logic computes
    /// with still takes "today" as an explicit caller-supplied parameter.
    fn today_for_log(&self) -> NaiveDate {
        chrono::Local::now().date_naive()
    }

    /// One account's balance exactly as the user currently sees it on the
    /// Accounts page — "Owed" for a loan or credit account (a credit
    /// account's own `current_balance` tracks *available* credit, not what
    /// it owes; see `AccountCard` in `AccountsView.tsx`), otherwise the
    /// plain balance — as of today. Meant to be called once right before
    /// and once right after a mutation, so a log line can show the real
    /// before/after effect (see `describe_balance_snapshot`) instead of
    /// requiring the reader to already know an account type's sign
    /// convention. Never fails a real operation: `None` only if the
    /// account itself is gone (shouldn't happen — always called right
    /// before/after touching a row that references it).
    fn displayed_balance_for_log(&self, account_id: i64) -> Option<(&'static str, Decimal)> {
        let (account_type, starting_balance_str): (String, String) = self
            .conn
            .query_row(
                "SELECT account_type, starting_balance FROM accounts WHERE id = ?1",
                params![account_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok()?;
        let starting_balance = Decimal::from_str(&starting_balance_str).expect("balance stored by this crate must be valid");
        let current = self
            .account_balance_as_of(account_id, &account_type, starting_balance, self.today_for_log())
            .ok()?;
        Some(match account_type.as_str() {
            "loan" => ("owed", current),
            "credit" => ("owed", starting_balance - current),
            _ => ("balance", current),
        })
    }

    /// Formats a `displayed_balance_for_log` pair taken right before and
    /// right after a mutation as `"<label> <before> -> <after>"` — falling
    /// back to a plain note if either snapshot came back `None` (the
    /// account no longer exists), which should never happen in practice.
    fn describe_balance_snapshot(before: Option<(&'static str, Decimal)>, after: Option<(&'static str, Decimal)>) -> String {
        match (before, after) {
            (Some((label, b)), Some((_, a))) => format!("{label} {b} -> {a}"),
            _ => "balance unavailable".to_string(),
        }
    }

    /// Appends one timestamped line to the debug-only account-changes log
    /// (see `Store::open`) — a no-op with no path (release builds,
    /// `open_in_memory`). Never returns an error and never panics: a
    /// logging failure (disk full, permissions, the folder having been
    /// deleted out from under it) must never break the real mutation it's
    /// describing.
    fn log_activity(&self, message: &str) {
        let Some(path) = &self.activity_log_path else { return };
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let line = format!("[{timestamp}] {message}\n");
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = f.write_all(line.as_bytes());
        }
    }

    fn init_schema(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                account_type TEXT NOT NULL,
                starting_balance TEXT NOT NULL DEFAULT '0',
                institution TEXT,
                mask TEXT,
                interest_rate TEXT,
                excluded_from_debt_payoff INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                date TEXT NOT NULL,
                description TEXT NOT NULL,
                amount TEXT NOT NULL,
                category TEXT,
                category_source TEXT,
                confidence REAL,
                fingerprint TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_transactions_fingerprint ON transactions(fingerprint);
            CREATE TABLE IF NOT EXISTS rules (
                pattern TEXT NOT NULL UNIQUE COLLATE NOCASE,
                category TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS buckets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                target_amount TEXT,
                target_date TEXT,
                account_id INTEGER
            );
            CREATE TABLE IF NOT EXISTS bucket_contributions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bucket_id INTEGER NOT NULL REFERENCES buckets(id),
                date TEXT NOT NULL,
                amount TEXT NOT NULL,
                note TEXT
            );
            CREATE TABLE IF NOT EXISTS budgets (
                category TEXT NOT NULL,
                period TEXT NOT NULL,
                monthly_amount TEXT NOT NULL,
                budget_group TEXT NOT NULL DEFAULT 'flexible',
                PRIMARY KEY (category, period)
            );
            CREATE TABLE IF NOT EXISTS recurring (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant TEXT NOT NULL,
                category TEXT,
                amount TEXT NOT NULL,
                cadence TEXT NOT NULL,
                anchor_date TEXT NOT NULL,
                account_id INTEGER
            );
            CREATE TABLE IF NOT EXISTS recurring_dismissals (
                merchant TEXT NOT NULL,
                amount TEXT NOT NULL,
                cadence TEXT NOT NULL,
                PRIMARY KEY (merchant, amount, cadence)
            );
            CREATE TABLE IF NOT EXISTS holdings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                symbol TEXT NOT NULL,
                name TEXT NOT NULL,
                shares TEXT NOT NULL,
                price TEXT NOT NULL,
                cost_basis TEXT NOT NULL,
                asset_class TEXT,
                prev_close TEXT,
                prev_close_date TEXT
            );
            CREATE TABLE IF NOT EXISTS assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                asset_type TEXT NOT NULL,
                value TEXT NOT NULL,
                valued_on TEXT NOT NULL,
                notes TEXT
            );
            CREATE TABLE IF NOT EXISTS categories (
                name TEXT PRIMARY KEY COLLATE NOCASE
            );
            CREATE TABLE IF NOT EXISTS balance_resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                period TEXT NOT NULL,
                reset_date TEXT NOT NULL,
                balance TEXT NOT NULL,
                UNIQUE(account_id, period)
            );
            CREATE TABLE IF NOT EXISTS bucket_auto_contributions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bucket_id INTEGER NOT NULL REFERENCES buckets(id),
                period TEXT NOT NULL,
                contribution_id INTEGER NOT NULL REFERENCES bucket_contributions(id),
                UNIQUE(bucket_id, period)
            );
            CREATE TABLE IF NOT EXISTS budget_periods (
                period TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS debt_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
                debt_account_id INTEGER NOT NULL REFERENCES accounts(id),
                generated_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
                amount TEXT NOT NULL,
                date TEXT NOT NULL
            );
            -- `source_transaction_id` already has an implicit index via its
            -- own UNIQUE constraint; `generated_transaction_id` doesn't and
            -- is filtered via `NOT IN (SELECT generated_transaction_id ...)`
            -- in nearly every reporting query.
            CREATE INDEX IF NOT EXISTS idx_debt_payments_generated_transaction_id ON debt_payments(generated_transaction_id);
            CREATE TABLE IF NOT EXISTS transaction_splits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id INTEGER NOT NULL REFERENCES transactions(id),
                category TEXT,
                amount TEXT NOT NULL,
                note TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_transaction_splits_transaction_id ON transaction_splits(transaction_id);
            CREATE TABLE IF NOT EXISTS transaction_tags (
                transaction_id INTEGER NOT NULL REFERENCES transactions(id),
                tag TEXT NOT NULL COLLATE NOCASE,
                PRIMARY KEY (transaction_id, tag)
            );
            CREATE TABLE IF NOT EXISTS family_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE
            );
            CREATE TABLE IF NOT EXISTS reconciliations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                statement_date TEXT NOT NULL,
                statement_balance TEXT NOT NULL,
                finished_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS portfolio_snapshots (
                date TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS allocation_targets (
                asset_class TEXT PRIMARY KEY,
                percent TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS anomaly_dismissals (
                transaction_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                PRIMARY KEY (transaction_id, kind)
            );
            CREATE TABLE IF NOT EXISTS month_reviews (
                period TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS transfer_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                out_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
                in_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id)
            );
            CREATE TABLE IF NOT EXISTS live_price_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                api_key TEXT,
                provider TEXT NOT NULL DEFAULT 'alpha_vantage',
                last_refreshed_at TEXT,
                requests_used_today INTEGER NOT NULL DEFAULT 0,
                requests_count_date TEXT
            );
            CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                apply_to_debt_enabled INTEGER NOT NULL DEFAULT 1,
                split_purchases_enabled INTEGER NOT NULL DEFAULT 1,
                envelope_caps_enabled INTEGER NOT NULL DEFAULT 1,
                loan_sign_convention_migrated INTEGER NOT NULL DEFAULT 0,
                default_rules_seeded INTEGER NOT NULL DEFAULT 0,
                backup_copy_dir TEXT,
                tray_enabled INTEGER NOT NULL DEFAULT 0,
                autostart_enabled INTEGER NOT NULL DEFAULT 0,
                rollover_enabled INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS reminders_sent (
                recurring_id INTEGER NOT NULL,
                due_date TEXT NOT NULL,
                sent_on TEXT NOT NULL,
                PRIMARY KEY (recurring_id, due_date)
            );",
        )?;
        self.migrate_add_account_id_if_missing()?;
        self.migrate_add_confidence_if_missing()?;
        self.migrate_add_starting_balance_if_missing()?;
        self.migrate_add_institution_and_mask_if_missing()?;
        self.migrate_add_interest_rate_if_missing()?;
        self.migrate_add_excluded_from_debt_payoff_if_missing()?;
        self.migrate_add_budget_group_if_missing()?;
        self.migrate_budgets_to_period_scoped_if_missing()?;
        self.backfill_budget_periods_if_missing()?;
        self.migrate_add_cap_enabled_to_budgets_if_missing()?;
        self.migrate_add_bucket_extras_if_missing()?;
        self.migrate_add_bucket_sinking_amount_if_missing()?;
        self.migrate_add_bucket_color_if_missing()?;
        self.migrate_add_bucket_tracks_account_if_missing()?;
        self.migrate_add_backup_copy_dir_if_missing()?;
        self.migrate_add_rollover_to_budgets_if_missing()?;
        self.migrate_add_cleared_to_transactions_if_missing()?;
        self.migrate_add_background_settings_if_missing()?;
        self.migrate_add_rollover_setting_if_missing()?;
        self.migrate_add_bucket_icon_key_if_missing()?;
        self.migrate_add_account_icon_key_if_missing()?;
        self.migrate_add_category_icon_key_if_missing()?;
        self.migrate_add_member_id_to_accounts_if_missing()?;
        self.migrate_add_member_id_to_transactions_if_missing()?;
        self.migrate_add_member_id_to_recurring_if_missing()?;
        self.migrate_add_status_to_recurring_if_missing()?;
        self.migrate_add_member_id_to_buckets_if_missing()?;
        self.migrate_add_member_id_to_assets_if_missing()?;
        self.migrate_add_live_price_request_tracking_if_missing()?;
        self.migrate_add_live_price_provider_if_missing()?;
        self.migrate_add_deleted_at_if_missing()?;
        self.migrate_add_holdings_prev_close_if_missing()?;
        self.migrate_fix_stale_manual_balance_override_reset_dates()?;
        self.migrate_add_loan_sign_convention_migrated_if_missing()?;
        self.migrate_add_default_rules_seeded_if_missing()?;
        self.migrate_flip_loan_transaction_signs_if_needed()?;
        self.migrate_add_principal_amount_if_missing()?;
        // These reference columns only guaranteed to exist once every
        // migration above has run — a database from before those columns
        // existed has a table the initial `CREATE TABLE IF NOT EXISTS` up
        // top left untouched (it already existed, just without the
        // column), so an index on that column placed in that same batch
        // would fail with "no such column" exactly like the migrations
        // above had to work around for the columns themselves.
        // `deleted_at` (transactions): only exists after
        // `migrate_add_deleted_at_if_missing` runs, above. Partial indexes
        // matching the `deleted_at IS NULL` predicate nearly every
        // production query already filters on, covering the three ways
        // transactions get looked up: per account (balance-as-of), per
        // category (budget actuals), and by date alone (monthly totals,
        // large-expense range scans).
        // `period` (budgets): only exists after
        // `migrate_budgets_to_period_scoped_if_missing`, above — the
        // table's own PRIMARY KEY is (category, period), which can't serve
        // a period-only lookup (`list_budgets`) efficiently since category
        // leads it.
        self.conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account_id, date) WHERE deleted_at IS NULL;
             CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions(category, date) WHERE deleted_at IS NULL;
             CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date) WHERE deleted_at IS NULL;
             CREATE INDEX IF NOT EXISTS idx_budgets_period ON budgets(period);
             -- `debt_payments.source_transaction_id` already has an implicit
             -- index via its own UNIQUE constraint (see its CREATE TABLE
             -- above) — only `transaction_tags.transaction_id` was actually
             -- missing one, forcing `all_transactions`'s LEFT JOIN against it
             -- to build a temporary index on every call instead of using a
             -- persistent one.
             CREATE INDEX IF NOT EXISTS idx_transaction_tags_transaction_id ON transaction_tags(transaction_id);",
        )?;
        self.seed_default_categories_if_missing()?;
        self.backfill_categories_from_usage()
    }

    /// `live_price_settings` originally shipped with just `api_key`/
    /// `last_refreshed_at` — these two columns (the daily request counter
    /// used by `record_live_price_request`/`live_price_requests_used_today`)
    /// were added right after. Same missing-column pattern as every other
    /// migration here.
    fn migrate_add_live_price_request_tracking_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(live_price_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_requests_used_today = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "requests_used_today" {
                has_requests_used_today = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_requests_used_today {
            return Ok(());
        }

        self.conn.execute(
            "ALTER TABLE live_price_settings ADD COLUMN requests_used_today INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        self.conn
            .execute("ALTER TABLE live_price_settings ADD COLUMN requests_count_date TEXT", [])?;
        Ok(())
    }

    /// `live_price_settings` didn't originally track which provider a
    /// saved API key belongs to — everyone who'd already saved a key was
    /// necessarily using Alpha Vantage (Finnhub support didn't exist yet),
    /// so this backfills existing rows to `'alpha_vantage'` via the
    /// column's own default. Same missing-column pattern as every other
    /// migration here.
    fn migrate_add_live_price_provider_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(live_price_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_provider = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "provider" {
                has_provider = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_provider {
            return Ok(());
        }

        self.conn.execute(
            "ALTER TABLE live_price_settings ADD COLUMN provider TEXT NOT NULL DEFAULT 'alpha_vantage'",
            [],
        )?;
        Ok(())
    }

    /// Same pattern once more: `target_date`/`account_id` are both
    /// nullable and optional — a missing-column database just needs the
    /// columns added, `NULL` is already correct for existing buckets.
    fn migrate_add_bucket_extras_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_target_date = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "target_date" {
                has_target_date = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_target_date {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE buckets ADD COLUMN target_date TEXT", [])?;
        self.conn.execute("ALTER TABLE buckets ADD COLUMN account_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `sinking_amount` turns a bucket into a
    /// sinking fund — an amount auto-contributed once a month (see
    /// `Store::apply_sinking_fund_contributions`) for an irregular annual
    /// cost like insurance or holiday gifts, instead of only accepting
    /// manual contributions. `NULL` (the default for every pre-existing
    /// row) means the feature is off for that bucket, same convention as
    /// `target_amount`/`target_date`/`account_id`.
    fn migrate_add_bucket_sinking_amount_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "sinking_amount" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE buckets ADD COLUMN sinking_amount TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: `tracks_account` makes a goal's progress follow
    /// its linked account's balance rather than logged contributions. `0`
    /// (the default for every pre-existing row) keeps the old behavior — the
    /// linked account stays purely informational until the user opts in.
    fn migrate_add_bucket_tracks_account_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "tracks_account" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE buckets ADD COLUMN tracks_account INTEGER NOT NULL DEFAULT 0", [])?;
        Ok(())
    }

    /// Same pattern once more: an optional hex color (e.g. `"#8A5FB0"`) a
    /// bucket can be tagged with, purely for the UI to color-code its card
    /// and any report that lists buckets by — not validated at this layer
    /// (matching this schema's existing lenient-raw-string convention for
    /// things like `cadence`/`budget_group`), since the frontend only ever
    /// offers a fixed palette. `NULL` (the default for every pre-existing
    /// row) means "no color chosen," same convention as the other optional
    /// bucket columns above.
    fn migrate_add_bucket_color_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "color" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE buckets ADD COLUMN color TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: an optional explicit icon choice (one of the
    /// keys `bucketIcons.tsx`'s picker offers, e.g. `"travel"`/`"home"`/
    /// `"gift"`/`"laptop"`) a bucket can be tagged with, so the UI doesn't
    /// have to guess from the name. Not validated at this layer, same
    /// lenient-raw-string convention as `color` above — the frontend only
    /// ever offers a fixed set. `NULL` (the default for every pre-existing
    /// row) means "no explicit icon chosen," so the frontend falls back to
    /// its existing keyword-matched icon for that bucket, unchanged.
    fn migrate_add_bucket_icon_key_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "icon_key" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE buckets ADD COLUMN icon_key TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more, for accounts: an explicit icon choice
    /// (`accountIcons.tsx`'s picker) overriding the type-guessed default.
    /// `NULL` for every pre-existing row keeps its current guessed icon.
    fn migrate_add_account_icon_key_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "icon_key" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN icon_key TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more, for categories: an explicit icon choice
    /// (`categoryIcons.tsx`'s picker) overriding the keyword-guessed default.
    /// `NULL` for every pre-existing row keeps its current guessed icon.
    fn migrate_add_category_icon_key_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(categories)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "icon_key" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE categories ADD COLUMN icon_key TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: a database from before grouped budgets
    /// existed has no `budget_group` column. Existing budget lines
    /// backfill to `'flexible'` — the same default a fresh line gets —
    /// rather than leaving them ungrouped.
    fn migrate_add_budget_group_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(budgets)")?;
        let mut rows = stmt.query([])?;
        let mut has_budget_group = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "budget_group" {
                has_budget_group = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_budget_group {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE budgets ADD COLUMN budget_group TEXT", [])?;
        self.conn
            .execute("UPDATE budgets SET budget_group = 'flexible' WHERE budget_group IS NULL", [])?;
        Ok(())
    }

    /// Same pattern once more: `cap_enabled` lets a category opt into a
    /// stricter 90%-of-budget warning threshold (see
    /// `Store::budget_alerts_for_month`) instead of the default 80%.
    /// Defaults to `0` (off) for every pre-existing row and every future
    /// row `set_budget` inserts without mentioning this column. Must run
    /// *after* `migrate_budgets_to_period_scoped_if_missing` — that one
    /// rebuilds `budgets` from a hardcoded column list on a legacy
    /// database, which would silently drop this column if it ran first.
    fn migrate_add_cap_enabled_to_budgets_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(budgets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "cap_enabled" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE budgets ADD COLUMN cap_enabled INTEGER NOT NULL DEFAULT 0", [])?;
        Ok(())
    }

    /// `budgets` used to have one global row per category shared by every
    /// month (`category TEXT PRIMARY KEY`) — editing a budget amount
    /// changed it for every month, past and future, since there was only
    /// ever one row per category. Rebuilds the table with a composite
    /// `(category, period)` key so each calendar month gets its own
    /// independent row (SQLite can't change a primary key with `ALTER
    /// TABLE`, so this rebuilds it: rename, recreate, copy, drop). Every
    /// pre-existing row is tagged with a sentinel period ("0000-01",
    /// guaranteed to sort before any real month) so it becomes the
    /// template the first real month copies forward from (see
    /// `Store::list_budgets`), preserving today's numbers exactly until
    /// the user edits a specific month.
    fn migrate_budgets_to_period_scoped_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(budgets)")?;
        let mut rows = stmt.query([])?;
        let mut has_period = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "period" {
                has_period = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_period {
            return Ok(());
        }

        self.conn.execute_batch(
            "ALTER TABLE budgets RENAME TO budgets_old;
             CREATE TABLE budgets (
                 category TEXT NOT NULL,
                 period TEXT NOT NULL,
                 monthly_amount TEXT NOT NULL,
                 budget_group TEXT NOT NULL DEFAULT 'flexible',
                 PRIMARY KEY (category, period)
             );
             INSERT INTO budgets (category, period, monthly_amount, budget_group)
             SELECT category, '0000-01', monthly_amount, budget_group FROM budgets_old;
             DROP TABLE budgets_old;",
        )?;
        Ok(())
    }

    /// Ensures `budget_periods` (the "has this month been touched"
    /// tracker `list_budgets` relies on) has an entry for every period
    /// that already has real rows in `budgets` — self-healing rather
    /// than seeded only inside the migration above, since a database
    /// migrated by an earlier build (before `budget_periods` existed)
    /// would otherwise have `period`-scoped budget rows the tracker
    /// never learned about, making them look untouched and silently
    /// invisible to `list_budgets` for any period that hasn't been
    /// independently touched since. Safe and cheap to run on every
    /// launch — an `INSERT OR IGNORE` over this app's tiny budgets table.
    fn backfill_budget_periods_if_missing(&self) -> rusqlite::Result<()> {
        self.conn
            .execute("INSERT OR IGNORE INTO budget_periods (period) SELECT DISTINCT period FROM budgets", [])?;
        Ok(())
    }

    /// The standard suggestions ("Rent", "Groceries", ...) — seeded once,
    /// the first time the `categories` table is empty. Gated so a category
    /// someone has deliberately deleted (`delete_category`) never comes
    /// back on a later launch; this only ever fires for a database that has
    /// never had any category registered at all.
    fn seed_default_categories_if_missing(&self) -> rusqlite::Result<()> {
        let already_seeded: bool = self.conn.query_row("SELECT EXISTS(SELECT 1 FROM categories)", [], |row| row.get(0))?;
        if already_seeded {
            return Ok(());
        }
        for name in DEFAULT_CATEGORIES {
            self.conn.execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![name])?;
        }
        Ok(())
    }

    /// A category used to be purely implicit — whatever string happened to
    /// sit in `transactions.category` or `budgets.category` — which meant a
    /// suggested-but-unused category (like "Business Expense") had nowhere
    /// to live, and a brand-new category typed for one transaction wasn't
    /// selectable for any other until the `categories` registry table
    /// existed. Every path that assigns a category *through the app*
    /// (`set_category`, `create_category`, `rename_category`) registers the
    /// name as it goes — but a file import carries its own category column
    /// straight from the bank (a Capital One export's "Category" column,
    /// say) and writes it directly onto the transaction via
    /// `save_transactions`, bypassing all of those. That left an imported
    /// category fully visible on the transaction row (which just renders
    /// whatever string is there) while being invisible to anything that
    /// reads the registry — the "All categories" filter and Manage
    /// Categories both come up short a category real transactions use.
    ///
    /// Run unconditionally on every launch — same "safe and cheap `INSERT
    /// OR IGNORE`" treatment as `backfill_budget_periods_if_missing` — so a
    /// category that reached `transactions`/`budgets` through any bypass,
    /// present or future, self-heals on the next launch instead of staying
    /// permanently invisible. Never resurrects a deliberately deleted
    /// category: `delete_category` nulls out every transaction (and
    /// removes every budget line) that referenced it in the same
    /// operation, so there's nothing left here to re-seed from.
    fn backfill_categories_from_usage(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch(
            "INSERT OR IGNORE INTO categories (name) SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL AND deleted_at IS NULL;
             INSERT OR IGNORE INTO categories (name) SELECT DISTINCT category FROM budgets;",
        )
    }

    /// `CREATE TABLE IF NOT EXISTS` above only creates a fresh table — it
    /// never alters one that already exists. A database from before
    /// accounts existed has a `transactions` table with no `account_id`
    /// column at all, so every account-aware query fails outright. This
    /// adds the column and backfills existing rows into a fallback account
    /// rather than losing them.
    fn migrate_add_account_id_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_account_id = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "account_id" {
                has_account_id = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_account_id {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN account_id INTEGER", [])?;
        let fallback_id = self.get_or_create_account("Imported before accounts existed", AccountType::Other)?;
        self.conn
            .execute("UPDATE transactions SET account_id = ?1 WHERE account_id IS NULL", params![fallback_id])?;
        Ok(())
    }

    /// Same pattern as `migrate_add_account_id_if_missing`: a database from
    /// before soft-delete existed has no `deleted_at` column. `NULL`
    /// (not-deleted) is already correct for every existing row, so — like
    /// `confidence` below — no backfill beyond adding the column. Powers
    /// the Transactions tab's bulk-delete "Undo": `delete_transaction`/
    /// `bulk_delete_transactions` set this instead of actually removing
    /// the row, `restore_transactions` clears it back to `NULL`, and every
    /// production read of `transactions` filters `deleted_at IS NULL` (see
    /// each method's own comment for why a given one does or doesn't).
    fn migrate_add_deleted_at_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_deleted_at = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "deleted_at" {
                has_deleted_at = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_deleted_at {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN deleted_at TEXT", [])?;
        Ok(())
    }

    /// Same pattern again: a database from before the day-gain/loss stat
    /// existed has no `prev_close`/`prev_close_date` columns on `holdings`.
    /// `NULL` for both is already correct for every existing row — it just
    /// means "no day-change data yet," resolved the same way a holding
    /// created today and never repriced is (see `list_holdings`).
    fn migrate_add_holdings_prev_close_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(holdings)")?;
        let mut rows = stmt.query([])?;
        let mut has_prev_close = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "prev_close" {
                has_prev_close = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_prev_close {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE holdings ADD COLUMN prev_close TEXT", [])?;
        self.conn.execute("ALTER TABLE holdings ADD COLUMN prev_close_date TEXT", [])?;
        Ok(())
    }

    /// One-time data fixup, not a schema change: `set_account_balance_override`
    /// originally stored its checkpoint's `reset_date` as `as_of` itself
    /// instead of the day before it (see that method's own doc comment for
    /// why that's wrong — a transaction dated `as_of` added afterward would
    /// be silently excluded from every balance computed from then on).
    /// Nothing else ever rewrites an existing `balance_resets` row, so a
    /// database that already had a correction applied before this fix
    /// shipped would otherwise be stuck with the wrong date forever —
    /// permanently under-counting that account until the user happened to
    /// correct it again, which they should never have to know to do.
    ///
    /// Detectable unambiguously and safely: the fixed code can never
    /// produce a row where `reset_date` equals the date encoded in a
    /// `"manual:<date>"` period, since it always backs that date up by one
    /// day. Any row where it still does was provably written by the old
    /// code and is safe to correct in place. Idempotent — once corrected,
    /// a row no longer matches this shape, so re-running this on every
    /// launch (like every other migration here) is a no-op after the
    /// first.
    fn migrate_fix_stale_manual_balance_override_reset_dates(&self) -> rusqlite::Result<()> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, period FROM balance_resets WHERE period LIKE 'manual:%' AND reset_date = substr(period, 8)")?;
        let stale: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);

        for (id, period) in stale {
            let encoded = &period["manual:".len()..];
            let Ok(encoded_date) = NaiveDate::parse_from_str(encoded, "%Y-%m-%d") else {
                continue;
            };
            let Some(corrected) = encoded_date.pred_opt() else { continue };
            self.conn.execute(
                "UPDATE balance_resets SET reset_date = ?1 WHERE id = ?2",
                params![corrected.to_string(), id],
            )?;
        }
        Ok(())
    }

    /// Same pattern as `migrate_add_starting_balance_if_missing`: a
    /// database from before the loan sign convention flip has no
    /// `loan_sign_convention_migrated` column on `app_settings`. `0`
    /// (not yet migrated) is the correct backfill for every existing
    /// database — `migrate_flip_loan_transaction_signs_if_needed`, right
    /// below, is what actually acts on it.
    fn migrate_add_loan_sign_convention_migrated_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(app_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "loan_sign_convention_migrated" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute(
            "ALTER TABLE app_settings ADD COLUMN loan_sign_convention_migrated INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        Ok(())
    }

    /// Same missing-column pattern as the migration just above: a database
    /// from before the rules manager has no `default_rules_seeded` column on
    /// `app_settings`. `0` (not yet seeded) is the right backfill —
    /// `seed_default_rules_once` is what acts on it, and it leaves a
    /// database that already has rules alone.
    fn migrate_add_default_rules_seeded_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(app_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "default_rules_seeded" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE app_settings ADD COLUMN default_rules_seeded INTEGER NOT NULL DEFAULT 0", [])?;
        Ok(())
    }

    /// The global "Rollover unspent" switch. On (`1`) for every pre-existing
    /// database, so nobody's budgets change until they turn it off themselves.
    fn migrate_add_rollover_setting_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(app_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            has_column |= column_name == "rollover_enabled";
        }
        drop(rows);
        drop(stmt);

        if !has_column {
            self.conn
                .execute("ALTER TABLE app_settings ADD COLUMN rollover_enabled INTEGER NOT NULL DEFAULT 1", [])?;
        }
        Ok(())
    }

    /// Same pattern once more: the opt-in "run in the tray and remind me about
    /// bills" setting and its "start when I sign in" companion. Both off (`0`)
    /// for every pre-existing database.
    fn migrate_add_background_settings_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(app_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_tray = false;
        let mut has_autostart = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            has_tray |= column_name == "tray_enabled";
            has_autostart |= column_name == "autostart_enabled";
        }
        drop(rows);
        drop(stmt);

        if !has_tray {
            self.conn
                .execute("ALTER TABLE app_settings ADD COLUMN tray_enabled INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !has_autostart {
            self.conn
                .execute("ALTER TABLE app_settings ADD COLUMN autostart_enabled INTEGER NOT NULL DEFAULT 0", [])?;
        }
        Ok(())
    }

    /// Same pattern once more: `cleared` marks a transaction as having shown up
    /// on a bank statement — what reconciliation ticks off. `0` for every
    /// pre-existing row; nothing else in the app reads it.
    fn migrate_add_cleared_to_transactions_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "cleared" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE transactions ADD COLUMN cleared INTEGER NOT NULL DEFAULT 0", [])?;
        Ok(())
    }

    /// Same pattern once more: `rollover_enabled` lets a budget line carry its
    /// unspent money into the next month. Off (`0`) for every pre-existing
    /// row, so no budget changes until the user opts a category in.
    fn migrate_add_rollover_to_budgets_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(budgets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "rollover_enabled" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE budgets ADD COLUMN rollover_enabled INTEGER NOT NULL DEFAULT 0", [])?;
        Ok(())
    }

    /// Same pattern once more: an optional second folder every backup is also
    /// copied to (see `src-tauri/src/backups.rs`). `NULL` — the default for
    /// every pre-existing database — means the feature is off.
    fn migrate_add_backup_copy_dir_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(app_settings)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "backup_copy_dir" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE app_settings ADD COLUMN backup_copy_dir TEXT", [])?;
        Ok(())
    }

    /// One-time flip of the loan sign convention: every loan-account
    /// transaction already in the database was entered under the old rule
    /// (negative = payment, positive = new debt) before
    /// `account_balance_as_of` switched loans to the credit-matching rule
    /// (positive = payment, reducing what's owed — see `StoredAccount`'s
    /// doc comment). Negating every existing loan transaction's stored
    /// amount here keeps `current_balance` numerically identical to what
    /// it was before the flip; only newly entered transactions are
    /// expected to follow the new rule directly.
    ///
    /// Unlike every other migration in this file, this can't be made
    /// idempotent by detecting an "old shape" — a stored amount like
    /// `-45.00` is a valid transaction under both conventions, so there's
    /// no data shape to key off. It uses an explicit one-time flag instead
    /// (`app_settings.loan_sign_convention_migrated`), same idea as this
    /// file's `_enabled` feature toggles but recording "already done"
    /// rather than a user preference.
    fn migrate_flip_loan_transaction_signs_if_needed(&self) -> rusqlite::Result<()> {
        let already_migrated: bool = self
            .conn
            .query_row("SELECT loan_sign_convention_migrated FROM app_settings WHERE id = 1", [], |row| {
                row.get(0)
            })
            .unwrap_or(false);
        if already_migrated {
            return Ok(());
        }

        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.amount FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE a.account_type = 'loan'",
        )?;
        let loan_transactions: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);

        for (id, amount_str) in loan_transactions {
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            self.conn
                .execute("UPDATE transactions SET amount = ?1 WHERE id = ?2", params![(-amount).to_string(), id])?;
        }

        self.conn.execute(
            "INSERT INTO app_settings (id, loan_sign_convention_migrated) VALUES (1, 1)
             ON CONFLICT(id) DO UPDATE SET loan_sign_convention_migrated = 1",
            [],
        )?;
        Ok(())
    }

    /// Same pattern as `migrate_add_account_id_if_missing`: a database from
    /// before the confidence indicator existed has no `confidence` column
    /// at all. `NULL` is already the correct value for every existing row
    /// (a rule match or a user correction never had a numeric confidence),
    /// so no backfill is needed beyond adding the column.
    fn migrate_add_confidence_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_confidence = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "confidence" {
                has_confidence = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_confidence {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN confidence REAL", [])?;
        Ok(())
    }

    /// Same pattern again: a database from before account balances existed
    /// has no `starting_balance` column. Backfills existing accounts to
    /// `'0'` — the same default a fresh account gets — so their balance
    /// simply equals the sum of their transactions until the user sets a
    /// real one.
    fn migrate_add_starting_balance_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_starting_balance = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "starting_balance" {
                has_starting_balance = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_starting_balance {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN starting_balance TEXT", [])?;
        self.conn
            .execute("UPDATE accounts SET starting_balance = '0' WHERE starting_balance IS NULL", [])?;
        Ok(())
    }

    /// Same pattern once more: `institution`/`mask` are both nullable and
    /// optional, so a missing-column database just needs the columns
    /// added — `NULL` is already the correct "not set" value, no backfill.
    fn migrate_add_institution_and_mask_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_institution = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "institution" {
                has_institution = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_institution {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN institution TEXT", [])?;
        self.conn.execute("ALTER TABLE accounts ADD COLUMN mask TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: `interest_rate` (an annual percentage, used
    /// by the debt payoff planner) is nullable and optional — a missing-
    /// column database just needs the column added, `NULL` already meaning
    /// "not set" (treated as 0% by `debt_payoff_projection`).
    fn migrate_add_interest_rate_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_interest_rate = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "interest_rate" {
                has_interest_rate = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_interest_rate {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN interest_rate TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: `principal_amount` lets a transaction
    /// recorded directly on a loan account (as opposed to via
    /// `apply_debt_payment`) specify that only part of it should count
    /// toward what's owed — a mortgage payment bundles principal, interest,
    /// and escrow, and only the principal portion should move the balance
    /// (see `account_balance_as_of`, which reads
    /// `COALESCE(principal_amount, amount)`). `NULL` for every pre-existing
    /// row means "no override," i.e. today's already-correct full-amount
    /// behavior, so nothing changes for anyone not using this.
    fn migrate_add_principal_amount_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_principal_amount = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "principal_amount" {
                has_principal_amount = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_principal_amount {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN principal_amount TEXT", [])?;
        Ok(())
    }

    /// Same pattern once more: `excluded_from_debt_payoff` lets a debt
    /// account (e.g. a credit card paid in full every month) opt out of
    /// `debt_payoff_projection` without deleting the account itself.
    /// Defaults to `0` (included) for every pre-existing row.
    fn migrate_add_excluded_from_debt_payoff_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "excluded_from_debt_payoff" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE accounts ADD COLUMN excluded_from_debt_payoff INTEGER NOT NULL DEFAULT 0", [])?;
        Ok(())
    }

    /// Same pattern once more, repeated per table: `member_id` (which
    /// `family_members` row this row is attributed to) is nullable and
    /// optional — a missing-column database just needs the column added,
    /// `NULL` already meaning "unassigned."
    fn migrate_add_member_id_to_accounts_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(accounts)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE accounts ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `transactions.member_id` — see
    /// `migrate_add_member_id_to_accounts_if_missing`.
    fn migrate_add_member_id_to_transactions_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(transactions)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE transactions ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `recurring.member_id` — see
    /// `migrate_add_member_id_to_accounts_if_missing`.
    fn migrate_add_member_id_to_recurring_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(recurring)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE recurring ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `status` (`"keep"` | `"reviewing"` |
    /// `"canceled"`) is a purely user-facing audit label for the Recurring
    /// tab's spend-audit view — it never suppresses a `recurring` row from
    /// `next_occurrence`-driven surfaces (Cash Flow's forecast, Dashboard's
    /// "due soon" list, `recurring_totals`), since the app has no way to
    /// verify a bill has genuinely stopped in real life; `delete_recurring`
    /// is still the only way to actually stop tracking something. Defaults
    /// to `'keep'` for every pre-existing row and every future row
    /// `create_recurring` inserts without mentioning this column.
    fn migrate_add_status_to_recurring_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(recurring)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "status" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn
            .execute("ALTER TABLE recurring ADD COLUMN status TEXT NOT NULL DEFAULT 'keep'", [])?;
        Ok(())
    }

    /// Same pattern once more: `buckets.member_id` — see
    /// `migrate_add_member_id_to_accounts_if_missing`.
    fn migrate_add_member_id_to_buckets_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(buckets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE buckets ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Same pattern once more: `assets.member_id` — see
    /// `migrate_add_member_id_to_accounts_if_missing`.
    fn migrate_add_member_id_to_assets_if_missing(&self) -> rusqlite::Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(assets)")?;
        let mut rows = stmt.query([])?;
        let mut has_column = false;
        while let Some(row) = rows.next()? {
            let column_name: String = row.get(1)?;
            if column_name == "member_id" {
                has_column = true;
                break;
            }
        }
        drop(rows);
        drop(stmt);

        if has_column {
            return Ok(());
        }

        self.conn.execute("ALTER TABLE assets ADD COLUMN member_id INTEGER", [])?;
        Ok(())
    }

    /// Read-only counterpart to `get_or_create_account` — looks an account
    /// up by name without ever creating one, for callers (import preview)
    /// that must have zero side effects.
    pub fn find_account_by_name(&self, name: &str) -> rusqlite::Result<Option<i64>> {
        match self
            .conn
            .query_row("SELECT id FROM accounts WHERE name = ?1 COLLATE NOCASE", params![name], |row| row.get(0))
        {
            Ok(id) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Finds an account by name, or creates it — so the UI can let a user
    /// re-type an existing account's name at import time without erroring.
    pub fn get_or_create_account(&self, name: &str, account_type: AccountType) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO accounts (name, account_type) VALUES (?1, ?2)
             ON CONFLICT(name) DO NOTHING",
            params![name, account_type.as_str()],
        )?;
        self.conn
            .query_row("SELECT id FROM accounts WHERE name = ?1 COLLATE NOCASE", params![name], |row| row.get(0))
    }

    /// The most recent `balance_resets` checkpoint for an account at or
    /// before `as_of`, if any — shared by `account_balance_as_of` (which
    /// needs both the checkpoint's `balance` as its new baseline and its
    /// `reset_date` as the cutoff for which transactions still count on
    /// top of it) and `list_accounts` (which exposes just the date, so the
    /// UI can warn before a backdated transaction silently has no effect
    /// on today's balance).
    ///
    /// `reset_date DESC` alone isn't enough: a manual override and the
    /// automatic monthly rollover both anchor to "the day before whenever
    /// they ran" (see `set_account_balance_override` and
    /// `roll_forward_monthly_balances`), so whenever both run on the same
    /// calendar day — which is the common case, since a rollover fires on
    /// every app launch that hasn't already had one this month — they land
    /// on the exact same `reset_date` with no way to order between them.
    /// `id DESC` breaks the tie deterministically in favor of whichever
    /// was recorded more recently, which is also the semantically correct
    /// answer either way: a later row was always computed (or typed) with
    /// a fuller view of history than an earlier one dated the same day.
    fn latest_checkpoint(&self, account_id: i64, as_of: NaiveDate) -> rusqlite::Result<Option<(NaiveDate, Decimal)>> {
        match self.conn.query_row(
            "SELECT reset_date, balance FROM balance_resets
             WHERE account_id = ?1 AND reset_date <= ?2
             ORDER BY reset_date DESC, id DESC LIMIT 1",
            params![account_id, as_of.to_string()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        ) {
            Ok((date, balance)) => Ok(Some((
                NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("reset_date stored by this crate must be valid"),
                Decimal::from_str(&balance).expect("balance stored by this crate must be valid"),
            ))),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// The balance of one account as of `as_of`, honoring any monthly
    /// balance reset recorded for it (see `roll_forward_monthly_balances`):
    /// starts from the most recent reset at or before `as_of` (or the
    /// account's original, never-mutated `starting_balance` if there
    /// isn't one yet), then adds every transaction dated *after* that
    /// point through `as_of` — a reset's own balance already reflects
    /// everything up to its `reset_date`, so those transactions must
    /// never be summed again.
    fn account_balance_as_of(&self, account_id: i64, account_type: &str, starting_balance: Decimal, as_of: NaiveDate) -> rusqlite::Result<Decimal> {
        let checkpoint = self.latest_checkpoint(account_id, as_of)?;

        let (base_value, since_date) = match checkpoint {
            Some((date, balance)) => (balance, Some(date)),
            None => (starting_balance, None),
        };

        // COALESCE(principal_amount, amount): a transaction recorded
        // directly on a loan account can override how much of it counts
        // toward the balance (see migrate_add_principal_amount_if_missing)
        // — NULL for every transaction that never sets one, so this is a
        // no-op everywhere except a row that explicitly opted in.
        let transaction_amounts: Vec<String> = match since_date {
            Some(since) => {
                let mut stmt = self.conn.prepare(
                    "SELECT COALESCE(principal_amount, amount) FROM transactions WHERE account_id = ?1 AND date > ?2 AND date <= ?3 AND deleted_at IS NULL",
                )?;
                let rows = stmt.query_map(params![account_id, since.to_string(), as_of.to_string()], |row| row.get(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            }
            None => {
                let mut stmt = self.conn.prepare(
                    "SELECT COALESCE(principal_amount, amount) FROM transactions WHERE account_id = ?1 AND date <= ?2 AND deleted_at IS NULL",
                )?;
                let rows = stmt.query_map(params![account_id, as_of.to_string()], |row| row.get(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            }
        };

        let total: Decimal = transaction_amounts
            .iter()
            .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
            .sum();
        // A loan's current_balance is amount owed directly (see
        // StoredAccount's doc comment) — a payment should reduce that, so
        // for a loan specifically, a positive transaction subtracts and a
        // negative one adds, the mirror image of every other account type
        // (including credit, whose current_balance is available credit,
        // not owed — a payment there is already positive-adds-to-available
        // under the ordinary `+` below).
        if account_type == "loan" {
            Ok(base_value - total)
        } else {
            Ok(base_value + total)
        }
    }

    /// Marks transactions as cleared (they appeared on a statement) or not.
    pub fn set_transactions_cleared(&self, ids: &[i64], cleared: bool) -> rusqlite::Result<()> {
        for id in ids {
            self.conn
                .execute("UPDATE transactions SET cleared = ?1 WHERE id = ?2", params![cleared, id])?;
        }
        Ok(())
    }

    /// The cleared balance (opening balance plus every cleared, non-deleted
    /// transaction) against a statement's ending balance. Deliberately built
    /// from the account's opening balance and the ticked transactions alone,
    /// not from `current_balance` — that one moves with every uncleared
    /// transaction and any balance correction, and a reconciliation is only
    /// asking whether the *statement's* transactions add up.
    pub fn reconciliation_status(&self, account_id: i64, statement_balance: Decimal) -> rusqlite::Result<ReconciliationStatus> {
        let starting: String = self
            .conn
            .query_row("SELECT starting_balance FROM accounts WHERE id = ?1", params![account_id], |row| {
                row.get(0)
            })?;
        let mut stmt = self
            .conn
            .prepare("SELECT amount FROM transactions WHERE account_id = ?1 AND cleared = 1 AND deleted_at IS NULL")?;
        let amounts = stmt
            .query_map(params![account_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let cleared_sum: Decimal = amounts
            .iter()
            .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
            .sum();
        let cleared_balance = Decimal::from_str(&starting).expect("starting_balance stored by this crate must be valid") + cleared_sum;
        Ok(ReconciliationStatus {
            cleared_balance,
            difference: statement_balance - cleared_balance,
            cleared_count: amounts.len(),
        })
    }

    /// Records a finished reconciliation — but only when the difference is
    /// exactly zero. Returns whether it was recorded; a non-zero difference
    /// records nothing.
    pub fn finish_reconciliation(
        &self,
        account_id: i64,
        statement_date: NaiveDate,
        statement_balance: Decimal,
        now: NaiveDateTime,
    ) -> rusqlite::Result<bool> {
        if self.reconciliation_status(account_id, statement_balance)?.difference != Decimal::ZERO {
            return Ok(false);
        }
        self.conn.execute(
            "INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES (?1, ?2, ?3, ?4)",
            params![account_id, statement_date.to_string(), statement_balance.to_string(), now.to_string()],
        )?;
        Ok(true)
    }

    /// The statement date and balance of the account's most recent finished
    /// reconciliation, if it has had one.
    pub fn last_reconciliation(&self, account_id: i64) -> rusqlite::Result<Option<(NaiveDate, Decimal)>> {
        match self.conn.query_row(
            "SELECT statement_date, statement_balance FROM reconciliations
             WHERE account_id = ?1 ORDER BY statement_date DESC, id DESC LIMIT 1",
            params![account_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        ) {
            Ok((date, balance)) => Ok(Some((
                NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                Decimal::from_str(&balance).expect("balance stored by this crate must be valid"),
            ))),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn account_transactions_where(
        &self,
        account_id: i64,
        extra: &str,
        limit: i64,
        statement_date: Option<NaiveDate>,
    ) -> rusqlite::Result<Vec<AccountTransaction>> {
        let sql = format!(
            "SELECT id, date, description, amount, category, cleared FROM transactions
             WHERE account_id = ?1 AND deleted_at IS NULL {extra}
             ORDER BY date DESC, id DESC LIMIT ?2"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let map_row = |row: &rusqlite::Row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, bool>(5)?,
            ))
        };
        let rows = match statement_date {
            Some(date) => stmt
                .query_map(params![account_id, limit, date.to_string()], map_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
            None => stmt
                .query_map(params![account_id, limit], map_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
        };
        Ok(rows
            .into_iter()
            .map(|(id, date, description, amount, category, cleared)| AccountTransaction {
                id,
                date: NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                description,
                amount: Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
                category,
                cleared,
            })
            .collect())
    }

    /// An account's most recent transactions, newest first, each with its
    /// cleared flag.
    pub fn list_account_transactions(&self, account_id: i64, limit: usize) -> rusqlite::Result<Vec<AccountTransaction>> {
        self.account_transactions_where(account_id, "", limit as i64, None)
    }

    /// The transactions to tick through for a statement ending on
    /// `statement_date`: everything dated on or before it that hasn't been
    /// cleared yet, plus what was cleared since the last finished
    /// reconciliation (so an earlier tick can still be undone). Anything
    /// cleared before that reconciliation is settled and stays out of the way.
    pub fn reconcile_candidates(&self, account_id: i64, statement_date: NaiveDate) -> rusqlite::Result<Vec<AccountTransaction>> {
        let settled_through = self.last_reconciliation(account_id)?.map(|(date, _)| date);
        let extra = match settled_through {
            Some(date) => format!("AND date <= ?3 AND (cleared = 0 OR date > '{date}')"),
            None => "AND date <= ?3".to_string(),
        };
        self.account_transactions_where(account_id, &extra, i64::MAX, Some(statement_date))
    }

    /// An account's balance at the end of each of the last `months` months,
    /// the final point being `today` itself — the account detail page's
    /// balance chart. Built from the account's transactions, the same as
    /// `list_accounts`'s balance for it; an investment account's holdings
    /// aren't tracked historically, so its history shows only its cash side.
    pub fn account_balance_history(&self, account_id: i64, today: NaiveDate, months: u32) -> rusqlite::Result<Vec<(NaiveDate, Decimal)>> {
        let (account_type, starting): (String, String) = self.conn.query_row(
            "SELECT account_type, starting_balance FROM accounts WHERE id = ?1",
            params![account_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let starting = Decimal::from_str(&starting).expect("starting_balance stored by this crate must be valid");

        let mut history = Vec::with_capacity(months as usize);
        for back in (0..months).rev() {
            let as_of = if back == 0 {
                today
            } else {
                let index = i64::from(today.year()) * 12 + i64::from(today.month()) - 1 - i64::from(back);
                let (y, m) = (index.div_euclid(12) as i32, (index.rem_euclid(12) + 1) as u32);
                month_bounds(y, m).1.pred_opt().expect("a month's last day exists")
            };
            history.push((as_of, self.account_balance_as_of(account_id, &account_type, starting, as_of)?));
        }
        Ok(history)
    }

    /// Every investment account's total holdings value (`SUM(shares *
    /// price)`), keyed by account id. An account with no holdings rows
    /// simply has no entry, letting callers fall back to its transaction-
    /// derived balance instead of treating "no holdings yet" as "worth
    /// zero" (see `list_accounts`/`account_contributions_as_of`).
    fn holdings_value_by_account(&self) -> rusqlite::Result<std::collections::HashMap<i64, Decimal>> {
        let mut stmt = self.conn.prepare("SELECT account_id, shares, price FROM holdings")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))?;
        let mut totals: std::collections::HashMap<i64, Decimal> = std::collections::HashMap::new();
        for row in rows {
            let (account_id, shares_str, price_str) = row?;
            let shares = Decimal::from_str(&shares_str).expect("shares stored by this crate must be valid");
            let price = Decimal::from_str(&price_str).expect("price stored by this crate must be valid");
            *totals.entry(account_id).or_insert(Decimal::ZERO) += shares * price;
        }
        Ok(totals)
    }

    /// Every account, each with its balance computed fresh as of `today`
    /// (see `account_balance_as_of`) — not a stored running total, so
    /// it's never out of sync with either the transaction log or any
    /// monthly reset.
    pub fn list_accounts(&self, today: NaiveDate) -> rusqlite::Result<Vec<StoredAccount>> {
        let holdings_value = self.holdings_value_by_account()?;
        let mut stmt = self.conn.prepare(
            "SELECT a.id, a.name, a.account_type, a.starting_balance, a.institution, a.mask, a.interest_rate,
                    a.excluded_from_debt_payoff, a.member_id, fm.name, a.icon_key
             FROM accounts a
             LEFT JOIN family_members fm ON fm.id = a.member_id
             ORDER BY a.name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, bool>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
            ))
        })?;

        let mut accounts = Vec::new();
        for row in rows {
            let (
                id,
                name,
                account_type,
                starting_balance_str,
                institution,
                mask,
                interest_rate_str,
                excluded_from_debt_payoff,
                member_id,
                member_name,
                icon_key,
            ) = row?;
            let starting_balance = Decimal::from_str(&starting_balance_str).expect("starting_balance stored by this crate must be valid");
            let checkpoint_date = self.latest_checkpoint(id, today)?.map(|(date, _)| date);
            let mut current_balance = self.account_balance_as_of(id, &account_type, starting_balance, today)?;
            // An investment account's real worth is what it holds, not
            // whatever cash transactions happen to have touched the
            // account — once it has any holdings tracked, their total
            // value replaces the transaction-derived balance entirely (a
            // still-empty, freshly created investment account has no
            // entry in `holdings_value` yet, so it keeps its transaction-
            // derived balance until the first holding is added). This was
            // a real gap: a portfolio tracked entirely through Holdings
            // (never a matching deposit transaction) showed as $0 in Net
            // Worth, Accounts, and Household everywhere, despite the
            // Investments tab correctly showing its real value.
            if account_type == "investment"
                && let Some(&value) = holdings_value.get(&id)
            {
                current_balance = value;
            }
            let interest_rate = interest_rate_str.map(|s| Decimal::from_str(&s).expect("interest_rate stored by this crate must be valid"));
            accounts.push(StoredAccount {
                id,
                account: Account {
                    name,
                    account_type: AccountType::parse(&account_type).expect("account_type stored by this crate must be valid"),
                },
                starting_balance,
                current_balance,
                institution,
                mask,
                interest_rate,
                excluded_from_debt_payoff,
                member_id,
                member_name,
                checkpoint_date,
                icon_key,
            });
        }
        Ok(accounts)
    }

    /// Applies a parsed setup-import template (see `setup_import`) in a
    /// fixed order — accounts, then categories, then budgets, then
    /// buckets — so a bucket's `linked_account_name` can resolve against
    /// an account the same file just created. Every section reuses its
    /// normal creation path, so the result is exactly what typing the
    /// same values into the UI would produce: accounts via the idempotent
    /// `get_or_create_account`, categories via the `INSERT OR IGNORE`
    /// `create_category`, budgets via the upserting `set_budget` (a blank
    /// period falls back to `default_period` — passed in rather than read
    /// from the clock, keeping this testable), and buckets via
    /// `create_bucket`, whose duplicate-name error is caught per row and
    /// recorded in `skipped` instead of aborting the rest of the import.
    /// A bucket's linked account that matches nothing (not in this file,
    /// not already in the app) is also a skip, not an error — the bucket
    /// itself is still created, just unlinked.
    pub fn apply_setup_import(&self, data: &crate::setup_import::SetupImportResult, default_period: &str) -> rusqlite::Result<SetupImportOutcome> {
        let mut outcome = SetupImportOutcome::default();

        for row in &data.accounts {
            let account_type = AccountType::parse(&row.account_type).expect("setup_import validated account_type against the known set");
            let id = self.get_or_create_account(&row.name, account_type)?;
            if let Some(balance) = row.starting_balance {
                self.set_account_starting_balance(id, balance)?;
            }
            if row.institution.is_some() || row.mask.is_some() {
                self.set_account_details(id, row.institution.as_deref(), row.mask.as_deref())?;
            }
            outcome.accounts_created += 1;
        }

        for row in &data.categories {
            self.create_category(&row.name, None)?;
            outcome.categories_created += 1;
        }

        for row in &data.budgets {
            let period = row.period.as_deref().unwrap_or(default_period);
            self.set_budget(&row.category, period, row.monthly_amount, &row.budget_group)?;
            self.create_category(&row.category, None)?;
            outcome.budgets_set += 1;
        }

        for row in &data.buckets {
            let account_id = match &row.linked_account_name {
                Some(name) => {
                    let found = self
                        .conn
                        .query_row("SELECT id FROM accounts WHERE name = ?1 COLLATE NOCASE", params![name], |r| {
                            r.get::<_, i64>(0)
                        });
                    match found {
                        Ok(id) => Some(id),
                        Err(rusqlite::Error::QueryReturnedNoRows) => {
                            outcome
                                .skipped
                                .push(format!("{}: linked account '{name}' not found — bucket created without a link", row.name));
                            None
                        }
                        Err(e) => return Err(e),
                    }
                }
                None => None,
            };
            match self.create_bucket(&row.name, row.target_amount, row.target_date, account_id, None, None, None) {
                Ok(_) => outcome.buckets_created += 1,
                Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == rusqlite::ErrorCode::ConstraintViolation => {
                    outcome.skipped.push(format!("{}: a bucket with this name already exists", row.name));
                }
                Err(e) => return Err(e),
            }
        }

        for row in &data.holdings {
            let found = self
                .conn
                .query_row("SELECT id FROM accounts WHERE name = ?1 COLLATE NOCASE", params![row.account_name], |r| {
                    r.get::<_, i64>(0)
                });
            let account_id = match found {
                Ok(id) => id,
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    outcome
                        .skipped
                        .push(format!("{}: account '{}' not found — holding not created", row.symbol, row.account_name));
                    continue;
                }
                Err(e) => return Err(e),
            };
            if row.shares <= Decimal::ZERO || row.price <= Decimal::ZERO || row.cost_basis < Decimal::ZERO {
                outcome
                    .skipped
                    .push(format!("{}: shares/price must be positive and cost basis can't be negative", row.symbol));
                continue;
            }
            let name = row.name.as_deref().unwrap_or(&row.symbol);
            self.create_holding(
                account_id,
                &row.symbol,
                name,
                row.shares,
                row.price,
                row.cost_basis,
                row.asset_class.as_deref(),
            )?;
            outcome.holdings_created += 1;
        }

        Ok(outcome)
    }

    /// Rolls every account's balance forward into a fresh reset once per
    /// calendar month — the first time the app opens in a new month,
    /// whatever `current_balance` shows becomes that account's baseline
    /// for everything going forward, so a manually-tracked account (a
    /// loan, an investment, a house) never needs its balance retyped
    /// from scratch. Past "balance as of" lookups are unaffected: they
    /// use whichever reset (or the original `starting_balance`) applied
    /// back then, never today's — see `account_balance_as_of`. Safe to
    /// call on every launch: a period that already has a reset for an
    /// account is left alone (`UNIQUE(account_id, period)`).
    ///
    /// Applies uniformly to every account, not just manually-tracked
    /// ones — harmless for an actively-imported account too, since
    /// nothing is deleted. One accepted edge case: a transaction
    /// imported *later* with a date before the most recent reset won't
    /// affect *today's* balance, only past point-in-time lookups — a
    /// known limitation, same spirit as the top-merchants
    /// raw-description grouping documented elsewhere in this file.
    ///
    /// Returns `(account_id, account_name, new_balance)` for every
    /// account that got a *fresh* reset in this call, so the caller can
    /// show a one-time note — empty on every call after the first one
    /// this month.
    pub fn roll_forward_monthly_balances(&self, today: NaiveDate) -> rusqlite::Result<Vec<(i64, String, Decimal)>> {
        let period = format!("{:04}-{:02}", today.year(), today.month());

        let mut stmt = self.conn.prepare("SELECT id, name, starting_balance, account_type FROM accounts")?;
        let accounts: Vec<(i64, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        // The new baseline represents everything through the *end of the
        // prior day*, not "as of this exact moment" — anchoring it to
        // `today` instead would bake in only whatever transactions already
        // existed the instant this ran, then `account_balance_as_of`'s
        // `date > since_date` window would permanently exclude anything
        // dated today added afterward (importing a statement, applying a
        // debt payment, etc. later the same day this rolled), since a
        // same-day transaction can never be both "after today" and "on or
        // before today" at once. Anchoring to yesterday means every
        // transaction dated today counts today, no matter when today it's
        // added, and self-corrects nothing tomorrow that wasn't already
        // correct.
        let reset_date = today.pred_opt().expect("NaiveDate::pred_opt only fails at the calendar's minimum date");

        let mut rolled = Vec::new();
        for (id, name, starting_balance_str, account_type) in accounts {
            let already_done: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM balance_resets WHERE account_id = ?1 AND period = ?2)",
                params![id, period],
                |row| row.get(0),
            )?;
            if already_done {
                continue;
            }

            let starting_balance = Decimal::from_str(&starting_balance_str).expect("starting_balance stored by this crate must be valid");
            let balance = self.account_balance_as_of(id, &account_type, starting_balance, reset_date)?;

            let before = self.displayed_balance_for_log(id);
            self.conn.execute(
                "INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?1, ?2, ?3, ?4)",
                params![id, period, reset_date.to_string(), balance.to_string()],
            )?;
            let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(id));
            self.log_activity(&format!(
                "{name}: monthly rollover — new baseline {balance} as of {reset_date} — {snapshot}"
            ));
            rolled.push((id, name, balance));
        }
        Ok(rolled)
    }

    /// Sets (or corrects) an account's original starting balance / credit
    /// limit. Once an account has gone through even one monthly rollover
    /// (see `roll_forward_monthly_balances`) — which happens automatically
    /// on the first launch of every month — this value stops affecting
    /// `current_balance` at all, since `account_balance_as_of` always
    /// prefers the latest `balance_resets` checkpoint over it. To correct
    /// a checking/savings/loan account's *current* balance after that
    /// point, use `set_account_balance_override` instead — this method
    /// remains the right one for a credit account's limit (which has no
    /// reset-based equivalent) or for backfilling history before any
    /// transactions exist. An unknown id is a harmless no-op, same
    /// convention as `set_category`.
    pub fn set_account_starting_balance(&self, id: i64, balance: Decimal) -> rusqlite::Result<()> {
        let existing = self
            .conn
            .query_row("SELECT name, starting_balance FROM accounts WHERE id = ?1", params![id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            });
        let before = self.displayed_balance_for_log(id);
        self.conn.execute(
            "UPDATE accounts SET starting_balance = ?1 WHERE id = ?2",
            params![balance.to_string(), id],
        )?;
        if let Ok((name, old_balance)) = existing {
            // A starting balance stops affecting `current_balance` at all
            // once a later `balance_resets` checkpoint exists (see this
            // method's own doc comment) — the balance snapshot makes that
            // visible instead of implying every correction here actually
            // moves the account.
            let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(id));
            self.log_activity(&format!("{name}: starting balance corrected: {old_balance} -> {balance} — {snapshot}"));
        }
        Ok(())
    }

    /// Corrects an account's *current* balance without touching any
    /// existing transaction — inserts a `balance_resets` checkpoint,
    /// exactly like `roll_forward_monthly_balances` does once a month,
    /// just triggered on demand instead. `account_balance_as_of` then uses
    /// this value as the new baseline for every date on or after `as_of`,
    /// while every earlier "balance as of" lookup (sparklines, trends,
    /// past net worth) is untouched.
    ///
    /// `balance` is treated as authoritative for right now: calling this
    /// makes `current_balance` equal `balance` *immediately*, no matter
    /// what's already recorded dated `as_of`. Only a transaction
    /// added *after* this call (any date from here on, including later
    /// the same day) moves it further — that's the whole point of a
    /// manual correction, and a user typing "$20,000" who then sees some
    /// other number because of a transaction they forgot was already
    /// there is exactly the confusing, unfriendly behavior this method
    /// exists to avoid.
    ///
    /// The checkpoint itself is stored dated the day *before* `as_of`, not
    /// `as_of` itself — same trick as `roll_forward_monthly_balances` (see
    /// its own comment): a transaction dated `as_of` must still count on
    /// top of this correction, whether it's added a second before this
    /// call or added a year later. Storing the checkpoint on `as_of`
    /// itself would make `account_balance_as_of`'s `date > since_date`
    /// filter permanently exclude anything dated `as_of` added afterward,
    /// since a same-day transaction can never be both "after `as_of`" and
    /// "on or before `as_of`" at once. But that means any transaction
    /// *already* dated `as_of` at the moment this is called would
    /// otherwise be summed a second time on top of `balance` (once
    /// implicitly, since the user is looking at a total that already
    /// includes it; once explicitly, by `account_balance_as_of` itself) —
    /// so the checkpoint's stored value nets those back out up front:
    /// `balance` minus whatever's already posted `as_of`, so the two
    /// cancel out to exactly `balance` and only genuinely new activity
    /// moves it from there.
    ///
    /// Uses its own `period` key (`"manual:<as_of>"`) so it can never
    /// collide with — or silently overwrite — that month's automatic
    /// rollover row; calling this again for the same `as_of` date replaces
    /// the earlier correction instead of stacking a second one. An unknown
    /// id is a harmless no-op, same convention as `set_account_starting_balance`.
    pub fn set_account_balance_override(&self, id: i64, balance: Decimal, as_of: NaiveDate) -> rusqlite::Result<()> {
        let account_type: String = match self
            .conn
            .query_row("SELECT account_type FROM accounts WHERE id = ?1", params![id], |row| row.get(0))
        {
            Ok(account_type) => account_type,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };

        let mut stmt = self
            .conn
            .prepare("SELECT COALESCE(principal_amount, amount) FROM transactions WHERE account_id = ?1 AND date = ?2 AND deleted_at IS NULL")?;
        let already_posted_today: Vec<String> = stmt
            .query_map(params![id, as_of.to_string()], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        let already_posted_today: Decimal = already_posted_today
            .iter()
            .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
            .sum();
        // Mirrors account_balance_as_of's group-aware direction: a loan's
        // current_balance is netted by subtracting transactions, so
        // undoing today's already-posted ones ahead of that subtraction
        // means adding them back here instead of subtracting.
        let checkpoint_balance = if account_type == "loan" {
            balance + already_posted_today
        } else {
            balance - already_posted_today
        };

        let period = format!("manual:{as_of}");
        let reset_date = as_of.pred_opt().expect("NaiveDate::pred_opt only fails at the calendar's minimum date");
        let before = self.displayed_balance_for_log(id);
        self.conn.execute(
            "INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(account_id, period) DO UPDATE SET reset_date = excluded.reset_date, balance = excluded.balance",
            params![id, period, reset_date.to_string(), checkpoint_balance.to_string()],
        )?;
        // The snapshot reflects *today's* resulting number, which can
        // differ from `balance` itself when `as_of` is backdated (any
        // transaction already posted between `as_of` and today keeps
        // counting on top of this correction — see this method's own doc
        // comment).
        let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(id));
        self.log_activity(&format!(
            "{}: balance manually corrected to {balance} as of {as_of} — {snapshot}",
            self.account_name_for_log(id)
        ));
        Ok(())
    }

    /// Sets an account's institution name and masked account number — both
    /// purely cosmetic (e.g. "Chase" / "4821"), either can be `None`.
    pub fn set_account_details(&self, id: i64, institution: Option<&str>, mask: Option<&str>) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE accounts SET institution = ?1, mask = ?2 WHERE id = ?3",
            params![institution, mask, id],
        )?;
        Ok(())
    }

    /// Sets (or clears, with `None`) an account's explicit icon override —
    /// same "not validated at this layer" convention as
    /// `Store::create_bucket`'s `icon_key`; the frontend only ever offers a
    /// fixed set of keys.
    pub fn set_account_icon(&self, id: i64, icon_key: Option<&str>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE accounts SET icon_key = ?1 WHERE id = ?2", params![icon_key, id])?;
        Ok(())
    }

    /// Sets (or clears, with `None`) an account's annual interest rate —
    /// used only by `debt_payoff_projection`, meaningless for a non-debt
    /// account type but not restricted to one, same "don't over-validate"
    /// convention as the rest of this crate.
    pub fn set_account_interest_rate(&self, id: i64, rate: Option<Decimal>) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE accounts SET interest_rate = ?1 WHERE id = ?2",
            params![rate.map(|r| r.to_string()), id],
        )?;
        Ok(())
    }

    /// Opts a debt account in or out of `debt_payoff_projection` (see
    /// `StoredAccount::excluded_from_debt_payoff`) without deleting it.
    pub fn set_account_excluded_from_debt_payoff(&self, id: i64, excluded: bool) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE accounts SET excluded_from_debt_payoff = ?1 WHERE id = ?2", params![excluded, id])?;
        Ok(())
    }

    /// Sets (or clears, with `None`) which family member owns an account —
    /// purely an attribution label (see `FamilyMember`), doesn't affect any
    /// balance calculation. `save_transactions`/`apply_debt_payment` use
    /// this as the default a new transaction on this account inherits.
    pub fn set_account_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE accounts SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// Corrects an account's type after the fact (created as the wrong
    /// kind by mistake). An unknown id is a harmless no-op, same
    /// convention as everything else here.
    pub fn update_account_type(&self, id: i64, account_type: AccountType) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE accounts SET account_type = ?1 WHERE id = ?2", params![account_type.as_str(), id])?;
        Ok(())
    }

    /// Deletes an account and every one of its transactions — an account
    /// can't be left behind with `transactions.account_id NOT NULL`
    /// pointing at nothing, so this cascades explicitly rather than
    /// erroring or orphaning rows (same reasoning as `delete_bucket`
    /// cascading its contributions).
    ///
    /// Each transaction goes through `hard_delete_transaction_row` — a real
    /// `DELETE`, deliberately *not* `delete_transaction`'s soft-delete —
    /// since foreign keys are enforced on this connection (`transactions
    /// .account_id ... REFERENCES accounts(id)`) and a soft-deleted row
    /// still physically exists and still points at this account, which
    /// would trip that constraint the moment the `DELETE FROM accounts`
    /// below runs. There's no "undo delete account" feature that would
    /// ever need these back, unlike the Transactions tab's bulk-delete "Undo," so
    /// there's nothing lost by not going through the soft-delete path
    /// here. Holdings and balance-reset snapshots for this account are
    /// swept the same way. A recurring item pointing here just loses the
    /// link (falls back to "no linked account") rather than being deleted
    /// itself, since it doesn't stop existing just because the account
    /// that used to pay it did. Returns how many transactions were
    /// removed, for the confirm dialog's copy. An unknown id is a
    /// harmless no-op.
    pub fn delete_account(&self, id: i64) -> rusqlite::Result<usize> {
        let mut stmt = self.conn.prepare("SELECT id FROM transactions WHERE account_id = ?1")?;
        let tx_ids: Vec<i64> = stmt.query_map(params![id], |row| row.get(0))?.collect::<rusqlite::Result<_>>()?;
        drop(stmt);
        for tx_id in &tx_ids {
            self.hard_delete_transaction_row(*tx_id)?;
        }

        self.conn
            .execute("UPDATE recurring SET account_id = NULL WHERE account_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM holdings WHERE account_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM balance_resets WHERE account_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
        Ok(tx_ids.len())
    }

    /// Creates a new family member — a household member other data
    /// (accounts, transactions, recurring items, buckets, assets) can be
    /// attributed to. Errors (a `UNIQUE` constraint violation) if a member
    /// with that name already exists, same "a duplicate name is a mistake
    /// to surface" convention as `create_bucket`.
    pub fn create_family_member(&self, name: &str) -> rusqlite::Result<i64> {
        self.conn.execute("INSERT INTO family_members (name) VALUES (?1)", params![name])?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Every family member, alphabetical by name.
    pub fn list_family_members(&self) -> rusqlite::Result<Vec<FamilyMember>> {
        let mut stmt = self.conn.prepare("SELECT id, name FROM family_members ORDER BY name")?;
        let rows = stmt.query_map([], |row| {
            Ok(FamilyMember {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Renames a family member. An unknown id is a harmless no-op, same
    /// convention as `update_account_type` and friends.
    pub fn rename_family_member(&self, id: i64, new_name: &str) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE family_members SET name = ?1 WHERE id = ?2", params![new_name, id])?;
        Ok(())
    }

    /// Removes a family member. A member is an attribution label, not a
    /// data container — unlike `delete_account`, this never touches the
    /// financial rows it was attached to, only clears the label on every
    /// table that can carry one, so nothing is left pointing at a
    /// now-deleted member. An unknown id is a harmless no-op.
    pub fn delete_family_member(&self, id: i64) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE accounts SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn
            .execute("UPDATE transactions SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn
            .execute("UPDATE recurring SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn
            .execute("UPDATE buckets SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn
            .execute("UPDATE assets SET member_id = NULL WHERE member_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM family_members WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Persists a learned rule (see `learner::learn_from_correction`) so it
    /// survives past this run. Upserts by pattern, same as `RuleSet::upsert`.
    pub fn upsert_rule(&self, pattern: &str, category: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO rules (pattern, category) VALUES (?1, ?2)
             ON CONFLICT(pattern) DO UPDATE SET category = excluded.category",
            params![pattern, category],
        )?;
        Ok(())
    }

    /// Every rule persisted so far, as a ready-to-use `RuleSet`. Empty on a
    /// fresh store — callers fall back to `RuleSet::seeded()` themselves.
    pub fn load_rules(&self) -> rusqlite::Result<RuleSet> {
        let mut stmt = self.conn.prepare("SELECT pattern, category FROM rules")?;
        let rows = stmt.query_map([], |row| Ok(Rule::new(row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;

        let mut rules = Vec::new();
        for row in rows {
            rules.push(row?);
        }
        Ok(RuleSet::new(rules))
    }

    /// Persists the built-in starter rules (`RuleSet::seeded`) the first
    /// time it's called on a database that has none, then never again.
    ///
    /// The starter set used to live only in memory, as a fallback for an
    /// *empty* rules table — so the moment a user's first correction saved
    /// one learned rule, the starters silently vanished on the next launch.
    /// Persisting them makes every rule visible and deletable in the rules
    /// manager, and the one-time flag (`app_settings.default_rules_seeded`)
    /// is what lets "delete every rule" actually stick instead of
    /// re-seeding an empty table each launch. A database that already has
    /// rules gets the flag set without any defaults added — it's had its
    /// own history with them. Returns whether defaults were inserted.
    pub fn seed_default_rules_once(&self) -> rusqlite::Result<bool> {
        let already_seeded: bool = self
            .conn
            .query_row("SELECT default_rules_seeded FROM app_settings WHERE id = 1", [], |row| row.get(0))
            .unwrap_or(false);
        if already_seeded {
            return Ok(false);
        }

        let has_rules: bool = self.conn.query_row("SELECT EXISTS(SELECT 1 FROM rules)", [], |row| row.get(0))?;
        let mut inserted = false;
        if !has_rules {
            for rule in RuleSet::seeded().rules() {
                self.upsert_rule(&rule.pattern, &rule.category)?;
            }
            inserted = true;
        }
        self.conn.execute(
            "INSERT INTO app_settings (id, default_rules_seeded) VALUES (1, 1)
             ON CONFLICT(id) DO UPDATE SET default_rules_seeded = 1",
            [],
        )?;
        Ok(inserted)
    }

    /// Descriptions of every live transaction, lowercased — what a rule's
    /// pattern is matched against. Excludes `apply_debt_payment`'s generated
    /// transactions, same as `all_transactions`.
    fn live_descriptions_lowercased(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT description FROM transactions
             WHERE deleted_at IS NULL AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?.to_lowercase());
        }
        Ok(result)
    }

    /// Every persisted rule with how many transactions its pattern matches,
    /// grouped by category (then pattern) — the rules manager's list.
    pub fn list_rules(&self) -> rusqlite::Result<Vec<StoredRule>> {
        let rules = self.load_rules()?;
        let descriptions = self.live_descriptions_lowercased()?;
        let mut result: Vec<StoredRule> = rules
            .rules()
            .iter()
            .map(|rule| {
                let needle = rule.pattern.trim().to_lowercase();
                let match_count = if needle.is_empty() {
                    0
                } else {
                    descriptions.iter().filter(|d| d.contains(&needle)).count()
                };
                StoredRule {
                    pattern: rule.pattern.clone(),
                    category: rule.category.clone(),
                    match_count,
                }
            })
            .collect();
        result.sort_by(|a, b| {
            a.category
                .to_lowercase()
                .cmp(&b.category.to_lowercase())
                .then_with(|| a.pattern.to_lowercase().cmp(&b.pattern.to_lowercase()))
        });
        Ok(result)
    }

    /// Removes a rule. Never touches a transaction it already categorized —
    /// deleting a rule only stops it applying from now on. An unknown
    /// pattern is a harmless no-op.
    pub fn delete_rule(&self, pattern: &str) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM rules WHERE pattern = ?1", params![pattern])?;
        Ok(())
    }

    /// Edits a rule in place: drops `old_pattern` and saves `new_pattern` →
    /// `category` (which may be the same pattern with a different category,
    /// or a reworded pattern).
    pub fn rename_rule(&self, old_pattern: &str, new_pattern: &str, category: &str) -> rusqlite::Result<()> {
        self.delete_rule(old_pattern)?;
        self.upsert_rule(new_pattern, category)
    }

    /// The transactions saving `pattern` → `category` would re-categorize,
    /// and how many the pattern touches at all. `replacing` names an
    /// existing rule the new one is standing in for (an edit), so a
    /// longer old pattern can't shadow the edited one in the preview.
    ///
    /// A transaction is only changed if the rule would genuinely own it
    /// (longest matching pattern wins, exactly as at import time) and it
    /// isn't one the user categorized by hand, a split purchase, or already
    /// in the target category.
    fn rule_candidates(&self, pattern: &str, category: &str, replacing: Option<&str>) -> rusqlite::Result<(usize, Vec<i64>)> {
        let pattern = pattern.trim();
        if pattern.is_empty() {
            return Ok((0, Vec::new()));
        }

        let mut rules = RuleSet::new(
            self.load_rules()?
                .rules()
                .iter()
                .filter(|r| replacing.is_none_or(|old| !r.pattern.eq_ignore_ascii_case(old)))
                .cloned()
                .collect(),
        );
        rules.upsert(pattern, category);
        let needle = pattern.to_lowercase();

        let split_parents: std::collections::HashSet<i64> = {
            let mut stmt = self.conn.prepare("SELECT DISTINCT transaction_id FROM transaction_splits")?;
            let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };

        let mut stmt = self.conn.prepare(
            "SELECT id, description, category, category_source FROM transactions
             WHERE deleted_at IS NULL AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;

        let mut matching = 0;
        let mut ids = Vec::new();
        for row in rows {
            let (id, description, current_category, source) = row?;
            if !description.to_lowercase().contains(&needle) {
                continue;
            }
            matching += 1;
            if source.as_deref() == Some("user") || split_parents.contains(&id) {
                continue;
            }
            if current_category.as_deref() == Some(category) {
                continue;
            }
            let owned_by_this_rule = rules
                .best_match(&description)
                .is_some_and(|winner| winner.pattern.eq_ignore_ascii_case(pattern));
            if owned_by_this_rule {
                ids.push(id);
            }
        }
        Ok((matching, ids))
    }

    /// See `rule_candidates` — the read-only "here's what saving this would
    /// do" the rules manager shows before you commit.
    pub fn preview_rule(&self, pattern: &str, category: &str, replacing: Option<&str>) -> rusqlite::Result<RulePreview> {
        let (matching, ids) = self.rule_candidates(pattern, category, replacing)?;
        Ok(RulePreview {
            matching,
            would_change: ids.len(),
        })
    }

    /// Re-categorizes exactly the transactions `preview_rule` counts, as
    /// rule-sourced (so a later user correction still outranks it). Returns
    /// how many changed.
    pub fn apply_rule_to_existing(&self, pattern: &str, category: &str) -> rusqlite::Result<usize> {
        let (_, ids) = self.rule_candidates(pattern, category, None)?;
        for id in &ids {
            self.set_category(*id, category, CategorySource::Rule, None)?;
        }
        Ok(ids.len())
    }

    /// Links two transactions as the two legs of one transfer between the
    /// user's own accounts, so neither counts as income or spending (see
    /// `LIVE_TRANSFER_LEG_IDS_SQL`). The ids can come in either order — the
    /// negative one is recorded as the outgoing leg.
    ///
    /// Returns `false` (and links nothing) when the pair can't be a
    /// transfer: either transaction is missing or deleted, they're in the
    /// same account, they don't go in opposite directions, or either is
    /// already half of another link. Amounts are *not* required to match —
    /// a transfer with a fee legitimately leaves the legs a few dollars
    /// apart; `transfer_candidates` only *suggests* exact matches.
    pub fn link_transfer(&self, a: i64, b: i64) -> rusqlite::Result<bool> {
        let leg = |id: i64| -> rusqlite::Result<Option<(i64, Decimal)>> {
            match self.conn.query_row(
                "SELECT account_id, amount FROM transactions WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            ) {
                Ok((account_id, amount)) => Ok(Some((
                    account_id,
                    Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
                ))),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(e),
            }
        };
        let (Some((account_a, amount_a)), Some((account_b, amount_b))) = (leg(a)?, leg(b)?) else {
            return Ok(false);
        };
        if a == b || account_a == account_b {
            return Ok(false);
        }
        let (out_id, in_id) = match (
            amount_a < Decimal::ZERO,
            amount_b < Decimal::ZERO,
            amount_a > Decimal::ZERO,
            amount_b > Decimal::ZERO,
        ) {
            (true, _, _, true) => (a, b),
            (_, true, true, _) => (b, a),
            _ => return Ok(false),
        };
        let already_linked: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM transfer_links
                           WHERE out_transaction_id IN (?1, ?2) OR in_transaction_id IN (?1, ?2))",
            params![out_id, in_id],
            |row| row.get(0),
        )?;
        if already_linked {
            return Ok(false);
        }
        self.conn.execute(
            "INSERT INTO transfer_links (out_transaction_id, in_transaction_id) VALUES (?1, ?2)",
            params![out_id, in_id],
        )?;
        Ok(true)
    }

    /// Removes the link a transaction is part of, from either leg. A no-op
    /// when it isn't linked. The transactions themselves are untouched —
    /// they simply count as ordinary income/spending again.
    pub fn unlink_transfer(&self, transaction_id: i64) -> rusqlite::Result<()> {
        self.conn.execute(
            "DELETE FROM transfer_links WHERE out_transaction_id = ?1 OR in_transaction_id = ?1",
            params![transaction_id],
        )?;
        Ok(())
    }

    /// Unlinked pairs that look like the two legs of one transfer: opposite
    /// signs, exactly equal amounts, different accounts, dated within 3 days
    /// of each other. Each transaction appears in at most one suggestion —
    /// candidate pairs are taken closest-date-first (then by id), so when a
    /// $500 out could match two $500 ins, the nearer one wins. Never
    /// includes `apply_debt_payment`'s generated bookkeeping rows or deleted
    /// transactions.
    pub fn transfer_candidates(&self) -> rusqlite::Result<Vec<TransferCandidate>> {
        struct Leg {
            id: i64,
            account_id: i64,
            date: NaiveDate,
            amount: Decimal,
        }
        let mut stmt = self.conn.prepare(
            "SELECT id, account_id, date, amount FROM transactions
             WHERE deleted_at IS NULL
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND id NOT IN (SELECT out_transaction_id FROM transfer_links)
                   AND id NOT IN (SELECT in_transaction_id FROM transfer_links)
             ORDER BY id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        let mut outs = Vec::new();
        let mut ins = Vec::new();
        for row in rows {
            let (id, account_id, date, amount) = row?;
            let leg = Leg {
                id,
                account_id,
                date: NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                amount: Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
            };
            if leg.amount < Decimal::ZERO {
                outs.push(leg);
            } else if leg.amount > Decimal::ZERO {
                ins.push(leg);
            }
        }

        // Bucket the incoming legs by amount so each outgoing leg only looks at
        // same-amount candidates — comparing every out against every in is
        // quadratic, which is seconds of work on a few thousand transactions.
        // Keyed by the normalized decimal string so "500.0" and "500.00" meet.
        let mut ins_by_amount: std::collections::HashMap<String, Vec<&Leg>> = std::collections::HashMap::new();
        for inn in &ins {
            ins_by_amount.entry(inn.amount.normalize().to_string()).or_default().push(inn);
        }

        let mut pairs: Vec<(i64, i64, i64)> = Vec::new(); // (days apart, out id, in id)
        for out in &outs {
            let Some(same_amount) = ins_by_amount.get(&out.amount.abs().normalize().to_string()) else {
                continue;
            };
            for inn in same_amount {
                if out.account_id == inn.account_id {
                    continue;
                }
                let days = (out.date - inn.date).num_days().abs();
                if days <= 3 {
                    pairs.push((days, out.id, inn.id));
                }
            }
        }
        pairs.sort();

        let mut used = std::collections::HashSet::new();
        let mut result = Vec::new();
        for (_, out_id, in_id) in pairs {
            if used.contains(&out_id) || used.contains(&in_id) {
                continue;
            }
            used.insert(out_id);
            used.insert(in_id);
            result.push(TransferCandidate { out_id, in_id });
        }
        result.sort_by_key(|c| c.out_id);
        Ok(result)
    }

    /// (description, category) for every transaction categorized by a rule
    /// or confirmed by the user — the training corpus for
    /// `Classifier::train`. Deliberately excludes the classifier's own past
    /// guesses: training the next classifier on an earlier unconfident
    /// guess would let it reinforce itself indefinitely across imports,
    /// since nothing distinguishes a self-generated guess from real ground
    /// truth once it's sitting in the table with a category.
    pub fn labeled_history(&self) -> rusqlite::Result<Vec<(String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT description, category FROM transactions
             WHERE category IS NOT NULL AND category_source IN ('rule', 'user') AND deleted_at IS NULL",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Records a category for a transaction — either a rule/classifier guess
    /// or a user's manual correction. `confidence` should be `None` for
    /// anything but a classifier guess, since a rule match and a user
    /// correction are both deterministic rather than a probability.
    /// Correcting an id that doesn't exist is a harmless no-op rather than
    /// an error.
    pub fn set_category(&self, id: i64, category: &str, source: CategorySource, confidence: Option<f64>) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE transactions SET category = ?1, category_source = ?2, confidence = ?3 WHERE id = ?4",
            params![category, source.as_str(), confidence, id],
        )?;
        // a brand-new category typed for one transaction must be immediately
        // selectable for every other one, not just the row it was first used on
        self.conn
            .execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![category])?;
        Ok(())
    }

    /// Registers a category so it's selectable even before any transaction
    /// or budget uses it. A name that already exists is a harmless no-op —
    /// except for `icon_key`: a `Some` choice is applied whether the row is
    /// brand new or already existed (so picking an icon in the "new
    /// category" dialog works even though the category itself might already
    /// be registered from an earlier transaction/budget), but `None` never
    /// clears an icon an existing row already has — this call just means
    /// "make sure this category exists," not "reset its icon."
    pub fn create_category(&self, name: &str, icon_key: Option<&str>) -> rusqlite::Result<()> {
        self.conn.execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![name])?;
        if let Some(icon_key) = icon_key {
            self.conn
                .execute("UPDATE categories SET icon_key = ?1 WHERE name = ?2", params![icon_key, name])?;
        }
        Ok(())
    }

    /// Every registered category, sorted — the standard suggestions plus
    /// anything created, budgeted, or assigned to a transaction, whether or
    /// not it's currently in use by anything.
    pub fn list_categories(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT name FROM categories ORDER BY name")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Same as `list_categories`, but with each category's explicit icon
    /// override alongside its name — kept separate from `list_categories`
    /// rather than changing that one's return type, since most of its
    /// callers (autocomplete, category-picker dropdowns) only ever need the
    /// name.
    pub fn list_categories_with_icons(&self) -> rusqlite::Result<Vec<StoredCategory>> {
        let mut stmt = self.conn.prepare("SELECT name, icon_key FROM categories ORDER BY name")?;
        let rows = stmt.query_map([], |row| {
            Ok(StoredCategory {
                name: row.get::<_, String>(0)?,
                icon_key: row.get::<_, Option<String>>(1)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Sets (or clears, with `None`) an existing category's icon override —
    /// unconditional, unlike `create_category`'s `icon_key`, since this is
    /// specifically "change this category's icon," including back to "keep
    /// guessing from the name."
    pub fn set_category_icon(&self, name: &str, icon_key: Option<&str>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE categories SET icon_key = ?1 WHERE name = ?2", params![icon_key, name])?;
        Ok(())
    }

    /// Renames every transaction and rule filed under `old` to `new`, and
    /// the category registry entry itself. If `new` already has
    /// transactions of its own, this is how a merge happens — same
    /// operation, no special-casing needed. Returns how many transaction
    /// rows were affected.
    ///
    /// Every budget line follows the rename too, month by month — but
    /// `budgets`' key is `(category, period)`, so if `new` already has
    /// its own line for a given month, `old`'s can't just overwrite it;
    /// the existing target's line wins for that month (same "the thing
    /// you're merging into wins" rule as everywhere else here) and
    /// `old`'s line is dropped instead of silently orphaned.
    ///
    /// `old`'s icon (see `set_category_icon`) carries over to `new` the
    /// same way — but only if `new` doesn't already have one of its own:
    /// renaming into an existing category is a merge, and the thing being
    /// merged into keeps its own icon rather than having it silently
    /// overwritten. Read before `old`'s row is deleted below, since that
    /// delete would otherwise take the icon down with it.
    pub fn rename_category(&self, old: &str, new: &str) -> rusqlite::Result<usize> {
        let old_icon_key: Option<String> = match self
            .conn
            .query_row("SELECT icon_key FROM categories WHERE name = ?1", params![old], |row| row.get(0))
        {
            Ok(icon_key) => icon_key,
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };

        let affected = self
            .conn
            .execute("UPDATE transactions SET category = ?1 WHERE category = ?2", params![new, old])?;
        self.conn
            .execute("UPDATE transaction_splits SET category = ?1 WHERE category = ?2", params![new, old])?;
        self.conn
            .execute("UPDATE rules SET category = ?1 WHERE category = ?2", params![new, old])?;
        self.conn.execute(
            "UPDATE budgets SET category = ?1
             WHERE category = ?2 AND NOT EXISTS (
                 SELECT 1 FROM budgets b2 WHERE b2.category = ?1 AND b2.period = budgets.period
             )",
            params![new, old],
        )?;
        self.conn.execute("DELETE FROM budgets WHERE category = ?1", params![old])?;
        self.conn.execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![new])?;
        if let Some(icon_key) = old_icon_key {
            self.conn.execute(
                "UPDATE categories SET icon_key = ?1 WHERE name = ?2 AND icon_key IS NULL",
                params![icon_key, new],
            )?;
        }
        self.conn.execute("DELETE FROM categories WHERE name = ?1", params![old])?;
        Ok(affected)
    }

    /// Resets every transaction filed under `name` back to uncategorized,
    /// removes any rule or budget line that points at it, and removes it
    /// from the category registry — otherwise a leftover rule would
    /// silently recreate the "deleted" category on the next import, or it
    /// would still show up as a suggestion. Returns how many transactions
    /// were reset.
    pub fn delete_category(&self, name: &str) -> rusqlite::Result<usize> {
        let affected = self.conn.execute(
            "UPDATE transactions SET category = NULL, category_source = NULL, confidence = NULL WHERE category = ?1",
            params![name],
        )?;
        self.conn
            .execute("UPDATE transaction_splits SET category = NULL WHERE category = ?1", params![name])?;
        self.conn.execute("DELETE FROM rules WHERE category = ?1", params![name])?;
        self.conn.execute("DELETE FROM budgets WHERE category = ?1", params![name])?;
        self.conn.execute("DELETE FROM categories WHERE name = ?1", params![name])?;
        Ok(affected)
    }

    /// Whether each of `txns` already exists in this account (by
    /// fingerprint) — a pure read, no writes. `result[i]` corresponds to
    /// `txns[i]`. Callers use this to show the user what's about to be
    /// skipped and let them override it, rather than having dedup decided
    /// for them silently.
    pub fn check_duplicates(&self, account_id: i64, txns: &[Transaction]) -> rusqlite::Result<Vec<bool>> {
        let mut result = Vec::with_capacity(txns.len());
        for tx in txns {
            let exists: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM transactions WHERE account_id = ?1 AND fingerprint = ?2 AND deleted_at IS NULL)",
                params![account_id, fingerprint(account_id, tx)],
                |row| row.get(0),
            )?;
            result.push(exists);
        }
        Ok(result)
    }

    /// Inserts every transaction given, unconditionally. Duplicate handling
    /// is entirely the caller's responsibility (see `check_duplicates`) —
    /// this used to skip anything matching an existing fingerprint, but
    /// that made it impossible to honor a user's explicit "keep it anyway"
    /// on a flagged duplicate.
    pub fn save_transactions(&self, account_id: i64, txns: &[Transaction]) -> rusqlite::Result<SaveReport> {
        let ids = self.save_transactions_with_ids(account_id, txns)?;
        Ok(SaveReport { inserted: ids.len() })
    }

    /// Same insert as `save_transactions`, but also returns each row's new
    /// id, in the same order — import needs this to attach tags to the
    /// exact row they belong to right after insert. A separate method
    /// (rather than changing `SaveReport`'s shape) so `save_transactions`'
    /// many existing callers, which only care about the count, are
    /// untouched.
    pub fn save_transactions_with_ids(&self, account_id: i64, txns: &[Transaction]) -> rusqlite::Result<Vec<i64>> {
        let mut ids = Vec::with_capacity(txns.len());
        // The running-balance snapshot chain below (see
        // `displayed_balance_for_log`'s doc comment: "one per row — each
        // row's after is the next row's before") costs one full
        // `account_balance_as_of` scan of this account's transactions per
        // row inserted. For a big import into an account that already has
        // many rows, paying that on every single row made the whole import
        // cost grow *quadratically* with the account's transaction count —
        // a real bottleneck for the exact "large ledger" scenario this
        // exists to support, and entirely wasted work whenever there's no
        // log to write it to, which is every release build (`log_activity`
        // discards it unread when `activity_log_path` is `None` — see
        // `Store::open`). Skipped altogether in that case; only debug
        // builds (and tests that set an activity log path) pay for it.
        let logging = self.activity_log_path.is_some();
        let account_name = if logging { self.account_name_for_log(account_id) } else { String::new() };
        let mut previous_snapshot = if logging { self.displayed_balance_for_log(account_id) } else { None };
        for tx in txns {
            self.conn.execute(
                "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint, member_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT member_id FROM accounts WHERE id = ?1))",
                params![
                    account_id,
                    tx.date.to_string(),
                    tx.description,
                    tx.amount.to_string(),
                    tx.category,
                    fingerprint(account_id, tx),
                ],
            )?;
            ids.push(self.conn.last_insert_rowid());
            // A file import (or a backup restore) can carry its own
            // category straight from the source — a bank's CSV export
            // column, say — never going through `set_category`/
            // `create_category`. Register it here too, the same "must be
            // immediately selectable everywhere, not just on this row"
            // guarantee `set_category` already gives a categorizer/manual
            // correction, so it doesn't take an app restart (and the
            // `backfill_categories_from_usage` launch backfill) to show up
            // in "All categories"/Manage categories.
            if let Some(category) = &tx.category {
                self.conn
                    .execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![category])?;
            }
            if logging {
                let after_snapshot = self.displayed_balance_for_log(account_id);
                let snapshot = Self::describe_balance_snapshot(previous_snapshot, after_snapshot);
                previous_snapshot = after_snapshot;
                self.log_activity(&format!(
                    "{account_name}: transaction added — \"{}\" {} amount={} — {snapshot}",
                    tx.description, tx.date, tx.amount
                ));
            }
        }
        Ok(ids)
    }

    /// One manually-entered transaction (the Transactions tab's "Add transaction…"
    /// form, as opposed to a file import) — reuses `save_transactions`'
    /// own insert path outright, so fingerprinting and the account's
    /// default-member assignment stay identical to an imported row, and
    /// returns the new row's id, matching every other single-entity
    /// creation method in this app (`create_holding`, `create_bucket`, ...).
    pub fn create_transaction(&self, account_id: i64, tx: &Transaction) -> rusqlite::Result<i64> {
        self.save_transactions(account_id, std::slice::from_ref(tx))?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Every transaction, except the synthetic ones `apply_debt_payment`
    /// generates on a debt account — those exist purely so that account's
    /// balance moves (see `account_balance_as_of`), not as something the
    /// user ever added themselves, so surfacing one as its own Transactions row
    /// would double it: the real payment already appears as the *source*
    /// transaction (which carries the "→ account (amount)" badge instead),
    /// and the generated one is just its balance-side bookkeeping twin.
    pub fn all_transactions(&self) -> rusqlite::Result<Vec<StoredTransaction>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.date, t.description, t.amount, t.category, t.category_source,
                    t.confidence, t.account_id, a.name,
                    dp.debt_account_id, da.name, dp.amount,
                    (SELECT COUNT(*) FROM transaction_splits ts WHERE ts.transaction_id = t.id),
                    GROUP_CONCAT(tt.tag, char(31)),
                    t.member_id, fm.name, t.principal_amount,
                    COALESCE(
                        (SELECT l.in_transaction_id FROM transfer_links l
                         JOIN transactions o ON o.id = l.in_transaction_id
                         WHERE l.out_transaction_id = t.id AND o.deleted_at IS NULL),
                        (SELECT l.out_transaction_id FROM transfer_links l
                         JOIN transactions o ON o.id = l.out_transaction_id
                         WHERE l.in_transaction_id = t.id AND o.deleted_at IS NULL)
                    )
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             LEFT JOIN debt_payments dp ON dp.source_transaction_id = t.id
             LEFT JOIN accounts da ON da.id = dp.debt_account_id
             LEFT JOIN transaction_tags tt ON tt.transaction_id = t.id
             LEFT JOIN family_members fm ON fm.id = t.member_id
             WHERE t.id NOT IN (SELECT generated_transaction_id FROM debt_payments) AND t.deleted_at IS NULL
             GROUP BY t.id
             ORDER BY t.id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<f64>>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, i64>(12)?,
                row.get::<_, Option<String>>(13)?,
                row.get::<_, Option<i64>>(14)?,
                row.get::<_, Option<String>>(15)?,
                row.get::<_, Option<String>>(16)?,
                row.get::<_, Option<i64>>(17)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (
                id,
                date_str,
                description,
                amount_str,
                category,
                category_source,
                confidence,
                account_id,
                account_name,
                debt_account_id,
                debt_account_name,
                applied_amount_str,
                split_count,
                tags_str,
                member_id,
                member_name,
                principal_amount_str,
                transfer_counterpart_id,
            ) = row?;
            let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            let applied_to_debt = match (debt_account_id, debt_account_name, applied_amount_str) {
                (Some(debt_account_id), Some(debt_account_name), Some(applied_amount_str)) => Some(AppliedDebtPayment {
                    debt_account_id,
                    debt_account_name,
                    amount: Decimal::from_str(&applied_amount_str).expect("amount stored by this crate must be valid"),
                }),
                _ => None,
            };
            let tags = tags_str.map(|s| s.split('\u{1f}').map(str::to_string).collect()).unwrap_or_default();
            let principal_amount = principal_amount_str.map(|s| Decimal::from_str(&s).expect("amount stored by this crate must be valid"));
            result.push(StoredTransaction {
                id,
                transfer_counterpart_id,
                transaction: Transaction {
                    date,
                    description,
                    amount,
                    category,
                },
                category_source: category_source.and_then(|s| CategorySource::parse(&s)),
                confidence,
                account_id,
                account_name,
                applied_to_debt,
                principal_amount,
                split_count,
                tags,
                member_id,
                member_name,
            });
        }
        Ok(result)
    }

    /// Corrects a transaction's amount after the fact (a wrong sign or a
    /// misread value shouldn't require re-importing the whole file). The
    /// fingerprint is recomputed so dedup keeps keying off the corrected
    /// value. An unknown id is a harmless no-op, matching `set_category`.
    /// Returns whether this transaction's split breakdown (see
    /// `set_transaction_splits`) was reconciled as a side effect. A split
    /// is a breakdown of *this* transaction's amount — nothing keeps it in
    /// sync if the amount changes underneath it, so a stale breakdown
    /// would silently disagree with the new total (the transaction
    /// showing one amount, its own splits still summing to the old one).
    /// Reconciling scales every split by the same ratio the total itself
    /// changed by, preserving each one's *relative* share of the
    /// breakdown rather than discarding it — the last split absorbs
    /// whatever a penny of rounding leaves over, so the splits always sum
    /// to exactly the new amount, not just approximately. A breakdown that
    /// summed to zero (no ratio to scale by) splits the new amount evenly
    /// instead, for the same reason.
    pub fn update_transaction_amount(&self, id: i64, amount: Decimal) -> rusqlite::Result<bool> {
        let existing = self.conn.query_row(
            "SELECT account_id, date, description, amount FROM transactions WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        );
        let (account_id, date_str, description, old_amount_str) = match existing {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(false),
            Err(e) => return Err(e),
        };
        let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
        let fp = fingerprint(
            account_id,
            &Transaction {
                date,
                description: description.clone(),
                amount,
                category: None,
            },
        );

        let before = self.displayed_balance_for_log(account_id);
        self.conn.execute(
            "UPDATE transactions SET amount = ?1, fingerprint = ?2 WHERE id = ?3",
            params![amount.to_string(), fp, id],
        )?;

        let splits: Vec<(i64, String)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id, amount FROM transaction_splits WHERE transaction_id = ?1 ORDER BY id")?;
            let rows = stmt.query_map(params![id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut splits_reconciled = false;
        if !splits.is_empty() {
            let old_amounts: Vec<Decimal> = splits
                .iter()
                .map(|(_, a)| Decimal::from_str(a).expect("split amount stored by this crate must be valid"))
                .collect();
            let split_total: Decimal = old_amounts.iter().sum();
            if split_total != amount {
                splits_reconciled = true;
                let last = splits.len() - 1;
                let mut running = Decimal::ZERO;
                for (i, (split_id, _)) in splits.iter().enumerate() {
                    let new_split_amount = if i == last {
                        // Exact by construction: the new total minus every
                        // already-assigned split, whatever rounding those
                        // left over included.
                        amount - running
                    } else if split_total.is_zero() {
                        (amount / Decimal::from(splits.len() as i64)).round_dp(2)
                    } else {
                        (old_amounts[i] * amount / split_total).round_dp(2)
                    };
                    running += new_split_amount;
                    self.conn.execute(
                        "UPDATE transaction_splits SET amount = ?1 WHERE id = ?2",
                        params![new_split_amount.to_string(), split_id],
                    )?;
                }
            }
        }

        // A real before/after snapshot (rather than computing a delta from
        // `amount`) naturally reports no movement for a transaction whose
        // principal override (see `update_transaction_principal_amount`)
        // is still set — correcting `amount` alone doesn't move the
        // balance until that override is cleared, which is exactly the
        // kind of surprise this log exists to surface.
        let after = self.displayed_balance_for_log(account_id);
        let snapshot = Self::describe_balance_snapshot(before, after);
        self.log_activity(&format!(
            "{}: transaction #{id} \"{description}\" amount corrected: {old_amount_str} -> {amount} — {snapshot}{}",
            self.account_name_for_log(account_id),
            if splits_reconciled {
                " (its splits were rescaled to still sum to the new amount)"
            } else {
                ""
            }
        ));
        Ok(splits_reconciled)
    }

    /// Sets (or, with `None`, clears) how much of this transaction counts
    /// toward its own account's balance — for a transaction recorded
    /// directly on a loan account whose full amount bundles principal with
    /// interest/escrow (see `account_balance_as_of`, which reads
    /// `COALESCE(principal_amount, amount)`). Doesn't touch the
    /// fingerprint — unlike `amount`, this isn't part of what identifies a
    /// transaction, so correcting it can't affect dedup. An unknown id is
    /// a harmless no-op, matching `update_transaction_amount`.
    pub fn update_transaction_principal_amount(&self, id: i64, principal_amount: Option<Decimal>) -> rusqlite::Result<()> {
        let existing = self.conn.query_row(
            "SELECT account_id, principal_amount FROM transactions WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        );
        let (account_id, old_principal_str) = match existing {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };

        let before = self.displayed_balance_for_log(account_id);
        self.conn.execute(
            "UPDATE transactions SET principal_amount = ?1 WHERE id = ?2",
            params![principal_amount.map(|a| a.to_string()), id],
        )?;
        let after = self.displayed_balance_for_log(account_id);
        let snapshot = Self::describe_balance_snapshot(before, after);
        let describe = |s: &Option<String>| s.clone().unwrap_or_else(|| "full amount".to_string());
        self.log_activity(&format!(
            "{}: transaction #{id} principal override: {} -> {} — {snapshot}",
            self.account_name_for_log(account_id),
            describe(&old_principal_str),
            describe(&principal_amount.map(|a| a.to_string())),
        ));
        Ok(())
    }

    /// Moves a transaction to a different account after the fact (it was
    /// imported into the wrong one). The fingerprint is recomputed since it
    /// includes `account_id`. An unknown id is a harmless no-op.
    pub fn update_transaction_account(&self, id: i64, account_id: i64) -> rusqlite::Result<()> {
        let existing = self.conn.query_row(
            "SELECT account_id, date, description, amount FROM transactions WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        );
        let (old_account_id, date_str, description, amount_str) = match existing {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };
        let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
        let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
        let fp = fingerprint(
            account_id,
            &Transaction {
                date,
                description: description.clone(),
                amount,
                category: None,
            },
        );

        let before_old = self.displayed_balance_for_log(old_account_id);
        let before_new = self.displayed_balance_for_log(account_id);
        self.conn.execute(
            "UPDATE transactions SET account_id = ?1, fingerprint = ?2 WHERE id = ?3",
            params![account_id, fp, id],
        )?;
        let old_snapshot = Self::describe_balance_snapshot(before_old, self.displayed_balance_for_log(old_account_id));
        let new_snapshot = Self::describe_balance_snapshot(before_new, self.displayed_balance_for_log(account_id));
        self.log_activity(&format!(
            "transaction #{id} \"{description}\" moved: {} ({old_snapshot}) -> {} ({new_snapshot})",
            self.account_name_for_log(old_account_id),
            self.account_name_for_log(account_id)
        ));
        Ok(())
    }

    /// Corrects a transaction's date after the fact (misread a statement,
    /// or it posted a day later than it was actually charged). The
    /// fingerprint is recomputed since it includes the date. An unknown id
    /// is a harmless no-op, same convention as `update_transaction_amount`.
    pub fn update_transaction_date(&self, id: i64, date: NaiveDate) -> rusqlite::Result<()> {
        let existing = self.conn.query_row(
            "SELECT account_id, description, amount FROM transactions WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
        );
        let (account_id, description, amount_str) = match existing {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };
        let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
        let fp = fingerprint(
            account_id,
            &Transaction {
                date,
                description,
                amount,
                category: None,
            },
        );

        self.conn.execute(
            "UPDATE transactions SET date = ?1, fingerprint = ?2 WHERE id = ?3",
            params![date.to_string(), fp, id],
        )?;
        Ok(())
    }

    /// Corrects a transaction's description after the fact (a raw import
    /// description that didn't get cleaned up, or a manual entry with a
    /// typo). The fingerprint is recomputed since it includes the
    /// description. An unknown id is a harmless no-op, same convention as
    /// `update_transaction_amount`.
    pub fn update_transaction_description(&self, id: i64, description: &str) -> rusqlite::Result<()> {
        let existing = self
            .conn
            .query_row("SELECT account_id, date, amount FROM transactions WHERE id = ?1", params![id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            });
        let (account_id, date_str, amount_str) = match existing {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };
        let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
        let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
        let fp = fingerprint(
            account_id,
            &Transaction {
                date,
                description: description.to_string(),
                amount,
                category: None,
            },
        );

        self.conn.execute(
            "UPDATE transactions SET description = ?1, fingerprint = ?2 WHERE id = ?3",
            params![description, fp, id],
        )?;
        Ok(())
    }

    /// Actually removes one transaction row and everything that would
    /// otherwise dangle or trip a foreign key once it's gone: its splits,
    /// tags, and — if it's either side of an applied debt payment — the
    /// link row and its generated twin transaction. This is the *old*
    /// `delete_transaction` behavior verbatim, kept only for
    /// `delete_account`'s cascade (see that method's doc comment for why
    /// it can't use the new soft-delete `delete_transaction` instead). Not
    /// used by anything a user can trigger without also deleting the
    /// whole account.
    fn hard_delete_transaction_row(&self, id: i64) -> rusqlite::Result<()> {
        let generated_transaction_id = match self.conn.query_row(
            "SELECT generated_transaction_id FROM debt_payments WHERE source_transaction_id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        // The link row must go before either transaction row it points at
        // (it references both by id) — otherwise deleting the transaction
        // first trips the foreign key constraint.
        self.conn.execute(
            "DELETE FROM debt_payments WHERE source_transaction_id = ?1 OR generated_transaction_id = ?1",
            params![id],
        )?;
        if let Some(generated_id) = generated_transaction_id {
            self.conn
                .execute("DELETE FROM transaction_splits WHERE transaction_id = ?1", params![generated_id])?;
            self.conn
                .execute("DELETE FROM transaction_tags WHERE transaction_id = ?1", params![generated_id])?;
            self.conn.execute("DELETE FROM transactions WHERE id = ?1", params![generated_id])?;
        }
        self.conn
            .execute("DELETE FROM transaction_splits WHERE transaction_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM transaction_tags WHERE transaction_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM transactions WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Soft-deletes a transaction — sets `deleted_at` rather than actually
    /// removing the row, so `restore_transactions` can bring it back later
    /// (the Transactions tab's bulk-delete "Undo"). An unknown id is a harmless
    /// no-op, same as the old hard-delete was. Deliberately leaves
    /// `transaction_splits`/`transaction_tags`/`debt_payments` completely
    /// untouched — that's what makes restore complete: nothing needs
    /// separate "undelete the tags/splits too" logic, they were never
    /// gone. Every production read of `transactions` filters
    /// `deleted_at IS NULL` instead (see each method's own comment).
    ///
    /// `now` comes from the caller rather than reading the system clock in
    /// here — `core` deliberately never touches it directly (chrono's
    /// `clock` feature isn't even enabled for this crate), the same
    /// "today/now is always a parameter" convention every other
    /// date-based method in this file already follows (`cash_flow_forecast`,
    /// `average_monthly_spend`, ...).
    ///
    /// If `id` is either side of an applied debt payment (see
    /// `apply_debt_payment`) — the source transaction or the twin it
    /// generated on the debt account — the other side is soft-deleted
    /// too, symmetrically, so a debt payment doesn't half-disappear from
    /// Transactions while its balance-side bookkeeping twin lingers behind
    /// (or vice versa). The `debt_payments` link row itself is left
    /// alone; `restore_transactions` uses it the same way to bring both
    /// sides back together.
    pub fn delete_transaction(&self, id: i64, now: NaiveDateTime) -> rusqlite::Result<()> {
        let now = now.to_string();
        let other_side = self.debt_payment_partner(id)?;
        let summary = self.transaction_summary_for_log(id);
        let before = summary.as_ref().and_then(|s| self.displayed_balance_for_log(s.0));
        self.conn
            .execute("UPDATE transactions SET deleted_at = ?1 WHERE id = ?2", params![now, id])?;
        if let Some((account_id, account, description, amount)) = summary {
            let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(account_id));
            self.log_activity(&format!("{account}: transaction #{id} \"{description}\" ({amount}) deleted — {snapshot}"));
        }
        if let Some(other_id) = other_side {
            let other_summary = self.transaction_summary_for_log(other_id);
            let other_before = other_summary.as_ref().and_then(|s| self.displayed_balance_for_log(s.0));
            self.conn
                .execute("UPDATE transactions SET deleted_at = ?1 WHERE id = ?2", params![now, other_id])?;
            if let Some((account_id, account, description, amount)) = other_summary {
                let snapshot = Self::describe_balance_snapshot(other_before, self.displayed_balance_for_log(account_id));
                self.log_activity(&format!(
                    "{account}: transaction #{other_id} \"{description}\" ({amount}) deleted (linked debt-payment side) — {snapshot}"
                ));
            }
        }
        Ok(())
    }

    /// Account id, account name, description, and raw amount (as text, for
    /// display) for a transaction — built only for a log line before/after
    /// delete or restore, since those operations otherwise never need any
    /// of this. `None` if the id doesn't exist (never expected in practice
    /// — called right after confirming the row is there).
    fn transaction_summary_for_log(&self, id: i64) -> Option<(i64, String, String, String)> {
        self.conn
            .query_row(
                "SELECT account_id, description, amount FROM transactions WHERE id = ?1",
                params![id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
            )
            .ok()
            .map(|(account_id, description, amount)| (account_id, self.account_name_for_log(account_id), description, amount))
    }

    /// The other transaction id linked to `id` through `debt_payments`
    /// (source -> generated, or generated -> source), if any — shared by
    /// `delete_transaction` and `restore_transactions` so a debt payment's
    /// two sides always move together.
    fn debt_payment_partner(&self, id: i64) -> rusqlite::Result<Option<i64>> {
        let as_source = match self.conn.query_row(
            "SELECT generated_transaction_id FROM debt_payments WHERE source_transaction_id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        if as_source.is_some() {
            return Ok(as_source);
        }
        match self.conn.query_row(
            "SELECT source_transaction_id FROM debt_payments WHERE generated_transaction_id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Undoes `delete_transaction`/`bulk_delete_transactions` (the
    /// Transactions tab's bulk-delete "Undo") — clears `deleted_at` for exactly
    /// these ids, plus each one's debt-payment partner if it has one
    /// (symmetric with `delete_transaction`'s own cascade). Tags, splits,
    /// and the `debt_payments` link row were never touched by the delete,
    /// so this alone is a complete restore.
    pub fn restore_transactions(&self, ids: &[i64]) -> rusqlite::Result<()> {
        for &id in ids {
            let summary = self.transaction_summary_for_log(id);
            let before = summary.as_ref().and_then(|s| self.displayed_balance_for_log(s.0));
            self.conn
                .execute("UPDATE transactions SET deleted_at = NULL WHERE id = ?1", params![id])?;
            if let Some((account_id, account, description, amount)) = summary {
                let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(account_id));
                self.log_activity(&format!(
                    "{account}: transaction #{id} \"{description}\" ({amount}) restored — {snapshot}"
                ));
            }
            if let Some(other_id) = self.debt_payment_partner(id)? {
                let other_summary = self.transaction_summary_for_log(other_id);
                let other_before = other_summary.as_ref().and_then(|s| self.displayed_balance_for_log(s.0));
                self.conn
                    .execute("UPDATE transactions SET deleted_at = NULL WHERE id = ?1", params![other_id])?;
                if let Some((account_id, account, description, amount)) = other_summary {
                    let snapshot = Self::describe_balance_snapshot(other_before, self.displayed_balance_for_log(account_id));
                    self.log_activity(&format!(
                        "{account}: transaction #{other_id} \"{description}\" ({amount}) restored (linked debt-payment side) — {snapshot}"
                    ));
                }
            }
        }
        Ok(())
    }

    /// Adds a tag to a transaction (a no-op if it's already there, since
    /// tags have no ordering or count that a duplicate would affect).
    pub fn add_tag(&self, transaction_id: i64, tag: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag) VALUES (?1, ?2)",
            params![transaction_id, tag.trim()],
        )?;
        Ok(())
    }

    /// Removes a tag from a transaction. A no-op if it wasn't there.
    pub fn remove_tag(&self, transaction_id: i64, tag: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "DELETE FROM transaction_tags WHERE transaction_id = ?1 AND tag = ?2",
            params![transaction_id, tag],
        )?;
        Ok(())
    }

    /// Every distinct tag in use across any transaction, alphabetically —
    /// powers autocomplete when adding a new tag; there's no separate
    /// master tag list to manage. Joins back to `transactions` (rather
    /// than reading `transaction_tags` alone) so a tag belonging only to
    /// a soft-deleted transaction doesn't linger in autocomplete.
    pub fn list_all_tags(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT tt.tag FROM transaction_tags tt
             JOIN transactions t ON t.id = tt.transaction_id
             WHERE t.deleted_at IS NULL
             ORDER BY tt.tag COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Sets (or clears, with `None`) which family member a transaction is
    /// attributed to — overrides whatever it inherited from its account
    /// (see `save_transactions`). An unknown id is a harmless no-op.
    pub fn set_transaction_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE transactions SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// `set_transaction_member` applied to every id in `ids` — a plain loop,
    /// not a rule-learning bulk edit like `bulk_correct_category`, since
    /// member assignment has no analogous side effect to replay.
    pub fn bulk_set_transaction_member(&self, ids: &[i64], member_id: Option<i64>) -> rusqlite::Result<()> {
        for id in ids {
            self.set_transaction_member(*id, member_id)?;
        }
        Ok(())
    }

    /// Replaces every split line for `transaction_id` with `splits` (an
    /// empty slice clears them, un-splitting the transaction back to its
    /// own single category). No sum-matches-the-parent-amount validation
    /// here — the Transactions UI enforces that before it lets you save (a
    /// "remaining to allocate" total that must hit exactly $0.00), same
    /// trust-the-UI stance as every other setter in this crate that
    /// doesn't re-validate what the caller already checked.
    pub fn set_transaction_splits(&self, transaction_id: i64, splits: &[(String, Decimal, Option<String>)]) -> rusqlite::Result<()> {
        self.conn
            .execute("DELETE FROM transaction_splits WHERE transaction_id = ?1", params![transaction_id])?;
        for (category, amount, note) in splits {
            self.conn.execute(
                "INSERT INTO transaction_splits (transaction_id, category, amount, note) VALUES (?1, ?2, ?3, ?4)",
                params![transaction_id, category, amount.to_string(), note],
            )?;
        }
        Ok(())
    }

    /// A transaction's split lines, in the order they were saved. Empty
    /// for a transaction that's never been split.
    pub fn list_transaction_splits(&self, transaction_id: i64) -> rusqlite::Result<Vec<TransactionSplit>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, category, amount, note FROM transaction_splits WHERE transaction_id = ?1 ORDER BY id")?;
        let rows = stmt.query_map(params![transaction_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;
        let mut result = Vec::new();
        for row in rows {
            let (id, category, amount_str, note) = row?;
            result.push(TransactionSplit {
                id,
                category,
                amount: Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid"),
                note,
            });
        }
        Ok(result)
    }

    /// Applies part or all of `source_transaction_id`'s amount toward
    /// paying down `debt_account_id` (a loan or credit account), so the
    /// debt's tracked balance moves without the user retyping it. `amount`
    /// is independent of the source transaction's own amount — a mortgage
    /// payment bundles principal, interest and escrow, and only the
    /// principal portion should reduce what's owed, so the caller decides
    /// how much counts.
    ///
    /// Records a new transaction on the debt account itself, signed to
    /// match what a real imported payment would look like: positive,
    /// whether the debt is a loan (`current_balance` there *is* the amount
    /// owed, and a positive transaction reduces it — see
    /// `account_balance_as_of`) or credit (`current_balance` is *available*
    /// credit — a payment restores it, same sign either way). It copies
    /// the source transaction's own category and notes where it came from
    /// in its description. A cash-funded payment already reduces net worth
    /// by `amount` on the source side; this generated row increases it by
    /// the same amount on the debt side, so total net worth is correctly
    /// unaffected — only its composition shifts from cash to less debt.
    ///
    /// One source transaction can be applied to one debt account at a
    /// time (`UNIQUE(source_transaction_id)`) — call
    /// `unapply_debt_payment` first to change it.
    pub fn apply_debt_payment(&self, source_transaction_id: i64, debt_account_id: i64, amount: Decimal, date: NaiveDate) -> rusqlite::Result<()> {
        let (source_account_id, source_category, source_description): (i64, Option<String>, String) = self.conn.query_row(
            "SELECT account_id, category, description FROM transactions WHERE id = ?1",
            params![source_transaction_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        let signed_amount = amount.abs();
        let before = self.displayed_balance_for_log(debt_account_id);

        let description = format!("Payment applied from: {source_description}");
        let generated = Transaction {
            date,
            description: description.clone(),
            amount: signed_amount,
            category: source_category,
        };
        self.conn.execute(
            "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint, member_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT member_id FROM accounts WHERE id = ?1))",
            params![
                debt_account_id,
                date.to_string(),
                description,
                signed_amount.to_string(),
                generated.category,
                fingerprint(debt_account_id, &generated),
            ],
        )?;
        let generated_transaction_id = self.conn.last_insert_rowid();

        self.conn.execute(
            "INSERT INTO debt_payments
                (source_transaction_id, debt_account_id, generated_transaction_id, amount, date)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                source_transaction_id,
                debt_account_id,
                generated_transaction_id,
                amount.to_string(),
                date.to_string(),
            ],
        )?;
        let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(debt_account_id));
        self.log_activity(&format!(
            "{} -> {}: debt payment applied, amount={amount} (source transaction #{source_transaction_id}) — {snapshot}",
            self.account_name_for_log(source_account_id),
            self.account_name_for_log(debt_account_id)
        ));
        Ok(())
    }

    /// Reverses `apply_debt_payment`: deletes the transaction it generated
    /// on the debt account and the link row. A no-op if
    /// `source_transaction_id` was never applied to anything.
    pub fn unapply_debt_payment(&self, source_transaction_id: i64) -> rusqlite::Result<()> {
        let generated_transaction_id = match self.conn.query_row(
            "SELECT generated_transaction_id FROM debt_payments WHERE source_transaction_id = ?1",
            params![source_transaction_id],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };
        let summary = self.transaction_summary_for_log(generated_transaction_id);
        let before = summary.as_ref().and_then(|s| self.displayed_balance_for_log(s.0));
        self.conn.execute(
            "DELETE FROM debt_payments WHERE source_transaction_id = ?1",
            params![source_transaction_id],
        )?;
        self.conn
            .execute("DELETE FROM transactions WHERE id = ?1", params![generated_transaction_id])?;
        if let Some((account_id, account, _, amount)) = summary {
            let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(account_id));
            self.log_activity(&format!(
                "{account}: debt payment unapplied, amount={amount} reversed (source transaction #{source_transaction_id}) — {snapshot}"
            ));
        }
        Ok(())
    }

    /// Creates a new savings bucket. Errors (a `UNIQUE` constraint
    /// violation) if a bucket with that name already exists — unlike an
    /// account, a duplicate bucket name is a mistake to surface, not a
    /// re-selection to shrug off.
    // Every param is a distinct, independently-optional bucket field with
    // its own SQL column — bundling them into a params struct would just
    // move this same list to a type definition without changing the call
    // sites' shape, so it's allowed here rather than forced into that
    // indirection.
    #[allow(clippy::too_many_arguments)]
    pub fn create_bucket(
        &self,
        name: &str,
        target_amount: Option<Decimal>,
        target_date: Option<NaiveDate>,
        account_id: Option<i64>,
        sinking_amount: Option<Decimal>,
        color: Option<&str>,
        icon_key: Option<&str>,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO buckets (name, target_amount, target_date, account_id, sinking_amount, color, icon_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                name,
                target_amount.map(|a| a.to_string()),
                target_date.map(|d| d.to_string()),
                account_id,
                sinking_amount.map(|a| a.to_string()),
                color,
                icon_key,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Updates a bucket's target amount, target date, linked account,
    /// sinking-fund auto-contribution amount, color, and icon (all
    /// optional/nullable — the linked account, color, and icon are purely
    /// informational, none feeds into any balance calculation). An
    /// unknown id is a harmless no-op.
    // Same reasoning as `create_bucket` above — one independent optional
    // field per column, not a natural grouping worth its own struct.
    #[allow(clippy::too_many_arguments)]
    pub fn update_bucket_details(
        &self,
        id: i64,
        target_amount: Option<Decimal>,
        target_date: Option<NaiveDate>,
        account_id: Option<i64>,
        sinking_amount: Option<Decimal>,
        color: Option<&str>,
        icon_key: Option<&str>,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE buckets SET target_amount = ?1, target_date = ?2, account_id = ?3, sinking_amount = ?4, color = ?5, icon_key = ?6 WHERE id = ?7",
            params![
                target_amount.map(|a| a.to_string()),
                target_date.map(|d| d.to_string()),
                account_id,
                sinking_amount.map(|a| a.to_string()),
                color,
                icon_key,
                id,
            ],
        )?;
        Ok(())
    }

    /// Sets (or clears, with `None`) which family member a bucket is
    /// attributed to. An unknown id is a harmless no-op.
    pub fn set_bucket_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE buckets SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// Turns "progress follows the linked account's balance" on or off for a
    /// goal — a dedicated single-field setter, same convention as
    /// `set_bucket_member`, so `create_bucket`/`update_bucket_details` never
    /// change shape. An unknown id is a harmless no-op.
    pub fn set_bucket_tracks_account(&self, id: i64, tracks_account: bool) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE buckets SET tracks_account = ?1 WHERE id = ?2", params![tracks_account, id])?;
        Ok(())
    }

    /// Every bucket, each with its saved amount computed fresh from its
    /// contributions (0 for a bucket with none yet) rather than trusted
    /// from a stored running total. The sum is done in Rust with `Decimal`,
    /// not in SQL — summing money as floating point (SQLite has no decimal
    /// aggregate) would risk the exact rounding errors this app avoids
    /// everywhere else by keeping amounts as `Decimal` end to end.
    pub fn list_buckets(&self) -> rusqlite::Result<Vec<StoredBucket>> {
        let mut stmt = self.conn.prepare(
            "SELECT b.id, b.name, b.target_amount, b.target_date, b.account_id, a.name,
                    GROUP_CONCAT(c.amount, '|'), b.member_id, fm.name, b.sinking_amount, b.color, b.icon_key,
                    b.tracks_account
             FROM buckets b
             LEFT JOIN accounts a ON a.id = b.account_id
             LEFT JOIN bucket_contributions c ON c.bucket_id = b.id
             LEFT JOIN family_members fm ON fm.id = b.member_id
             GROUP BY b.id
             ORDER BY b.name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, bool>(12)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (
                id,
                name,
                target_amount,
                target_date,
                account_id,
                account_name,
                contributions,
                member_id,
                member_name,
                sinking_amount,
                color,
                icon_key,
                tracks_account,
            ) = row?;
            let saved_amount = contributions
                .map(|joined| {
                    joined
                        .split('|')
                        .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
                        .sum()
                })
                .unwrap_or(Decimal::ZERO);
            result.push(StoredBucket {
                id,
                name,
                target_amount: target_amount.map(|a| Decimal::from_str(&a).expect("amount stored by this crate must be valid")),
                saved_amount,
                target_date: target_date.map(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").expect("date stored by this crate must be valid")),
                account_id,
                account_name,
                member_id,
                member_name,
                sinking_amount: sinking_amount.map(|a| Decimal::from_str(&a).expect("amount stored by this crate must be valid")),
                color,
                icon_key,
                tracks_account,
                monthly_pace: Decimal::ZERO,
            });
        }
        Ok(result)
    }

    /// `list_buckets` plus what needs a date: a goal that tracks its linked
    /// account reports that account's current balance (never below zero) as
    /// `saved_amount`, and every goal gets its trailing-90-day
    /// `monthly_pace` — for a tracking goal the account's net transaction
    /// change, otherwise the net of its logged contributions.
    pub fn list_buckets_as_of(&self, today: NaiveDate) -> rusqlite::Result<Vec<StoredBucket>> {
        let mut buckets = self.list_buckets()?;
        let balances: std::collections::HashMap<i64, Decimal> = if buckets.iter().any(|b| b.tracks_account && b.account_id.is_some()) {
            self.list_accounts(today)?.into_iter().map(|a| (a.id, a.current_balance)).collect()
        } else {
            std::collections::HashMap::new()
        };
        let window_start = today - chrono::Duration::days(90);

        for bucket in &mut buckets {
            let tracked_account = if bucket.tracks_account { bucket.account_id } else { None };
            let net: Decimal = match tracked_account {
                Some(account_id) => {
                    if let Some(balance) = balances.get(&account_id) {
                        bucket.saved_amount = (*balance).max(Decimal::ZERO);
                    }
                    let mut stmt = self.conn.prepare(
                        "SELECT COALESCE(principal_amount, amount) FROM transactions
                         WHERE account_id = ?1 AND date > ?2 AND date <= ?3 AND deleted_at IS NULL",
                    )?;
                    let amounts = stmt
                        .query_map(params![account_id, window_start.to_string(), today.to_string()], |row| {
                            row.get::<_, String>(0)
                        })?
                        .collect::<rusqlite::Result<Vec<_>>>()?;
                    amounts
                        .iter()
                        .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
                        .sum()
                }
                None => {
                    let mut stmt = self
                        .conn
                        .prepare("SELECT amount FROM bucket_contributions WHERE bucket_id = ?1 AND date > ?2 AND date <= ?3")?;
                    let amounts = stmt
                        .query_map(params![bucket.id, window_start.to_string(), today.to_string()], |row| {
                            row.get::<_, String>(0)
                        })?
                        .collect::<rusqlite::Result<Vec<_>>>()?;
                    amounts
                        .iter()
                        .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
                        .sum()
                }
            };
            bucket.monthly_pace = net / Decimal::from(3);
        }
        Ok(buckets)
    }

    /// Logs a contribution toward a bucket — a positive amount is a
    /// deposit, a negative amount is a withdrawal. Doesn't touch a stored
    /// total; `list_buckets` sums these fresh every time.
    pub fn add_bucket_contribution(&self, bucket_id: i64, date: NaiveDate, amount: Decimal, note: Option<&str>) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO bucket_contributions (bucket_id, date, amount, note) VALUES (?1, ?2, ?3, ?4)",
            params![bucket_id, date.to_string(), amount.to_string(), note],
        )?;
        Ok(())
    }

    /// Deletes a bucket and every contribution logged against it — done as
    /// an explicit statement rather than an `ON DELETE CASCADE`, since that
    /// requires `PRAGMA foreign_keys = ON` which this connection doesn't
    /// set (matching how `delete_category` explicitly removes matching
    /// rules rather than relying on a database-level cascade). Also clears
    /// this bucket's `bucket_auto_contributions` guard rows first — left
    /// behind, they'd dangle once the `bucket_contributions` rows they
    /// point at are gone, same reasoning as deleting the contributions
    /// themselves rather than leaving them orphaned.
    pub fn delete_bucket(&self, id: i64) -> rusqlite::Result<()> {
        self.conn
            .execute("DELETE FROM bucket_auto_contributions WHERE bucket_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM bucket_contributions WHERE bucket_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM buckets WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Auto-contributes each sinking-fund bucket's fixed monthly amount
    /// once per calendar month — same idiom as
    /// `roll_forward_monthly_balances`: a `period` ("YYYY-MM") guard
    /// (belt-and-suspenders alongside `bucket_auto_contributions`'s own
    /// `UNIQUE` constraint), computed/inserted once, returns only the
    /// buckets freshly touched *this* call (empty on every later call the
    /// same month) so the caller can show a one-time note. The dollars
    /// land in `bucket_contributions` exactly like a manual contribution
    /// (`note = "Automatic monthly contribution"`) — this is what makes
    /// `saved_amount`, `total_saved`, and `delete_bucket`'s cascade pick it
    /// up with zero special-casing; `bucket_auto_contributions` exists
    /// purely as the guard and a pointer back to which row was the auto
    /// one. A manual contribution the same month is still allowed —
    /// this guard is scoped to `(bucket_id, period)` only, independent of
    /// `add_bucket_contribution`.
    pub fn apply_sinking_fund_contributions(&self, today: NaiveDate) -> rusqlite::Result<Vec<(i64, String, Decimal)>> {
        let period = format!("{:04}-{:02}", today.year(), today.month());

        let mut stmt = self
            .conn
            .prepare("SELECT id, name, sinking_amount FROM buckets WHERE sinking_amount IS NOT NULL")?;
        let buckets: Vec<(i64, String, String)> = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut applied = Vec::new();
        for (id, name, sinking_amount_str) in buckets {
            let already_done: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM bucket_auto_contributions WHERE bucket_id = ?1 AND period = ?2)",
                params![id, period],
                |row| row.get(0),
            )?;
            if already_done {
                continue;
            }

            let amount = Decimal::from_str(&sinking_amount_str).expect("amount stored by this crate must be valid");
            self.conn.execute(
                "INSERT INTO bucket_contributions (bucket_id, date, amount, note) VALUES (?1, ?2, ?3, ?4)",
                params![id, today.to_string(), amount.to_string(), "Automatic monthly contribution"],
            )?;
            let contribution_id = self.conn.last_insert_rowid();
            self.conn.execute(
                "INSERT INTO bucket_auto_contributions (bucket_id, period, contribution_id) VALUES (?1, ?2, ?3)",
                params![id, period, contribution_id],
            )?;
            applied.push((id, name, amount));
        }
        Ok(applied)
    }

    /// Sets (or updates) one category's target budget amount and group
    /// for one specific calendar month (`period`, "YYYY-MM") — completely
    /// independent of every other month, on purpose: this never touches
    /// a different period's row, so adjusting August never moves
    /// July's or September's numbers.
    pub fn set_budget(&self, category: &str, period: &str, monthly_amount: Decimal, budget_group: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(category, period) DO UPDATE SET monthly_amount = excluded.monthly_amount, budget_group = excluded.budget_group",
            params![category, period, monthly_amount.to_string(), budget_group],
        )?;
        self.conn
            .execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?1)", params![period])?;
        self.conn
            .execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![category])?;
        Ok(())
    }

    /// Opts a category's specific month in or out of the stricter 90%
    /// warning threshold (see `Store::budget_alerts_for_month`) — a
    /// dedicated single-field setter, same convention as
    /// `set_bucket_member`/`set_recurring_member`, so `set_budget` itself
    /// (and its many existing call sites) never needs to change. A
    /// (category, period) pair with no budget line yet is a harmless
    /// no-op, matching `delete_budget`'s convention.
    pub fn set_budget_cap(&self, category: &str, period: &str, cap_enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE budgets SET cap_enabled = ?1 WHERE category = ?2 AND period = ?3",
            params![cap_enabled, category, period],
        )?;
        Ok(())
    }

    /// Opts a category's specific month in or out of carrying its unspent
    /// budget forward — a dedicated single-field setter, same convention as
    /// `set_budget_cap`. A (category, period) pair with no line is a harmless
    /// no-op. Like every other per-line setting the choice is copied into
    /// each month that materializes from this one.
    pub fn set_budget_rollover(&self, category: &str, period: &str, rollover_enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE budgets SET rollover_enabled = ?1 WHERE category = ?2 AND period = ?3",
            params![rollover_enabled, category, period],
        )?;
        Ok(())
    }

    /// Every budgeted category for `period` ("YYYY-MM"), its group, and
    /// its monthly target — fully independent of every other period.
    /// The first time a period that's never been touched is requested,
    /// it's materialized by copying the most recent *earlier* touched
    /// period: a one-time starting point (so a new month doesn't start
    /// blank), not an ongoing link — the copy becomes this period's own
    /// rows immediately, and editing it from here on never touches the
    /// period it was copied from. A period with nothing earlier to copy
    /// from (the very first budget ever set) simply starts empty.
    ///
    /// Whether a period has been "touched" is tracked in `budget_periods`
    /// rather than by checking `budgets` directly — deleting a period's
    /// last line must leave it genuinely empty, not indistinguishable
    /// from never having been visited (which would silently resurrect
    /// the deleted line from an earlier month on the next read). Note
    /// this "read" can write on a cache-miss — deliberate, since
    /// materializing real rows is what makes later edits to this period
    /// stay isolated from the one it came from.
    pub fn list_budgets(&self, period: &str) -> rusqlite::Result<Vec<BudgetLine>> {
        let already_touched: bool = self
            .conn
            .query_row("SELECT EXISTS(SELECT 1 FROM budget_periods WHERE period = ?1)", params![period], |row| {
                row.get(0)
            })?;

        if !already_touched {
            let source_period: Option<String> = match self.conn.query_row(
                "SELECT period FROM budget_periods WHERE period < ?1 ORDER BY period DESC LIMIT 1",
                params![period],
                |row| row.get(0),
            ) {
                Ok(p) => Some(p),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(e),
            };

            if let Some(source_period) = source_period {
                self.conn.execute(
                    "INSERT INTO budgets (category, period, monthly_amount, budget_group, cap_enabled, rollover_enabled)
                     SELECT category, ?1, monthly_amount, budget_group, cap_enabled, rollover_enabled FROM budgets WHERE period = ?2",
                    params![period, source_period],
                )?;
            }
            self.conn
                .execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?1)", params![period])?;
        }

        let mut stmt = self.conn.prepare(
            "SELECT category, budget_group, monthly_amount, cap_enabled, rollover_enabled FROM budgets WHERE period = ?1 ORDER BY category",
        )?;
        let rows = stmt.query_map(params![period], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, bool>(4)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (category, budget_group, amount, cap_enabled, rollover_enabled) = row?;
            result.push(BudgetLine {
                category,
                budget_group,
                monthly_amount: Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
                cap_enabled,
                rollover_enabled,
            });
        }
        Ok(result)
    }

    /// What each category would be budgeted at if the month being planned
    /// (`year`/`month`) simply repeated the average of the `months` whole
    /// months before it. Built on `spending_by_category`, so transfers,
    /// income and debt-payment rows never show up. A month counts only if it
    /// ended after the very first transaction on the books — a user with
    /// two months of history gets a two-month average, not one diluted by an
    /// empty third — and a month with no spend in a category still counts
    /// as $0 for it. Averages round to a whole dollar and anything that
    /// rounds to $0 is dropped. Biggest first.
    ///
    /// Like `list_budgets`, this can materialize the month's budget rows
    /// (it reads what the month already budgets so the preview can show
    /// "current"), which is harmless: the month is being viewed anyway.
    pub fn suggest_budgets_from_average(&self, year: i32, month: u32, months: u32) -> rusqlite::Result<BudgetSuggestions> {
        let empty = BudgetSuggestions {
            months_used: 0,
            lines: Vec::new(),
        };
        let earliest: Option<String> = self
            .conn
            .query_row("SELECT MIN(date) FROM transactions WHERE deleted_at IS NULL", [], |row| row.get(0))?;
        let Some(earliest) = earliest.and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok()) else {
            return Ok(empty);
        };

        let mut totals: std::collections::BTreeMap<String, Decimal> = std::collections::BTreeMap::new();
        let mut months_used = 0u32;
        for back in (1..=months).rev() {
            let index = i64::from(year) * 12 + i64::from(month) - 1 - i64::from(back);
            let (y, m) = (index.div_euclid(12) as i32, (index.rem_euclid(12) + 1) as u32);
            let (first, next_first) = month_bounds(y, m);
            if next_first <= earliest {
                continue; // that month ended before any history began
            }
            months_used += 1;
            let last = next_first.pred_opt().expect("a month's last day exists");
            for (category, spent) in self.spending_by_category(first, last)? {
                *totals.entry(category).or_insert(Decimal::ZERO) += spent;
            }
        }
        if months_used == 0 {
            return Ok(empty);
        }

        let budgeted: std::collections::HashMap<String, BudgetLine> = self
            .list_budgets(&format!("{year:04}-{month:02}"))?
            .into_iter()
            .map(|b| (b.category.clone(), b))
            .collect();

        let divisor = Decimal::from(months_used);
        let mut lines: Vec<BudgetSuggestion> = totals
            .into_iter()
            .filter_map(|(category, total)| {
                let suggested = (total / divisor).round_dp_with_strategy(0, rust_decimal::RoundingStrategy::MidpointAwayFromZero);
                if suggested < Decimal::ONE {
                    return None;
                }
                let existing = budgeted.get(&category);
                Some(BudgetSuggestion {
                    budget_group: existing.map(|b| b.budget_group.clone()).unwrap_or_else(|| "flexible".to_string()),
                    current: existing.map(|b| b.monthly_amount),
                    category,
                    suggested,
                })
            })
            .collect();
        lines.sort_by(|a, b| b.suggested.cmp(&a.suggested).then_with(|| a.category.cmp(&b.category)));
        Ok(BudgetSuggestions { months_used, lines })
    }

    /// Everything the month-end review shows for `year`/`month`: income and
    /// spending beside the month before (transfers and debt-payment rows are
    /// out of both, same as `monthly_totals`), the budgeted expense
    /// categories that overspent (income lines never count as over), how
    /// many transactions still lack a category and what they add up to (a
    /// split purchase, a transfer, a debt-payment row or a deleted
    /// transaction never counts as one), and whether the review was already
    /// finished.
    pub fn month_review(&self, year: i32, month: u32) -> rusqlite::Result<MonthReview> {
        let (income, expenses) = self.monthly_totals(year, month)?;
        let (prev_year, prev_month) = if month == 1 { (year - 1, 12) } else { (year, month - 1) };
        let (prev_income, prev_expenses) = self.monthly_totals(prev_year, prev_month)?;

        let mut over_budget: Vec<OverBudgetLine> = self
            .monthly_budget_actuals(year, month)?
            .into_iter()
            .filter(|b| b.budget_group != "income" && b.actual > b.budgeted + b.rollover)
            .map(|b| OverBudgetLine {
                category: b.category,
                budgeted: b.budgeted + b.rollover,
                actual: b.actual,
            })
            .collect();
        over_budget.sort_by(|a, b| {
            (b.actual - b.budgeted)
                .cmp(&(a.actual - a.budgeted))
                .then_with(|| a.category.cmp(&b.category))
        });

        let (first, next_first) = month_bounds(year, month);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT amount FROM transactions
             WHERE category IS NULL AND date >= ?1 AND date < ?2 AND deleted_at IS NULL
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})"
        ))?;
        let amounts = stmt
            .query_map(params![first.to_string(), next_first.to_string()], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let uncategorized_total: Decimal = amounts
            .iter()
            .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid").abs())
            .sum();

        let reviewed = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM month_reviews WHERE period = ?1)",
            params![format!("{year:04}-{month:02}")],
            |row| row.get(0),
        )?;

        Ok(MonthReview {
            year,
            month,
            income,
            expenses,
            prev_income,
            prev_expenses,
            over_budget,
            uncategorized_count: amounts.len(),
            uncategorized_total,
            reviewed,
        })
    }

    /// Marks a month's review as finished. Marking one twice is harmless.
    pub fn set_month_reviewed(&self, year: i32, month: u32) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO month_reviews (period) VALUES (?1)",
            params![format!("{year:04}-{month:02}")],
        )?;
        Ok(())
    }

    /// Every finished month, as "YYYY-MM", oldest first.
    pub fn list_reviewed_months(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT period FROM month_reviews ORDER BY period")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect()
    }

    /// Removes one category's budget line for one specific month only —
    /// an unknown (category, period) pair is a harmless no-op, and every
    /// other month's line for that category is untouched.
    pub fn delete_budget(&self, category: &str, period: &str) -> rusqlite::Result<()> {
        self.conn
            .execute("DELETE FROM budgets WHERE category = ?1 AND period = ?2", params![category, period])?;
        Ok(())
    }

    /// All-time total across every bucket's contributions — summed in Rust
    /// with `Decimal`, same reasoning as `list_buckets`.
    pub fn total_saved(&self) -> rusqlite::Result<Decimal> {
        let mut stmt = self.conn.prepare("SELECT amount FROM bucket_contributions")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut total = Decimal::ZERO;
        for row in rows {
            total += Decimal::from_str(&row?).expect("amount stored by this crate must be valid");
        }
        Ok(total)
    }

    /// All-time total of every transaction that counts as income — the
    /// same rule `monthly_totals` applies per month (a positive amount that
    /// isn't a Transfer, and isn't a credit/loan account's own
    /// balance-side entry — restoring available credit or a loan escrow
    /// refund is a balance adjustment, never income), not "categorized
    /// literally 'Income'". Reports' "Income (all-time)" stat must never
    /// disagree with what Cash Flow — driven by `monthly_totals` — reports
    /// for the same transactions summed across every month; the previous
    /// `category = 'Income'` requirement silently returned $0 here for any
    /// user who categorized their paycheck "Salary" or anything else, even
    /// though `RuleSet::seeded`'s "Income" category (payroll, interest) is
    /// only ever a default guess, not something every income transaction
    /// is guaranteed to carry. Excludes `apply_debt_payment`'s generated
    /// transactions, same as `all_transactions` — see its doc comment.
    pub fn income_total(&self) -> rusqlite::Result<Decimal> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT t.amount, a.account_type FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND (t.category IS NULL OR t.category <> 'Transfer')
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND t.deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        let mut total = Decimal::ZERO;
        for row in rows {
            let (amount_str, account_type) = row?;
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            if amount > Decimal::ZERO && account_type != "credit" && account_type != "loan" {
                total += amount;
            }
        }
        Ok(total)
    }

    /// For every budgeted category *in this specific month* (see
    /// `list_budgets` — a month with no budget of its own materializes
    /// from the most recent earlier one), its target and how much was
    /// actually spent — `(category, budgeted, actual)`. `actual` is
    /// shown as a positive "spent" number (transactions are negative for
    /// money out), 0 for a budgeted category with no transactions yet in
    /// that month rather than being omitted.
    ///
    /// A split transaction (see `set_transaction_splits`) contributes
    /// through its split lines' own categories instead of its own —
    /// `id NOT IN (...)` excludes any transaction that's been split from
    /// also counting under its own (now superseded) category. Also excludes
    /// `apply_debt_payment`'s generated transactions, same as
    /// `all_transactions` — see its doc comment: the real expense already
    /// counts through the source transaction, so counting the generated
    /// one too would inflate "actual" by whatever was applied to the debt.
    pub fn monthly_budget_actuals(&self, year: i32, month: u32) -> rusqlite::Result<Vec<BudgetActual>> {
        let month_key = format!("{year:04}-{month:02}");
        let budgets = self.list_budgets(&month_key)?;
        let (first, next_first) = month_bounds(year, month);

        // One query covering every category at once (previously one query
        // *per budgeted category*) — summed in Rust with `Decimal`, not
        // SQL `SUM()`, since `amount` is stored as TEXT and SQLite's SUM
        // would do the addition in floating point rather than exact
        // decimal arithmetic.
        let mut stmt = self.conn.prepare(
            "SELECT category, amount FROM transactions
             WHERE date >= ?1 AND date < ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND deleted_at IS NULL
             UNION ALL
             SELECT ts.category, ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE t.date >= ?1 AND t.date < ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.deleted_at IS NULL",
        )?;
        let rows = stmt.query_map(params![first.to_string(), next_first.to_string()], |row| {
            Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut raw_by_category: std::collections::HashMap<String, Decimal> = std::collections::HashMap::new();
        for row in rows {
            let (category, amount_str) = row?;
            let Some(category) = category else { continue };
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            *raw_by_category.entry(category).or_insert(Decimal::ZERO) += amount;
        }

        // The global switch: with it off nothing is carried in, whatever each
        // category has chosen (the choices themselves are never rewritten).
        let rollover_feature_on = self.get_app_settings()?.rollover_enabled;
        let mut result = Vec::with_capacity(budgets.len());
        for line in budgets {
            let raw = raw_by_category.get(&line.category).copied().unwrap_or(Decimal::ZERO);
            // Expense transactions are stored negative, so negating
            // reports a positive "amount spent" — but income transactions
            // are stored positive already and must not be flipped, or a
            // real deposit reads as negative "actual".
            let spent = if line.budget_group == "income" { raw } else { -raw };
            let rollover = if rollover_feature_on && line.rollover_enabled && line.budget_group != "income" {
                self.rollover_carry(&line.category, year, month)?
            } else {
                Decimal::ZERO
            };
            result.push(BudgetActual {
                category: line.category,
                budget_group: line.budget_group,
                budgeted: line.monthly_amount,
                actual: spent,
                cap_enabled: line.cap_enabled,
                rollover_enabled: line.rollover_enabled,
                rollover,
            });
        }
        Ok(result)
    }

    /// What a category with rollover on brings into `year`/`month` from the
    /// months before it: each earlier month's unspent budget (its budget plus
    /// whatever it carried in, minus what was spent, never below zero),
    /// chained month to month. The chain starts at the first month of an
    /// unbroken run of months that all have this category's line with
    /// rollover on — switching it on starts fresh, and a month where the line
    /// is missing or rollover is off breaks the run. A month is read as the
    /// budget it actually had: one never opened has its most recent earlier
    /// month's line (the same rule `list_budgets` materializes by), without
    /// writing anything.
    fn rollover_carry(&self, category: &str, year: i32, month: u32) -> rusqlite::Result<Decimal> {
        const MAX_MONTHS_BACK: u32 = 36;

        // (base budget, month key), newest first, for the unbroken run.
        let mut run: Vec<(Decimal, String)> = Vec::new();
        for back in 0..MAX_MONTHS_BACK {
            let key = month_key_back(year, month, back);
            let touched: Option<String> = match self.conn.query_row(
                "SELECT period FROM budget_periods WHERE period <= ?1 ORDER BY period DESC LIMIT 1",
                params![key],
                |row| row.get(0),
            ) {
                Ok(p) => Some(p),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(e),
            };
            let Some(source_period) = touched else { break };
            let line = match self.conn.query_row(
                "SELECT monthly_amount, rollover_enabled FROM budgets WHERE category = ?1 AND period = ?2",
                params![category, source_period],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)),
            ) {
                Ok(l) => Some(l),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(e),
            };
            match line {
                Some((amount, true)) => run.push((Decimal::from_str(&amount).expect("amount stored by this crate must be valid"), key)),
                _ => break,
            }
        }

        // The run is newest first; the target month is its head and only
        // needs what the months before it leave behind.
        let mut carry = Decimal::ZERO;
        for (base, key) in run.iter().skip(1).rev() {
            let unspent = *base + carry - self.expense_spent_in_month(category, key)?;
            carry = unspent.max(Decimal::ZERO);
        }
        Ok(carry)
    }

    /// What one expense category spent in one "YYYY-MM" month, as a positive
    /// number — the same split-aware, debt-payment-exclusion-aware sum
    /// `monthly_budget_actuals` uses, for a single category.
    fn expense_spent_in_month(&self, category: &str, month_key: &str) -> rusqlite::Result<Decimal> {
        let mut stmt = self.conn.prepare(
            "SELECT amount FROM transactions
             WHERE category = ?1 AND substr(date, 1, 7) = ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND deleted_at IS NULL
             UNION ALL
             SELECT ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category = ?1 AND substr(t.date, 1, 7) = ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.deleted_at IS NULL",
        )?;
        let rows = stmt.query_map(params![category, month_key], |row| row.get::<_, String>(0))?;
        let mut raw = Decimal::ZERO;
        for row in rows {
            raw += Decimal::from_str(&row?).expect("amount stored by this crate must be valid");
        }
        Ok(-raw)
    }

    /// Same as `monthly_budget_actuals`, further split by which family
    /// member's transactions made up each category's actual — reuses the
    /// identical split/debt-payment-exclusion-aware query rather than
    /// reimplementing it, since a purely client-side reduction over
    /// `list_transactions`'s output would silently misattribute a split
    /// transaction (its own `category` field is stale once split; the
    /// frontend never receives `transaction_splits` rows to know that). A
    /// split line's member is the *parent* transaction's — a split carries
    /// no member of its own.
    ///
    /// Unattributed spend is bucketed under `member_id: None`
    /// ("Unassigned") rather than dropped, unlike the simpler top-level
    /// "spending by person" stat cards (`memberBreakdowns.ts` on the
    /// frontend) — this table exists to reconcile against
    /// `monthly_budget_actuals`'s own category total, and dropping
    /// unattributed spend would make the member rows visibly undercount
    /// it. A category with no transactions at all this month (from any
    /// member) simply produces no rows, matching `monthly_budget_actuals`'s
    /// own $0 for that category once summed back up.
    pub fn monthly_budget_actuals_by_member(&self, year: i32, month: u32) -> rusqlite::Result<Vec<MemberBudgetActual>> {
        let month_key = format!("{year:04}-{month:02}");
        let budgets = self.list_budgets(&month_key)?;
        let member_names: std::collections::HashMap<i64, String> = self.list_family_members()?.into_iter().map(|m| (m.id, m.name)).collect();

        let mut stmt = self.conn.prepare(
            "SELECT amount, member_id FROM transactions
             WHERE category = ?1 AND substr(date, 1, 7) = ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND deleted_at IS NULL
             UNION ALL
             SELECT ts.amount, t.member_id FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category = ?1 AND substr(t.date, 1, 7) = ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.deleted_at IS NULL",
        )?;

        let mut result = Vec::new();
        for line in budgets {
            let rows = stmt.query_map(params![line.category, month_key], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?))
            })?;

            let mut by_member: std::collections::BTreeMap<Option<i64>, Decimal> = std::collections::BTreeMap::new();
            for row in rows {
                let (amount_str, member_id) = row?;
                let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
                let signed = if line.budget_group == "income" { amount } else { -amount };
                *by_member.entry(member_id).or_insert(Decimal::ZERO) += signed;
            }

            for (member_id, actual) in by_member {
                result.push(MemberBudgetActual {
                    category: line.category.clone(),
                    budget_group: line.budget_group.clone(),
                    budgeted: line.monthly_amount,
                    member_id,
                    member_name: member_id.and_then(|id| member_names.get(&id).cloned()),
                    actual,
                });
            }
        }
        Ok(result)
    }

    /// One category's actual spend for each of the trailing `months`
    /// months ending at (and including) `year`/`month` — same
    /// split-aware, debt-payment-exclusion-aware query as
    /// `monthly_budget_actuals`, just parameterized by a fixed category
    /// and looped over months instead of over every budgeted category.
    /// Oldest month first. Doesn't consult `list_budgets` at all — a
    /// month with $0 actual and no budget line still returns a `0.00`
    /// point rather than being skipped, so a sparkline never has to
    /// special-case a missing month.
    pub fn budget_actuals_trend(&self, category: &str, year: i32, month: u32, months: u32) -> rusqlite::Result<Vec<(String, Decimal)>> {
        let mut stmt = self.conn.prepare(
            "SELECT amount FROM transactions
             WHERE category = ?1 AND substr(date, 1, 7) = ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND deleted_at IS NULL
             UNION ALL
             SELECT ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category = ?1 AND substr(t.date, 1, 7) = ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.deleted_at IS NULL",
        )?;
        let is_income = self
            .list_budgets(&format!("{year:04}-{month:02}"))?
            .into_iter()
            .find(|b| b.category == category)
            .map(|b| b.budget_group == "income")
            .unwrap_or(false);

        let mut result = Vec::with_capacity(months as usize);
        for back in (0..months).rev() {
            let month_key = month_key_back(year, month, back);
            let rows = stmt.query_map(params![category, month_key], |row| row.get::<_, String>(0))?;
            let mut spent = Decimal::ZERO;
            for row in rows {
                let amount = Decimal::from_str(&row?).expect("amount stored by this crate must be valid");
                if is_income {
                    spent += amount;
                } else {
                    spent -= amount;
                }
            }
            result.push((month_key, spent));
        }
        Ok(result)
    }

    /// Every line item behind one category's `monthly_budget_actuals`
    /// entry for a month — clicking a category on the Budget page drills
    /// into this. Same split-aware shape as `monthly_budget_actuals`: a
    /// transaction that's been split contributes its split lines instead
    /// of itself, and `apply_debt_payment`'s generated transactions are
    /// excluded the same way too, so the line items shown here sum to
    /// exactly the same "actual" the budget row displays. Sorted oldest
    /// first.
    pub fn transactions_for_category_in_month(&self, category: &str, year: i32, month: u32) -> rusqlite::Result<Vec<CategoryTransaction>> {
        let month_key = format!("{year:04}-{month:02}");
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.date, t.description, t.amount, a.name, 0, NULL
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.category = ?1 AND substr(t.date, 1, 7) = ?2
                   AND t.id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.deleted_at IS NULL
             UNION ALL
             SELECT t.id, t.date, t.description, ts.amount, a.name, 1, ts.note
             FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             JOIN accounts a ON a.id = t.account_id
             WHERE ts.category = ?1 AND substr(t.date, 1, 7) = ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.deleted_at IS NULL
             ORDER BY 2",
        )?;
        let rows = stmt.query_map(params![category, month_key], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (transaction_id, date, description, amount, account_name, is_split, split_note) = row?;
            result.push(CategoryTransaction {
                transaction_id,
                date: NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                description,
                amount: Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
                account_name,
                is_split,
                split_note,
            });
        }
        Ok(result)
    }

    /// Which budgeted categories are at or near their monthly limit —
    /// built on top of `monthly_budget_actuals`, no separate query. A
    /// category shows up once it's spent 80% or more of its budget
    /// (`"warning"`) — or 90% or more if it's opted into a cap via
    /// `set_budget_cap` (a stricter threshold, not an additional tier) —
    /// landing exactly on 100% still counts as a warning, not "over"; only
    /// spending *past* the budget (`"over"`) does. Anything below the
    /// warning threshold, any income line (exceeding an income budget is
    /// already a positive, never an alert), and any zero-budgeted line
    /// (nothing to alert against) are all left out entirely rather than
    /// included at 0%.
    pub fn budget_alerts_for_month(&self, year: i32, month: u32) -> rusqlite::Result<Vec<BudgetAlert>> {
        let hundred = Decimal::from(100);
        // Turning the Envelope Caps feature off suspends every category's
        // cap the same way, without touching any of their stored
        // `cap_enabled` flags — see `StoredAppSettings`.
        let caps_feature_enabled = self.get_app_settings()?.envelope_caps_enabled;
        let mut result = Vec::new();
        for line in self.monthly_budget_actuals(year, month)? {
            // What the month actually has to spend: the budget plus anything
            // rolled in from earlier months.
            let available = line.budgeted + line.rollover;
            if line.budget_group == "income" || available <= Decimal::ZERO {
                continue;
            }
            let pct = (line.actual / available) * hundred;
            // A category that's opted into a cap (`cap_enabled`) warns
            // earlier — at 90% instead of the default 80% — replacing that
            // category's threshold rather than adding a third tier on top.
            // Landing exactly on budget (pct == 100) is not overspending —
            // only going past it is, so "over" needs to be strictly
            // greater than 100, not >=.
            let effective_cap = line.cap_enabled && caps_feature_enabled;
            let warning_threshold = if effective_cap { Decimal::from(90) } else { Decimal::from(80) };
            let level = if pct > hundred {
                "over"
            } else if pct >= warning_threshold {
                "warning"
            } else {
                continue;
            };
            result.push(BudgetAlert {
                category: line.category,
                budget_group: line.budget_group,
                budgeted: available,
                actual: line.actual,
                pct,
                level: level.to_string(),
                cap_enabled: effective_cap,
            });
        }
        // Most-severe first — "over" budget outranks "warning" regardless of
        // percent, then furthest-over/closest-to-over within the same level
        // — so a dashboard or list rendering these in order surfaces what
        // actually needs attention first, not whatever order the underlying
        // category list happens to iterate in.
        result.sort_by(|a, b| {
            let rank = |level: &str| if level == "over" { 0 } else { 1 };
            rank(&a.level).cmp(&rank(&b.level)).then(b.pct.cmp(&a.pct))
        });
        Ok(result)
    }

    /// Every transaction currently flagged as an anomaly — an unusually
    /// large charge for its category, or a likely duplicate of another
    /// transaction — computed fresh over all transactions (personal-scale
    /// data, same "don't over-engineer for scale" precedent as the
    /// per-account balance loop). One transaction can appear more than
    /// once (e.g. flagged as both a duplicate of two different other
    /// rows), each as its own entry.
    ///
    /// "Large": a category needs at least 3 other transactions in the
    /// trailing ~6 months (180 days) before `today` to have a baseline to
    /// compare against — too little history and nothing is flagged, since
    /// there's nothing meaningful to be "unusual" relative to. A
    /// transaction over 2.5x that baseline average, and over $50 (a floor
    /// so a tiny category's small absolute swings don't read as "unusual"
    /// just because they're a big multiple), is flagged.
    ///
    /// "Duplicate": any two transactions — regardless of account — with
    /// the exact same signed amount, dated within 3 days of each other,
    /// whose descriptions match once normalized (lowercased, whitespace
    /// collapsed, a trailing digit run like a store/reference number
    /// stripped). This is looking for genuinely separate charges that
    /// happen to look identical (e.g. a subscription billed twice), not
    /// the same import re-added — that's already prevented at import time
    /// by fingerprint-based dedup.
    pub fn anomaly_flags(&self) -> rusqlite::Result<Vec<AnomalyFlag>> {
        struct Row {
            id: i64,
            date: NaiveDate,
            description: String,
            amount: Decimal,
            category: Option<String>,
        }

        let linked_transfer_legs: std::collections::HashSet<i64> = {
            let mut stmt = self.conn.prepare(LIVE_TRANSFER_LEG_IDS_SQL)?;
            let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };

        let mut stmt = self
            .conn
            .prepare("SELECT id, date, description, amount, category FROM transactions WHERE deleted_at IS NULL ORDER BY id")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;

        let mut all = Vec::new();
        for row in rows {
            let (id, date_str, description, amount_str, category) = row?;
            all.push(Row {
                id,
                date: NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                description,
                amount: Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid"),
                category,
            });
        }

        let mut result = Vec::new();

        // "Large": comparing every transaction against a full linear scan
        // of every other transaction is O(n²). Instead, group by category
        // and sort each group by date, then walk it once with a
        // sliding window (`lo`/`hi` below) tracking exactly the same set
        // the original filter did — every same-category row with
        // `date` in `[row.date - 180 days, row.date)` (strictly *before*
        // `row`, so same-day transactions never count toward each other's
        // baseline) — as a running sum instead of re-scanning it. Both
        // pointers only ever move forward as `row.date` advances through
        // the sorted group, so each group is O(n) after its one sort:
        // O(n log n) overall instead of O(n²).
        let mut by_category: std::collections::HashMap<&str, Vec<&Row>> = std::collections::HashMap::new();
        for row in &all {
            // A big move between the user's own accounts is a transfer,
            // not an unusually large expense — whether it's categorized
            // "Transfer" or is a linked pair under any other category.
            if linked_transfer_legs.contains(&row.id) {
                continue;
            }
            if let Some(category) = row.category.as_ref().filter(|c| c.as_str() != "Transfer") {
                by_category.entry(category.as_str()).or_default().push(row);
            }
        }
        for (category, mut rows) in by_category {
            rows.sort_by_key(|r| r.date);
            let (mut lo, mut hi) = (0usize, 0usize);
            let (mut window_sum, mut window_count) = (Decimal::ZERO, 0usize);
            for row in &rows {
                let window_start = row.date - chrono::Duration::days(180);
                while hi < rows.len() && rows[hi].date < row.date {
                    window_sum += rows[hi].amount.abs();
                    window_count += 1;
                    hi += 1;
                }
                while lo < hi && rows[lo].date < window_start {
                    window_sum -= rows[lo].amount.abs();
                    window_count -= 1;
                    lo += 1;
                }
                if window_count < 3 {
                    continue;
                }
                let baseline = window_sum / Decimal::from(window_count);
                let threshold = baseline * Decimal::new(25, 1); // 2.5x
                if row.amount.abs() > threshold && row.amount.abs() > Decimal::from(50) {
                    result.push(AnomalyFlag {
                        transaction_id: row.id,
                        kind: "large".to_string(),
                        detail: format!(
                            "Unusually large for {category} — {} vs a recent average of {baseline:.2}",
                            row.amount.abs()
                        ),
                    });
                }
            }
        }

        // "Duplicate": amount and normalized description must match
        // exactly, so bucketing by that pair first turns an O(n²)
        // all-pairs scan of all transactions into all-pairs scans of just
        // the (typically tiny) groups that could possibly match — the
        // ±3-day date check is the only thing still checked pairwise,
        // and only within a bucket. `amount.to_string()` (not `amount`
        // itself) is the hash key purely to sidestep ever needing to
        // reason about `Decimal`'s own `Hash` impl — two rows here always
        // come from independently-parsed stored strings, so equal values
        // produce equal strings regardless.
        let mut buckets: std::collections::HashMap<(String, String), Vec<&Row>> = std::collections::HashMap::new();
        for row in &all {
            let key = (row.amount.to_string(), normalize_description(&row.description));
            buckets.entry(key).or_default().push(row);
        }
        for group in buckets.values() {
            for i in 0..group.len() {
                for j in (i + 1)..group.len() {
                    let a = group[i];
                    let b = group[j];
                    if (a.date - b.date).num_days().abs() > 3 {
                        continue;
                    }
                    result.push(AnomalyFlag {
                        transaction_id: a.id,
                        kind: "duplicate".to_string(),
                        detail: format!("Possible duplicate of the {} transaction on {}", b.description, b.date),
                    });
                    result.push(AnomalyFlag {
                        transaction_id: b.id,
                        kind: "duplicate".to_string(),
                        detail: format!("Possible duplicate of the {} transaction on {}", a.description, a.date),
                    });
                }
            }
        }

        Ok(result)
    }

    /// Records that the user looked at one flag (`kind` is `"large"` or
    /// `"duplicate"`) on one transaction and said it's fine. Only affects
    /// `open_anomaly_flags`; the flag itself is still raised by
    /// `anomaly_flags`. Dismissing the same one twice is harmless.
    pub fn dismiss_anomaly(&self, transaction_id: i64, kind: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO anomaly_dismissals (transaction_id, kind) VALUES (?1, ?2)",
            params![transaction_id, kind],
        )?;
        Ok(())
    }

    /// `anomaly_flags` minus the ones the user has dismissed — what the
    /// Transactions page and the review inbox show. Other features that
    /// build on the full scan (the cash-flow "large expenses" drill-down)
    /// deliberately keep using `anomaly_flags`: dismissing a flag means "not
    /// worth a warning", not "hide this expense everywhere".
    pub fn open_anomaly_flags(&self) -> rusqlite::Result<Vec<AnomalyFlag>> {
        let dismissed: std::collections::HashSet<(i64, String)> = {
            let mut stmt = self.conn.prepare("SELECT transaction_id, kind FROM anomaly_dismissals")?;
            let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        Ok(self
            .anomaly_flags()?
            .into_iter()
            .filter(|f| !dismissed.contains(&(f.transaction_id, f.kind.clone())))
            .collect())
    }

    /// The "large" anomalies (see `anomaly_flags`) dated within
    /// `[start_date, end_date]`, sorted by amount spent, biggest first —
    /// powers the cash-flow chart's per-month drill-down ("what drove this
    /// month's expenses"). Deliberately excludes "duplicate" flags: a
    /// repeated charge isn't a single large expense worth calling out here.
    pub fn large_expenses_in_range(&self, start_date: NaiveDate, end_date: NaiveDate) -> rusqlite::Result<Vec<LargeExpense>> {
        let flags = self.anomaly_flags()?;

        // A lighter, range-scoped query than `all_transactions()` — this
        // only ever needs these five fields to build a `LargeExpense`, not
        // the splits/tags/debt-payment-application info `all_transactions()`
        // also computes. `anomaly_flags()` itself still has to run over
        // full history (a transaction inside the range can still need up
        // to 180 days of *pre-range* history for its own baseline), so
        // only this second fetch gets scoped down.
        let mut stmt = self.conn.prepare(
            "SELECT id, date, description, amount, category FROM transactions
             WHERE date >= ?1 AND date <= ?2
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND deleted_at IS NULL",
        )?;
        let rows = stmt.query_map(params![start_date.to_string(), end_date.to_string()], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;
        let mut by_id: std::collections::HashMap<i64, (NaiveDate, String, Decimal, Option<String>)> = std::collections::HashMap::new();
        for row in rows {
            let (id, date_str, description, amount_str, category) = row?;
            let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            by_id.insert(id, (date, description, amount, category));
        }

        let mut result: Vec<LargeExpense> = flags
            .into_iter()
            .filter(|f| f.kind == "large")
            .filter_map(|f| {
                let (date, description, amount, category) = by_id.get(&f.transaction_id)?;
                Some(LargeExpense {
                    transaction_id: f.transaction_id,
                    date: *date,
                    description: description.clone(),
                    amount: *amount,
                    category: category.clone(),
                    detail: f.detail,
                })
            })
            .collect();
        result.sort_by_key(|a| std::cmp::Reverse(a.amount.abs()));
        Ok(result)
    }

    /// Proactive notes for the Dashboard, combining three signals this
    /// crate already computes elsewhere rather than inventing new
    /// detection logic:
    ///
    /// 1. **Pace**: for each *flexible* budgeted category, projects this
    ///    month's spend forward (`actual * days_in_month/days_elapsed`)
    ///    and flags it if that projection exceeds the budget by more than
    ///    10% — skipped entirely before day 5 of the month, since too
    ///    little of the month has happened yet to project anything
    ///    meaningful from. Scoped to `flexible` specifically (not just
    ///    "not income") because linear day-of-month extrapolation assumes
    ///    spend accrues gradually across the month — true for discretionary
    ///    categories, false for `fixed`/`nonmonthly` ones, which post as a
    ///    single lump sum: a $2,405.94 mortgage payment on the 1st once
    ///    projected as "$2,405.94 / 6 days-elapsed * 30 days-in-month" a
    ///    nonsensical $12,029.70 "on pace to exceed" warning for a bill
    ///    that was already paid in full the moment it posted.
    ///
    ///    A `budget_group` alone doesn't catch every lump-sum category,
    ///    though — a category like "Pet Care" is legitimately flexible
    ///    (vet visits, grooming, a new leash) but in practice often posts
    ///    as one irregular annual-ish charge rather than many small ones
    ///    across the month, which the linear formula still misreads as
    ///    "$298.60 by day 2, so $1,493 by month end." `budget_group` can't
    ///    tell "one-off vet bill" apart from "the first of many restaurant
    ///    charges this month" — only the category's own history can, so
    ///    `average_spend_days_per_active_month` looks at the trailing 3
    ///    calendar months and skips pacing when that category has
    ///    historically landed on fewer than 2 distinct days per month it
    ///    was used at all. A category with no history yet (new, or simply
    ///    unused in those 3 months) falls back to the permissive default
    ///    of still pacing — "no data" must never be mistaken for "always a
    ///    lump sum," or a front-loaded grocery haul would stop warning too.
    /// 2. **Category jump**: reuses `spending_by_category` to compare this
    ///    month-to-date against the *same number of days* at the start of
    ///    the previous month (not the previous month's full total — that
    ///    would make every early-month comparison look like a decrease),
    ///    flagging a rise of more than 30% and more than $50.
    /// 3. **Large expense**: reuses `large_expenses_in_range` (the same
    ///    detection already powering the Cash Flow drill-down) scoped to
    ///    the current month.
    ///
    /// Warnings sort before info, capped at 5 total so the Dashboard card
    /// never turns into another full list to scroll through.
    /// The number of distinct calendar days with any spend in `category`
    /// during one specific calendar month — shared by
    /// `average_spend_days_per_active_month` (trailing months) and
    /// `dashboard_insights` (the current month, when there's no trailing
    /// history to lean on).
    fn distinct_spend_days_in_month(&self, category: &str, year: i32, month: u32) -> rusqlite::Result<i64> {
        let month_key = format!("{year:04}-{month:02}");
        self.conn.query_row(
            "SELECT COUNT(DISTINCT date) FROM (
                SELECT date FROM transactions
                WHERE category = ?1 AND substr(date, 1, 7) = ?2
                      AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                      AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                      AND deleted_at IS NULL
                UNION ALL
                SELECT t.date FROM transaction_splits ts
                JOIN transactions t ON t.id = ts.transaction_id
                WHERE ts.category = ?1 AND substr(t.date, 1, 7) = ?2
                      AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                      AND t.deleted_at IS NULL
             )",
            params![category, month_key],
            |row| row.get(0),
        )
    }

    /// The average number of distinct calendar days with any spend in
    /// `category`, across whichever of the `lookback_months` calendar
    /// months strictly before `before` actually had activity in that
    /// category. Months with no activity at all are excluded rather than
    /// counted as zero — a category that's simply new shouldn't be judged
    /// from an empty month. Returns `None` when none of the lookback
    /// months had any activity, so `dashboard_insights` can fall back to
    /// its own no-history handling instead of treating "no history yet" as
    /// "always a lump sum."
    fn average_spend_days_per_active_month(&self, category: &str, before: NaiveDate, lookback_months: u32) -> rusqlite::Result<Option<f64>> {
        let (mut year, mut month) = (before.year(), before.month());
        let mut active_month_days = Vec::new();
        for _ in 0..lookback_months {
            (year, month) = if month == 1 { (year - 1, 12) } else { (year, month - 1) };
            let days = self.distinct_spend_days_in_month(category, year, month)?;
            if days > 0 {
                active_month_days.push(days as f64);
            }
        }

        if active_month_days.is_empty() {
            return Ok(None);
        }
        let sum: f64 = active_month_days.iter().sum();
        Ok(Some(sum / active_month_days.len() as f64))
    }

    pub fn dashboard_insights(&self, today: NaiveDate) -> rusqlite::Result<Vec<Insight>> {
        let year = today.year();
        let month = today.month();
        let days_elapsed = today.day() as i64;
        let first_of_month = NaiveDate::from_ymd_opt(year, month, 1).expect("valid first-of-month");

        let mut insights = Vec::new();

        if days_elapsed >= 5 {
            let days_in_month = days_in_month(year, month);
            for actual in self.monthly_budget_actuals(year, month)? {
                if actual.budget_group != "flexible" || actual.budgeted <= Decimal::ZERO {
                    continue;
                }
                match self.average_spend_days_per_active_month(&actual.category, first_of_month, 3)? {
                    Some(avg_days) if avg_days < 2.0 => {
                        // Historically a single lump-sum charge a month
                        // (e.g. an occasional vet bill under "Pet Care") —
                        // linear day-of-month extrapolation only makes
                        // sense for spend that actually accrues gradually.
                        continue;
                    }
                    Some(_) => {}
                    None => {
                        // No trailing history at all for this category —
                        // the same ambiguity a genuinely new "Dining Out"
                        // charge has, which must still pace-project off a
                        // single data point (see
                        // `dashboard_insights_flags_a_category_on_pace_to_exceed_its_budget`).
                        // But when the *entire* month-to-date total came
                        // from a single calendar day and already dwarfs
                        // the whole monthly budget on its own, that reads
                        // far more like a one-off big-ticket purchase (new
                        // floors, an appliance) than the start of a
                        // gradual pattern, even with no prior months to
                        // confirm it either way.
                        let single_day_so_far = self.distinct_spend_days_in_month(&actual.category, year, month)? < 2;
                        let dwarfs_budget = actual.actual.abs() >= actual.budgeted * Decimal::from(3);
                        if single_day_so_far && dwarfs_budget {
                            continue;
                        }
                    }
                }
                let projected = actual.actual * Decimal::from(days_in_month) / Decimal::from(days_elapsed);
                let threshold = actual.budgeted * Decimal::new(11, 1); // 1.1x
                if projected > threshold {
                    insights.push(Insight {
                        severity: "warning".to_string(),
                        kind: "pace".to_string(),
                        message: format!(
                            "You're on pace to exceed {} by ${:.2} this month (projected ${:.2} vs a ${:.2} budget).",
                            actual.category,
                            projected - actual.budgeted,
                            projected,
                            actual.budgeted
                        ),
                    });
                }
            }
        }

        let (prev_year, prev_month) = if month == 1 { (year - 1, 12) } else { (year, month - 1) };
        let prev_first = NaiveDate::from_ymd_opt(prev_year, prev_month, 1).expect("valid first-of-previous-month");
        let comparable_days = days_elapsed.min(days_in_month(prev_year, prev_month));
        let current_window_end = first_of_month + chrono::Duration::days(comparable_days - 1);
        let prev_window_end = prev_first + chrono::Duration::days(comparable_days - 1);
        let current_spend = self.spending_by_category(first_of_month, current_window_end)?;
        let prev_spend: std::collections::HashMap<String, Decimal> = self.spending_by_category(prev_first, prev_window_end)?.into_iter().collect();
        let current_map: std::collections::HashMap<&str, Decimal> = current_spend.iter().map(|(c, a)| (c.as_str(), *a)).collect();
        for (category, current_amount) in &current_spend {
            let Some(&previous_amount) = prev_spend.get(category) else { continue };
            if previous_amount <= Decimal::ZERO {
                continue;
            }
            let delta = *current_amount - previous_amount;
            let pct = delta / previous_amount * Decimal::from(100);
            if pct > Decimal::from(30) && delta > Decimal::from(50) {
                insights.push(Insight {
                    severity: "warning".to_string(),
                    kind: "category_jump".to_string(),
                    message: format!("{category} rose {pct:.0}% (${current_amount:.2} vs ${previous_amount:.2}) from last month."),
                });
            }
        }

        // The positive counterpart to the jump check above: a category that
        // dropped notably instead of rising. Walks `prev_spend` (rather
        // than `current_spend`) so a category dropped to *zero* this month
        // — absent from `current_map` entirely — still counts, defaulting
        // to `Decimal::ZERO` rather than being skipped.
        for (category, &previous_amount) in &prev_spend {
            if previous_amount <= Decimal::ZERO {
                continue;
            }
            let current_amount = current_map.get(category.as_str()).copied().unwrap_or(Decimal::ZERO);
            let delta = previous_amount - current_amount;
            let pct = delta / previous_amount * Decimal::from(100);
            if pct > Decimal::from(30) && delta > Decimal::from(50) {
                insights.push(Insight {
                    severity: "positive".to_string(),
                    kind: "category_drop".to_string(),
                    message: format!("Nice work: {category} is down {pct:.0}% (${current_amount:.2} vs ${previous_amount:.2}) from last month."),
                });
            }
        }

        for expense in self.large_expenses_in_range(first_of_month, today)? {
            insights.push(Insight {
                severity: "info".to_string(),
                kind: "large_expense".to_string(),
                message: format!("Unusually large charge: {} — {}", expense.description, expense.detail),
            });
        }

        insights.sort_by_key(|i| match i.severity.as_str() {
            "warning" => 0,
            "info" => 1,
            _ => 2,
        });
        insights.truncate(5);
        Ok(insights)
    }

    /// Logs a recurring bill or income line. `account_id` is purely
    /// informational, same as a bucket's linked account.
    pub fn create_recurring(
        &self,
        merchant: &str,
        category: Option<&str>,
        amount: Decimal,
        cadence: &str,
        anchor_date: NaiveDate,
        account_id: Option<i64>,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![merchant, category, amount.to_string(), cadence, anchor_date.to_string(), account_id],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Replaces every field of an existing recurring item. An unknown id
    /// is a harmless no-op, same convention as everywhere else here.
    // Same reasoning as `create_bucket` above — replaces every field of an
    // existing recurring item, one independent argument per column.
    #[allow(clippy::too_many_arguments)]
    pub fn update_recurring(
        &self,
        id: i64,
        merchant: &str,
        category: Option<&str>,
        amount: Decimal,
        cadence: &str,
        anchor_date: NaiveDate,
        account_id: Option<i64>,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE recurring SET merchant = ?1, category = ?2, amount = ?3, cadence = ?4, anchor_date = ?5, account_id = ?6
             WHERE id = ?7",
            params![merchant, category, amount.to_string(), cadence, anchor_date.to_string(), account_id, id],
        )?;
        Ok(())
    }

    /// Sets (or clears, with `None`) which family member a recurring item is
    /// attributed to. An unknown id is a harmless no-op.
    pub fn set_recurring_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE recurring SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// Every recurring item, each with its next-due date computed fresh
    /// relative to `today` (see `next_occurrence`) rather than trusted
    /// from a stored value, sorted by that next-due date.
    pub fn list_recurring(&self, today: NaiveDate) -> rusqlite::Result<Vec<StoredRecurring>> {
        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.merchant, r.category, r.amount, r.cadence, r.anchor_date, r.account_id, a.name,
                    r.member_id, fm.name, r.status
             FROM recurring r
             LEFT JOIN accounts a ON a.id = r.account_id
             LEFT JOIN family_members fm ON fm.id = r.member_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, String>(10)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (id, merchant, category, amount, cadence, anchor_date_str, account_id, account_name, member_id, member_name, status) = row?;
            let anchor_date = NaiveDate::parse_from_str(&anchor_date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
            result.push(StoredRecurring {
                id,
                merchant,
                category,
                amount: Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
                next_date: next_occurrence(anchor_date, &cadence, today),
                cadence,
                anchor_date,
                account_id,
                account_name,
                member_id,
                member_name,
                status,
            });
        }
        result.sort_by_key(|r| r.next_date);
        Ok(result)
    }

    /// Lines every recurring item up against the transactions actually
    /// posted, for the Recurring tab's paid / pending / missed marks and
    /// price-change alerts.
    ///
    /// A charge belongs to a due date when its description contains the
    /// item's merchant (either case) and it has the same sign, within a
    /// window around the date: up to 3 days early, up to 10 late (fewer for
    /// weekly and biweekly items, so two due dates never share a charge).
    /// Each charge is used for at most one due date. The last 6 due dates
    /// are considered. Transfers, debt-payment bookkeeping rows and deleted
    /// transactions never match.
    ///
    /// The latest due date decides the state — see `RecurringMatch::state`.
    /// A price change needs the recent charges to have been steady: the
    /// latest one is compared with the one before it (or the amount on file
    /// when it is the only one), and only flagged when the two before it were
    /// the same price — so an electric bill that moves every month is never
    /// called out.
    pub fn recurring_matches(&self, today: NaiveDate) -> rusqlite::Result<Vec<RecurringMatch>> {
        const CYCLES: usize = 6;
        let mut stmt = self.conn.prepare(&format!(
            "SELECT t.date, t.amount FROM transactions t
             WHERE t.deleted_at IS NULL AND t.date >= ?2 AND t.date <= ?3
                   AND instr(lower(t.description), lower(?1)) > 0
                   AND (t.category IS NULL OR t.category <> 'Transfer')
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})"
        ))?;

        let mut result = Vec::new();
        for item in self.list_recurring(today)? {
            let merchant = item.merchant.trim();
            let occurrences = recent_occurrences(item.anchor_date, &item.cadence, today, CYCLES);
            let Some(&last_due) = occurrences.last() else {
                result.push(RecurringMatch {
                    recurring_id: item.id,
                    state: "upcoming".to_string(),
                    last_due: None,
                    last_paid_date: None,
                    last_paid_amount: None,
                    price_change: None,
                });
                continue;
            };

            let cycle_days = match item.cadence.as_str() {
                "weekly" => 7,
                "biweekly" => 14,
                "annual" => 365,
                _ => 30,
            };
            let before = (cycle_days / 3).min(3);
            let after = (cycle_days / 2).min(10);

            let mut candidates: Vec<(NaiveDate, Decimal)> = Vec::new();
            if !merchant.is_empty() {
                let window_start = occurrences[0] - chrono::Duration::days(before);
                let rows = stmt.query_map(params![merchant, window_start.to_string(), today.to_string()], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?;
                for row in rows {
                    let (date, amount) = row?;
                    let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid");
                    let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
                    if (amount < Decimal::ZERO) == (item.amount < Decimal::ZERO) {
                        candidates.push((date, amount));
                    }
                }
            }

            // Newest due date first, each taking its closest unused charge.
            let mut matched: Vec<(NaiveDate, NaiveDate, Decimal)> = Vec::new(); // (due, posted, amount)
            for &due in occurrences.iter().rev() {
                let best = candidates
                    .iter()
                    .enumerate()
                    .filter(|(_, (date, _))| *date >= due - chrono::Duration::days(before) && *date <= due + chrono::Duration::days(after))
                    .min_by_key(|(_, (date, _))| ((*date - due).num_days().abs(), std::cmp::Reverse(*date)))
                    .map(|(i, _)| i);
                if let Some(i) = best {
                    let (posted, amount) = candidates.remove(i);
                    matched.push((due, posted, amount));
                }
            }
            matched.sort_by_key(|(due, _, _)| *due);

            let state = if matched.iter().any(|(due, _, _)| *due == last_due) {
                "paid"
            } else if matched.is_empty() {
                "unmatched"
            } else if (today - last_due).num_days() <= after {
                "pending"
            } else {
                "missed"
            };

            let amounts: Vec<Decimal> = matched.iter().map(|(_, _, a)| *a).collect();
            result.push(RecurringMatch {
                recurring_id: item.id,
                state: state.to_string(),
                last_due: Some(last_due),
                last_paid_date: matched.last().map(|(_, posted, _)| *posted),
                last_paid_amount: amounts.last().copied(),
                price_change: detect_price_change(&amounts, item.amount),
            });
        }
        Ok(result)
    }

    /// Removes a recurring item. An unknown id is a harmless no-op.
    pub fn delete_recurring(&self, id: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM recurring WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Sets a recurring item's audit status (`"keep"`/`"reviewing"`/
    /// `"canceled"`) — a dedicated single-field setter, same convention as
    /// `set_recurring_member`. Purely a label for the Recurring tab's audit
    /// view; see the migration's doc comment for why it never suppresses
    /// this item from forecasts or reminders. An unknown id is a harmless
    /// no-op.
    pub fn set_recurring_status(&self, id: i64, status: &str) -> rusqlite::Result<()> {
        self.conn.execute("UPDATE recurring SET status = ?1 WHERE id = ?2", params![status, id])?;
        Ok(())
    }

    /// Total monthly and annual recurring spend/income, normalized onto a
    /// common footing across every cadence — weekly ×52/12 (or ×52 for the
    /// annual figure), biweekly ×26/12 (×26 annual), monthly ×1 (×12
    /// annual), annual ÷12 (×1 annual). Computed in Rust with `Decimal`
    /// rather than client-side, so this repo's only real test coverage for
    /// money math applies here too. Includes every row regardless of
    /// `status` — a "canceled" item is still a real charge until it's
    /// actually deleted (see `set_recurring_status`'s doc comment).
    ///
    /// The weekly/biweekly/annual multipliers are exact fractions (52/12
    /// etc.), which `Decimal` division can only represent to its fixed
    /// precision — summed across several rows that residual can land a
    /// fraction of a cent off a "nice" total (e.g. `303.999...96` instead
    /// of `304.00`). Rounded to the cent at the end, same as every other
    /// dollar figure this app ever displays.
    pub fn recurring_totals(&self) -> rusqlite::Result<RecurringTotals> {
        let mut stmt = self.conn.prepare("SELECT amount, cadence FROM recurring")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;

        let mut totals = RecurringTotals::default();
        for row in rows {
            let (amount_str, cadence) = row?;
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            let monthly = amount * monthly_multiplier(&cadence);
            let annual = amount * annual_multiplier(&cadence);
            if amount < Decimal::ZERO {
                totals.monthly_expense += -monthly;
                totals.annual_expense += -annual;
            } else {
                totals.monthly_income += monthly;
                totals.annual_income += annual;
            }
        }
        totals.monthly_expense = totals.monthly_expense.round_dp(2);
        totals.monthly_income = totals.monthly_income.round_dp(2);
        totals.annual_expense = totals.annual_expense.round_dp(2);
        totals.annual_income = totals.annual_income.round_dp(2);
        Ok(totals)
    }

    /// Scans all transactions for merchant+amount pairs that recur on a
    /// consistent weekly/biweekly/monthly/annual cadence (see
    /// `classify_cadence`) but aren't yet tracked in `recurring` and haven't
    /// been dismissed (see `dismiss_recurring_candidate`) — the offline
    /// equivalent of a "detected subscription" feed. A group needs at least
    /// 3 occurrences before it's considered: too little history to call
    /// anything a pattern otherwise. Sorted most-recent-occurrence first.
    pub fn detect_recurring_candidates(&self, today: NaiveDate) -> rusqlite::Result<Vec<RecurringCandidate>> {
        struct Row {
            date: NaiveDate,
            description: String,
            category: Option<String>,
        }

        let mut stmt = self.conn.prepare(&format!(
            "SELECT date, description, amount, category FROM transactions
                 WHERE deleted_at IS NULL AND (category IS NULL OR category <> 'Transfer')
                       AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL}) ORDER BY date"
        ))?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;

        // Grouped by (normalized description, amount-as-stored) — the same
        // normalization `anomaly_flags`'s duplicate detection already uses,
        // so a varying store-number suffix doesn't split one merchant into
        // several groups.
        let mut groups: std::collections::BTreeMap<(String, String), Vec<Row>> = std::collections::BTreeMap::new();
        for row in rows {
            let (date_str, description, amount_str, category) = row?;
            let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
            let key = (normalize_description(&description), amount_str);
            groups.entry(key).or_default().push(Row { date, description, category });
        }

        let mut existing_recurring: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
        // Lower-cased merchant + direction of every tracked item: a statement
        // line that contains it ("HULU 877-8244858" for "Hulu") is that bill
        // under its bank name, the same rule `recurring_matches` pairs by.
        let mut tracked_merchants: Vec<(String, bool)> = Vec::new();
        let mut stmt = self.conn.prepare("SELECT merchant, amount FROM recurring")?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (merchant, amount) = row?;
            let named = merchant.trim().to_lowercase();
            if !named.is_empty() {
                tracked_merchants.push((named, amount.starts_with('-')));
            }
            existing_recurring.insert((normalize_description(&merchant), amount));
        }

        let mut dismissed: std::collections::HashSet<(String, String, String)> = std::collections::HashSet::new();
        let mut stmt = self.conn.prepare("SELECT merchant, amount, cadence FROM recurring_dismissals")?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))? {
            dismissed.insert(row?);
        }

        let mut result = Vec::new();
        for ((norm_desc, amount_str), mut rows) in groups {
            if rows.len() < 3 {
                continue;
            }
            rows.sort_by_key(|r| r.date);
            let gaps: Vec<i64> = rows.windows(2).map(|w| (w[1].date - w[0].date).num_days()).collect();
            let Some(cadence) = classify_cadence(&gaps) else { continue };
            let last_date = rows.last().expect("checked len >= 3 above").date;
            // A pattern whose most recent occurrence is long overdue (more
            // than 2 cadence periods ago) has likely stopped — e.g. a
            // cancelled subscription — and shouldn't be suggested as if it
            // were still active.
            if (today - last_date).num_days() > cadence_days(cadence) * 2 {
                continue;
            }
            if existing_recurring.contains(&(norm_desc.clone(), amount_str.clone())) {
                continue;
            }
            let statement_line = rows.last().expect("checked len >= 3 above").description.to_lowercase();
            let is_expense = amount_str.starts_with('-');
            if tracked_merchants
                .iter()
                .any(|(merchant, expense)| *expense == is_expense && statement_line.contains(merchant.as_str()))
            {
                continue;
            }
            if dismissed.contains(&(norm_desc, amount_str.clone(), cadence.to_string())) {
                continue;
            }

            let mut category_counts: std::collections::BTreeMap<Option<String>, usize> = std::collections::BTreeMap::new();
            for r in &rows {
                *category_counts.entry(r.category.clone()).or_insert(0) += 1;
            }
            let category = category_counts.into_iter().max_by_key(|(_, count)| *count).and_then(|(cat, _)| cat);

            let last = rows.last().expect("checked len >= 3 above");
            result.push(RecurringCandidate {
                merchant: last.description.clone(),
                category,
                amount: Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid"),
                cadence: cadence.to_string(),
                anchor_date: last.date,
                occurrence_count: rows.len(),
            });
        }
        result.sort_by_key(|a| std::cmp::Reverse(a.anchor_date));
        Ok(result)
    }

    /// Marks a detected pattern as "not actually recurring" so it stops
    /// being suggested — keyed on the same normalized-merchant/amount/
    /// cadence triple `detect_recurring_candidates` groups by. Dismissing
    /// the same candidate twice is a harmless no-op (the underlying table's
    /// primary key already de-duplicates).
    pub fn dismiss_recurring_candidate(&self, merchant: &str, amount: Decimal, cadence: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO recurring_dismissals (merchant, amount, cadence) VALUES (?1, ?2, ?3)",
            params![normalize_description(merchant), amount.to_string(), cadence],
        )?;
        Ok(())
    }

    /// Adds an investment holding. `price` is whatever the caller passes in
    /// at creation time — manually typed, or auto-filled from a live quote
    /// when the optional Alpha Vantage integration is enabled (see
    /// `get_live_price_settings`). Either way it's just a starting value;
    /// `update_holding_price`/`update_holding_prices_for_symbol` are how it
    /// changes afterward.
    // Same reasoning as `create_bucket` above — one independent argument
    // per `holdings` column.
    #[allow(clippy::too_many_arguments)]
    pub fn create_holding(
        &self,
        account_id: i64,
        symbol: &str,
        name: &str,
        shares: Decimal,
        price: Decimal,
        cost_basis: Decimal,
        asset_class: Option<&str>,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                account_id,
                symbol,
                name,
                shares.to_string(),
                price.to_string(),
                cost_basis.to_string(),
                asset_class,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Every holding, each with `value` (`shares * price`) and `gain_loss`
    /// (`value - cost_basis`) computed fresh — never stored, so an
    /// updated price is always immediately reflected in both.
    ///
    /// `today` gates `prev_close`/`day_gain_loss`: a row only reports them
    /// when its `prev_close_date` is actually `today` — i.e. its price was
    /// updated at least once today. A holding last repriced days or weeks
    /// ago still has a `prev_close` sitting in the column (from whenever
    /// that update happened), but surfacing it as "today's" change would
    /// misrepresent a stale multi-day-old baseline as today's move, so it's
    /// treated the same as never having been priced today: `None`.
    pub fn list_holdings(&self, today: NaiveDate) -> rusqlite::Result<Vec<StoredHolding>> {
        let mut stmt = self.conn.prepare(
            "SELECT h.id, h.account_id, a.name, h.symbol, h.name, h.shares, h.price, h.cost_basis, h.asset_class, h.prev_close, h.prev_close_date
             FROM holdings h
             JOIN accounts a ON a.id = h.account_id
             ORDER BY a.name, h.symbol",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
            ))
        })?;

        let today_str = today.to_string();
        let mut result = Vec::new();
        for row in rows {
            let (id, account_id, account_name, symbol, name, shares, price, cost_basis, asset_class, prev_close, prev_close_date) = row?;
            let shares = Decimal::from_str(&shares).expect("shares stored by this crate must be valid");
            let price = Decimal::from_str(&price).expect("price stored by this crate must be valid");
            let cost_basis = Decimal::from_str(&cost_basis).expect("cost_basis stored by this crate must be valid");
            let prev_close = if prev_close_date.as_deref() == Some(today_str.as_str()) {
                prev_close.map(|s| Decimal::from_str(&s).expect("prev_close stored by this crate must be valid"))
            } else {
                None
            };
            let value = shares * price;
            result.push(StoredHolding {
                id,
                account_id,
                account_name,
                symbol,
                name,
                shares,
                price,
                cost_basis,
                asset_class,
                value,
                gain_loss: value - cost_basis,
                prev_close,
                day_gain_loss: prev_close.map(|pc| (price - pc) * shares),
            });
        }
        Ok(result)
    }

    /// Updates a holding's price (the only field expected to change often).
    /// `today` drives the same day-boundary snapshot as
    /// `update_holding_prices_for_symbol` below — see its doc comment for
    /// the mechanics. An unknown id is a harmless no-op.
    pub fn update_holding_price(&self, id: i64, price: Decimal, today: NaiveDate) -> rusqlite::Result<()> {
        let today = today.to_string();
        self.conn.execute(
            "UPDATE holdings
             SET prev_close = CASE WHEN prev_close_date IS NULL OR prev_close_date <> ?1 THEN price ELSE prev_close END,
                 prev_close_date = ?1,
                 price = ?2
             WHERE id = ?3",
            params![today, price.to_string(), id],
        )?;
        Ok(())
    }

    /// Records what every holding is worth in total on `date` (shares times
    /// price, summed), replacing an earlier snapshot of the same day so the
    /// last price of the day wins. Called after each price refresh and
    /// holding change, it builds the portfolio's value history. Returns
    /// whether anything was written — with no holdings there's nothing worth
    /// recording, and a run of zeros would only distort the chart.
    pub fn record_portfolio_snapshot(&self, date: NaiveDate) -> rusqlite::Result<bool> {
        let holdings = self.list_holdings(date)?;
        if holdings.is_empty() {
            return Ok(false);
        }
        let total: Decimal = holdings.iter().map(|h| h.value).sum();
        self.conn.execute(
            "INSERT INTO portfolio_snapshots (date, value) VALUES (?1, ?2)
             ON CONFLICT(date) DO UPDATE SET value = excluded.value",
            params![date.to_string(), total.to_string()],
        )?;
        Ok(true)
    }

    /// The recorded portfolio values, oldest first.
    pub fn portfolio_history(&self) -> rusqlite::Result<Vec<(NaiveDate, Decimal)>> {
        let mut stmt = self.conn.prepare("SELECT date, value FROM portfolio_snapshots ORDER BY date")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        let mut history = Vec::new();
        for row in rows {
            let (date, value) = row?;
            history.push((
                NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                Decimal::from_str(&value).expect("value stored by this crate must be valid"),
            ));
        }
        Ok(history)
    }

    /// Sets the share of the portfolio the user wants in an asset class
    /// (a percentage, capped at 100). Zero or less removes the target, since
    /// "no target" and "0%" would only differ by an empty row nobody asked for.
    pub fn set_allocation_target(&self, asset_class: &str, percent: Decimal) -> rusqlite::Result<()> {
        if percent <= Decimal::ZERO {
            self.conn
                .execute("DELETE FROM allocation_targets WHERE asset_class = ?1", params![asset_class])?;
            return Ok(());
        }
        let percent = percent.min(Decimal::from(100));
        self.conn.execute(
            "INSERT INTO allocation_targets (asset_class, percent) VALUES (?1, ?2)
             ON CONFLICT(asset_class) DO UPDATE SET percent = excluded.percent",
            params![asset_class, percent.to_string()],
        )?;
        Ok(())
    }

    /// Every asset class with a target, alphabetical.
    pub fn list_allocation_targets(&self) -> rusqlite::Result<Vec<(String, Decimal)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT asset_class, percent FROM allocation_targets ORDER BY asset_class")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        let mut targets = Vec::new();
        for row in rows {
            let (asset_class, percent) = row?;
            targets.push((
                asset_class,
                Decimal::from_str(&percent).expect("percent stored by this crate must be valid"),
            ));
        }
        Ok(targets)
    }

    /// Removes a holding. An unknown id is a harmless no-op.
    pub fn delete_holding(&self, id: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM holdings WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Every distinct symbol currently held, across every account — the
    /// list a live-price refresh fetches one quote per, regardless of how
    /// many holdings (or accounts) share that symbol.
    pub fn list_distinct_holding_symbols(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT DISTINCT symbol FROM holdings ORDER BY symbol")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect()
    }

    /// Applies one fetched quote to every holding of that symbol at once
    /// (a symbol can appear in more than one account) — the counterpart to
    /// `update_holding_price`, which targets a single holding by id. Returns
    /// how many rows were touched; an unknown symbol is a harmless no-op.
    ///
    /// **Day-gain/loss snapshot**: `prev_close` is only overwritten (to the
    /// row's *pre-update* `price`) when `prev_close_date` isn't already
    /// `today` — the first price update of the calendar day pins today's
    /// baseline, and every later update the same day updates `price`
    /// without disturbing that baseline, so `list_holdings`'s
    /// `day_gain_loss` reflects the full day's movement rather than just
    /// the latest refresh's delta. The `CASE` runs against each row's old
    /// `price`/`prev_close_date` — SQLite (like standard SQL `UPDATE`)
    /// evaluates every `SET` expression against the pre-update row, so
    /// referencing `price` here and assigning it below in the same
    /// statement is safe, not a read-after-write bug.
    pub fn update_holding_prices_for_symbol(&self, symbol: &str, price: Decimal, today: NaiveDate) -> rusqlite::Result<usize> {
        let today = today.to_string();
        self.conn.execute(
            "UPDATE holdings
             SET prev_close = CASE WHEN prev_close_date IS NULL OR prev_close_date <> ?1 THEN price ELSE prev_close END,
                 prev_close_date = ?1,
                 price = ?2
             WHERE symbol = ?3",
            params![today, price.to_string(), symbol],
        )
    }

    /// The opt-in live-price feature's current state. No row exists in
    /// `live_price_settings` until the user actually saves an API key —
    /// this returns the "off" state rather than synthesizing one, so a
    /// profile that never touches this feature has nothing written to its
    /// database for it (same lazy-write principle as the rest of this
    /// app's optional features).
    pub fn get_live_price_settings(&self) -> rusqlite::Result<StoredLivePriceSettings> {
        let row = match self.conn.query_row(
            "SELECT api_key, provider, last_refreshed_at FROM live_price_settings WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        let (api_key, provider, last_refreshed_at) = row.unwrap_or((None, "alpha_vantage".to_string(), None));
        let last_refreshed_at =
            last_refreshed_at.map(|s| NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M:%S").expect("timestamp stored by this crate must be valid"));
        Ok(StoredLivePriceSettings {
            api_key,
            provider,
            last_refreshed_at,
        })
    }

    /// Sets (or, with `api_key: None`, clears/disables) the live-price
    /// feature's provider and API key together — a key is never stored
    /// disassociated from which provider it belongs to. Disabling still
    /// writes `provider` (only `api_key` clears) so Settings can
    /// pre-select the last-used provider if the user re-enables later.
    /// Clearing the key does not touch `last_refreshed_at` or any holding
    /// price already on record — it only stops future refreshes from
    /// happening.
    pub fn set_live_price_settings(&self, provider: &str, api_key: Option<&str>) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO live_price_settings (id, provider, api_key) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET provider = ?1, api_key = ?2",
            params![provider, api_key],
        )?;
        Ok(())
    }

    /// Records when a live-price refresh last ran (regardless of whether
    /// every symbol in it succeeded) — shown in Settings so the user can
    /// see the feature is actually working.
    pub fn set_live_prices_last_refreshed(&self, at: NaiveDateTime) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO live_price_settings (id, last_refreshed_at) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET last_refreshed_at = ?1",
            params![at.format("%Y-%m-%d %H:%M:%S").to_string()],
        )?;
        Ok(())
    }

    /// No row yet means nobody has ever touched a toggle — defaults to
    /// every feature on, matching how each of these three already behaved
    /// before this setting existed.
    pub fn get_app_settings(&self) -> rusqlite::Result<StoredAppSettings> {
        let row = match self.conn.query_row(
            "SELECT apply_to_debt_enabled, split_purchases_enabled, envelope_caps_enabled, rollover_enabled FROM app_settings WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, bool>(0)?,
                    row.get::<_, bool>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, bool>(3)?,
                ))
            },
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        let (apply_to_debt_enabled, split_purchases_enabled, envelope_caps_enabled, rollover_enabled) = row.unwrap_or((true, true, true, true));
        Ok(StoredAppSettings {
            apply_to_debt_enabled,
            split_purchases_enabled,
            envelope_caps_enabled,
            rollover_enabled,
        })
    }

    /// See the doc comment on `StoredAppSettings` — off means no unspent
    /// budget is carried into a later month; every category's stored
    /// rollover choice and every budget row stays exactly as it was.
    pub fn set_rollover_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, rollover_enabled) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET rollover_enabled = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    pub fn set_apply_to_debt_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, apply_to_debt_enabled) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET apply_to_debt_enabled = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    pub fn set_split_purchases_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, split_purchases_enabled) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET split_purchases_enabled = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    /// See the doc comment on `StoredAppSettings` — this suspends the cap
    /// tier's effect in `budget_alerts_for_month` without touching any
    /// category's stored `cap_enabled` flag.
    pub fn set_envelope_caps_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, envelope_caps_enabled) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET envelope_caps_enabled = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    pub fn get_background_settings(&self) -> rusqlite::Result<BackgroundSettings> {
        match self
            .conn
            .query_row("SELECT tray_enabled, autostart_enabled FROM app_settings WHERE id = 1", [], |row| {
                Ok((row.get::<_, bool>(0)?, row.get::<_, bool>(1)?))
            }) {
            Ok((tray_enabled, autostart_enabled)) => Ok(BackgroundSettings {
                tray_enabled,
                autostart_enabled,
            }),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(BackgroundSettings {
                tray_enabled: false,
                autostart_enabled: false,
            }),
            Err(e) => Err(e),
        }
    }

    pub fn set_tray_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, tray_enabled) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET tray_enabled = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    pub fn set_autostart_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO app_settings (id, autostart_enabled) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET autostart_enabled = ?1",
            params![enabled],
        )?;
        Ok(())
    }

    /// Bills that fall due within `window_days` of `today` (a zero window is
    /// just today) and haven't been reminded about for that due date: only
    /// active bills (money out, not canceled), and never one due today whose
    /// charge has already posted. Soonest first. Each is sent once per due
    /// date — `mark_reminder_sent` records it, and the bill's next cycle is a
    /// new due date and a new reminder.
    pub fn reminders_to_send(&self, today: NaiveDate, window_days: i64) -> rusqlite::Result<Vec<BillReminder>> {
        let horizon = today + chrono::Duration::days(window_days);
        let already_posted_today: std::collections::HashSet<i64> = self
            .recurring_matches(today)?
            .into_iter()
            .filter(|m| m.state == "paid" && m.last_due == Some(today))
            .map(|m| m.recurring_id)
            .collect();
        let mut sent: std::collections::HashSet<(i64, String)> = std::collections::HashSet::new();
        {
            let mut stmt = self.conn.prepare("SELECT recurring_id, due_date FROM reminders_sent")?;
            let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
            for row in rows {
                sent.insert(row?);
            }
        }

        Ok(self
            .list_recurring(today)?
            .into_iter()
            .filter(|r| r.status != "canceled" && r.amount < Decimal::ZERO)
            .filter(|r| r.next_date >= today && r.next_date <= horizon)
            .filter(|r| !(r.next_date == today && already_posted_today.contains(&r.id)))
            .filter(|r| !sent.contains(&(r.id, r.next_date.to_string())))
            .map(|r| BillReminder {
                recurring_id: r.id,
                merchant: r.merchant,
                amount: r.amount,
                due_date: r.next_date,
            })
            .collect())
    }

    /// Records that the reminder for this bill and due date went out, so it
    /// isn't sent again. Recording twice is harmless.
    pub fn mark_reminder_sent(&self, recurring_id: i64, due_date: NaiveDate, today: NaiveDate) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO reminders_sent (recurring_id, due_date, sent_on) VALUES (?1, ?2, ?3)",
            params![recurring_id, due_date.to_string(), today.to_string()],
        )?;
        Ok(())
    }

    /// The second folder backups are also copied to, if the user chose one.
    /// A separate getter/setter rather than a field on `StoredAppSettings`,
    /// so that struct's many existing constructors and call sites stay put.
    pub fn get_backup_copy_dir(&self) -> rusqlite::Result<Option<String>> {
        match self.conn.query_row("SELECT backup_copy_dir FROM app_settings WHERE id = 1", [], |row| {
            row.get::<_, Option<String>>(0)
        }) {
            Ok(dir) => Ok(dir.filter(|d| !d.trim().is_empty())),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Sets (or, with `None` or a blank string, clears) the second backup
    /// folder. Only stores the choice — `backups::mirror_backup` is what
    /// checks the folder is actually usable.
    pub fn set_backup_copy_dir(&self, dir: Option<&str>) -> rusqlite::Result<()> {
        let dir = dir.map(str::trim).filter(|d| !d.is_empty());
        self.conn.execute(
            "INSERT INTO app_settings (id, backup_copy_dir) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET backup_copy_dir = ?1",
            params![dir],
        )?;
        Ok(())
    }

    /// How many live-price requests have been sent today (`today`'s local
    /// calendar day). A pure read — rolls back over to 0 whenever the
    /// stored count is from an earlier day, but doesn't write anything;
    /// `record_live_price_request` is the only thing that actually persists
    /// the rollover. No row at all also just means 0, same as every other
    /// lazily-created live-price setting.
    pub fn live_price_requests_used_today(&self, today: NaiveDate) -> rusqlite::Result<i64> {
        let row = match self.conn.query_row(
            "SELECT requests_used_today, requests_count_date FROM live_price_settings WHERE id = 1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        let Some((count, count_date)) = row else {
            return Ok(0);
        };
        let is_today = count_date.as_deref() == Some(today.format("%Y-%m-%d").to_string().as_str());
        Ok(if is_today { count } else { 0 })
    }

    /// Records one live-price request actually sent to Alpha Vantage today
    /// — rolling the counter over to 1 (not incrementing) if the stored
    /// count is from an earlier day — and returns the new total. Called
    /// once per request regardless of whether it succeeded, returned no
    /// data, or hit Alpha Vantage's own rate limit; it still spent one of
    /// today's free-tier requests either way.
    pub fn record_live_price_request(&self, today: NaiveDate) -> rusqlite::Result<i64> {
        let next = self.live_price_requests_used_today(today)? + 1;
        self.conn.execute(
            "INSERT INTO live_price_settings (id, requests_used_today, requests_count_date) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET requests_used_today = ?1, requests_count_date = ?2",
            params![next, today.format("%Y-%m-%d").to_string()],
        )?;
        Ok(next)
    }

    /// Adds a manually-tracked asset (see `StoredAsset`). `asset_type` is a
    /// free string, same convention as `budget_group` — the UI suggests
    /// "real_estate"/"vehicle"/"other" but nothing here enforces it.
    pub fn create_asset(&self, name: &str, asset_type: &str, value: Decimal, valued_on: NaiveDate, notes: Option<&str>) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO assets (name, asset_type, value, valued_on, notes) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![name, asset_type, value.to_string(), valued_on.to_string(), notes],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Every manually-tracked asset, alphabetical by name.
    pub fn list_assets(&self) -> rusqlite::Result<Vec<StoredAsset>> {
        let mut stmt = self.conn.prepare(
            "SELECT a.id, a.name, a.asset_type, a.value, a.valued_on, a.notes, a.member_id, fm.name
             FROM assets a
             LEFT JOIN family_members fm ON fm.id = a.member_id
             ORDER BY a.name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (id, name, asset_type, value, valued_on, notes, member_id, member_name) = row?;
            result.push(StoredAsset {
                id,
                name,
                asset_type,
                value: Decimal::from_str(&value).expect("value stored by this crate must be valid"),
                valued_on: NaiveDate::parse_from_str(&valued_on, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                notes,
                member_id,
                member_name,
            });
        }
        Ok(result)
    }

    /// Updates an asset's value and the date it was valued as of — the
    /// only fields expected to change over time. An unknown id is a
    /// harmless no-op.
    pub fn update_asset_value(&self, id: i64, value: Decimal, valued_on: NaiveDate) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE assets SET value = ?1, valued_on = ?2 WHERE id = ?3",
            params![value.to_string(), valued_on.to_string(), id],
        )?;
        Ok(())
    }

    /// Sets (or clears, with `None`) which family member an asset is
    /// attributed to. An unknown id is a harmless no-op.
    pub fn set_asset_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE assets SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// Removes an asset. An unknown id is a harmless no-op.
    pub fn delete_asset(&self, id: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM assets WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// The sum of every manually-tracked asset's current value.
    ///
    /// **Deliberately not part of `net_worth_as_of`/net worth history**: an
    /// asset here carries only a current value with no history, so
    /// retroactively applying today's value to every past point on the net
    /// worth trend chart would misrepresent history. Callers that want a
    /// "right now, including assets" figure (the Dashboard/Reports net
    /// worth headline) add this on top of the *current* `net_worth_as_of`
    /// result themselves, rather than this crate baking it into the
    /// historical series.
    pub fn total_assets_value(&self) -> rusqlite::Result<Decimal> {
        let mut stmt = self.conn.prepare("SELECT value FROM assets")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut total = Decimal::ZERO;
        for row in rows {
            total += Decimal::from_str(&row?).expect("value stored by this crate must be valid");
        }
        Ok(total)
    }

    /// Copies this database to `dest_path` using SQLite's own online
    /// backup API — safe to call against a live connection (unlike a raw
    /// `fs::copy`, which risks copying a half-written page or missing a
    /// `-wal`/`-shm` sidecar file if the database is in WAL mode). Used by
    /// both the "move my data file" flow and automatic local backups.
    ///
    /// `pages_per_step` is `i32::MAX` — copy everything in one
    /// `sqlite3_backup_step` call — not the small, slowly-paced batches
    /// `run_to_completion`'s own example usage suggests. That pacing
    /// exists to let a *concurrent* writer on another connection get a
    /// turn between steps; this app has no such writer to yield to (every
    /// `Store` method, backups included, only ever runs from behind the
    /// one app-wide `AppStateHandle` mutex — see `commands.rs`), so it was
    /// pure overhead: 5 pages/step with a 50ms pause between steps cost
    /// roughly 10ms of sleep *per page*, measured taking over 20 seconds
    /// against a real 50,000-transaction database and — since every
    /// caller here holds that same mutex for the call's whole duration —
    /// blocking every other command in the app for that entire stretch,
    /// including the automatic backup this crate's own callers run
    /// synchronously before the app's very first window can open. A
    /// single step removes the pacing loop's sleeps entirely (the loop
    /// exits via `Done` on the first call, before `pause_between_pages` is
    /// ever reached — see `run_to_completion`'s own source), leaving only
    /// the real I/O cost, without changing anything about *what* gets
    /// copied or the destination file's correctness.
    pub fn backup_to(&self, dest_path: impl AsRef<Path>) -> rusqlite::Result<()> {
        let mut dest = Connection::open(dest_path)?;
        let backup = rusqlite::backup::Backup::new(&self.conn, &mut dest)?;
        backup.run_to_completion(i32::MAX, std::time::Duration::ZERO, None)?;
        Ok(())
    }

    /// Simulates paying down every debt account (credit or loan, matching
    /// `AccountType::group`) month by month, applying `minimum_payments`
    /// (an account not present defaults to a $0 minimum) plus
    /// `extra_monthly_payment` to whichever debt `strategy` prioritizes —
    /// `"avalanche"` targets the highest `interest_rate` first (a missing
    /// rate counts as 0% for both accrual and ordering), anything else
    /// (including `"snowball"`) targets the smallest current balance
    /// first, same lenient fallback convention as `next_occurrence`'s
    /// cadence matching.
    ///
    /// Interest accrues monthly (`rate / 1200`, i.e. APR/12 as a
    /// fraction) before that month's payments are applied. Once a debt's
    /// minimum is no longer needed (it's paid off), that minimum rolls
    /// into the extra-payment pool for every subsequent month — the
    /// defining trait of a real snowball/avalanche plan, not just a set of
    /// independent payoff timers.
    ///
    /// Capped at 600 months (50 years): a debt that never clears within
    /// that (minimum too small to outpace interest) reports `payoff_date:
    /// None`, and the whole plan's `total_months` is `None` too.
    pub fn debt_payoff_projection(
        &self,
        strategy: &str,
        extra_monthly_payment: Decimal,
        minimum_payments: &[(i64, Decimal)],
        today: NaiveDate,
    ) -> rusqlite::Result<DebtPayoffPlan> {
        const CAP_MONTHS: u32 = 600;

        struct Debt {
            account_id: i64,
            name: String,
            starting_balance: Decimal,
            owed: Decimal,
            rate: Decimal,
            minimum: Decimal,
            interest_paid: Decimal,
            payoff_month: Option<u32>,
        }

        let minimums: std::collections::HashMap<i64, Decimal> = minimum_payments.iter().cloned().collect();

        let mut debts: Vec<Debt> = self
            .list_accounts(today)?
            .into_iter()
            .filter(|a| matches!(a.account.account_type.group(), "credit" | "loan"))
            .filter(|a| !a.excluded_from_debt_payoff)
            .filter_map(|a| {
                let owed = match a.account.account_type.group() {
                    "credit" => a.starting_balance - a.current_balance,
                    _ => a.current_balance,
                };
                if owed <= Decimal::ZERO {
                    return None;
                }
                Some(Debt {
                    account_id: a.id,
                    name: a.account.name,
                    starting_balance: owed,
                    owed,
                    rate: a.interest_rate.unwrap_or(Decimal::ZERO),
                    minimum: minimums.get(&a.id).copied().unwrap_or(Decimal::ZERO),
                    interest_paid: Decimal::ZERO,
                    payoff_month: None,
                })
            })
            .collect();

        if debts.is_empty() {
            return Ok(DebtPayoffPlan {
                per_account: Vec::new(),
                total_months: Some(0),
                total_interest_paid: Decimal::ZERO,
            });
        }

        let mut freed_minimums = Decimal::ZERO;
        let mut month = 0u32;
        while debts.iter().any(|d| d.owed > Decimal::ZERO) && month < CAP_MONTHS {
            month += 1;

            for d in debts.iter_mut() {
                if d.owed <= Decimal::ZERO {
                    continue;
                }
                let interest = d.owed * d.rate / Decimal::from(1200);
                d.owed += interest;
                d.interest_paid += interest;
            }

            match strategy {
                "avalanche" => debts.sort_by(|a, b| b.rate.cmp(&a.rate).then_with(|| a.owed.cmp(&b.owed))),
                _ => debts.sort_by_key(|a| a.owed),
            }

            for d in debts.iter_mut() {
                if d.owed <= Decimal::ZERO {
                    continue;
                }
                let pay = d.minimum.min(d.owed);
                d.owed -= pay;
            }

            let mut pool = extra_monthly_payment + freed_minimums;
            for d in debts.iter_mut() {
                if pool <= Decimal::ZERO {
                    break;
                }
                if d.owed <= Decimal::ZERO {
                    continue;
                }
                let pay = pool.min(d.owed);
                d.owed -= pay;
                pool -= pay;
            }

            for d in debts.iter_mut() {
                if d.owed <= Decimal::ZERO && d.payoff_month.is_none() {
                    d.payoff_month = Some(month);
                    freed_minimums += d.minimum;
                }
            }
        }

        let total_months = if debts.iter().all(|d| d.payoff_month.is_some()) {
            debts.iter().map(|d| d.payoff_month.unwrap()).max()
        } else {
            None
        };
        let total_interest_paid = debts.iter().map(|d| d.interest_paid).sum();

        let per_account = debts
            .into_iter()
            .map(|d| DebtPayoffLine {
                account_id: d.account_id,
                account_name: d.name,
                starting_balance: d.starting_balance,
                payoff_date: d.payoff_month.map(|m| add_months(today, m)),
                total_interest_paid: d.interest_paid,
            })
            .collect();

        Ok(DebtPayoffPlan {
            per_account,
            total_months,
            total_interest_paid,
        })
    }

    /// Projects total cash balance one point per day for `days` days
    /// forward from `today` as a smooth trend — starting balance is the
    /// sum of every "cash"-group account's current balance (checking/
    /// savings only; deliberately not investment/other/debt, since this
    /// answers "can I cover my bills," not total net worth), and the
    /// day-over-day *slope* is the trailing ~90-day observed daily net
    /// cash flow: `(balance today - balance at the start of the window) /
    /// days in that window`.
    ///
    /// Deliberately not based on `Recurring` items: most people don't
    /// bother entering their paycheck as a recurring item, only their
    /// bills, which made an earlier recurring-only version of this always
    /// trend straight down regardless of real income. A window built from
    /// actual transaction history has no such blind spot — real income
    /// already shows up in the observed balance change automatically. The
    /// trade-off is losing the specific-date "rent hits on the 15th" dip
    /// in favor of a smooth trend line.
    ///
    /// The window is capped at 90 days but shrinks to however much history
    /// actually exists (via the account's earliest transaction date) so a
    /// brand-new account with only two weeks of data isn't diluted by 76
    /// days of assumed inactivity. With no transactions at all, the slope
    /// is 0 (flat). `days = 0` returns just today's balance as a single
    /// point.
    pub fn cash_flow_forecast(&self, today: NaiveDate, days: i64) -> rusqlite::Result<Vec<ForecastPoint>> {
        const TRAILING_WINDOW_DAYS: i64 = 90;

        let cash_accounts: Vec<StoredAccount> = self
            .list_accounts(today)?
            .into_iter()
            .filter(|a| a.account.account_type.group() == "cash")
            .collect();
        let starting_balance: Decimal = cash_accounts.iter().map(|a| a.current_balance).sum();

        let earliest_transaction_date: Option<NaiveDate> = self
            .conn
            .query_row("SELECT MIN(date) FROM transactions WHERE deleted_at IS NULL", [], |row| {
                row.get::<_, Option<String>>(0)
            })?
            .map(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").expect("date stored by this crate must be valid"));

        let daily_net = match earliest_transaction_date {
            None => Decimal::ZERO,
            Some(earliest) => {
                let window_start = earliest.max(today - chrono::Duration::days(TRAILING_WINDOW_DAYS));
                let days_elapsed = (today - window_start).num_days().max(1);
                let mut balance_at_window_start = Decimal::ZERO;
                for a in &cash_accounts {
                    balance_at_window_start += self.account_balance_as_of(a.id, a.account.account_type.as_str(), a.starting_balance, window_start)?;
                }
                (starting_balance - balance_at_window_start) / Decimal::from(days_elapsed)
            }
        };

        let mut points = Vec::with_capacity((days + 1).max(1) as usize);
        let mut balance = starting_balance;
        points.push(ForecastPoint { date: today, balance });
        let mut date = today;
        for _ in 0..days {
            date += chrono::Duration::days(1);
            balance += daily_net;
            points.push(ForecastPoint { date, balance });
        }
        Ok(points)
    }

    /// A cash forecast that puts every active Recurring bill and paycheck on
    /// the day it's actually due, instead of smoothing everything into a
    /// straight line the way `cash_flow_forecast` does — so a big bill
    /// shows up as a dip on its due date, and the lowest point before the
    /// next payday is visible.
    ///
    /// Day by day: cash today, plus every recurring occurrence dated on or
    /// before that day, plus the "everyday" baseline — the average daily net
    /// of the trailing ~90 days' *other* activity (see `daily_baseline`):
    /// anything already accounted for as a recurring item (matched by
    /// merchant name, the same normalization `detect_recurring_candidates`
    /// uses), a transfer (category or linked pair), or a debt-payment
    /// bookkeeping row is left out so it isn't counted twice. Credit-card
    /// charges count as spending on the day they happen; loan and
    /// investment accounts are ignored.
    ///
    /// A bill due *today* is taken out of today's point (it hasn't
    /// necessarily hit the account yet), though `start_balance` stays what's
    /// in the accounts right now. Canceled recurring items are skipped.
    /// With nothing active in Recurring the result is exactly
    /// `cash_flow_forecast`'s trend, flagged `uses_recurring: false`.
    pub fn bill_aware_forecast(&self, today: NaiveDate, days: i64) -> rusqlite::Result<BillAwareForecast> {
        const TRAILING_WINDOW_DAYS: i64 = 90;

        let start_balance: Decimal = self
            .list_accounts(today)?
            .into_iter()
            .filter(|a| a.account.account_type.group() == "cash")
            .map(|a| a.current_balance)
            .sum();

        let recurring: Vec<StoredRecurring> = self.list_recurring(today)?.into_iter().filter(|r| r.status != "canceled").collect();
        if recurring.is_empty() {
            return Ok(BillAwareForecast {
                uses_recurring: false,
                start_balance,
                points: self.cash_flow_forecast(today, days)?,
                events: Vec::new(),
                daily_baseline: Decimal::ZERO,
            });
        }

        let end = today + chrono::Duration::days(days);
        // A bill due today whose charge has already posted is in the balance
        // already — counting it again would double it.
        let already_posted_today: std::collections::HashSet<i64> = self
            .recurring_matches(today)?
            .into_iter()
            .filter(|m| m.state == "paid" && m.last_due == Some(today))
            .map(|m| m.recurring_id)
            .collect();
        let mut events = Vec::new();
        for r in &recurring {
            let mut date = next_occurrence(r.anchor_date, &r.cadence, today);
            if date == today && already_posted_today.contains(&r.id) {
                date = next_occurrence(r.anchor_date, &r.cadence, today + chrono::Duration::days(1));
            }
            while date <= end {
                events.push(ForecastEvent {
                    date,
                    label: r.merchant.clone(),
                    amount: r.amount,
                });
                date = next_occurrence(r.anchor_date, &r.cadence, date + chrono::Duration::days(1));
            }
        }
        events.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.label.cmp(&b.label)));

        let daily_baseline = self.everyday_daily_net(today, TRAILING_WINDOW_DAYS, &recurring)?;

        let mut points = Vec::with_capacity((days + 1).max(1) as usize);
        let mut running_events = Decimal::ZERO;
        let mut next_event = 0;
        for day in 0..=days {
            let date = today + chrono::Duration::days(day);
            while next_event < events.len() && events[next_event].date <= date {
                running_events += events[next_event].amount;
                next_event += 1;
            }
            points.push(ForecastPoint {
                date,
                balance: start_balance + running_events + daily_baseline * Decimal::from(day),
            });
        }

        Ok(BillAwareForecast {
            uses_recurring: true,
            start_balance,
            points,
            events,
            daily_baseline,
        })
    }

    /// Average daily net (income minus spending) of the trailing window
    /// ending `today`, counting only activity that *isn't* already a
    /// recurring item — see `bill_aware_forecast`. The window shrinks to
    /// however much history exists, same as `average_monthly_spend`, and is
    /// zero with none.
    fn everyday_daily_net(&self, today: NaiveDate, window_days: i64, recurring: &[StoredRecurring]) -> rusqlite::Result<Decimal> {
        let earliest_transaction_date: Option<NaiveDate> = self
            .conn
            .query_row("SELECT MIN(date) FROM transactions WHERE deleted_at IS NULL", [], |row| {
                row.get::<_, Option<String>>(0)
            })?
            .map(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").expect("date stored by this crate must be valid"));
        let Some(earliest) = earliest_transaction_date else {
            return Ok(Decimal::ZERO);
        };
        let window_start = earliest.max(today - chrono::Duration::days(window_days));
        let days_elapsed = (today - window_start).num_days().max(1);

        let recurring_merchants: std::collections::HashSet<String> = recurring.iter().map(|r| normalize_description(&r.merchant)).collect();

        let mut stmt = self.conn.prepare(&format!(
            "SELECT t.description, t.amount, a.account_type FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.date >= ?1 AND t.date <= ?2
                   AND t.deleted_at IS NULL
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND (t.category IS NULL OR t.category <> 'Transfer')
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})"
        ))?;
        let rows = stmt.query_map(params![window_start.to_string(), today.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })?;

        let mut net = Decimal::ZERO;
        for row in rows {
            let (description, amount, account_type) = row?;
            if recurring_merchants.contains(&normalize_description(&description)) {
                continue;
            }
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            let group = AccountType::parse(&account_type).map(|t| t.group());
            match group {
                Some("cash") => net += amount,
                // A charge on a card is spending on the day it happens; a
                // positive amount on a card is a payment or refund, not income.
                Some("credit") if amount < Decimal::ZERO => net += amount,
                _ => {}
            }
        }
        Ok(net / Decimal::from(days_elapsed))
    }

    /// Average monthly spend (money out only, as a positive number) over
    /// the trailing ~90 days ending `today` — same window-sizing as
    /// `cash_flow_forecast` just above (clamped to however much
    /// transaction history actually exists, via the earliest transaction
    /// date, so a brand-new file isn't diluted by assumed-inactive days),
    /// same income-vs-expense split as `monthly_totals` just below
    /// (`amount < 0` counts as spend). Unlike `cash_flow_forecast`, this
    /// reads transaction amounts directly rather than the balance delta
    /// between two points, since a balance delta can't isolate spend from
    /// income the way this needs to. Powers the Dashboard's runway stat
    /// ("liquid savings ÷ average monthly spend"). With no transactions at
    /// all, returns `Decimal::ZERO` rather than dividing by zero.
    pub fn average_monthly_spend(&self, today: NaiveDate) -> rusqlite::Result<Decimal> {
        const TRAILING_WINDOW_DAYS: i64 = 90;

        let earliest_transaction_date: Option<NaiveDate> = self
            .conn
            .query_row("SELECT MIN(date) FROM transactions WHERE deleted_at IS NULL", [], |row| {
                row.get::<_, Option<String>>(0)
            })?
            .map(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").expect("date stored by this crate must be valid"));

        let Some(earliest) = earliest_transaction_date else {
            return Ok(Decimal::ZERO);
        };
        let window_start = earliest.max(today - chrono::Duration::days(TRAILING_WINDOW_DAYS));
        let days_elapsed = (today - window_start).num_days().max(1);

        let mut stmt = self.conn.prepare(&format!(
            "SELECT amount FROM transactions
             WHERE date >= ?1 AND date <= ?2
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND (category IS NULL OR category <> 'Transfer')
                   AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map(params![window_start.to_string(), today.to_string()], |row| row.get::<_, String>(0))?;
        let mut expense = Decimal::ZERO;
        for row in rows {
            let amount = Decimal::from_str(&row?).expect("amount stored by this crate must be valid");
            if amount < Decimal::ZERO {
                expense -= amount;
            }
        }

        // `expense * 30 / days_elapsed` rather than `expense / (days_elapsed
        // / 30)` — the latter's intermediate division (e.g. 10/30) is a
        // non-terminating decimal, which `Decimal` rounds, so dividing by
        // that rounded value doesn't exactly invert back out (`300 /
        // (10/30)` lands a hair off `900.00`, not on it).
        Ok(expense * Decimal::from(30) / Decimal::from(days_elapsed))
    }

    /// Total income (positive amounts) and total expense (as a positive
    /// "spent" number, from negative amounts) across *every* transaction
    /// in the given month — unlike `monthly_budget_actuals`, not scoped to
    /// budgeted categories, since a cash-flow chart cares about the whole
    /// picture. Excludes `apply_debt_payment`'s generated transactions,
    /// same as `all_transactions` — see its doc comment. Also excludes
    /// anything categorized "Transfer": money moving between the user's own
    /// accounts is neither income nor spending, but with no category
    /// exclusion here it was silently counted as both (once on each side of
    /// the transfer) — inflating this month's income, expense, and any
    /// per-person breakdown built on top of it.
    ///
    /// A positive amount on a credit or loan account is never income
    /// either, regardless of category or whether it's linked through
    /// `apply_debt_payment` — restoring available credit (or, on a loan,
    /// an escrow refund or similar) is a balance adjustment, not new money
    /// coming in. This was the root cause of a real production bug: a
    /// credit card payment recorded as an ordinary deposit (not linked)
    /// inflated a family member's reported income by over 50x. A charge on
    /// either account type (negative) still counts as spending as normal —
    /// only the positive side is excluded here.
    pub fn monthly_totals(&self, year: i32, month: u32) -> rusqlite::Result<(Decimal, Decimal)> {
        let (first, next_first) = month_bounds(year, month);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT t.amount, a.account_type FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.date >= ?1 AND t.date < ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND (t.category IS NULL OR t.category <> 'Transfer')
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND t.deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map(params![first.to_string(), next_first.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut income = Decimal::ZERO;
        let mut expense = Decimal::ZERO;
        for row in rows {
            let (amount_str, account_type) = row?;
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            if amount > Decimal::ZERO {
                if account_type == "credit" || account_type == "loan" {
                    continue;
                }
                income += amount;
            } else if amount < Decimal::ZERO {
                expense -= amount;
            }
        }
        Ok((income, expense))
    }

    /// Same computation as `monthly_totals`, batched across every month in
    /// `[from_year/from_month, to_year/to_month]` (inclusive) in one query
    /// instead of one query per month — used by the Cash Flow page's
    /// trailing-window and custom-range views, both of which otherwise
    /// looped calling `monthly_totals` once per month. A month in the
    /// range with no transactions simply has no entry in the returned map
    /// rather than a `(0, 0)` row — callers already default a missing key
    /// to zero (matching `monthly_totals`'s own zero-activity behavior).
    pub fn monthly_totals_for_range(
        &self,
        from_year: i32,
        from_month: u32,
        to_year: i32,
        to_month: u32,
    ) -> rusqlite::Result<std::collections::HashMap<(i32, u32), (Decimal, Decimal)>> {
        let (range_start, _) = month_bounds(from_year, from_month);
        let (_, range_end) = month_bounds(to_year, to_month);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT t.date, t.amount, a.account_type FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.date >= ?1 AND t.date < ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND (t.category IS NULL OR t.category <> 'Transfer')
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND t.deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map(params![range_start.to_string(), range_end.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })?;

        let mut totals: std::collections::HashMap<(i32, u32), (Decimal, Decimal)> = std::collections::HashMap::new();
        for row in rows {
            let (date_str, amount_str, account_type) = row?;
            let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            let entry = totals.entry((date.year(), date.month())).or_insert((Decimal::ZERO, Decimal::ZERO));
            if amount > Decimal::ZERO {
                if account_type == "credit" || account_type == "loan" {
                    continue;
                }
                entry.0 += amount;
            } else if amount < Decimal::ZERO {
                entry.1 -= amount;
            }
        }
        Ok(totals)
    }

    /// Total spend per category (as positive "spent" numbers) across every
    /// transaction dated within `[start_date, end_date]`, sorted highest
    /// spend first. Uncategorized transactions and income are excluded, as
    /// are `apply_debt_payment`'s generated transactions — see
    /// `all_transactions`'s doc comment — and anything categorized
    /// "Transfer" (a split line included): money moving between the user's
    /// own accounts isn't spending, same as `monthly_totals`.
    pub fn spending_by_category(&self, start_date: NaiveDate, end_date: NaiveDate) -> rusqlite::Result<Vec<(String, Decimal)>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT category, amount FROM transactions
             WHERE category IS NOT NULL AND category <> 'Transfer' AND date >= ?1 AND date <= ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND deleted_at IS NULL
             UNION ALL
             SELECT ts.category, ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category IS NOT NULL AND ts.category <> 'Transfer' AND t.date >= ?1 AND t.date <= ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND t.deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map(params![start_date.to_string(), end_date.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut totals: std::collections::BTreeMap<String, Decimal> = std::collections::BTreeMap::new();
        for row in rows {
            let (category, amount) = row?;
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            if amount < Decimal::ZERO {
                *totals.entry(category).or_insert(Decimal::ZERO) -= amount;
            }
        }
        let mut result: Vec<(String, Decimal)> = totals.into_iter().collect();
        result.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        Ok(result)
    }

    /// What was spent in each category in each month of
    /// `[from_year/from_month, to_year/to_month]` (inclusive): the Reports
    /// page's category-by-month table. Expenses only, as positive numbers;
    /// income, transfers (by category or as a linked pair), debt-payment
    /// bookkeeping rows and deleted transactions are left out, and a split
    /// purchase counts through its lines' own categories — the same rules as
    /// `spending_by_category`. Unlike it, spending with no category shows up
    /// as "Uncategorized", since a table meant to account for the money
    /// shouldn't quietly drop some of it. A month/category with no spend has
    /// no row. Sorted by month, then category.
    pub fn category_spending_by_month(
        &self,
        from_year: i32,
        from_month: u32,
        to_year: i32,
        to_month: u32,
    ) -> rusqlite::Result<Vec<CategoryMonthAmount>> {
        let (range_start, _) = month_bounds(from_year, from_month);
        let (_, range_end) = month_bounds(to_year, to_month);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT substr(date, 1, 7), COALESCE(category, 'Uncategorized'), amount FROM transactions
             WHERE (category IS NULL OR category <> 'Transfer') AND date >= ?1 AND date < ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND deleted_at IS NULL
             UNION ALL
             SELECT substr(t.date, 1, 7), COALESCE(ts.category, 'Uncategorized'), ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE (ts.category IS NULL OR ts.category <> 'Transfer') AND t.date >= ?1 AND t.date < ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND t.deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map(params![range_start.to_string(), range_end.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })?;

        let mut totals: std::collections::BTreeMap<(String, String), Decimal> = std::collections::BTreeMap::new();
        for row in rows {
            let (month, category, amount) = row?;
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            if amount < Decimal::ZERO {
                *totals.entry((month, category)).or_insert(Decimal::ZERO) -= amount;
            }
        }
        Ok(totals
            .into_iter()
            .map(|((month, category), amount)| CategoryMonthAmount { month, category, amount })
            .collect())
    }

    /// The top `limit` merchants by total spend within
    /// `[start_date, end_date]` — "merchant" here is just the raw
    /// transaction description, since this app has no separate normalized
    /// merchant-name concept; a repeat merchant with varying suffixes
    /// (store numbers, etc.) lists as separate entries. Excludes
    /// `apply_debt_payment`'s generated transactions (its "Payment applied
    /// from: ..." description isn't a merchant) — see `all_transactions`'s
    /// doc comment.
    pub fn top_merchants(&self, start_date: NaiveDate, end_date: NaiveDate, limit: usize) -> rusqlite::Result<Vec<(String, Decimal)>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT description, amount FROM transactions
             WHERE date >= ?1 AND date <= ?2
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND (category IS NULL OR category <> 'Transfer')
                   AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map(params![start_date.to_string(), end_date.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut totals: std::collections::BTreeMap<String, Decimal> = std::collections::BTreeMap::new();
        for row in rows {
            let (description, amount) = row?;
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            if amount < Decimal::ZERO {
                *totals.entry(description).or_insert(Decimal::ZERO) -= amount;
            }
        }
        let mut result: Vec<(String, Decimal)> = totals.into_iter().collect();
        result.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        result.truncate(limit);
        Ok(result)
    }

    /// Total net worth *as of* a given date — each account's balance
    /// computed by `account_balance_as_of` (so a monthly reset, if any,
    /// is honored exactly as it would be for "now", and a loan's
    /// transactions are already netted in the "positive = payment"
    /// direction by that function). Cash/investment/other accounts add
    /// their balance as-is; a credit account's `starting_balance` is a
    /// limit (owed starts at $0, so only the change since it —
    /// `balance - starting_balance` — counts); a loan's balance directly
    /// represents what's owed (so it's subtracted in full) — no snapshot
    /// storage beyond `balance_resets` needed, since this is fully
    /// computable from data already on hand for any date, past or
    /// present.
    pub fn net_worth_as_of(&self, as_of: NaiveDate) -> rusqlite::Result<Decimal> {
        Ok(self.net_worth_breakdown_as_of(as_of)?.net_worth)
    }

    /// Same computation as `net_worth_as_of`, but also splits the total
    /// into the groups the Dashboard's stat cards show (cash, debt,
    /// investments) — one account pass shared by all four figures instead
    /// of a separate query per group. `cash`/`debt`/`investments` use the
    /// same per-group contribution convention as `net_worth`: `debt`
    /// (credit + loan combined) is negative-signed, matching how it's
    /// displayed everywhere else in the app.
    pub fn net_worth_breakdown_as_of(&self, as_of: NaiveDate) -> rusqlite::Result<NetWorthBreakdown> {
        let mut breakdown = NetWorthBreakdown::default();
        for account in self.account_contributions_as_of(as_of)? {
            breakdown.net_worth += account.contribution;
            match account.group.as_str() {
                "cash" => breakdown.cash += account.contribution,
                "credit" | "loan" => breakdown.debt += account.contribution,
                "investment" => breakdown.investments += account.contribution,
                _ => {}
            }
        }
        Ok(breakdown)
    }

    /// Every account's own net-worth contribution as of `as_of`, alongside
    /// its name and group — the same per-account values
    /// `net_worth_breakdown_as_of` sums together, kept separate here so a
    /// caller can see which *account* a total is made of, not just the
    /// total itself.
    fn account_contributions_as_of(&self, as_of: NaiveDate) -> rusqlite::Result<Vec<AccountContribution>> {
        let mut stmt = self.conn.prepare("SELECT id, name, account_type, starting_balance FROM accounts")?;
        let accounts: Vec<(i64, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let holdings_value = self.holdings_value_by_account()?;
        let mut result = Vec::with_capacity(accounts.len());
        for (id, name, account_type, starting_balance_str) in accounts {
            let starting_balance = Decimal::from_str(&starting_balance_str).expect("starting_balance stored by this crate must be valid");
            let mut balance = self.account_balance_as_of(id, &account_type, starting_balance, as_of)?;
            let account_type = AccountType::parse(&account_type).expect("account_type stored by this crate must be valid");
            let group = account_type.group();
            // Same holdings-take-priority rule as `list_accounts` — see its
            // comment. Only ever "as of today" in effect: a holding has no
            // historical price record, so its current value is applied at
            // every past date too, same convention `assetsTotal` already
            // uses for Property & Valuables in the Dashboard's own trend
            // chart (a flat approximation is far less misleading than the
            // $0 this used to show throughout).
            if group == "investment"
                && let Some(&value) = holdings_value.get(&id)
            {
                balance = value;
            }
            let contribution = match group {
                "credit" => balance - starting_balance,
                "loan" => -balance,
                _ => balance,
            };
            result.push(AccountContribution {
                account_id: id,
                name,
                group: group.to_string(),
                contribution,
            });
        }
        Ok(result)
    }

    /// Per-account movement in net-worth contribution between two dates —
    /// the "what changed" behind a Dashboard stat card's trend: when the
    /// Debt tile shows "on pace up $500 over 6mo," this is how the app
    /// knows whether that was the car loan or the credit card, rather than
    /// leaving the total unexplained. Sorted by the size of the move
    /// (largest absolute delta first); an account with no change between
    /// the two dates is dropped rather than shown as a $0.00 row.
    pub fn account_contribution_deltas(&self, from: NaiveDate, to: NaiveDate) -> rusqlite::Result<Vec<AccountContributionDelta>> {
        let from_amounts: std::collections::HashMap<i64, Decimal> = self
            .account_contributions_as_of(from)?
            .into_iter()
            .map(|a| (a.account_id, a.contribution))
            .collect();

        let mut result: Vec<AccountContributionDelta> = self
            .account_contributions_as_of(to)?
            .into_iter()
            .filter_map(|a| {
                let from_amount = from_amounts.get(&a.account_id).copied().unwrap_or(Decimal::ZERO);
                let delta = a.contribution - from_amount;
                if delta == Decimal::ZERO {
                    return None;
                }
                Some(AccountContributionDelta {
                    account_id: a.account_id,
                    name: a.name,
                    group: a.group,
                    from_amount,
                    to_amount: a.contribution,
                    delta,
                })
            })
            .collect();
        result.sort_by_key(|a| std::cmp::Reverse(a.delta.abs()));
        Ok(result)
    }
}

/// Net worth split by Dashboard stat-card group — see
/// `Store::net_worth_breakdown_as_of`.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct NetWorthBreakdown {
    pub net_worth: Decimal,
    pub cash: Decimal,
    pub debt: Decimal,
    pub investments: Decimal,
}

/// See `Store::account_contributions_as_of`.
struct AccountContribution {
    account_id: i64,
    name: String,
    group: String,
    contribution: Decimal,
}

/// See `Store::account_contribution_deltas`.
#[derive(Debug, Clone, PartialEq)]
pub struct AccountContributionDelta {
    pub account_id: i64,
    pub name: String,
    pub group: String,
    pub from_amount: Decimal,
    pub to_amount: Decimal,
    pub delta: Decimal,
}

/// Same transaction imported twice into the same account (even from a
/// different file) should collapse to one row, so dedup is keyed on the
/// transaction's own content plus which account it's in — the same
/// content in a different account is a coincidence, not a duplicate.
fn fingerprint(account_id: i64, tx: &Transaction) -> String {
    format!("{}|{}|{}|{}", account_id, tx.date, tx.description.trim().to_lowercase(), tx.amount)
}

/// Normalizes a description for duplicate-detection comparison (see
/// `Store::anomaly_flags`): lowercased, internal whitespace collapsed to
/// single spaces, and a trailing run of digits (a common store/reference
/// number suffix that varies between otherwise-identical charges)
/// stripped along with any space before it.
fn normalize_description(s: &str) -> String {
    let lower = s.trim().to_lowercase();
    let collapsed = lower.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.trim_end_matches(|c: char| c.is_ascii_digit()).trim_end().to_string()
}

/// The four cadences `detect_recurring_candidates` recognizes, as a
/// (name, typical days, tolerance in days) table shared by
/// `classify_cadence` and `cadence_days` — the buckets don't overlap
/// (5-9, 11-17, 25-35, 355-375), so a set of gaps matches at most one.
const CADENCE_BUCKETS: [(&str, i64, i64); 4] = [("weekly", 7, 2), ("biweekly", 14, 3), ("monthly", 30, 5), ("annual", 365, 10)];

/// Classifies a series of day-gaps between consecutive occurrences as one
/// of the four recognized cadences, requiring every gap to fall within
/// that cadence's tolerance of its typical length — an irregular series
/// (gaps that don't consistently cluster around any one target) matches
/// nothing, since it isn't actually a recurring pattern.
fn classify_cadence(gaps: &[i64]) -> Option<&'static str> {
    CADENCE_BUCKETS
        .iter()
        .find(|(_, target, tolerance)| gaps.iter().all(|g| (g - target).abs() <= *tolerance))
        .map(|(name, _, _)| *name)
}

/// The typical day-length of a cadence name, for the "has this pattern
/// gone stale" check in `detect_recurring_candidates`. Panics on an
/// unrecognized name — every caller gets `cadence` from `classify_cadence`,
/// so this should never see anything else.
fn cadence_days(cadence: &str) -> i64 {
    CADENCE_BUCKETS
        .iter()
        .find(|(name, _, _)| *name == cadence)
        .map(|(_, days, _)| *days)
        .expect("cadence must be one produced by classify_cadence")
}

/// The next date on/after `today` that a recurring item lands on, given
/// its anchor date and cadence — computed fresh every call rather than
/// stored, so it never goes stale once an occurrence passes. An anchor
/// still in the future is itself the next occurrence.
fn next_occurrence(anchor: NaiveDate, cadence: &str, today: NaiveDate) -> NaiveDate {
    if anchor >= today {
        return anchor;
    }
    let mut next = anchor;
    match cadence {
        "weekly" => {
            while next < today {
                next += chrono::Duration::days(7);
            }
        }
        "biweekly" => {
            while next < today {
                next += chrono::Duration::days(14);
            }
        }
        "annual" => {
            while next < today {
                next = add_one_year(next);
            }
        }
        _ => {
            // "monthly", and the fallback for anything unrecognized
            while next < today {
                next = add_one_month(next);
            }
        }
    }
    next
}

/// The due dates of a recurring item on or before `today`, oldest first,
/// keeping only the last `max` — stepped the same way `next_occurrence`
/// steps, so the two never disagree about a date. Empty while the anchor is
/// still in the future.
fn recent_occurrences(anchor: NaiveDate, cadence: &str, today: NaiveDate, max: usize) -> Vec<NaiveDate> {
    let mut dates = Vec::new();
    let mut next = anchor;
    while next <= today {
        dates.push(next);
        next = match cadence {
            "weekly" => next + chrono::Duration::days(7),
            "biweekly" => next + chrono::Duration::days(14),
            "annual" => add_one_year(next),
            _ => add_one_month(next),
        };
    }
    let skip = dates.len().saturating_sub(max);
    dates.split_off(skip)
}

/// Two charges count as different prices when they differ by at least 50
/// cents *and* at least 1% — a one-cent rounding wobble isn't a price change.
fn prices_differ(a: Decimal, b: Decimal) -> bool {
    let gap = (a - b).abs();
    let base = b.abs();
    gap >= Decimal::new(50, 2) && base > Decimal::ZERO && gap / base >= Decimal::new(1, 2)
}

/// See `RecurringMatch::price_change`. `amounts` are the matched charges,
/// oldest first; `on_file` is the recurring item's own amount.
fn detect_price_change(amounts: &[Decimal], on_file: Decimal) -> Option<PriceChange> {
    let (&latest, earlier) = amounts.split_last()?;
    let baseline = match earlier.last() {
        Some(&previous) => {
            // With at least two earlier charges, they must agree — otherwise
            // this bill simply varies and there's no "old price" to compare to.
            if earlier.len() >= 2 && prices_differ(earlier[earlier.len() - 2], previous) {
                return None;
            }
            previous
        }
        None => on_file,
    };
    prices_differ(latest, baseline).then_some(PriceChange { from: baseline, to: latest })
}

/// Normalizes one cadence's amount onto a common monthly footing —
/// weekly and biweekly average out to slightly more than 4/2 times a
/// month (52/26 weeks a year, not 48/24), annual divides down to a
/// twelfth. Applied identically to income and expense in
/// `Store::recurring_totals`, fixing a bug in an earlier client-side
/// version that only normalized income this way and silently dropped
/// non-monthly *expenses* from the displayed total entirely.
fn monthly_multiplier(cadence: &str) -> Decimal {
    match cadence {
        "weekly" => Decimal::from(52) / Decimal::from(12),
        "biweekly" => Decimal::from(26) / Decimal::from(12),
        "annual" => Decimal::from(1) / Decimal::from(12),
        _ => Decimal::from(1), // "monthly", and the fallback for anything unrecognized
    }
}

/// Same idea as `monthly_multiplier`, normalized onto a year instead —
/// each computed from its own exact yearly count rather than derived by
/// multiplying the monthly figure by 12, to avoid compounding rounding.
fn annual_multiplier(cadence: &str) -> Decimal {
    match cadence {
        "weekly" => Decimal::from(52),
        "biweekly" => Decimal::from(26),
        "annual" => Decimal::from(1),
        _ => Decimal::from(12), // "monthly", and the fallback for anything unrecognized
    }
}

/// The number of days in a given calendar month — computed as the gap
/// between its first day and the next month's first day, rather than a
/// hand-maintained 30/31/28 table, so leap Februaries fall out for free.
fn days_in_month(year: i32, month: u32) -> i64 {
    let (first, next_first) = month_bounds(year, month);
    (next_first - first).num_days()
}

/// The first day of `year`/`month` and the first day of the month after
/// it — an exclusive-upper-bound range (`date >= first AND date <
/// next_first`) that, unlike `substr(date, 1, 7) = ?`, SQLite can actually
/// use an index on `date` to satisfy.
fn month_bounds(year: i32, month: u32) -> (NaiveDate, NaiveDate) {
    let first = NaiveDate::from_ymd_opt(year, month, 1).expect("valid first-of-month");
    let next_first = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .expect("valid first-of-next-month");
    (first, next_first)
}

/// Adds one calendar month, clamping the day into the target month if it
/// doesn't have that many days (e.g. Jan 31 + 1 month -> Feb 28/29).
fn add_one_month(d: NaiveDate) -> NaiveDate {
    let (mut y, mut m) = (d.year(), d.month());
    m += 1;
    if m > 12 {
        m = 1;
        y += 1;
    }
    let day = d.day();
    (0u32..4)
        .find_map(|back| NaiveDate::from_ymd_opt(y, m, day - back))
        .expect("some valid day exists within 4 days of any day-of-month")
}

/// Adds `n` calendar months by repeated `add_one_month` — `n` is always
/// small in practice (`debt_payoff_projection` caps its simulation at 600
/// months), so the repeated-addition cost is negligible next to the
/// clarity of reusing the same day-clamping logic as everywhere else.
fn add_months(d: NaiveDate, n: u32) -> NaiveDate {
    let mut result = d;
    for _ in 0..n {
        result = add_one_month(result);
    }
    result
}

/// The "YYYY-MM" month key `back` whole months before `year`/`month` (0 =
/// `year`/`month` itself) — plain integer month arithmetic since callers
/// only ever need the key string, not a real calendar date.
fn month_key_back(year: i32, month: u32, back: u32) -> String {
    let total = i64::from(year) * 12 + i64::from(month) - 1 - i64::from(back);
    let y = total.div_euclid(12);
    let m = total.rem_euclid(12) + 1;
    format!("{y:04}-{m:02}")
}

/// Adds one year, clamping Feb 29 -> Feb 28 in a non-leap target year.
fn add_one_year(d: NaiveDate) -> NaiveDate {
    let y = d.year() + 1;
    NaiveDate::from_ymd_opt(y, d.month(), d.day())
        .or_else(|| NaiveDate::from_ymd_opt(y, d.month(), d.day() - 1))
        .expect("Feb 29 -> Feb 28 fallback must exist")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Transaction;
    use chrono::NaiveDate;

    fn tx(date: &str, description: &str, amount: &str) -> Transaction {
        Transaction {
            date: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            description: description.to_string(),
            amount: amount.parse().unwrap(),
            category: None,
        }
    }

    /// A fixed, arbitrary "now" for tests exercising `delete_transaction`/
    /// `delete_account` — `core` never reads the system clock itself (see
    /// `delete_transaction`'s doc comment), so every caller supplies one.
    fn test_now() -> NaiveDateTime {
        NaiveDateTime::parse_from_str("2026-08-20 12:00:00", "%Y-%m-%d %H:%M:%S").unwrap()
    }

    /// Most tests don't care about accounts — just need *an* account id to
    /// save into.
    fn test_account(store: &Store) -> i64 {
        store.get_or_create_account("Test Checking", AccountType::Checking).unwrap()
    }

    /// `list_accounts` now takes a `today` for reset-awareness; tests that
    /// don't care about monthly resets just need *a* date safely after
    /// every transaction date used anywhere in this file.
    fn far_future() -> NaiveDate {
        "2099-12-31".parse().unwrap()
    }

    /// Raw row count in `transactions`, unlike `all_transactions()` this
    /// does *not* exclude `apply_debt_payment`'s generated rows — for
    /// tests asserting on that cascade-delete/creation behavior itself
    /// rather than on what the Transactions tab shows.
    fn raw_transaction_count(store: &Store) -> i64 {
        store.conn.query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0)).unwrap()
    }

    /// The `member_id` of the single transaction on `account_id` — for
    /// tests inspecting an `apply_debt_payment`-generated row directly,
    /// which `all_transactions()` no longer surfaces (see its doc comment).
    fn raw_transaction_member_id(store: &Store, account_id: i64) -> Option<i64> {
        store
            .conn
            .query_row("SELECT member_id FROM transactions WHERE account_id = ?1", params![account_id], |row| {
                row.get(0)
            })
            .unwrap()
    }

    // Schema.

    #[test]
    fn init_schema_creates_every_performance_index_including_the_ones_added_after_migrations() {
        let store = Store::open_in_memory().unwrap();
        let mut stmt = store.conn.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").unwrap();
        let names: std::collections::HashSet<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();

        for expected in [
            "idx_transactions_fingerprint",
            "idx_transactions_account_date",
            "idx_transactions_category_date",
            "idx_transactions_date",
            "idx_budgets_period",
            "idx_transaction_splits_transaction_id",
            "idx_debt_payments_generated_transaction_id",
        ] {
            assert!(names.contains(expected), "expected index {expected} to exist, got {names:?}");
        }
    }

    #[test]
    fn saves_and_reads_back_transactions() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let txns = vec![
            tx("2026-08-20", "Union Realty", "-1850.00"),
            tx("2026-08-26", "Payroll Deposit", "3120.00"),
        ];

        let report = store.save_transactions(account, &txns).unwrap();
        assert_eq!(report.inserted, 2);

        let stored = store.all_transactions().unwrap();
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].transaction.description, "Union Realty");
        assert_eq!(stored[1].transaction.amount, "3120.00".parse().unwrap());
    }

    #[test]
    fn save_transactions_with_ids_returns_each_rows_new_id_in_order() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let txns = vec![
            tx("2026-08-20", "Union Realty", "-1850.00"),
            tx("2026-08-26", "Payroll Deposit", "3120.00"),
        ];

        let ids = store.save_transactions_with_ids(account, &txns).unwrap();

        assert_eq!(ids.len(), 2);
        assert_ne!(ids[0], ids[1]);
        let stored = store.all_transactions().unwrap();
        assert_eq!(stored.iter().find(|s| s.id == ids[0]).unwrap().transaction.description, "Union Realty");
        assert_eq!(stored.iter().find(|s| s.id == ids[1]).unwrap().transaction.description, "Payroll Deposit");
    }

    // Regression test for a real O(n²) bug: `save_transactions_with_ids`
    // used to recompute a full `account_balance_as_of` scan of the account
    // before *and* after every single row it inserted, purely to build a
    // debug-only log line that's discarded unread whenever there's no
    // activity log path (every release build, and this in-memory test
    // store — see `Store::open`/`log_activity`). Importing N transactions
    // into an account that already has many cost O(N × existing-count),
    // not O(N) — a large CSV import into a well-used account measurably
    // took minutes instead of seconds. 2,000 sequential inserts into one
    // account, even in an unoptimized debug test binary, must stay well
    // under a second if the per-row cost is genuinely O(1); the generous
    // 5s ceiling only exists to keep this non-flaky on a loaded CI box —
    // a reintroduced quadratic scan here would blow far past it, not
    // brush up against it.
    #[test]
    fn saving_many_transactions_into_one_account_does_not_cost_quadratic_time() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let txns: Vec<Transaction> = (0..2000).map(|i| tx("2026-01-01", &format!("Transaction {i}"), "-10.00")).collect();

        let start = std::time::Instant::now();
        let ids = store.save_transactions_with_ids(account, &txns).unwrap();
        let elapsed = start.elapsed();

        assert_eq!(ids.len(), 2000);
        assert!(elapsed.as_secs() < 5, "saving 2000 transactions took {elapsed:?} — looks quadratic again");
    }

    #[test]
    fn check_duplicates_flags_a_transaction_already_saved_in_this_account() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let txns = vec![tx("2026-08-20", "Union Realty", "-1850.00")];
        store.save_transactions(account, &txns).unwrap();

        let flags = store.check_duplicates(account, &txns).unwrap();

        assert_eq!(flags, vec![true]);
    }

    #[test]
    fn check_duplicates_distinguishes_new_from_already_seen_in_an_overlapping_batch() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-20", "Union Realty", "-1850.00")]).unwrap();

        let second_batch = vec![
            tx("2026-08-20", "Union Realty", "-1850.00"),     // already saved
            tx("2026-08-21", "Green Leaf Grocers", "-86.42"), // new
        ];
        let flags = store.check_duplicates(account, &second_batch).unwrap();

        assert_eq!(flags, vec![true, false]);
    }

    #[test]
    fn save_transactions_inserts_a_flagged_duplicate_when_asked() {
        // Proves the safety valve genuinely works: the caller can choose to
        // keep a row `check_duplicates` flagged, rather than dedup being
        // silently enforced regardless of what the user wants.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let txns = vec![tx("2026-08-20", "Union Realty", "-1850.00")];

        store.save_transactions(account, &txns).unwrap();
        let second = store.save_transactions(account, &txns).unwrap();

        assert_eq!(second.inserted, 1);
        assert_eq!(store.all_transactions().unwrap().len(), 2);
    }

    #[test]
    fn persists_to_disk_across_reopen() {
        let dir = std::env::temp_dir().join(format!("meadow-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let store = Store::open(&db_path).unwrap();
            let account = test_account(&store);
            store.save_transactions(account, &[tx("2026-08-20", "Union Realty", "-1850.00")]).unwrap();
        } // store (and its connection) dropped here

        let reopened = Store::open(&db_path).unwrap();
        assert_eq!(reopened.all_transactions().unwrap().len(), 1);
        drop(reopened); // release the file handle before cleanup — Windows can't delete an open file

        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn backup_to_copies_every_row_to_a_new_file() {
        let dir = std::env::temp_dir().join(format!("vaultspend-backup-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let source_path = dir.join("source.db");
        let dest_path = dir.join("dest.db");
        for p in [&source_path, &dest_path] {
            if p.exists() {
                std::fs::remove_file(p).unwrap();
            }
        }

        {
            let store = Store::open(&source_path).unwrap();
            let account = test_account(&store);
            store.save_transactions(account, &[tx("2026-08-20", "Union Realty", "-1850.00")]).unwrap();
            store.backup_to(&dest_path).unwrap();
        } // source store dropped here

        let restored = Store::open(&dest_path).unwrap();
        let stored = restored.all_transactions().unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].transaction.description, "Union Realty");
        drop(restored);

        std::fs::remove_file(&source_path).unwrap();
        std::fs::remove_file(&dest_path).unwrap();
    }

    #[test]
    fn looks_like_a_vault_spend_database_accepts_a_real_database_file() {
        let dir = std::env::temp_dir().join(format!("vaultspend-validate-real-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("real.db");
        if path.exists() {
            std::fs::remove_file(&path).unwrap();
        }
        drop(Store::open(&path).unwrap()); // close it before re-opening read-only below

        assert!(looks_like_a_vault_spend_database(&path).is_ok());

        std::fs::remove_file(&path).unwrap();
    }

    /// Regression test for the real bug this function exists to prevent:
    /// `Store::open` migrates a missing table into existence rather than
    /// rejecting the file, so an empty or unrelated SQLite file would look
    /// identical to real data *after* being opened that way. This must be
    /// caught by inspecting the file exactly as found, before that healing
    /// has a chance to run.
    #[test]
    fn looks_like_a_vault_spend_database_rejects_a_file_with_no_matching_tables() {
        let dir = std::env::temp_dir().join(format!("vaultspend-validate-unrelated-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("unrelated.db");
        if path.exists() {
            std::fs::remove_file(&path).unwrap();
        }
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch("CREATE TABLE some_other_apps_table (id INTEGER PRIMARY KEY);")
                .unwrap();
        }

        let result = looks_like_a_vault_spend_database(&path);

        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("accounts"),
            "expected the message to name a missing core table"
        );

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn looks_like_a_vault_spend_database_rejects_a_file_that_isnt_sqlite_at_all() {
        let dir = std::env::temp_dir().join(format!("vaultspend-validate-not-sqlite-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("not-a-database.txt");
        std::fs::write(&path, b"this is plainly not a SQLite file").unwrap();

        assert!(looks_like_a_vault_spend_database(&path).is_err());

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn opening_a_pre_accounts_database_migrates_it_without_losing_data() {
        // Simulates a real database created before Step 11 added accounts:
        // a `transactions` table with no `account_id` column at all.
        let dir = std::env::temp_dir().join(format!("meadow-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_accounts.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    category TEXT,
                    category_source TEXT,
                    fingerprint TEXT NOT NULL UNIQUE
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO transactions (date, description, amount, fingerprint)
                 VALUES ('2026-08-20', 'Union Realty', '-1850.00', 'old-fingerprint')",
                [],
            )
            .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let stored = store.all_transactions().unwrap();

        assert_eq!(stored.len(), 1, "the pre-existing transaction must survive the migration");
        assert_eq!(stored[0].transaction.description, "Union Realty");
        assert!(
            !stored[0].account_name.is_empty(),
            "it should land in some fallback account, not be orphaned"
        );

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn user_can_correct_a_transactions_category() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();

        let stored = store.all_transactions().unwrap();
        assert_eq!(stored[0].transaction.category, Some("Dining Out".to_string()));
        assert_eq!(stored[0].category_source, Some(CategorySource::User));
    }

    #[test]
    fn correcting_again_overwrites_the_previous_category() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.set_category(id, "Groceries", CategorySource::Rule, None).unwrap();
        store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();

        let stored = store.all_transactions().unwrap();
        assert_eq!(stored[0].transaction.category, Some("Dining Out".to_string()));
        assert_eq!(stored[0].category_source, Some(CategorySource::User));
    }

    #[test]
    fn correcting_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        // no transactions saved at all — id 999 doesn't exist
        store.set_category(999, "Dining Out", CategorySource::User, None).unwrap();
    }

    #[test]
    fn a_classifiers_confidence_is_persisted_and_read_back() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Mystery Merchant", "-10.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.set_category(id, "Groceries", CategorySource::Classifier, Some(0.73)).unwrap();

        let stored = store.all_transactions().unwrap();
        assert_eq!(stored[0].confidence, Some(0.73));
    }

    #[test]
    fn a_rule_or_user_categorization_has_no_confidence() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.set_category(id, "Dining Out", CategorySource::Rule, None).unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].confidence, None);
    }

    #[test]
    fn upserted_rules_persist_and_load_back() {
        let store = Store::open_in_memory().unwrap();
        store.upsert_rule("coffee", "Dining Out").unwrap();

        let rules = store.load_rules().unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules.categorize("Local Coffee Shop"), Some("Dining Out".to_string()));
    }

    #[test]
    fn upserting_the_same_pattern_again_updates_rather_than_duplicates() {
        let store = Store::open_in_memory().unwrap();
        store.upsert_rule("Ferrywood Coffee", "Dining Out").unwrap();
        store.upsert_rule("Ferrywood Coffee", "Business Expense").unwrap();

        let rules = store.load_rules().unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules.categorize("Ferrywood Coffee"), Some("Business Expense".to_string()));
    }

    #[test]
    fn a_fresh_store_has_no_persisted_rules() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.load_rules().unwrap().len(), 0);
    }

    #[test]
    fn labeled_history_includes_only_categorized_transactions() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-20", "Ferrywood Coffee", "-6.75"),
                    tx("2026-08-21", "Mystery Merchant", "-10.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Dining Out", CategorySource::User, None).unwrap();
        // ids[1] ("Mystery Merchant") is deliberately left uncategorized

        let history = store.labeled_history().unwrap();
        assert_eq!(history, vec![("Ferrywood Coffee".to_string(), "Dining Out".to_string())]);
    }

    #[test]
    fn labeled_history_excludes_the_classifiers_own_guesses() {
        // A classifier guess is not ground truth — training the *next*
        // classifier on it would let one early wrong guess reinforce
        // itself indefinitely, since every later import's training corpus
        // would include it as if a human had confirmed it.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-20", "Ferrywood Coffee", "-6.75"),
                    tx("2026-08-21", "Mystery Merchant", "-10.00"),
                    tx("2026-08-22", "Another Merchant", "-5.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Dining Out", CategorySource::User, None).unwrap();
        store.set_category(ids[1], "Groceries", CategorySource::Rule, None).unwrap();
        store
            .set_category(ids[2], "Entertainment", CategorySource::Classifier, Some(0.5))
            .unwrap();

        let history = store.labeled_history().unwrap();
        assert_eq!(history.len(), 2, "the classifier's own guess must not become training data");
        assert!(history.contains(&("Ferrywood Coffee".to_string(), "Dining Out".to_string())));
        assert!(history.contains(&("Mystery Merchant".to_string(), "Groceries".to_string())));
    }

    // Category management.

    #[test]
    fn a_fresh_store_already_offers_the_default_category_suggestions() {
        let store = Store::open_in_memory().unwrap();

        let categories = store.list_categories().unwrap();

        assert!(categories.contains(&"Business Expense".to_string()));
        assert!(categories.contains(&"Rent".to_string()));
        assert_eq!(categories.len(), DEFAULT_CATEGORIES.len(), "no transactions yet, so only the defaults");
    }

    #[test]
    fn a_transactions_own_category_column_is_registered_immediately_on_import() {
        // Simulates a file import: the bank's own "Category" column (e.g.
        // Capital One's CSV export) lands straight on the transaction via
        // `save_transactions`, the same insert path `commit_import` uses,
        // never going through `set_category`/`create_category` directly —
        // this must still make it selectable right away, no restart needed.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let mut imported = tx("2026-09-02", "HOMEDEPOT.COM", "-1056.37");
        imported.category = Some("Merchandise".to_string());

        store.save_transactions(account, &[imported]).unwrap();

        assert!(store.list_categories().unwrap().contains(&"Merchandise".to_string()));
    }

    #[test]
    fn a_category_only_a_transaction_still_remembers_is_registered_on_next_launch() {
        // Simulates data that predates this fix (or reached the
        // `transactions` table through some other bypass): the category
        // sits on the row but was never added to the registry.
        let dir = std::env::temp_dir().join(format!("vaultspend-category-backfill-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let store = Store::open(&db_path).unwrap();
            let account = test_account(&store);
            let mut imported = tx("2026-09-02", "HOMEDEPOT.COM", "-1056.37");
            imported.category = Some("Merchandise".to_string());
            store.save_transactions(account, &[imported]).unwrap();

            // Strip the registry entry back out to reproduce the pre-fix state.
            store
                .conn
                .execute("DELETE FROM categories WHERE name = ?1", params!["Merchandise"])
                .unwrap();
            assert!(!store.list_categories().unwrap().contains(&"Merchandise".to_string()));
        } // store (and its connection) dropped here

        let reopened = Store::open(&db_path).unwrap(); // the next real launch, running the fixed code
        assert!(
            reopened.list_categories().unwrap().contains(&"Merchandise".to_string()),
            "a category only ever seen on a transaction must self-heal into the registry on the next launch"
        );
        drop(reopened); // release the file handle before cleanup — Windows can't delete an open file

        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn the_launch_backfill_never_resurrects_a_deliberately_deleted_category() {
        let dir = std::env::temp_dir().join(format!("vaultspend-category-backfill-delete-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let store = Store::open(&db_path).unwrap();
            let account = test_account(&store);
            let ids = store
                .save_transactions_with_ids(account, &[tx("2026-09-02", "Old Merchant", "-10.00")])
                .unwrap();
            store.set_category(ids[0], "Junk", CategorySource::User, None).unwrap();
            store.delete_category("Junk").unwrap(); // nulls the transaction's category too
        }

        let reopened = Store::open(&db_path).unwrap();
        assert!(
            !reopened.list_categories().unwrap().contains(&"Junk".to_string()),
            "a deliberately deleted category must not come back just because the launch backfill ran again"
        );
        drop(reopened);

        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn create_category_makes_a_new_category_selectable_before_anything_uses_it() {
        let store = Store::open_in_memory().unwrap();

        store.create_category("Pet Care", None).unwrap();

        assert!(store.list_categories().unwrap().contains(&"Pet Care".to_string()));
    }

    #[test]
    fn creating_the_same_category_twice_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.create_category("Pet Care", None).unwrap();

        store.create_category("Pet Care", None).unwrap();

        let matches = store.list_categories().unwrap().iter().filter(|c| *c == "Pet Care").count();
        assert_eq!(matches, 1);
    }

    #[test]
    fn assigning_a_brand_new_category_to_a_transaction_registers_it_for_every_other_row() {
        // The original bug this guards against: typing a new category for
        // one transaction didn't make it selectable for any other one.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.set_category(id, "Health", CategorySource::User, None).unwrap();

        assert!(store.list_categories().unwrap().contains(&"Health".to_string()));
    }

    #[test]
    fn rename_category_updates_matching_transactions_and_rules() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
        store.upsert_rule("coffee", "Dining Out").unwrap();

        let affected = store.rename_category("Dining Out", "Food & Drink").unwrap();

        assert_eq!(affected, 1);
        assert_eq!(
            store.all_transactions().unwrap()[0].transaction.category,
            Some("Food & Drink".to_string())
        );
        assert_eq!(
            store.load_rules().unwrap().categorize("Local Coffee Shop"),
            Some("Food & Drink".to_string())
        );
    }

    #[test]
    fn rename_category_carries_its_budget_line_forward() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Dining Out", "0000-01", "150.00".parse().unwrap(), "flexible").unwrap();

        store.rename_category("Dining Out", "Food & Drink").unwrap();

        let budgets = store.list_budgets("0000-01").unwrap();
        assert_eq!(budgets.len(), 1);
        assert_eq!(budgets[0].category, "Food & Drink");
        assert_eq!(budgets[0].monthly_amount, "150.00".parse().unwrap());
    }

    #[test]
    fn renaming_into_a_category_that_already_has_a_budget_keeps_the_targets_budget() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Coffee", "0000-01", "40.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget("Dining Out", "0000-01", "150.00".parse().unwrap(), "flexible").unwrap();

        store.rename_category("Coffee", "Dining Out").unwrap();

        let budgets = store.list_budgets("0000-01").unwrap();
        assert_eq!(
            budgets.len(),
            1,
            "the existing target's budget should win, not be overwritten or duplicated"
        );
        assert_eq!(budgets[0].category, "Dining Out");
        assert_eq!(budgets[0].monthly_amount, "150.00".parse().unwrap());
    }

    /// Regression test for a real bug: renaming a category into a brand
    /// new name used to lose its icon — `INSERT OR IGNORE` created the new
    /// registry row bare, and the old (icon-bearing) row was then deleted.
    #[test]
    fn rename_category_carries_its_icon_forward_to_a_new_name() {
        let store = Store::open_in_memory().unwrap();
        store.create_category("Utilities", Some("utilities")).unwrap();

        store.rename_category("Utilities", "Bills").unwrap();

        let categories = store.list_categories_with_icons().unwrap();
        let bills = categories.iter().find(|c| c.name == "Bills").unwrap();
        assert_eq!(bills.icon_key, Some("utilities".to_string()));
        assert!(categories.iter().all(|c| c.name != "Utilities"));
    }

    #[test]
    fn renaming_into_a_category_that_already_has_an_icon_keeps_the_targets_icon() {
        let store = Store::open_in_memory().unwrap();
        store.create_category("Coffee", Some("groceries")).unwrap();
        store.create_category("Dining Out", Some("restaurant")).unwrap();

        store.rename_category("Coffee", "Dining Out").unwrap();

        let categories = store.list_categories_with_icons().unwrap();
        let dining = categories.iter().find(|c| c.name == "Dining Out").unwrap();
        assert_eq!(
            dining.icon_key,
            Some("restaurant".to_string()),
            "the existing target's icon should win, not be overwritten by the source's"
        );
    }

    #[test]
    fn renaming_into_an_existing_category_with_no_icon_adopts_the_sources_icon() {
        let store = Store::open_in_memory().unwrap();
        store.create_category("Coffee", Some("groceries")).unwrap();
        store.create_category("Dining Out", None).unwrap();

        store.rename_category("Coffee", "Dining Out").unwrap();

        let categories = store.list_categories_with_icons().unwrap();
        let dining = categories.iter().find(|c| c.name == "Dining Out").unwrap();
        assert_eq!(dining.icon_key, Some("groceries".to_string()));
    }

    #[test]
    fn renaming_into_an_existing_category_merges_them() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[tx("2026-08-20", "Ferrywood Coffee", "-6.75"), tx("2026-08-21", "Downtown Cafe", "-12.00")],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Coffee", CategorySource::User, None).unwrap();
        store.set_category(ids[1], "Dining Out", CategorySource::User, None).unwrap();

        store.rename_category("Coffee", "Dining Out").unwrap();

        let categories = store.list_categories().unwrap();
        assert!(!categories.contains(&"Coffee".to_string()), "the merged-away name must be gone");
        assert_eq!(
            categories.iter().filter(|c| *c == "Dining Out").count(),
            1,
            "merging must leave exactly one entry for the target category, not a duplicate"
        );
    }

    #[test]
    fn delete_category_resets_its_transactions_to_uncategorized_and_removes_its_rules() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Dining Out", CategorySource::Classifier, Some(0.9)).unwrap();
        store.upsert_rule("coffee", "Dining Out").unwrap();

        let affected = store.delete_category("Dining Out").unwrap();

        assert_eq!(affected, 1);
        let stored = &store.all_transactions().unwrap()[0];
        assert_eq!(stored.transaction.category, None);
        assert_eq!(stored.category_source, None);
        assert_eq!(stored.confidence, None);
        assert_eq!(
            store.load_rules().unwrap().categorize("Local Coffee Shop"),
            None,
            "a rule that only pointed at the deleted category must not silently recreate it"
        );
        assert!(
            !store.list_categories().unwrap().contains(&"Dining Out".to_string()),
            "a deleted category must not still show up as a suggestion"
        );
    }

    #[test]
    fn delete_category_also_removes_its_budget_line() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Pet Care", "0000-01", "50.00".parse().unwrap(), "flexible").unwrap();

        store.delete_category("Pet Care").unwrap();

        assert_eq!(store.list_budgets("0000-01").unwrap(), vec![]);
    }

    // Accounts.

    #[test]
    fn get_or_create_account_creates_then_reuses_by_name() {
        let store = Store::open_in_memory().unwrap();
        let first = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let second = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

        assert_eq!(first, second, "re-using an existing account name should return the same id");

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].account.name, "Everyday Checking");
        assert_eq!(accounts[0].account.account_type, AccountType::Checking);
    }

    #[test]
    fn find_account_by_name_never_creates_one() {
        let store = Store::open_in_memory().unwrap();
        store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

        assert_eq!(store.find_account_by_name("Nonexistent").unwrap(), None);
        assert!(
            store.find_account_by_name("everyday checking").unwrap().is_some(),
            "lookup should be case-insensitive"
        );
        assert_eq!(
            store.list_accounts(far_future()).unwrap().len(),
            1,
            "a missed lookup must not create anything"
        );
    }

    #[test]
    fn different_account_names_get_different_ids() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let credit = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();

        assert_ne!(checking, credit);
        assert_eq!(store.list_accounts(far_future()).unwrap().len(), 2);
    }

    #[test]
    fn a_new_accounts_starting_balance_defaults_to_zero() {
        let store = Store::open_in_memory().unwrap();
        store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(accounts[0].starting_balance, Decimal::ZERO);
        assert_eq!(accounts[0].current_balance, Decimal::ZERO);
    }

    #[test]
    fn current_balance_reflects_starting_balance_plus_its_own_transactions() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "5000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(
                checking,
                &[
                    tx("2026-08-01", "Payroll Deposit", "3120.00"),
                    tx("2026-08-05", "Green Leaf Grocers", "-86.42"),
                ],
            )
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(accounts[0].starting_balance, "5000.00".parse().unwrap());
        assert_eq!(accounts[0].current_balance, "8033.58".parse().unwrap());
    }

    #[test]
    fn a_credit_accounts_available_credit_moves_with_charges_and_payments() {
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
        store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(
                card,
                &[
                    tx("2026-08-01", "Grocery Store", "-300.00"), // a charge reduces available credit
                    tx("2026-08-15", "Card Payment", "100.00"),   // a payment restores it
                ],
            )
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(
            accounts[0].current_balance,
            "1800.00".parse().unwrap(),
            "2000 limit - 300 charge + 100 payment = 1800 available"
        );
    }

    #[test]
    fn each_accounts_balance_is_independent() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store.set_account_starting_balance(card, "500.00".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-01", "Payroll Deposit", "200.00")])
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        let checking_balance = accounts.iter().find(|a| a.id == checking).unwrap().current_balance;
        let card_balance = accounts.iter().find(|a| a.id == card).unwrap().current_balance;

        assert_eq!(checking_balance, "1200.00".parse().unwrap());
        assert_eq!(card_balance, "500.00".parse().unwrap(), "untouched by checking's transaction");
    }

    #[test]
    fn set_account_starting_balance_updates_it_and_recomputes_current_balance() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        store.set_account_starting_balance(checking, "1500.00".parse().unwrap()).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts[0].starting_balance, "1500.00".parse().unwrap());
        assert_eq!(accounts[0].current_balance, "1500.00".parse().unwrap());
    }

    #[test]
    fn set_account_starting_balance_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.set_account_starting_balance(999, "100.00".parse().unwrap()).unwrap();
    }

    #[test]
    fn set_account_balance_override_becomes_the_new_baseline_going_forward() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-09-05", "Coffee", "-5.00")]).unwrap();

        store
            .set_account_balance_override(checking, "2000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts("2026-09-10".parse().unwrap()).unwrap();
        assert_eq!(
            accounts[0].current_balance,
            "1995.00".parse().unwrap(),
            "override + the transaction dated after it, ignoring the original starting balance entirely"
        );
    }

    #[test]
    fn set_account_balance_override_does_not_change_balance_as_of_a_date_before_it() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-09-01", "Payroll", "500.00")]).unwrap();

        store
            .set_account_balance_override(checking, "9999.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts("2026-09-02".parse().unwrap()).unwrap();
        assert_eq!(
            accounts[0].current_balance,
            "1500.00".parse().unwrap(),
            "a date before the override must be unaffected by it"
        );
    }

    #[test]
    fn set_account_balance_override_on_the_same_day_replaces_rather_than_stacks() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        store
            .set_account_balance_override(checking, "5000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();
        store
            .set_account_balance_override(checking, "3000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
        assert_eq!(accounts[0].current_balance, "3000.00".parse().unwrap());
    }

    #[test]
    fn set_account_balance_override_wins_over_the_current_months_automatic_rollover() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
        store
            .set_account_balance_override(checking, "7500.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
        assert_eq!(
            accounts[0].current_balance,
            "7500.00".parse().unwrap(),
            "the manual override is dated after the monthly rollover's checkpoint, so it must win"
        );
    }

    #[test]
    fn set_account_balance_override_on_an_unknown_account_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store
            .set_account_balance_override(999, "100.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();
    }

    #[test]
    fn set_account_balance_override_nets_out_a_transaction_already_posted_the_same_day() {
        // Reproduces the exact real-world confusion reported: an account
        // already has a same-day transaction (a leftover purchase from
        // testing, not deleted) when the balance is corrected. Typing
        // "$20,000" must show exactly $20,000 immediately — not $18,500,
        // requiring the user to have remembered and mentally subtracted a
        // transaction they may not even recall exists.
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-09-04", "barbor shop", "-1500.00")]).unwrap();

        store
            .set_account_balance_override(checking, "20000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
        assert_eq!(
            accounts[0].current_balance,
            "20000.00".parse().unwrap(),
            "a transaction already posted the same day must be netted out, so the typed amount is exactly what shows"
        );
    }

    #[test]
    fn set_account_balance_override_still_lets_a_new_same_day_transaction_move_the_balance_after_netting() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-09-04", "barbor shop", "-1500.00")]).unwrap();

        store
            .set_account_balance_override(checking, "20000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();
        // A genuinely new transaction, added *after* the correction, dated
        // the same day — must still move the balance from here, exactly
        // like the already-posted one must not.
        store.save_transactions(checking, &[tx("2026-09-04", "Coffee", "-100.00")]).unwrap();

        let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
        assert_eq!(accounts[0].current_balance, "19900.00".parse().unwrap());
    }

    #[test]
    fn set_account_balance_override_nets_out_a_same_day_transaction_on_a_loan_account() {
        // Same scenario as the cash-account version above, but for a loan
        // — where a same-day transaction must be netted the *other*
        // direction (added back, not subtracted) since a loan's
        // current_balance is netted by subtracting transactions, not
        // adding them (see account_balance_as_of).
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store.save_transactions(loan, &[tx("2026-09-04", "Payment", "500.00")]).unwrap();

        store
            .set_account_balance_override(loan, "8000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
        assert_eq!(
            accounts[0].current_balance,
            "8000.00".parse().unwrap(),
            "a payment already posted the same day must be netted out, so the typed amount owed is exactly what shows"
        );
    }

    #[test]
    fn set_account_balance_override_still_lets_a_new_same_day_transaction_move_a_loans_balance_after_netting() {
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store.save_transactions(loan, &[tx("2026-09-04", "Payment", "500.00")]).unwrap();

        store
            .set_account_balance_override(loan, "8000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();
        // A genuinely new payment, added *after* the correction, dated the
        // same day — must still reduce what's owed from here.
        store.save_transactions(loan, &[tx("2026-09-04", "Extra Payment", "200.00")]).unwrap();

        let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
        assert_eq!(accounts[0].current_balance, "7800.00".parse().unwrap());
    }

    #[test]
    fn migrate_flip_loan_transaction_signs_flips_existing_loan_transactions_but_not_others() {
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.save_transactions(checking, &[tx("2026-08-05", "Groceries", "-50.00")]).unwrap();

        // Simulate a pre-flip database: reset the migrated flag and insert
        // a transaction stored under the *old* convention (a loan payment
        // was negative), bypassing save_transactions/apply_debt_payment
        // since both already write under today's flipped convention.
        store
            .conn
            .execute("UPDATE app_settings SET loan_sign_convention_migrated = 0 WHERE id = 1", [])
            .unwrap();
        store
            .conn
            .execute(
                "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint)
                 VALUES (?1, '2026-08-05', 'Old-style Payment', '-500.00', NULL, 'old-style-fp')",
                params![loan],
            )
            .unwrap();

        store.migrate_flip_loan_transaction_signs_if_needed().unwrap();

        let loan_amount: String = store
            .conn
            .query_row("SELECT amount FROM transactions WHERE account_id = ?1", params![loan], |row| row.get(0))
            .unwrap();
        assert_eq!(loan_amount, "500.00", "the old-convention loan transaction must be negated");

        let checking_amount: String = store
            .conn
            .query_row("SELECT amount FROM transactions WHERE account_id = ?1", params![checking], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(checking_amount, "-50.00", "a non-loan account's transactions must be untouched");

        // Idempotent: running it again (as every app launch does) must not
        // flip an already-migrated database a second time.
        store.migrate_flip_loan_transaction_signs_if_needed().unwrap();
        let loan_amount_again: String = store
            .conn
            .query_row("SELECT amount FROM transactions WHERE account_id = ?1", params![loan], |row| row.get(0))
            .unwrap();
        assert_eq!(loan_amount_again, "500.00", "must not flip a second time once already migrated");
    }

    #[test]
    fn set_account_balance_override_counts_a_transaction_dated_the_same_day_added_afterward() {
        // Regression test: a correction and a transaction landing on the
        // exact same calendar date — the correction happens first, then a
        // transaction dated that same day is added afterward — must not
        // silently exclude that transaction (it did, before this test was
        // added: the checkpoint was originally stored dated `as_of` itself,
        // so `date > since_date` filtered out anything dated `as_of` too).
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Rewards Credit Card", AccountType::Credit).unwrap();
        store.set_account_starting_balance(card, "0.00".parse().unwrap()).unwrap();

        store
            .set_account_balance_override(card, "0.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();
        store.save_transactions(card, &[tx("2026-09-04", "test500", "-500.00")]).unwrap();

        let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
        assert_eq!(
            accounts.iter().find(|a| a.id == card).unwrap().current_balance,
            "-500.00".parse().unwrap(),
            "a transaction dated the same day as the override, added afterward, must still count"
        );
    }

    #[test]
    fn set_account_balance_override_ignores_a_soft_deleted_transaction_dated_after_it() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        store
            .set_account_balance_override(checking, "2000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();
        let ids = store
            .save_transactions_with_ids(checking, &[tx("2026-09-05", "Refund", "300.00")])
            .unwrap();
        store.delete_transaction(ids[0], "2026-09-05T12:00:00".parse().unwrap()).unwrap();

        let accounts = store.list_accounts("2026-09-10".parse().unwrap()).unwrap();
        assert_eq!(
            accounts[0].current_balance,
            "2000.00".parse().unwrap(),
            "a soft-deleted transaction dated after the override must not count toward the new baseline either"
        );
    }

    #[test]
    fn a_stale_pre_fix_manual_override_self_heals_on_the_next_launch_with_no_user_action() {
        // Reproduces the exact real-world scenario found via live testing:
        // a balance was corrected by the pre-fix build (checkpoint dated
        // `as_of` itself), the app is later relaunched running the fixed
        // code, and a transaction dated the same day as that old
        // correction is added. The stale row must self-heal the moment
        // the store reopens — the fix must not require the user to
        // manually re-correct the balance to unstick it.
        let dir = std::env::temp_dir().join(format!("vaultspend-stale-override-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("stale_override.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        let checking = {
            let store = Store::open(&db_path).unwrap();
            let id = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
            store.set_account_starting_balance(id, "1000.00".parse().unwrap()).unwrap();
            // Directly simulates what the pre-fix `set_account_balance_override`
            // wrote — bypassing the (now-fixed) method, since it can no
            // longer produce this shape itself.
            store
                .conn
                .execute(
                    "INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?1, 'manual:2026-09-04', '2026-09-04', '20000.00')",
                    params![id],
                )
                .unwrap();
            id
        }; // old store dropped here — simulates the app closing

        let store = Store::open(&db_path).unwrap(); // the next real launch, running the fixed code
        store.save_transactions(checking, &[tx("2026-09-04", "Groceries", "-40.00")]).unwrap();

        let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
        assert_eq!(
            accounts.iter().find(|a| a.id == checking).unwrap().current_balance,
            "19960.00".parse().unwrap(),
            "a stale pre-fix override must self-heal on reopen and count a same-day transaction, with no manual re-correction"
        );

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn migrate_fix_stale_manual_balance_override_reset_dates_leaves_correctly_anchored_rows_alone() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store
            .set_account_balance_override(checking, "5000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();

        // The migration already ran once as part of opening this store;
        // running it again explicitly must be a genuine no-op against a
        // row the (already-fixed) override method itself just wrote.
        store.migrate_fix_stale_manual_balance_override_reset_dates().unwrap();

        let reset_date: String = store
            .conn
            .query_row(
                "SELECT reset_date FROM balance_resets WHERE account_id = ?1 AND period = 'manual:2026-09-04'",
                params![checking],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(reset_date, "2026-09-03");
    }

    #[test]
    fn set_account_balance_override_wins_a_same_day_tie_against_the_automatic_rollovers_own_checkpoint() {
        // Regression test for a real bug found via live QA: the automatic
        // monthly rollover and a manual override both anchor their
        // `reset_date` to "yesterday relative to whenever they ran" — so
        // a rollover that already fired this app launch (the common case)
        // and a same-day manual override land on the *exact same*
        // `reset_date`. Without a deterministic tiebreaker, `ORDER BY
        // reset_date DESC LIMIT 1` picked whichever row SQLite happened to
        // return first among the tie, which was the *stale* rollover
        // value in practice — silently discarding the override.
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        // The rollover runs first (as it does on every real app launch),
        // landing a "2026-09" reset dated 2026-09-03 with the pre-override
        // balance.
        store.roll_forward_monthly_balances("2026-09-04".parse().unwrap()).unwrap();
        // The user then corrects the balance later the same day — its
        // checkpoint is *also* dated 2026-09-03 under the yesterday-anchor
        // scheme, tying with the rollover's row exactly.
        store
            .set_account_balance_override(checking, "2500.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
        assert_eq!(
            accounts[0].current_balance,
            "2500.00".parse().unwrap(),
            "the manual override must win a same-`reset_date` tie against an earlier automatic rollover"
        );
    }

    #[test]
    fn set_account_balance_override_is_correctly_absorbed_by_a_later_monthly_rollover() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        store
            .set_account_balance_override(checking, "5000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();
        store.save_transactions(checking, &[tx("2026-09-10", "Groceries", "-40.00")]).unwrap();

        // Next month's automatic rollover has no idea a manual override ever
        // happened — it just calls `account_balance_as_of` like any other
        // reader, which already picks the override up transparently.
        let rolled = store.roll_forward_monthly_balances("2026-10-01".parse().unwrap()).unwrap();

        assert_eq!(rolled.len(), 1);
        assert_eq!(
            rolled[0].2,
            "4960.00".parse().unwrap(),
            "the monthly rollover must compose on top of the manual override, not ignore or double-count it"
        );
    }

    #[test]
    fn set_account_balance_override_accepts_zero_and_negative_values() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        store
            .set_account_balance_override(checking, "0.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();
        assert_eq!(
            store.list_accounts("2026-09-04".parse().unwrap()).unwrap()[0].current_balance,
            "0.00".parse().unwrap()
        );

        // A negative balance is legitimate (overdraft, or a credit
        // account's "available" going past its limit) — must not be
        // rejected or clamped.
        store
            .set_account_balance_override(checking, "-250.00".parse().unwrap(), "2026-09-05".parse().unwrap())
            .unwrap();
        assert_eq!(
            store.list_accounts("2026-09-05".parse().unwrap()).unwrap()[0].current_balance,
            "-250.00".parse().unwrap()
        );
    }

    #[test]
    fn set_account_balance_override_never_touches_starting_balance() {
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Rewards Credit Card", AccountType::Credit).unwrap();
        store.set_account_starting_balance(card, "3000.00".parse().unwrap()).unwrap(); // credit limit

        store
            .set_account_balance_override(card, "-1870.96".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
        assert_eq!(
            accounts[0].starting_balance,
            "3000.00".parse().unwrap(),
            "correcting the balance must never move the credit limit — they're independently editable"
        );
        assert_eq!(accounts[0].current_balance, "-1870.96".parse().unwrap());
    }

    #[test]
    fn set_account_balance_override_two_corrections_on_different_days_both_apply_in_order() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        store
            .set_account_balance_override(checking, "2000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();
        store.save_transactions(checking, &[tx("2026-09-05", "Coffee", "-5.00")]).unwrap();
        store
            .set_account_balance_override(checking, "3000.00".parse().unwrap(), "2026-09-08".parse().unwrap())
            .unwrap();
        store.save_transactions(checking, &[tx("2026-09-09", "Groceries", "-40.00")]).unwrap();

        // A date between the two corrections must still reflect the first
        // one plus whatever landed before the second (dates picked with a
        // clear day of slack on either side of each correction, so this
        // isn't accidentally testing the same-day-absorption boundary
        // covered by the other tests).
        assert_eq!(
            store.list_accounts("2026-09-06".parse().unwrap()).unwrap()[0].current_balance,
            "1995.00".parse().unwrap(),
            "a date after the first correction but before the second must not see the second"
        );
        // The latest date must reflect the second correction plus only
        // what's dated after *it*, not double-counting anything absorbed
        // into the second correction's own typed value.
        assert_eq!(
            store.list_accounts("2026-09-10".parse().unwrap()).unwrap()[0].current_balance,
            "2960.00".parse().unwrap()
        );
    }

    #[test]
    fn set_account_balance_override_pred_opt_handles_a_leap_day_boundary_correctly() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        // 2028 is a leap year — the day before March 1st is Feb 29th, not
        // Feb 28th. A transaction dated the leap day itself, entered before
        // the override, must be absorbed (not double-counted); one dated
        // the override's own day, entered after, must still count.
        store
            .save_transactions(checking, &[tx("2028-02-29", "Leap day charge", "-15.00")])
            .unwrap();

        store
            .set_account_balance_override(checking, "2000.00".parse().unwrap(), "2028-03-01".parse().unwrap())
            .unwrap();
        store
            .save_transactions(checking, &[tx("2028-03-01", "Same-day charge", "-25.00")])
            .unwrap();

        assert_eq!(
            store.list_accounts("2028-03-01".parse().unwrap()).unwrap()[0].current_balance,
            "1975.00".parse().unwrap()
        );
    }

    #[test]
    fn set_account_balance_override_does_not_affect_a_different_account() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let savings = store.get_or_create_account("Emergency Savings", AccountType::Savings).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store.set_account_starting_balance(savings, "500.00".parse().unwrap()).unwrap();

        store
            .set_account_balance_override(checking, "9999.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
        assert_eq!(
            accounts.iter().find(|a| a.id == savings).unwrap().current_balance,
            "500.00".parse().unwrap(),
            "correcting one account's balance must not affect any other account"
        );
    }

    #[test]
    fn update_account_type_corrects_a_mistakenly_created_account() {
        let store = Store::open_in_memory().unwrap();
        let id = store.get_or_create_account("Sapphire Rewards", AccountType::Savings).unwrap();

        store.update_account_type(id, AccountType::Credit).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts[0].account.account_type, AccountType::Credit);
    }

    #[test]
    fn update_account_type_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.update_account_type(999, AccountType::Credit).unwrap();
    }

    #[test]
    fn delete_account_removes_it_and_its_transactions() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let savings = store.get_or_create_account("Nest Egg", AccountType::Savings).unwrap();
        store
            .save_transactions(
                checking,
                &[
                    tx("2026-08-01", "Payroll Deposit", "3000.00"),
                    tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                ],
            )
            .unwrap();
        store.save_transactions(savings, &[tx("2026-08-01", "Transfer In", "500.00")]).unwrap();

        let affected = store.delete_account(checking).unwrap();

        assert_eq!(affected, 2, "both of checking's transactions were removed");
        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].id, savings);
        let remaining = store.all_transactions().unwrap();
        assert_eq!(remaining.len(), 1, "savings' own transaction must be untouched");
        assert_eq!(remaining[0].account_id, savings);
    }

    #[test]
    fn delete_account_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_account(999).unwrap();
    }

    #[test]
    fn delete_account_removes_a_balance_reset_snapshot_taken_against_it() {
        // Regression test: `roll_forward_monthly_balances` leaves a
        // `balance_resets` row (`account_id NOT NULL REFERENCES
        // accounts(id)`) behind for every account it touches. Deleting an
        // account that has one used to trip a foreign key constraint
        // instead of succeeding.
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Test", AccountType::Checking).unwrap();
        store.roll_forward_monthly_balances("2026-08-01".parse().unwrap()).unwrap();

        store.delete_account(checking).unwrap();

        assert!(store.list_accounts(far_future()).unwrap().is_empty());
    }

    #[test]
    fn delete_account_removes_its_investment_holdings() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
        store
            .create_holding(
                brokerage,
                "VTI",
                "Vanguard Total Stock Market",
                "10".parse().unwrap(),
                "100.00".parse().unwrap(),
                "900.00".parse().unwrap(),
                None,
            )
            .unwrap();

        store.delete_account(brokerage).unwrap();

        assert!(store.list_holdings(test_now().date()).unwrap().is_empty());
    }

    #[test]
    fn delete_account_unlinks_rather_than_deletes_a_recurring_item_pointing_to_it() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store
            .create_recurring(
                "Netflix",
                None,
                "-15.00".parse().unwrap(),
                "monthly",
                "2026-08-01".parse().unwrap(),
                Some(checking),
            )
            .unwrap();

        store.delete_account(checking).unwrap();

        let recurring = store.list_recurring(far_future()).unwrap();
        assert_eq!(recurring.len(), 1, "the recurring item itself survives");
        assert_eq!(recurring[0].account_id, None);
    }

    #[test]
    fn delete_account_holding_the_source_of_a_debt_payment_also_removes_the_generated_transaction() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")]).unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;
        store
            .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();
        assert_eq!(raw_transaction_count(&store), 2);

        store.delete_account(checking).unwrap();

        assert_eq!(raw_transaction_count(&store), 0, "the generated debt-account transaction must go too");
    }

    #[test]
    fn create_family_member_then_list_family_members_returns_it() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_family_member("Alex").unwrap();

        let members = store.list_family_members().unwrap();

        assert_eq!(
            members,
            vec![FamilyMember {
                id,
                name: "Alex".to_string()
            }]
        );
    }

    #[test]
    fn create_family_member_rejects_a_duplicate_name_case_insensitively() {
        let store = Store::open_in_memory().unwrap();
        store.create_family_member("Alex").unwrap();

        let result = store.create_family_member("ALEX");

        assert!(result.is_err());
    }

    #[test]
    fn rename_family_member_updates_its_name() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_family_member("Alex").unwrap();

        store.rename_family_member(id, "Alexandra").unwrap();

        let members = store.list_family_members().unwrap();
        assert_eq!(members[0].name, "Alexandra");
    }

    #[test]
    fn rename_family_member_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.rename_family_member(999, "Nobody").unwrap();
    }

    #[test]
    fn delete_family_member_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_family_member(999).unwrap();
    }

    #[test]
    fn delete_family_member_nulls_member_id_on_the_accounts_it_owns() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store.set_account_member(checking, Some(member)).unwrap();

        store.delete_family_member(member).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts[0].member_id, None);
    }

    #[test]
    fn delete_family_member_nulls_member_id_on_the_transactions_it_owns() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();
        let transaction_id = store.all_transactions().unwrap()[0].id;
        store.set_transaction_member(transaction_id, Some(member)).unwrap();

        store.delete_family_member(member).unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].member_id, None);
    }

    #[test]
    fn delete_family_member_nulls_member_id_on_the_recurring_items_it_owns() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let recurring_id = store
            .create_recurring("Netflix", None, "-15.00".parse().unwrap(), "monthly", "2026-08-01".parse().unwrap(), None)
            .unwrap();
        store.set_recurring_member(recurring_id, Some(member)).unwrap();

        store.delete_family_member(member).unwrap();

        assert_eq!(store.list_recurring(far_future()).unwrap()[0].member_id, None);
    }

    #[test]
    fn delete_family_member_nulls_member_id_on_the_buckets_it_owns() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let bucket_id = store.create_bucket("Emergency Fund", None, None, None, None, None, None).unwrap();
        store.set_bucket_member(bucket_id, Some(member)).unwrap();

        store.delete_family_member(member).unwrap();

        assert_eq!(store.list_buckets().unwrap()[0].member_id, None);
    }

    #[test]
    fn delete_family_member_nulls_member_id_on_the_assets_it_owns() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let asset_id = store
            .create_asset("House", "Real Estate", "300000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
            .unwrap();
        store.set_asset_member(asset_id, Some(member)).unwrap();

        store.delete_family_member(member).unwrap();

        assert_eq!(store.list_assets().unwrap()[0].member_id, None);
    }

    #[test]
    fn delete_family_member_leaves_a_different_members_rows_untouched() {
        let store = Store::open_in_memory().unwrap();
        let alex = store.create_family_member("Alex").unwrap();
        let sam = store.create_family_member("Sam").unwrap();
        let checking = test_account(&store);
        store.set_account_member(checking, Some(sam)).unwrap();

        store.delete_family_member(alex).unwrap();

        assert_eq!(store.list_accounts(far_future()).unwrap()[0].member_id, Some(sam));
    }

    #[test]
    fn save_transactions_gives_a_new_transaction_its_accounts_member_by_default() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store.set_account_member(checking, Some(member)).unwrap();

        store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].member_id, Some(member));
    }

    #[test]
    fn save_transactions_leaves_member_null_when_the_account_has_none() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);

        store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].member_id, None);
    }

    #[test]
    fn create_transaction_returns_the_new_rows_id() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);

        let id = store.create_transaction(checking, &tx("2026-08-01", "Cash tip", "-20.00")).unwrap();

        let all = store.all_transactions().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, id);
        assert_eq!(all[0].transaction.description, "Cash tip");
    }

    #[test]
    fn create_transaction_defaults_the_member_from_the_account_like_import_does() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store.set_account_member(checking, Some(member)).unwrap();

        store.create_transaction(checking, &tx("2026-08-01", "Cash tip", "-20.00")).unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].member_id, Some(member));
    }

    #[test]
    fn apply_debt_payment_gives_the_generated_transaction_the_debt_accounts_member() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_member(loan, Some(member)).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")]).unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;

        store
            .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();

        assert_eq!(raw_transaction_member_id(&store, loan), Some(member));
    }

    #[test]
    fn set_account_member_assigns_and_clears_a_member() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);

        store.set_account_member(checking, Some(member)).unwrap();
        assert_eq!(store.list_accounts(far_future()).unwrap()[0].member_id, Some(member));

        store.set_account_member(checking, None).unwrap();
        assert_eq!(store.list_accounts(far_future()).unwrap()[0].member_id, None);
    }

    #[test]
    fn set_bucket_member_assigns_and_clears_a_member() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let bucket_id = store.create_bucket("Emergency Fund", None, None, None, None, None, None).unwrap();

        store.set_bucket_member(bucket_id, Some(member)).unwrap();
        assert_eq!(store.list_buckets().unwrap()[0].member_id, Some(member));

        store.set_bucket_member(bucket_id, None).unwrap();
        assert_eq!(store.list_buckets().unwrap()[0].member_id, None);
    }

    #[test]
    fn set_recurring_member_assigns_and_clears_a_member() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let recurring_id = store
            .create_recurring("Netflix", None, "-15.00".parse().unwrap(), "monthly", "2026-08-01".parse().unwrap(), None)
            .unwrap();

        store.set_recurring_member(recurring_id, Some(member)).unwrap();
        assert_eq!(store.list_recurring(far_future()).unwrap()[0].member_id, Some(member));

        store.set_recurring_member(recurring_id, None).unwrap();
        assert_eq!(store.list_recurring(far_future()).unwrap()[0].member_id, None);
    }

    #[test]
    fn set_asset_member_assigns_and_clears_a_member() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let asset_id = store
            .create_asset("House", "Real Estate", "300000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
            .unwrap();

        store.set_asset_member(asset_id, Some(member)).unwrap();
        assert_eq!(store.list_assets().unwrap()[0].member_id, Some(member));

        store.set_asset_member(asset_id, None).unwrap();
        assert_eq!(store.list_assets().unwrap()[0].member_id, None);
    }

    #[test]
    fn set_transaction_member_assigns_and_clears_a_member() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();
        let transaction_id = store.all_transactions().unwrap()[0].id;

        store.set_transaction_member(transaction_id, Some(member)).unwrap();
        assert_eq!(store.all_transactions().unwrap()[0].member_id, Some(member));

        store.set_transaction_member(transaction_id, None).unwrap();
        assert_eq!(store.all_transactions().unwrap()[0].member_id, None);
    }

    #[test]
    fn bulk_set_transaction_member_applies_to_every_id_given() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store
            .save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00"), tx("2026-08-02", "Gas", "-40.00")])
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();

        store.bulk_set_transaction_member(&ids, Some(member)).unwrap();

        let all = store.all_transactions().unwrap();
        assert!(all.iter().all(|t| t.member_id == Some(member)));
    }

    #[test]
    fn list_accounts_includes_its_members_name() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store.set_account_member(checking, Some(member)).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(accounts[0].member_name, Some("Alex".to_string()));
    }

    #[test]
    fn list_accounts_uses_holdings_value_for_an_investment_account_once_it_has_holdings() {
        // A portfolio tracked entirely through Holdings (no matching
        // deposit transaction ever recorded) used to show as worth
        // whatever its starting_balance happened to be (typically $0) —
        // this is what makes the Investments tab's real value agree with
        // Net Worth/Accounts/Household everywhere else.
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
        store.set_account_starting_balance(brokerage, "0".parse().unwrap()).unwrap();
        store
            .create_holding(
                brokerage,
                "VTI",
                "Vanguard Total Stock",
                "10".parse().unwrap(),
                "265.00".parse().unwrap(),
                "2000.00".parse().unwrap(),
                None,
            )
            .unwrap();
        store
            .create_holding(
                brokerage,
                "BND",
                "Vanguard Total Bond",
                "20".parse().unwrap(),
                "71.50".parse().unwrap(),
                "1300.00".parse().unwrap(),
                None,
            )
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();

        // 10*265.00 + 20*71.50 = 2650.00 + 1430.00 = 4080.00
        assert_eq!(accounts[0].current_balance, "4080.00".parse().unwrap());
    }

    #[test]
    fn list_accounts_falls_back_to_transaction_balance_for_an_investment_account_with_no_holdings() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
        store.set_account_starting_balance(brokerage, "5000.00".parse().unwrap()).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(accounts[0].current_balance, "5000.00".parse().unwrap());
    }

    #[test]
    fn list_buckets_includes_its_members_name() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let bucket_id = store.create_bucket("Emergency Fund", None, None, None, None, None, None).unwrap();
        store.set_bucket_member(bucket_id, Some(member)).unwrap();

        let buckets = store.list_buckets().unwrap();

        assert_eq!(buckets[0].member_name, Some("Alex".to_string()));
    }

    #[test]
    fn list_recurring_includes_its_members_name() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let recurring_id = store
            .create_recurring("Netflix", None, "-15.00".parse().unwrap(), "monthly", "2026-08-01".parse().unwrap(), None)
            .unwrap();
        store.set_recurring_member(recurring_id, Some(member)).unwrap();

        let recurring = store.list_recurring(far_future()).unwrap();

        assert_eq!(recurring[0].member_name, Some("Alex".to_string()));
    }

    #[test]
    fn list_assets_includes_its_members_name() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let asset_id = store
            .create_asset("House", "Real Estate", "300000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
            .unwrap();
        store.set_asset_member(asset_id, Some(member)).unwrap();

        let assets = store.list_assets().unwrap();

        assert_eq!(assets[0].member_name, Some("Alex".to_string()));
    }

    #[test]
    fn all_transactions_includes_its_members_name() {
        let store = Store::open_in_memory().unwrap();
        let member = store.create_family_member("Alex").unwrap();
        let checking = test_account(&store);
        store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();
        let transaction_id = store.all_transactions().unwrap()[0].id;
        store.set_transaction_member(transaction_id, Some(member)).unwrap();

        let transactions = store.all_transactions().unwrap();

        assert_eq!(transactions[0].member_name, Some("Alex".to_string()));
    }

    #[test]
    fn opening_a_pre_member_id_database_migrates_every_table_without_losing_data() {
        // Simulates a database from before family member attribution
        // existed: accounts/transactions/recurring/buckets/assets with no
        // `member_id` column on any of them.
        let dir = std::env::temp_dir().join(format!("meadow-member-id-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_member_id.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    account_type TEXT NOT NULL,
                    starting_balance TEXT NOT NULL DEFAULT '0',
                    institution TEXT,
                    mask TEXT,
                    interest_rate TEXT,
                    excluded_from_debt_payoff INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id INTEGER NOT NULL REFERENCES accounts(id),
                    date TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    category TEXT,
                    category_source TEXT,
                    confidence REAL,
                    fingerprint TEXT NOT NULL
                );
                CREATE TABLE recurring (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    merchant TEXT NOT NULL,
                    category TEXT,
                    amount TEXT NOT NULL,
                    cadence TEXT NOT NULL,
                    anchor_date TEXT NOT NULL,
                    account_id INTEGER
                );
                CREATE TABLE buckets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    target_amount TEXT,
                    target_date TEXT,
                    account_id INTEGER
                );
                CREATE TABLE assets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    asset_type TEXT NOT NULL,
                    value TEXT NOT NULL,
                    valued_on TEXT NOT NULL,
                    notes TEXT
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO accounts (id, name, account_type, starting_balance) VALUES (1, 'Everyday Checking', 'checking', '0')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO transactions (account_id, date, description, amount, fingerprint) VALUES (1, '2026-08-01', 'Groceries', '-50.00', 'fp1')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO recurring (merchant, amount, cadence, anchor_date, account_id) VALUES ('Netflix', '-15.00', 'monthly', '2026-08-01', 1)",
                [],
            )
            .unwrap();
            conn.execute("INSERT INTO buckets (name, account_id) VALUES ('Emergency Fund', 1)", [])
                .unwrap();
            conn.execute(
                "INSERT INTO assets (name, asset_type, value, valued_on) VALUES ('House', 'Real Estate', '300000.00', '2026-08-01')",
                [],
            )
            .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let member = store.create_family_member("Alex").unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts.len(), 1, "the pre-existing account must survive the migration");
        assert_eq!(accounts[0].member_id, None);
        store.set_account_member(accounts[0].id, Some(member)).unwrap();
        assert_eq!(store.list_accounts(far_future()).unwrap()[0].member_id, Some(member));

        let transactions = store.all_transactions().unwrap();
        assert_eq!(transactions.len(), 1, "the pre-existing transaction must survive the migration");
        store.set_transaction_member(transactions[0].id, Some(member)).unwrap();
        assert_eq!(store.all_transactions().unwrap()[0].member_id, Some(member));

        let recurring = store.list_recurring(far_future()).unwrap();
        assert_eq!(recurring.len(), 1, "the pre-existing recurring item must survive the migration");
        store.set_recurring_member(recurring[0].id, Some(member)).unwrap();
        assert_eq!(store.list_recurring(far_future()).unwrap()[0].member_id, Some(member));

        let buckets = store.list_buckets().unwrap();
        assert_eq!(buckets.len(), 1, "the pre-existing bucket must survive the migration");
        store.set_bucket_member(buckets[0].id, Some(member)).unwrap();
        assert_eq!(store.list_buckets().unwrap()[0].member_id, Some(member));

        let assets = store.list_assets().unwrap();
        assert_eq!(assets.len(), 1, "the pre-existing asset must survive the migration");
        store.set_asset_member(assets[0].id, Some(member)).unwrap();
        assert_eq!(store.list_assets().unwrap()[0].member_id, Some(member));

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn a_new_accounts_institution_and_mask_default_to_none() {
        let store = Store::open_in_memory().unwrap();
        store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(accounts[0].institution, None);
        assert_eq!(accounts[0].mask, None);
    }

    #[test]
    fn set_account_details_persists_institution_and_mask() {
        let store = Store::open_in_memory().unwrap();
        let id = store.get_or_create_account("Sapphire Preferred", AccountType::Credit).unwrap();

        store.set_account_details(id, Some("Chase"), Some("4821")).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts[0].institution, Some("Chase".to_string()));
        assert_eq!(accounts[0].mask, Some("4821".to_string()));
    }

    #[test]
    fn set_account_details_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.set_account_details(999, Some("Chase"), Some("4821")).unwrap();
    }

    #[test]
    fn opening_a_pre_institution_database_migrates_it_without_losing_data() {
        // Simulates a database from before institution/mask existed: an
        // `accounts` table without those two columns.
        let dir = std::env::temp_dir().join(format!("meadow-institution-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_institution.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    account_type TEXT NOT NULL,
                    starting_balance TEXT NOT NULL DEFAULT '0'
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '0')",
                [],
            )
            .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(accounts.len(), 1, "the pre-existing account must survive the migration");
        assert_eq!(accounts[0].institution, None);

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn opening_a_pre_balance_database_migrates_it_without_losing_data() {
        // Simulates a real database created before account balances
        // existed: an `accounts` table with no `starting_balance` column.
        let dir = std::env::temp_dir().join(format!("meadow-balance-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_balance.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    account_type TEXT NOT NULL
                );",
            )
            .unwrap();
            conn.execute("INSERT INTO accounts (name, account_type) VALUES ('Everyday Checking', 'checking')", [])
                .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let accounts = store.list_accounts(far_future()).unwrap();

        assert_eq!(accounts.len(), 1, "the pre-existing account must survive the migration");
        assert_eq!(accounts[0].account.name, "Everyday Checking");
        assert_eq!(accounts[0].starting_balance, Decimal::ZERO);

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn opening_a_pre_principal_amount_database_migrates_it_without_losing_data() {
        // Simulates a real database created before the loan
        // principal-override column existed: a `transactions` table with
        // no `principal_amount` column, already holding a real row.
        let dir = std::env::temp_dir().join(format!("vaultspend-principal-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_principal_amount.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    account_type TEXT NOT NULL
                );
                CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id INTEGER NOT NULL,
                    date TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    category TEXT,
                    category_source TEXT,
                    confidence REAL,
                    fingerprint TEXT
                );",
            )
            .unwrap();
            conn.execute("INSERT INTO accounts (name, account_type) VALUES ('Everyday Checking', 'checking')", [])
                .unwrap();
            conn.execute(
                "INSERT INTO transactions (account_id, date, description, amount) VALUES (1, '2026-08-05', 'Groceries', '-60.00')",
                [],
            )
            .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let transactions = store.all_transactions().unwrap();

        assert_eq!(transactions.len(), 1, "the pre-existing transaction must survive the migration");
        assert_eq!(transactions[0].transaction.amount, "-60.00".parse().unwrap());
        assert_eq!(
            transactions[0].principal_amount, None,
            "a pre-existing row must default to no override, not a corrupted/garbage value"
        );

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn account_changes_get_logged_to_a_file_next_to_a_real_on_disk_database() {
        let dir = std::env::temp_dir().join(format!("vaultspend-activity-log-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("activity_log_test.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }
        let log_path = dir.join("account-changes.log");
        if log_path.exists() {
            std::fs::remove_file(&log_path).unwrap();
        }

        let store = Store::open(&db_path).unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "300000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-08-05", "Groceries", "-60.00")]).unwrap();
        let id = store.all_transactions().unwrap().iter().find(|t| t.account_id == checking).unwrap().id;
        store.update_transaction_amount(id, "-65.00".parse().unwrap()).unwrap();
        store.save_transactions(loan, &[tx("2026-08-05", "Mortgage Payment", "2500.00")]).unwrap();
        let mortgage_tx_id = store.all_transactions().unwrap().iter().find(|t| t.account_id == loan).unwrap().id;
        store
            .update_transaction_principal_amount(mortgage_tx_id, Some("500.00".parse().unwrap()))
            .unwrap();
        // Correcting the raw `amount` of a transaction whose principal
        // override is still set must report no balance movement at all —
        // the override, not `amount`, is what counts toward the loan.
        store.update_transaction_amount(mortgage_tx_id, "2600.00".parse().unwrap()).unwrap();
        store
            .delete_transaction(id, chrono::NaiveDate::from_ymd_opt(2026, 8, 6).unwrap().and_hms_opt(0, 0, 0).unwrap())
            .unwrap();
        store.restore_transactions(&[id]).unwrap();
        drop(store);

        let contents = std::fs::read_to_string(&log_path).expect("account-changes.log must exist next to the database");
        assert!(contents.contains("Everyday Checking: transaction added"), "log was:\n{contents}");
        assert!(contents.contains("balance 0 -> -60.00"), "log was:\n{contents}");
        assert!(contents.contains("amount corrected: -60.00 -> -65.00"), "log was:\n{contents}");
        assert!(contents.contains("balance -60.00 -> -65.00"), "log was:\n{contents}");
        assert!(contents.contains("Mortgage: transaction added"), "log was:\n{contents}");
        assert!(contents.contains("owed 300000.00 -> 297500.00"), "log was:\n{contents}");
        assert!(contents.contains("principal override: full amount -> 500.00"), "log was:\n{contents}");
        assert!(
            contents.contains("owed 297500.00 -> 299500.00"),
            "reducing how much of the mortgage payment counts as principal should raise what's still owed relative to before the override:\n{contents}"
        );
        assert!(
            contents.contains("amount corrected: 2500.00 -> 2600.00 — owed 299500.00 -> 299500.00"),
            "correcting the raw amount of a transaction whose principal override is still set must leave owed unchanged:\nlog was:\n{contents}"
        );
        assert!(contents.contains("deleted — balance -65.00 -> 0"), "log was:\n{contents}");
        assert!(contents.contains("restored — balance 0 -> -65.00"), "log was:\n{contents}");

        std::fs::remove_file(&db_path).unwrap();
        std::fs::remove_file(&log_path).unwrap();
    }

    #[test]
    fn an_in_memory_store_never_creates_an_activity_log() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.save_transactions(checking, &[tx("2026-08-05", "Groceries", "-60.00")]).unwrap();

        assert_eq!(store.activity_log_path, None);
    }

    #[test]
    fn check_duplicates_does_not_flag_the_same_content_in_a_different_account() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let credit = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();

        let same_content = vec![tx("2026-08-20", "Transfer", "-100.00")];
        store.save_transactions(checking, &same_content).unwrap();

        let flags = store.check_duplicates(credit, &same_content).unwrap();

        assert_eq!(flags, vec![false], "same content in a different account is not a duplicate");
    }

    #[test]
    fn all_transactions_reports_which_account_each_row_belongs_to() {
        let store = Store::open_in_memory().unwrap();
        let credit = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
        store.save_transactions(credit, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")]).unwrap();

        let stored = store.all_transactions().unwrap();
        assert_eq!(stored[0].account_id, credit);
        assert_eq!(stored[0].account_name, "Sapphire Rewards");
    }

    // Transaction editing.

    #[test]
    fn update_transaction_amount_persists_the_new_amount() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.update_transaction_amount(id, "-7.25".parse().unwrap()).unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].transaction.amount, "-7.25".parse().unwrap());
    }

    /// Regression test for a real reporting-inconsistency bug: editing a
    /// split transaction's parent amount used to leave its splits summing
    /// to the *old* amount, so the transaction and its own split
    /// breakdown silently disagreed with each other. The fix rescales
    /// every split proportionally so they still sum to exactly the new
    /// amount, preserving each one's relative share of the total.
    #[test]
    fn update_transaction_amount_rescales_splits_that_no_longer_sum_to_the_new_amount() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-20", "Groceries run", "-100.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store
            .set_transaction_splits(
                id,
                &[
                    ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                    ("Household".to_string(), "-40.00".parse().unwrap(), None),
                ],
            )
            .unwrap();

        let splits_reconciled = store.update_transaction_amount(id, "-200.00".parse().unwrap()).unwrap();

        assert!(splits_reconciled, "expected the now-mismatched splits to be reported as reconciled");
        assert_eq!(store.all_transactions().unwrap()[0].transaction.amount, "-200.00".parse().unwrap());
        let splits = store.list_transaction_splits(id).unwrap();
        assert_eq!(splits.len(), 2, "reconciling must not drop either split");
        // Same 60/40 relative share as before, just doubled along with the total.
        assert_eq!(splits[0].category.as_deref(), Some("Groceries"));
        assert_eq!(splits[0].amount, "-120.00".parse().unwrap());
        assert_eq!(splits[1].category.as_deref(), Some("Household"));
        assert_eq!(splits[1].amount, "-80.00".parse().unwrap());
        let total: rust_decimal::Decimal = splits.iter().map(|s| s.amount).sum();
        assert_eq!(
            total,
            "-200.00".parse().unwrap(),
            "splits must sum to exactly the new amount, not just approximately"
        );
    }

    #[test]
    fn update_transaction_amount_splits_a_zero_sum_breakdown_evenly() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-20", "Wash", "0.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store
            .set_transaction_splits(
                id,
                &[
                    ("Refund".to_string(), "-50.00".parse().unwrap(), None),
                    ("Fee".to_string(), "50.00".parse().unwrap(), None),
                ],
            )
            .unwrap();

        store.update_transaction_amount(id, "-100.00".parse().unwrap()).unwrap();

        let splits = store.list_transaction_splits(id).unwrap();
        let total: rust_decimal::Decimal = splits.iter().map(|s| s.amount).sum();
        assert_eq!(
            total,
            "-100.00".parse().unwrap(),
            "a zero-sum breakdown has no ratio to scale by, so it splits evenly instead"
        );
    }

    #[test]
    fn update_transaction_amount_rescaling_handles_a_remainder_penny_exactly() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Split three ways", "-100.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store
            .set_transaction_splits(
                id,
                &[
                    ("A".to_string(), "-33.34".parse().unwrap(), None),
                    ("B".to_string(), "-33.33".parse().unwrap(), None),
                    ("C".to_string(), "-33.33".parse().unwrap(), None),
                ],
            )
            .unwrap();

        // A ratio that doesn't divide evenly into cents (-10.00 / -100.00 =
        // 0.1) is exactly the case naive per-split rounding can drift on.
        store.update_transaction_amount(id, "-10.00".parse().unwrap()).unwrap();

        let splits = store.list_transaction_splits(id).unwrap();
        let total: rust_decimal::Decimal = splits.iter().map(|s| s.amount).sum();
        assert_eq!(
            total,
            "-10.00".parse().unwrap(),
            "the last split must absorb any rounding remainder so the total is exact"
        );
    }

    #[test]
    fn update_transaction_amount_keeps_splits_that_still_sum_correctly() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-20", "Groceries run", "-100.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store
            .set_transaction_splits(
                id,
                &[
                    ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                    ("Household".to_string(), "-40.00".parse().unwrap(), None),
                ],
            )
            .unwrap();

        // Same total, just re-entered — a no-op edit shouldn't disturb an
        // already-consistent split breakdown.
        let splits_reconciled = store.update_transaction_amount(id, "-100.00".parse().unwrap()).unwrap();

        assert!(!splits_reconciled);
        assert_eq!(store.list_transaction_splits(id).unwrap().len(), 2);
    }

    #[test]
    fn update_transaction_amount_keeps_dedup_working_against_the_corrected_value() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.update_transaction_amount(id, "-7.25".parse().unwrap()).unwrap();

        // re-importing the same file (still says -6.75) should look new now,
        // since the stored row's fingerprint moved with the corrected amount
        let flags = store.check_duplicates(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")]).unwrap();
        assert_eq!(flags, vec![false]);

        let flags = store.check_duplicates(account, &[tx("2026-08-20", "Ferrywood Coffee", "-7.25")]).unwrap();
        assert_eq!(flags, vec![true]);
    }

    #[test]
    fn update_transaction_amount_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.update_transaction_amount(999, "1.00".parse().unwrap()).unwrap();
    }

    #[test]
    fn a_loan_transactions_principal_override_is_what_actually_moves_the_balance() {
        // A mortgage payment bundles principal, interest, and escrow — only
        // $500 of a $2500 payment recorded directly on the loan account
        // should reduce what's owed.
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "300000.00".parse().unwrap()).unwrap();
        store.save_transactions(loan, &[tx("2026-08-05", "Mortgage Payment", "2500.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.update_transaction_principal_amount(id, Some("500.00".parse().unwrap())).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(
            accounts[0].current_balance,
            "299500.00".parse().unwrap(),
            "only the $500 principal override should reduce what's owed, not the full $2500"
        );
    }

    #[test]
    fn a_loan_transaction_with_no_principal_override_still_uses_its_full_amount() {
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "300000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(loan, &[tx("2026-08-05", "Extra Principal Payment", "500.00")])
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(accounts[0].current_balance, "299500.00".parse().unwrap());
    }

    #[test]
    fn update_transaction_principal_amount_can_be_cleared_back_to_none() {
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "300000.00".parse().unwrap()).unwrap();
        store.save_transactions(loan, &[tx("2026-08-05", "Mortgage Payment", "2500.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.update_transaction_principal_amount(id, Some("500.00".parse().unwrap())).unwrap();

        store.update_transaction_principal_amount(id, None).unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].principal_amount, None);
        let accounts = store.list_accounts(far_future()).unwrap();
        assert_eq!(
            accounts[0].current_balance,
            "297500.00".parse().unwrap(),
            "clearing the override reverts to the full $2500 payment reducing what's owed"
        );
    }

    #[test]
    fn update_transaction_principal_amount_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.update_transaction_principal_amount(999, Some("1.00".parse().unwrap())).unwrap();
    }

    #[test]
    fn set_account_balance_override_nets_out_a_same_day_loan_transactions_principal_override() {
        // Same idea as set_account_balance_override_nets_out_a_same_day_transaction_on_a_loan_account,
        // but the same-day transaction has a principal override smaller
        // than its own amount — the override, not the full amount, is what
        // must be netted out.
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store.save_transactions(loan, &[tx("2026-09-04", "Mortgage Payment", "2500.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.update_transaction_principal_amount(id, Some("500.00".parse().unwrap())).unwrap();

        store
            .set_account_balance_override(loan, "8000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
        assert_eq!(
            accounts[0].current_balance,
            "8000.00".parse().unwrap(),
            "the $500 principal override, not the $2500 full amount, must be netted out"
        );
    }

    #[test]
    fn update_transaction_account_moves_it_to_the_new_account() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        let savings = store.get_or_create_account("Nest Egg", AccountType::Savings).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.update_transaction_account(id, savings).unwrap();

        let stored = store.all_transactions().unwrap();
        assert_eq!(stored[0].account_id, savings);
        assert_eq!(stored[0].account_name, "Nest Egg");
    }

    #[test]
    fn update_transaction_account_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.update_transaction_account(999, account).unwrap();
    }

    #[test]
    fn update_transaction_date_persists_the_new_date() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.update_transaction_date(id, "2026-08-21".parse().unwrap()).unwrap();

        assert_eq!(
            store.all_transactions().unwrap()[0].transaction.date,
            "2026-08-21".parse::<NaiveDate>().unwrap()
        );
    }

    #[test]
    fn update_transaction_date_keeps_dedup_working_against_the_corrected_value() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.update_transaction_date(id, "2026-08-21".parse().unwrap()).unwrap();

        let flags = store.check_duplicates(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")]).unwrap();
        assert_eq!(
            flags,
            vec![false],
            "re-importing the original date should look new now that the stored row moved"
        );

        let flags = store.check_duplicates(account, &[tx("2026-08-21", "Ferrywood Coffee", "-6.75")]).unwrap();
        assert_eq!(flags, vec![true]);
    }

    #[test]
    fn update_transaction_date_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.update_transaction_date(999, "2026-08-20".parse().unwrap()).unwrap();
    }

    #[test]
    fn update_transaction_description_persists_the_new_description() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.update_transaction_description(id, "Ferrywood Coffee Co.").unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].transaction.description, "Ferrywood Coffee Co.");
    }

    #[test]
    fn update_transaction_description_keeps_dedup_working_against_the_corrected_value() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.update_transaction_description(id, "Ferrywood Coffee Co.").unwrap();

        let flags = store.check_duplicates(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")]).unwrap();
        assert_eq!(
            flags,
            vec![false],
            "re-importing the original description should look new now that the stored row moved"
        );

        let flags = store
            .check_duplicates(account, &[tx("2026-08-20", "Ferrywood Coffee Co.", "-6.75")])
            .unwrap();
        assert_eq!(flags, vec![true]);
    }

    #[test]
    fn update_transaction_description_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.update_transaction_description(999, "New description").unwrap();
    }

    #[test]
    fn delete_transaction_removes_only_that_row() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-20", "Ferrywood Coffee", "-6.75"),
                    tx("2026-08-21", "Green Leaf Grocers", "-40.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();

        store.delete_transaction(ids[0], test_now()).unwrap();

        let remaining = store.all_transactions().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, ids[1]);
    }

    #[test]
    fn delete_transaction_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_transaction(999, test_now()).unwrap();
    }

    #[test]
    fn restoring_a_deleted_transaction_brings_back_its_tags_too() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.add_tag(id, "reimbursable").unwrap();

        store.delete_transaction(id, test_now()).unwrap();
        assert_eq!(
            store.list_all_tags().unwrap(),
            Vec::<String>::new(),
            "a deleted transaction's tags don't leak into autocomplete"
        );

        store.restore_transactions(&[id]).unwrap();

        assert_eq!(store.list_all_tags().unwrap(), vec!["reimbursable".to_string()]);
    }

    #[test]
    fn restore_transactions_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.restore_transactions(&[999]).unwrap();
    }

    #[test]
    fn restore_transactions_restores_every_id_given_at_once() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-05", "Target", "-50.00"), tx("2026-08-06", "Costco", "-75.00")])
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for &id in &ids {
            store.delete_transaction(id, test_now()).unwrap();
        }
        assert!(store.all_transactions().unwrap().is_empty());

        store.restore_transactions(&ids).unwrap();

        assert_eq!(store.all_transactions().unwrap().len(), 2);
    }

    // Applying a payment to a debt.

    #[test]
    fn applying_a_payment_reduces_a_loans_balance() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")]).unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;

        store
            .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        let loan_account = accounts.iter().find(|a| a.id == loan).unwrap();
        assert_eq!(loan_account.current_balance, "9500.00".parse().unwrap());
    }

    #[test]
    fn applying_a_payment_increases_a_credit_cards_available_balance() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let credit_card = store.get_or_create_account("Visa", AccountType::Credit).unwrap();
        store.set_account_starting_balance(credit_card, "2000.00".parse().unwrap()).unwrap(); // credit limit
        store.save_transactions(credit_card, &[tx("2026-08-15", "Groceries", "-300.00")]).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-20", "Credit Card Payment", "-200.00")])
            .unwrap();
        let source_id = store
            .all_transactions()
            .unwrap()
            .into_iter()
            .find(|t| t.transaction.description == "Credit Card Payment")
            .unwrap()
            .id;

        store
            .apply_debt_payment(source_id, credit_card, "200.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        let card = accounts.iter().find(|a| a.id == credit_card).unwrap();
        // 2000 limit - 300 charge + 200 payment = 1900 available.
        assert_eq!(card.current_balance, "1900.00".parse().unwrap());
    }

    #[test]
    fn applying_a_payment_with_a_different_amount_than_the_source_transaction_uses_the_given_amount() {
        // A mortgage payment bundles principal + interest + escrow — only
        // the principal portion should reduce what's tracked as owed.
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let mortgage = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
        store.set_account_starting_balance(mortgage, "300000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-01", "Mortgage Payment", "-1500.00")])
            .unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;

        store
            .apply_debt_payment(source_id, mortgage, "900.00".parse().unwrap(), "2026-08-01".parse().unwrap())
            .unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        let mortgage_account = accounts.iter().find(|a| a.id == mortgage).unwrap();
        assert_eq!(mortgage_account.current_balance, "299100.00".parse().unwrap());
    }

    #[test]
    fn unapplying_a_payment_removes_the_generated_transaction_and_restores_the_balance() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")]).unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;
        store
            .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();

        store.unapply_debt_payment(source_id).unwrap();

        let accounts = store.list_accounts(far_future()).unwrap();
        let loan_account = accounts.iter().find(|a| a.id == loan).unwrap();
        assert_eq!(loan_account.current_balance, "10000.00".parse().unwrap());
        assert_eq!(store.all_transactions().unwrap().len(), 1);
    }

    #[test]
    fn unapplying_a_payment_that_was_never_applied_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.unapply_debt_payment(999).unwrap();
    }

    #[test]
    fn deleting_the_source_transaction_also_soft_deletes_its_generated_debt_payment() {
        // Soft-delete: both rows physically survive (so restoring the
        // source brings its debt-payment twin back too — see
        // `delete_transaction`'s own doc comment) but neither is visible
        // through the app's own filtered read.
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")]).unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;
        store
            .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();
        assert_eq!(raw_transaction_count(&store), 2);

        store.delete_transaction(source_id, test_now()).unwrap();

        assert_eq!(raw_transaction_count(&store), 2, "both rows must physically survive a soft delete");
        assert!(store.all_transactions().unwrap().is_empty(), "but neither should be visible");

        store.restore_transactions(&[source_id]).unwrap();

        assert_eq!(store.all_transactions().unwrap().len(), 1, "restoring the source brings both back");
    }

    #[test]
    fn all_transactions_reports_which_transactions_are_applied_to_a_debt() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")]).unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;

        let before = store.all_transactions().unwrap();
        assert!(before.iter().find(|t| t.id == source_id).unwrap().applied_to_debt.is_none());

        store
            .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();

        let after = store.all_transactions().unwrap();
        let applied = after.iter().find(|t| t.id == source_id).unwrap().applied_to_debt.as_ref().unwrap();
        assert_eq!(applied.debt_account_id, loan);
        assert_eq!(applied.debt_account_name, "Car Loan");
        assert_eq!(applied.amount, "500.00".parse().unwrap());
    }

    #[test]
    fn applying_a_debt_payment_does_not_double_count_it_as_spending() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(
                checking,
                &[Transaction {
                    category: Some("Auto Loan".to_string()),
                    ..tx("2026-08-20", "Loan Payment", "-500.00")
                }],
            )
            .unwrap();
        let source_id = store.all_transactions().unwrap()[0].id;

        store
            .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
            .unwrap();

        // Only the source transaction should ever be visible or counted —
        // the generated one on `loan` exists purely to move that account's
        // balance (see `all_transactions`'s doc comment).
        assert_eq!(store.all_transactions().unwrap().len(), 1);
        assert_eq!(raw_transaction_count(&store), 2, "the generated transaction still exists, just hidden");

        let spend = store
            .spending_by_category("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
            .unwrap();
        assert_eq!(spend, vec![("Auto Loan".to_string(), "500.00".parse().unwrap())]);

        let actuals = store.monthly_budget_actuals(2026, 8).unwrap();
        assert!(actuals.is_empty(), "no budget line was set for Auto Loan, so nothing to assert on here");

        store.set_budget("Auto Loan", "2026-08", "500.00".parse().unwrap(), "expense").unwrap();
        let actuals = store.monthly_budget_actuals(2026, 8).unwrap();
        assert_eq!(actuals[0].actual, "500.00".parse().unwrap());

        let (_, expense) = store.monthly_totals(2026, 8).unwrap();
        assert_eq!(expense, "500.00".parse().unwrap());
    }

    // Split transactions.

    #[test]
    fn setting_splits_replaces_any_previous_set() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store
            .set_transaction_splits(
                id,
                &[
                    ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                    ("Household".to_string(), "-40.00".parse().unwrap(), None),
                ],
            )
            .unwrap();
        assert_eq!(store.list_transaction_splits(id).unwrap().len(), 2);

        // Replacing with a different set, including clearing entirely.
        store
            .set_transaction_splits(id, &[("Groceries".to_string(), "-100.00".parse().unwrap(), None)])
            .unwrap();
        let splits = store.list_transaction_splits(id).unwrap();
        assert_eq!(splits.len(), 1);
        assert_eq!(splits[0].category, Some("Groceries".to_string()));

        store.set_transaction_splits(id, &[]).unwrap();
        assert_eq!(store.list_transaction_splits(id).unwrap().len(), 0);
    }

    #[test]
    fn all_transactions_reports_split_count() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        assert_eq!(store.all_transactions().unwrap()[0].split_count, 0);

        store
            .set_transaction_splits(
                id,
                &[
                    ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                    ("Household".to_string(), "-40.00".parse().unwrap(), None),
                ],
            )
            .unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].split_count, 2);
    }

    #[test]
    fn deleting_a_transaction_leaves_its_splits_intact_for_restore() {
        // Soft-delete: splits are deliberately *not* removed, so
        // `restore_transactions` brings a split transaction back exactly
        // as it was, not with its splits lost — see `delete_transaction`'s
        // own doc comment for why.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store
            .set_transaction_splits(id, &[("Groceries".to_string(), "-100.00".parse().unwrap(), None)])
            .unwrap();

        store.delete_transaction(id, test_now()).unwrap();

        assert_eq!(store.list_transaction_splits(id).unwrap().len(), 1, "splits must survive a soft delete");
        assert!(
            store.all_transactions().unwrap().is_empty(),
            "but the transaction itself must not be listed"
        );

        store.restore_transactions(&[id]).unwrap();

        assert_eq!(store.list_transaction_splits(id).unwrap().len(), 1, "and still be there after restore");
        assert_eq!(store.all_transactions().unwrap().len(), 1, "with the transaction visible again");
    }

    #[test]
    fn monthly_budget_actuals_counts_split_lines_toward_their_own_categories_instead_of_the_parents() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "200.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget("Household", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
        store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();
        store
            .set_transaction_splits(
                id,
                &[
                    ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                    ("Household".to_string(), "-40.00".parse().unwrap(), None),
                ],
            )
            .unwrap();

        let actuals = store.monthly_budget_actuals(2026, 8).unwrap();
        let groceries = actuals.iter().find(|a| a.category == "Groceries").unwrap();
        let household = actuals.iter().find(|a| a.category == "Household").unwrap();

        // Split lines count toward their own categories (60 + 40); the
        // parent transaction's own "Groceries" category must not also
        // contribute its full $100, or Groceries would double-count.
        assert_eq!(groceries.actual, "60.00".parse().unwrap());
        assert_eq!(household.actual, "40.00".parse().unwrap());
    }

    #[test]
    fn renaming_a_category_updates_it_within_transaction_splits_too() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store
            .set_transaction_splits(id, &[("Groceries".to_string(), "-100.00".parse().unwrap(), None)])
            .unwrap();

        store.rename_category("Groceries", "Food").unwrap();

        assert_eq!(store.list_transaction_splits(id).unwrap()[0].category, Some("Food".to_string()));
    }

    #[test]
    fn deleting_a_category_nulls_it_out_within_transaction_splits_too() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store
            .set_transaction_splits(id, &[("Groceries".to_string(), "-100.00".parse().unwrap(), None)])
            .unwrap();

        store.delete_category("Groceries").unwrap();

        assert_eq!(store.list_transaction_splits(id).unwrap()[0].category, None);
    }

    // Tags.

    #[test]
    fn adding_and_removing_tags_on_a_transaction() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.add_tag(id, "reimbursable").unwrap();
        store.add_tag(id, "vacation").unwrap();
        let tags = store.all_transactions().unwrap()[0].tags.clone();
        assert_eq!(tags.len(), 2);
        assert!(tags.contains(&"reimbursable".to_string()));
        assert!(tags.contains(&"vacation".to_string()));

        store.remove_tag(id, "vacation").unwrap();
        let tags = store.all_transactions().unwrap()[0].tags.clone();
        assert_eq!(tags, vec!["reimbursable".to_string()]);
    }

    #[test]
    fn adding_the_same_tag_twice_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;

        store.add_tag(id, "reimbursable").unwrap();
        store.add_tag(id, "reimbursable").unwrap();

        assert_eq!(store.all_transactions().unwrap()[0].tags, vec!["reimbursable".to_string()]);
    }

    #[test]
    fn list_all_tags_returns_distinct_tags_across_transactions() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-05", "Target", "-100.00"), tx("2026-08-06", "Costco", "-200.00")])
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.add_tag(ids[0], "reimbursable").unwrap();
        store.add_tag(ids[1], "reimbursable").unwrap();
        store.add_tag(ids[1], "vacation").unwrap();

        let all_tags = store.list_all_tags().unwrap();

        assert_eq!(all_tags, vec!["reimbursable".to_string(), "vacation".to_string()]);
    }

    #[test]
    fn deleting_a_transaction_removes_its_tags() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.add_tag(id, "reimbursable").unwrap();

        store.delete_transaction(id, test_now()).unwrap();

        assert_eq!(store.list_all_tags().unwrap(), Vec::<String>::new());
    }

    // Setup-data import (see setup_import.rs for the parser's own tests).

    fn setup_data(text: &str) -> crate::setup_import::SetupImportResult {
        // The parser is private-by-file; round-tripping through a temp file
        // exercises the same public load_setup_csv path the app uses. Tests
        // run in parallel within this one process, so the file path must be
        // unique per *call*, not just per process — an earlier version
        // derived it from the text's length plus byte sum, which gave two
        // calls passing the identical `FULL_TEMPLATE` (used by more than
        // one test below) the exact same path. That let their
        // write/read/delete sequences race: one test's `setup_data` could
        // observe another's in-flight write or have its file deleted out
        // from under it, intermittently reading back the wrong (or
        // momentarily missing) content — observed in practice as
        // `apply_setup_import_creates_every_section_through_the_normal_paths`
        // occasionally seeing zero accounts instead of two. A monotonic
        // counter guarantees every call gets its own file regardless of
        // content.
        static CALL_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = CALL_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("vaultspend-setup-import-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("template-{n:x}.csv"));
        std::fs::write(&path, text).unwrap();
        let result = crate::setup_import::load_setup_csv(&path).unwrap();
        std::fs::remove_file(&path).ok();
        result
    }

    const FULL_TEMPLATE: &str = "Accounts\n\
        Name,Type,Starting Balance,Institution,Mask\n\
        Everyday Checking,checking,1000.00,Ally,1234\n\
        Car Loan,loan,10000.00,,\n\
        \n\
        Categories\n\
        Name\n\
        Coffee Shops\n\
        \n\
        Budgets\n\
        Category,Group,Monthly Amount,Period\n\
        Coffee Shops,flexible,50.00,2026-08\n\
        \n\
        Buckets\n\
        Name,Target Amount,Target Date,Linked Account\n\
        Emergency Fund,5000.00,,Everyday Checking\n";

    #[test]
    fn apply_setup_import_creates_every_section_through_the_normal_paths() {
        let store = Store::open_in_memory().unwrap();
        let data = setup_data(FULL_TEMPLATE);
        assert!(data.errors.is_empty(), "template must parse cleanly: {:?}", data.errors);

        let outcome = store.apply_setup_import(&data, "2026-08").unwrap();

        assert_eq!(outcome.accounts_created, 2);
        assert_eq!(outcome.categories_created, 1);
        assert_eq!(outcome.budgets_set, 1);
        assert_eq!(outcome.buckets_created, 1);
        assert!(outcome.skipped.is_empty(), "nothing should be skipped: {:?}", outcome.skipped);

        let accounts = store.list_accounts(far_future()).unwrap();
        let checking = accounts.iter().find(|a| a.account.name == "Everyday Checking").unwrap();
        assert_eq!(checking.account.account_type, AccountType::Checking);
        assert_eq!(checking.starting_balance, "1000.00".parse().unwrap());
        assert_eq!(checking.institution, Some("Ally".to_string()));
        assert_eq!(checking.mask, Some("1234".to_string()));
        assert!(accounts.iter().any(|a| a.account.name == "Car Loan"));

        assert!(store.list_categories().unwrap().contains(&"Coffee Shops".to_string()));

        let budgets = store.list_budgets("2026-08").unwrap();
        let coffee = budgets.iter().find(|b| b.category == "Coffee Shops").unwrap();
        assert_eq!(coffee.monthly_amount, "50.00".parse().unwrap());
        assert_eq!(coffee.budget_group, "flexible");

        let buckets = store.list_buckets().unwrap();
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].name, "Emergency Fund");
        assert_eq!(buckets[0].target_amount, Some("5000.00".parse().unwrap()));
        // linked by name to the account this same import created
        assert_eq!(buckets[0].account_id, Some(checking.id));
    }

    #[test]
    fn applying_the_same_template_twice_does_not_error_or_duplicate() {
        let store = Store::open_in_memory().unwrap();
        let data = setup_data(FULL_TEMPLATE);

        store.apply_setup_import(&data, "2026-08").unwrap();
        let second = store.apply_setup_import(&data, "2026-08").unwrap();

        // accounts/categories/budgets settle into the same state...
        assert_eq!(store.list_accounts(far_future()).unwrap().len(), 2);
        assert_eq!(store.list_buckets().unwrap().len(), 1);
        let budgets = store.list_budgets("2026-08").unwrap();
        assert_eq!(budgets.iter().filter(|b| b.category == "Coffee Shops").count(), 1);
        // ...and the second run's bucket lands in skipped, not a hard error
        assert_eq!(second.buckets_created, 0);
        assert_eq!(second.skipped.len(), 1);
        assert!(second.skipped[0].contains("Emergency Fund"));
    }

    #[test]
    fn a_blank_budget_period_lands_in_the_default_period() {
        let store = Store::open_in_memory().unwrap();
        let data = setup_data("Budgets\nCategory,Group,Monthly Amount,Period\nGroceries,flexible,400.00,\n");

        store.apply_setup_import(&data, "2026-09").unwrap();

        let budgets = store.list_budgets("2026-09").unwrap();
        assert_eq!(budgets.len(), 1);
        assert_eq!(budgets[0].category, "Groceries");
    }

    #[test]
    fn a_buckets_unknown_linked_account_is_skipped_but_the_bucket_is_still_created() {
        let store = Store::open_in_memory().unwrap();
        let data = setup_data("Buckets\nName,Target Amount,Target Date,Linked Account\nVacation,1000.00,,No Such Account\n");

        let outcome = store.apply_setup_import(&data, "2026-08").unwrap();

        assert_eq!(outcome.buckets_created, 1);
        assert_eq!(outcome.skipped.len(), 1);
        assert!(outcome.skipped[0].contains("No Such Account"));
        let buckets = store.list_buckets().unwrap();
        assert_eq!(buckets[0].name, "Vacation");
        assert_eq!(buckets[0].account_id, None);
    }

    #[test]
    fn apply_setup_import_creates_holdings_linked_by_account_name() {
        let store = Store::open_in_memory().unwrap();
        let data = setup_data(
            "Accounts\nName,Type,Starting Balance,Institution,Mask\nBrokerage,investment,,,\n\
             \n\
             Holdings\nAccount,Symbol,Name,Shares,Price,Cost Basis,Asset Class\n\
             Brokerage,AAPL,Apple Inc.,10,231.20,1450.00,US Stocks\n",
        );

        let outcome = store.apply_setup_import(&data, "2026-08").unwrap();

        assert_eq!(outcome.holdings_created, 1);
        assert!(outcome.skipped.is_empty());
        let holdings = store.list_holdings(test_now().date()).unwrap();
        assert_eq!(holdings.len(), 1);
        assert_eq!(holdings[0].symbol, "AAPL");
        assert_eq!(holdings[0].name, "Apple Inc.");
        assert_eq!(holdings[0].shares, "10".parse().unwrap());
        assert_eq!(holdings[0].price, "231.20".parse().unwrap());
        assert_eq!(holdings[0].cost_basis, "1450.00".parse().unwrap());
        assert_eq!(holdings[0].asset_class, Some("US Stocks".to_string()));
    }

    #[test]
    fn a_holdings_unknown_account_is_skipped_entirely_not_created_without_one() {
        let store = Store::open_in_memory().unwrap();
        let data = setup_data(
            "Holdings\nAccount,Symbol,Name,Shares,Price,Cost Basis,Asset Class\n\
             No Such Account,AAPL,,10,231.20,1450.00,\n",
        );

        let outcome = store.apply_setup_import(&data, "2026-08").unwrap();

        assert_eq!(outcome.holdings_created, 0);
        assert_eq!(outcome.skipped.len(), 1);
        assert!(outcome.skipped[0].contains("No Such Account"));
        assert!(outcome.skipped[0].contains("AAPL"));
        assert!(store.list_holdings(test_now().date()).unwrap().is_empty());
    }

    #[test]
    fn a_holdings_row_with_non_positive_shares_or_price_is_skipped_not_created() {
        let store = Store::open_in_memory().unwrap();
        let data = setup_data(
            "Accounts\nName,Type,Starting Balance,Institution,Mask\nBrokerage,investment,,,\n\
             \n\
             Holdings\nAccount,Symbol,Name,Shares,Price,Cost Basis,Asset Class\n\
             Brokerage,NEG,,-10,100.00,1000.00,\n\
             Brokerage,ZERO,,0,100.00,1000.00,\n",
        );

        let outcome = store.apply_setup_import(&data, "2026-08").unwrap();

        assert_eq!(outcome.holdings_created, 0);
        assert_eq!(outcome.skipped.len(), 2);
        assert!(outcome.skipped[0].contains("NEG"));
        assert!(outcome.skipped[1].contains("ZERO"));
        assert!(store.list_holdings(test_now().date()).unwrap().is_empty());
    }

    #[test]
    fn a_blank_holding_name_defaults_to_the_symbol() {
        let store = Store::open_in_memory().unwrap();
        let data = setup_data(
            "Accounts\nName,Type,Starting Balance,Institution,Mask\nBrokerage,investment,,,\n\
             \n\
             Holdings\nAccount,Symbol,Name,Shares,Price,Cost Basis,Asset Class\n\
             Brokerage,VTI,,5,220.00,1000.00,\n",
        );

        store.apply_setup_import(&data, "2026-08").unwrap();

        let holdings = store.list_holdings(test_now().date()).unwrap();
        assert_eq!(holdings[0].name, "VTI");
    }

    #[test]
    fn importing_a_budget_registers_its_category_too() {
        // A budget row for a category the user never separately listed in
        // the Categories section must still leave that category selectable
        // everywhere, same as creating a budget line through the UI does.
        let store = Store::open_in_memory().unwrap();
        let data = setup_data("Budgets\nCategory,Group,Monthly Amount,Period\nBrand New Category,fixed,100.00,2026-08\n");

        store.apply_setup_import(&data, "2026-08").unwrap();

        assert!(store.list_categories().unwrap().contains(&"Brand New Category".to_string()));
    }

    // Savings buckets.

    #[test]
    fn a_fresh_bucket_has_zero_saved_and_the_target_it_was_given() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_bucket("Emergency Fund", Some("1000.00".parse().unwrap()), None, None, None, None, None)
            .unwrap();

        let buckets = store.list_buckets().unwrap();
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].id, id);
        assert_eq!(buckets[0].name, "Emergency Fund");
        assert_eq!(buckets[0].target_amount, Some("1000.00".parse().unwrap()));
        assert_eq!(buckets[0].saved_amount, "0".parse().unwrap());
        assert_eq!(buckets[0].target_date, None);
        assert_eq!(buckets[0].account_id, None);
    }

    #[test]
    fn a_bucket_with_no_target_has_none() {
        let store = Store::open_in_memory().unwrap();
        store.create_bucket("Rainy Day", None, None, None, None, None, None).unwrap();

        assert_eq!(store.list_buckets().unwrap()[0].target_amount, None);
    }

    #[test]
    fn a_bucket_can_have_a_target_date_and_a_linked_account() {
        let store = Store::open_in_memory().unwrap();
        let savings = store.get_or_create_account("Nest Egg", AccountType::Savings).unwrap();
        let target_date: NaiveDate = "2027-04-15".parse().unwrap();

        store
            .create_bucket(
                "Japan Trip",
                Some("6000.00".parse().unwrap()),
                Some(target_date),
                Some(savings),
                None,
                None,
                None,
            )
            .unwrap();

        let bucket = &store.list_buckets().unwrap()[0];
        assert_eq!(bucket.target_date, Some(target_date));
        assert_eq!(bucket.account_id, Some(savings));
        assert_eq!(bucket.account_name, Some("Nest Egg".to_string()));
    }

    #[test]
    fn update_bucket_details_changes_target_and_linked_account() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_bucket("Japan Trip", None, None, None, None, None, None).unwrap();
        let savings = store.get_or_create_account("Nest Egg", AccountType::Savings).unwrap();
        let target_date: NaiveDate = "2027-04-15".parse().unwrap();

        store
            .update_bucket_details(id, Some("6000.00".parse().unwrap()), Some(target_date), Some(savings), None, None, None)
            .unwrap();

        let bucket = &store.list_buckets().unwrap()[0];
        assert_eq!(bucket.target_amount, Some("6000.00".parse().unwrap()));
        assert_eq!(bucket.target_date, Some(target_date));
        assert_eq!(bucket.account_name, Some("Nest Egg".to_string()));
    }

    #[test]
    fn update_bucket_details_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store
            .update_bucket_details(999, Some("100.00".parse().unwrap()), None, None, None, None, None)
            .unwrap();
    }

    #[test]
    fn a_bucket_created_with_a_color_reports_it_back() {
        let store = Store::open_in_memory().unwrap();
        store.create_bucket("Vacation", None, None, None, None, Some("#8A5FB0"), None).unwrap();

        assert_eq!(store.list_buckets().unwrap()[0].color, Some("#8A5FB0".to_string()));
    }

    #[test]
    fn update_bucket_details_changes_the_color() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_bucket("Vacation", None, None, None, None, Some("#8A5FB0"), None).unwrap();

        store.update_bucket_details(id, None, None, None, None, Some("#4E8FC9"), None).unwrap();

        assert_eq!(store.list_buckets().unwrap()[0].color, Some("#4E8FC9".to_string()));
    }

    #[test]
    fn contributions_accumulate_into_the_saved_amount_withdrawals_included() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_bucket("Vacation", None, None, None, None, None, None).unwrap();

        store
            .add_bucket_contribution(id, "2026-08-01".parse().unwrap(), "200.00".parse().unwrap(), None)
            .unwrap();
        store
            .add_bucket_contribution(id, "2026-08-15".parse().unwrap(), "150.00".parse().unwrap(), Some("bonus"))
            .unwrap();
        store
            .add_bucket_contribution(id, "2026-08-20".parse().unwrap(), "-50.00".parse().unwrap(), None)
            .unwrap();

        assert_eq!(store.list_buckets().unwrap()[0].saved_amount, "300.00".parse().unwrap());
    }

    #[test]
    fn each_buckets_saved_amount_is_independent() {
        let store = Store::open_in_memory().unwrap();
        let vacation = store.create_bucket("Vacation", None, None, None, None, None, None).unwrap();
        let emergency = store.create_bucket("Emergency Fund", None, None, None, None, None, None).unwrap();

        store
            .add_bucket_contribution(vacation, "2026-08-01".parse().unwrap(), "200.00".parse().unwrap(), None)
            .unwrap();
        store
            .add_bucket_contribution(emergency, "2026-08-01".parse().unwrap(), "500.00".parse().unwrap(), None)
            .unwrap();

        let buckets = store.list_buckets().unwrap();
        let vacation_saved = buckets.iter().find(|b| b.id == vacation).unwrap().saved_amount;
        let emergency_saved = buckets.iter().find(|b| b.id == emergency).unwrap().saved_amount;
        assert_eq!(vacation_saved, "200.00".parse().unwrap());
        assert_eq!(emergency_saved, "500.00".parse().unwrap());
    }

    #[test]
    fn deleting_a_bucket_removes_its_contributions_too() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_bucket("Vacation", None, None, None, None, None, None).unwrap();
        store
            .add_bucket_contribution(id, "2026-08-01".parse().unwrap(), "200.00".parse().unwrap(), None)
            .unwrap();

        store.delete_bucket(id).unwrap();

        assert_eq!(store.list_buckets().unwrap().len(), 0);
        // re-creating a bucket of the same name must not resurrect the old contributions
        let new_id = store.create_bucket("Vacation", None, None, None, None, None, None).unwrap();
        assert_eq!(store.list_buckets().unwrap()[0].saved_amount, "0".parse().unwrap());
        assert_ne!(id, new_id);
    }

    #[test]
    fn a_bucket_with_no_sinking_amount_is_left_untouched_by_apply_sinking_fund_contributions() {
        let store = Store::open_in_memory().unwrap();
        store.create_bucket("Vacation", None, None, None, None, None, None).unwrap();

        let applied = store.apply_sinking_fund_contributions("2026-09-04".parse().unwrap()).unwrap();

        assert!(applied.is_empty());
        assert_eq!(store.list_buckets().unwrap()[0].saved_amount, Decimal::ZERO);
    }

    #[test]
    fn sinking_fund_contribution_is_a_no_op_the_second_time_in_the_same_month() {
        let store = Store::open_in_memory().unwrap();
        store
            .create_bucket("Car Insurance", None, None, None, Some("50.00".parse().unwrap()), None, None)
            .unwrap();

        let first = store.apply_sinking_fund_contributions("2026-09-04".parse().unwrap()).unwrap();
        let second = store.apply_sinking_fund_contributions("2026-09-20".parse().unwrap()).unwrap();

        assert_eq!(first.len(), 1);
        assert_eq!(first[0].2, "50.00".parse().unwrap());
        assert!(second.is_empty(), "already contributed this month, must not fire twice");
        assert_eq!(store.list_buckets().unwrap()[0].saved_amount, "50.00".parse().unwrap());
    }

    #[test]
    fn a_sinking_fund_contribution_still_allows_a_manual_contribution_the_same_month() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_bucket("Car Insurance", None, None, None, Some("50.00".parse().unwrap()), None, None)
            .unwrap();

        store.apply_sinking_fund_contributions("2026-09-04".parse().unwrap()).unwrap();
        store
            .add_bucket_contribution(id, "2026-09-10".parse().unwrap(), "25.00".parse().unwrap(), Some("extra"))
            .unwrap();

        assert_eq!(store.list_buckets().unwrap()[0].saved_amount, "75.00".parse().unwrap());
    }

    #[test]
    fn deleting_a_bucket_also_clears_its_auto_contribution_guard() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_bucket("Car Insurance", None, None, None, Some("50.00".parse().unwrap()), None, None)
            .unwrap();
        store.apply_sinking_fund_contributions("2026-09-04".parse().unwrap()).unwrap();

        store.delete_bucket(id).unwrap();

        // Re-creating a same-named sinking-fund bucket must be able to
        // auto-contribute this exact month again — proving the old
        // bucket's guard row didn't survive the delete.
        let new_id = store
            .create_bucket("Car Insurance", None, None, None, Some("50.00".parse().unwrap()), None, None)
            .unwrap();
        let applied = store.apply_sinking_fund_contributions("2026-09-04".parse().unwrap()).unwrap();
        assert_eq!(applied.len(), 1);
        assert_eq!(applied[0].0, new_id);
    }

    // Budgets.

    #[test]
    fn set_budget_creates_then_list_budgets_returns_it_sorted() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget("Dining Out", "0000-01", "150.00".parse().unwrap(), "flexible").unwrap();

        let budgets = store.list_budgets("0000-01").unwrap();
        assert_eq!(budgets.len(), 2);
        assert_eq!(budgets[0].category, "Dining Out");
        assert_eq!(budgets[0].monthly_amount, "150.00".parse().unwrap());
        assert_eq!(budgets[1].category, "Groceries");
        assert_eq!(budgets[1].monthly_amount, "400.00".parse().unwrap());
    }

    #[test]
    fn set_budget_persists_the_group() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Paycheck", "0000-01", "6000.00".parse().unwrap(), "income").unwrap();

        assert_eq!(store.list_budgets("0000-01").unwrap()[0].budget_group, "income");
    }

    #[test]
    fn budget_upsert_field_matrix() {
        struct Case {
            label: &'static str,
            first_amount: &'static str,
            first_group: &'static str,
            second_amount: &'static str,
            second_group: &'static str,
            expected_amount: &'static str,
            expected_group: &'static str,
        }
        let cases = [
            Case {
                label: "re-setting the amount updates rather than duplicates",
                first_amount: "400.00",
                first_group: "flexible",
                second_amount: "450.00",
                second_group: "flexible",
                expected_amount: "450.00",
                expected_group: "flexible",
            },
            Case {
                label: "re-setting the group updates it too",
                first_amount: "400.00",
                first_group: "flexible",
                second_amount: "400.00",
                second_group: "nonmonthly",
                expected_amount: "400.00",
                expected_group: "nonmonthly",
            },
        ];

        for case in cases {
            let store = Store::open_in_memory().unwrap();
            store
                .set_budget("Groceries", "0000-01", case.first_amount.parse().unwrap(), case.first_group)
                .unwrap();
            store
                .set_budget("Groceries", "0000-01", case.second_amount.parse().unwrap(), case.second_group)
                .unwrap();

            let budgets = store.list_budgets("0000-01").unwrap();
            assert_eq!(budgets.len(), 1, "case: {}", case.label);
            assert_eq!(budgets[0].monthly_amount, case.expected_amount.parse().unwrap(), "case: {}", case.label);
            assert_eq!(budgets[0].budget_group, case.expected_group, "case: {}", case.label);
        }
    }

    #[test]
    fn delete_budget_removes_it() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();

        store.delete_budget("Groceries", "0000-01").unwrap();

        assert_eq!(store.list_budgets("0000-01").unwrap(), vec![]);
    }

    #[test]
    fn delete_budget_on_an_unknown_category_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_budget("Nonexistent", "0000-01").unwrap();
    }

    #[test]
    fn list_budgets_starts_empty_when_theres_nothing_earlier_to_copy_from() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.list_budgets("2026-08").unwrap(), vec![]);
    }

    #[test]
    fn a_new_month_copies_the_most_recent_earlier_periods_budget_as_a_starting_point() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "2026-08", "400.00".parse().unwrap(), "flexible").unwrap();

        let september = store.list_budgets("2026-09").unwrap();

        assert_eq!(september.len(), 1);
        assert_eq!(september[0].category, "Groceries");
        assert_eq!(september[0].monthly_amount, "400.00".parse().unwrap());
    }

    #[test]
    fn editing_one_months_budget_does_not_affect_a_different_month() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "2026-08", "400.00".parse().unwrap(), "flexible").unwrap();
        store.list_budgets("2026-09").unwrap(); // materialize September from August, same as just viewing it

        store.set_budget("Groceries", "2026-09", "600.00".parse().unwrap(), "flexible").unwrap();

        let august = store.list_budgets("2026-08").unwrap();
        let september = store.list_budgets("2026-09").unwrap();

        assert_eq!(
            august[0].monthly_amount,
            "400.00".parse().unwrap(),
            "editing September must not change August"
        );
        assert_eq!(september[0].monthly_amount, "600.00".parse().unwrap());
    }

    #[test]
    fn editing_a_months_budget_does_not_retroactively_change_an_earlier_month() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "2026-07", "300.00".parse().unwrap(), "flexible").unwrap();
        store.list_budgets("2026-08").unwrap(); // materialize August from July

        store.set_budget("Groceries", "2026-08", "500.00".parse().unwrap(), "flexible").unwrap();

        let july = store.list_budgets("2026-07").unwrap();
        assert_eq!(july[0].monthly_amount, "300.00".parse().unwrap(), "editing August must not change July");
    }

    #[test]
    fn deleting_a_budget_line_in_one_month_does_not_delete_it_in_another() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "2026-08", "400.00".parse().unwrap(), "flexible").unwrap();
        store.list_budgets("2026-09").unwrap(); // materialize September too

        store.delete_budget("Groceries", "2026-09").unwrap();

        assert_eq!(
            store.list_budgets("2026-08").unwrap().len(),
            1,
            "August's line must survive deleting September's"
        );
        assert_eq!(store.list_budgets("2026-09").unwrap(), vec![]);
    }

    #[test]
    fn opening_a_pre_period_scoped_budgets_database_migrates_it_without_losing_data() {
        // Simulates a real database created before budgets were split per
        // month: a `budgets` table with `category` as its sole primary key.
        let dir = std::env::temp_dir().join(format!("meadow-budget-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_period_budgets.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE budgets (
                    category TEXT PRIMARY KEY,
                    monthly_amount TEXT NOT NULL,
                    budget_group TEXT NOT NULL DEFAULT 'flexible'
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO budgets (category, monthly_amount, budget_group) VALUES ('Groceries', '400.00', 'flexible')",
                [],
            )
            .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let budgets = store.list_budgets("2026-08").unwrap();

        assert_eq!(budgets.len(), 1, "the pre-existing budget must survive the migration");
        assert_eq!(budgets[0].category, "Groceries");
        assert_eq!(budgets[0].monthly_amount, "400.00".parse().unwrap());

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn opening_a_database_with_period_scoped_budgets_but_no_tracking_table_still_finds_them() {
        // Simulates a database already migrated to the (category, period)
        // schema by an earlier build that predates `budget_periods` —
        // the tracker must be backfilled from what's actually in
        // `budgets`, not just seeded at migration time, or these rows
        // silently look untouched and become invisible.
        let dir = std::env::temp_dir().join(format!("meadow-budget-tracker-backfill-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("period_scoped_no_tracker.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE budgets (
                    category TEXT NOT NULL,
                    period TEXT NOT NULL,
                    monthly_amount TEXT NOT NULL,
                    budget_group TEXT NOT NULL DEFAULT 'flexible',
                    PRIMARY KEY (category, period)
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES ('Groceries', '0000-01', '400.00', 'flexible')",
                [],
            )
            .unwrap();
            // deliberately no `budget_periods` table at all yet
        }

        let store = Store::open(&db_path).unwrap();
        let budgets = store.list_budgets("2026-08").unwrap();

        assert_eq!(budgets.len(), 1, "the pre-existing row must still be found and copied forward");
        assert_eq!(budgets[0].category, "Groceries");
        assert_eq!(budgets[0].monthly_amount, "400.00".parse().unwrap());

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    // Reporting.

    #[test]
    fn total_saved_is_zero_with_no_buckets() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.total_saved().unwrap(), Decimal::ZERO);
    }

    #[test]
    fn total_saved_sums_contributions_across_every_bucket() {
        let store = Store::open_in_memory().unwrap();
        let vacation = store.create_bucket("Vacation", None, None, None, None, None, None).unwrap();
        let emergency = store.create_bucket("Emergency Fund", None, None, None, None, None, None).unwrap();
        store
            .add_bucket_contribution(vacation, "2026-08-01".parse().unwrap(), "200.00".parse().unwrap(), None)
            .unwrap();
        store
            .add_bucket_contribution(emergency, "2026-08-01".parse().unwrap(), "500.00".parse().unwrap(), None)
            .unwrap();
        store
            .add_bucket_contribution(vacation, "2026-08-15".parse().unwrap(), "-50.00".parse().unwrap(), None)
            .unwrap();

        assert_eq!(store.total_saved().unwrap(), "650.00".parse().unwrap());
    }

    #[test]
    fn income_total_sums_every_positive_non_transfer_transaction_regardless_of_category() {
        // Not "sums only the Income category" — a paycheck categorized
        // "Salary" (or left uncategorized) must count exactly like one
        // categorized "Income", matching monthly_totals on the backend.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-01", "Payroll Deposit", "3000.00"),
                    tx("2026-08-15", "Payroll Deposit", "3000.00"),
                    tx("2026-08-20", "Green Leaf Grocers", "-80.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Income", CategorySource::User, None).unwrap();
        store.set_category(ids[1], "Salary", CategorySource::User, None).unwrap();
        store.set_category(ids[2], "Groceries", CategorySource::User, None).unwrap();

        assert_eq!(store.income_total().unwrap(), "6000.00".parse().unwrap());
    }

    #[test]
    fn income_total_excludes_transfers_and_credit_loan_balance_entries() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let credit_card = store.get_or_create_account("Visa", AccountType::Credit).unwrap();
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store
            .save_transactions(
                checking,
                &[
                    tx("2026-08-01", "Payroll Deposit", "3000.00"),
                    Transaction {
                        category: Some("Transfer".to_string()),
                        ..tx("2026-08-10", "From Savings", "500.00")
                    },
                ],
            )
            .unwrap();
        store
            .save_transactions(credit_card, &[tx("2026-08-21", "VISA ONLINE PYMT", "200.00")])
            .unwrap();
        store.save_transactions(loan, &[tx("2026-08-22", "Escrow Refund", "75.00")]).unwrap();

        assert_eq!(
            store.income_total().unwrap(),
            "3000.00".parse().unwrap(),
            "only the paycheck counts — the transfer-in, credit card credit, and loan refund must not"
        );
    }

    #[test]
    fn monthly_budget_actuals_reports_only_this_months_spend_per_budgeted_category() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                    tx("2026-08-20", "Fresh Market", "-60.00"),
                    tx("2026-07-25", "Old Month Grocers", "-999.00"), // different month, excluded
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Groceries", CategorySource::User, None).unwrap();
        store.set_category(ids[1], "Groceries", CategorySource::User, None).unwrap();
        store.set_category(ids[2], "Groceries", CategorySource::User, None).unwrap();

        let actuals = store.monthly_budget_actuals(2026, 8).unwrap();

        assert_eq!(actuals.len(), 1);
        assert_eq!(actuals[0].category, "Groceries");
        assert_eq!(actuals[0].budget_group, "flexible");
        assert_eq!(actuals[0].budgeted, "400.00".parse().unwrap());
        assert_eq!(actuals[0].actual, "140.00".parse().unwrap());
    }

    #[test]
    fn monthly_budget_actuals_reports_zero_spend_for_a_budgeted_category_with_no_transactions_yet() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Pet Care", "0000-01", "50.00".parse().unwrap(), "flexible").unwrap();

        let actuals = store.monthly_budget_actuals(2026, 8).unwrap();

        assert_eq!(actuals.len(), 1);
        assert_eq!(actuals[0].category, "Pet Care");
        assert_eq!(actuals[0].budgeted, "50.00".parse().unwrap());
        assert_eq!(actuals[0].actual, Decimal::ZERO);
    }

    #[test]
    fn monthly_budget_actuals_works_for_a_month_other_than_the_current_one() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store.save_transactions(account, &[tx("2025-03-10", "Old Grocers", "-55.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();

        let march_2025 = store.monthly_budget_actuals(2025, 3).unwrap();
        let august_2026 = store.monthly_budget_actuals(2026, 8).unwrap();

        assert_eq!(march_2025[0].actual, "55.00".parse().unwrap());
        assert_eq!(august_2026[0].actual, Decimal::ZERO, "a different month must not see March's spend");
    }

    #[test]
    fn monthly_budget_actuals_reports_a_positive_actual_for_an_income_budget_line() {
        // Income transactions are stored as positive deposits, unlike
        // expense transactions which are negative — an income budget
        // line's "actual" must not be negated the way an expense line's is.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Paycheck", "0000-01", "5000.00".parse().unwrap(), "income").unwrap();
        store.save_transactions(account, &[tx("2026-08-05", "Employer Inc", "1200.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Paycheck", CategorySource::User, None).unwrap();

        let actuals = store.monthly_budget_actuals(2026, 8).unwrap();

        assert_eq!(actuals[0].actual, "1200.00".parse().unwrap());
    }

    #[test]
    fn monthly_budget_actuals_by_member_splits_one_categorys_actual_across_two_members() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let alex = store.create_family_member("Alex").unwrap();
        let jordan = store.create_family_member("Jordan").unwrap();
        store.set_budget("Groceries", "0000-01", "300.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-05", "Green Leaf Grocers", "-60.00"),
                    tx("2026-08-06", "Corner Store", "-40.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Groceries", CategorySource::User, None).unwrap();
        }
        store.set_transaction_member(ids[0], Some(alex)).unwrap();
        store.set_transaction_member(ids[1], Some(jordan)).unwrap();

        let by_member = store.monthly_budget_actuals_by_member(2026, 8).unwrap();

        assert_eq!(by_member.len(), 2, "got {by_member:?}");
        let alex_row = by_member.iter().find(|m| m.member_id == Some(alex)).unwrap();
        let jordan_row = by_member.iter().find(|m| m.member_id == Some(jordan)).unwrap();
        assert_eq!(alex_row.actual, "60.00".parse().unwrap());
        assert_eq!(
            alex_row.budgeted,
            "300.00".parse().unwrap(),
            "the shared budget target repeats on every member row"
        );
        assert_eq!(jordan_row.actual, "40.00".parse().unwrap());
    }

    #[test]
    fn monthly_budget_actuals_by_member_attributes_a_split_line_to_its_parent_transactions_member() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let alex = store.create_family_member("Alex").unwrap();
        store.set_budget("Groceries", "0000-01", "200.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget("Household", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
        store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();
        store.set_transaction_member(id, Some(alex)).unwrap();
        store
            .set_transaction_splits(
                id,
                &[
                    ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                    ("Household".to_string(), "-40.00".parse().unwrap(), None),
                ],
            )
            .unwrap();

        let by_member = store.monthly_budget_actuals_by_member(2026, 8).unwrap();

        let groceries = by_member.iter().find(|m| m.category == "Groceries").unwrap();
        let household = by_member.iter().find(|m| m.category == "Household").unwrap();
        assert_eq!(
            groceries.member_id,
            Some(alex),
            "a split line has no member of its own — it's the parent's"
        );
        assert_eq!(household.member_id, Some(alex));
    }

    #[test]
    fn monthly_budget_actuals_by_member_buckets_an_unattributed_transaction_as_unassigned() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "200.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(account, &[tx("2026-08-05", "Green Leaf Grocers", "-60.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();

        let by_member = store.monthly_budget_actuals_by_member(2026, 8).unwrap();

        assert_eq!(by_member.len(), 1);
        assert_eq!(by_member[0].member_id, None);
        assert_eq!(by_member[0].member_name, None);
        assert_eq!(by_member[0].actual, "60.00".parse().unwrap());
    }

    #[test]
    fn monthly_budget_actuals_by_member_sums_to_the_same_total_monthly_budget_actuals_reports_per_category() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let alex = store.create_family_member("Alex").unwrap();
        store.set_budget("Groceries", "0000-01", "300.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-05", "Green Leaf Grocers", "-60.00"),
                    tx("2026-08-06", "Corner Store", "-40.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Groceries", CategorySource::User, None).unwrap();
        }
        store.set_transaction_member(ids[0], Some(alex)).unwrap(); // ids[1] left unattributed

        let whole_total = store.monthly_budget_actuals(2026, 8).unwrap()[0].actual;
        let by_member_total: Decimal = store.monthly_budget_actuals_by_member(2026, 8).unwrap().iter().map(|m| m.actual).sum();

        assert_eq!(
            by_member_total, whole_total,
            "the per-member rows must reconcile with the category's own total"
        );
    }

    #[test]
    fn month_key_back_walks_backward_across_a_year_boundary() {
        assert_eq!(month_key_back(2026, 8, 0), "2026-08");
        assert_eq!(month_key_back(2026, 8, 1), "2026-07");
        assert_eq!(month_key_back(2026, 8, 8), "2025-12");
        assert_eq!(month_key_back(2026, 1, 1), "2025-12");
    }

    #[test]
    fn budget_actuals_trend_returns_one_point_per_month_oldest_first() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(
                account,
                &[
                    tx("2026-06-05", "Grocers", "-100.00"),
                    tx("2026-07-05", "Grocers", "-150.00"),
                    tx("2026-08-05", "Grocers", "-200.00"),
                ],
            )
            .unwrap();
        for t in store.all_transactions().unwrap() {
            store.set_category(t.id, "Groceries", CategorySource::User, None).unwrap();
        }

        let trend = store.budget_actuals_trend("Groceries", 2026, 8, 3).unwrap();

        assert_eq!(
            trend,
            vec![
                ("2026-06".to_string(), "100.00".parse().unwrap()),
                ("2026-07".to_string(), "150.00".parse().unwrap()),
                ("2026-08".to_string(), "200.00".parse().unwrap()),
            ]
        );
    }

    #[test]
    fn budget_actuals_trend_reports_zero_not_a_missing_point_for_a_month_with_no_spend() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Pet Care", "0000-01", "50.00".parse().unwrap(), "flexible").unwrap();

        let trend = store.budget_actuals_trend("Pet Care", 2026, 8, 4).unwrap();

        assert_eq!(trend.len(), 4);
        assert!(trend.iter().all(|(_, amount)| *amount == Decimal::ZERO));
    }

    #[test]
    fn budget_actuals_trend_reports_a_positive_actual_for_an_income_category() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Paycheck", "0000-01", "5000.00".parse().unwrap(), "income").unwrap();
        store.save_transactions(account, &[tx("2026-08-05", "Employer Inc", "1200.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Paycheck", CategorySource::User, None).unwrap();

        let trend = store.budget_actuals_trend("Paycheck", 2026, 8, 1).unwrap();

        assert_eq!(trend, vec![("2026-08".to_string(), "1200.00".parse().unwrap())]);
    }

    // Transactions for a category in a month (Budget page drill-down).

    #[test]
    fn transactions_for_category_in_month_returns_whole_transactions_in_that_category_and_month() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-05", "City Power & Light", "-120.00"),
                    tx("2026-08-20", "Groceries R Us", "-60.00"),      // different category
                    tx("2025-07-05", "City Power & Light", "-110.00"), // different month
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Utilities", CategorySource::User, None).unwrap();
        store.set_category(ids[1], "Groceries", CategorySource::User, None).unwrap();
        store.set_category(ids[2], "Utilities", CategorySource::User, None).unwrap();

        let result = store.transactions_for_category_in_month("Utilities", 2026, 8).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].transaction_id, ids[0]);
        assert_eq!(result[0].description, "City Power & Light");
        assert_eq!(result[0].amount, "-120.00".parse().unwrap());
        assert_eq!(result[0].account_name, "Test Checking");
        assert!(!result[0].is_split);
        assert_eq!(result[0].split_note, None);
    }

    #[test]
    fn transactions_for_category_in_month_includes_a_splits_own_line_instead_of_the_parent() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-10", "Costco", "-150.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Shopping", CategorySource::User, None).unwrap();
        store
            .set_transaction_splits(
                id,
                &[
                    ("Groceries".to_string(), "-100.00".parse().unwrap(), None),
                    ("Household".to_string(), "-50.00".parse().unwrap(), Some("paper towels".to_string())),
                ],
            )
            .unwrap();

        let groceries = store.transactions_for_category_in_month("Groceries", 2026, 8).unwrap();
        let shopping = store.transactions_for_category_in_month("Shopping", 2026, 8).unwrap();

        assert_eq!(groceries.len(), 1);
        assert_eq!(groceries[0].transaction_id, id);
        assert_eq!(groceries[0].amount, "-100.00".parse().unwrap());
        assert!(groceries[0].is_split);
        assert_eq!(groceries[0].split_note, None);

        let household = store.transactions_for_category_in_month("Household", 2026, 8).unwrap();
        assert_eq!(household[0].split_note.as_deref(), Some("paper towels"));

        assert!(
            shopping.is_empty(),
            "a split transaction no longer counts under its own original category"
        );
    }

    #[test]
    fn transactions_for_category_in_month_sorts_oldest_first() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[tx("2026-08-20", "Later Bill", "-40.00"), tx("2026-08-05", "Earlier Bill", "-30.00")],
            )
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Utilities", CategorySource::User, None).unwrap();
        }

        let result = store.transactions_for_category_in_month("Utilities", 2026, 8).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].description, "Earlier Bill");
        assert_eq!(result[1].description, "Later Bill");
    }

    // Budget threshold alerts.

    #[test]
    fn budget_alerts_for_month_uncapped_threshold_matrix() {
        struct Case {
            label: &'static str,
            spent: &'static str,
            expect_alert: bool,
            expected_category: Option<&'static str>,
            expected_level: Option<&'static str>,
            expected_pct: Option<&'static str>,
        }
        let cases = [
            Case {
                label: "25% spent should not alert",
                spent: "-100.00",
                expect_alert: false,
                expected_category: None,
                expected_level: None,
                expected_pct: None,
            },
            Case {
                label: "80% spent is a warning",
                spent: "-320.00",
                expect_alert: true,
                expected_category: Some("Groceries"),
                expected_level: Some("warning"),
                expected_pct: None,
            },
            // Landing exactly on budget (remaining == $0.00) isn't
            // overspending — only spending *past* it is. "over" is
            // reserved for that.
            Case {
                label: "spent down to exactly the budget is a warning, not over",
                spent: "-400.00",
                expect_alert: true,
                expected_category: None,
                expected_level: Some("warning"),
                expected_pct: Some("100"),
            },
            Case {
                label: "spent past the budget is over",
                spent: "-450.00",
                expect_alert: true,
                expected_category: None,
                expected_level: Some("over"),
                expected_pct: None,
            },
        ];

        for case in cases {
            let store = Store::open_in_memory().unwrap();
            let account = test_account(&store);
            store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
            store
                .save_transactions(account, &[tx("2026-08-05", "Green Leaf Grocers", case.spent)])
                .unwrap();
            let id = store.all_transactions().unwrap()[0].id;
            store.set_category(id, "Groceries", CategorySource::User, None).unwrap();

            let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

            if !case.expect_alert {
                assert!(alerts.is_empty(), "case: {} — got {alerts:?}", case.label);
                continue;
            }
            assert_eq!(alerts.len(), 1, "case: {}", case.label);
            if let Some(category) = case.expected_category {
                assert_eq!(alerts[0].category, category, "case: {}", case.label);
            }
            if let Some(level) = case.expected_level {
                assert_eq!(alerts[0].level, level, "case: {}", case.label);
            }
            if let Some(pct) = case.expected_pct {
                assert_eq!(alerts[0].pct, pct.parse().unwrap(), "case: {}", case.label);
            }
        }
    }

    #[test]
    fn budget_alerts_for_month_never_flags_an_income_line() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Paycheck", "0000-01", "5000.00".parse().unwrap(), "income").unwrap();
        store.save_transactions(account, &[tx("2026-08-05", "Employer Inc", "9000.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Paycheck", CategorySource::User, None).unwrap();

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        assert!(alerts.is_empty(), "exceeding an income budget should never alert, got {alerts:?}");
    }

    #[test]
    fn budget_alerts_for_month_sorts_most_severe_first() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        // A "warning" (85%), a mildly-"over" (110%), and a badly-"over"
        // (200%) category — inserted in an order that doesn't already
        // match the expected output, so a passing test can't be an
        // accident of insertion order.
        store.set_budget("Warning Cat", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget("Mild Over", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget("Bad Over", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-01", "Warning Merchant", "-85.00"),
                    tx("2026-08-02", "Mild Over Merchant", "-110.00"),
                    tx("2026-08-03", "Bad Over Merchant", "-200.00"),
                ],
            )
            .unwrap();
        for t in store.all_transactions().unwrap() {
            let category = if t.transaction.description.contains("Warning") {
                "Warning Cat"
            } else if t.transaction.description.contains("Mild") {
                "Mild Over"
            } else {
                "Bad Over"
            };
            store.set_category(t.id, category, CategorySource::User, None).unwrap();
        }

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        let names: Vec<&str> = alerts.iter().map(|a| a.category.as_str()).collect();
        assert_eq!(names, vec!["Bad Over", "Mild Over", "Warning Cat"], "got {alerts:?}");
    }

    #[test]
    fn budget_alerts_for_month_never_flags_a_zero_budgeted_line() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Miscellaneous", "0000-01", "0.00".parse().unwrap(), "flexible").unwrap();
        store.save_transactions(account, &[tx("2026-08-05", "Odds and Ends", "-50.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Miscellaneous", CategorySource::User, None).unwrap();

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        assert!(alerts.is_empty(), "a zero-budgeted line has nothing to alert against, got {alerts:?}");
    }

    #[test]
    fn budget_alerts_for_month_does_not_yet_warn_a_capped_category_below_90_percent_even_though_an_uncapped_category_at_the_same_spend_already_would()
    {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Dining Out", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget_cap("Dining Out", "0000-01", true).unwrap();
        store.set_budget("Groceries", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(
                account,
                &[tx("2026-08-01", "Restaurant", "-85.00"), tx("2026-08-02", "Green Leaf Grocers", "-85.00")],
            )
            .unwrap();
        for t in store.all_transactions().unwrap() {
            let category = if t.transaction.description == "Restaurant" {
                "Dining Out"
            } else {
                "Groceries"
            };
            store.set_category(t.id, category, CategorySource::User, None).unwrap();
        }

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        assert_eq!(
            alerts.len(),
            1,
            "85% clears the uncapped 80% bar but not the capped 90% one, got {alerts:?}"
        );
        assert_eq!(alerts[0].category, "Groceries");
    }

    #[test]
    fn budget_alerts_for_month_flags_a_capped_category_once_it_reaches_90_percent() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Dining Out", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget_cap("Dining Out", "0000-01", true).unwrap();
        store.save_transactions(account, &[tx("2026-08-01", "Restaurant", "-92.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].category, "Dining Out");
        assert_eq!(alerts[0].level, "warning");
        assert!(alerts[0].cap_enabled);
    }

    #[test]
    fn turning_off_the_envelope_caps_feature_suspends_a_categorys_cap_without_clearing_it() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Dining Out", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget_cap("Dining Out", "0000-01", true).unwrap();
        store.save_transactions(account, &[tx("2026-08-01", "Restaurant", "-85.00")]).unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();

        store.set_envelope_caps_enabled(false).unwrap();
        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();
        assert_eq!(alerts.len(), 1, "with the feature off, 85% must fall back to the plain 80% threshold");
        assert!(!alerts[0].cap_enabled, "the effective cap reported here should read as off too");

        // Turning it back on restores the 90% threshold — the category's
        // own cap_enabled flag was never touched by the feature toggle.
        store.set_envelope_caps_enabled(true).unwrap();
        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();
        assert!(alerts.is_empty(), "85% is back below the capped 90% bar once the feature is re-enabled");
    }

    #[test]
    fn budget_alerts_for_month_still_uses_80_percent_for_a_category_that_never_opted_into_a_cap() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(account, &[tx("2026-08-05", "Green Leaf Grocers", "-85.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        assert_eq!(alerts.len(), 1, "85% must still warn an uncapped category, got {alerts:?}");
        assert!(!alerts[0].cap_enabled);
    }

    #[test]
    fn list_budgets_carries_a_categorys_cap_setting_forward_into_a_new_month() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Dining Out", "2026-08", "100.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget_cap("Dining Out", "2026-08", true).unwrap();

        // Touching September for the first time materializes it by copying
        // August forward — the cap setting must come along, not silently
        // reset to off.
        let september = store.list_budgets("2026-09").unwrap();

        assert_eq!(september.len(), 1);
        assert!(september[0].cap_enabled, "the cap setting must carry forward with the rest of the line");
    }

    #[test]
    fn set_budget_cap_on_a_category_with_no_budget_line_this_period_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget_cap("Groceries", "2026-08", true).unwrap();
    }

    // Materialization is first-touch-wins, same as it's always been for
    // monthly_amount/budget_group: a later period copies whatever the
    // source period looks like *the moment it's first viewed*, then never
    // re-syncs. Browsing ahead to a future month before finishing an edit
    // in the current month freezes that future month at the stale value —
    // pre-existing behavior that cap_enabled inherits by riding along in
    // the same copy-forward mechanism, not a regression this feature added.
    #[test]
    fn a_period_materialized_before_a_sources_cap_is_set_does_not_retroactively_pick_it_up() {
        let store = Store::open_in_memory().unwrap();
        store.set_budget("Groceries", "2026-09", "550.00".parse().unwrap(), "flexible").unwrap();

        let _ = store.list_budgets("2026-10").unwrap();

        store.set_budget_cap("Groceries", "2026-09", true).unwrap();

        let september = store.list_budgets("2026-09").unwrap();
        assert!(september.iter().find(|b| b.category == "Groceries").unwrap().cap_enabled);

        let october = store.list_budgets("2026-10").unwrap();
        assert!(!october.iter().find(|b| b.category == "Groceries").unwrap().cap_enabled);
    }

    // Anomaly flags.

    #[test]
    fn flags_a_transaction_far_above_its_categorys_recent_average_as_large() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        // Three prior Dining Out transactions averaging $20, all within
        // the trailing 180 days of the one being tested.
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-01", "Cafe One", "-15.00"),
                    tx("2026-07-10", "Cafe Two", "-20.00"),
                    tx("2026-07-20", "Cafe Three", "-25.00"),
                    tx("2026-08-01", "Fancy Steakhouse", "-200.00"), // way above the $20 average
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let flags = store.anomaly_flags().unwrap();

        let large_flags: Vec<_> = flags.iter().filter(|f| f.kind == "large").collect();
        assert_eq!(large_flags.len(), 1);
        assert_eq!(large_flags[0].transaction_id, *ids.last().unwrap());
    }

    #[test]
    fn does_not_flag_a_large_transaction_in_a_category_with_too_little_history() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        // Only two prior transactions — below the 3-transaction minimum.
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-01", "Cafe One", "-15.00"),
                    tx("2026-07-10", "Cafe Two", "-20.00"),
                    tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let flags = store.anomaly_flags().unwrap();

        assert!(flags.iter().all(|f| f.kind != "large"), "too little history to judge, got {flags:?}");
    }

    #[test]
    fn flags_two_same_amount_similarly_described_transactions_within_a_few_days_as_duplicates_even_across_accounts() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let savings = store.get_or_create_account("Savings", AccountType::Savings).unwrap();
        store.save_transactions(checking, &[tx("2026-08-05", "Netflix 4471", "-15.99")]).unwrap();
        store.save_transactions(savings, &[tx("2026-08-06", "Netflix 8823", "-15.99")]).unwrap();

        let flags = store.anomaly_flags().unwrap();

        let dup_flags: Vec<_> = flags.iter().filter(|f| f.kind == "duplicate").collect();
        assert_eq!(dup_flags.len(), 2, "both sides of the pair should be flagged, got {flags:?}");
    }

    #[test]
    fn does_not_flag_transactions_that_only_share_amount_but_not_description() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-05", "Netflix", "-15.99"), tx("2026-08-06", "Spotify", "-15.99")])
            .unwrap();

        let flags = store.anomaly_flags().unwrap();

        assert!(flags.iter().all(|f| f.kind != "duplicate"), "different merchants, got {flags:?}");
    }

    #[test]
    fn duplicate_anomaly_time_window_matrix() {
        struct Case {
            label: &'static str,
            second_date: &'static str,
            expect_duplicate_flags: bool,
        }
        let cases = [
            Case {
                label: "exactly 3 days apart must still flag both sides",
                second_date: "2026-08-04",
                expect_duplicate_flags: true,
            },
            Case {
                label: "4 days apart is one day past the window",
                second_date: "2026-08-05",
                expect_duplicate_flags: false,
            },
            Case {
                label: "19 days apart is a normal monthly bill",
                second_date: "2026-08-20",
                expect_duplicate_flags: false,
            },
        ];

        for case in cases {
            let store = Store::open_in_memory().unwrap();
            let account = test_account(&store);
            store
                .save_transactions(
                    account,
                    &[tx("2026-08-01", "Netflix", "-15.99"), tx(case.second_date, "Netflix", "-15.99")],
                )
                .unwrap();

            let flags = store.anomaly_flags().unwrap();
            if case.expect_duplicate_flags {
                assert_eq!(
                    flags.iter().filter(|f| f.kind == "duplicate").count(),
                    2,
                    "case: {} — got {flags:?}",
                    case.label
                );
            } else {
                assert!(flags.iter().all(|f| f.kind != "duplicate"), "case: {} — got {flags:?}", case.label);
            }
        }
    }

    // Boundary cases for the sliding-window/bucketed rewrite of
    // `anomaly_flags` — a wrong rewrite here would silently change which
    // transactions get flagged, so these exercise the exact edges of
    // every threshold in its doc comment.

    #[test]
    fn large_anomaly_history_window_matrix() {
        struct Case {
            label: &'static str,
            // Date of the oldest ("Cafe Zero"/"Cafe One") history row.
            oldest_history_date: &'static str,
            expect_large_flag: bool,
        }
        let cases = [
            Case {
                // Exactly 180 days before 2026-08-01 is 2026-02-02 — must
                // still count (the window is `>=`, not `>`).
                label: "a history item exactly 180 days back must still count",
                oldest_history_date: "2026-02-02",
                expect_large_flag: true,
            },
            Case {
                // 181 days before 2026-08-01 is 2026-02-01 — one day too
                // old, so only 2 of these 3 fall in-window, leaving too
                // little history to judge (< 3).
                label: "181 days back is one day outside the window, too little history to judge",
                oldest_history_date: "2026-02-01",
                expect_large_flag: false,
            },
        ];

        for case in cases {
            let store = Store::open_in_memory().unwrap();
            let account = test_account(&store);
            store
                .save_transactions(
                    account,
                    &[
                        tx(case.oldest_history_date, "Cafe One", "-20.00"),
                        tx("2026-03-01", "Cafe Two", "-20.00"),
                        tx("2026-04-01", "Cafe Three", "-20.00"),
                        tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
                    ],
                )
                .unwrap();
            let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
            for id in &ids {
                store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
            }

            let flags = store.anomaly_flags().unwrap();
            if case.expect_large_flag {
                assert!(
                    flags.iter().any(|f| f.kind == "large" && f.transaction_id == *ids.last().unwrap()),
                    "case: {} — got {flags:?}",
                    case.label
                );
            } else {
                assert!(
                    flags.iter().all(|f| f.transaction_id != *ids.last().unwrap()),
                    "case: {} — got {flags:?}",
                    case.label
                );
            }
        }
    }

    #[test]
    fn large_anomaly_amount_floor_matrix() {
        // Baseline is $10 (2.5x = $25) — small enough that the $50 floor,
        // not the multiple, is the binding constraint being tested. The
        // floor check is a strict `>` (see anomaly_flags), so exactly
        // $50.00 must not flag either — only $49.99 and $50.01 were
        // originally covered here; $50.00 pins that the boundary itself
        // is excluded, not just "at or below."
        struct Case {
            label: &'static str,
            amount: &'static str,
            expect_large_flag: bool,
        }
        let cases = [
            Case {
                label: "$49.99 is over the 2.5x multiple but under the $50 floor, must not flag",
                amount: "-49.99",
                expect_large_flag: false,
            },
            Case {
                label: "$50.00 exactly is still not over the floor (strict greater-than)",
                amount: "-50.00",
                expect_large_flag: false,
            },
            Case {
                label: "$50.01 clears both the multiple and the floor",
                amount: "-50.01",
                expect_large_flag: true,
            },
        ];

        for case in cases {
            let store = Store::open_in_memory().unwrap();
            let account = test_account(&store);
            store
                .save_transactions(
                    account,
                    &[
                        tx("2026-07-01", "Cafe One", "-10.00"),
                        tx("2026-07-10", "Cafe Two", "-10.00"),
                        tx("2026-07-20", "Cafe Three", "-10.00"),
                        tx("2026-08-01", "Boundary Transaction", case.amount),
                    ],
                )
                .unwrap();
            let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
            for id in &ids {
                store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
            }

            let flags = store.anomaly_flags().unwrap();
            if case.expect_large_flag {
                assert!(
                    flags.iter().any(|f| f.kind == "large" && f.transaction_id == *ids.last().unwrap()),
                    "case: {} — got {flags:?}",
                    case.label
                );
            } else {
                assert!(
                    flags.iter().all(|f| f.transaction_id != *ids.last().unwrap()),
                    "case: {} — got {flags:?}",
                    case.label
                );
            }
        }
    }

    #[test]
    fn the_sliding_window_keeps_two_categories_independent_when_interleaved_out_of_date_order() {
        // Regression guard for the rewrite specifically: rows are grouped
        // by category and sorted by date *within* the rewrite, but stored
        // (and originally iterated) in insertion/id order — this
        // interleaves two categories' dates and inserts them out of
        // chronological order within each category, so a grouping or
        // sort bug would either cross-contaminate the two baselines or
        // miscompute a window.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-20", "Cafe Three", "-20.00"),          // Dining Out, out of date order
                    tx("2026-07-01", "Gas Station A", "-40.00"),       // Transportation
                    tx("2026-07-01", "Cafe One", "-20.00"),            // Dining Out
                    tx("2026-07-15", "Gas Station B", "-40.00"),       // Transportation
                    tx("2026-07-10", "Cafe Two", "-20.00"),            // Dining Out
                    tx("2026-07-25", "Gas Station C", "-40.00"),       // Transportation
                    tx("2026-08-01", "Fancy Steakhouse", "-200.00"),   // Dining Out anomaly
                    tx("2026-08-01", "Airport Car Rental", "-400.00"), // Transportation anomaly
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        let dining_ids = [ids[0], ids[2], ids[4], ids[6]];
        let transport_ids = [ids[1], ids[3], ids[5], ids[7]];
        for id in dining_ids {
            store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
        }
        for id in transport_ids {
            store.set_category(id, "Transportation", CategorySource::User, None).unwrap();
        }

        let flags = store.anomaly_flags().unwrap();
        let large_flags: std::collections::HashSet<i64> = flags.iter().filter(|f| f.kind == "large").map(|f| f.transaction_id).collect();

        assert_eq!(
            large_flags,
            std::collections::HashSet::from([ids[6], ids[7]]),
            "each category's own anomaly must be flagged, with no cross-contamination: {flags:?}"
        );
    }

    // Large expenses in range (cash-flow chart's per-month drill-down).

    #[test]
    fn large_expenses_in_range_includes_a_large_anomaly_dated_within_the_range() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-01", "Cafe One", "-15.00"),
                    tx("2026-07-10", "Cafe Two", "-20.00"),
                    tx("2026-07-20", "Cafe Three", "-25.00"),
                    tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let result = store
            .large_expenses_in_range("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
            .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].transaction_id, *ids.last().unwrap());
        assert_eq!(result[0].description, "Fancy Steakhouse");
        assert_eq!(result[0].amount, "-200.00".parse().unwrap());
        assert_eq!(result[0].category.as_deref(), Some("Dining Out"));
        assert!(result[0].detail.contains("Dining Out"), "detail should explain why: {}", result[0].detail);
    }

    #[test]
    fn large_expenses_in_range_excludes_a_large_anomaly_dated_outside_the_range() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-01", "Cafe One", "-15.00"),
                    tx("2026-07-10", "Cafe Two", "-20.00"),
                    tx("2026-07-20", "Cafe Three", "-25.00"),
                    tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let result = store
            .large_expenses_in_range("2026-07-01".parse().unwrap(), "2026-07-31".parse().unwrap())
            .unwrap();

        assert!(result.is_empty(), "the large expense is dated in August, not July: {result:?}");
    }

    #[test]
    fn large_expenses_in_range_excludes_duplicate_flags() {
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let savings = store.get_or_create_account("Savings", AccountType::Savings).unwrap();
        store.save_transactions(checking, &[tx("2026-08-05", "Netflix 4471", "-15.99")]).unwrap();
        store.save_transactions(savings, &[tx("2026-08-06", "Netflix 8823", "-15.99")]).unwrap();

        let result = store
            .large_expenses_in_range("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
            .unwrap();

        assert!(result.is_empty(), "duplicates aren't large expenses: {result:?}");
    }

    #[test]
    fn large_expenses_in_range_sorts_by_amount_descending() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-01", "Cafe One", "-15.00"),
                    tx("2026-07-10", "Cafe Two", "-20.00"),
                    tx("2026-07-20", "Cafe Three", "-25.00"),
                    tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
                    tx("2026-08-15", "Fanciest Steakhouse", "-500.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let result = store
            .large_expenses_in_range("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
            .unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].description, "Fanciest Steakhouse");
        assert_eq!(result[1].description, "Fancy Steakhouse");
    }

    // Dashboard insights.

    #[test]
    fn dashboard_insights_is_empty_for_a_quiet_month() {
        let store = Store::open_in_memory().unwrap();
        let insights = store.dashboard_insights("2026-08-20".parse().unwrap()).unwrap();
        assert!(insights.is_empty());
    }

    #[test]
    fn dashboard_insights_flags_a_category_on_pace_to_exceed_its_budget() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Dining Out", "2026-08", "200.00".parse().unwrap(), "flexible").unwrap();
        // $100 spent in the first 10 days of a 31-day August projects to
        // $310 — well past the $200 budget (>1.1x).
        store.save_transactions(account, &[tx("2026-08-05", "Cafe", "-100.00")]).unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-08-10".parse().unwrap()).unwrap();

        assert!(
            insights.iter().any(|i| i.kind == "pace" && i.message.contains("Dining Out")),
            "expected a pace insight for Dining Out: {insights:?}"
        );
    }

    #[test]
    fn dashboard_insights_skips_pace_projection_before_day_5_of_the_month() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Dining Out", "2026-08", "200.00".parse().unwrap(), "flexible").unwrap();
        store.save_transactions(account, &[tx("2026-08-02", "Cafe", "-100.00")]).unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
        }

        // Only 3 days into the month — too little signal to project from.
        let insights = store.dashboard_insights("2026-08-03".parse().unwrap()).unwrap();

        assert!(
            !insights.iter().any(|i| i.kind == "pace"),
            "expected no early-month pace insight: {insights:?}"
        );
    }

    #[test]
    fn dashboard_insights_does_not_pace_project_a_fixed_expense_paid_in_full_at_the_start_of_the_month() {
        // Reproduces a real report: a $2405.94 mortgage payment posted on
        // the 1st showed a Dashboard warning projecting $12,029.70 by
        // month end (naive `actual * days_in_month / days_elapsed` —
        // 2405.94 / 6 * 30 — applied to a bill that was already paid in
        // full for the month, not one that accrues day by day).
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Mortgage", "2026-09", "2405.94".parse().unwrap(), "fixed").unwrap();
        store
            .save_transactions(account, &[tx("2026-09-01", "LMCU Mortgage", "-2405.94")])
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Mortgage", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-09-06".parse().unwrap()).unwrap();

        assert!(
            !insights.iter().any(|i| i.kind == "pace" && i.message.contains("Mortgage")),
            "expected no pace insight for a fully-paid fixed expense: {insights:?}"
        );
    }

    #[test]
    fn dashboard_insights_still_pace_projects_a_flexible_category_that_front_loaded_its_spend() {
        // The fix must not become "skip pace for anything paid early" —
        // a flexible category that happens to spend a lot on day 1 (e.g.
        // a big grocery haul) is exactly the case pace projection exists
        // for, and should still fire.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "2026-09", "300.00".parse().unwrap(), "flexible").unwrap();
        store.save_transactions(account, &[tx("2026-09-01", "Costco", "-250.00")]).unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Groceries", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-09-06".parse().unwrap()).unwrap();

        assert!(
            insights.iter().any(|i| i.kind == "pace" && i.message.contains("Groceries")),
            "expected a pace insight for a front-loaded flexible category: {insights:?}"
        );
    }

    #[test]
    fn dashboard_insights_skips_pace_projection_for_a_flexible_category_whose_history_is_a_single_lump_sum_each_month() {
        // Reproduces a real report: "Pet Care" is budgeted flexible, but
        // in practice it's one irregular vet/grooming charge a month, not
        // many small ones — its own history says so. A single $298.60
        // charge on day 2 must not be extrapolated into a nonsensical
        // month-end projection.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Pet Care", "2026-09", "150.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(
                account,
                &[
                    tx("2026-06-03", "Vet Clinic", "-120.00"),
                    tx("2026-07-14", "Vet Clinic", "-140.00"),
                    tx("2026-08-02", "Vet Clinic", "-130.00"),
                    tx("2026-09-02", "Vet Clinic", "-298.60"),
                ],
            )
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Pet Care", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-09-06".parse().unwrap()).unwrap();

        assert!(
            !insights.iter().any(|i| i.kind == "pace" && i.message.contains("Pet Care")),
            "expected no pace insight for a category that's historically one lump sum a month: {insights:?}"
        );
    }

    #[test]
    fn dashboard_insights_still_pace_projects_a_flexible_category_whose_history_shows_spend_spread_across_many_days() {
        // Contrast case: a category that's historically many small
        // charges spread across the month (typical Dining Out) must keep
        // getting paced even when, this month, it happens to front-load
        // onto one big early charge — the history-based skip must not
        // become "skip pacing for anything paid early" either.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Dining Out", "2026-09", "200.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(
                account,
                &[
                    tx("2026-06-03", "Cafe", "-20.00"),
                    tx("2026-06-10", "Cafe", "-20.00"),
                    tx("2026-06-18", "Cafe", "-20.00"),
                    tx("2026-07-04", "Cafe", "-20.00"),
                    tx("2026-07-12", "Cafe", "-20.00"),
                    tx("2026-07-20", "Cafe", "-20.00"),
                    tx("2026-08-02", "Cafe", "-20.00"),
                    tx("2026-08-09", "Cafe", "-20.00"),
                    tx("2026-08-17", "Cafe", "-20.00"),
                    tx("2026-09-01", "Fancy Dinner", "-250.00"),
                ],
            )
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-09-06".parse().unwrap()).unwrap();

        assert!(
            insights.iter().any(|i| i.kind == "pace" && i.message.contains("Dining Out")),
            "expected a pace insight for a historically-recurring category even when front-loaded: {insights:?}"
        );
    }

    #[test]
    fn dashboard_insights_skips_pace_projection_for_a_brand_new_category_dominated_by_one_outsized_purchase() {
        // Reproduces a real report: "Household" (budgeted $100, flexible)
        // had never been used before, then got a single $1,500 flooring
        // charge on day 2. With zero trailing history,
        // `average_spend_days_per_active_month` returns `None` — but
        // unlike a modest first charge (see
        // `dashboard_insights_flags_a_category_on_pace_to_exceed_its_budget`,
        // which must still pace-project), a lone transaction that already
        // dwarfs the entire monthly budget reads as a one-off big-ticket
        // purchase even without prior months to confirm it.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Household", "2026-09", "100.00".parse().unwrap(), "flexible").unwrap();
        store.save_transactions(account, &[tx("2026-09-02", "Flooring Co", "-1500.00")]).unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Household", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-09-07".parse().unwrap()).unwrap();

        assert!(
            !insights.iter().any(|i| i.kind == "pace" && i.message.contains("Household")),
            "expected no pace insight for a brand-new category dominated by one outsized purchase: {insights:?}"
        );
    }

    #[test]
    fn dashboard_insights_still_pace_projects_a_brand_new_category_once_spend_spans_more_than_one_day() {
        // Contrast case: the brand-new-category dampener above must not
        // become "skip pacing for any big first month" — once a
        // history-less category has spend on 2+ distinct days this month,
        // it's no longer a single dominating purchase, so the existing
        // permissive default (still project) applies even though the
        // running total is well past the budget.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Household", "2026-09", "100.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(
                account,
                &[tx("2026-09-02", "Flooring Co", "-800.00"), tx("2026-09-05", "Hardware Store", "-800.00")],
            )
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Household", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-09-07".parse().unwrap()).unwrap();

        assert!(
            insights.iter().any(|i| i.kind == "pace" && i.message.contains("Household")),
            "expected a pace insight once a brand-new category's spend spans more than one day: {insights:?}"
        );
    }

    #[test]
    fn dashboard_insights_flags_a_month_over_month_category_jump() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-07-05", "Grocer", "-100.00"), tx("2026-08-05", "Grocer", "-200.00")])
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Groceries", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-08-05".parse().unwrap()).unwrap();

        assert!(
            insights.iter().any(|i| i.kind == "category_jump" && i.message.contains("Groceries")),
            "expected a category-jump insight for Groceries: {insights:?}"
        );
    }

    #[test]
    fn dashboard_insights_flags_a_month_over_month_category_drop_as_a_positive_insight() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[tx("2026-07-05", "Boutique", "-200.00"), tx("2026-08-05", "Boutique", "-50.00")],
            )
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Shopping", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-08-05".parse().unwrap()).unwrap();

        let drop = insights.iter().find(|i| i.kind == "category_drop");
        assert!(drop.is_some(), "expected a category-drop insight for Shopping: {insights:?}");
        let drop = drop.unwrap();
        assert_eq!(drop.severity, "positive");
        assert!(drop.message.contains("Shopping"), "expected the message to name the category: {drop:?}");
    }

    #[test]
    fn dashboard_insights_flags_a_category_dropping_to_zero_spend_as_a_positive_insight() {
        // The drop check walks *last* month's categories looking them up in
        // *this* month's map — a category entirely absent this month (not
        // just smaller) must default to $0 spent rather than being skipped,
        // since "stopped spending on it altogether" is the clearest case.
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-07-05", "Boutique", "-200.00")]).unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Shopping", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-08-05".parse().unwrap()).unwrap();

        assert!(
            insights.iter().any(|i| i.kind == "category_drop" && i.message.contains("Shopping")),
            "expected a category-drop insight when spend stopped entirely: {insights:?}"
        );
    }

    #[test]
    fn dashboard_insights_does_not_flag_a_modest_month_over_month_decrease() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-05", "Boutique", "-100.00"),
                    // A $15 (15%) drop clears neither the 30% nor the $50 floor.
                    tx("2026-08-05", "Boutique", "-85.00"),
                ],
            )
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Shopping", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-08-05".parse().unwrap()).unwrap();

        assert!(
            !insights.iter().any(|i| i.kind == "category_drop"),
            "expected no category-drop insight for a modest decrease: {insights:?}"
        );
    }

    #[test]
    fn dashboard_insights_sorts_warning_before_info_before_positive() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    // category_jump -> warning
                    tx("2026-07-05", "Grocer", "-100.00"),
                    tx("2026-08-05", "Grocer", "-200.00"),
                    // category_drop -> positive
                    tx("2026-07-05", "Boutique", "-200.00"),
                    tx("2026-08-05", "Boutique", "-50.00"),
                ],
            )
            .unwrap();
        for t in store.all_transactions().unwrap() {
            let category = if t.transaction.description == "Grocer" {
                "Groceries"
            } else {
                "Shopping"
            };
            store.set_category(t.id, category, CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-08-05".parse().unwrap()).unwrap();
        let severities: Vec<&str> = insights.iter().map(|i| i.severity.as_str()).collect();
        let warning_pos = severities.iter().position(|s| *s == "warning");
        let positive_pos = severities.iter().position(|s| *s == "positive");
        assert!(
            warning_pos.is_some() && positive_pos.is_some() && warning_pos < positive_pos,
            "expected warning to sort before positive: {severities:?}"
        );
    }

    #[test]
    fn dashboard_insights_surfaces_a_large_expense_in_the_current_month() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-05-01", "Cafe One", "-15.00"),
                    tx("2026-06-01", "Cafe Two", "-20.00"),
                    tx("2026-07-01", "Cafe Three", "-25.00"),
                    tx("2026-08-05", "Fancy Steakhouse", "-200.00"),
                ],
            )
            .unwrap();
        for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
            store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let insights = store.dashboard_insights("2026-08-20".parse().unwrap()).unwrap();

        assert!(
            insights
                .iter()
                .any(|i| i.kind == "large_expense" && i.message.contains("Fancy Steakhouse")),
            "expected a large-expense insight: {insights:?}"
        );
    }

    // Recurring.

    #[test]
    fn next_occurrence_matches_cadence_and_calendar_cases() {
        let cases = [
            ("future anchor", "monthly", "2026-09-01", "2026-08-20", "2026-09-01"),
            ("weekly", "weekly", "2026-08-01", "2026-08-20", "2026-08-22"),
            ("biweekly", "biweekly", "2026-08-01", "2026-08-20", "2026-08-29"),
            ("monthly rollover", "monthly", "2026-06-15", "2026-08-20", "2026-09-15"),
            // February has no 31st — must clamp, not panic or skip to March.
            ("short month clamp", "monthly", "2026-01-31", "2026-02-15", "2026-02-28"),
            ("annual rollover", "annual", "2024-03-01", "2026-08-20", "2027-03-01"),
        ];

        for (label, cadence, anchor, today, expected) in cases {
            assert_eq!(
                next_occurrence(anchor.parse().unwrap(), cadence, today.parse().unwrap()),
                expected.parse::<NaiveDate>().unwrap(),
                "case: {label}",
            );
        }
    }

    #[test]
    fn create_recurring_then_list_recurring_computes_next_date() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_recurring(
                "Netflix",
                Some("Subscriptions"),
                "-15.49".parse().unwrap(),
                "monthly",
                "2026-06-04".parse().unwrap(),
                None,
            )
            .unwrap();

        let today: NaiveDate = "2026-08-20".parse().unwrap();
        let items = store.list_recurring(today).unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, id);
        assert_eq!(items[0].merchant, "Netflix");
        assert_eq!(items[0].category, Some("Subscriptions".to_string()));
        assert_eq!(items[0].next_date, "2026-09-04".parse().unwrap());
    }

    #[test]
    fn list_recurring_includes_the_linked_accounts_name() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store
            .create_recurring(
                "Rocket Mortgage",
                None,
                "-1840.00".parse().unwrap(),
                "monthly",
                "2026-08-01".parse().unwrap(),
                Some(checking),
            )
            .unwrap();

        let items = store.list_recurring("2026-08-20".parse().unwrap()).unwrap();

        assert_eq!(items[0].account_name, Some("Everyday Checking".to_string()));
    }

    #[test]
    fn delete_recurring_removes_it() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_recurring("Netflix", None, "-15.49".parse().unwrap(), "monthly", "2026-06-04".parse().unwrap(), None)
            .unwrap();

        store.delete_recurring(id).unwrap();

        assert_eq!(store.list_recurring("2026-08-20".parse().unwrap()).unwrap().len(), 0);
    }

    #[test]
    fn delete_recurring_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_recurring(999).unwrap();
    }

    #[test]
    fn set_recurring_status_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.set_recurring_status(999, "canceled").unwrap();
    }

    #[test]
    fn recurring_totals_is_zero_with_no_recurring_items() {
        let store = Store::open_in_memory().unwrap();
        let totals = store.recurring_totals().unwrap();
        assert_eq!(totals, RecurringTotals::default());
    }

    #[test]
    fn recurring_totals_sums_every_cadence_onto_a_common_monthly_and_annual_footing() {
        let store = Store::open_in_memory().unwrap();
        // One expense on each cadence, $12 (weekly), $24 (biweekly), $100
        // (monthly), $1200 (annual) — chosen so each cadence's monthly and
        // annual figures are easy to hand-verify.
        store
            .create_recurring(
                "Weekly Thing",
                None,
                "-12.00".parse().unwrap(),
                "weekly",
                "2026-06-01".parse().unwrap(),
                None,
            )
            .unwrap();
        store
            .create_recurring(
                "Biweekly Thing",
                None,
                "-24.00".parse().unwrap(),
                "biweekly",
                "2026-06-01".parse().unwrap(),
                None,
            )
            .unwrap();
        store
            .create_recurring(
                "Monthly Thing",
                None,
                "-100.00".parse().unwrap(),
                "monthly",
                "2026-06-01".parse().unwrap(),
                None,
            )
            .unwrap();
        store
            .create_recurring(
                "Annual Thing",
                None,
                "-1200.00".parse().unwrap(),
                "annual",
                "2026-06-01".parse().unwrap(),
                None,
            )
            .unwrap();

        let totals = store.recurring_totals().unwrap();

        // Monthly: 12*(52/12) + 24*(26/12) + 100 + 1200*(1/12) = 52 + 52 + 100 + 100 = 304
        assert_eq!(totals.monthly_expense, "304.00".parse().unwrap());
        // Annual: 12*52 + 24*26 + 100*12 + 1200 = 624 + 624 + 1200 + 1200 = 3648
        assert_eq!(totals.annual_expense, "3648.00".parse().unwrap());
        assert_eq!(totals.monthly_income, Decimal::ZERO);
        assert_eq!(totals.annual_income, Decimal::ZERO);
    }

    #[test]
    fn recurring_totals_treats_income_and_expense_symmetrically_across_cadences() {
        // Regression test for a client-side bug found during review: an
        // earlier version only normalized non-monthly cadences for
        // *income*, silently dropping weekly/biweekly/annual *expenses*
        // from the displayed monthly total entirely. A weekly expense and
        // a weekly income of the same magnitude must normalize to the same
        // monthly figure (just opposite sign/bucket).
        let store = Store::open_in_memory().unwrap();
        store
            .create_recurring(
                "Weekly Expense",
                None,
                "-12.00".parse().unwrap(),
                "weekly",
                "2026-06-01".parse().unwrap(),
                None,
            )
            .unwrap();
        store
            .create_recurring(
                "Weekly Income",
                None,
                "12.00".parse().unwrap(),
                "weekly",
                "2026-06-08".parse().unwrap(),
                None,
            )
            .unwrap();

        let totals = store.recurring_totals().unwrap();

        assert_eq!(totals.monthly_expense, totals.monthly_income);
        assert_eq!(totals.annual_expense, totals.annual_income);
    }

    #[test]
    fn update_recurring_changes_every_field() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        let id = store
            .create_recurring("Netflix", None, "-15.49".parse().unwrap(), "monthly", "2026-06-04".parse().unwrap(), None)
            .unwrap();

        store
            .update_recurring(
                id,
                "Netflix (renamed)",
                Some("Subscriptions"),
                "-18.99".parse().unwrap(),
                "annual",
                "2026-07-01".parse().unwrap(),
                Some(checking),
            )
            .unwrap();

        let items = store.list_recurring("2026-08-20".parse().unwrap()).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].merchant, "Netflix (renamed)");
        assert_eq!(items[0].category, Some("Subscriptions".to_string()));
        assert_eq!(items[0].amount, "-18.99".parse().unwrap());
        assert_eq!(items[0].cadence, "annual");
        assert_eq!(items[0].anchor_date, "2026-07-01".parse().unwrap());
        assert_eq!(items[0].account_name, Some("Checking".to_string()));
    }

    #[test]
    fn update_recurring_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store
            .update_recurring(
                999,
                "Ghost",
                None,
                "-1.00".parse().unwrap(),
                "monthly",
                "2026-08-20".parse().unwrap(),
                None,
            )
            .unwrap();
    }

    fn seed_txns(store: &Store, account: i64, merchant: &str, amount: &str, dates: &[&str]) {
        for date in dates {
            store.save_transactions(account, &[tx(date, merchant, amount)]).unwrap();
        }
    }

    #[test]
    fn detect_recurring_candidates_finds_a_monthly_pattern() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(
            &store,
            account,
            "Netflix",
            "-15.49",
            &["2026-05-04", "2026-06-04", "2026-07-04", "2026-08-04"],
        );

        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].merchant, "Netflix");
        assert_eq!(candidates[0].amount, "-15.49".parse().unwrap());
        assert_eq!(candidates[0].cadence, "monthly");
        assert_eq!(candidates[0].occurrence_count, 4);
        assert_eq!(candidates[0].anchor_date, "2026-08-04".parse().unwrap());
    }

    #[test]
    fn detect_recurring_candidates_classifies_a_biweekly_pattern() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(&store, account, "Cleaning Service", "-60.00", &["2026-06-05", "2026-06-19", "2026-07-03"]);

        let candidates = store.detect_recurring_candidates("2026-07-10".parse().unwrap()).unwrap();

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].cadence, "biweekly");
    }

    #[test]
    fn detect_recurring_candidates_skips_a_pattern_that_looks_stopped() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(&store, account, "Old Gym", "-40.00", &["2026-01-04", "2026-02-04", "2026-03-04"]);

        // Monthly cadence, but the most recent charge was ~5.5 months before
        // "today" — well past 2x the ~30-day cadence, so this reads as a
        // cancelled subscription rather than an active one.
        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert!(candidates.is_empty());
    }

    #[test]
    fn detect_recurring_candidates_ignores_irregular_gaps() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(&store, account, "Random Store", "-20.00", &["2026-01-05", "2026-03-20", "2026-08-01"]);

        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert!(candidates.is_empty());
    }

    #[test]
    fn detect_recurring_candidates_requires_at_least_three_occurrences() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(&store, account, "Gym", "-40.00", &["2026-06-01", "2026-07-01"]);

        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert!(candidates.is_empty());
    }

    #[test]
    fn detect_recurring_candidates_excludes_a_merchant_already_tracked_as_recurring() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(&store, account, "Netflix", "-15.49", &["2026-05-04", "2026-06-04", "2026-07-04"]);
        store
            .create_recurring("Netflix", None, "-15.49".parse().unwrap(), "monthly", "2026-07-04".parse().unwrap(), None)
            .unwrap();

        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert!(candidates.is_empty());
    }

    #[test]
    fn detect_recurring_candidates_excludes_charges_a_tracked_merchant_already_covers() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        // Tracked as "Hulu"; the statement says "HULU 877-8244858" — the same bill
        // (recurring_matches pairs them), so it isn't offered a second time.
        seed_txns(&store, account, "HULU 877-8244858", "-14.99", &["2026-05-04", "2026-06-04", "2026-07-04"]);
        seed_txns(&store, account, "Spotify Premium", "-9.99", &["2026-05-06", "2026-06-06", "2026-07-06"]);
        store
            .create_recurring("Hulu", None, "-14.99".parse().unwrap(), "monthly", "2026-07-04".parse().unwrap(), None)
            .unwrap();

        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert_eq!(
            candidates.iter().map(|c| c.merchant.as_str()).collect::<Vec<_>>(),
            vec!["Spotify Premium"]
        );
    }

    #[test]
    fn detect_recurring_candidates_keeps_income_when_only_an_expense_merchant_is_tracked() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        // Same name, opposite direction: a refund pattern isn't the tracked bill.
        seed_txns(
            &store,
            account,
            "Hulu Refund Credit",
            "14.99",
            &["2026-05-04", "2026-06-04", "2026-07-04"],
        );
        store
            .create_recurring("Hulu", None, "-14.99".parse().unwrap(), "monthly", "2026-07-04".parse().unwrap(), None)
            .unwrap();

        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert_eq!(candidates.len(), 1);
    }

    #[test]
    fn dismiss_recurring_candidate_excludes_it_from_future_detection() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        seed_txns(&store, account, "Spotify", "-9.99", &["2026-05-04", "2026-06-04", "2026-07-04"]);
        assert_eq!(store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap().len(), 1);

        store.dismiss_recurring_candidate("Spotify", "-9.99".parse().unwrap(), "monthly").unwrap();

        assert!(store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap().is_empty());
    }

    #[test]
    fn detect_recurring_candidates_infers_the_majority_category() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        for (date, category) in [
            ("2026-05-04", "Subscriptions"),
            ("2026-06-04", "Subscriptions"),
            ("2026-07-04", "Entertainment"),
        ] {
            let mut t = tx(date, "Netflix", "-15.49");
            t.category = Some(category.to_string());
            store.save_transactions(account, &[t]).unwrap();
        }

        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert_eq!(candidates[0].category, Some("Subscriptions".to_string()));
    }

    // Investments.

    #[test]
    fn create_holding_then_list_holdings_computes_value_and_gain() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();

        let id = store
            .create_holding(
                brokerage,
                "AAPL",
                "Apple Inc.",
                "8".parse().unwrap(),
                "231.20".parse().unwrap(),
                "1450.00".parse().unwrap(),
                Some("US Stocks"),
            )
            .unwrap();

        let holdings = store.list_holdings(test_now().date()).unwrap();
        assert_eq!(holdings.len(), 1);
        assert_eq!(holdings[0].id, id);
        assert_eq!(holdings[0].account_name, "Individual Brokerage");
        assert_eq!(holdings[0].value, "1849.60".parse().unwrap());
        assert_eq!(holdings[0].gain_loss, "399.60".parse().unwrap());
    }

    #[test]
    fn a_holding_below_cost_basis_reports_a_loss() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
        store
            .create_holding(
                brokerage,
                "BTC",
                "Bitcoin",
                "0.012".parse().unwrap(),
                "40000".parse().unwrap(),
                "620.00".parse().unwrap(),
                Some("Crypto"),
            )
            .unwrap();

        let holdings = store.list_holdings(test_now().date()).unwrap();
        assert_eq!(holdings[0].value, "480.00".parse().unwrap());
        assert_eq!(holdings[0].gain_loss, "-140.00".parse().unwrap());
    }

    #[test]
    fn update_holding_price_recomputes_value_gain_prev_close_and_day_gain_loss() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
        let id = store
            .create_holding(
                brokerage,
                "VOO",
                "Vanguard S&P 500 ETF",
                "3.6".parse().unwrap(),
                "500.00".parse().unwrap(),
                "1780.00".parse().unwrap(),
                None,
            )
            .unwrap();

        store.update_holding_price(id, "552.10".parse().unwrap(), test_now().date()).unwrap();

        let holdings = store.list_holdings(test_now().date()).unwrap();
        assert_eq!(holdings[0].price, "552.10".parse().unwrap());
        assert_eq!(holdings[0].value, "1987.56".parse().unwrap());
        assert_eq!(holdings[0].prev_close, Some("500.00".parse().unwrap()));
        assert_eq!(holdings[0].day_gain_loss, Some("187.56".parse().unwrap())); // 3.6 * (552.10 - 500.00)
    }

    #[test]
    fn update_holding_price_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.update_holding_price(999, "100.00".parse().unwrap(), test_now().date()).unwrap();
    }

    #[test]
    fn update_holding_price_does_not_move_prev_close_on_a_second_update_the_same_day() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
        let id = store
            .create_holding(
                brokerage,
                "VOO",
                "Vanguard S&P 500 ETF",
                "1".parse().unwrap(),
                "500.00".parse().unwrap(),
                "500.00".parse().unwrap(),
                None,
            )
            .unwrap();

        store.update_holding_price(id, "510.00".parse().unwrap(), test_now().date()).unwrap();
        store.update_holding_price(id, "520.00".parse().unwrap(), test_now().date()).unwrap();

        let holdings = store.list_holdings(test_now().date()).unwrap();
        // prev_close stays pinned to the price from before the *first*
        // update of the day, so day_gain_loss reflects the whole day's
        // move (500 -> 520), not just the second update's delta (510 -> 520).
        assert_eq!(holdings[0].prev_close, Some("500.00".parse().unwrap()));
        assert_eq!(holdings[0].day_gain_loss, Some("20.00".parse().unwrap()));
    }

    #[test]
    fn update_holding_price_re_snapshots_prev_close_on_a_later_calendar_day() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
        let id = store
            .create_holding(
                brokerage,
                "VOO",
                "Vanguard S&P 500 ETF",
                "1".parse().unwrap(),
                "500.00".parse().unwrap(),
                "500.00".parse().unwrap(),
                None,
            )
            .unwrap();
        store.update_holding_price(id, "510.00".parse().unwrap(), test_now().date()).unwrap();

        let next_day = test_now().date() + chrono::Duration::days(1);
        store.update_holding_price(id, "515.00".parse().unwrap(), next_day).unwrap();

        let holdings = store.list_holdings(next_day).unwrap();
        assert_eq!(holdings[0].prev_close, Some("510.00".parse().unwrap()));
        assert_eq!(holdings[0].day_gain_loss, Some("5.00".parse().unwrap()));
    }

    #[test]
    fn list_holdings_day_gain_loss_goes_stale_once_today_moves_past_the_last_update() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
        let id = store
            .create_holding(
                brokerage,
                "VOO",
                "Vanguard S&P 500 ETF",
                "1".parse().unwrap(),
                "500.00".parse().unwrap(),
                "500.00".parse().unwrap(),
                None,
            )
            .unwrap();
        store.update_holding_price(id, "510.00".parse().unwrap(), test_now().date()).unwrap();

        // A day-gain figure computed as of the update's own day is real...
        let holdings = store.list_holdings(test_now().date()).unwrap();
        assert_eq!(holdings[0].day_gain_loss, Some("10.00".parse().unwrap()));

        // ...but asking as of a *later* day must not keep reporting that
        // same stale delta as if it were still "today's" move — the row's
        // price hasn't actually been touched since, so there's no real
        // day-change to report for the later day.
        let next_day = test_now().date() + chrono::Duration::days(1);
        let holdings = store.list_holdings(next_day).unwrap();
        assert_eq!(holdings[0].prev_close, None);
        assert_eq!(holdings[0].day_gain_loss, None);
    }

    #[test]
    fn list_holdings_day_gain_loss_is_none_until_a_price_update_happens() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
        store
            .create_holding(
                brokerage,
                "VOO",
                "Vanguard S&P 500 ETF",
                "1".parse().unwrap(),
                "500.00".parse().unwrap(),
                "500.00".parse().unwrap(),
                None,
            )
            .unwrap();

        let holdings = store.list_holdings(test_now().date()).unwrap();
        assert_eq!(holdings[0].prev_close, None);
        assert_eq!(holdings[0].day_gain_loss, None);
    }

    #[test]
    fn delete_holding_removes_it() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
        let id = store
            .create_holding(
                brokerage,
                "AAPL",
                "Apple Inc.",
                "8".parse().unwrap(),
                "231.20".parse().unwrap(),
                "1450.00".parse().unwrap(),
                None,
            )
            .unwrap();

        store.delete_holding(id).unwrap();

        assert_eq!(store.list_holdings(test_now().date()).unwrap().len(), 0);
    }

    #[test]
    fn delete_holding_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_holding(999).unwrap();
    }

    #[test]
    fn list_distinct_holding_symbols_dedupes_across_accounts() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
        let ira = store.get_or_create_account("IRA", AccountType::Investment).unwrap();
        store
            .create_holding(
                brokerage,
                "AAPL",
                "Apple Inc.",
                "1".parse().unwrap(),
                "200".parse().unwrap(),
                "200".parse().unwrap(),
                None,
            )
            .unwrap();
        store
            .create_holding(
                ira,
                "AAPL",
                "Apple Inc.",
                "2".parse().unwrap(),
                "200".parse().unwrap(),
                "400".parse().unwrap(),
                None,
            )
            .unwrap();
        store
            .create_holding(
                brokerage,
                "MSFT",
                "Microsoft Corp.",
                "1".parse().unwrap(),
                "300".parse().unwrap(),
                "300".parse().unwrap(),
                None,
            )
            .unwrap();

        let symbols = store.list_distinct_holding_symbols().unwrap();

        assert_eq!(symbols, vec!["AAPL".to_string(), "MSFT".to_string()]);
    }

    #[test]
    fn update_holding_prices_for_symbol_updates_all_matching_holdings() {
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
        let ira = store.get_or_create_account("IRA", AccountType::Investment).unwrap();
        store
            .create_holding(
                brokerage,
                "AAPL",
                "Apple Inc.",
                "1".parse().unwrap(),
                "200".parse().unwrap(),
                "200".parse().unwrap(),
                None,
            )
            .unwrap();
        store
            .create_holding(
                ira,
                "AAPL",
                "Apple Inc.",
                "2".parse().unwrap(),
                "200".parse().unwrap(),
                "400".parse().unwrap(),
                None,
            )
            .unwrap();
        store
            .create_holding(
                brokerage,
                "MSFT",
                "Microsoft Corp.",
                "1".parse().unwrap(),
                "300".parse().unwrap(),
                "300".parse().unwrap(),
                None,
            )
            .unwrap();

        let updated = store
            .update_holding_prices_for_symbol("AAPL", "250".parse().unwrap(), test_now().date())
            .unwrap();

        assert_eq!(updated, 2);
        let holdings = store.list_holdings(test_now().date()).unwrap();
        for h in &holdings {
            if h.symbol == "AAPL" {
                assert_eq!(h.price, "250".parse().unwrap());
                assert_eq!(h.prev_close, Some("200".parse().unwrap()));
            } else {
                assert_eq!(h.price, "300".parse().unwrap());
                assert_eq!(h.prev_close, None);
            }
        }
    }

    #[test]
    fn update_holding_prices_for_symbol_on_unknown_symbol_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        let updated = store
            .update_holding_prices_for_symbol("NOSUCH", "1".parse().unwrap(), test_now().date())
            .unwrap();
        assert_eq!(updated, 0);
    }

    #[test]
    fn live_price_settings_default_when_never_set() {
        let store = Store::open_in_memory().unwrap();

        let settings = store.get_live_price_settings().unwrap();

        assert_eq!(settings.api_key, None);
        assert_eq!(settings.provider, "alpha_vantage");
        assert_eq!(settings.last_refreshed_at, None);
    }

    #[test]
    fn set_live_price_settings_then_get_returns_provider_and_key_matrix() {
        let cases = [("alpha_vantage", "demo-key"), ("finnhub", "fh-key")];

        for (provider, api_key) in cases {
            let store = Store::open_in_memory().unwrap();

            store.set_live_price_settings(provider, Some(api_key)).unwrap();

            let settings = store.get_live_price_settings().unwrap();
            assert_eq!(settings.provider, provider, "case: {provider}");
            assert_eq!(settings.api_key, Some(api_key.to_string()), "case: {provider}");
        }
    }

    #[test]
    fn set_live_price_settings_none_key_clears_it_but_keeps_the_provider() {
        let store = Store::open_in_memory().unwrap();
        store.set_live_price_settings("finnhub", Some("fh-key")).unwrap();

        store.set_live_price_settings("finnhub", None).unwrap();

        let settings = store.get_live_price_settings().unwrap();
        assert_eq!(settings.api_key, None);
        assert_eq!(settings.provider, "finnhub", "disabling should still remember the last-used provider");
    }

    #[test]
    fn set_live_prices_last_refreshed_persists_timestamp() {
        let store = Store::open_in_memory().unwrap();
        let at = NaiveDateTime::parse_from_str("2026-08-30 14:05:00", "%Y-%m-%d %H:%M:%S").unwrap();

        store.set_live_prices_last_refreshed(at).unwrap();

        let settings = store.get_live_price_settings().unwrap();
        assert_eq!(settings.last_refreshed_at, Some(at));
    }

    #[test]
    fn app_settings_default_to_every_feature_enabled_before_anything_is_ever_set() {
        let store = Store::open_in_memory().unwrap();

        let settings = store.get_app_settings().unwrap();

        assert!(settings.apply_to_debt_enabled);
        assert!(settings.split_purchases_enabled);
        assert!(settings.envelope_caps_enabled);
    }

    #[test]
    fn setting_one_app_feature_flag_does_not_disturb_the_others() {
        let store = Store::open_in_memory().unwrap();

        store.set_split_purchases_enabled(false).unwrap();

        let settings = store.get_app_settings().unwrap();
        assert!(!settings.split_purchases_enabled);
        assert!(settings.apply_to_debt_enabled, "unrelated flags must keep their default");
        assert!(settings.envelope_caps_enabled, "unrelated flags must keep their default");
    }

    #[test]
    fn app_settings_flags_persist_across_repeated_toggles() {
        let store = Store::open_in_memory().unwrap();

        store.set_apply_to_debt_enabled(false).unwrap();
        store.set_envelope_caps_enabled(false).unwrap();
        store.set_apply_to_debt_enabled(true).unwrap();

        let settings = store.get_app_settings().unwrap();
        assert!(settings.apply_to_debt_enabled);
        assert!(!settings.envelope_caps_enabled);
    }

    #[test]
    fn live_price_requests_used_today_is_zero_when_never_recorded() {
        let store = Store::open_in_memory().unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();

        assert_eq!(store.live_price_requests_used_today(today).unwrap(), 0);
    }

    #[test]
    fn record_live_price_request_increments_and_returns_the_new_count() {
        let store = Store::open_in_memory().unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();

        assert_eq!(store.record_live_price_request(today).unwrap(), 1);
        assert_eq!(store.record_live_price_request(today).unwrap(), 2);
        assert_eq!(store.record_live_price_request(today).unwrap(), 3);
        assert_eq!(store.live_price_requests_used_today(today).unwrap(), 3);
    }

    #[test]
    fn record_live_price_request_resets_to_one_on_a_new_day() {
        let store = Store::open_in_memory().unwrap();
        let yesterday = NaiveDate::from_ymd_opt(2026, 8, 29).unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();
        store.record_live_price_request(yesterday).unwrap();
        store.record_live_price_request(yesterday).unwrap();

        let count = store.record_live_price_request(today).unwrap();

        assert_eq!(count, 1);
        assert_eq!(store.live_price_requests_used_today(today).unwrap(), 1);
        assert_eq!(store.live_price_requests_used_today(yesterday).unwrap(), 0);
    }

    #[test]
    fn opening_a_pre_request_tracking_database_migrates_it_without_losing_the_api_key() {
        // Simulates a database from before the daily request counter
        // existed: a `live_price_settings` table with just the original two
        // columns, already holding a saved API key.
        let dir = std::env::temp_dir().join(format!("vaultspend-live-price-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_request_tracking.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE live_price_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    api_key TEXT,
                    last_refreshed_at TEXT
                );",
            )
            .unwrap();
            conn.execute("INSERT INTO live_price_settings (id, api_key) VALUES (1, 'saved-key')", [])
                .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let settings = store.get_live_price_settings().unwrap();
        assert_eq!(
            settings.api_key,
            Some("saved-key".to_string()),
            "the saved API key must survive the migration"
        );

        let today = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();
        assert_eq!(store.live_price_requests_used_today(today).unwrap(), 0);
        assert_eq!(store.record_live_price_request(today).unwrap(), 1);

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    #[test]
    fn opening_a_pre_provider_column_database_migrates_it_to_alpha_vantage_without_losing_the_api_key() {
        // Simulates a database from before Finnhub existed: a
        // `live_price_settings` table with the request-tracking columns
        // but no `provider` column yet, already holding a saved API key —
        // necessarily an Alpha Vantage key, since Finnhub didn't exist.
        let dir = std::env::temp_dir().join(format!("vaultspend-live-price-provider-migration-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_provider_column.db");
        if db_path.exists() {
            std::fs::remove_file(&db_path).unwrap();
        }

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE live_price_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    api_key TEXT,
                    last_refreshed_at TEXT,
                    requests_used_today INTEGER NOT NULL DEFAULT 0,
                    requests_count_date TEXT
                );",
            )
            .unwrap();
            conn.execute("INSERT INTO live_price_settings (id, api_key) VALUES (1, 'saved-key')", [])
                .unwrap();
        } // old-style connection dropped here

        let store = Store::open(&db_path).unwrap();
        let settings = store.get_live_price_settings().unwrap();
        assert_eq!(
            settings.api_key,
            Some("saved-key".to_string()),
            "the saved API key must survive the migration"
        );
        assert_eq!(settings.provider, "alpha_vantage");

        drop(store);
        std::fs::remove_file(&db_path).unwrap();
    }

    // Manual assets ("Property & Valuables").

    #[test]
    fn create_asset_then_list_assets_reads_it_back() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_asset(
                "Home",
                "real_estate",
                "350000.00".parse().unwrap(),
                "2026-08-01".parse().unwrap(),
                Some("Zillow estimate"),
            )
            .unwrap();

        let assets = store.list_assets().unwrap();

        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].id, id);
        assert_eq!(assets[0].name, "Home");
        assert_eq!(assets[0].asset_type, "real_estate");
        assert_eq!(assets[0].value, "350000.00".parse().unwrap());
        assert_eq!(assets[0].valued_on, "2026-08-01".parse().unwrap());
        assert_eq!(assets[0].notes.as_deref(), Some("Zillow estimate"));
    }

    #[test]
    fn update_asset_value_changes_value_and_valued_on() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_asset("Car", "vehicle", "20000.00".parse().unwrap(), "2026-01-01".parse().unwrap(), None)
            .unwrap();

        store
            .update_asset_value(id, "17000.00".parse().unwrap(), "2026-08-01".parse().unwrap())
            .unwrap();

        let assets = store.list_assets().unwrap();
        assert_eq!(assets[0].value, "17000.00".parse().unwrap());
        assert_eq!(assets[0].valued_on, "2026-08-01".parse().unwrap());
    }

    #[test]
    fn delete_asset_removes_it() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_asset("Boat", "other", "5000.00".parse().unwrap(), "2026-01-01".parse().unwrap(), None)
            .unwrap();

        store.delete_asset(id).unwrap();

        assert_eq!(store.list_assets().unwrap().len(), 0);
    }

    #[test]
    fn delete_asset_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.delete_asset(999).unwrap();
    }

    #[test]
    fn total_assets_value_sums_every_asset() {
        let store = Store::open_in_memory().unwrap();
        store
            .create_asset("Home", "real_estate", "350000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
            .unwrap();
        store
            .create_asset("Car", "vehicle", "17000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
            .unwrap();

        assert_eq!(store.total_assets_value().unwrap(), "367000.00".parse().unwrap());
    }

    #[test]
    fn total_assets_value_is_zero_with_no_assets() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.total_assets_value().unwrap(), Decimal::ZERO);
    }

    #[test]
    fn adding_an_asset_does_not_change_historical_net_worth() {
        // Locks in the deliberate design decision: manual assets carry only
        // a current value, so retroactively applying it to every past point
        // on the net-worth trend would misrepresent history — they feed the
        // *current* net-worth figure only (computed client-side from
        // `total_assets_value`), never `net_worth_as_of`.
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        let before = store.net_worth_as_of("2026-08-20".parse().unwrap()).unwrap();

        store
            .create_asset("Home", "real_estate", "350000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
            .unwrap();

        let after = store.net_worth_as_of("2026-08-20".parse().unwrap()).unwrap();

        assert_eq!(before, after);
    }

    // Debt payoff planner.

    #[test]
    fn debt_payoff_projection_with_no_debt_resolves_immediately() {
        let store = Store::open_in_memory().unwrap();
        store.get_or_create_account("Checking", AccountType::Checking).unwrap();

        let plan = store
            .debt_payoff_projection("snowball", Decimal::ZERO, &[], "2026-08-20".parse().unwrap())
            .unwrap();

        assert!(plan.per_account.is_empty());
        assert_eq!(plan.total_months, Some(0));
        assert_eq!(plan.total_interest_paid, Decimal::ZERO);
    }

    #[test]
    fn debt_payoff_projection_excludes_an_account_marked_excluded_from_debt_payoff() {
        // A credit card the user pays off in full every month shouldn't be
        // dragged into a payoff plan just because it happens to carry a
        // balance at the moment they check.
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Paid Off Monthly Card", AccountType::Loan).unwrap();
        store.set_account_starting_balance(card, "500.00".parse().unwrap()).unwrap();
        store.set_account_excluded_from_debt_payoff(card, true).unwrap();

        let plan = store
            .debt_payoff_projection(
                "snowball",
                Decimal::ZERO,
                &[(card, "50.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap();

        assert!(plan.per_account.is_empty());
        assert_eq!(plan.total_months, Some(0));
    }

    #[test]
    fn set_account_excluded_from_debt_payoff_can_be_reversed() {
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Card", AccountType::Loan).unwrap();
        store.set_account_starting_balance(card, "500.00".parse().unwrap()).unwrap();
        store.set_account_excluded_from_debt_payoff(card, true).unwrap();
        store.set_account_excluded_from_debt_payoff(card, false).unwrap();

        let plan = store
            .debt_payoff_projection(
                "snowball",
                Decimal::ZERO,
                &[(card, "50.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap();

        assert_eq!(plan.per_account.len(), 1, "re-including the account should bring it back into the plan");
    }

    #[test]
    fn debt_payoff_projection_pays_off_a_zero_interest_loan_using_only_the_minimum() {
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "1200.00".parse().unwrap()).unwrap();

        let plan = store
            .debt_payoff_projection(
                "snowball",
                Decimal::ZERO,
                &[(loan, "100.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap();

        assert_eq!(plan.per_account.len(), 1);
        assert_eq!(plan.per_account[0].payoff_date, Some("2027-08-20".parse().unwrap()));
        assert_eq!(plan.per_account[0].total_interest_paid, Decimal::ZERO);
        assert_eq!(plan.total_months, Some(12));
    }

    #[test]
    fn debt_payoff_projection_snowball_pays_off_the_smaller_balance_first_and_rolls_its_minimum_forward() {
        let store = Store::open_in_memory().unwrap();
        let small = store.get_or_create_account("Small Debt", AccountType::Loan).unwrap();
        store.set_account_starting_balance(small, "100.00".parse().unwrap()).unwrap();
        let big = store.get_or_create_account("Big Debt", AccountType::Loan).unwrap();
        store.set_account_starting_balance(big, "1000.00".parse().unwrap()).unwrap();

        let plan = store
            .debt_payoff_projection(
                "snowball",
                Decimal::ZERO,
                &[(small, "100.00".parse().unwrap()), (big, "10.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap();

        let small_line = plan.per_account.iter().find(|l| l.account_id == small).unwrap();
        assert!(plan.per_account.iter().any(|l| l.account_id == big));

        // Small Debt clears in month 1 (its $100 minimum covers the whole
        // $100 balance in one shot).
        assert_eq!(small_line.payoff_date, Some("2026-09-20".parse().unwrap()));
        // Once freed, Small Debt's $100 minimum rolls into Big Debt on top
        // of its own $10 — $110/month clears $1000 in well under the ~100
        // months a flat $10/month alone would take.
        let big_months = plan.total_months.unwrap();
        assert!(
            big_months < 20,
            "expected the rolled-over minimum to accelerate payoff, got {big_months} months"
        );
    }

    #[test]
    fn debt_payoff_projection_avalanche_prioritizes_the_higher_rate_debt() {
        let store = Store::open_in_memory().unwrap();
        let high_rate = store.get_or_create_account("High Rate Card", AccountType::Loan).unwrap();
        store.set_account_starting_balance(high_rate, "1000.00".parse().unwrap()).unwrap();
        store.set_account_interest_rate(high_rate, Some("25.00".parse().unwrap())).unwrap();
        let low_rate = store.get_or_create_account("Low Rate Card", AccountType::Loan).unwrap();
        store.set_account_starting_balance(low_rate, "1000.00".parse().unwrap()).unwrap();
        store.set_account_interest_rate(low_rate, Some("5.00".parse().unwrap())).unwrap();

        let plan = store
            .debt_payoff_projection(
                "avalanche",
                "200.00".parse().unwrap(),
                &[(high_rate, "10.00".parse().unwrap()), (low_rate, "10.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap();

        let high_line = plan.per_account.iter().find(|l| l.account_id == high_rate).unwrap();
        let low_line = plan.per_account.iter().find(|l| l.account_id == low_rate).unwrap();
        assert!(
            high_line.payoff_date.unwrap() < low_line.payoff_date.unwrap(),
            "avalanche should clear the higher-rate card first: {high_line:?} vs {low_line:?}"
        );
    }

    #[test]
    fn debt_payoff_projection_extra_payment_shortens_the_timeline() {
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "5000.00".parse().unwrap()).unwrap();

        let without_extra = store
            .debt_payoff_projection(
                "snowball",
                Decimal::ZERO,
                &[(loan, "100.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap()
            .total_months
            .unwrap();
        let with_extra = store
            .debt_payoff_projection(
                "snowball",
                "200.00".parse().unwrap(),
                &[(loan, "100.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap()
            .total_months
            .unwrap();

        assert!(with_extra < without_extra);
    }

    #[test]
    fn debt_payoff_projection_accrues_interest_on_an_apr_bearing_debt() {
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Card", AccountType::Loan).unwrap();
        store.set_account_starting_balance(card, "1200.00".parse().unwrap()).unwrap();
        store.set_account_interest_rate(card, Some("24.00".parse().unwrap())).unwrap();

        let plan = store
            .debt_payoff_projection(
                "snowball",
                Decimal::ZERO,
                &[(card, "110.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap();

        assert!(plan.total_interest_paid > Decimal::ZERO);
        assert!(plan.per_account[0].payoff_date.is_some());
    }

    #[test]
    fn debt_payoff_projection_never_resolves_when_the_minimum_does_not_cover_interest() {
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Card", AccountType::Loan).unwrap();
        store.set_account_starting_balance(card, "1000.00".parse().unwrap()).unwrap();
        store.set_account_interest_rate(card, Some("36.00".parse().unwrap())).unwrap();

        // 36% APR = 3%/month = $30/month in interest on $1000 — a $5
        // minimum with no extra payment can never make a dent.
        let plan = store
            .debt_payoff_projection(
                "snowball",
                Decimal::ZERO,
                &[(card, "5.00".parse().unwrap())],
                "2026-08-20".parse().unwrap(),
            )
            .unwrap();

        assert_eq!(plan.total_months, None);
        assert_eq!(plan.per_account[0].payoff_date, None);
    }

    // Cash-flow forecast.

    #[test]
    fn cash_flow_forecast_stays_flat_with_no_transaction_history() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 30).unwrap();

        assert_eq!(points.len(), 31);
        assert!(points.iter().all(|p| p.balance == "1000.00".parse().unwrap()));
        assert_eq!(points[0].date, "2026-08-20".parse().unwrap());
        assert_eq!(points[30].date, "2026-09-19".parse().unwrap());
    }

    #[test]
    fn cash_flow_forecast_projects_the_trailing_average_daily_net_forward() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "0.00".parse().unwrap()).unwrap();
        // Earliest activity is 10 days before "today" (clamps the window to
        // 10 days, not the full 90) — balance there is $1000. Two more
        // transactions bring it to $1800 by today: a net gain of $800 over
        // 10 days = $80/day.
        store
            .save_transactions(
                checking,
                &[
                    tx("2026-08-10", "Opening balance", "1000.00"),
                    tx("2026-08-15", "Paycheck", "500.00"),
                    tx("2026-08-20", "Side income", "300.00"),
                ],
            )
            .unwrap();

        let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 10).unwrap();

        assert_eq!(points[0].balance, "1800.00".parse().unwrap());
        assert_eq!(points[1].balance, "1880.00".parse().unwrap());
        assert_eq!(points[10].balance, "2600.00".parse().unwrap());
    }

    #[test]
    fn cash_flow_forecast_clamps_the_window_to_available_history_not_a_blind_90_days() {
        // If the $80/day-net test above instead divided by a blind 90 days
        // (rather than the 10 days of history that actually exist), the
        // slope would come out roughly 9x too shallow — this pins the
        // clamping behavior specifically.
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "0.00".parse().unwrap()).unwrap();
        store
            .save_transactions(
                checking,
                &[tx("2026-08-19", "Opening balance", "100.00"), tx("2026-08-20", "Deposit", "50.00")],
            )
            .unwrap();

        let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 1).unwrap();

        // 1 day of history, $50 net over that day -> $50/day slope.
        assert_eq!(points[0].balance, "150.00".parse().unwrap());
        assert_eq!(points[1].balance, "200.00".parse().unwrap());
    }

    #[test]
    fn cash_flow_forecast_with_zero_days_returns_just_todays_balance() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 0).unwrap();

        assert_eq!(points.len(), 1);
        assert_eq!(points[0].balance, "1000.00".parse().unwrap());
    }

    #[test]
    fn cash_flow_forecast_only_starts_from_cash_group_accounts() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
        store.set_account_starting_balance(brokerage, "5000.00".parse().unwrap()).unwrap();

        let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 5).unwrap();

        assert_eq!(points[0].balance, "1000.00".parse().unwrap(), "investment balance must not count");
    }

    #[test]
    fn average_monthly_spend_is_zero_with_no_transaction_history() {
        let store = Store::open_in_memory().unwrap();

        let avg = store.average_monthly_spend("2026-08-20".parse().unwrap()).unwrap();

        assert_eq!(avg, Decimal::ZERO);
    }

    #[test]
    fn average_monthly_spend_divides_trailing_window_spend_by_months_in_that_window() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        // 30 days of history, $900 spent, $500 deposited — spend only,
        // income must not offset it.
        store
            .save_transactions(
                account,
                &[tx("2026-07-21", "Rent", "-900.00"), tx("2026-07-25", "Payroll Deposit", "500.00")],
            )
            .unwrap();

        let avg = store.average_monthly_spend("2026-08-20".parse().unwrap()).unwrap();

        // Window clamps to the 30 days of actual history (earliest tx to
        // today), not the full 90-day cap — 900 spent / (30/30) months.
        assert_eq!(avg, "900.00".parse().unwrap());
    }

    #[test]
    fn average_monthly_spend_clamps_the_window_to_available_history_not_a_blind_90_days() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        // Only 10 days of history — the window must clamp to that, not
        // divide by a full 90/30 = 3 months' worth.
        store.save_transactions(account, &[tx("2026-08-10", "Rent", "-300.00")]).unwrap();

        let avg = store.average_monthly_spend("2026-08-20".parse().unwrap()).unwrap();

        // 300 spent over a 10-day window == 1/3 month -> 900/month average.
        assert_eq!(avg, "900.00".parse().unwrap());
    }

    // Cash flow aggregates.

    #[test]
    fn monthly_totals_sums_income_and_expense_separately_for_one_month() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-01", "Payroll Deposit", "3000.00"),
                    tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                    tx("2026-08-10", "Fresh Market", "-40.00"),
                    tx("2026-07-25", "Old Month Payroll", "2000.00"), // different month, excluded
                ],
            )
            .unwrap();

        let (income, expense) = store.monthly_totals(2026, 8).unwrap();

        assert_eq!(income, "3000.00".parse().unwrap());
        assert_eq!(expense, "120.00".parse().unwrap());
    }

    #[test]
    fn monthly_totals_excludes_transactions_categorized_transfer_on_both_sides() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-01", "Payroll Deposit", "3000.00"),
                    tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                    Transaction {
                        category: Some("Transfer".to_string()),
                        ..tx("2026-08-10", "To Savings", "-6000.00")
                    },
                    Transaction {
                        category: Some("Transfer".to_string()),
                        ..tx("2026-08-10", "From Checking", "6000.00")
                    },
                ],
            )
            .unwrap();

        let (income, expense) = store.monthly_totals(2026, 8).unwrap();

        assert_eq!(income, "3000.00".parse().unwrap(), "the $6,000 transfer-in must not count as income");
        assert_eq!(expense, "80.00".parse().unwrap(), "the $6,000 transfer-out must not count as spending");
    }

    #[test]
    fn monthly_totals_for_range_matches_calling_monthly_totals_once_per_month() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-06-01", "Payroll Deposit", "3000.00"),
                    tx("2026-06-05", "Green Leaf Grocers", "-80.00"),
                    tx("2026-07-01", "Payroll Deposit", "3000.00"),
                    // August has zero transactions -- must still report as
                    // (0, 0) via the caller's default, not be a crash or a
                    // dropped month.
                    tx("2026-09-01", "Payroll Deposit", "3000.00"),
                    tx("2026-09-10", "Fresh Market", "-40.00"),
                ],
            )
            .unwrap();

        let batched = store.monthly_totals_for_range(2026, 6, 2026, 9).unwrap();

        for (year, month) in [(2026, 6), (2026, 7), (2026, 8), (2026, 9)] {
            let expected = store.monthly_totals(year, month).unwrap();
            let actual = batched.get(&(year, month)).copied().unwrap_or((Decimal::ZERO, Decimal::ZERO));
            assert_eq!(actual, expected, "mismatch for {year}-{month:02}");
        }
        assert!(
            !batched.contains_key(&(2026, 8)),
            "a zero-activity month should have no entry, not a (0,0) row"
        );
    }

    #[test]
    fn monthly_totals_for_range_also_excludes_transfer_categorized_transactions() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-06-01", "Payroll Deposit", "3000.00"),
                    Transaction {
                        category: Some("Transfer".to_string()),
                        ..tx("2026-06-15", "To Savings", "-500.00")
                    },
                    Transaction {
                        category: Some("Transfer".to_string()),
                        ..tx("2026-06-15", "From Checking", "500.00")
                    },
                ],
            )
            .unwrap();

        let batched = store.monthly_totals_for_range(2026, 6, 2026, 6).unwrap();

        assert_eq!(batched.get(&(2026, 6)).copied().unwrap(), ("3000.00".parse().unwrap(), Decimal::ZERO));
    }

    #[test]
    fn monthly_totals_never_counts_a_positive_credit_card_transaction_as_income() {
        // A credit card payment recorded as an ordinary deposit (not
        // linked via apply_debt_payment) — the real production shape that
        // inflated a family member's reported income by over 50x. The
        // charge on checking (an expense) still counts normally.
        let store = Store::open_in_memory().unwrap();
        let checking = test_account(&store);
        let credit_card = store.get_or_create_account("Visa", AccountType::Credit).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-20", "WITHDRAWAL VISA", "-200.00")])
            .unwrap();
        store
            .save_transactions(credit_card, &[tx("2026-08-21", "VISA ONLINE PYMT", "200.00")])
            .unwrap();

        let (income, expense) = store.monthly_totals(2026, 8).unwrap();

        assert_eq!(income, Decimal::ZERO, "the credit card deposit must not count as income");
        assert_eq!(expense, "200.00".parse().unwrap(), "the checking withdrawal still counts as spending");
    }

    #[test]
    fn monthly_totals_still_counts_a_credit_card_charge_as_spending() {
        let store = Store::open_in_memory().unwrap();
        let credit_card = store.get_or_create_account("Visa", AccountType::Credit).unwrap();
        store.save_transactions(credit_card, &[tx("2026-08-20", "Groceries", "-80.00")]).unwrap();

        let (income, expense) = store.monthly_totals(2026, 8).unwrap();

        assert_eq!(income, Decimal::ZERO);
        assert_eq!(
            expense,
            "80.00".parse().unwrap(),
            "a charge is still real spending, only positive amounts are excluded"
        );
    }

    #[test]
    fn monthly_totals_never_counts_a_positive_loan_transaction_as_income() {
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.save_transactions(loan, &[tx("2026-08-20", "Escrow Refund", "75.00")]).unwrap();

        let (income, _) = store.monthly_totals(2026, 8).unwrap();

        assert_eq!(income, Decimal::ZERO);
    }

    #[test]
    fn monthly_totals_for_range_also_never_counts_a_credit_card_payment_as_income() {
        let store = Store::open_in_memory().unwrap();
        let credit_card = store.get_or_create_account("Visa", AccountType::Credit).unwrap();
        store
            .save_transactions(credit_card, &[tx("2026-06-10", "VISA ONLINE PYMT", "200.00")])
            .unwrap();

        let batched = store.monthly_totals_for_range(2026, 6, 2026, 6).unwrap();

        assert_eq!(batched.get(&(2026, 6)).copied().unwrap(), (Decimal::ZERO, Decimal::ZERO));
    }

    #[test]
    fn spending_by_category_sums_expenses_within_a_date_range_sorted_descending() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                    tx("2026-08-10", "Fresh Market", "-40.00"),
                    tx("2026-08-12", "Ferrywood Coffee", "-200.00"),
                    tx("2026-08-15", "Payroll Deposit", "3000.00"), // income, excluded
                    tx("2026-07-01", "Old Grocers", "-999.00"),     // outside range, excluded
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Groceries", CategorySource::User, None).unwrap();
        store.set_category(ids[1], "Groceries", CategorySource::User, None).unwrap();
        store.set_category(ids[2], "Dining Out", CategorySource::User, None).unwrap();

        let spend = store
            .spending_by_category("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
            .unwrap();

        assert_eq!(
            spend,
            vec![
                ("Dining Out".to_string(), "200.00".parse().unwrap()),
                ("Groceries".to_string(), "120.00".parse().unwrap()),
            ]
        );
    }

    #[test]
    fn top_merchants_ranks_by_total_spend_and_respects_the_limit() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                    tx("2026-08-10", "Green Leaf Grocers", "-40.00"),
                    tx("2026-08-12", "Ferrywood Coffee", "-200.00"),
                    tx("2026-08-14", "Corner Store", "-10.00"),
                    tx("2026-08-15", "Payroll Deposit", "3000.00"), // income, excluded
                ],
            )
            .unwrap();

        let top = store
            .top_merchants("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap(), 2)
            .unwrap();

        assert_eq!(
            top,
            vec![
                ("Ferrywood Coffee".to_string(), "200.00".parse().unwrap()),
                ("Green Leaf Grocers".to_string(), "120.00".parse().unwrap()),
            ]
        );
    }

    // Transfers between the user's own accounts are neither spending nor
    // income -- `monthly_totals` already excluded them, but every other
    // spend-shaped query below (category breakdown, top merchants,
    // recurring suggestions, runway's average spend, "unusually large"
    // flags) counted them as ordinary spending, so a monthly savings
    // transfer showed up as a $500 "Transfer" slice of the spending donut,
    // ranked as a "merchant", and got suggested as a recurring bill.

    #[test]
    fn spending_by_category_excludes_the_transfer_category() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                    Transaction {
                        category: Some("Transfer".to_string()),
                        ..tx("2026-08-10", "To Savings", "-500.00")
                    },
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[0], "Groceries", CategorySource::User, None).unwrap();

        let spend = store
            .spending_by_category("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
            .unwrap();

        assert_eq!(spend, vec![("Groceries".to_string(), "80.00".parse().unwrap())]);
    }

    #[test]
    fn spending_by_category_excludes_a_transfer_split_line_but_keeps_the_rest_of_the_split() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-05", "Warehouse Club", "-100.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store
            .set_transaction_splits(
                id,
                &[
                    ("Transfer".to_string(), "-60.00".parse().unwrap(), None),
                    ("Groceries".to_string(), "-40.00".parse().unwrap(), None),
                ],
            )
            .unwrap();

        let spend = store
            .spending_by_category("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
            .unwrap();

        assert_eq!(spend, vec![("Groceries".to_string(), "40.00".parse().unwrap())]);
    }

    #[test]
    fn top_merchants_excludes_transactions_categorized_transfer() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                    Transaction {
                        category: Some("Transfer".to_string()),
                        ..tx("2026-08-10", "Transfer to Savings", "-500.00")
                    },
                ],
            )
            .unwrap();

        let top = store
            .top_merchants("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap(), 5)
            .unwrap();

        assert_eq!(top, vec![("Green Leaf Grocers".to_string(), "80.00".parse().unwrap())]);
    }

    #[test]
    fn detect_recurring_candidates_skips_a_transfer_pattern() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        for date in ["2026-05-02", "2026-06-02", "2026-07-02", "2026-08-02"] {
            store
                .save_transactions(
                    account,
                    &[Transaction {
                        category: Some("Transfer".to_string()),
                        ..tx(date, "Transfer to Savings", "-500.00")
                    }],
                )
                .unwrap();
        }
        seed_txns(
            &store,
            account,
            "Netflix",
            "-15.49",
            &["2026-05-04", "2026-06-04", "2026-07-04", "2026-08-04"],
        );

        let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

        assert_eq!(candidates.len(), 1, "only Netflix -- moving money between your own accounts isn't a bill");
        assert_eq!(candidates[0].merchant, "Netflix");
    }

    #[test]
    fn average_monthly_spend_excludes_transfers() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-21", "Rent", "-900.00"),
                    Transaction {
                        category: Some("Transfer".to_string()),
                        ..tx("2026-07-25", "To Savings", "-2000.00")
                    },
                ],
            )
            .unwrap();

        let avg = store.average_monthly_spend("2026-08-20".parse().unwrap()).unwrap();

        assert_eq!(avg, "900.00".parse().unwrap(), "a $2,000 move to savings is not $2,000 of spending");
    }

    #[test]
    fn anomaly_flags_do_not_flag_an_unusually_large_transfer() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let mut rows: Vec<Transaction> = ["2026-06-02", "2026-07-02", "2026-08-02"]
            .iter()
            .map(|d| Transaction {
                category: Some("Transfer".to_string()),
                ..tx(d, "Transfer to Savings", "-100.00")
            })
            .collect();
        rows.push(Transaction {
            category: Some("Transfer".to_string()),
            ..tx("2026-08-20", "Transfer to Savings", "-5000.00")
        });
        store.save_transactions(account, &rows).unwrap();

        let flags = store.anomaly_flags().unwrap();

        assert!(
            flags.iter().all(|f| f.kind != "large"),
            "moving a big sum between your own accounts isn't an unusually large expense: {flags:?}"
        );
    }

    // Categorization rules manager.

    fn rule_patterns(store: &Store) -> Vec<String> {
        store.list_rules().unwrap().into_iter().map(|r| r.pattern).collect()
    }

    #[test]
    fn seed_default_rules_once_seeds_a_fresh_store_exactly_once() {
        let store = Store::open_in_memory().unwrap();
        assert!(store.list_rules().unwrap().is_empty(), "a brand-new store starts with no rules");

        assert!(store.seed_default_rules_once().unwrap(), "first call seeds");
        let seeded = store.list_rules().unwrap().len();
        assert_eq!(seeded, RuleSet::seeded().len());

        assert!(!store.seed_default_rules_once().unwrap(), "second call is a no-op");
        assert_eq!(store.list_rules().unwrap().len(), seeded);
    }

    #[test]
    fn seed_default_rules_once_does_not_bring_defaults_back_after_the_user_deletes_them_all() {
        let store = Store::open_in_memory().unwrap();
        store.seed_default_rules_once().unwrap();
        for pattern in rule_patterns(&store) {
            store.delete_rule(&pattern).unwrap();
        }

        assert!(!store.seed_default_rules_once().unwrap());

        assert!(store.list_rules().unwrap().is_empty(), "deleting every rule must stick");
    }

    #[test]
    fn seed_default_rules_once_leaves_a_store_that_already_has_rules_alone() {
        // An existing database from before this flag existed: it already has
        // learned rules (and lost the in-memory starter set the moment its
        // first rule was saved). Seeding defaults now would surprise it.
        let store = Store::open_in_memory().unwrap();
        store.upsert_rule("Ferrywood Coffee", "Dining Out").unwrap();

        assert!(!store.seed_default_rules_once().unwrap());

        assert_eq!(rule_patterns(&store), vec!["Ferrywood Coffee".to_string()]);
    }

    #[test]
    fn list_rules_reports_how_many_transactions_each_pattern_matches() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-01", "Ferrywood Coffee #12", "-4.00"),
                    tx("2026-08-02", "FERRYWOOD COFFEE #40", "-5.00"),
                    tx("2026-08-03", "Green Leaf Grocers", "-30.00"),
                ],
            )
            .unwrap();
        store.upsert_rule("ferrywood coffee", "Dining Out").unwrap();
        store.upsert_rule("payroll", "Income").unwrap();

        let rules = store.list_rules().unwrap();

        let coffee = rules.iter().find(|r| r.pattern == "ferrywood coffee").unwrap();
        assert_eq!(coffee.match_count, 2, "matching is case-insensitive substring, like RuleSet::categorize");
        assert_eq!(rules.iter().find(|r| r.pattern == "payroll").unwrap().match_count, 0);
    }

    #[test]
    fn delete_rule_removes_it_case_insensitively_and_leaves_the_others() {
        let store = Store::open_in_memory().unwrap();
        store.upsert_rule("Ferrywood Coffee", "Dining Out").unwrap();
        store.upsert_rule("payroll", "Income").unwrap();

        store.delete_rule("ferrywood COFFEE").unwrap();

        assert_eq!(rule_patterns(&store), vec!["payroll".to_string()]);
        store.delete_rule("never existed").unwrap(); // harmless no-op
    }

    #[test]
    fn rename_rule_can_change_both_the_pattern_and_the_category_in_one_step() {
        let store = Store::open_in_memory().unwrap();
        store.upsert_rule("ferrywood", "Dining Out").unwrap();

        store.rename_rule("ferrywood", "ferrywood coffee", "Coffee").unwrap();

        let rules = store.list_rules().unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].pattern, "ferrywood coffee");
        assert_eq!(rules[0].category, "Coffee");
    }

    #[test]
    fn preview_rule_counts_only_transactions_the_rule_would_actually_change() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-01", "Ferrywood Coffee #1", "-4.00"), // uncategorized -> would change
                    tx("2026-08-02", "Ferrywood Coffee #2", "-4.00"), // guessed by the classifier -> would change
                    tx("2026-08-03", "Ferrywood Coffee #3", "-4.00"), // you set it yourself -> never touched
                    tx("2026-08-04", "Ferrywood Coffee #4", "-4.00"), // already Dining Out -> nothing to change
                    tx("2026-08-05", "Green Leaf Grocers", "-30.00"), // doesn't match
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[1], "Groceries", CategorySource::Classifier, Some(0.6)).unwrap();
        store.set_category(ids[2], "Groceries", CategorySource::User, None).unwrap();
        store.set_category(ids[3], "Dining Out", CategorySource::Rule, None).unwrap();

        let preview = store.preview_rule("ferrywood coffee", "Dining Out", None).unwrap();

        assert_eq!(preview.matching, 4);
        assert_eq!(preview.would_change, 2);
    }

    #[test]
    fn preview_rule_leaves_transactions_a_more_specific_rule_already_owns() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-01", "Ferrywood Coffee", "-4.00"),
                    tx("2026-08-02", "Corner Coffee Cart", "-3.00"),
                ],
            )
            .unwrap();
        store.upsert_rule("ferrywood coffee", "Groceries").unwrap(); // longer = wins for the first row

        let preview = store.preview_rule("coffee", "Dining Out", None).unwrap();

        assert_eq!(preview.matching, 2);
        assert_eq!(preview.would_change, 1, "the Ferrywood row belongs to its own, more specific rule");
    }

    #[test]
    fn preview_rule_ignores_deleted_transactions_and_an_empty_pattern() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-01", "Ferrywood Coffee", "-4.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.delete_transaction(id, "2026-08-02T00:00:00".parse().unwrap()).unwrap();

        assert_eq!(store.preview_rule("ferrywood", "Dining Out", None).unwrap().would_change, 0);
        let empty = store.preview_rule("   ", "Dining Out", None).unwrap();
        assert_eq!(
            (empty.matching, empty.would_change),
            (0, 0),
            "a blank pattern would match everything -- treat it as nothing"
        );
    }

    #[test]
    fn preview_rule_when_editing_ignores_the_rule_being_replaced() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-01", "Ferrywood Coffee", "-4.00")])
            .unwrap();
        // The old rule is *longer*, so left in place it would shadow the edited one.
        store.upsert_rule("ferrywood coffee", "Groceries").unwrap();

        let preview = store.preview_rule("ferrywood", "Dining Out", Some("ferrywood coffee")).unwrap();

        assert_eq!(preview.would_change, 1);
    }

    #[test]
    fn apply_rule_to_existing_recategorizes_the_previewed_transactions_as_rule_sourced() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-01", "Ferrywood Coffee #1", "-4.00"),
                    tx("2026-08-02", "Ferrywood Coffee #2", "-4.00"),
                    tx("2026-08-03", "Ferrywood Coffee #3", "-4.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.set_category(ids[2], "Groceries", CategorySource::User, None).unwrap();
        store.upsert_rule("ferrywood coffee", "Dining Out").unwrap();

        let changed = store.apply_rule_to_existing("ferrywood coffee", "Dining Out").unwrap();

        assert_eq!(changed, 2);
        let all = store.all_transactions().unwrap();
        let by_id = |id: i64| all.iter().find(|t| t.id == id).unwrap();
        assert_eq!(by_id(ids[0]).transaction.category.as_deref(), Some("Dining Out"));
        assert_eq!(by_id(ids[0]).category_source, Some(CategorySource::Rule));
        assert_eq!(
            by_id(ids[2]).transaction.category.as_deref(),
            Some("Groceries"),
            "your own choice is never overwritten"
        );
    }

    #[test]
    fn apply_rule_to_existing_skips_a_split_transaction() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2026-08-01", "Warehouse Club", "-100.00")])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store
            .set_transaction_splits(
                id,
                &[
                    ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                    ("Household".to_string(), "-40.00".parse().unwrap(), None),
                ],
            )
            .unwrap();

        let changed = store.apply_rule_to_existing("warehouse", "Shopping").unwrap();

        assert_eq!(changed, 0, "a split purchase is categorized line by line, not as one lump");
    }

    // Linked transfers: two transactions in different accounts that are the
    // two legs of one move of money between the user's own accounts.

    fn checking_and_savings(store: &Store) -> (i64, i64) {
        (
            store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap(),
            store.get_or_create_account("High-Yield Savings", AccountType::Savings).unwrap(),
        )
    }

    /// The id of the live transaction with this description on this date.
    /// (Not `last_insert_rowid()`: saving a transaction also registers its
    /// category, and that insert is the *last* one.)
    fn id_of(store: &Store, description: &str, date: &str) -> i64 {
        store
            .all_transactions()
            .unwrap()
            .into_iter()
            .find(|t| t.transaction.description == description && t.transaction.date.to_string() == date)
            .unwrap_or_else(|| panic!("no transaction {description:?} on {date}"))
            .id
    }

    /// Checking -500 on `out_date`, Savings +500 on `in_date`, both under an
    /// ordinary (non-"Transfer") category so only the *link* can exclude them.
    fn seed_transfer_pair(store: &Store, out_date: &str, in_date: &str) -> (i64, i64) {
        let (checking, savings) = checking_and_savings(store);
        store
            .save_transactions(
                checking,
                &[Transaction {
                    category: Some("Savings Goal".to_string()),
                    ..tx(out_date, "Move to savings", "-500.00")
                }],
            )
            .unwrap();
        store
            .save_transactions(
                savings,
                &[Transaction {
                    category: Some("Savings Goal".to_string()),
                    ..tx(in_date, "Deposit from checking", "500.00")
                }],
            )
            .unwrap();
        (id_of(store, "Move to savings", out_date), id_of(store, "Deposit from checking", in_date))
    }

    fn counterpart_of(store: &Store, id: i64) -> Option<i64> {
        store
            .all_transactions()
            .unwrap()
            .into_iter()
            .find(|t| t.id == id)
            .and_then(|t| t.transfer_counterpart_id)
    }

    #[test]
    fn link_transfer_records_each_leg_as_the_others_counterpart() {
        let store = Store::open_in_memory().unwrap();
        let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-11");
        assert_eq!(counterpart_of(&store, out_id), None);

        assert!(store.link_transfer(out_id, in_id).unwrap());

        assert_eq!(counterpart_of(&store, out_id), Some(in_id));
        assert_eq!(counterpart_of(&store, in_id), Some(out_id));
    }

    #[test]
    fn link_transfer_accepts_the_ids_in_either_order() {
        let store = Store::open_in_memory().unwrap();
        let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");

        assert!(store.link_transfer(in_id, out_id).unwrap());

        assert_eq!(counterpart_of(&store, out_id), Some(in_id));
    }

    #[test]
    fn link_transfer_refuses_two_legs_in_the_same_account() {
        let store = Store::open_in_memory().unwrap();
        let (checking, _) = checking_and_savings(&store);
        store
            .save_transactions(checking, &[tx("2026-08-10", "Out", "-500.00"), tx("2026-08-10", "In", "500.00")])
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();

        assert!(
            !store.link_transfer(ids[0], ids[1]).unwrap(),
            "moving money to the same account isn't a transfer"
        );
    }

    #[test]
    fn link_transfer_refuses_two_legs_that_both_go_the_same_direction() {
        let store = Store::open_in_memory().unwrap();
        let (checking, savings) = checking_and_savings(&store);
        store.save_transactions(checking, &[tx("2026-08-10", "One", "-500.00")]).unwrap();
        store.save_transactions(savings, &[tx("2026-08-10", "Two", "-500.00")]).unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();

        assert!(!store.link_transfer(ids[0], ids[1]).unwrap());
    }

    #[test]
    fn link_transfer_refuses_a_leg_that_is_already_linked_or_gone() {
        let store = Store::open_in_memory().unwrap();
        let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
        assert!(store.link_transfer(out_id, in_id).unwrap());

        assert!(!store.link_transfer(out_id, in_id).unwrap(), "already linked");
        assert!(!store.link_transfer(out_id, 9999).unwrap(), "no such transaction");
    }

    #[test]
    fn unlink_transfer_works_from_either_leg_and_is_a_no_op_when_not_linked() {
        let store = Store::open_in_memory().unwrap();
        let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
        store.link_transfer(out_id, in_id).unwrap();

        store.unlink_transfer(in_id).unwrap();

        assert_eq!(counterpart_of(&store, out_id), None);
        assert_eq!(counterpart_of(&store, in_id), None);
        store.unlink_transfer(in_id).unwrap(); // harmless
    }

    #[test]
    fn a_linked_pair_is_neither_income_nor_spending_whatever_its_category() {
        let store = Store::open_in_memory().unwrap();
        let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
        let (checking, _) = checking_and_savings(&store);
        store
            .save_transactions(checking, &[tx("2026-08-01", "Payroll Deposit", "3000.00")])
            .unwrap();

        // Before linking, the pair counts as $500 of spending and $500 of income.
        let (income, expense) = store.monthly_totals(2026, 8).unwrap();
        assert_eq!((income, expense), ("3500.00".parse().unwrap(), "500.00".parse().unwrap()));

        store.link_transfer(out_id, in_id).unwrap();

        let (income, expense) = store.monthly_totals(2026, 8).unwrap();
        assert_eq!(income, "3000.00".parse().unwrap());
        assert_eq!(expense, Decimal::ZERO);
        let ranged = store.monthly_totals_for_range(2026, 8, 2026, 8).unwrap();
        assert_eq!(ranged[&(2026, 8)], ("3000.00".parse().unwrap(), Decimal::ZERO));
        assert_eq!(store.income_total().unwrap(), "3000.00".parse().unwrap());
        let (first, last) = ("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap());
        assert!(store.spending_by_category(first, last).unwrap().is_empty());
        assert!(store.top_merchants(first, last, 5).unwrap().is_empty());
        assert_eq!(store.average_monthly_spend("2026-08-31".parse().unwrap()).unwrap(), Decimal::ZERO);
    }

    #[test]
    fn a_link_only_excludes_while_both_legs_are_still_live() {
        let store = Store::open_in_memory().unwrap();
        let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
        store.link_transfer(out_id, in_id).unwrap();

        // Delete just the outgoing leg: the surviving deposit is real money in again.
        store.delete_transaction(out_id, "2026-08-12T00:00:00".parse().unwrap()).unwrap();
        let (income, _) = store.monthly_totals(2026, 8).unwrap();
        assert_eq!(income, "500.00".parse().unwrap());
        assert_eq!(counterpart_of(&store, in_id), None, "a deleted leg isn't a counterpart");

        // Undo restores the link's effect.
        store.restore_transactions(&[out_id]).unwrap();
        let (income, expense) = store.monthly_totals(2026, 8).unwrap();
        assert_eq!((income, expense), (Decimal::ZERO, Decimal::ZERO));
        assert_eq!(counterpart_of(&store, in_id), Some(out_id));
    }

    #[test]
    fn a_linked_pair_is_not_suggested_as_a_recurring_bill_or_flagged_as_unusually_large() {
        let store = Store::open_in_memory().unwrap();
        let (checking, savings) = checking_and_savings(&store);
        let mut ids = Vec::new();
        for date in ["2026-05-02", "2026-06-02", "2026-07-02", "2026-08-02"] {
            store.save_transactions(checking, &[tx(date, "Auto Savings Move", "-250.00")]).unwrap();
            store.save_transactions(savings, &[tx(date, "Incoming Move", "250.00")]).unwrap();
            ids.push((id_of(&store, "Auto Savings Move", date), id_of(&store, "Incoming Move", date)));
        }
        assert!(
            !store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap().is_empty(),
            "unlinked, the repeating move looks like a bill"
        );

        for (out_id, in_id) in ids {
            store.link_transfer(out_id, in_id).unwrap();
        }

        assert!(store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap().is_empty());
    }

    #[test]
    fn transfer_candidates_pairs_opposite_equal_amounts_in_different_accounts_within_three_days() {
        let store = Store::open_in_memory().unwrap();
        let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-13"); // 3 days apart: ok

        let candidates = store.transfer_candidates().unwrap();

        assert_eq!(candidates, vec![TransferCandidate { out_id, in_id }]);
    }

    #[test]
    fn transfer_candidates_ignores_far_apart_already_linked_and_unequal_pairs() {
        let store = Store::open_in_memory().unwrap();
        let (checking, savings) = checking_and_savings(&store);
        store
            .save_transactions(
                checking,
                &[
                    tx("2026-08-01", "Far", "-100.00"),
                    tx("2026-08-10", "Linked out", "-200.00"),
                    tx("2026-08-20", "Unequal", "-300.00"),
                ],
            )
            .unwrap();
        store
            .save_transactions(
                savings,
                &[
                    tx("2026-08-09", "Far in", "100.00"), // 8 days from "Far"
                    tx("2026-08-10", "Linked in", "200.00"),
                    tx("2026-08-20", "Unequal in", "299.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        store.link_transfer(ids[1], ids[4]).unwrap();

        assert!(store.transfer_candidates().unwrap().is_empty());
    }

    #[test]
    fn transfer_candidates_uses_each_transaction_at_most_once_preferring_the_closest_date() {
        let store = Store::open_in_memory().unwrap();
        let (checking, savings) = checking_and_savings(&store);
        store.save_transactions(checking, &[tx("2026-08-10", "Out", "-500.00")]).unwrap();
        store
            .save_transactions(savings, &[tx("2026-08-12", "In two days later", "500.00")])
            .unwrap();
        store.save_transactions(savings, &[tx("2026-08-10", "In same day", "500.00")]).unwrap();
        let out_id = id_of(&store, "Out", "2026-08-10");
        let same_day_in = id_of(&store, "In same day", "2026-08-10");

        let candidates = store.transfer_candidates().unwrap();

        assert_eq!(candidates, vec![TransferCandidate { out_id, in_id: same_day_in }]);
    }

    // Bill-aware forecast.

    fn forecast_today() -> NaiveDate {
        "2026-09-18".parse().unwrap()
    }

    fn checking_with_balance(store: &Store, balance: &str) -> i64 {
        let id = test_account(store);
        store.set_account_starting_balance(id, balance.parse().unwrap()).unwrap();
        id
    }

    fn balance_on(forecast: &BillAwareForecast, date: &str) -> Decimal {
        let date: NaiveDate = date.parse().unwrap();
        forecast
            .points
            .iter()
            .find(|p| p.date == date)
            .unwrap_or_else(|| panic!("no forecast point for {date}"))
            .balance
    }

    #[test]
    fn bill_aware_forecast_falls_back_to_the_trend_forecast_when_there_are_no_recurring_items() {
        let store = Store::open_in_memory().unwrap();
        let account = checking_with_balance(&store, "1000.00");
        store
            .save_transactions(account, &[tx("2026-08-25", "Payroll Deposit", "600.00")])
            .unwrap();

        let forecast = store.bill_aware_forecast(forecast_today(), 30).unwrap();

        assert!(!forecast.uses_recurring);
        assert!(forecast.events.is_empty());
        assert_eq!(forecast.points, store.cash_flow_forecast(forecast_today(), 30).unwrap());
    }

    #[test]
    fn a_recurring_bill_lands_on_its_due_date_and_not_before() {
        let store = Store::open_in_memory().unwrap();
        let account = checking_with_balance(&store, "3000.00");
        store
            .create_recurring(
                "Union Realty",
                Some("Rent"),
                "-1000.00".parse().unwrap(),
                "monthly",
                "2026-09-28".parse().unwrap(),
                Some(account),
            )
            .unwrap();

        let forecast = store.bill_aware_forecast(forecast_today(), 30).unwrap();

        assert!(forecast.uses_recurring);
        assert_eq!(forecast.start_balance, "3000.00".parse().unwrap());
        assert_eq!(balance_on(&forecast, "2026-09-18"), "3000.00".parse().unwrap());
        assert_eq!(balance_on(&forecast, "2026-09-27"), "3000.00".parse().unwrap());
        assert_eq!(balance_on(&forecast, "2026-09-28"), "2000.00".parse().unwrap());
        assert_eq!(
            balance_on(&forecast, "2026-10-18"),
            "2000.00".parse().unwrap(),
            "next month's rent is past the 30-day horizon"
        );
        assert_eq!(forecast.points.len(), 31, "today plus one point per day");
        assert_eq!(
            forecast.events,
            vec![ForecastEvent {
                date: "2026-09-28".parse().unwrap(),
                label: "Union Realty".to_string(),
                amount: "-1000.00".parse().unwrap()
            }]
        );
    }

    #[test]
    fn a_repeating_paycheck_lifts_the_balance_each_time_it_lands_in_the_horizon() {
        let store = Store::open_in_memory().unwrap();
        let account = checking_with_balance(&store, "3000.00");
        store
            .create_recurring(
                "Payroll Deposit",
                Some("Income"),
                "2000.00".parse().unwrap(),
                "biweekly",
                "2026-09-23".parse().unwrap(),
                Some(account),
            )
            .unwrap();

        let forecast = store.bill_aware_forecast(forecast_today(), 30).unwrap();

        assert_eq!(balance_on(&forecast, "2026-09-22"), "3000.00".parse().unwrap());
        assert_eq!(balance_on(&forecast, "2026-09-23"), "5000.00".parse().unwrap());
        assert_eq!(balance_on(&forecast, "2026-10-07"), "7000.00".parse().unwrap());
        assert_eq!(forecast.events.len(), 2, "09-23 and 10-07; the next one (10-21) is past the horizon");
    }

    #[test]
    fn a_canceled_recurring_item_is_left_out_of_the_forecast() {
        let store = Store::open_in_memory().unwrap();
        let account = checking_with_balance(&store, "3000.00");
        let id = store
            .create_recurring(
                "Old Gym",
                None,
                "-50.00".parse().unwrap(),
                "monthly",
                "2026-09-25".parse().unwrap(),
                Some(account),
            )
            .unwrap();
        store.set_recurring_status(id, "canceled").unwrap();

        let forecast = store.bill_aware_forecast(forecast_today(), 30).unwrap();

        assert!(!forecast.uses_recurring, "nothing active left, so it falls back to the trend");
        assert!(forecast.events.is_empty());
    }

    #[test]
    fn a_bill_due_today_is_taken_out_of_todays_balance() {
        let store = Store::open_in_memory().unwrap();
        let account = checking_with_balance(&store, "3000.00");
        store
            .create_recurring(
                "Union Realty",
                Some("Rent"),
                "-1000.00".parse().unwrap(),
                "monthly",
                forecast_today(),
                Some(account),
            )
            .unwrap();

        let forecast = store.bill_aware_forecast(forecast_today(), 7).unwrap();

        assert_eq!(forecast.points[0].balance, "2000.00".parse().unwrap());
        assert_eq!(
            forecast.start_balance,
            "3000.00".parse().unwrap(),
            "the start is what's in the accounts right now"
        );
    }

    #[test]
    fn everyday_spending_is_projected_from_history_but_ignores_recurring_merchants_and_transfers() {
        let store = Store::open_in_memory().unwrap();
        let account = checking_with_balance(&store, "5000.00");
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-19", "Payroll Deposit", "2000.00"), // a recurring paycheck: not baseline
                    tx("2026-08-29", "Grocery Run", "-900.00"),     // genuine everyday spending
                    Transaction {
                        category: Some("Transfer".to_string()),
                        ..tx("2026-09-08", "Move to savings", "-500.00")
                    },
                ],
            )
            .unwrap();
        // Recurring paycheck lands well outside the horizon, so only its
        // *matching* effect on the baseline is under test here.
        store
            .create_recurring(
                "Payroll Deposit",
                Some("Income"),
                "2000.00".parse().unwrap(),
                "monthly",
                "2026-12-01".parse().unwrap(),
                Some(account),
            )
            .unwrap();

        let forecast = store.bill_aware_forecast(forecast_today(), 10).unwrap();

        // 30 days of history (earliest transaction 2026-08-19): -900 / 30 = -30 a day.
        assert_eq!(forecast.daily_baseline, "-30".parse().unwrap());
        let start = forecast.start_balance;
        assert_eq!(start, "5600.00".parse().unwrap()); // 5000 + 2000 - 900 - 500
        assert_eq!(balance_on(&forecast, "2026-09-28"), start - Decimal::from(300));
    }

    #[test]
    fn linked_transfers_are_not_everyday_spending() {
        let store = Store::open_in_memory().unwrap();
        let (checking, savings) = checking_and_savings(&store);
        store.set_account_starting_balance(checking, "5000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(checking, &[tx("2026-08-19", "Move to savings", "-500.00")])
            .unwrap();
        store
            .save_transactions(savings, &[tx("2026-08-19", "Deposit from checking", "500.00")])
            .unwrap();
        store
            .create_recurring(
                "Netflix",
                None,
                "-15.00".parse().unwrap(),
                "monthly",
                "2026-12-01".parse().unwrap(),
                Some(checking),
            )
            .unwrap();
        let out_id = id_of(&store, "Move to savings", "2026-08-19");
        let in_id = id_of(&store, "Deposit from checking", "2026-08-19");
        store.link_transfer(out_id, in_id).unwrap();

        let forecast = store.bill_aware_forecast(forecast_today(), 10).unwrap();

        assert_eq!(forecast.daily_baseline, Decimal::ZERO);
    }

    #[test]
    fn events_are_listed_in_date_order() {
        let store = Store::open_in_memory().unwrap();
        let account = checking_with_balance(&store, "1000.00");
        store
            .create_recurring(
                "Payroll Deposit",
                None,
                "2000.00".parse().unwrap(),
                "monthly",
                "2026-10-01".parse().unwrap(),
                Some(account),
            )
            .unwrap();
        store
            .create_recurring(
                "Union Realty",
                None,
                "-1000.00".parse().unwrap(),
                "monthly",
                "2026-09-28".parse().unwrap(),
                Some(account),
            )
            .unwrap();
        store
            .create_recurring(
                "Geico Auto",
                None,
                "-175.00".parse().unwrap(),
                "monthly",
                "2026-09-20".parse().unwrap(),
                Some(account),
            )
            .unwrap();

        let forecast = store.bill_aware_forecast(forecast_today(), 30).unwrap();

        let labels: Vec<&str> = forecast.events.iter().map(|e| e.label.as_str()).collect();
        // Geico's next one (10-20) is past the 10-18 horizon.
        assert_eq!(labels, vec!["Geico Auto", "Union Realty", "Payroll Deposit"]);
    }

    // Net worth history.

    #[test]
    fn net_worth_as_of_only_counts_transactions_up_to_that_date() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store
            .save_transactions(
                checking,
                &[
                    tx("2026-07-15", "Payroll Deposit", "500.00"),
                    tx("2026-08-15", "Payroll Deposit", "500.00"), // after the cutoff below
                ],
            )
            .unwrap();

        let as_of_july: NaiveDate = "2026-07-31".parse().unwrap();
        let as_of_august: NaiveDate = "2026-08-31".parse().unwrap();

        assert_eq!(store.net_worth_as_of(as_of_july).unwrap(), "1500.00".parse().unwrap());
        assert_eq!(store.net_worth_as_of(as_of_august).unwrap(), "2000.00".parse().unwrap());
    }

    #[test]
    fn net_worth_as_of_counts_debt_as_negative() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
        store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap(); // limit
        store
            .save_transactions(card, &[tx("2026-08-05", "Grocery Store", "-300.00")]) // a charge -> $300 owed
            .unwrap();

        let net_worth = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

        // 1000 cash - 300 owed on the card = 700
        assert_eq!(net_worth, "700.00".parse().unwrap());
    }

    #[test]
    fn net_worth_breakdown_as_of_splits_cash_debt_and_investments() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
        store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap(); // limit
        store.save_transactions(card, &[tx("2026-08-05", "Grocery Store", "-300.00")]).unwrap(); // $300 owed
        let loan = store.get_or_create_account("Auto Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "15000.00".parse().unwrap()).unwrap();
        let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
        store.set_account_starting_balance(brokerage, "5000.00".parse().unwrap()).unwrap();

        let breakdown = store.net_worth_breakdown_as_of("2026-08-31".parse().unwrap()).unwrap();

        assert_eq!(breakdown.cash, "1000.00".parse().unwrap());
        // -300 (card) + -15000 (loan) = -15300 owed
        assert_eq!(breakdown.debt, "-15300.00".parse().unwrap());
        assert_eq!(breakdown.investments, "5000.00".parse().unwrap());
        // 1000 cash - 300 owed - 15000 owed + 5000 investments = -9300
        assert_eq!(breakdown.net_worth, "-9300.00".parse().unwrap());
        assert_eq!(breakdown.net_worth, store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap());
    }

    #[test]
    fn net_worth_breakdown_as_of_uses_holdings_value_for_an_investment_account_once_it_has_holdings() {
        // Same gap as `list_accounts`'s own version of this test: a
        // holding has no historical price record, so its current value is
        // applied at every past date too (same "current value applied
        // throughout" convention the Dashboard already uses for Property
        // & Valuables) — a flat approximation, but far less misleading
        // than counting a real, tracked portfolio as $0 everywhere.
        let store = Store::open_in_memory().unwrap();
        let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
        store.set_account_starting_balance(brokerage, "0".parse().unwrap()).unwrap();
        store
            .create_holding(
                brokerage,
                "VTI",
                "Vanguard Total Stock",
                "10".parse().unwrap(),
                "265.00".parse().unwrap(),
                "2000.00".parse().unwrap(),
                None,
            )
            .unwrap();

        let breakdown = store.net_worth_breakdown_as_of("2026-01-01".parse().unwrap()).unwrap();

        assert_eq!(breakdown.investments, "2650.00".parse().unwrap());
        assert_eq!(breakdown.net_worth, "2650.00".parse().unwrap());
    }

    #[test]
    fn account_contribution_deltas_flags_the_account_that_actually_changed() {
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
        store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap(); // limit
        let loan = store.get_or_create_account("Auto Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "15000.00".parse().unwrap()).unwrap();
        // Only the card gets a new charge between the two dates; the loan sits untouched.
        store.save_transactions(card, &[tx("2026-08-05", "Grocery Store", "-300.00")]).unwrap();

        let deltas = store
            .account_contribution_deltas("2026-07-31".parse().unwrap(), "2026-08-31".parse().unwrap())
            .unwrap();

        assert_eq!(deltas.len(), 1, "expected only the card to show a change: {deltas:?}");
        assert_eq!(deltas[0].name, "Sapphire Rewards");
        assert_eq!(deltas[0].group, "credit");
        // Owing $300 more is a $300 drop in net-worth contribution.
        assert_eq!(deltas[0].delta, "-300.00".parse().unwrap());
    }

    #[test]
    fn account_contribution_deltas_excludes_an_account_with_no_net_change() {
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
        store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap();
        // Charged, then paid back in full before the "to" date — net change is zero.
        store
            .save_transactions(
                card,
                &[tx("2026-08-05", "Grocery Store", "-300.00"), tx("2026-08-10", "Payment", "300.00")],
            )
            .unwrap();

        let deltas = store
            .account_contribution_deltas("2026-07-31".parse().unwrap(), "2026-08-31".parse().unwrap())
            .unwrap();

        assert!(deltas.is_empty(), "a net-zero change shouldn't be reported: {deltas:?}");
    }

    #[test]
    fn account_contribution_deltas_sums_to_the_same_change_the_aggregate_breakdown_reports() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
        store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap();
        let loan = store.get_or_create_account("Auto Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "15000.00".parse().unwrap()).unwrap();
        store.save_transactions(card, &[tx("2026-08-05", "Grocery Store", "-300.00")]).unwrap();
        store.save_transactions(loan, &[tx("2026-08-10", "Loan Payment", "500.00")]).unwrap();

        let from: NaiveDate = "2026-07-31".parse().unwrap();
        let to: NaiveDate = "2026-08-31".parse().unwrap();
        let deltas = store.account_contribution_deltas(from, to).unwrap();
        let breakdown_from = store.net_worth_breakdown_as_of(from).unwrap();
        let breakdown_to = store.net_worth_breakdown_as_of(to).unwrap();

        let debt_delta_sum: Decimal = deltas.iter().filter(|d| d.group == "credit" || d.group == "loan").map(|d| d.delta).sum();
        assert_eq!(debt_delta_sum, breakdown_to.debt - breakdown_from.debt);
    }

    #[test]
    fn net_worth_as_of_counts_a_loans_starting_balance_as_debt_from_day_one() {
        // A loan's `starting_balance` is the amount already owed (unlike a
        // credit account's, which is a limit and starts at $0 owed) — so
        // with no transactions yet, the whole thing must count as debt.
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        let loan = store.get_or_create_account("Auto Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "15000.00".parse().unwrap()).unwrap();

        let net_worth = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

        // 1000 cash - 15000 owed on the loan = -14000
        assert_eq!(net_worth, "-14000.00".parse().unwrap());
    }

    #[test]
    fn net_worth_as_of_reduces_loan_debt_as_payments_are_made() {
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Auto Loan", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "15000.00".parse().unwrap()).unwrap();
        store.save_transactions(loan, &[tx("2026-08-05", "Loan Payment", "500.00")]).unwrap();

        let net_worth = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

        // Owed drops from 15000 to 14500 after a 500 payment.
        assert_eq!(net_worth, "-14500.00".parse().unwrap());
    }

    // Monthly balance rollover.

    #[test]
    fn roll_forward_monthly_balances_makes_current_balance_the_new_baseline() {
        let store = Store::open_in_memory().unwrap();
        let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
        store.set_account_starting_balance(loan, "300000.00".parse().unwrap()).unwrap();
        store.save_transactions(loan, &[tx("2026-08-05", "Payment", "1000.00")]).unwrap(); // owed drops to 299000 during August

        let rolled = store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();

        assert_eq!(rolled.len(), 1);
        assert_eq!(rolled[0].1, "Mortgage");
        assert_eq!(rolled[0].2, "299000.00".parse().unwrap());

        // "now" (well into September, no further transactions) reflects the reset directly.
        let accounts = store.list_accounts("2026-09-15".parse().unwrap()).unwrap();
        assert_eq!(accounts[0].current_balance, "299000.00".parse().unwrap());
    }

    #[test]
    fn a_transaction_dated_the_same_day_as_the_rollover_still_counts_that_day() {
        // Reproduces a real user-reported bug: the monthly rollover ran
        // (say, on app launch the morning of 2026-09-01) before a credit
        // card statement got imported later that same day. The payment
        // must still reduce what's owed *today* — not sit invisible until
        // 2026-09-02 just because it landed on the same calendar day the
        // reset itself was taken.
        let store = Store::open_in_memory().unwrap();
        let card = store.get_or_create_account("Credit Card", AccountType::Credit).unwrap();
        store.set_account_starting_balance(card, "5000.00".parse().unwrap()).unwrap(); // $5000 limit

        store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();

        // Imported (or applied) after the rollover already ran, but still dated today.
        store.save_transactions(card, &[tx("2026-09-01", "Payment", "500.00")]).unwrap();

        let accounts = store.list_accounts("2026-09-01".parse().unwrap()).unwrap();
        let owed = "5000.00".parse::<Decimal>().unwrap() - accounts[0].current_balance;
        assert_eq!(owed, "-500.00".parse().unwrap(), "today's payment must already reduce what's owed today");
    }

    #[test]
    fn roll_forward_monthly_balances_is_a_no_op_the_second_time_in_the_same_month() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        let first = store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
        let second = store.roll_forward_monthly_balances("2026-09-20".parse().unwrap()).unwrap();

        assert_eq!(first.len(), 1);
        assert!(second.is_empty(), "same month, already rolled — must not roll again or double-report");
    }

    #[test]
    fn roll_forward_monthly_balances_adds_a_fresh_reset_for_a_later_month() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-09-10", "Deposit", "200.00")]).unwrap();
        let october_roll = store.roll_forward_monthly_balances("2026-10-01".parse().unwrap()).unwrap();

        assert_eq!(october_roll.len(), 1);
        assert_eq!(october_roll[0].2, "1200.00".parse().unwrap());
    }

    #[test]
    fn net_worth_as_of_before_a_reset_is_unaffected_by_it() {
        // The whole point of resetting via a new row instead of mutating
        // starting_balance in place: a past lookup must keep using
        // whatever was true back then, never a later reset's value.
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-08-10", "Deposit", "500.00")]).unwrap();
        let before_reset = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

        // Roll forward into September, then add a large September transaction.
        store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-09-15", "Big Deposit", "50000.00")]).unwrap();

        let after_reset_and_more_activity = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

        assert_eq!(before_reset, "1500.00".parse().unwrap());
        assert_eq!(
            after_reset_and_more_activity, before_reset,
            "an August lookup must be untouched by a September reset or later transactions"
        );
    }

    #[test]
    fn list_accounts_only_sums_transactions_after_the_latest_reset() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-08-10", "Deposit", "500.00")]).unwrap();

        store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
        store.save_transactions(checking, &[tx("2026-09-05", "Deposit", "100.00")]).unwrap();

        let accounts = store.list_accounts("2026-09-30".parse().unwrap()).unwrap();

        // 1500 (reset baseline) + 100 (September's only transaction) = 1600,
        // NOT 1000 + 500 + 100 = 1600 double-counted differently, and
        // definitely not re-summing August's 500 on top of the reset.
        assert_eq!(accounts[0].current_balance, "1600.00".parse().unwrap());
    }

    #[test]
    fn list_accounts_exposes_the_account_s_latest_checkpoint_date() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

        let accounts = store.list_accounts("2026-08-15".parse().unwrap()).unwrap();
        assert_eq!(
            accounts[0].checkpoint_date, None,
            "no rollover or manual correction has happened yet — every transaction ever recorded should still count"
        );

        // Rolling forward on 2026-09-01 anchors the new checkpoint to the
        // day before (see roll_forward_monthly_balances's own comment).
        store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
        let accounts = store.list_accounts("2026-09-30".parse().unwrap()).unwrap();
        assert_eq!(accounts[0].checkpoint_date, Some("2026-08-31".parse().unwrap()));

        // A later manual correction moves the checkpoint further still —
        // same anchor-to-the-day-before convention.
        store
            .set_account_balance_override(checking, "2000.00".parse().unwrap(), "2026-09-15".parse().unwrap())
            .unwrap();
        let accounts = store.list_accounts("2026-09-30".parse().unwrap()).unwrap();
        assert_eq!(accounts[0].checkpoint_date, Some("2026-09-14".parse().unwrap()));
    }

    #[test]
    fn list_accounts_exposes_the_account_s_icon_key_override() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

        let accounts = store.list_accounts("2026-08-15".parse().unwrap()).unwrap();
        assert_eq!(accounts[0].icon_key, None, "no explicit icon chosen yet");

        store.set_account_icon(checking, Some("crypto")).unwrap();
        let accounts = store.list_accounts("2026-08-15".parse().unwrap()).unwrap();
        assert_eq!(accounts[0].icon_key, Some("crypto".to_string()));

        store.set_account_icon(checking, None).unwrap();
        let accounts = store.list_accounts("2026-08-15".parse().unwrap()).unwrap();
        assert_eq!(
            accounts[0].icon_key, None,
            "clearing it back to None goes back to guessing from account_type"
        );
    }

    #[test]
    fn set_account_icon_on_an_unknown_id_is_a_harmless_no_op() {
        let store = Store::open_in_memory().unwrap();
        store.set_account_icon(999, Some("mortgage")).unwrap();
    }

    #[test]
    fn create_category_applies_an_icon_to_a_brand_new_category() {
        let store = Store::open_in_memory().unwrap();

        store.create_category("Utilities", Some("utilities")).unwrap();

        let categories = store.list_categories_with_icons().unwrap();
        let utilities = categories.iter().find(|c| c.name == "Utilities").unwrap();
        assert_eq!(utilities.icon_key, Some("utilities".to_string()));
    }

    #[test]
    fn create_category_with_no_icon_does_not_clobber_an_existing_categorys_icon() {
        let store = Store::open_in_memory().unwrap();
        store.create_category("Utilities", Some("utilities")).unwrap();

        // Re-registering the same category (e.g. because a transaction was
        // filed under it again) without specifying an icon must leave the
        // one already chosen alone.
        store.create_category("Utilities", None).unwrap();

        let categories = store.list_categories_with_icons().unwrap();
        let utilities = categories.iter().find(|c| c.name == "Utilities").unwrap();
        assert_eq!(utilities.icon_key, Some("utilities".to_string()));
    }

    #[test]
    fn set_category_icon_can_clear_an_existing_categorys_icon() {
        let store = Store::open_in_memory().unwrap();
        store.create_category("Utilities", Some("utilities")).unwrap();

        store.set_category_icon("Utilities", None).unwrap();

        let categories = store.list_categories_with_icons().unwrap();
        let utilities = categories.iter().find(|c| c.name == "Utilities").unwrap();
        assert_eq!(utilities.icon_key, None);
    }

    #[test]
    fn list_categories_with_icons_matches_list_categories_by_name() {
        let store = Store::open_in_memory().unwrap();
        store.create_category("Pet Care", None).unwrap();

        let names: Vec<String> = store.list_categories().unwrap();
        let with_icons = store.list_categories_with_icons().unwrap();

        assert_eq!(names, with_icons.iter().map(|c| c.name.clone()).collect::<Vec<_>>());
        assert!(with_icons.iter().any(|c| c.name == "Pet Care" && c.icon_key.is_none()));
    }

    // ---- Phase 2 / 7b: suggest budgets from a trailing average ----

    /// One categorized expense — `amount` is the positive dollars spent.
    fn spend_on(store: &Store, account: i64, date: &str, description: &str, amount: &str, category: &str) {
        store.save_transactions(account, &[tx(date, description, &format!("-{amount}"))]).unwrap();
        let id = id_of(store, description, date);
        store.set_category(id, category, CategorySource::User, None).unwrap();
    }

    fn suggested(suggestions: &BudgetSuggestions, category: &str) -> Option<Decimal> {
        suggestions.lines.iter().find(|l| l.category == category).map(|l| l.suggested)
    }

    #[test]
    fn suggest_budgets_averages_the_three_full_months_before_the_period() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        spend_on(&store, account, "2026-05-10", "Grocers May", "300.00", "Groceries");
        spend_on(&store, account, "2026-06-10", "Grocers Jun", "450.00", "Groceries");
        spend_on(&store, account, "2026-07-10", "Grocers Jul", "600.00", "Groceries");
        // The month being budgeted isn't part of its own average.
        spend_on(&store, account, "2026-08-02", "Grocers Aug", "9999.00", "Groceries");

        let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

        assert_eq!(s.months_used, 3);
        assert_eq!(suggested(&s, "Groceries"), Some("450".parse().unwrap()));
    }

    #[test]
    fn suggest_budgets_rounds_to_a_whole_dollar() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        spend_on(&store, account, "2026-05-10", "Cafe May", "10.00", "Dining Out");
        spend_on(&store, account, "2026-06-10", "Cafe Jun", "10.00", "Dining Out");
        spend_on(&store, account, "2026-07-10", "Cafe Jul", "11.00", "Dining Out");

        let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

        // 31 / 3 = 10.33...
        assert_eq!(suggested(&s, "Dining Out"), Some("10".parse().unwrap()));
    }

    #[test]
    fn suggest_budgets_counts_a_month_with_no_spend_as_zero() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        spend_on(&store, account, "2026-05-10", "Dentist", "60.00", "Health");
        // Give the account history in June and July so all three months count.
        spend_on(&store, account, "2026-06-10", "Grocers Jun", "10.00", "Groceries");
        spend_on(&store, account, "2026-07-10", "Grocers Jul", "10.00", "Groceries");

        let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

        assert_eq!(suggested(&s, "Health"), Some("20".parse().unwrap()));
    }

    #[test]
    fn suggest_budgets_ignores_transfers_and_income() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        spend_on(&store, account, "2026-06-10", "To Savings", "500.00", "Transfer");
        store.save_transactions(account, &[tx("2026-06-15", "Paycheck", "2000.00")]).unwrap();
        let pay = id_of(&store, "Paycheck", "2026-06-15");
        store.set_category(pay, "Income", CategorySource::User, None).unwrap();
        spend_on(&store, account, "2026-06-20", "Grocers", "90.00", "Groceries");

        let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

        assert_eq!(suggested(&s, "Transfer"), None);
        assert_eq!(suggested(&s, "Income"), None);
        assert!(suggested(&s, "Groceries").is_some());
    }

    #[test]
    fn suggest_budgets_reports_the_current_budget_and_group_of_a_budgeted_category() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Rent", "2026-08", "1500.00".parse().unwrap(), "fixed").unwrap();
        spend_on(&store, account, "2026-06-01", "Landlord Jun", "1500.00", "Rent");
        spend_on(&store, account, "2026-07-01", "Landlord Jul", "1500.00", "Rent");
        spend_on(&store, account, "2026-07-12", "Grocers", "300.00", "Groceries");

        let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

        let rent = s.lines.iter().find(|l| l.category == "Rent").unwrap();
        assert_eq!(rent.current, Some("1500.00".parse().unwrap()));
        assert_eq!(rent.budget_group, "fixed");
        let groceries = s.lines.iter().find(|l| l.category == "Groceries").unwrap();
        assert_eq!(groceries.current, None);
        assert_eq!(groceries.budget_group, "flexible");
    }

    #[test]
    fn suggest_budgets_uses_only_the_months_that_have_history() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        // The first-ever transaction is in June, so May doesn't dilute the average.
        spend_on(&store, account, "2026-06-10", "Grocers Jun", "200.00", "Groceries");
        spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");

        let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

        assert_eq!(s.months_used, 2);
        assert_eq!(suggested(&s, "Groceries"), Some("250".parse().unwrap()));
    }

    #[test]
    fn suggest_budgets_is_empty_when_there_is_no_history_before_the_period() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        spend_on(&store, account, "2026-08-05", "Grocers", "80.00", "Groceries");

        let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

        assert_eq!(s.months_used, 0);
        assert!(s.lines.is_empty());
    }

    #[test]
    fn suggest_budgets_window_crosses_a_year_boundary() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        spend_on(&store, account, "2025-11-10", "Grocers Nov", "100.00", "Groceries");
        spend_on(&store, account, "2025-12-10", "Grocers Dec", "200.00", "Groceries");
        spend_on(&store, account, "2026-01-10", "Grocers Jan", "300.00", "Groceries");

        // Budgeting February looks back at Nov, Dec, Jan.
        let s = store.suggest_budgets_from_average(2026, 2, 3).unwrap();

        assert_eq!(s.months_used, 3);
        assert_eq!(suggested(&s, "Groceries"), Some("200".parse().unwrap()));
    }

    #[test]
    fn suggest_budgets_lists_the_biggest_average_first_and_drops_sub_dollar_noise() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        spend_on(&store, account, "2026-07-01", "Grocers", "300.00", "Groceries");
        spend_on(&store, account, "2026-07-02", "Cafe", "90.00", "Dining Out");
        spend_on(&store, account, "2026-07-03", "Gum", "0.40", "Candy");

        let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

        let names: Vec<&str> = s.lines.iter().map(|l| l.category.as_str()).collect();
        assert_eq!(names, vec!["Groceries", "Dining Out"]);
    }

    // ---- Phase 2 / 8a + 8b: goal pace and goals that track an account ----

    fn day(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }

    fn goal(store: &Store, today: &str, name: &str) -> StoredBucket {
        store
            .list_buckets_as_of(day(today))
            .unwrap()
            .into_iter()
            .find(|b| b.name == name)
            .unwrap_or_else(|| panic!("no goal {name:?}"))
    }

    fn savings_with_start(store: &Store, name: &str, start: &str) -> i64 {
        let id = store.get_or_create_account(name, AccountType::Savings).unwrap();
        store
            .conn
            .execute("UPDATE accounts SET starting_balance = ?1 WHERE id = ?2", params![start, id])
            .unwrap();
        id
    }

    #[test]
    fn goal_pace_is_the_last_90_days_of_contributions_per_month() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_bucket("Trip", Some("3000".parse().unwrap()), None, None, None, None, None)
            .unwrap();
        store
            .add_bucket_contribution(id, day("2026-09-08"), "300".parse().unwrap(), None)
            .unwrap();
        store
            .add_bucket_contribution(id, day("2026-08-09"), "300".parse().unwrap(), None)
            .unwrap();
        // 100 days back: outside the window.
        store
            .add_bucket_contribution(id, day("2026-06-10"), "300".parse().unwrap(), None)
            .unwrap();

        assert_eq!(goal(&store, "2026-09-18", "Trip").monthly_pace, "200".parse().unwrap());
    }

    #[test]
    fn goal_pace_counts_withdrawals_against_it() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_bucket("Trip", None, None, None, None, None, None).unwrap();
        store
            .add_bucket_contribution(id, day("2026-09-01"), "300".parse().unwrap(), None)
            .unwrap();
        store
            .add_bucket_contribution(id, day("2026-09-05"), "-90".parse().unwrap(), None)
            .unwrap();

        assert_eq!(goal(&store, "2026-09-18", "Trip").monthly_pace, "70".parse().unwrap());
    }

    #[test]
    fn goal_pace_is_zero_without_recent_contributions() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_bucket("Trip", None, None, None, None, None, None).unwrap();
        store
            .add_bucket_contribution(id, day("2026-01-01"), "500".parse().unwrap(), None)
            .unwrap();

        let g = goal(&store, "2026-09-18", "Trip");
        assert_eq!(g.monthly_pace, Decimal::ZERO);
        assert_eq!(g.saved_amount, "500".parse().unwrap());
    }

    #[test]
    fn a_goal_tracking_an_account_reports_that_balance_as_saved() {
        let store = Store::open_in_memory().unwrap();
        let savings = savings_with_start(&store, "High-Yield Savings", "1000.00");
        store.save_transactions(savings, &[tx("2026-08-01", "Deposit", "200.00")]).unwrap();
        let id = store
            .create_bucket("Emergency Fund", Some("5000".parse().unwrap()), None, Some(savings), None, None, None)
            .unwrap();
        store.set_bucket_tracks_account(id, true).unwrap();
        // A manual contribution no longer counts: the balance is the truth.
        store.add_bucket_contribution(id, day("2026-09-01"), "50".parse().unwrap(), None).unwrap();

        let g = goal(&store, "2026-09-18", "Emergency Fund");

        assert!(g.tracks_account);
        assert_eq!(g.saved_amount, "1200".parse().unwrap());
    }

    #[test]
    fn a_linked_goal_that_is_not_tracking_keeps_its_contribution_total() {
        let store = Store::open_in_memory().unwrap();
        let savings = savings_with_start(&store, "High-Yield Savings", "1000.00");
        let id = store.create_bucket("Trip", None, None, Some(savings), None, None, None).unwrap();
        store.add_bucket_contribution(id, day("2026-09-01"), "75".parse().unwrap(), None).unwrap();

        let g = goal(&store, "2026-09-18", "Trip");

        assert!(!g.tracks_account);
        assert_eq!(g.saved_amount, "75".parse().unwrap());
    }

    #[test]
    fn tracking_with_no_linked_account_falls_back_to_contributions() {
        let store = Store::open_in_memory().unwrap();
        let id = store.create_bucket("Trip", None, None, None, None, None, None).unwrap();
        store.set_bucket_tracks_account(id, true).unwrap();
        store.add_bucket_contribution(id, day("2026-09-01"), "75".parse().unwrap(), None).unwrap();

        assert_eq!(goal(&store, "2026-09-18", "Trip").saved_amount, "75".parse().unwrap());
    }

    #[test]
    fn a_tracked_balance_never_reports_below_zero() {
        let store = Store::open_in_memory().unwrap();
        let savings = savings_with_start(&store, "Overdrawn", "0.00");
        store.save_transactions(savings, &[tx("2026-08-01", "Withdrawal", "-500.00")]).unwrap();
        let id = store.create_bucket("Fund", None, None, Some(savings), None, None, None).unwrap();
        store.set_bucket_tracks_account(id, true).unwrap();

        assert_eq!(goal(&store, "2026-09-18", "Fund").saved_amount, Decimal::ZERO);
    }

    #[test]
    fn a_tracking_goals_pace_is_its_accounts_net_change_per_month() {
        let store = Store::open_in_memory().unwrap();
        let savings = savings_with_start(&store, "High-Yield Savings", "1000.00");
        store
            .save_transactions(
                savings,
                &[
                    tx("2026-09-03", "Deposit A", "300.00"),
                    tx("2026-08-01", "Deposit B", "300.00"),
                    tx("2026-03-01", "Deposit C", "5000.00"),
                ],
            )
            .unwrap();
        let id = store
            .create_bucket("Emergency Fund", None, None, Some(savings), None, None, None)
            .unwrap();
        store.set_bucket_tracks_account(id, true).unwrap();

        assert_eq!(goal(&store, "2026-09-18", "Emergency Fund").monthly_pace, "200".parse().unwrap());
    }

    #[test]
    fn set_bucket_tracks_account_can_be_turned_back_off() {
        let store = Store::open_in_memory().unwrap();
        let savings = savings_with_start(&store, "High-Yield Savings", "1000.00");
        let id = store.create_bucket("Fund", None, None, Some(savings), None, None, None).unwrap();
        store.set_bucket_tracks_account(id, true).unwrap();
        store.set_bucket_tracks_account(id, false).unwrap();

        assert!(!goal(&store, "2026-09-18", "Fund").tracks_account);
        // An unknown id is a harmless no-op.
        store.set_bucket_tracks_account(9999, true).unwrap();
    }

    // ---- Phase 2 / 17: second backup destination (the setting) ----

    #[test]
    fn backup_copy_dir_starts_unset_and_can_be_set_and_cleared() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.get_backup_copy_dir().unwrap(), None);

        store.set_backup_copy_dir(Some("D:\\OneDrive\\Backups")).unwrap();
        assert_eq!(store.get_backup_copy_dir().unwrap(), Some("D:\\OneDrive\\Backups".to_string()));

        store.set_backup_copy_dir(None).unwrap();
        assert_eq!(store.get_backup_copy_dir().unwrap(), None);
    }

    #[test]
    fn a_blank_backup_copy_dir_counts_as_unset() {
        let store = Store::open_in_memory().unwrap();
        store.set_backup_copy_dir(Some("   ")).unwrap();

        assert_eq!(store.get_backup_copy_dir().unwrap(), None);
    }

    #[test]
    fn setting_the_backup_copy_dir_leaves_the_feature_toggles_alone() {
        let store = Store::open_in_memory().unwrap();
        store.set_envelope_caps_enabled(false).unwrap();
        store.set_backup_copy_dir(Some("E:\\Backups")).unwrap();

        let settings = store.get_app_settings().unwrap();
        assert!(!settings.envelope_caps_enabled, "an earlier toggle must survive");
        assert!(
            settings.apply_to_debt_enabled && settings.split_purchases_enabled,
            "untouched toggles keep their default"
        );
    }

    #[test]
    fn opening_a_database_from_before_the_backup_copy_dir_existed_adds_the_column() {
        let dir = std::env::temp_dir().join(format!("meadow-backup-copy-dir-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_backup_copy_dir.db");
        let _ = std::fs::remove_file(&db_path);
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE app_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    apply_to_debt_enabled INTEGER NOT NULL DEFAULT 1,
                    split_purchases_enabled INTEGER NOT NULL DEFAULT 1,
                    envelope_caps_enabled INTEGER NOT NULL DEFAULT 1,
                    loan_sign_convention_migrated INTEGER NOT NULL DEFAULT 0,
                    default_rules_seeded INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO app_settings (id, envelope_caps_enabled) VALUES (1, 0);",
            )
            .unwrap();
        }

        let store = Store::open(&db_path).unwrap();

        assert_eq!(store.get_backup_copy_dir().unwrap(), None);
        store.set_backup_copy_dir(Some("F:\\Safe")).unwrap();
        assert_eq!(store.get_backup_copy_dir().unwrap(), Some("F:\\Safe".to_string()));
        assert!(!store.get_app_settings().unwrap().envelope_caps_enabled, "the existing row must survive");
    }

    // ---- Phase 2 / 6: match recurring items to real transactions ----

    fn dec(s: &str) -> Decimal {
        s.parse().unwrap()
    }

    /// A monthly bill on the 3rd, first due 2026-06-03, plus the charges the
    /// bank actually posted — `(date, amount)` pairs on `desc`.
    fn netflix_with(store: &Store, account: i64, stored_amount: &str, posted: &[(&str, &str)]) -> i64 {
        let id = store
            .create_recurring("Netflix", Some("Subscriptions"), dec(stored_amount), "monthly", day("2026-06-03"), None)
            .unwrap();
        for (date, amount) in posted {
            store.save_transactions(account, &[tx(date, "NETFLIX.COM 866-579", amount)]).unwrap();
        }
        id
    }

    fn match_for(store: &Store, today: &str, recurring_id: i64) -> RecurringMatch {
        store
            .recurring_matches(day(today))
            .unwrap()
            .into_iter()
            .find(|m| m.recurring_id == recurring_id)
            .expect("a match row for the recurring item")
    }

    #[test]
    fn a_bill_with_a_charge_near_its_due_date_is_paid() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let id = netflix_with(
            &store,
            account,
            "-15.49",
            &[("2026-07-03", "-15.49"), ("2026-08-03", "-15.49"), ("2026-09-03", "-15.49")],
        );

        let m = match_for(&store, "2026-09-05", id);

        assert_eq!(m.state, "paid");
        assert_eq!(m.last_due, Some(day("2026-09-03")));
        assert_eq!(m.last_paid_date, Some(day("2026-09-03")));
        assert_eq!(m.last_paid_amount, Some(dec("-15.49")));
    }

    #[test]
    fn a_charge_that_posts_a_few_days_late_still_counts() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let id = netflix_with(&store, account, "-15.49", &[("2026-08-03", "-15.49"), ("2026-09-06", "-15.49")]);

        assert_eq!(match_for(&store, "2026-09-10", id).state, "paid");
    }

    #[test]
    fn a_bill_past_due_with_no_charge_yet_is_pending_inside_the_grace_period() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let id = netflix_with(&store, account, "-15.49", &[("2026-07-03", "-15.49"), ("2026-08-03", "-15.49")]);

        let m = match_for(&store, "2026-09-05", id);

        assert_eq!(m.state, "pending");
        assert_eq!(m.last_due, Some(day("2026-09-03")));
        assert_eq!(m.last_paid_date, Some(day("2026-08-03")));
    }

    #[test]
    fn a_bill_well_past_due_with_no_charge_is_missed() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let id = netflix_with(&store, account, "-15.49", &[("2026-07-03", "-15.49"), ("2026-08-03", "-15.49")]);

        assert_eq!(match_for(&store, "2026-09-20", id).state, "missed");
    }

    #[test]
    fn an_item_with_no_matching_charge_ever_is_unmatched_not_missed() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let id = netflix_with(&store, account, "-15.49", &[]);
        store.save_transactions(account, &[tx("2026-08-03", "Kroger", "-40.00")]).unwrap();

        let m = match_for(&store, "2026-09-20", id);

        assert_eq!(m.state, "unmatched");
        assert_eq!(m.last_paid_date, None);
    }

    #[test]
    fn an_item_that_has_not_started_yet_is_upcoming() {
        let store = Store::open_in_memory().unwrap();
        let id = store
            .create_recurring("Gym", None, dec("-30"), "monthly", day("2026-10-01"), None)
            .unwrap();

        let m = match_for(&store, "2026-09-18", id);

        assert_eq!(m.state, "upcoming");
        assert_eq!(m.last_due, None);
    }

    #[test]
    fn income_with_the_same_name_does_not_match_a_bill() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let id = netflix_with(&store, account, "-15.49", &[]);
        store
            .save_transactions(account, &[tx("2026-09-03", "NETFLIX.COM refund", "15.49")])
            .unwrap();

        assert_eq!(match_for(&store, "2026-09-05", id).state, "unmatched");
    }

    #[test]
    fn a_deleted_charge_does_not_count_as_paid() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let id = netflix_with(&store, account, "-15.49", &[("2026-08-03", "-15.49"), ("2026-09-03", "-15.49")]);
        let tx_id = id_of(&store, "NETFLIX.COM 866-579", "2026-09-03");
        store.delete_transaction(tx_id, test_now()).unwrap();

        assert_eq!(match_for(&store, "2026-09-05", id).state, "pending");
    }

    #[test]
    fn a_price_increase_after_a_steady_run_is_flagged() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let id = netflix_with(
            &store,
            account,
            "-15.49",
            &[
                ("2026-06-03", "-15.49"),
                ("2026-07-03", "-15.49"),
                ("2026-08-03", "-15.49"),
                ("2026-09-03", "-17.99"),
            ],
        );

        let change = match_for(&store, "2026-09-05", id).price_change.expect("a price change");

        assert_eq!(change.from, dec("-15.49"));
        assert_eq!(change.to, dec("-17.99"));
    }

    #[test]
    fn a_steady_price_is_not_flagged() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let id = netflix_with(
            &store,
            account,
            "-15.49",
            &[("2026-07-03", "-15.49"), ("2026-08-03", "-15.49"), ("2026-09-03", "-15.49")],
        );

        assert!(match_for(&store, "2026-09-05", id).price_change.is_none());
    }

    #[test]
    fn a_bill_that_varies_every_month_is_never_flagged() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let id = store
            .create_recurring("City Power", None, dec("-90"), "monthly", day("2026-06-03"), None)
            .unwrap();
        for (date, amount) in [
            ("2026-06-03", "-80.00"),
            ("2026-07-03", "-95.00"),
            ("2026-08-03", "-70.00"),
            ("2026-09-03", "-88.00"),
        ] {
            store.save_transactions(account, &[tx(date, "CITY POWER & LIGHT", amount)]).unwrap();
        }

        assert!(match_for(&store, "2026-09-05", id).price_change.is_none());
    }

    #[test]
    fn a_single_charge_is_compared_against_the_amount_on_file() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let id = netflix_with(&store, account, "-15.49", &[("2026-09-03", "-17.99")]);

        let change = match_for(&store, "2026-09-05", id).price_change.expect("a price change");

        assert_eq!((change.from, change.to), (dec("-15.49"), dec("-17.99")));
    }

    #[test]
    fn a_trivial_difference_is_not_a_price_change() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let id = netflix_with(&store, account, "-15.49", &[("2026-08-03", "-15.49"), ("2026-09-03", "-15.50")]);

        assert!(match_for(&store, "2026-09-05", id).price_change.is_none());
    }

    #[test]
    fn a_blank_merchant_never_matches_everything() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        let id = store.create_recurring("", None, dec("-10"), "monthly", day("2026-06-03"), None).unwrap();
        store
            .save_transactions(account, &[tx("2026-09-03", "Anything at all", "-10.00")])
            .unwrap();

        assert_eq!(match_for(&store, "2026-09-05", id).state, "unmatched");
    }

    #[test]
    fn the_forecast_skips_a_bill_due_today_that_has_already_posted() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        netflix_with(&store, account, "-15.49", &[("2026-08-03", "-15.49"), ("2026-09-03", "-15.49")]);

        let forecast = store.bill_aware_forecast(day("2026-09-03"), 10).unwrap();

        assert!(
            !forecast.events.iter().any(|e| e.label == "Netflix" && e.date == day("2026-09-03")),
            "a charge that already hit the account must not be counted again: {:?}",
            forecast.events
        );
    }

    #[test]
    fn the_forecast_still_counts_a_bill_due_today_that_has_not_posted() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        netflix_with(&store, account, "-15.49", &[("2026-08-03", "-15.49")]);

        let forecast = store.bill_aware_forecast(day("2026-09-03"), 10).unwrap();

        assert!(forecast.events.iter().any(|e| e.label == "Netflix" && e.date == day("2026-09-03")));
    }

    // ---- Phase 2 / 9: month-end review ----

    #[test]
    fn month_review_reports_the_months_income_and_spending_beside_the_month_before() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-05", "Paycheck", "3000.00"),
                    tx("2026-07-10", "Rent", "-1200.00"),
                    tx("2026-08-05", "Paycheck", "3200.00"),
                    tx("2026-08-10", "Rent", "-1200.00"),
                    tx("2026-08-15", "Kroger", "-300.00"),
                ],
            )
            .unwrap();

        let r = store.month_review(2026, 8).unwrap();

        assert_eq!((r.income, r.expenses), (dec("3200.00"), dec("1500.00")));
        assert_eq!((r.prev_income, r.prev_expenses), (dec("3000.00"), dec("1200.00")));
    }

    #[test]
    fn month_review_of_january_compares_with_the_previous_december() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(account, &[tx("2025-12-20", "Gifts", "-250.00"), tx("2026-01-05", "Kroger", "-100.00")])
            .unwrap();

        let r = store.month_review(2026, 1).unwrap();

        assert_eq!(r.prev_expenses, dec("250.00"));
        assert_eq!(r.expenses, dec("100.00"));
    }

    #[test]
    fn month_review_lists_only_expense_categories_that_went_over_budget_biggest_overage_first() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Dining Out", "2026-08", dec("100"), "flexible").unwrap();
        store.set_budget("Groceries", "2026-08", dec("400"), "flexible").unwrap();
        store.set_budget("Gas", "2026-08", dec("150"), "flexible").unwrap();
        store.set_budget("Paycheck", "2026-08", dec("3000"), "income").unwrap();
        spend_on(&store, account, "2026-08-03", "Cafe", "260.00", "Dining Out");
        spend_on(&store, account, "2026-08-04", "Kroger", "430.00", "Groceries");
        spend_on(&store, account, "2026-08-05", "Shell", "90.00", "Gas");

        let r = store.month_review(2026, 8).unwrap();

        let over: Vec<(&str, Decimal, Decimal)> = r.over_budget.iter().map(|l| (l.category.as_str(), l.budgeted, l.actual)).collect();
        assert_eq!(
            over,
            vec![("Dining Out", dec("100"), dec("260.00")), ("Groceries", dec("400"), dec("430.00"))]
        );
    }

    #[test]
    fn month_review_counts_the_months_uncategorized_transactions_and_their_total() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-02", "Mystery Vendor", "-40.00"),
                    tx("2026-08-20", "Deposit", "25.00"),
                    tx("2026-07-30", "Last Month Mystery", "-99.00"),
                    tx("2026-09-01", "Next Month Mystery", "-77.00"),
                ],
            )
            .unwrap();

        let r = store.month_review(2026, 8).unwrap();

        assert_eq!(r.uncategorized_count, 2);
        assert_eq!(r.uncategorized_total, dec("65.00"));
    }

    #[test]
    fn month_review_ignores_categorized_deleted_and_split_transactions_when_counting_uncategorized() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-02", "Kroger", "-40.00"),
                    tx("2026-08-03", "Gone", "-10.00"),
                    tx("2026-08-04", "Costco", "-100.00"),
                ],
            )
            .unwrap();
        store
            .set_category(id_of(&store, "Kroger", "2026-08-02"), "Groceries", CategorySource::User, None)
            .unwrap();
        store.delete_transaction(id_of(&store, "Gone", "2026-08-03"), test_now()).unwrap();
        let costco = id_of(&store, "Costco", "2026-08-04");
        store
            .set_transaction_splits(
                costco,
                &[
                    ("Groceries".to_string(), dec("-60.00"), None),
                    ("Household".to_string(), dec("-40.00"), None),
                ],
            )
            .unwrap();

        let r = store.month_review(2026, 8).unwrap();

        assert_eq!(r.uncategorized_count, 0);
    }

    #[test]
    fn a_month_is_reviewed_only_once_marked_and_marking_twice_is_harmless() {
        let store = Store::open_in_memory().unwrap();
        assert!(!store.month_review(2026, 8).unwrap().reviewed);

        store.set_month_reviewed(2026, 8).unwrap();
        store.set_month_reviewed(2026, 8).unwrap();

        assert!(store.month_review(2026, 8).unwrap().reviewed);
        assert!(!store.month_review(2026, 7).unwrap().reviewed);
        assert_eq!(store.list_reviewed_months().unwrap(), vec!["2026-08".to_string()]);
    }

    // ---- Phase 2 / 3: dismissing an anomaly flag ("looks right") ----

    fn duplicate_pair(store: &Store) -> (i64, i64) {
        let account = test_account(store);
        store
            .save_transactions(account, &[tx("2026-09-10", "Netflix", "-15.49"), tx("2026-09-12", "Netflix", "-15.49")])
            .unwrap();
        (id_of(store, "Netflix", "2026-09-10"), id_of(store, "Netflix", "2026-09-12"))
    }

    #[test]
    fn a_dismissed_flag_leaves_the_open_list_but_not_the_full_anomaly_scan() {
        let store = Store::open_in_memory().unwrap();
        let (first, second) = duplicate_pair(&store);
        assert_eq!(store.open_anomaly_flags().unwrap().len(), 2, "both rows of a duplicate pair are flagged");

        store.dismiss_anomaly(first, "duplicate").unwrap();

        let open = store.open_anomaly_flags().unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].transaction_id, second);
        assert_eq!(store.anomaly_flags().unwrap().len(), 2, "other features still see every anomaly");
    }

    #[test]
    fn dismissing_one_kind_leaves_the_other_kinds_on_that_transaction() {
        let store = Store::open_in_memory().unwrap();
        let (first, _) = duplicate_pair(&store);

        // "large" was never raised for this row, so dismissing it changes nothing.
        store.dismiss_anomaly(first, "large").unwrap();

        assert_eq!(store.open_anomaly_flags().unwrap().len(), 2);
    }

    #[test]
    fn dismissing_twice_is_harmless() {
        let store = Store::open_in_memory().unwrap();
        let (first, _) = duplicate_pair(&store);

        store.dismiss_anomaly(first, "duplicate").unwrap();
        store.dismiss_anomaly(first, "duplicate").unwrap();

        assert_eq!(store.open_anomaly_flags().unwrap().len(), 1);
    }

    // ---- Phase 2 / 7c: optional unspent rollover per budget category ----

    /// Groceries budgeted `amount` in each of `months`, with rollover switched
    /// on for the ones in `rolling`.
    fn budget_groceries(store: &Store, months: &[&str], amount: &str, rolling: &[&str]) {
        for m in months {
            store.set_budget("Groceries", m, dec(amount), "flexible").unwrap();
        }
        for m in rolling {
            store.set_budget_rollover("Groceries", m, true).unwrap();
        }
    }

    fn groceries_line(store: &Store, year: i32, month: u32) -> BudgetActual {
        store
            .monthly_budget_actuals(year, month)
            .unwrap()
            .into_iter()
            .find(|l| l.category == "Groceries")
            .expect("a Groceries budget line")
    }

    #[test]
    fn unspent_budget_rolls_into_the_next_month_when_rollover_is_on() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-07", "2026-08"]);
        spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");

        let aug = groceries_line(&store, 2026, 8);

        assert_eq!(aug.rollover, dec("100"));
        assert_eq!(aug.budgeted, dec("400"), "the budget itself is unchanged");
        assert!(aug.rollover_enabled);
    }

    #[test]
    fn the_rollover_feature_is_on_by_default_and_its_setting_persists() {
        let store = Store::open_in_memory().unwrap();
        assert!(
            store.get_app_settings().unwrap().rollover_enabled,
            "existing users keep today's behaviour until they choose otherwise"
        );

        store.set_rollover_enabled(false).unwrap();
        let settings = store.get_app_settings().unwrap();
        assert!(!settings.rollover_enabled);
        assert!(
            settings.envelope_caps_enabled && settings.apply_to_debt_enabled,
            "other toggles are untouched"
        );

        store.set_rollover_enabled(true).unwrap();
        assert!(store.get_app_settings().unwrap().rollover_enabled);
    }

    #[test]
    fn turning_the_rollover_feature_off_stops_money_carrying_and_touches_no_stored_choice() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-07", "2026-08"]);
        spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");
        let budgets_before = store.list_budgets("2026-08").unwrap();
        assert_eq!(groceries_line(&store, 2026, 8).rollover, dec("100"));

        store.set_rollover_enabled(false).unwrap();

        let aug = groceries_line(&store, 2026, 8);
        assert_eq!(aug.rollover, Decimal::ZERO, "nothing rolls in while the feature is off");
        assert_eq!(aug.budgeted, dec("400"));
        assert!(aug.rollover_enabled, "the category's own choice is remembered, not cleared");
        assert_eq!(store.list_budgets("2026-08").unwrap(), budgets_before, "toggling rewrites no budget row");
        assert_eq!(store.list_budgets("2026-07").unwrap().len(), 1, "earlier months keep their rows too");

        store.set_rollover_enabled(true).unwrap();
        assert_eq!(
            groceries_line(&store, 2026, 8).rollover,
            dec("100"),
            "turning it back on restores what was carried"
        );
    }

    #[test]
    fn with_the_rollover_feature_off_alerts_and_the_month_review_use_the_plain_budget() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-07", "2026-08"]);
        spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");
        // August spending of 450 is over 400 but inside 400 + the 100 carried in.
        spend_on(&store, account, "2026-08-10", "Grocers Aug", "450.00", "Groceries");
        assert!(
            store.month_review(2026, 8).unwrap().over_budget.is_empty(),
            "the carried-in 100 covers it"
        );

        store.set_rollover_enabled(false).unwrap();

        let over = store.month_review(2026, 8).unwrap().over_budget;
        assert_eq!(over.len(), 1, "without the carry, August is over budget");
        assert_eq!(over[0].category, "Groceries");
        assert_eq!(over[0].budgeted, dec("400"));
    }

    #[test]
    fn opening_a_database_from_before_the_rollover_setting_existed_keeps_rollover_on() {
        let dir = std::env::temp_dir().join(format!("meadow-rollover-setting-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("pre_rollover_setting.db");
        let _ = std::fs::remove_file(&db_path);
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE app_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    apply_to_debt_enabled INTEGER NOT NULL DEFAULT 1,
                    split_purchases_enabled INTEGER NOT NULL DEFAULT 1,
                    envelope_caps_enabled INTEGER NOT NULL DEFAULT 1,
                    loan_sign_convention_migrated INTEGER NOT NULL DEFAULT 0,
                    default_rules_seeded INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO app_settings (id, envelope_caps_enabled) VALUES (1, 0);",
            )
            .unwrap();
        }

        let store = Store::open(&db_path).unwrap();

        let settings = store.get_app_settings().unwrap();
        assert!(settings.rollover_enabled, "an upgraded profile behaves exactly as before");
        assert!(!settings.envelope_caps_enabled, "the existing row's choices survive");
    }

    #[test]
    fn an_overspent_month_carries_nothing_forward() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-07", "2026-08"]);
        spend_on(&store, account, "2026-07-10", "Grocers Jul", "450.00", "Groceries");

        assert_eq!(groceries_line(&store, 2026, 8).rollover, Decimal::ZERO);
    }

    #[test]
    fn without_rollover_nothing_carries_even_when_money_was_left() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        budget_groceries(&store, &["2026-07", "2026-08"], "400", &[]);
        spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");

        let aug = groceries_line(&store, 2026, 8);

        assert_eq!(aug.rollover, Decimal::ZERO);
        assert!(!aug.rollover_enabled);
    }

    #[test]
    fn switching_rollover_on_starts_fresh_last_months_leftover_does_not_come_along() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-08"]);
        spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");

        assert_eq!(groceries_line(&store, 2026, 8).rollover, Decimal::ZERO);
    }

    #[test]
    fn rollover_chains_across_several_months_counting_what_was_carried_in() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        budget_groceries(&store, &["2026-06", "2026-07", "2026-08"], "400", &["2026-06", "2026-07", "2026-08"]);
        spend_on(&store, account, "2026-06-10", "Grocers Jun", "300.00", "Groceries"); // 100 left
        spend_on(&store, account, "2026-07-10", "Grocers Jul", "350.00", "Groceries"); // 400 + 100 - 350 = 150 left

        assert_eq!(groceries_line(&store, 2026, 7).rollover, dec("100"));
        assert_eq!(groceries_line(&store, 2026, 8).rollover, dec("150"));
    }

    #[test]
    fn a_gap_in_the_budget_breaks_the_chain() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        budget_groceries(&store, &["2026-06", "2026-08"], "400", &["2026-06", "2026-08"]);
        // July was touched but Groceries was deleted from it.
        store.set_budget("Rent", "2026-07", dec("1000"), "fixed").unwrap();
        spend_on(&store, account, "2026-06-10", "Grocers Jun", "100.00", "Groceries");

        assert_eq!(groceries_line(&store, 2026, 8).rollover, Decimal::ZERO);
    }

    #[test]
    fn income_lines_never_roll_over() {
        let store = Store::open_in_memory().unwrap();
        for m in ["2026-07", "2026-08"] {
            store.set_budget("Paycheck", m, dec("3000"), "income").unwrap();
            store.set_budget_rollover("Paycheck", m, true).unwrap();
        }

        let aug = store
            .monthly_budget_actuals(2026, 8)
            .unwrap()
            .into_iter()
            .find(|l| l.category == "Paycheck")
            .unwrap();

        assert_eq!(aug.rollover, Decimal::ZERO);
    }

    #[test]
    fn a_new_month_inherits_the_rollover_setting() {
        let store = Store::open_in_memory().unwrap();
        budget_groceries(&store, &["2026-08"], "400", &["2026-08"]);

        let september = store.list_budgets("2026-09").unwrap();

        assert!(september.iter().find(|b| b.category == "Groceries").unwrap().rollover_enabled);
    }

    #[test]
    fn alerts_measure_spending_against_the_budget_plus_what_rolled_in() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-07", "2026-08"]);
        spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");
        spend_on(&store, account, "2026-08-10", "Grocers Aug", "450.00", "Groceries");

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        // 450 of 400 would be over; 450 of 500 is only a warning.
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, "warning");
        assert_eq!(alerts[0].budgeted, dec("500"));
    }

    #[test]
    fn the_month_review_counts_rolled_in_money_as_part_of_the_budget() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-07", "2026-08"]);
        spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");
        spend_on(&store, account, "2026-08-10", "Grocers Aug", "450.00", "Groceries");
        assert!(store.month_review(2026, 8).unwrap().over_budget.is_empty(), "450 of 500 isn't over");

        spend_on(&store, account, "2026-08-20", "Grocers Aug 2", "100.00", "Groceries");
        let over = store.month_review(2026, 8).unwrap().over_budget;

        assert_eq!(over.len(), 1);
        assert_eq!((over[0].budgeted, over[0].actual), (dec("500"), dec("550.00")));
    }

    #[test]
    fn setting_rollover_on_a_missing_line_is_harmless() {
        let store = Store::open_in_memory().unwrap();

        store.set_budget_rollover("Nope", "2026-08", true).unwrap();

        assert!(store.list_budgets("2026-08").unwrap().is_empty());
    }

    // ---- Phase 2 / 12: portfolio history and allocation targets ----

    fn brokerage(store: &Store) -> i64 {
        store.get_or_create_account("Brokerage", AccountType::Investment).unwrap()
    }

    #[test]
    fn a_snapshot_records_the_total_value_of_every_holding() {
        let store = Store::open_in_memory().unwrap();
        let acct = brokerage(&store);
        store
            .create_holding(acct, "VTI", "Total Market", dec("10"), dec("250.00"), dec("2000"), Some("US Stocks"))
            .unwrap();
        store
            .create_holding(acct, "BND", "Bonds", dec("20"), dec("75.50"), dec("1400"), Some("Bonds"))
            .unwrap();

        let recorded = store.record_portfolio_snapshot(day("2026-09-18")).unwrap();

        assert!(recorded);
        assert_eq!(store.portfolio_history().unwrap(), vec![(day("2026-09-18"), dec("4010.00"))]);
    }

    #[test]
    fn snapshotting_twice_in_a_day_keeps_the_latest_value() {
        let store = Store::open_in_memory().unwrap();
        let acct = brokerage(&store);
        let id = store
            .create_holding(acct, "VTI", "Total Market", dec("10"), dec("250.00"), dec("2000"), None)
            .unwrap();
        store.record_portfolio_snapshot(day("2026-09-18")).unwrap();

        store.update_holding_price(id, dec("260.00"), day("2026-09-18")).unwrap();
        store.record_portfolio_snapshot(day("2026-09-18")).unwrap();

        assert_eq!(store.portfolio_history().unwrap(), vec![(day("2026-09-18"), dec("2600.00"))]);
    }

    #[test]
    fn history_is_oldest_first_across_days() {
        let store = Store::open_in_memory().unwrap();
        let acct = brokerage(&store);
        let id = store
            .create_holding(acct, "VTI", "Total Market", dec("10"), dec("250.00"), dec("2000"), None)
            .unwrap();
        store.record_portfolio_snapshot(day("2026-09-16")).unwrap();
        store.update_holding_price(id, dec("240.00"), day("2026-09-17")).unwrap();
        store.record_portfolio_snapshot(day("2026-09-17")).unwrap();

        let history = store.portfolio_history().unwrap();

        assert_eq!(history, vec![(day("2026-09-16"), dec("2500.00")), (day("2026-09-17"), dec("2400.00"))]);
    }

    #[test]
    fn with_no_holdings_nothing_is_recorded() {
        let store = Store::open_in_memory().unwrap();

        assert!(!store.record_portfolio_snapshot(day("2026-09-18")).unwrap());
        assert!(store.portfolio_history().unwrap().is_empty());
    }

    #[test]
    fn allocation_targets_can_be_set_replaced_and_cleared() {
        let store = Store::open_in_memory().unwrap();
        assert!(store.list_allocation_targets().unwrap().is_empty());

        store.set_allocation_target("US Stocks", dec("60")).unwrap();
        store.set_allocation_target("Bonds", dec("40")).unwrap();
        store.set_allocation_target("US Stocks", dec("55")).unwrap();

        assert_eq!(
            store.list_allocation_targets().unwrap(),
            vec![("Bonds".to_string(), dec("40")), ("US Stocks".to_string(), dec("55"))]
        );

        store.set_allocation_target("Bonds", Decimal::ZERO).unwrap();
        assert_eq!(store.list_allocation_targets().unwrap(), vec![("US Stocks".to_string(), dec("55"))]);
    }

    #[test]
    fn a_target_above_100_is_capped_at_100() {
        let store = Store::open_in_memory().unwrap();

        store.set_allocation_target("US Stocks", dec("250")).unwrap();

        assert_eq!(store.list_allocation_targets().unwrap(), vec![("US Stocks".to_string(), dec("100"))]);
    }

    // ---- Phase 2 / 4: reconciliation and the account detail page ----

    /// A checking account opening at `start` with a few known transactions;
    /// returns (account, [+200 on 07-15, -50 on 08-10, -30 on 09-05]).
    fn reconcilable(store: &Store, start: &str) -> (i64, [i64; 3]) {
        let acct = store.get_or_create_account("Statement Checking", AccountType::Checking).unwrap();
        store
            .conn
            .execute("UPDATE accounts SET starting_balance = ?1 WHERE id = ?2", params![start, acct])
            .unwrap();
        store
            .save_transactions(
                acct,
                &[
                    tx("2026-07-15", "Deposit", "200.00"),
                    tx("2026-08-10", "Coffee", "-50.00"),
                    tx("2026-09-05", "Gas", "-30.00"),
                ],
            )
            .unwrap();
        (
            acct,
            [
                id_of(store, "Deposit", "2026-07-15"),
                id_of(store, "Coffee", "2026-08-10"),
                id_of(store, "Gas", "2026-09-05"),
            ],
        )
    }

    #[test]
    fn the_cleared_balance_is_the_opening_balance_plus_the_transactions_marked_cleared() {
        let store = Store::open_in_memory().unwrap();
        let (acct, [deposit, coffee, _gas]) = reconcilable(&store, "1000.00");
        store.set_transactions_cleared(&[deposit, coffee], true).unwrap();

        let status = store.reconciliation_status(acct, dec("1150.00")).unwrap();

        assert_eq!(status.cleared_balance, dec("1150.00"));
        assert_eq!(status.difference, Decimal::ZERO);
        assert_eq!(status.cleared_count, 2);
    }

    #[test]
    fn the_difference_is_what_the_statement_says_minus_what_has_cleared() {
        let store = Store::open_in_memory().unwrap();
        let (acct, [deposit, _coffee, _gas]) = reconcilable(&store, "1000.00");
        store.set_transactions_cleared(&[deposit], true).unwrap();

        let status = store.reconciliation_status(acct, dec("1150.00")).unwrap();

        assert_eq!(status.cleared_balance, dec("1200.00"));
        assert_eq!(status.difference, dec("-50.00"));
    }

    #[test]
    fn clearing_can_be_undone_and_a_deleted_transaction_stops_counting() {
        let store = Store::open_in_memory().unwrap();
        let (acct, [deposit, coffee, _gas]) = reconcilable(&store, "1000.00");
        store.set_transactions_cleared(&[deposit, coffee], true).unwrap();

        store.set_transactions_cleared(&[coffee], false).unwrap();
        assert_eq!(store.reconciliation_status(acct, dec("0")).unwrap().cleared_balance, dec("1200.00"));

        store.delete_transaction(deposit, test_now()).unwrap();
        assert_eq!(store.reconciliation_status(acct, dec("0")).unwrap().cleared_balance, dec("1000.00"));
    }

    #[test]
    fn a_reconciliation_can_only_be_finished_when_the_difference_is_zero() {
        let store = Store::open_in_memory().unwrap();
        let (acct, [deposit, coffee, _gas]) = reconcilable(&store, "1000.00");
        store.set_transactions_cleared(&[deposit, coffee], true).unwrap();

        let refused = store.finish_reconciliation(acct, day("2026-08-31"), dec("1200.00"), test_now()).unwrap();
        assert!(!refused);
        assert_eq!(store.last_reconciliation(acct).unwrap(), None);

        let accepted = store.finish_reconciliation(acct, day("2026-08-31"), dec("1150.00"), test_now()).unwrap();
        assert!(accepted);
        assert_eq!(store.last_reconciliation(acct).unwrap(), Some((day("2026-08-31"), dec("1150.00"))));
    }

    #[test]
    fn the_latest_reconciliation_is_the_one_reported() {
        let store = Store::open_in_memory().unwrap();
        let (acct, [deposit, coffee, gas]) = reconcilable(&store, "1000.00");
        store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
        store.finish_reconciliation(acct, day("2026-08-31"), dec("1150.00"), test_now()).unwrap();
        store.set_transactions_cleared(&[gas], true).unwrap();
        store.finish_reconciliation(acct, day("2026-09-30"), dec("1120.00"), test_now()).unwrap();

        assert_eq!(store.last_reconciliation(acct).unwrap(), Some((day("2026-09-30"), dec("1120.00"))));
    }

    #[test]
    fn reconcile_candidates_are_uncleared_rows_plus_anything_cleared_since_the_last_reconciliation() {
        let store = Store::open_in_memory().unwrap();
        let (acct, [deposit, coffee, gas]) = reconcilable(&store, "1000.00");
        store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
        store.finish_reconciliation(acct, day("2026-08-31"), dec("1150.00"), test_now()).unwrap();
        store.set_transactions_cleared(&[gas], true).unwrap();

        // Everything up to Sep 30: the reconciled July/Aug rows are settled and drop out; September's shows.
        let candidates = store.reconcile_candidates(acct, day("2026-09-30")).unwrap();

        assert_eq!(candidates.iter().map(|c| c.id).collect::<Vec<_>>(), vec![gas]);
        assert!(candidates[0].cleared);
    }

    #[test]
    fn reconcile_candidates_stop_at_the_statement_date() {
        let store = Store::open_in_memory().unwrap();
        let (acct, [deposit, coffee, _gas]) = reconcilable(&store, "1000.00");

        let candidates = store.reconcile_candidates(acct, day("2026-08-31")).unwrap();

        assert_eq!(
            candidates.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![coffee, deposit],
            "newest first, none after the statement date"
        );
    }

    #[test]
    fn list_account_transactions_is_newest_first_carries_the_cleared_flag_and_honors_the_limit() {
        let store = Store::open_in_memory().unwrap();
        let (acct, [deposit, coffee, gas]) = reconcilable(&store, "1000.00");
        store.set_transactions_cleared(&[deposit], true).unwrap();

        let all = store.list_account_transactions(acct, 10).unwrap();
        assert_eq!(all.iter().map(|t| t.id).collect::<Vec<_>>(), vec![gas, coffee, deposit]);
        assert_eq!(all.iter().map(|t| t.cleared).collect::<Vec<_>>(), vec![false, false, true]);

        assert_eq!(store.list_account_transactions(acct, 2).unwrap().len(), 2);
    }

    #[test]
    fn balance_history_gives_month_end_balances_ending_with_today() {
        let store = Store::open_in_memory().unwrap();
        let (acct, _) = reconcilable(&store, "1000.00");

        let history = store.account_balance_history(acct, day("2026-09-18"), 3).unwrap();

        assert_eq!(
            history,
            vec![
                (day("2026-07-31"), dec("1200.00")),
                (day("2026-08-31"), dec("1150.00")),
                (day("2026-09-18"), dec("1120.00")),
            ]
        );
    }

    #[test]
    fn balance_history_repeats_the_balance_through_a_quiet_month() {
        let store = Store::open_in_memory().unwrap();
        let (acct, _) = reconcilable(&store, "1000.00");

        let history = store.account_balance_history(acct, day("2026-11-10"), 3).unwrap();

        assert_eq!(
            history.iter().map(|(_, b)| *b).collect::<Vec<_>>(),
            vec![dec("1120.00"), dec("1120.00"), dec("1120.00")]
        );
    }

    // ---- Phase 2 / 10: the Reports hub's category-by-month table ----

    fn month_cell(rows: &[CategoryMonthAmount], month: &str, category: &str) -> Option<Decimal> {
        rows.iter().find(|r| r.month == month && r.category == category).map(|r| r.amount)
    }

    #[test]
    fn category_spending_is_totaled_per_month_and_category_as_positive_amounts() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        spend_on(&store, account, "2026-07-05", "Kroger", "80.00", "Groceries");
        spend_on(&store, account, "2026-07-19", "Aldi", "40.00", "Groceries");
        spend_on(&store, account, "2026-07-20", "Cafe", "12.50", "Dining Out");
        spend_on(&store, account, "2026-08-02", "Kroger", "95.00", "Groceries");

        let rows = store.category_spending_by_month(2026, 7, 2026, 8).unwrap();

        assert_eq!(month_cell(&rows, "2026-07", "Groceries"), Some(dec("120.00")));
        assert_eq!(month_cell(&rows, "2026-07", "Dining Out"), Some(dec("12.50")));
        assert_eq!(month_cell(&rows, "2026-08", "Groceries"), Some(dec("95.00")));
        assert_eq!(
            month_cell(&rows, "2026-08", "Dining Out"),
            None,
            "a category with no spend that month has no row"
        );
    }

    #[test]
    fn category_spending_stays_inside_the_range_including_across_a_year_end() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        spend_on(&store, account, "2025-11-30", "Too early", "10.00", "Groceries");
        spend_on(&store, account, "2025-12-15", "In", "20.00", "Groceries");
        spend_on(&store, account, "2026-01-31", "Also in", "30.00", "Groceries");
        spend_on(&store, account, "2026-02-01", "Too late", "40.00", "Groceries");

        let rows = store.category_spending_by_month(2025, 12, 2026, 1).unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(month_cell(&rows, "2025-12", "Groceries"), Some(dec("20.00")));
        assert_eq!(month_cell(&rows, "2026-01", "Groceries"), Some(dec("30.00")));
    }

    #[test]
    fn category_spending_ignores_income_transfers_and_deleted_rows_and_lists_uncategorized_spend() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-08-01", "Paycheck", "2000.00"),
                    tx("2026-08-02", "To Savings", "-500.00"),
                    tx("2026-08-03", "Gone", "-15.00"),
                    tx("2026-08-04", "Mystery", "-22.00"),
                ],
            )
            .unwrap();
        store
            .set_category(id_of(&store, "To Savings", "2026-08-02"), "Transfer", CategorySource::User, None)
            .unwrap();
        store.delete_transaction(id_of(&store, "Gone", "2026-08-03"), test_now()).unwrap();

        let rows = store.category_spending_by_month(2026, 8, 2026, 8).unwrap();

        assert_eq!(rows.len(), 1, "only the uncategorized spend is left: {rows:?}");
        assert_eq!(month_cell(&rows, "2026-08", "Uncategorized"), Some(dec("22.00")));
    }

    #[test]
    fn category_spending_counts_a_split_purchase_through_its_lines() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-05", "Costco", "-100.00")]).unwrap();
        let costco = id_of(&store, "Costco", "2026-08-05");
        store.set_category(costco, "Groceries", CategorySource::User, None).unwrap();
        store
            .set_transaction_splits(
                costco,
                &[
                    ("Groceries".to_string(), dec("-60.00"), None),
                    ("Household".to_string(), dec("-40.00"), None),
                ],
            )
            .unwrap();

        let rows = store.category_spending_by_month(2026, 8, 2026, 8).unwrap();

        assert_eq!(month_cell(&rows, "2026-08", "Groceries"), Some(dec("60.00")));
        assert_eq!(month_cell(&rows, "2026-08", "Household"), Some(dec("40.00")));
    }

    // ---- Phase 2 / 18: background bill reminders ----

    fn bill(store: &Store, merchant: &str, amount: &str, anchor: &str) -> i64 {
        store.create_recurring(merchant, None, dec(amount), "monthly", day(anchor), None).unwrap()
    }

    fn reminder_names(store: &Store, today: &str, window: i64) -> Vec<String> {
        store
            .reminders_to_send(day(today), window)
            .unwrap()
            .into_iter()
            .map(|r| r.merchant)
            .collect()
    }

    #[test]
    fn reminders_cover_bills_due_within_the_window_and_nothing_further_out() {
        let store = Store::open_in_memory().unwrap();
        bill(&store, "Geico Auto", "-120.00", "2026-09-20"); // due in 2 days
        bill(&store, "Netflix", "-15.49", "2026-09-30"); // 12 days
        bill(&store, "Rent", "-1200.00", "2026-09-18"); // today

        assert_eq!(reminder_names(&store, "2026-09-18", 3), vec!["Rent", "Geico Auto"]);
    }

    #[test]
    fn income_and_canceled_items_are_never_reminded() {
        let store = Store::open_in_memory().unwrap();
        bill(&store, "Payroll", "3000.00", "2026-09-19");
        let gym = bill(&store, "Old Gym", "-30.00", "2026-09-19");
        store.set_recurring_status(gym, "canceled").unwrap();

        assert!(reminder_names(&store, "2026-09-18", 3).is_empty());
    }

    #[test]
    fn a_reminder_is_sent_once_per_due_date_and_returns_for_the_next_cycle() {
        let store = Store::open_in_memory().unwrap();
        let id = bill(&store, "Geico Auto", "-120.00", "2026-09-20");
        assert_eq!(reminder_names(&store, "2026-09-18", 3), vec!["Geico Auto"]);

        store.mark_reminder_sent(id, day("2026-09-20"), day("2026-09-18")).unwrap();

        assert!(reminder_names(&store, "2026-09-18", 3).is_empty());
        assert!(reminder_names(&store, "2026-09-19", 3).is_empty(), "still the same due date");
        // A month later the next due date is a fresh reminder.
        assert_eq!(reminder_names(&store, "2026-10-18", 3), vec!["Geico Auto"]);
    }

    #[test]
    fn a_bill_due_today_that_has_already_posted_is_not_reminded() {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        bill(&store, "Netflix", "-15.49", "2026-08-18");
        store
            .save_transactions(
                account,
                &[tx("2026-08-18", "NETFLIX.COM", "-15.49"), tx("2026-09-18", "NETFLIX.COM", "-15.49")],
            )
            .unwrap();

        assert!(reminder_names(&store, "2026-09-18", 3).is_empty());
    }

    #[test]
    fn a_zero_day_window_reminds_only_about_bills_due_today() {
        let store = Store::open_in_memory().unwrap();
        bill(&store, "Rent", "-1200.00", "2026-09-18");
        bill(&store, "Geico Auto", "-120.00", "2026-09-19");

        assert_eq!(reminder_names(&store, "2026-09-18", 0), vec!["Rent"]);
    }

    #[test]
    fn a_reminder_carries_what_the_notification_needs() {
        let store = Store::open_in_memory().unwrap();
        let id = bill(&store, "Geico Auto", "-120.00", "2026-09-20");

        let reminders = store.reminders_to_send(day("2026-09-18"), 3).unwrap();

        assert_eq!(reminders.len(), 1);
        assert_eq!(reminders[0].recurring_id, id);
        assert_eq!(reminders[0].amount, dec("-120.00"));
        assert_eq!(reminders[0].due_date, day("2026-09-20"));
    }

    #[test]
    fn background_settings_start_off_and_are_set_independently() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(
            store.get_background_settings().unwrap(),
            BackgroundSettings {
                tray_enabled: false,
                autostart_enabled: false
            }
        );

        store.set_tray_enabled(true).unwrap();
        assert_eq!(
            store.get_background_settings().unwrap(),
            BackgroundSettings {
                tray_enabled: true,
                autostart_enabled: false
            }
        );

        store.set_autostart_enabled(true).unwrap();
        store.set_tray_enabled(false).unwrap();
        assert_eq!(
            store.get_background_settings().unwrap(),
            BackgroundSettings {
                tray_enabled: false,
                autostart_enabled: true
            }
        );
    }

    #[test]
    fn background_settings_leave_the_feature_toggles_alone() {
        let store = Store::open_in_memory().unwrap();
        store.set_envelope_caps_enabled(false).unwrap();

        store.set_tray_enabled(true).unwrap();

        assert!(!store.get_app_settings().unwrap().envelope_caps_enabled);
    }
}
