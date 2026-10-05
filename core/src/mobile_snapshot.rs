//! Versioned, minimized financial wire contract; no Store access or side effects.
//! Use parse_mobile_snapshot / serialize_mobile_snapshot at transport boundaries.
#[path = "mobile_snapshot_types.rs"]
mod types;
use chrono::NaiveDate;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;
pub use types::*;

pub const MAX_MOBILE_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;
const SCHEMA: &str = include_str!("mobile_snapshot_v1.schema.json");
fn invalid(path: &str) -> String {
    format!("Invalid mobile snapshot at {path}")
}
fn date(v: &str) -> bool {
    v.len() == 10
        && v.bytes()
            .enumerate()
            .all(|(i, c)| if i == 4 || i == 7 { c == b'-' } else { c.is_ascii_digit() })
        && !v.starts_with("0000")
        && NaiveDate::parse_from_str(v, "%Y-%m-%d").is_ok()
}
fn month(v: &str) -> bool {
    v.len() == 7 && date(&format!("{v}-01"))
}
fn format_valid(v: &str, format: &str) -> bool {
    match format {
        "date" => date(v),
        "month" => month(v),
        "utc-timestamp" => {
            v.is_ascii()
                && v.len() == 20
                && date(&v[..10])
                && v.as_bytes()[10] == b'T'
                && v.ends_with('Z')
                && &v[17..19] < "60"
                && chrono::DateTime::parse_from_rfc3339(v).is_ok()
        }
        "opaque-id" => v.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'),
        "sequence" => !v.is_empty() && (v == "0" || !v.starts_with('0')) && v.bytes().all(|c| c.is_ascii_digit()) && v.parse::<u64>().is_ok(),
        "exact-decimal" => {
            let unsigned = v.strip_prefix('-').unwrap_or(v);
            let mut parts = unsigned.split('.');
            let whole = parts.next().unwrap_or("");
            let fraction = parts.next();
            !whole.is_empty()
                && whole.len() <= 15
                && (whole == "0" || !whole.starts_with('0'))
                && whole.bytes().all(|c| c.is_ascii_digit())
                && fraction.is_none_or(|f| !f.is_empty() && f.len() <= 12 && f.bytes().all(|c| c.is_ascii_digit()))
                && parts.next().is_none()
        }
        _ => false,
    }
}
fn validate(v: &Value, rule: &Value, defs: &Value, path: &str) -> Result<(), String> {
    if let Some(reference) = rule["$ref"].as_str() {
        return validate(v, &defs[reference.rsplit('/').next().unwrap()], defs, path);
    }
    if let Some(options) = rule["anyOf"].as_array() {
        return if options.iter().any(|r| validate(v, r, defs, path).is_ok()) {
            Ok(())
        } else {
            Err(invalid(path))
        };
    }
    if let Some(constant) = rule.get("const")
        && v != constant
    {
        return Err(invalid(path));
    }
    if let Some(values) = rule["enum"].as_array()
        && !values.contains(v)
    {
        return Err(invalid(path));
    }
    match rule["type"].as_str().unwrap_or("") {
        "null" if v.is_null() => {}
        "boolean" if v.is_boolean() => {}
        "string" => {
            let s = v.as_str().ok_or_else(|| invalid(path))?;
            let len = s.chars().count() as u64;
            if len < rule["minLength"].as_u64().unwrap_or(0)
                || len > rule["maxLength"].as_u64().unwrap_or(u64::MAX)
                || rule["format"].as_str().is_some_and(|f| !format_valid(s, f))
            {
                return Err(invalid(path));
            }
        }
        "integer" => {
            let n = v.as_u64().ok_or_else(|| invalid(path))?;
            if n < rule["minimum"].as_u64().unwrap_or(0) || n > rule["maximum"].as_u64().unwrap_or(u64::MAX) {
                return Err(invalid(path));
            }
        }
        "array" => {
            for (i, item) in v.as_array().ok_or_else(|| invalid(path))?.iter().enumerate() {
                validate(item, &rule["items"], defs, &format!("{path}[{i}]"))?;
            }
        }
        "object" => {
            let object = v.as_object().ok_or_else(|| invalid(path))?;
            for key in rule["required"].as_array().unwrap() {
                if !object.contains_key(key.as_str().unwrap()) {
                    return Err(invalid(path));
                }
            }
            for (key, value) in object {
                let field = rule["properties"].get(key).ok_or_else(|| invalid(path))?;
                validate(value, field, defs, &format!("{path}.{key}"))?;
            }
        }
        _ => return Err(invalid(path)),
    }
    Ok(())
}
fn unique<'a>(values: impl Iterator<Item = &'a str>, path: &str) -> Result<(), String> {
    let mut seen = HashSet::new();
    if values.into_iter().all(|v| seen.insert(v)) {
        Ok(())
    } else {
        Err(invalid(path))
    }
}
fn index(month: &str) -> i32 {
    month[..4].parse::<i32>().unwrap() * 12 + month[5..].parse::<i32>().unwrap()
}
fn invariant(v: &MobileSnapshotV1) -> Result<(), String> {
    if v.history.actual_through != v.as_of_date {
        return Err(invalid("history.actualThrough"));
    }
    let sections = [
        &v.sections.overview,
        &v.sections.accounts,
        &v.sections.investments,
        &v.sections.budgets,
        &v.sections.reports,
        &v.sections.comparisons,
        &v.sections.calculators,
    ];
    if sections.iter().any(|s| (s.state == "available") != s.reason.is_none()) {
        return Err(invalid("sections"));
    }
    unique(v.accounts.iter().map(|a| a.id.as_str()), "accounts")?;
    unique(v.members.iter().map(|a| a.id.as_str()), "members")?;
    unique(v.budgets.iter().map(|a| a.month.as_str()), "budgets")?;
    unique(v.history.months.iter().map(|a| a.month.as_str()), "history.months")?;
    let ids: HashSet<&str> = v.accounts.iter().map(|a| a.id.as_str()).collect();
    let members: HashSet<&str> = v.members.iter().map(|a| a.id.as_str()).collect();
    if v.accounts
        .iter()
        .any(|a| a.member_id.as_ref().is_some_and(|id| !members.contains(id.as_str())))
    {
        return Err(invalid("accounts.memberId"));
    }
    if v.calculators
        .accumulation
        .iter()
        .map(|a| &a.account_id)
        .chain(v.calculators.debts.iter().map(|a| &a.account_id))
        .chain(v.investments.accounts.iter().map(|a| &a.account_id))
        .any(|id| !ids.contains(id.as_str()))
    {
        return Err(invalid("accountId"));
    }
    for c in std::iter::once(&v.investments.coverage).chain(v.investments.accounts.iter().map(|a| &a.coverage)) {
        if c.valued_positions > c.total_positions || (c.state == "complete" && c.valued_positions != c.total_positions) {
            return Err(invalid("investments.coverage"));
        }
    }
    if v.investments.day_change.is_some()
        && (v.investments.coverage.state != "complete"
            || v.investments.coverage.previous_close_date.as_deref() != Some(&v.as_of_date)
            || v.investments.coverage.total_positions == 0)
    {
        return Err(invalid("investments.dayChange"));
    }
    for a in &v.investments.accounts {
        if a.day_change.is_some()
            && (a.coverage.state != "complete" || a.coverage.previous_close_date.as_deref() != Some(&v.as_of_date) || a.coverage.total_positions == 0)
        {
            return Err(invalid("investments.dayChange"));
        }
    }
    unique(v.investments.accounts.iter().map(|a| a.account_id.as_str()), "investments.accounts")?;
    unique(
        v.calculators.accumulation.iter().map(|a| a.account_id.as_str()),
        "calculators.accumulation",
    )?;
    unique(v.calculators.debts.iter().map(|a| a.account_id.as_str()), "calculators.debts")?;
    for a in &v.calculators.accumulation {
        unique(a.months.iter().map(|m| m.month.as_str()), "calculators.accumulation.months")?;
        if a.months.iter().any(|m| m.month.as_str() > &v.as_of_date[..7]) || a.value_history.iter().any(|h| h.date > v.as_of_date) {
            return Err(invalid("calculators.accumulation.history"));
        }
    }
    let months: Vec<&str> = v.history.months.iter().map(|m| m.month.as_str()).collect();
    if months.is_empty() {
        if v.history.from_month.is_some() || v.history.through_month.is_some() {
            return Err(invalid("history.bounds"));
        }
    } else if v.history.from_month.as_deref() != months.first().copied()
        || v.history.through_month.as_deref() != months.last().copied()
        || months.iter().any(|m| *m > &v.as_of_date[..7])
        || months.windows(2).any(|w| index(w[1]) != index(w[0]) + 1)
    {
        return Err(invalid("history.months"));
    }
    if v.history
        .categories
        .iter()
        .map(|a| a.month.as_str())
        .chain(v.history.budget_category_net.iter().map(|a| a.month.as_str()))
        .chain(v.history.accounts.iter().map(|a| a.month.as_str()))
        .chain(v.history.members.iter().map(|a| a.month.as_str()))
        .chain(v.history.tags.iter().map(|a| a.month.as_str()))
        .chain(v.history.merchants.iter().map(|a| a.month.as_str()))
        .any(|m| !months.contains(&m))
    {
        return Err(invalid("history.month"));
    }
    if v.history
        .daily
        .iter()
        .map(|a| &a.date)
        .chain(v.history.net_worth.iter().map(|a| &a.date))
        .chain(v.history.portfolio.iter().map(|a| &a.date))
        .any(|d| d > &v.as_of_date)
    {
        return Err(invalid("history.date"));
    }
    for b in &v.budgets {
        unique(b.lines.iter().map(|a| a.category.as_str()), "budgets.lines")?;
        if b.actual_through.as_ref().is_some_and(|d| d > &v.as_of_date || d[..7] != b.month) {
            return Err(invalid("budgets.actualThrough"));
        }
        if b.month.as_str() > &v.as_of_date[..7]
            && (b.actual_through.is_some()
                || b.lines
                    .iter()
                    .map(|l| l.actual.as_str())
                    .chain([b.actual_income.as_str(), b.actual_spending.as_str(), b.unbudgeted_spending.as_str()])
                    .any(|a| a.bytes().any(|c| c.is_ascii_digit() && c != b'0')))
        {
            return Err(invalid("budgets.futureActual"));
        }
    }
    let f = &v.calculators.forecast;
    if f.through_date < v.as_of_date || f.schedule.iter().any(|s| s.date < v.as_of_date || s.date > f.through_date) {
        return Err(invalid("calculators.forecast"));
    }
    Ok(())
}
/// Validate before use; expected identity must come from authenticated pairing metadata.
pub fn parse_mobile_snapshot(json: &str, expected: Option<(&str, &str)>) -> Result<MobileSnapshotV1, String> {
    if json.len() > MAX_MOBILE_SNAPSHOT_BYTES {
        return Err(invalid("size"));
    }
    let mut value: Value = serde_json::from_str(json).map_err(|_| invalid("json"))?;
    // JSON Schema integers include integral numeric spellings such as 1.0.
    // Normalize within the contract's exact u32 range before serde conversion,
    // matching JavaScript JSON.parse without ever converting decimal-string money.
    fn normalize_integers(value: &mut Value) {
        match value {
            Value::Array(items) => items.iter_mut().for_each(normalize_integers),
            Value::Object(fields) => fields.values_mut().for_each(normalize_integers),
            Value::Number(n) if n.is_f64() => {
                let f = n.as_f64().unwrap();
                if f >= 0.0 && f <= f64::from(u32::MAX) && f.fract() == 0.0 {
                    *value = Value::from(f as u32);
                }
            }
            _ => {}
        }
    }
    normalize_integers(&mut value);
    static DEFS: OnceLock<Value> = OnceLock::new();
    let schema = DEFS.get_or_init(|| serde_json::from_str(SCHEMA).expect("bundled contract must parse"));
    validate(&value, &schema["$defs"]["MobileSnapshotV1"], &schema["$defs"], "snapshot")?;
    let snapshot: MobileSnapshotV1 = serde_json::from_value(value).map_err(|_| invalid("types"))?;
    if expected.is_some_and(|(installation, profile)| snapshot.installation_id != installation || snapshot.profile.id != profile) {
        return Err(invalid("identity"));
    }
    invariant(&snapshot)?;
    Ok(snapshot)
}
/// Validate producer output too; overflow/incomplete output fails instead of clipping history.
pub fn serialize_mobile_snapshot(snapshot: &MobileSnapshotV1) -> Result<String, String> {
    let json = serde_json::to_string(snapshot).map_err(|_| invalid("serialization"))?;
    parse_mobile_snapshot(&json, None)?;
    Ok(json)
}
