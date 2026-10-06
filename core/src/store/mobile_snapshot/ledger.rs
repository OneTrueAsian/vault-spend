use super::super::LIVE_TRANSFER_LEG_IDS_SQL;
use super::*;
use std::str::FromStr;

pub(super) struct Ledger {
    pub history: History,
    pub raw: BTreeMap<(String, String), Money>,
}
struct Row {
    id: i64,
    date: String,
    amount: Money,
    category: Option<String>,
    account: i64,
    member: Option<i64>,
    description: String,
    kind: String,
    linked: bool,
}
fn decimal(s: &str) -> rusqlite::Result<Money> {
    Money::from_str(s).map_err(|_| rusqlite::Error::InvalidQuery)
}
type Totals = BTreeMap<(String, Option<i64>, String), (Money, Money)>;
fn add(map: &mut Totals, m: &str, id: Option<i64>, label: &str, income: Money, spend: Money) {
    let entry = map.entry((m.into(), id, label.into())).or_default();
    entry.0 += income;
    entry.1 += spend;
}
fn breakdown(map: Totals) -> Vec<MonthBreakdown> {
    map.into_iter()
        .map(|((month, id, label), (income, spending))| MonthBreakdown {
            month,
            id: id.map(|v| v.to_string()),
            label,
            income: money(income),
            spending: money(spending),
        })
        .collect()
}
pub(super) fn read(store: &Store, as_of: NaiveDate) -> rusqlite::Result<Ledger> {
    // One parent pass; notes, masks, import metadata and payment identifiers are never fetched.
    let mut stmt=store.conn.prepare(&format!("SELECT t.id,t.date,t.amount,t.category,t.account_id,t.member_id,t.description,a.account_type,t.id IN ({LIVE_TRANSFER_LEG_IDS_SQL}) FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.deleted_at IS NULL AND t.date<=?1 AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments) ORDER BY t.date,t.id"))?;
    let rows = stmt
        .query_map([as_of.to_string()], |r| {
            Ok(Row {
                id: r.get(0)?,
                date: r.get(1)?,
                amount: decimal(&r.get::<_, String>(2)?)?,
                category: r.get(3)?,
                account: r.get(4)?,
                member: r.get(5)?,
                description: r.get(6)?,
                kind: r.get(7)?,
                linked: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let account_names: BTreeMap<_, _> = store.list_accounts(as_of)?.into_iter().map(|a| (a.id, a.account.name)).collect();
    let member_names: BTreeMap<_, _> = store.list_family_members()?.into_iter().map(|m| (m.id, m.name)).collect();
    let mut splits: BTreeMap<i64, Vec<(Option<String>, Money)>> = BTreeMap::new();
    let mut stmt=store.conn.prepare("SELECT s.transaction_id,s.category,s.amount FROM transaction_splits s JOIN transactions t ON t.id=s.transaction_id WHERE t.deleted_at IS NULL AND t.date<=?1 AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)")?;
    for row in stmt.query_map([as_of.to_string()], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?, decimal(&r.get::<_, String>(2)?)?))
    })? {
        let (id, category, amount) = row?;
        splits.entry(id).or_default().push((category, amount));
    }
    let mut tags: BTreeMap<i64, Vec<String>> = BTreeMap::new();
    let mut stmt=store.conn.prepare("SELECT tt.transaction_id,tt.tag FROM transaction_tags tt JOIN transactions t ON t.id=tt.transaction_id WHERE t.deleted_at IS NULL AND t.date<=?1 AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)")?;
    for row in stmt.query_map([as_of.to_string()], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
        let (id, tag) = row?;
        tags.entry(id).or_default().push(tag);
    }
    let mut totals: BTreeMap<String, (Money, Money)> = BTreeMap::new();
    let mut raw: BTreeMap<(String, String), Money> = BTreeMap::new();
    let mut categories: BTreeMap<(String, String), Money> = BTreeMap::new();
    let mut daily: BTreeMap<String, Money> = BTreeMap::new();
    let (mut accounts, mut members, mut tagged, mut merchants) = (Totals::new(), Totals::new(), Totals::new(), Totals::new());
    for row in &rows {
        let m = &row.date[..7];
        totals.entry(m.into()).or_default();
        let financial = !row.linked && row.category.as_deref() != Some("Transfer");
        let income = if financial && row.amount > Money::ZERO && !matches!(row.kind.as_str(), "credit" | "loan") {
            row.amount
        } else {
            Money::ZERO
        };
        let spend = if financial && row.amount < Money::ZERO {
            -row.amount
        } else {
            Money::ZERO
        };
        let entry = totals.entry(m.into()).or_default();
        entry.0 += income;
        entry.1 += spend;
        if income != Money::ZERO || spend != Money::ZERO {
            add(&mut accounts, m, Some(row.account), &account_names[&row.account], income, spend);
            if let Some(id) = row.member {
                add(&mut members, m, Some(id), &member_names[&id], income, spend);
            }
        }
        if spend > Money::ZERO {
            add(&mut merchants, m, None, &row.description, Money::ZERO, spend);
        }
        if row.amount < Money::ZERO {
            for tag in tags.get(&row.id).into_iter().flatten() {
                add(&mut tagged, m, None, tag, Money::ZERO, -row.amount);
            }
        }
        let parent = [(row.category.clone(), row.amount)];
        let lines = splits.get(&row.id).map(|v| v.as_slice()).unwrap_or(&parent);
        for (category, amount) in lines {
            if let Some(category) = category {
                *raw.entry((m.into(), category.clone())).or_default() += *amount;
            }
            if !row.linked && category.as_deref() != Some("Transfer") && *amount < Money::ZERO {
                *categories
                    .entry((m.into(), category.clone().unwrap_or_else(|| "Uncategorized".into())))
                    .or_default() -= *amount;
                *daily.entry(row.date.clone()).or_default() -= *amount;
            }
        }
    }
    let history = History {
        from_month: rows.first().map(|r| r.date[..7].to_string()),
        through_month: None,
        actual_through: as_of.to_string(),
        months: totals
            .into_iter()
            .map(|(month, (income, spending))| MonthTotals {
                month,
                income: money(income),
                spending: money(spending),
                savings_rate_pct: (income > Money::ZERO).then(|| money((income - spending) * Money::from(100) / income)),
            })
            .collect(),
        categories: categories
            .into_iter()
            .map(|((month, category), spending)| CategoryMonth {
                month,
                category,
                group: None,
                spending: money(spending),
            })
            .collect(),
        budget_category_net: raw
            .iter()
            .map(|((month, category), amount)| BudgetCategoryMonth {
                month: month.clone(),
                category: category.clone(),
                signed_amount: money(*amount),
            })
            .collect(),
        daily: daily
            .into_iter()
            .map(|(date, spending)| DailySpend {
                date,
                spending: money(spending),
            })
            .collect(),
        accounts: breakdown(accounts),
        members: breakdown(members),
        tags: breakdown(tagged),
        merchants: breakdown(merchants),
        net_worth: Vec::new(),
        portfolio: Vec::new(),
        member_net_worth: Vec::new(),
    };
    Ok(Ledger { history, raw })
}
pub(super) fn fill_months(history: &mut History, first: Option<&str>, as_of: NaiveDate) {
    let Some(first) = first else { return };
    let mut date = NaiveDate::parse_from_str(&(first.to_string() + "-01"), "%Y-%m-%d").unwrap();
    let mut existing: BTreeMap<_, _> = std::mem::take(&mut history.months).into_iter().map(|m| (m.month.clone(), m)).collect();
    while date <= as_of {
        let key = month(date);
        history.months.push(existing.remove(&key).unwrap_or(MonthTotals {
            month: key,
            income: "0".into(),
            spending: "0".into(),
            savings_rate_pct: None,
        }));
        date = next_month(date);
    }
    history.from_month = Some(first.into());
    history.through_month = Some(month(as_of));
}
pub(super) fn alias_breakdowns(h: &mut History, c: &MobileSnapshotContext) {
    for row in &mut h.accounts {
        row.id = row.id.as_ref().map(|id| c.alias("account", id.parse().unwrap()));
    }
    for row in &mut h.members {
        row.id = row.id.as_ref().map(|id| c.alias("member", id.parse().unwrap()));
    }
}
