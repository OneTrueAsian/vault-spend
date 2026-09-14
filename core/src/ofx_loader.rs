//! Loads transactions from OFX/QFX bank exports. OFX 1.x (the common QFX
//! variant) is SGML, not XML — leaf tags like `<DTPOSTED>` routinely have
//! no closing tag at all, so this is a tolerant line-scanner rather than a
//! strict parser, not a dependency on any XML/SGML crate. OFX 2.x (proper
//! XML, closing tags included) still parses correctly here since a closing
//! tag on the same line is just stripped from the value.
use crate::csv_loader::{LoadResult, RowError};
use crate::models::Transaction;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::fs::File;
use std::io::Read;
use std::path::Path;

/// Loads transactions from an OFX/QFX file at `path`. `TRNAMT` is already
/// signed correctly per the OFX spec (negative = money out, matching this
/// crate's convention) — `invert_amounts` is honored for a file that
/// doesn't follow spec, same escape hatch `csv_loader::load_csv` offers.
pub fn load_ofx(path: impl AsRef<Path>, invert_amounts: bool) -> std::io::Result<LoadResult> {
    let mut content = String::new();
    File::open(path)?.read_to_string(&mut content)?;
    Ok(parse_ofx(&content, invert_amounts))
}

fn parse_ofx(content: &str, invert_amounts: bool) -> LoadResult {
    let mut transactions = Vec::new();
    let mut errors = Vec::new();

    let mut in_txn = false;
    let mut date: Option<String> = None;
    let mut amount: Option<String> = None;
    let mut name: Option<String> = None;
    let mut memo: Option<String> = None;
    let mut txn_start_line = 0usize;

    for (index, raw_line) in content.lines().enumerate() {
        let row_number = index + 1;
        let line = raw_line.trim();
        let upper = line.to_ascii_uppercase();

        if upper.starts_with("<STMTTRN>") {
            in_txn = true;
            date = None;
            amount = None;
            name = None;
            memo = None;
            txn_start_line = row_number;
            continue;
        }
        if upper.starts_with("</STMTTRN>") {
            if in_txn {
                match build_transaction(date.take(), amount.take(), name.take(), memo.take(), invert_amounts) {
                    Ok(tx) => transactions.push(tx),
                    Err(message) => errors.push(RowError {
                        row_number: txn_start_line,
                        message,
                    }),
                }
            }
            in_txn = false;
            continue;
        }
        if !in_txn {
            continue;
        }

        if let Some((tag, value)) = parse_sgml_tag(line) {
            match tag.as_str() {
                "DTPOSTED" => date = Some(value),
                "TRNAMT" => amount = Some(value),
                "NAME" => name = Some(value),
                "MEMO" => memo = Some(value),
                _ => {}
            }
        }
    }

    LoadResult {
        transactions,
        errors,
        ..Default::default()
    }
}

/// Parses one `<TAG>value` (or `<TAG>value</TAG>`) SGML/XML line — returns
/// the uppercased tag name and the value with any inline closing tag
/// stripped. `None` for a line that isn't a tag at all (blank lines,
/// stray text).
fn parse_sgml_tag(line: &str) -> Option<(String, String)> {
    if !line.starts_with('<') {
        return None;
    }
    let close_bracket = line.find('>')?;
    let tag = line[1..close_bracket].to_ascii_uppercase();
    let mut value = line[close_bracket + 1..].to_string();
    if let Some(end_tag_pos) = value.find("</") {
        value.truncate(end_tag_pos);
    }
    Some((tag, value.trim().to_string()))
}

fn build_transaction(
    date: Option<String>,
    amount: Option<String>,
    name: Option<String>,
    memo: Option<String>,
    invert_amounts: bool,
) -> Result<Transaction, String> {
    let date_str = date.ok_or_else(|| "missing DTPOSTED".to_string())?;
    let amount_str = amount.ok_or_else(|| "missing TRNAMT".to_string())?;
    let description = match (name, memo) {
        (Some(n), Some(m)) if !m.is_empty() && m != n => format!("{n} — {m}"),
        (Some(n), _) => n,
        (None, Some(m)) => m,
        (None, None) => return Err("missing NAME/MEMO".to_string()),
    };
    if description.trim().is_empty() {
        return Err("empty description".to_string());
    }
    let date = parse_ofx_date(&date_str)?;
    let mut amount: Decimal = amount_str.parse().map_err(|_| format!("invalid amount: {amount_str}"))?;
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

/// `DTPOSTED` is `YYYYMMDD`, optionally followed by a time and timezone
/// (`YYYYMMDDHHMMSS.XXX[gmt tz]`) — only the leading 8 digits matter here.
fn parse_ofx_date(s: &str) -> Result<NaiveDate, String> {
    let digits: String = s.chars().take(8).collect();
    NaiveDate::parse_from_str(&digits, "%Y%m%d").map_err(|_| format!("invalid date: {s}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_ofx_transactions() {
        let ofx = "\
OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260805
<TRNAMT>-42.50
<FITID>1234567890
<NAME>Green Leaf Grocers
<MEMO>POS Purchase
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260810120000
<TRNAMT>3000.00
<FITID>1234567891
<NAME>Payroll Deposit
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
";
        let result = parse_ofx(ofx, false);

        assert!(result.errors.is_empty(), "unexpected errors: {:?}", result.errors);
        assert_eq!(result.transactions.len(), 2);
        assert_eq!(result.transactions[0].date, "2026-08-05".parse().unwrap());
        assert_eq!(result.transactions[0].description, "Green Leaf Grocers — POS Purchase");
        assert_eq!(result.transactions[0].amount, "-42.50".parse().unwrap());
        assert_eq!(result.transactions[1].date, "2026-08-10".parse().unwrap());
        assert_eq!(result.transactions[1].description, "Payroll Deposit");
        assert_eq!(result.transactions[1].amount, "3000.00".parse().unwrap());
    }

    #[test]
    fn parses_ofx_2_style_transactions_with_closing_tags() {
        let ofx = "\
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260805</DTPOSTED>
<TRNAMT>-42.50</TRNAMT>
<NAME>Green Leaf Grocers</NAME>
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
";
        let result = parse_ofx(ofx, false);

        assert!(result.errors.is_empty(), "unexpected errors: {:?}", result.errors);
        assert_eq!(result.transactions.len(), 1);
        assert_eq!(result.transactions[0].amount, "-42.50".parse().unwrap());
    }

    #[test]
    fn a_transaction_missing_trnamt_is_a_row_error_not_a_panic_and_others_still_load() {
        let ofx = "\
<STMTTRN>
<DTPOSTED>20260805
<NAME>Missing Amount
</STMTTRN>
<STMTTRN>
<DTPOSTED>20260806
<TRNAMT>-10.00
<NAME>Fine
</STMTTRN>
";
        let result = parse_ofx(ofx, false);

        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.transactions.len(), 1);
        assert_eq!(result.transactions[0].description, "Fine");
    }

    #[test]
    fn invert_amounts_flips_the_sign() {
        let ofx = "\
<STMTTRN>
<DTPOSTED>20260805
<TRNAMT>-42.50
<NAME>Charge
</STMTTRN>
";
        let result = parse_ofx(ofx, true);

        assert_eq!(result.transactions[0].amount, "42.50".parse().unwrap());
    }

    #[test]
    fn uses_memo_alone_when_name_is_absent() {
        let ofx = "\
<STMTTRN>
<DTPOSTED>20260805
<TRNAMT>-10.00
<MEMO>Only a memo
</STMTTRN>
";
        let result = parse_ofx(ofx, false);

        assert_eq!(result.transactions[0].description, "Only a memo");
    }
}
