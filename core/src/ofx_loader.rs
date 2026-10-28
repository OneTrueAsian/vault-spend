//! Loads transactions from OFX/QFX bank exports. OFX 1.x (the common QFX
//! variant) is SGML, not XML — leaf tags like `<DTPOSTED>` routinely have
//! no closing tag at all, so this is a tolerant tag-scanner rather than a
//! strict parser, not a dependency on any XML/SGML crate. Tags are read
//! wherever they sit, so it does not matter whether a bank puts one tag per
//! line or the whole file on a single line. OFX 2.x (proper XML, closing
//! tags included) still parses correctly here since a closing tag is just
//! the end of the value before it.
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

    for tag in ofx_tags(content) {
        match tag.name.as_str() {
            "STMTTRN" => {
                // A new record opening while one is still open means the earlier one lost its closing tag.
                if in_txn {
                    errors.push(unclosed_record(txn_start_line));
                }
                in_txn = true;
                date = None;
                amount = None;
                name = None;
                memo = None;
                txn_start_line = tag.line;
            }
            "/STMTTRN" => {
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
            }
            "DTPOSTED" if in_txn => date = Some(tag.value),
            "TRNAMT" if in_txn => amount = Some(tag.value),
            "NAME" if in_txn => name = Some(tag.value),
            "MEMO" if in_txn => memo = Some(tag.value),
            _ => {}
        }
    }
    if in_txn {
        errors.push(unclosed_record(txn_start_line));
    }

    LoadResult {
        transactions,
        errors,
        ..Default::default()
    }
}

fn unclosed_record(start_line: usize) -> RowError {
    RowError {
        row_number: start_line,
        message: "transaction never closed (no </STMTTRN>)".to_string(),
    }
}

/// One `<TAG>value` found in the file: the uppercased tag name (a closing tag keeps its leading
/// `/`), the text that follows it up to the next tag or the end of the line (trimmed), and the line
/// the tag is on. Tags are found wherever they sit, so a file with every tag on one line reads the
/// same as one with a tag per line.
struct OfxTag {
    name: String,
    value: String,
    line: usize,
}

