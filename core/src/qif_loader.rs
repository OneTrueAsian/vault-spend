//! Loads transactions from QIF (Quicken Interchange Format) exports — a
//! simple line-based, non-XML format: one-letter field codes (`D`ate,
//! `T`/`U` amount, `P`ayee, `M`emo, `L`category, ...) per line, records
//! separated by a line containing just `^`.
use crate::csv_loader::{LoadResult, RowError};
use crate::models::Transaction;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::fs::File;
use std::io::Read;
use std::path::Path;

/// Loads transactions from a QIF file at `path`. QIF amounts are already
/// signed correctly per convention (negative = money out, matching this
/// crate's own) — `invert_amounts` is honored for consistency with the
/// other loaders, for a file that doesn't follow it.
///
/// **`L` (category) lines are intentionally ignored** — every transaction
/// here comes back with `category: None`, same as `csv_loader::load_csv`,
/// so QIF imports go through the identical rules/classifier
/// auto-categorization pipeline as every other format rather than being a
/// special case.
pub fn load_qif(path: impl AsRef<Path>, invert_amounts: bool) -> std::io::Result<LoadResult> {
    let mut content = String::new();
    File::open(path)?.read_to_string(&mut content)?;
    Ok(parse_qif(&content, invert_amounts))
}

fn parse_qif(content: &str, invert_amounts: bool) -> LoadResult {
    let mut transactions = Vec::new();
    let mut errors = Vec::new();

    let mut date: Option<String> = None;
    let mut amount: Option<String> = None;
    let mut payee: Option<String> = None;
    let mut memo: Option<String> = None;
    let mut has_any_field = false;
    let mut record_start_line = 1usize;

    for (index, raw_line) in content.lines().enumerate() {
        let row_number = index + 1;
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('!') {
            continue;
        }
        if line == "^" {
            if has_any_field {
                match build_transaction(date.take(), amount.take(), payee.take(), memo.take(), invert_amounts) {
                    Ok(tx) => transactions.push(tx),
                    Err(message) => errors.push(RowError {
                        row_number: record_start_line,
                        message,
                    }),
                }
            }
            has_any_field = false;
            record_start_line = row_number + 1;
            continue;
        }

        has_any_field = true;
        let (code, value) = line.split_at(1);
        let value = value.trim().to_string();
        match code {
            "D" => date = Some(value),
            "T" | "U" => amount = Some(value),
            "P" => payee = Some(value),
            "M" => memo = Some(value),
            _ => {} // L (category, intentionally ignored), N, C, etc.
        }
    }

    // A file missing its final "^" separator still has one real record
    // worth of fields sitting unflushed — don't silently drop it.
    if has_any_field {
        match build_transaction(date, amount, payee, memo, invert_amounts) {
            Ok(tx) => transactions.push(tx),
            Err(message) => errors.push(RowError {
                row_number: record_start_line,
                message,
            }),
        }
    }

    LoadResult {
        transactions,
        errors,
        ..Default::default()
    }
}

fn build_transaction(
    date: Option<String>,
    amount: Option<String>,
    payee: Option<String>,
    memo: Option<String>,
    invert_amounts: bool,
) -> Result<Transaction, String> {
    let date_str = date.ok_or_else(|| "missing date (D) line".to_string())?;
    let amount_str = amount.ok_or_else(|| "missing amount (T/U) line".to_string())?;
    let description = match (payee, memo) {
        (Some(p), Some(m)) if !m.is_empty() && m != p => format!("{p} — {m}"),
        (Some(p), _) => p,
        (None, Some(m)) => m,
        (None, None) => return Err("missing payee (P) line".to_string()),
    };
    if description.trim().is_empty() {
        return Err("empty description".to_string());
    }
    let date = parse_qif_date(&date_str)?;
    let mut amount: Decimal = amount_str.replace(',', "").parse().map_err(|_| format!("invalid amount: {amount_str}"))?;
    if invert_amounts {
        amount = -amount;
    }
    Ok(Transaction {
        date,
        description,
        amount,
        category: None,
    })
}

