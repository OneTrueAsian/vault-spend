//! Exact, read-only spending primitives for Ask the Vault. No question text or SQL is accepted.
use super::{Store, LIVE_TRANSFER_LEG_IDS_SQL};
use chrono::{Datelike, Months, NaiveDate};
use rusqlite::params;
use rust_decimal::Decimal;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

#[derive(Debug, Clone)]
pub struct AskSpendThreshold {
    pub amount: Decimal,
    pub inclusive: bool,
}
/// How a total is split into lines. Only with one period; `Member` cannot be combined with an average.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AskGroupBy {
    #[default]
    None,
    Month,
    Member,
}
/// An average over the answer's own numbers: money per distinct purchase, or per complete calendar month.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AskAverageKind {
    #[default]
    None,
    PerPurchase,
    PerMonth,
}
/// How a comparison's second range relates to the first. The aligned modes require exactly the aligned range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AskAlignment {
    #[default]
    AsRequested,
    SameDaysPreviousMonth,
    SameDaysPreviousYear,
}
/// Whether a calendar month can be trusted as a whole month of spending. Only `Complete` months enter an average.
/// The evidence is the records of the accounts that hold matching purchases, never the first transaction date of the ledger.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AskMonthCoverage {
    Complete,
    InProgress,
    PartialPeriod,
    PartlyRecorded,
    BeforeRecords,
    NoRecords,
    RecordsEnd,
}
impl AskMonthCoverage {
    /// The exact word the reply contract uses.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::InProgress => "in-progress",
            Self::PartialPeriod => "partial-period",
            Self::PartlyRecorded => "partly-recorded",
            Self::BeforeRecords => "before-records",
            Self::NoRecords => "no-records",
            Self::RecordsEnd => "records-end",
        }
    }
}
#[derive(Debug, Clone)]
pub struct AskSpendFilter {
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// Empty means all accounts; otherwise exact identifiers, never fuzzy names.
    pub account_ids: Vec<i64>,
    /// Empty means all categories, including uncategorized allocations.
    pub categories: Vec<String>,
    /// Applied to the absolute parent amount, before selecting category allocations.
    pub minimum_purchase: Option<AskSpendThreshold>,
    /// Stores or payees as typed; a purchase counts when any term matches its description (see `vendor_term`).
    /// Empty means every store. Each purchase is credited to the first term it matches.
    pub vendors: Vec<String>,
    /// Purchases matching any of these terms are left out and reported in `left_out`.
    pub exclude_vendors: Vec<String>,
    /// Allocations in these categories are left out and reported in `left_out`.
    pub exclude_categories: Vec<String>,
    pub limit: usize,
    /// Family members chosen by exact id (an OR). With `include_unassigned` false and this empty, everyone counts.
    pub member_ids: Vec<i64>,
    /// Adds purchases that carry no family member to the chosen members.
    pub include_unassigned: bool,
    pub group_by: AskGroupBy,
    pub average: AskAverageKind,
    /// The app-owned local date: months that are not over yet, and the end of recorded history, are judged against it.
    pub as_of: NaiveDate,
}
impl Default for AskSpendFilter {
    /// Everything off: all accounts, categories, stores and members, no grouping and no average, one result.
    /// `from`, `to` and `as_of` start at 1970-01-01 and are meant to be set.
    fn default() -> Self {
        let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).expect("valid date");
        Self {
            from: epoch,
            to: epoch,
            account_ids: Vec::new(),
            categories: Vec::new(),
            minimum_purchase: None,
            vendors: Vec::new(),
            exclude_vendors: Vec::new(),
            exclude_categories: Vec::new(),
            limit: 1,
            member_ids: Vec::new(),
            include_unassigned: false,
            group_by: AskGroupBy::None,
            average: AskAverageKind::None,
            as_of: epoch,
        }
    }
}
/// One line per chosen category, in the order asked. Totals add to the period total; counts may overlap (a split purchase).
#[derive(Debug, Clone, PartialEq)]
pub struct AskCategoryTotal {
    pub category: String,
    pub total: Decimal,
    pub purchase_count: usize,
}
/// `member_id` None is the line for purchases with no family member. Totals and counts both add to the period's.
#[derive(Debug, Clone, PartialEq)]
pub struct AskMemberTotal {
    pub member_id: Option<i64>,
    pub name: Option<String>,
    pub total: Decimal,
    pub purchase_count: usize,
}
/// One calendar month the range touches. Empty months are present, with zero and a count of 0.
#[derive(Debug, Clone, PartialEq)]
pub struct AskMonthSpend {
    /// "YYYY-MM".
    pub month: String,
    /// The part of the month that lies inside the range.
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub day_count: i64,
    pub coverage: AskMonthCoverage,
    /// Records of any kind in the accounts the question covers, dated inside `from..=to`, `as_of` at most.
    pub record_count: usize,
    pub total: Decimal,
    pub purchase_count: usize,
}
/// An average with the exact numbers it comes from. `value` is None exactly when `unavailable` is set; never a made-up zero.
#[derive(Debug, Clone, PartialEq)]
pub struct AskAverageResult {
    pub numerator: Decimal,
    pub denominator: usize,
    /// Rounded half away from zero to the cent.
    pub value: Option<Decimal>,
    /// "no-purchases" or "no-complete-months".
    pub unavailable: Option<&'static str>,
    pub months_used: Vec<String>,
    pub months_left_out: Vec<(String, AskMonthCoverage)>,
}
/// The comparison facts for two already-totalled ranges (see `ask_comparison`).
#[derive(Debug, Clone, PartialEq)]
pub struct AskComparisonResult {
    /// True only when both ranges have the same number of days.
    pub comparable: bool,
    /// "unequal-lengths" or "clamped" when not comparable.
    pub not_comparable_reason: Option<&'static str>,
    pub elapsed_days: i64,
    /// (requested days, days used) when the earlier month or year was shorter and the range stopped at its last day.
    pub clamped: Option<(i64, i64)>,
    /// First total minus second, exact.
    pub absolute_change: Decimal,
    /// One decimal place; present only for "changed" and "no-change".
    pub percent_change: Option<Decimal>,
    /// "changed", "no-change", "from-zero" or "not-comparable".
    pub percent_outcome: &'static str,
}
const MAX_MONTH_ROWS: i32 = 50;
fn days_between(first: NaiveDate, last: NaiveDate) -> i64 {
    (last - first).num_days() + 1
}
fn last_day_of(year: i32, month: u32) -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt(year, month, 1)?.checked_add_months(Months::new(1))?.pred_opt()
}
/// The earlier range an alignment asks for, with the days requested and used when it had to stop at a shorter month's end.
/// None when the first range has the wrong shape for the alignment (or none is asked for).
type DayRange = (NaiveDate, NaiveDate);
/// Days requested and days used, when a shorter month or year made the earlier range stop early.
type Clamp = Option<(i64, i64)>;
/// Per-month totals and distinct purchase counts, keyed "YYYY-MM".
type MonthTotals = BTreeMap<String, (Decimal, usize)>;
/// What one pass over the ledger finds: the answer, the accounts holding a counted purchase, and the month totals.
type Scanned = (AskSpendResult, BTreeSet<i64>, MonthTotals);
fn aligned_prior(first: DayRange, alignment: AskAlignment) -> Option<(DayRange, Clamp)> {
    let (from, to) = first;
    match alignment {
        AskAlignment::AsRequested => None,
        AskAlignment::SameDaysPreviousMonth => {
            if !(from.day() == 1 && from.year() == to.year() && from.month() == to.month()) {
                return None;
            }
            let start = from.checked_sub_months(Months::new(1))?;
            let last = last_day_of(start.year(), start.month())?;
            let day = to.day().min(last.day());
            let end = NaiveDate::from_ymd_opt(start.year(), start.month(), day)?;
            Some(((start, end), (day < to.day()).then_some((i64::from(to.day()), i64::from(day)))))
        }
        AskAlignment::SameDaysPreviousYear => {
            let back = |d: NaiveDate| {
                NaiveDate::from_ymd_opt(d.year() - 1, d.month(), d.day()).or_else(|| NaiveDate::from_ymd_opt(d.year() - 1, d.month(), d.day() - 1))
            };
            let earlier = (back(from)?, back(to)?);
            let (requested, used) = (days_between(from, to), days_between(earlier.0, earlier.1));
            Some((earlier, (used < requested).then_some((requested, used))))
        }
    }
}
/// n / d rounded half away from zero, for d > 0.
fn round_half_away(n: i128, d: i128) -> Option<i128> {
    let magnitude = n.checked_abs()?.checked_mul(2)?.checked_add(d)? / d.checked_mul(2)?;
    Some(if n < 0 { -magnitude } else { magnitude })
}
/// An exact amount divided by a whole number, rounded half away from zero to the cent.
fn average_cents(amount: Decimal, count: usize) -> Option<Decimal> {
    let numerator = amount.mantissa().checked_mul(100)?;
    let denominator = 10i128.checked_pow(amount.scale())?.checked_mul(i128::try_from(count).ok()?)?;
    Some(Decimal::from_i128_with_scale(round_half_away(numerator, denominator)?, 2))
}
/// (first - second) / |second| as a percentage to one decimal, rounded half away from zero. `second` must not be zero.
fn percent_tenths(first: Decimal, second: Decimal) -> Option<Decimal> {
    let change = first.checked_sub(second)?;
    let numerator = change.mantissa().checked_mul(1000)?.checked_mul(10i128.checked_pow(second.scale())?)?;
    let denominator = second.mantissa().checked_abs()?.checked_mul(10i128.checked_pow(change.scale())?)?;
    Some(Decimal::from_i128_with_scale(round_half_away(numerator, denominator)?, 1))
}
/// Checks an aligned comparison and states its facts: the second range must be exactly the alignment of the first, and a percentage is
/// given only for equal lengths and a non-zero baseline. Pure; no ledger access.
pub fn ask_comparison(
    alignment: AskAlignment,
    first: (NaiveDate, NaiveDate),
    second: (NaiveDate, NaiveDate),
    first_total: Decimal,
    second_total: Decimal,
) -> Result<AskComparisonResult, String> {
    let aligned = if alignment == AskAlignment::AsRequested {
        None
    } else {
        let Some(found) = aligned_prior(first, alignment) else {
            return Err("Choose the first range again so it can be compared with the same days before it.".into());
        };
        if found.0 != second {
            return Err("The second range is not the same days before the first.".into());
        }
        Some(found)
    };
    let (elapsed_days, other_days) = (days_between(first.0, first.1), days_between(second.0, second.1));
    let comparable = elapsed_days == other_days;
    let clamped = aligned.and_then(|(_, clamp)| clamp);
    let not_comparable_reason = if comparable {
        None
    } else if clamped.is_some() {
        Some("clamped")
    } else {
        Some("unequal-lengths")
    };
    let too_large = || "These amounts are too large to compare exactly.".to_string();
    let absolute_change = first_total.checked_sub(second_total).ok_or_else(too_large)?;
    let (percent_outcome, percent_change) = if !comparable {
        ("not-comparable", None)
    } else if first_total == second_total {
        ("no-change", Some(Decimal::new(0, 1)))
    } else if second_total.is_zero() {
        ("from-zero", None)
    } else {
        ("changed", Some(percent_tenths(first_total, second_total).ok_or_else(too_large)?))
    };
    Ok(AskComparisonResult {
        comparable,
        not_comparable_reason,
        elapsed_days,
        clamped,
        absolute_change,
        percent_change,
        percent_outcome,
    })
}
/// The one place a month's label is decided; the renderer decides it the same way from the same evidence.
#[allow(clippy::too_many_arguments)]
fn month_coverage(
    start: NaiveDate,
    end: NaiveDate,
    from: NaiveDate,
    to: NaiveDate,
    record_count: usize,
    recorded: Option<(NaiveDate, NaiveDate)>,
    as_of: NaiveDate,
) -> AskMonthCoverage {
    let Some((recorded_from, recorded_through)) = recorded else {
        return AskMonthCoverage::NoRecords;
    };
    if end < recorded_from {
        AskMonthCoverage::BeforeRecords
    } else if recorded_from > start {
        AskMonthCoverage::PartlyRecorded
    } else if end >= as_of {
        AskMonthCoverage::InProgress
    } else if record_count == 0 {
        AskMonthCoverage::NoRecords
    } else if recorded_through <= end {
        AskMonthCoverage::RecordsEnd
    } else if from > start || to < end {
        AskMonthCoverage::PartialPeriod
    } else {
        AskMonthCoverage::Complete
    }
}
#[derive(Debug, Clone, PartialEq)]
pub struct AskCategorySpend {
    /// None is genuinely uncategorized, distinct from a category named "Uncategorized".
    pub category: Option<String>,
    pub amount: Decimal,
    pub purchase_count: usize,
}
#[derive(Debug, Clone, PartialEq)]
pub struct AskPurchaseSpend {
    pub transaction_id: i64,
    pub account_id: i64,
    pub date: String,
    pub description: String,
    /// Eligible negative allocations in the requested category scope, as positive spending.
    pub amount: Decimal,
    pub parent_amount: Decimal,
}
#[derive(Debug, Clone, PartialEq)]
pub struct AskVendorSpend {
    /// The description exactly as recorded, so the person can see what was matched.
    pub description: String,
    pub purchase_count: usize,
}
#[derive(Debug, Clone, PartialEq)]
pub struct AskVendorTotal {
    /// The term as given, so the answer can name it even when nothing matched.
    pub term: String,
    pub total: Decimal,
    pub purchase_count: usize,
}
#[derive(Debug, Clone, PartialEq, Default)]
pub struct AskLeftOut {
    pub total: Decimal,
    pub purchase_count: usize,
    pub vendors: Vec<AskVendorSpend>,
    pub categories: Vec<AskCategorySpend>,
}
#[derive(Debug, Clone, PartialEq)]
pub struct AskSpendResult {
    pub total: Decimal,
    pub purchase_count: usize,
    pub category_count: usize,
    pub categories: Vec<AskCategorySpend>,
    pub purchases: Vec<AskPurchaseSpend>,
    /// The names a vendor term matched, most purchases first (at most 10). Empty without a vendor filter.
    pub vendors: Vec<AskVendorSpend>,
    pub vendor_name_count: usize,
    /// One line per included term, in the order given; the totals add up to `total`. Empty without included stores.
    pub vendor_totals: Vec<AskVendorTotal>,
    /// What the exclusions removed from an otherwise matching answer.
    pub left_out: AskLeftOut,
    /// One line per chosen category (more than one chosen), in the order asked; empty otherwise.
    pub category_totals: Vec<AskCategoryTotal>,
    /// Sum of the category lines' counts minus `purchase_count`: how often a split purchase sits in a second chosen category.
    pub shared_purchase_count: usize,
    /// With `AskGroupBy::Member`: one line per chosen person, or everyone plus the unassigned line; largest first.
    pub member_totals: Vec<AskMemberTotal>,
    /// With `AskGroupBy::Month` or `AskAverageKind::PerMonth`: every calendar month the range touches, in date order.
    pub months: Vec<AskMonthSpend>,
    /// With months: the evidence dates behind the labels (None when no account holds a matching purchase, and without months).
    pub recorded_from: Option<NaiveDate>,
    pub recorded_through: Option<NaiveDate>,
    pub average: Option<AskAverageResult>,
    /// The first recorded transaction date in the whole ledger. Informational only: never proof that a month is recorded.
    pub earliest_record: Option<NaiveDate>,
}
const MAX_VENDOR_NAMES_SHOWN: usize = 10;
const MAX_VENDOR_TERMS: usize = 10;
const MAX_VENDOR_CHARS: usize = 64;
const MAX_VENDOR_WORDS: usize = 6;
/// Lowercase words of a description or term. Apostrophes vanish ("Sam's" is "sams"); every other
/// character that is not a letter or digit separates words.
fn vendor_words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .chars()
        .filter(|c| *c != '\x27' && *c != '’')
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_string)
        .collect()
}
/// The term with its spaces removed, or None when it is empty, one character, or too long.
/// A description matches when the term starts at the beginning of any of its words, with the
/// words read together (so "sams club" finds "SAMSCLUB.COM" and "sam" finds "Sam's Club").
fn vendor_term(raw: &str) -> Option<String> {
    if raw.chars().count() > MAX_VENDOR_CHARS {
        return None;
    }
    let words = vendor_words(raw);
    let term = words.concat();
    (term.chars().count() >= 2 && words.len() <= MAX_VENDOR_WORDS).then_some(term)
}
fn vendor_matches(description: &str, term: &str) -> bool {
    let words = vendor_words(description);
    (0..words.len()).any(|i| words[i..].concat().starts_with(term))
}
fn ranked_names(names: BTreeMap<String, BTreeSet<i64>>) -> Vec<AskVendorSpend> {
    let mut rows: Vec<_> = names
        .into_iter()
        .map(|(description, ids)| AskVendorSpend {
            description,
            purchase_count: ids.len(),
        })
        .collect();
    rows.sort_by(|a, b| b.purchase_count.cmp(&a.purchase_count).then_with(|| a.description.cmp(&b.description)));
    rows.truncate(MAX_VENDOR_NAMES_SHOWN);
    rows
}
fn invalid(message: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.into())
}
fn decimal(value: &str) -> rusqlite::Result<Decimal> {
    Decimal::from_str_exact(value).map_err(|_| invalid("Invalid stored monetary value"))
}
fn add(a: Decimal, b: Decimal) -> rusqlite::Result<Decimal> {
    // checked_add can succeed after reducing scale at Decimal's precision ceiling.
    // Require recovery of both operands so even one lost cent is a refusal.
    a.checked_add(b)
        .filter(|sum| sum.checked_sub(a) == Some(b) && sum.checked_sub(b) == Some(a))
        .ok_or_else(|| invalid("Spending exceeds the exact supported decimal range"))
}
/// What is remembered about a purchase that counts: its text is looked up by number only for the few shown.
struct KeptPurchase {
    account_id: i64,
    date: String,
    number: usize,
    amount: Decimal,
    parent_amount: Decimal,
}
fn conversion(column: usize, error: rusqlite::types::FromSqlError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(column, rusqlite::types::Type::Text, Box::new(error))
}
fn text<'a>(row: &'a rusqlite::Row<'_>, column: usize) -> rusqlite::Result<&'a str> {
    row.get_ref(column)?.as_str().map_err(|e| conversion(column, e))
}
impl AskSpendFilter {
    pub fn validate(&self) -> rusqlite::Result<()> {
        let months = (self.to.year() - self.from.year()) * 12 + self.to.month() as i32 - self.from.month() as i32;
        if self.from > self.to || !(1900..=2100).contains(&self.from.year()) || !(1900..=2100).contains(&self.to.year()) || months >= 1200 {
            return Err(invalid("Choose an ordered date range of at most 1200 months between 1900 and 2100"));
        }
        if !(1..=50).contains(&self.limit) || self.account_ids.len() + self.categories.len() + self.exclude_categories.len() > 20 {
            return Err(invalid("Choose a limit of 1 to 50 and at most 20 selected entities"));
        }
        if self.account_ids.iter().any(|id| *id <= 0 || *id > 9_007_199_254_740_991)
            || self.account_ids.iter().collect::<BTreeSet<_>>().len() != self.account_ids.len()
            || self.categories.iter().any(|name| name.is_empty() || name.chars().count() > 512)
            || self.categories.iter().collect::<BTreeSet<_>>().len() != self.categories.len()
            || self.exclude_categories.iter().any(|name| name.is_empty() || name.chars().count() > 512)
            || self.exclude_categories.iter().collect::<BTreeSet<_>>().len() != self.exclude_categories.len()
            || self.exclude_categories.iter().any(|name| self.categories.contains(name))
        {
            return Err(invalid("Choose valid distinct account identifiers and category names"));
        }
        if self
            .minimum_purchase
            .as_ref()
            .is_some_and(|t| t.amount < Decimal::ZERO || t.amount.scale() > 2)
        {
            return Err(invalid("Use a nonnegative purchase threshold with at most two decimal places"));
        }
        if self.member_ids.iter().any(|id| *id <= 0 || *id > 9_007_199_254_740_991)
            || self.member_ids.iter().collect::<BTreeSet<_>>().len() != self.member_ids.len()
        {
            return Err(invalid("Choose valid distinct family members"));
        }
        if self.account_ids.len() + self.categories.len() + self.exclude_categories.len() + self.member_ids.len() > 20 {
            return Err(invalid("Choose a limit of 1 to 50 and at most 20 selected entities"));
        }
        if self.group_by == AskGroupBy::Member && self.average != AskAverageKind::None {
            return Err(invalid("An average cannot be combined with a split by family member"));
        }
        if self.group_by == AskGroupBy::Month || self.average == AskAverageKind::PerMonth {
            if self.to > self.as_of {
                return Err(invalid("Months can only be shown for a range that ends on or before today"));
            }
            if months >= MAX_MONTH_ROWS {
                return Err(invalid("Choose a shorter range: at most 50 months can be shown"));
            }
        }
        let include: Option<Vec<String>> = self.vendors.iter().map(|v| vendor_term(v)).collect();
        let exclude: Option<Vec<String>> = self.exclude_vendors.iter().map(|v| vendor_term(v)).collect();
        let (Some(include), Some(exclude)) = (include, exclude) else {
            return Err(invalid("Name each store or payee with at least two letters or digits"));
        };
        if include.len() > MAX_VENDOR_TERMS
            || exclude.len() > MAX_VENDOR_TERMS
            || include.iter().collect::<BTreeSet<_>>().len() != include.len()
            || exclude.iter().collect::<BTreeSet<_>>().len() != exclude.len()
            || include.iter().any(|term| exclude.contains(term))
        {
            return Err(invalid(
                "Choose at most ten distinct stores, and do not both include and leave out the same one",
            ));
        }
        Ok(())
    }
}
fn allocation_sql() -> String {
    format!(
        "SELECT t.id, t.account_id, t.date, t.description, t.amount, t.category, t.amount, t.member_id
             FROM transactions t
             WHERE t.date >= ?1 AND t.date <= ?2 AND t.deleted_at IS NULL
               AND t.id NOT IN (SELECT transaction_id FROM transaction_splits)
               AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
               AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
             UNION ALL
             SELECT t.id, t.account_id, t.date, t.description, t.amount, s.category, s.amount, t.member_id
             FROM transaction_splits s JOIN transactions t ON t.id=s.transaction_id
             WHERE t.date >= ?1 AND t.date <= ?2 AND t.deleted_at IS NULL
               AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
               AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})"
    )
}

