//! What the person has locally for each comparison, reduced to one confirmed number with its
//! contributors. Pure functions over a plain `Snapshot` and the saved `ComparisonSetup`: nothing
//! here touches the database, so every rule (ownership shares, classification, completeness,
//! manual totals, staleness) is testable on its own.
//!
//! The central rule is that a figure is only ever *confirmed* by the person, never assumed: a
//! derived total with unallocated shares, unclassified accounts, missing months or no confirmation
//! reports a completeness other than `Confirmed`, which keeps the card from making a confident
//! comparison.
use super::setup::{ComparisonSetup, DebtClass, HouseholdIncomeMethod, InvestmentClass, ManualAmount, PersonRef, SourceRef};
use super::types::{Completeness, MetricId, PeriodKind, Unit, ValuePeriod, money_str};
use crate::models::AccountType;
use chrono::{Datelike, Duration, Months, NaiveDate};
use rust_decimal::{Decimal, RoundingStrategy};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

const AWAY: RoundingStrategy = RoundingStrategy::MidpointAwayFromZero;
const BASIS_POINTS: u32 = 10_000;
pub const FLOW_STALE_MONTHS: u32 = 12;
pub const BALANCE_STALE_DAYS: i64 = 90;

// -------------------------------------------------------------------------------- snapshot

/// One account as the comparisons see it. `balance` is the store's `current_balance`: the literal
/// balance for cash, investment (holdings value when it has holdings, so it counts once) and other
/// accounts; available credit for a card; and what is owed for a loan.
#[derive(Debug, Clone, PartialEq)]
pub struct AccountSnap {
    pub id: i64,
    pub name: String,
    pub kind: AccountType,
    pub starting_balance: Decimal,
    pub balance: Decimal,
}