/// QIF dates commonly use `MM/DD/YYYY`, `MM/DD/YY`, or `MM/DD'YY` (an
/// apostrophe standing in for the century) — the apostrophe form is
/// normalized to a slash first. A 2-digit year is expanded by hand using
/// the common 00-68 -> 2000s / 69-99 -> 1900s convention — checked by the
/// year substring's actual length, not by trying `%Y` and falling back on
/// failure, since chrono's `%Y` happily accepts a bare 2-digit number as
/// the literal year (26 -> 0026), not a year needing expansion.
fn parse_qif_date(s: &str) -> Result<NaiveDate, String> {
    let normalized = s.replace('\'', "/");
    let parts: Vec<&str> = normalized.split('/').collect();
    let [month, day, year] = parts[..] else {
        return Err(format!("invalid date: {s}"));
    };
    let full_year = if year.len() <= 2 {
        let two_digit_year: u32 = year.parse().map_err(|_| format!("invalid date: {s}"))?;
        if two_digit_year <= 68 {
            2000 + two_digit_year
        } else {
            1900 + two_digit_year
        }
    } else {
        year.parse().map_err(|_| format!("invalid date: {s}"))?
    };
    let expanded = format!("{month}/{day}/{full_year:04}");
    NaiveDate::parse_from_str(&expanded, "%m/%d/%Y").map_err(|_| format!("invalid date: {s}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_qif_transactions() {
        let qif = "\
!Type:Bank
D08/05/2026
T-42.50
PGreen Leaf Grocers
MPOS Purchase
LGroceries
^
D08/10/2026
T3000.00
PPayroll Deposit
^
";
        let result = parse_qif(qif, false);

        assert!(result.errors.is_empty(), "unexpected errors: {:?}", result.errors);
        assert_eq!(result.transactions.len(), 2);
        assert_eq!(result.transactions[0].date, "2026-08-05".parse().unwrap());
        assert_eq!(result.transactions[0].description, "Green Leaf Grocers — POS Purchase");
        assert_eq!(result.transactions[0].amount, "-42.50".parse().unwrap());
        assert_eq!(result.transactions[1].description, "Payroll Deposit");
    }

    #[test]
    fn ignores_the_l_category_line() {
        let qif = "D08/05/2026\nT-42.50\nPGreen Leaf Grocers\nLGroceries\n^\n";
        let result = parse_qif(qif, false);

        assert_eq!(result.transactions[0].category, None);
    }

    #[test]
    fn a_record_missing_the_amount_is_a_row_error_not_a_panic_and_others_still_load() {
        let qif = "D08/05/2026\nPMissing Amount\n^\nD08/06/2026\nT-10.00\nPFine\n^\n";
        let result = parse_qif(qif, false);

        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.transactions.len(), 1);
        assert_eq!(result.transactions[0].description, "Fine");
    }

    #[test]
    fn parses_a_two_digit_year_with_apostrophe_separator() {
        let qif = "D8/5'26\nT-10.00\nPStore\n^\n";
        let result = parse_qif(qif, false);

        assert_eq!(result.transactions[0].date, "2026-08-05".parse().unwrap());
    }

    #[test]
    fn invert_amounts_flips_the_sign() {
        let qif = "D08/05/2026\nT-42.50\nPCharge\n^\n";
        let result = parse_qif(qif, true);

        assert_eq!(result.transactions[0].amount, "42.50".parse().unwrap());
    }

    #[test]
    fn a_missing_trailing_caret_still_parses_the_last_record() {
        let qif = "D08/05/2026\nT-10.00\nPNo Trailing Caret";
        let result = parse_qif(qif, false);

        assert_eq!(result.transactions.len(), 1);
        assert_eq!(result.transactions[0].description, "No Trailing Caret");
    }
}