impl Store {
    /// Fixed household baseline bundle: one eligible-allocation scan, independent category evidence.
    /// Caller owns the coherent read transaction and source revision; this function never writes or caches.
    pub fn ask_baseline_bundle(&self, categories: &[String], as_of: NaiveDate) -> rusqlite::Result<Vec<(String, AskSpendResult)>> {
        if categories.is_empty()
            || categories.len() > 20
            || categories.iter().any(|c| c.trim().is_empty())
            || categories.iter().collect::<HashSet<_>>().len() != categories.len()
        {
            return Err(invalid("Choose between 1 and 20 distinct existing categories"));
        }
        let first = as_of.with_day(1).ok_or_else(|| invalid("Invalid baseline date"))?;
        let from = first.checked_sub_months(Months::new(3)).ok_or_else(|| invalid("Invalid baseline date"))?;
        let to = first.pred_opt().ok_or_else(|| invalid("Invalid baseline date"))?;
        AskSpendFilter {
            from,
            to,
            as_of,
            categories: categories.to_vec(),
            group_by: AskGroupBy::Month,
            ..Default::default()
        }
        .validate()?;
        for name in categories {
            let exists: bool = self
                .conn
                .query_row("SELECT EXISTS(SELECT 1 FROM categories WHERE name=?1)", [name], |r| r.get(0))?;
            if !exists {
                return Err(invalid("A selected category is no longer available"));
            }
        }
        let parse = |text: &str| NaiveDate::parse_from_str(text, "%Y-%m-%d").map_err(|_| invalid("Invalid stored date"));
        let earliest_record = self
            .conn
            .query_row("SELECT MIN(date) FROM transactions WHERE deleted_at IS NULL", [], |r| {
                r.get::<_, Option<String>>(0)
            })?
            .map(|d| parse(&d))
            .transpose()?;
        let earliest = earliest_record
            .unwrap_or(from)
            .min(from)
            .max(as_of.checked_sub_months(Months::new(12 * 99)).unwrap_or(from));
        let index: HashMap<&str, usize> = categories.iter().enumerate().map(|(i, c)| (c.as_str(), i)).collect();
        let mut evidence = vec![BTreeSet::<i64>::new(); categories.len()];
        let mut totals = vec![BTreeMap::<String, (Decimal, HashSet<i64>)>::new(); categories.len()];
        let mut statement = self.conn.prepare(&allocation_sql())?;
        let mut rows = statement.query(params![earliest.to_string(), as_of.to_string()])?;
        while let Some(row) = rows.next()? {
            let category: Option<String> = row.get(5)?;
            let Some(category) = category else { continue };
            if category == "Transfer" {
                continue;
            }
            let Some(&i) = index.get(category.as_str()) else { continue };
            // Same exact native decimal checks as the legacy scan, never SQLite floating-point casts.
            let _parent = decimal(text(row, 4)?)?.abs();
            let amount = decimal(text(row, 6)?)?;
            if amount >= Decimal::ZERO {
                continue;
            }
            let id: i64 = row.get(0)?;
            let account: i64 = row.get(1)?;
            let date = text(row, 2)?;
            evidence[i].insert(account);
            if date >= from.to_string().as_str() && date <= to.to_string().as_str() {
                let month = date.get(..7).ok_or_else(|| invalid("Invalid stored date"))?;
                let entry = totals[i].entry(month.to_string()).or_insert((Decimal::ZERO, HashSet::new()));
                entry.0 = add(entry.0, -amount)?;
                entry.1.insert(id);
            }
        }
        let mut first_last = BTreeMap::new();
        let mut statement = self
            .conn
            .prepare("SELECT account_id,MIN(date),MAX(date) FROM transactions WHERE deleted_at IS NULL AND date<=?1 GROUP BY account_id")?;
        let mut rows = statement.query([as_of.to_string()])?;
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let first: String = row.get(1)?;
            let last: String = row.get(2)?;
            first_last.insert(id, (first, last));
        }
        let mut counts = BTreeMap::new();
        let mut statement = self
            .conn
            .prepare("SELECT substr(date,1,7),COUNT(*) FROM transactions WHERE deleted_at IS NULL AND date>=?1 AND date<=?2 GROUP BY 1")?;
        let mut rows = statement.query(params![from.to_string(), to.to_string()])?;
        while let Some(row) = rows.next()? {
            counts.insert(row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize);
        }
        let mut out = Vec::new();
        for (i, category) in categories.iter().enumerate() {
            let mut recorded: Option<(NaiveDate, NaiveDate)> = None;
            for account in &evidence[i] {
                if let Some((a, b)) = first_last.get(account) {
                    let pair = (parse(a)?, parse(b)?);
                    recorded = Some(recorded.map_or(pair, |(f, t)| (f.max(pair.0), t.min(pair.1))));
                }
            }
            let mut months = Vec::new();
            let mut cursor = from;
            let mut total = Decimal::ZERO;
            let mut purchase_count = 0;
            while cursor <= to {
                let end = last_day_of(cursor.year(), cursor.month()).ok_or_else(|| invalid("Invalid baseline month"))?;
                let key = cursor.format("%Y-%m").to_string();
                let (amount, ids) = totals[i].remove(&key).unwrap_or((Decimal::ZERO, HashSet::new()));
                let record_count = counts.get(&key).copied().unwrap_or(0);
                total = add(total, amount)?;
                purchase_count += ids.len();
                months.push(AskMonthSpend {
                    month: key,
                    from: cursor,
                    to: end,
                    day_count: days_between(cursor, end),
                    coverage: month_coverage(cursor, end, cursor, end, record_count, recorded, as_of),
                    record_count,
                    total: amount,
                    purchase_count: ids.len(),
                });
                cursor = cursor
                    .checked_add_months(Months::new(1))
                    .ok_or_else(|| invalid("Invalid baseline month"))?;
            }
            let used: Vec<_> = months.iter().filter(|m| m.coverage == AskMonthCoverage::Complete).collect();
            let mut numerator = Decimal::ZERO;
            for month in &used {
                numerator = add(numerator, month.total)?;
            }
            let average = AskAverageResult {
                numerator,
                denominator: used.len(),
                value: if used.is_empty() {
                    None
                } else {
                    Some(average_cents(numerator, used.len()).ok_or_else(|| invalid("Average out of range"))?)
                },
                unavailable: used.is_empty().then_some("no-complete-months"),
                months_used: used.iter().map(|m| m.month.clone()).collect(),
                months_left_out: months
                    .iter()
                    .filter(|m| m.coverage != AskMonthCoverage::Complete)
                    .map(|m| (m.month.clone(), m.coverage))
                    .collect(),
            };
            out.push((
                category.clone(),
                AskSpendResult {
                    total,
                    purchase_count,
                    category_count: usize::from(purchase_count > 0),
                    categories: Vec::new(),
                    purchases: Vec::new(),
                    vendors: Vec::new(),
                    vendor_name_count: 0,
                    vendor_totals: Vec::new(),
                    left_out: AskLeftOut::default(),
                    category_totals: Vec::new(),
                    shared_purchase_count: 0,
                    member_totals: Vec::new(),
                    months,
                    recorded_from: recorded.map(|r| r.0),
                    recorded_through: recorded.map(|r| r.1),
                    average: Some(average),
                    earliest_record,
                },
            ));
        }
        Ok(out)
    }
    /// Same gross negative-allocation semantics as Reports' daily/category spending.
    /// Refunds are excluded, not subtracted. Limits affect displayed rankings only.
    pub fn ask_spending(&self, filter: &AskSpendFilter) -> rusqlite::Result<AskSpendResult> {
        let (mut result, period_accounts, month_totals) = self.scan(filter)?;
        if filter.group_by == AskGroupBy::Month || filter.average == AskAverageKind::PerMonth {
            self.add_months(filter, &mut result, period_accounts, month_totals)?;
        }
        Ok(result)
    }
    /// Months, the evidence behind their labels, and the average. `totals` are the per-month totals of this period; the evidence is
    /// wider (every matching purchase up to today): the period's own scan supplies its accounts, and only the days before and after
    /// the period are scanned again, so a question over the whole ledger is read once.
    fn add_months(
        &self,
        filter: &AskSpendFilter,
        result: &mut AskSpendResult,
        period_accounts: BTreeSet<i64>,
        mut totals: BTreeMap<String, (Decimal, usize)>,
    ) -> rusqlite::Result<()> {
        let earliest = result.earliest_record.unwrap_or(filter.from).min(filter.from);
        let earliest = earliest.max(filter.as_of.checked_sub_months(Months::new(12 * 99)).unwrap_or(earliest));
        let mut evidence_accounts = period_accounts;
        let outside = [
            (earliest, filter.from.pred_opt()),
            (filter.to.succ_opt().unwrap_or(filter.as_of), Some(filter.as_of)),
        ];
        for (from, to) in outside {
            let Some(to) = to else { continue };
            if from > to {
                continue;
            }
            let side = AskSpendFilter {
                from,
                to,
                group_by: AskGroupBy::None,
                average: AskAverageKind::None,
                limit: 1,
                ..filter.clone()
            };
            evidence_accounts.extend(self.scan(&side)?.1);
        }
        let mut first_last: BTreeMap<i64, (String, String)> = BTreeMap::new();
        let mut statement = self
            .conn
            .prepare("SELECT account_id, MIN(date), MAX(date) FROM transactions WHERE deleted_at IS NULL AND date <= ?1 GROUP BY account_id")?;
        let mut rows = statement.query(params![filter.as_of.to_string()])?;
        while let Some(row) = rows.next()? {
            first_last.insert(row.get(0)?, (row.get(1)?, row.get(2)?));
        }
        let parse = |text: &str| NaiveDate::parse_from_str(text, "%Y-%m-%d").map_err(|_| invalid("Invalid stored date"));
        let mut recorded: Option<(NaiveDate, NaiveDate)> = None;
        for account in &evidence_accounts {
            if let Some((first, last)) = first_last.get(account) {
                let (first, last) = (parse(first)?, parse(last)?);
                // Latest first record, earliest last record: another account's newer records cannot hide one that has stopped.
                recorded = Some(recorded.map_or((first, last), |(from, through)| (from.max(first), through.min(last))));
            }
        }
        result.recorded_from = recorded.map(|r| r.0);
        result.recorded_through = recorded.map(|r| r.1);
        // "Was anything recorded in this month": records of any kind in every account the question covers.
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        let covered = if filter.account_ids.is_empty() {
            String::new()
        } else {
            format!(
                " AND account_id IN ({})",
                filter.account_ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",")
            )
        };
        let mut statement = self.conn.prepare(&format!(
            "SELECT substr(date, 1, 7), COUNT(*) FROM transactions WHERE deleted_at IS NULL AND date >= ?1 AND date <= ?2{covered} GROUP BY 1"
        ))?;
        let mut rows = statement.query(params![filter.from.to_string(), filter.to.min(filter.as_of).to_string()])?;
        while let Some(row) = rows.next()? {
            counts.insert(row.get(0)?, row.get::<_, i64>(1)? as usize);
        }
        let mut cursor = NaiveDate::from_ymd_opt(filter.from.year(), filter.from.month(), 1).ok_or_else(|| invalid("Invalid date"))?;
        let mut rows_out = Vec::new();
        while cursor <= filter.to {
            let end = last_day_of(cursor.year(), cursor.month()).ok_or_else(|| invalid("Invalid date"))?;
            let (from, to) = (cursor.max(filter.from), end.min(filter.to));
            let key = format!("{:04}-{:02}", cursor.year(), cursor.month());
            let (total, purchase_count) = totals.remove(&key).unwrap_or((Decimal::ZERO, 0));
            let record_count = counts.get(&key).copied().unwrap_or(0);
            rows_out.push(AskMonthSpend {
                month: key,
                from,
                to,
                day_count: days_between(from, to),
                coverage: month_coverage(cursor, end, from, to, record_count, recorded, filter.as_of),
                record_count,
                total,
                purchase_count,
            });
            cursor = cursor.checked_add_months(Months::new(1)).ok_or_else(|| invalid("Invalid date"))?;
        }
        if filter.average == AskAverageKind::PerMonth {
            let used: Vec<&AskMonthSpend> = rows_out.iter().filter(|m| m.coverage == AskMonthCoverage::Complete).collect();
            let mut numerator = Decimal::ZERO;
            for month in &used {
                numerator = add(numerator, month.total)?;
            }
            let value = if used.is_empty() {
                None
            } else {
                Some(average_cents(numerator, used.len()).ok_or_else(|| invalid("Average out of range"))?)
            };
            result.average = Some(AskAverageResult {
                numerator,
                denominator: used.len(),
                value,
                unavailable: used.is_empty().then_some("no-complete-months"),
                months_used: used.iter().map(|m| m.month.clone()).collect(),
                months_left_out: rows_out
                    .iter()
                    .filter(|m| m.coverage != AskMonthCoverage::Complete)
                    .map(|m| (m.month.clone(), m.coverage))
                    .collect(),
            });
        }
        result.months = if filter.group_by == AskGroupBy::Month || filter.average == AskAverageKind::PerMonth {
            rows_out
        } else {
            Vec::new()
        };
        Ok(())
    }
    fn scan(&self, filter: &AskSpendFilter) -> rusqlite::Result<Scanned> {
        filter.validate()?;
        for id in &filter.member_ids {
            let exists: bool = self
                .conn
                .query_row("SELECT EXISTS(SELECT 1 FROM family_members WHERE id=?1)", [id], |r| r.get(0))?;
            if !exists {
                return Err(invalid("A selected family member is no longer available"));
            }
        }
        for id in &filter.account_ids {
            let exists: bool = self
                .conn
                .query_row("SELECT EXISTS(SELECT 1 FROM accounts WHERE id=?1)", [id], |r| r.get(0))?;
            if !exists {
                return Err(invalid("A selected account is no longer available"));
            }
        }
        for name in &filter.categories {
            let exists: bool = self
                .conn
                .query_row("SELECT EXISTS(SELECT 1 FROM categories WHERE name=?1)", [name], |r| r.get(0))?;
            if !exists {
                return Err(invalid("A selected category is no longer available"));
            }
        }
        for name in &filter.exclude_categories {
            let exists: bool = self
                .conn
                .query_row("SELECT EXISTS(SELECT 1 FROM categories WHERE name=?1)", [name], |r| r.get(0))?;
            if !exists {
                return Err(invalid("A category to leave out is no longer available"));
            }
        }
        // Predicates are fixed SQL with bound dates. Entity/decimal filters are exact Rust
        // comparisons; SQLite numeric casts would lose cents on large Decimal amounts.
        let mut statement = self.conn.prepare(&allocation_sql())?;
        let mut rows = statement.query(params![filter.from.to_string(), filter.to.to_string()])?;
        let include: Vec<String> = filter.vendors.iter().filter_map(|v| vendor_term(v)).collect();
        let exclude: Vec<String> = filter.exclude_vendors.iter().filter_map(|v| vendor_term(v)).collect();
        // A description repeats on many rows (one store, many visits), so each distinct description is numbered the first
        // time it is seen and decided once; rows are then handled by number without copying their text.
        let mut seen: HashMap<String, usize> = HashMap::new();
        let mut names: Vec<String> = Vec::new();
        let mut decided: Vec<(Option<usize>, bool)> = Vec::new();
        let mut named_ids: Vec<HashSet<i64>> = Vec::new();
        let mut by_name: HashMap<String, (Decimal, HashSet<i64>)> = HashMap::new();
        let mut uncategorized: Option<(Decimal, HashSet<i64>)> = None;
        let mut purchases: HashMap<i64, KeptPurchase> = HashMap::new();
        let mut total = Decimal::ZERO;
        let mut per_term: Vec<(Decimal, HashSet<i64>)> = vec![(Decimal::ZERO, HashSet::new()); include.len()];
        let mut left_total = Decimal::ZERO;
        let mut left_ids: BTreeSet<i64> = BTreeSet::new();
        let mut left_vendors: BTreeMap<String, BTreeSet<i64>> = BTreeMap::new();
        let mut left_categories: BTreeMap<Option<String>, (Decimal, BTreeSet<i64>)> = BTreeMap::new();
        let member_filter = !filter.member_ids.is_empty() || filter.include_unassigned;
        let want_months = filter.group_by == AskGroupBy::Month || filter.average == AskAverageKind::PerMonth;
        let mut month_ids: BTreeMap<String, (Decimal, HashSet<i64>)> = BTreeMap::new();
        let mut member_ids: HashMap<Option<i64>, (Decimal, HashSet<i64>)> = HashMap::new();
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let account_id: i64 = row.get(1)?;
            let date = text(row, 2)?;
            let description = text(row, 3)?;
            let parent = text(row, 4)?;
            let category: Option<&str> = match row.get_ref(5)? {
                rusqlite::types::ValueRef::Null => None,
                other => Some(other.as_str().map_err(|e| conversion(5, e))?),
            };
            let allocation = text(row, 6)?;
            if !filter.account_ids.is_empty() && !filter.account_ids.contains(&account_id) {
                continue;
            }
            // A purchase belongs to the family member recorded on the purchase itself, whatever its category lines are.
            let member: Option<i64> = row.get(7)?;
            if member_filter && !member.map_or(filter.include_unassigned, |chosen| filter.member_ids.contains(&chosen)) {
                continue;
            }
            if category == Some("Transfer") {
                continue;
            }
            let number = match seen.get(description) {
                Some(found) => *found,
                None => {
                    let number = names.len();
                    decided.push((
                        include.iter().position(|t| vendor_matches(description, t)),
                        exclude.iter().any(|t| vendor_matches(description, t)),
                    ));
                    names.push(description.to_string());
                    named_ids.push(HashSet::new());
                    seen.insert(description.to_string(), number);
                    number
                }
            };
            let (credited, left_by_store) = decided[number];
            if !include.is_empty() && credited.is_none() {
                continue;
            }
            if !filter.categories.is_empty() && !category.is_some_and(|c| filter.categories.iter().any(|wanted| wanted == c)) {
                continue;
            }
            let parent_amount = decimal(parent)?.abs();
            if filter.minimum_purchase.as_ref().is_some_and(|t| {
                if t.inclusive {
                    parent_amount < t.amount
                } else {
                    parent_amount <= t.amount
                }
            }) {
                continue;
            }
            let allocation = decimal(allocation)?;
            if allocation >= Decimal::ZERO {
                continue;
            }
            let amount = -allocation;
            let left_by_category = category.is_some_and(|c| filter.exclude_categories.iter().any(|left| left == c));
            if left_by_store || left_by_category {
                left_total = add(left_total, amount)?;
                left_ids.insert(id);
                if left_by_store {
                    left_vendors.entry(names[number].clone()).or_default().insert(id);
                }
                if left_by_category {
                    let entry = left_categories
                        .entry(category.map(str::to_string))
                        .or_insert((Decimal::ZERO, BTreeSet::new()));
                    entry.0 = add(entry.0, amount)?;
                    entry.1.insert(id);
                }
                continue;
            }
            total = add(total, amount)?;
            if want_months {
                let key = date.get(..7).ok_or_else(|| invalid("Invalid stored date"))?;
                let entry = month_ids.entry(key.to_string()).or_insert((Decimal::ZERO, HashSet::new()));
                entry.0 = add(entry.0, amount)?;
                entry.1.insert(id);
            }
            if filter.group_by == AskGroupBy::Member {
                let entry = member_ids.entry(member).or_insert((Decimal::ZERO, HashSet::new()));
                entry.0 = add(entry.0, amount)?;
                entry.1.insert(id);
            }
            let slot = match category {
                Some(name) => {
                    if !by_name.contains_key(name) {
                        by_name.insert(name.to_string(), (Decimal::ZERO, HashSet::new()));
                    }
                    by_name.get_mut(name).expect("just inserted")
                }
                None => uncategorized.get_or_insert((Decimal::ZERO, HashSet::new())),
            };
            slot.0 = add(slot.0, amount)?;
            slot.1.insert(id);
            if let Some(index) = credited {
                named_ids[number].insert(id);
                per_term[index].0 = add(per_term[index].0, amount)?;
                per_term[index].1.insert(id);
            }
            match purchases.get_mut(&id) {
                Some(kept) => kept.amount = add(kept.amount, amount)?,
                None => {
                    purchases.insert(
                        id,
                        KeptPurchase {
                            account_id,
                            date: date.to_string(),
                            number,
                            amount,
                            parent_amount,
                        },
                    );
                }
            }
        }
        let counted_accounts: BTreeSet<i64> = purchases.values().map(|kept| kept.account_id).collect();
        let purchase_count = purchases.len();
        let category_count = by_name.len() + usize::from(uncategorized.is_some());
        // One line per chosen category; a split purchase can sit in two of them, so the lines may count it twice.
        let category_totals: Vec<AskCategoryTotal> = if filter.categories.len() > 1 {
            filter
                .categories
                .iter()
                .map(|name| {
                    let (total, purchase_count) = by_name.get(name).map_or((Decimal::ZERO, 0), |(amount, ids)| (*amount, ids.len()));
                    AskCategoryTotal {
                        category: name.clone(),
                        total,
                        purchase_count,
                    }
                })
                .collect()
        } else {
            Vec::new()
        };
        let shared_purchase_count = category_totals
            .iter()
            .map(|line| line.purchase_count)
            .sum::<usize>()
            .saturating_sub(purchase_count);
        let member_totals = if filter.group_by == AskGroupBy::Member {
            self.member_lines(filter, member_ids)?
        } else {
            Vec::new()
        };
        let average = if filter.average == AskAverageKind::PerPurchase {
            let value = if purchase_count == 0 {
                None
            } else {
                Some(average_cents(total, purchase_count).ok_or_else(|| invalid("Average out of range"))?)
            };
            Some(AskAverageResult {
                numerator: total,
                denominator: purchase_count,
                value,
                unavailable: (purchase_count == 0).then_some("no-purchases"),
                months_used: Vec::new(),
                months_left_out: Vec::new(),
            })
        } else {
            None
        };
        let month_totals: BTreeMap<String, (Decimal, usize)> =
            month_ids.into_iter().map(|(month, (amount, ids))| (month, (amount, ids.len()))).collect();
        let mut categories: Vec<_> = by_name
            .into_iter()
            .map(|(category, (amount, ids))| AskCategorySpend {
                category: Some(category),
                amount,
                purchase_count: ids.len(),
            })
            .chain(uncategorized.map(|(amount, ids)| AskCategorySpend {
                category: None,
                amount,
                purchase_count: ids.len(),
            }))
            .collect();
        categories.sort_by(|a, b| b.amount.cmp(&a.amount).then_with(|| a.category.cmp(&b.category)));
        categories.truncate(filter.limit);
        // Rank first, then build rows (with their text) only for the few that are shown.
        let mut ranked: Vec<(&i64, &KeptPurchase)> = purchases.iter().collect();
        ranked.sort_by(|a, b| {
            b.1.amount
                .cmp(&a.1.amount)
                .then_with(|| a.1.date.cmp(&b.1.date))
                .then_with(|| a.0.cmp(b.0))
        });
        ranked.truncate(filter.limit);
        let purchases: Vec<AskPurchaseSpend> = ranked
            .into_iter()
            .map(|(id, kept)| AskPurchaseSpend {
                transaction_id: *id,
                account_id: kept.account_id,
                date: kept.date.clone(),
                description: names[kept.number].clone(),
                amount: kept.amount,
                parent_amount: kept.parent_amount,
            })
            .collect();
        let vendor_name_count = named_ids.iter().filter(|ids| !ids.is_empty()).count();
        let mut vendors: Vec<_> = named_ids
            .iter()
            .enumerate()
            .filter(|(_, ids)| !ids.is_empty())
            .map(|(number, ids)| AskVendorSpend {
                description: names[number].clone(),
                purchase_count: ids.len(),
            })
            .collect();
        vendors.sort_by(|a, b| b.purchase_count.cmp(&a.purchase_count).then_with(|| a.description.cmp(&b.description)));
        vendors.truncate(MAX_VENDOR_NAMES_SHOWN);
        let earliest_record = self
            .conn
            .query_row("SELECT MIN(date) FROM transactions WHERE deleted_at IS NULL", [], |r| {
                r.get::<_, Option<String>>(0)
            })?
            .map(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").map_err(|_| invalid("Invalid stored date")))
            .transpose()?;
        let result = AskSpendResult {
            total,
            purchase_count,
            category_count,
            categories,
            purchases,
            vendors,
            vendor_name_count,
            vendor_totals: include
                .iter()
                .zip(filter.vendors.iter())
                .zip(per_term)
                .map(|((_, typed), (total, ids))| AskVendorTotal {
                    term: typed.clone(),
                    total,
                    purchase_count: ids.len(),
                })
                .collect(),
            left_out: AskLeftOut {
                total: left_total,
                purchase_count: left_ids.len(),
                vendors: ranked_names(left_vendors),
                categories: left_categories
                    .into_iter()
                    .map(|(category, (amount, ids))| AskCategorySpend {
                        category,
                        amount,
                        purchase_count: ids.len(),
                    })
                    .collect(),
            },
            category_totals,
            shared_purchase_count,
            member_totals,
            months: Vec::new(),
            recorded_from: None,
            recorded_through: None,
            average,
            earliest_record,
        };
        Ok((result, counted_accounts, month_totals))
    }
    /// One line per chosen family member, or everyone the household has; the unassigned line is added when chosen, and always
    /// when nobody was chosen. Largest first; on a tie people by name and the unassigned line last.
    fn member_lines(
        &self,
        filter: &AskSpendFilter,
        mut found: HashMap<Option<i64>, (Decimal, HashSet<i64>)>,
    ) -> rusqlite::Result<Vec<AskMemberTotal>> {
        let mut roster: Vec<(i64, String)> = Vec::new();
        let mut statement = self.conn.prepare("SELECT id, name FROM family_members ORDER BY id")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            roster.push((row.get(0)?, row.get(1)?));
        }
        let chosen = !filter.member_ids.is_empty() || filter.include_unassigned;
        let people: Vec<(i64, String)> = if chosen {
            filter
                .member_ids
                .iter()
                .filter_map(|id| roster.iter().find(|(known, _)| known == id).cloned())
                .collect()
        } else {
            roster
        };
        let mut lines: Vec<AskMemberTotal> = people
            .into_iter()
            .map(|(id, name)| {
                let (total, ids) = found.remove(&Some(id)).unwrap_or((Decimal::ZERO, HashSet::new()));
                AskMemberTotal {
                    member_id: Some(id),
                    name: Some(name),
                    total,
                    purchase_count: ids.len(),
                }
            })
            .collect();
        if !chosen || filter.include_unassigned {
            let (total, ids) = found.remove(&None).unwrap_or((Decimal::ZERO, HashSet::new()));
            lines.push(AskMemberTotal {
                member_id: None,
                name: None,
                total,
                purchase_count: ids.len(),
            });
        }
        if lines.len() > MAX_MONTH_ROWS as usize {
            return Err(invalid("Choose fewer family members: at most 50 lines can be shown"));
        }
        lines.sort_by(|a, b| {
            b.total.cmp(&a.total).then_with(|| match (&a.name, &b.name) {
                (Some(x), Some(y)) => x.to_lowercase().cmp(&y.to_lowercase()).then_with(|| x.cmp(y)),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            })
        });
        Ok(lines)
    }
}
