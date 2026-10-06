use super::super::{BudgetLine as StoredLine, UiStateKey};
use super::*;
use std::str::FromStr;

fn effective<'a>(periods: &'a BTreeMap<String, Vec<StoredLine>>, key: &str) -> Option<(&'a String, &'a Vec<StoredLine>)> {
    periods.range(..=key.to_string()).next_back()
}
fn carry(periods: &BTreeMap<String, Vec<StoredLine>>, raw: &BTreeMap<(String, String), Money>, category: &str, date: NaiveDate) -> Money {
    let mut run = Vec::new();
    for back in 0..36 {
        let key = super::super::budgets::month_key_back(date.year(), date.month(), back);
        let line = effective(periods, &key).and_then(|(_, lines)| lines.iter().find(|l| l.category == category));
        match line {
            Some(l) if l.rollover_enabled => run.push((key, l.monthly_amount)),
            _ => break,
        }
    }
    let mut carry = Money::ZERO;
    for (key, base) in run.into_iter().skip(1).rev() {
        carry = (base + carry + raw.get(&(key, category.into())).copied().unwrap_or_default()).max(Money::ZERO);
    }
    carry
}
pub(super) fn read(
    store: &Store,
    history: &mut History,
    raw: &BTreeMap<(String, String), Money>,
    as_of: NaiveDate,
) -> rusqlite::Result<Vec<BudgetMonth>> {
    let mut periods: BTreeMap<String, Vec<StoredLine>> = BTreeMap::new();
    let mut stmt = store.conn.prepare("SELECT period FROM budget_periods ORDER BY period")?;
    for key in stmt.query_map([], |r| r.get::<_, String>(0))? {
        periods.insert(key?, Vec::new());
    }
    let mut stmt = store
        .conn
        .prepare("SELECT period,category,budget_group,monthly_amount,cap_enabled,rollover_enabled FROM budgets ORDER BY period,category")?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            StoredLine {
                category: r.get(1)?,
                budget_group: r.get(2)?,
                monthly_amount: Money::from_str(&r.get::<_, String>(3)?).map_err(|_| rusqlite::Error::InvalidQuery)?,
                cap_enabled: r.get(4)?,
                rollover_enabled: r.get(5)?,
            },
        ))
    })? {
        let (key, line) = row?;
        periods.entry(key).or_default().push(line);
    }
    let settings = store.get_app_settings()?;
    let order: Vec<String> = store
        .get_ui_state(UiStateKey::CategoryOrder)?
        .and_then(|s| serde_json::from_str::<Vec<serde_json::Value>>(&s).ok())
        .map(|v| v.into_iter().filter_map(|s| s.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    let current = month(as_of);
    let mut keys: std::collections::BTreeSet<String> = periods.keys().filter(|k| k.as_str() >= "0001-01").cloned().collect();
    keys.extend(history.months.iter().map(|m| m.month.clone()));
    keys.insert(current.clone());
    let first = keys.iter().next().cloned().unwrap();
    let mut date = NaiveDate::parse_from_str(&(first + "-01"), "%Y-%m-%d").map_err(|_| rusqlite::Error::InvalidQuery)?;
    while date <= as_of {
        keys.insert(month(date));
        date = next_month(date);
    }
    let mut months = Vec::new();
    for key in keys {
        let date = NaiveDate::parse_from_str(&(key.clone() + "-01"), "%Y-%m-%d").map_err(|_| rusqlite::Error::InvalidQuery)?;
        let source = effective(&periods, &key);
        let mut lines = source.map(|(_, v)| v.clone()).unwrap_or_default();
        let group_order = |s: &str| match s {
            "income" => 0,
            "fixed" => 1,
            "flexible" => 2,
            _ => 3,
        };
        lines.sort_by(|a, b| {
            group_order(&a.budget_group)
                .cmp(&group_order(&b.budget_group))
                .then_with(|| {
                    order
                        .iter()
                        .position(|s| s == &a.category)
                        .unwrap_or(usize::MAX)
                        .cmp(&order.iter().position(|s| s == &b.category).unwrap_or(usize::MAX))
                })
                .then_with(|| a.category.cmp(&b.category))
        });
        let mut exported = Vec::new();
        for (i, line) in lines.iter().enumerate() {
            let amount = raw.get(&(key.clone(), line.category.clone())).copied().unwrap_or_default();
            let actual = if key > current {
                Money::ZERO
            } else if line.budget_group == "income" {
                amount
            } else {
                -amount
            };
            let rollover = if key <= current && settings.rollover_enabled && line.rollover_enabled && line.budget_group != "income" {
                carry(&periods, raw, &line.category, date)
            } else {
                Money::ZERO
            };
            let effective = line.monthly_amount + rollover;
            let alert = if line.budget_group == "income" || effective <= Money::ZERO {
                "none"
            } else if actual > effective {
                "over"
            } else if actual * Money::from(100) >= effective * Money::from(if settings.envelope_caps_enabled && line.cap_enabled { 90 } else { 80 }) {
                "warning"
            } else {
                "none"
            };
            exported.push(BudgetLine {
                category: line.category.clone(),
                group: line.budget_group.clone(),
                order: i as u32,
                planned: money(line.monthly_amount),
                actual: money(actual),
                rollover: money(rollover),
                effective_budget: money(effective),
                remaining: money(if line.budget_group == "income" {
                    actual - effective
                } else {
                    effective - actual
                }),
                cap_enabled: line.cap_enabled,
                rollover_enabled: line.rollover_enabled,
                alert: alert.into(),
            });
        }
        for row in history.categories.iter_mut().filter(|r| r.month == key) {
            row.group = lines.iter().find(|l| l.category == row.category).map(|l| l.budget_group.clone());
        }
        let unbudgeted: Money = history
            .categories
            .iter()
            .filter(|r| r.month == key && !lines.iter().any(|l| l.category == r.category))
            .map(|r| Money::from_str(&r.spending).unwrap())
            .sum();
        let actuals = history.months.iter().find(|m| m.month == key);
        months.push(BudgetMonth {
            month: key.clone(),
            actual_through: (key <= current).then(|| {
                if key == current {
                    as_of.to_string()
                } else {
                    next_month(date).pred_opt().unwrap().to_string()
                }
            }),
            source_month: source.filter(|(k, _)| k.as_str() >= "0001-01").map(|(k, _)| k.clone()),
            cap_feature_enabled: settings.envelope_caps_enabled,
            rollover_feature_enabled: settings.rollover_enabled,
            lines: exported,
            unbudgeted_spending: money(unbudgeted),
            actual_income: actuals.map(|m| m.income.clone()).unwrap_or_else(|| "0".into()),
            actual_spending: actuals.map(|m| m.spending.clone()).unwrap_or_else(|| "0".into()),
        });
    }
    Ok(months)
}
