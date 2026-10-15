//! Exact, read-only spending primitives for Ask the Vault. No question text or SQL is accepted.
use super::{LIVE_TRANSFER_LEG_IDS_SQL, Store};
use chrono::{Datelike, NaiveDate};
use rusqlite::params;
use rust_decimal::Decimal;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

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
        let purchase_count = purchases.len();
        let category_count = by_name.len() + usize::from(uncategorized.is_some());
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