fn ofx_tags(content: &str) -> Vec<OfxTag> {
    let mut tags = Vec::new();
    let mut line = 1usize;
    let mut rest = content;
    while let Some(open) = rest.find('<') {
        line += rest[..open].matches('\n').count();
        let after = &rest[open + 1..];
        let Some(close) = after.find('>') else {
            break;
        };
        let name = &after[..close];
        // "a < b" or "<<>" is text, not a tag: skip just this '<' and keep looking.
        if name.contains(['<', '\n', '\r']) {
            rest = after;
            continue;
        }
        let tail = &after[close + 1..];
        let value_end = tail.find(['<', '\n', '\r']).unwrap_or(tail.len());
        tags.push(OfxTag {
            name: name.trim().to_ascii_uppercase(),
            value: tail[..value_end].trim().to_string(),
            line,
        });
        rest = tail;
    }
    tags
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

    // QA-FUNC-005: records are read by their tags, not by where the bank put its line breaks.
    const LINE_BROKEN_1X: &str = "\
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
<FITID>1
<NAME>Green Leaf Grocers
<MEMO>POS Purchase
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260810120000.000[-5:EST]
<TRNAMT>3000.00
<FITID>2
<NAME>Payroll Deposit
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
";

    fn summary(result: &LoadResult) -> Vec<(String, String, String)> {
        result
            .transactions
            .iter()
            .map(|t| (t.date.to_string(), t.description.clone(), t.amount.to_string()))
            .collect()
    }

    #[test]
    fn a_compact_ofx_1x_file_on_one_line_reads_the_same_as_the_line_broken_one() {
        let compact = LINE_BROKEN_1X.lines().skip(4).collect::<Vec<_>>().join("");
        assert!(!compact.contains('\n'));

        let result = parse_ofx(&compact, false);

        assert!(result.errors.is_empty(), "unexpected errors: {:?}", result.errors);
        assert_eq!(summary(&result), summary(&parse_ofx(LINE_BROKEN_1X, false)));
        assert_eq!(result.transactions.len(), 2);
        assert_eq!(result.transactions[0].amount, "-42.50".parse().unwrap());
        assert_eq!(result.transactions[0].description, "Green Leaf Grocers — POS Purchase");
        assert_eq!(result.transactions[1].date, "2026-08-10".parse().unwrap());
    }

    #[test]
    fn a_compact_ofx_2x_file_on_one_line_reads_the_same_as_the_line_broken_one() {
        let broken = "\
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260805</DTPOSTED>
<TRNAMT>-42.50</TRNAMT>
<NAME>Green Leaf Grocers</NAME>
<MEMO>POS Purchase</MEMO>
</STMTTRN>
<STMTTRN>
<DTPOSTED>20260810</DTPOSTED>
<TRNAMT>3000.00</TRNAMT>
<NAME>Payroll Deposit</NAME>
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
";
        let compact = broken.replace('\n', "");

        let result = parse_ofx(&compact, false);

        assert!(result.errors.is_empty(), "unexpected errors: {:?}", result.errors);
        assert_eq!(summary(&result), summary(&parse_ofx(broken, false)));
        assert_eq!(result.transactions.len(), 2);
    }

    #[test]
    fn several_tags_per_line_in_any_mix_read_the_same_as_one_tag_per_line() {
        let mixed = "<OFX><STMTTRN><DTPOSTED>20260805\n<TRNAMT>-42.50 <NAME>Green Leaf Grocers\n<MEMO>POS Purchase</STMTTRN><STMTTRN><DTPOSTED>20260810<TRNAMT>3000.00\n<NAME>Payroll Deposit</STMTTRN></OFX>";

        let result = parse_ofx(mixed, false);

        assert!(result.errors.is_empty(), "unexpected errors: {:?}", result.errors);
        assert_eq!(
            summary(&result),
            vec![
                ("2026-08-05".to_string(), "Green Leaf Grocers — POS Purchase".to_string(), "-42.50".to_string()),
                ("2026-08-10".to_string(), "Payroll Deposit".to_string(), "3000.00".to_string()),
            ]
        );
    }

    #[test]
    fn windows_line_endings_and_lowercase_tags_still_read() {
        let ofx = "<stmttrn>\r\n<dtposted>20260805\r\n<trnamt>-1.25\r\n<name>Cafe\r\n</stmttrn>\r\n";

        let result = parse_ofx(ofx, false);

        assert!(result.errors.is_empty(), "unexpected errors: {:?}", result.errors);
        assert_eq!(summary(&result), vec![("2026-08-05".to_string(), "Cafe".to_string(), "-1.25".to_string())]);
    }

    #[test]
    fn compact_signs_and_invert_amounts_behave_as_before() {
        let compact = "<STMTTRN><DTPOSTED>20260805<TRNAMT>-42.50<NAME>Charge</STMTTRN><STMTTRN><DTPOSTED>20260806<TRNAMT>10.00<NAME>Refund</STMTTRN>";

        let plain = parse_ofx(compact, false);
        let flipped = parse_ofx(compact, true);

        assert_eq!(plain.transactions[0].amount, "-42.50".parse().unwrap());
        assert_eq!(plain.transactions[1].amount, "10.00".parse().unwrap());
        assert_eq!(flipped.transactions[0].amount, "42.50".parse().unwrap());
        assert_eq!(flipped.transactions[1].amount, "-10.00".parse().unwrap());
    }

    #[test]
    fn a_value_with_non_ascii_text_is_kept_whole() {
        let compact = "<STMTTRN><DTPOSTED>20260805<TRNAMT>-4.00<NAME>Café Zoë — Crème<MEMO>naïve</STMTTRN>";

        let result = parse_ofx(compact, false);

        assert_eq!(result.transactions[0].description, "Café Zoë — Crème — naïve");
    }

    #[test]
    fn a_compact_record_missing_its_amount_is_one_row_error_and_the_others_still_load() {
        let compact = "<STMTTRN><DTPOSTED>20260805<NAME>No amount</STMTTRN><STMTTRN><DTPOSTED>20260806<TRNAMT>-3.00<NAME>Fine</STMTTRN>";

        let result = parse_ofx(compact, false);

        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].message, "missing TRNAMT");
        assert_eq!(result.errors[0].row_number, 1);
        assert_eq!(summary(&result), vec![("2026-08-06".to_string(), "Fine".to_string(), "-3.00".to_string())]);
    }

    #[test]
    fn an_error_names_the_line_its_record_starts_on() {
        let ofx = "<OFX>\n<STMTTRN>\n<DTPOSTED>20260805\n<NAME>Fine\n<TRNAMT>-1.00\n</STMTTRN>\n<STMTTRN><DTPOSTED>20260806<NAME>Bad</STMTTRN>\n";

        let result = parse_ofx(ofx, false);

        assert_eq!(result.transactions.len(), 1);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].row_number, 7);
    }

    #[test]
    fn a_record_that_never_closes_is_reported_instead_of_silently_dropped() {
        let compact = "<STMTTRN><DTPOSTED>20260805<TRNAMT>-3.00<NAME>Fine</STMTTRN><STMTTRN><DTPOSTED>20260806<TRNAMT>-9.00<NAME>Cut off";

        let result = parse_ofx(compact, false);

        assert_eq!(result.transactions.len(), 1);
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].message.contains("never closed"), "got: {}", result.errors[0].message);
    }

    #[test]
    fn a_new_record_opening_before_the_last_closed_reports_the_unfinished_one() {
        let compact = "<STMTTRN><DTPOSTED>20260805<TRNAMT>-3.00<NAME>Lost<STMTTRN><DTPOSTED>20260806<TRNAMT>-9.00<NAME>Kept</STMTTRN>";

        let result = parse_ofx(compact, false);

        assert_eq!(summary(&result), vec![("2026-08-06".to_string(), "Kept".to_string(), "-9.00".to_string())]);
        assert_eq!(result.errors.len(), 1);
    }

    #[test]
    fn text_with_no_transactions_gives_nothing_and_does_not_panic() {
        for text in ["", "just some words", "<<<>>>", "<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>", "<STMTTRN", "</STMTTRN>"] {
            let result = parse_ofx(text, false);
            assert!(result.transactions.is_empty(), "{text}");
        }
    }

    #[test]
    fn tags_outside_a_record_are_ignored_even_on_the_same_line() {
        let compact = "<OFX><NAME>Bank Name<STMTTRN><DTPOSTED>20260805<TRNAMT>-3.00<NAME>Shop</STMTTRN><MEMO>trailer</OFX>";

        let result = parse_ofx(compact, false);

        assert_eq!(summary(&result), vec![("2026-08-05".to_string(), "Shop".to_string(), "-3.00".to_string())]);
        assert!(result.errors.is_empty());
    }
}