impl AccountSnap {
    /// Amount owed, never below zero: an overpaid card is not negative debt.
    pub fn owed(&self) -> Decimal {
        let owed = match self.kind {
            AccountType::Credit => self.starting_balance - self.balance,
            AccountType::Loan => self.balance,
            _ => Decimal::ZERO,
        };
        owed.max(Decimal::ZERO)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AssetSnap {
    pub id: i64,
    pub name: String,
    pub value: Decimal,
    pub valued_on: NaiveDate,
}

/// One expense (positive) under the ledger's own spending rules: transfers, generated debt-payment
/// rows and deleted rows are already left out, and a split purchase appears as its lines.
#[derive(Debug, Clone, PartialEq)]
pub struct SpendRow {
    pub account_id: i64,
    pub date: NaiveDate,
    pub amount: Decimal,
}

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub today: NaiveDate,
    pub accounts: Vec<AccountSnap>,
    pub assets: Vec<AssetSnap>,
    pub spend_rows: Vec<SpendRow>,
    /// The earliest transaction date in the whole profile (any account).
    pub first_transaction_date: Option<NaiveDate>,
}

// ------------------------------------------------------------------------------------ result

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExcludeReason {
    /// Its account type does not count toward this comparison by default.
    DefaultTypeNotIncluded,
    UserExcluded,
    /// The person has not been allocated a share, or someone else owns it.
    NotAllocated,
    /// An investment account with no comparison classification yet.
    Unclassified,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contributor {
    pub label: String,
    pub source: Option<SourceRef>,
    #[serde(with = "money_str")]
    pub gross: Decimal,
    pub share_basis_points: u32,
    /// What this source adds to the total (gross x share).
    #[serde(with = "money_str")]
    pub counted: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Excluded {
    pub label: String,
    pub source: Option<SourceRef>,
    pub reason: ExcludeReason,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Origin {
    Derived,
    /// Typed by the person; stays active until removed. `stale` only warns.
    Entered {
        measured_on: String,
        explanation: String,
        stale: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Note {
    pub code: String,
    pub detail: String,
}

fn note(code: &str, detail: impl Into<String>) -> Note {
    Note {
        code: code.into(),
        detail: detail.into(),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricComputation {
    pub metric: MetricId,
    #[serde(with = "super::types::money_str_opt")]
    pub value: Option<Decimal>,
    pub unit: Unit,
    /// Whether the person actually holds the asset/debt (a zero balance does not).
    pub holds_item: bool,
    pub completeness: Completeness,
    pub period: Option<ValuePeriod>,
    pub origin: Origin,
    pub contributors: Vec<Contributor>,
    pub excluded: Vec<Excluded>,
    /// Money in shared sources that nobody has been allocated.
    #[serde(with = "money_str")]
    pub unallocated: Decimal,
    /// What tracked data alone adds up to, kept visible when a typed total replaces it.
    #[serde(with = "super::types::money_str_opt")]
    pub tracked_value: Option<Decimal>,
    /// Investments by comparison class, or debt by debt type.
    #[serde(serialize_with = "super::types::money_map::serialize")]
    pub class_totals: BTreeMap<String, Decimal>,
    pub notes: Vec<Note>,
}

impl MetricComputation {
    fn new(metric: MetricId) -> Self {
        let unit = match metric {
            MetricId::Income | MetricId::Spending => Unit::UsdPerYear,
            _ => Unit::UsdBalance,
        };
        MetricComputation {
            metric,
            value: None,
            unit,
            holds_item: false,
            completeness: Completeness::Unknown,
            period: None,
            origin: Origin::Derived,
            contributors: Vec::new(),
            excluded: Vec::new(),
            unallocated: Decimal::ZERO,
            tracked_value: None,
            class_totals: BTreeMap::new(),
            notes: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------------- shares

struct Share {
    counted_bp: u32,
    unallocated_bp: u32,
}

/// How much of one source counts for the household, from the person's confirmed allocations. With no
/// allocation the household owns it outright; a share given to someone outside the household (a
/// roommate) is left out, and a share nobody was given is reported, never guessed.
fn share_of(setup: &ComparisonSetup, source: &SourceRef) -> Share {
    let allocs: Vec<_> = setup.allocations.iter().filter(|a| &a.source == source).collect();
    if allocs.is_empty() {
        return Share {
            counted_bp: BASIS_POINTS,
            unallocated_bp: 0,
        };
    }
    let in_household: BTreeSet<&PersonRef> = setup.people.iter().filter(|p| p.in_household).map(|p| &p.person).collect();
    let total: u32 = allocs.iter().map(|a| a.basis_points).sum();
    let counted_bp = allocs.iter().filter(|a| in_household.contains(&a.person)).map(|a| a.basis_points).sum();
    Share {
        counted_bp,
        unallocated_bp: BASIS_POINTS.saturating_sub(total),
    }
}

fn portion(amount: Decimal, bp: u32) -> Decimal {
    (amount * Decimal::from(bp) / Decimal::from(BASIS_POINTS)).round_dp_with_strategy(2, AWAY)
}

/// Adds `gross` of `source` to the running totals, applying ownership shares. Returns the counted amount.
fn count_source(out: &mut MetricComputation, setup: &ComparisonSetup, label: &str, source: SourceRef, gross: Decimal, partial: &mut bool) -> Decimal {
    let share = share_of(setup, &source);
    if share.unallocated_bp > 0 {
        out.unallocated += portion(gross, share.unallocated_bp);
        *partial = true;
    }
    if share.counted_bp == 0 {
        out.excluded.push(Excluded {
            label: label.into(),
            source: Some(source),
            reason: ExcludeReason::NotAllocated,
        });
        return Decimal::ZERO;
    }
    let counted = portion(gross, share.counted_bp);
    out.contributors.push(Contributor {
        label: label.into(),
        source: Some(source),
        gross,
        share_basis_points: share.counted_bp,
        counted,
    });
    counted
}

// ---------------------------------------------------------------------------------- helpers

fn confirmed_by_person(setup: &ComparisonSetup, metric: MetricId) -> bool {
    setup.balance_confirmations.iter().any(|c| c.metric == metric)
}

fn balance_completeness(setup: &ComparisonSetup, metric: MetricId, partial: bool) -> Completeness {
    // Partial coverage is only worth reporting once the person has said the figure is complete; until
    // then it is simply not confirmed, and the card waits like any other missing input.
    match (confirmed_by_person(setup, metric), partial) {
        (true, true) => Completeness::Partial,
        (true, false) => Completeness::Confirmed,
        (false, _) => Completeness::Unknown,
    }
}

fn parse_date(text: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(text, "%Y-%m-%d").ok()
}

/// Warning-only: income and spending go stale after a year, balances after 90 days.
fn is_stale(metric: MetricId, measured_on: &str, today: NaiveDate) -> bool {
    let Some(date) = parse_date(measured_on) else { return true };
    match metric {
        MetricId::Income | MetricId::Spending => today.checked_sub_months(Months::new(FLOW_STALE_MONTHS)).is_some_and(|limit| date < limit),
        _ => date < today - Duration::days(BALANCE_STALE_DAYS),
    }
}

fn entered(metric: MetricId, amount: &ManualAmount, today: NaiveDate) -> Origin {
    Origin::Entered {
        measured_on: amount.measured_on.clone(),
        explanation: amount.explanation.clone(),
        stale: is_stale(metric, &amount.measured_on, today),
    }
}

fn stock_period(today: NaiveDate) -> ValuePeriod {
    ValuePeriod {
        kind: PeriodKind::Stock,
        from: today.to_string(),
        to: today.to_string(),
    }
}

// ---------------------------------------------------------------------------------- metrics

fn savings(snap: &Snapshot, setup: &ComparisonSetup) -> MetricComputation {
    let mut out = MetricComputation::new(MetricId::Savings);
    let mut partial = false;
    let mut total = Decimal::ZERO;
    for a in &snap.accounts {
        let source = SourceRef::Account { id: a.id };
        let over = setup.savings_overrides.iter().find(|o| o.source == source).map(|o| o.include);
        let by_default = matches!(a.kind, AccountType::Checking | AccountType::Savings);
        let included = match a.kind {
            AccountType::Credit | AccountType::Loan => false,
            _ => over.unwrap_or(by_default),
        };
        if !included {
            let reason = if over == Some(false) {
                ExcludeReason::UserExcluded
            } else {
                ExcludeReason::DefaultTypeNotIncluded
            };
            out.excluded.push(Excluded {
                label: a.name.clone(),
                source: Some(source),
                reason,
            });
            continue;
        }
        total += count_source(&mut out, setup, &a.name, source, a.balance, &mut partial);
    }
    out.value = Some(total);
    out.holds_item = total > Decimal::ZERO;
    out.completeness = balance_completeness(setup, MetricId::Savings, partial);
    out.period = Some(stock_period(snap.today));
    out
}

fn investments(snap: &Snapshot, setup: &ComparisonSetup) -> MetricComputation {
    let mut out = MetricComputation::new(MetricId::Investments);
    let mut partial = false;
    let class_of = |source: &SourceRef| setup.investment_classes.iter().find(|c| &c.source == source).map(|c| c.class);
    let key = |c: InvestmentClass| match c {
        InvestmentClass::Retirement => "retirement",
        InvestmentClass::Taxable => "taxable",
        InvestmentClass::Education => "education",
        InvestmentClass::Other => "other",
        InvestmentClass::Exclude => "exclude",
    };
    let mut items: Vec<(String, SourceRef, Decimal, bool, Option<NaiveDate>)> = Vec::new();
    for a in snap.accounts.iter().filter(|a| a.kind == AccountType::Investment) {
        items.push((a.name.clone(), SourceRef::Account { id: a.id }, a.balance, true, None));
    }
    for a in &snap.assets {
        items.push((a.name.clone(), SourceRef::Asset { id: a.id }, a.value, false, Some(a.valued_on)));
    }
    for (label, source, gross, is_investment_account, valued_on) in items {
        match class_of(&source) {
            None if is_investment_account => {
                partial = true;
                out.excluded.push(Excluded {
                    label,
                    source: Some(source),
                    reason: ExcludeReason::Unclassified,
                });
                out.notes.push(note(
                    "unclassified_investment",
                    "An investment account has no comparison classification yet.",
                ));
            }
            None => {} // A plain asset is not an investment unless the person says so.
            Some(InvestmentClass::Exclude) => {
                out.excluded.push(Excluded {
                    label,
                    source: Some(source),
                    reason: ExcludeReason::UserExcluded,
                });
            }
            Some(class) => {
                if let Some(date) = valued_on
                    && date < snap.today - Duration::days(BALANCE_STALE_DAYS)
                {
                    out.notes.push(note("stale_valuation", format!("{label} was last valued on {date}.")));
                }
                let counted = count_source(&mut out, setup, &label, source, gross, &mut partial);
                *out.class_totals.entry(key(class).to_string()).or_default() += counted;
            }
        }
    }
    let retirement = out.class_totals.get("retirement").copied().unwrap_or(Decimal::ZERO);
    out.value = Some(retirement);
    out.holds_item = retirement > Decimal::ZERO;
    out.completeness = balance_completeness(setup, MetricId::Investments, partial);
    out.period = Some(stock_period(snap.today));
    out
}

fn debt(snap: &Snapshot, setup: &ComparisonSetup) -> MetricComputation {
    let mut out = MetricComputation::new(MetricId::Debt);
    let mut partial = false;
    let mut total = Decimal::ZERO;
    for a in snap.accounts.iter().filter(|a| matches!(a.kind, AccountType::Credit | AccountType::Loan)) {
        let source = SourceRef::Account { id: a.id };
        if setup.debt_exclusions.contains(&source) {
            out.excluded.push(Excluded {
                label: a.name.clone(),
                source: Some(source),
                reason: ExcludeReason::UserExcluded,
            });
            continue;
        }
        let counted = count_source(&mut out, setup, &a.name, source.clone(), a.owed(), &mut partial);
        total += counted;
        let class = setup.debt_classes.iter().find(|c| c.source == source).map(|c| c.class);
        let key = match (class, a.kind) {
            (Some(DebtClass::Mortgage), _) => "mortgage",
            (Some(DebtClass::CreditCard), _) | (None, AccountType::Credit) => "credit_card",
            (Some(DebtClass::StudentLoan), _) => "student_loan",
            (Some(DebtClass::Vehicle), _) => "vehicle",
            (Some(DebtClass::Other), _) => "other",
            (None, _) => "unclassified",
        };
        if key == "unclassified" {
            out.notes.push(note(
                "unclassified_debt",
                format!("{} has no debt type, so it only counts toward total debt.", a.name),
            ));
        }
        *out.class_totals.entry(key.to_string()).or_default() += counted;
    }
    out.value = Some(total);
    out.holds_item = total > Decimal::ZERO;
    out.completeness = balance_completeness(setup, MetricId::Debt, partial);
    out.period = Some(stock_period(snap.today));
    out
}

fn income(snap: &Snapshot, setup: &ComparisonSetup) -> MetricComputation {
    let mut out = MetricComputation::new(MetricId::Income);
    match setup.income.household_method {
        HouseholdIncomeMethod::Total => {
            if let Some(a) = &setup.income.household_total {
                out.value = Some(a.value);
                out.origin = entered(MetricId::Income, a, snap.today);
                out.completeness = Completeness::Confirmed;
            }
        }
        HouseholdIncomeMethod::ByPerson => {
            let members: Vec<&PersonRef> = setup.people.iter().filter(|p| p.in_household).map(|p| &p.person).collect();
            let entries: Vec<_> = setup.income.per_person.iter().filter(|e| members.contains(&&e.person)).collect();
            if !entries.is_empty() {
                out.value = Some(entries.iter().map(|e| e.gross_annual.value).sum());
                let oldest = entries.iter().min_by_key(|e| e.gross_annual.measured_on.clone()).expect("non-empty");
                out.origin = entered(MetricId::Income, &oldest.gross_annual, snap.today);
                out.completeness = if members.iter().all(|m| entries.iter().any(|e| &&e.person == m)) {
                    Completeness::Confirmed
                } else {
                    Completeness::Partial
                };
            }
        }
    }
    out.holds_item = out.value.is_some();
    out
}

/// The 12 completed calendar months before `today`.
fn default_spending_window(today: NaiveDate) -> (NaiveDate, NaiveDate) {
    let this_month = today.with_day(1).expect("day 1 exists");
    let start = this_month.checked_sub_months(Months::new(12)).expect("date in range");
    (start, this_month - Duration::days(1))
}

/// The period spending is measured over: the person's chosen period, else the 12 completed months.
pub fn spending_window(setup: &ComparisonSetup, today: NaiveDate) -> (NaiveDate, NaiveDate) {
    let default = default_spending_window(today);
    match &setup.spending.period {
        Some(p) => (parse_date(&p.from).unwrap_or(default.0), parse_date(&p.to).unwrap_or(default.1)),
        None => default,
    }
}

fn months_between(from: NaiveDate, to: NaiveDate) -> Vec<String> {
    let mut months = Vec::new();
    let mut cursor = from.with_day(1).expect("day 1 exists");
    while cursor <= to {
        months.push(cursor.format("%Y-%m").to_string());
        cursor = cursor.checked_add_months(Months::new(1)).expect("date in range");
    }
    months
}

fn spending(snap: &Snapshot, setup: &ComparisonSetup) -> MetricComputation {
    let mut out = MetricComputation::new(MetricId::Spending);
    let (from, to) = spending_window(setup, snap.today);
    let months = months_between(from, to);
    out.period = Some(ValuePeriod {
        kind: PeriodKind::Flow,
        from: from.to_string(),
        to: to.to_string(),
    });

    let selected: Vec<&AccountSnap> = if setup.spending.account_ids.is_empty() {
        snap.accounts
            .iter()
            .filter(|a| matches!(a.kind, AccountType::Checking | AccountType::Savings | AccountType::Credit))
            .collect()
    } else {
        snap.accounts.iter().filter(|a| setup.spending.account_ids.contains(&a.id)).collect()
    };
    let in_window: Vec<&SpendRow> = snap
        .spend_rows
        .iter()
        .filter(|r| r.date >= from && r.date <= to && selected.iter().any(|a| a.id == r.account_id))
        .collect();

    if months.len() < 12 {
        out.notes.push(note(
            "fewer_than_12_months",
            "The period is shorter than 12 months, so it is not annualised.",
        ));
    } else if snap.first_transaction_date.is_none_or(|first| first.with_day(1) > from.with_day(1)) {
        out.notes.push(note(
            "fewer_than_12_months",
            "There are fewer than 12 completed months of history; it is not annualised.",
        ));
    } else {
        let present: BTreeSet<String> = in_window.iter().map(|r| r.date.format("%Y-%m").to_string()).collect();
        let missing: Vec<&String> = months.iter().filter(|m| !present.contains(*m)).collect();
        if missing.is_empty() {
            let total: Decimal = in_window.iter().map(|r| r.amount).sum();
            let scaled = (total * Decimal::from(12) / Decimal::from(months.len() as u32)).round_dp_with_strategy(2, AWAY);
            out.value = Some(scaled);
            for a in &selected {
                let part: Decimal = in_window.iter().filter(|r| r.account_id == a.id).map(|r| r.amount).sum();
                if part > Decimal::ZERO {
                    out.contributors.push(Contributor {
                        label: a.name.clone(),
                        source: Some(SourceRef::Account { id: a.id }),
                        gross: part,
                        share_basis_points: BASIS_POINTS,
                        counted: part,
                    });
                }
            }
            out.completeness = if setup.spending.completeness_confirmed {
                Completeness::Confirmed
            } else {
                Completeness::Unknown
            };
        } else {
            let names: Vec<&str> = missing.iter().map(|m| m.as_str()).collect();
            out.notes
                .push(note("missing_months", format!("No spending was found in: {}.", names.join(", "))));
        }
    }
    out.holds_item = out.value.is_some();
    out
}

fn derive(snap: &Snapshot, setup: &ComparisonSetup, metric: MetricId) -> MetricComputation {
    match metric {
        MetricId::Spending => spending(snap, setup),
        MetricId::Investments => investments(snap, setup),
        MetricId::Income => income(snap, setup),
        MetricId::Savings => savings(snap, setup),
        MetricId::Debt => debt(snap, setup),
    }
}

/// The metric as it should be compared: a typed total replaces the derived one when present
/// (annual spending's typed figure is `spending.manual_annual`), and the tracked value stays visible.
pub fn compute_metric(snap: &Snapshot, setup: &ComparisonSetup, metric: MetricId) -> MetricComputation {
    let mut out = derive(snap, setup, metric);
    let typed: Option<&ManualAmount> =
        setup
            .manual_overrides
            .iter()
            .find(|o| o.metric == metric)
            .map(|o| &o.amount)
            .or(if metric == MetricId::Spending {
                setup.spending.manual_annual.as_ref()
            } else {
                None
            });
    if let Some(amount) = typed {
        out.tracked_value = out.value;
        out.value = Some(amount.value);
        out.origin = entered(metric, amount, snap.today);
        out.completeness = Completeness::Confirmed;
        out.holds_item = match metric {
            MetricId::Income | MetricId::Spending => true,
            _ => amount.value > Decimal::ZERO,
        };
    }
    out
}

pub fn compute_metrics(snap: &Snapshot, setup: &ComparisonSetup) -> Vec<MetricComputation> {
    MetricId::ALL.iter().map(|m| compute_metric(snap, setup, *m)).collect()
}
