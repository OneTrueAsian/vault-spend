//! Exact, read-only spending primitives for Ask the Vault. No question text or SQL is accepted.
use super::{LIVE_TRANSFER_LEG_IDS_SQL, Store};
use chrono::{Datelike, NaiveDate};
use rusqlite::params;
use rust_decimal::Decimal;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub struct AskSpendThreshold {
    pub amount: Decimal,
    pub inclusive: bool,
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
impl Store {
    /// Same gross negative-allocation semantics as Reports' daily/category spending.
    /// Refunds are excluded, not subtracted. Limits affect displayed rankings only.
    pub fn ask_spending(&self, filter: &AskSpendFilter) -> rusqlite::Result<AskSpendResult> {
        filter.validate()?;
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
        let mut statement = self.conn.prepare(&format!(
            "SELECT t.id, t.account_id, t.date, t.description, t.amount, t.category, t.amount
             FROM transactions t
             WHERE t.date >= ?1 AND t.date <= ?2 AND t.deleted_at IS NULL
               AND t.id NOT IN (SELECT transaction_id FROM transaction_splits)
               AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
               AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
             UNION ALL
             SELECT t.id, t.account_id, t.date, t.description, t.amount, s.category, s.amount
             FROM transaction_splits s JOIN transactions t ON t.id=s.transaction_id
             WHERE t.date >= ?1 AND t.date <= ?2 AND t.deleted_at IS NULL
               AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
               AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})"
        ))?;
        let rows = statement.query_map(params![filter.from.to_string(), filter.to.to_string()], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, String>(6)?,
            ))
        })?;
        let mut categories: BTreeMap<Option<String>, (Decimal, BTreeSet<i64>)> = BTreeMap::new();
        let mut purchases: BTreeMap<i64, AskPurchaseSpend> = BTreeMap::new();
        let mut total = Decimal::ZERO;
        let include: Vec<String> = filter.vendors.iter().filter_map(|v| vendor_term(v)).collect();
        let exclude: Vec<String> = filter.exclude_vendors.iter().filter_map(|v| vendor_term(v)).collect();
        let mut vendors: BTreeMap<String, BTreeSet<i64>> = BTreeMap::new();
        let mut per_term: Vec<(Decimal, BTreeSet<i64>)> = vec![(Decimal::ZERO, BTreeSet::new()); include.len()];
        let mut left_total = Decimal::ZERO;
        let mut left_ids: BTreeSet<i64> = BTreeSet::new();
        let mut left_vendors: BTreeMap<String, BTreeSet<i64>> = BTreeMap::new();
        let mut left_categories: BTreeMap<Option<String>, (Decimal, BTreeSet<i64>)> = BTreeMap::new();
        for row in rows {
            let (id, account_id, date, description, parent, category, allocation) = row?;
            if !filter.account_ids.is_empty() && !filter.account_ids.contains(&account_id) {
                continue;
            }
            if category.as_deref() == Some("Transfer") {
                continue;
            }
            let credited = include.iter().position(|t| vendor_matches(&description, t));
            if !include.is_empty() && credited.is_none() {
                continue;
            }
            if !filter.categories.is_empty() && !category.as_ref().is_some_and(|c| filter.categories.contains(c)) {
                continue;
            }
            let parent_amount = decimal(&parent)?.abs();
            if filter.minimum_purchase.as_ref().is_some_and(|t| {
                if t.inclusive {
                    parent_amount < t.amount
                } else {
                    parent_amount <= t.amount
                }
            }) {
                continue;
            }
            let allocation = decimal(&allocation)?;
            if allocation >= Decimal::ZERO {
                continue;
            }
            let amount = -allocation;
            let left_by_store = exclude.iter().any(|t| vendor_matches(&description, t));
            let left_by_category = category.as_ref().is_some_and(|c| filter.exclude_categories.contains(c));
            if left_by_store || left_by_category {
                left_total = add(left_total, amount)?;
                left_ids.insert(id);
                if left_by_store {
                    left_vendors.entry(description.clone()).or_default().insert(id);
                }
                if left_by_category {
                    let entry = left_categories.entry(category.clone()).or_insert((Decimal::ZERO, BTreeSet::new()));
                    entry.0 = add(entry.0, amount)?;
                    entry.1.insert(id);
                }
                continue;
            }
            total = add(total, amount)?;
            let entry = categories.entry(category).or_insert((Decimal::ZERO, BTreeSet::new()));
            entry.0 = add(entry.0, amount)?;
            entry.1.insert(id);
            if let Some(index) = credited {
                vendors.entry(description.clone()).or_default().insert(id);
                per_term[index].0 = add(per_term[index].0, amount)?;
                per_term[index].1.insert(id);
            }
            let purchase = purchases.entry(id).or_insert(AskPurchaseSpend {
                transaction_id: id,
                account_id,
                date,
                description,
                amount: Decimal::ZERO,
                parent_amount,
            });
            purchase.amount = add(purchase.amount, amount)?;
        }
        let purchase_count = purchases.len();
        let category_count = categories.len();
        let mut categories: Vec<_> = categories
            .into_iter()
            .map(|(category, (amount, ids))| AskCategorySpend {
                category,
                amount,
                purchase_count: ids.len(),
            })
            .collect();
        categories.sort_by(|a, b| b.amount.cmp(&a.amount).then_with(|| a.category.cmp(&b.category)));
        categories.truncate(filter.limit);
        let mut purchases: Vec<_> = purchases.into_values().collect();
        purchases.sort_by(|a, b| {
            b.amount
                .cmp(&a.amount)
                .then_with(|| a.date.cmp(&b.date))
                .then_with(|| a.transaction_id.cmp(&b.transaction_id))
        });
        purchases.truncate(filter.limit);
        let vendor_name_count = vendors.len();
        let mut vendors: Vec<_> = vendors
            .into_iter()
            .map(|(description, ids)| AskVendorSpend {
                description,
                purchase_count: ids.len(),
            })
            .collect();
        vendors.sort_by(|a, b| b.purchase_count.cmp(&a.purchase_count).then_with(|| a.description.cmp(&b.description)));
        vendors.truncate(MAX_VENDOR_NAMES_SHOWN);
        Ok(AskSpendResult {
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
        })
    }
}
