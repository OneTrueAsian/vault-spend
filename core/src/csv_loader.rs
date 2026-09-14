use crate::models::Transaction;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::fmt;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::str::FromStr;

/// One row that failed to parse, keyed by its 1-based line number in the
/// source file (counting the header row as line 1) so it's easy to find in
/// the original CSV.
#[derive(Debug, Clone, PartialEq)]
pub struct RowError {
    pub row_number: usize,
    pub message: String,
}

impl fmt::Display for RowError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "row {}: {}", self.row_number, self.message)
    }
}

/// Malformed rows are collected in `errors` rather than aborting the whole
/// import — a handful of bad rows shouldn't cost the user every good one.
///
/// `account_names` and `tags` are parallel to `transactions` (same index,
/// same length) — populated only when the source has its own "Account" /
/// "Tags" column, which a real bank export never does but this app's own
/// Transactions CSV export does (see `toCsv`'s headers in `src/App.tsx`), so a
/// round-tripped export can restore both instead of losing them. `None` /
/// empty for every row otherwise.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct LoadResult {
    pub transactions: Vec<Transaction>,
    pub errors: Vec<RowError>,
    pub account_names: Vec<Option<String>>,
    pub tags: Vec<Vec<String>>,
}

/// Loads transactions from a CSV file at `path`. A header row is required;
/// `date`, `description` and `amount` columns are found by name (matched
/// case-insensitively, trimmed) so extra columns (balance, check number,
/// ...) and a different column order — as real bank exports commonly have —
/// don't matter. Dates accept `YYYY-MM-DD` or `M/D/YYYY`; amounts accept a
/// plain decimal or accounting style (`$1,234.56`, `($1,234.56)` for
/// negative). An optional "Category" column is used as each row's starting
/// category (skipping the auto-categorizer for that row entirely — see
/// `categorize_uncategorized`'s own `category.is_some()` check); optional
/// "Account" and "Tags" columns are likewise picked up when present — see
/// `LoadResult`'s own doc comment.
///
/// This crate's convention is negative = money out, positive = money in.
/// Some exports (credit-card statements in particular) use the opposite —
/// a charge shown as positive, a payment as negative — with no structural
/// way to tell that apart from a normal export (same column names). Set
/// `invert_amounts` to flip every parsed amount for exports like that; the
/// caller (ultimately the user, at import time) has to know which this is.
pub fn load_csv(path: impl AsRef<Path>, invert_amounts: bool) -> std::io::Result<LoadResult> {
    load_from_reader(File::open(path)?, invert_amounts)
}

/// The optional columns (found by name, same as `date`/`description`) that
/// only this app's own CSV export carries — a real bank export has none of
/// these, so every field here is routinely `None`.
#[derive(Debug, Default, Clone, Copy)]
struct ExtraColumns {
    account: Option<usize>,
    category: Option<usize>,
    tags: Option<usize>,
}

fn load_from_reader<R: Read>(reader: R, invert_amounts: bool) -> std::io::Result<LoadResult> {
    // Read without letting the csv crate consume row 1 as a header — some
    // real exports have no header at all, and we can only tell by looking.
    let mut csv_reader = csv::ReaderBuilder::new().has_headers(false).from_reader(reader);
    let mut rows = Vec::new();
    for record in csv_reader.records() {
        rows.push(record?);
    }

    let Some(first_row) = rows.first() else {
        return Ok(LoadResult::default());
    };

    // A real header ("Date", "Amount", ...) never parses as a valid date +
    // amount pair; a headerless export's first row always does. A
    // headerless file has no named columns at all, so it can never carry
    // Account/Category/Tags either — those stay None.
    let (date_col, description_col, amount_source, extra, data_rows, first_row_number) = if first_row_is_plain_data(first_row) {
        (0, 1, AmountSource::Single(2), ExtraColumns::default(), &rows[..], 1)
    } else {
        let date_col = find_date_column(first_row)?;
        let description_col = find_column_exact(first_row, "description").ok_or_else(|| missing_column("description"))?;
        let amount_source = find_amount_source(first_row)?;
        let extra = ExtraColumns {
            account: find_column_exact(first_row, "account"),
            category: find_column_exact(first_row, "category"),
            tags: find_column_exact(first_row, "tags"),
        };
        (date_col, description_col, amount_source, extra, &rows[1..], 2)
    };

    let mut result = LoadResult::default();
    for (idx, record) in data_rows.iter().enumerate() {
        let row_number = first_row_number + idx;
        match parse_row(record, date_col, description_col, &amount_source, &extra, invert_amounts) {
            Ok((tx, account_name, tags)) => {
                result.transactions.push(tx);
                result.account_names.push(account_name);
                result.tags.push(tags);
            }
            Err(message) => result.errors.push(RowError { row_number, message }),
        }
    }

    Ok(result)
}

/// A non-empty, trimmed cell at `col` (if any) — the shared "blank means
/// absent" rule for the optional Account/Category columns.
fn optional_cell(record: &csv::StringRecord, col: Option<usize>) -> Option<String> {
    col.and_then(|c| record.get(c))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Splits the Tags column the same way `toCsv` joins it (`"; "` — see
/// `src/App.tsx`'s transactions export), tolerating a lone `;` or extra spaces
/// from a hand-edited file.
fn parse_tags(record: &csv::StringRecord, col: Option<usize>) -> Vec<String> {
    let Some(raw) = col.and_then(|c| record.get(c)) else {
        return Vec::new();
    };
    raw.split(';').map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).collect()
}

/// True when the row parses cleanly as (date, _, amount) at the fixed
/// positions a headerless three-column export uses — the signal that this
/// is real data, not a header row.
fn first_row_is_plain_data(record: &csv::StringRecord) -> bool {
    let date_ok = record.get(0).is_some_and(|s| parse_date(s.trim()).is_ok());
    let amount_ok = record.get(2).is_some_and(|s| parse_amount(s.trim()).is_ok());
    date_ok && amount_ok
}

fn missing_column(name: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, format!("missing required column: {name}"))
}

fn find_column_exact(headers: &csv::StringRecord, name: &str) -> Option<usize> {
    headers.iter().position(|h| h.trim().eq_ignore_ascii_case(name))
}

/// Prefers a column literally named "date", then "transaction date" (the
/// date of purchase, more useful than "posted date" for categorization),
/// then falls back to the first header containing "date" at all.
fn find_date_column(headers: &csv::StringRecord) -> std::io::Result<usize> {
    find_column_exact(headers, "date")
        .or_else(|| find_column_exact(headers, "transaction date"))
        .or_else(|| headers.iter().position(|h| h.to_lowercase().contains("date")))
        .ok_or_else(|| missing_column("date"))
}

enum AmountSource {
    Single(usize),
    DebitCredit { debit: usize, credit: usize },
}

/// Prefers a single signed "amount" column; falls back to separate
/// "debit"/"credit" columns (as credit-card exports commonly use) — a
/// filled debit becomes a negative amount, a filled credit stays positive.
fn find_amount_source(headers: &csv::StringRecord) -> std::io::Result<AmountSource> {
    if let Some(col) = find_column_exact(headers, "amount") {
        return Ok(AmountSource::Single(col));
    }
    match (find_column_exact(headers, "debit"), find_column_exact(headers, "credit")) {
        (Some(debit), Some(credit)) => Ok(AmountSource::DebitCredit { debit, credit }),
        _ => Err(missing_column("amount (or debit/credit)")),
    }
}

fn parse_row(
    record: &csv::StringRecord,
    date_col: usize,
    description_col: usize,
    amount_source: &AmountSource,
    extra: &ExtraColumns,
    invert_amounts: bool,
) -> Result<(Transaction, Option<String>, Vec<String>), String> {
    let date_str = record.get(date_col).ok_or("missing date column")?;
    let raw_description = record.get(description_col).ok_or("missing description column")?;

    let date = parse_date(date_str.trim()).map_err(|_| format!("invalid date '{}'", date_str.trim()))?;

    let description = clean_description(raw_description);
    if description.is_empty() {
        return Err("empty description".to_string());
    }

    let mut amount = extract_amount(record, amount_source)?;
    if invert_amounts {
        amount = -amount;
    }

    let category = optional_cell(record, extra.category);
    let account_name = optional_cell(record, extra.account);
    let tags = parse_tags(record, extra.tags);

    Ok((
        Transaction {
            date,
            description,
            amount,
            category,
        },
        account_name,
        tags,
    ))
}

fn extract_amount(record: &csv::StringRecord, source: &AmountSource) -> Result<Decimal, String> {
    match *source {
        AmountSource::Single(col) => {
            let raw = record.get(col).ok_or("missing amount column")?.trim();
            parse_amount(raw).map_err(|_| format!("invalid amount '{raw}'"))
        }
        AmountSource::DebitCredit { debit, credit } => {
            let debit_str = record.get(debit).unwrap_or("").trim();
            let credit_str = record.get(credit).unwrap_or("").trim();
            if !debit_str.is_empty() {
                parse_amount(debit_str)
                    .map(|v| -v.abs())
                    .map_err(|_| format!("invalid debit amount '{debit_str}'"))
            } else if !credit_str.is_empty() {
                parse_amount(credit_str)
                    .map(|v| v.abs())
                    .map_err(|_| format!("invalid credit amount '{credit_str}'"))
            } else {
                Err("row has neither a debit nor a credit amount".to_string())
            }
        }
    }
}

fn parse_date(s: &str) -> Result<NaiveDate, ()> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .or_else(|_| NaiveDate::parse_from_str(s, "%m/%d/%Y"))
        .map_err(|_| ())
}

/// Accepts a plain decimal ("-1850.00") or accounting style ("$1,234.56",
/// "($1,234.56)" for negative — the convention this crate's real bank
/// exports use).
fn parse_amount(s: &str) -> Result<Decimal, ()> {
    let s = s.trim();
    let negative = s.starts_with('(') && s.ends_with(')');
    let inner = if negative { &s[1..s.len() - 1] } else { s };
    let cleaned: String = inner.chars().filter(|c| *c != '$' && *c != ',').collect();

    let value = Decimal::from_str(cleaned.trim()).map_err(|_| ())?;
    Ok(if negative { -value } else { value })
}

/// Real exports pack a multi-line memo into one field with literal
/// "<br />" separators — only the first line is the merchant name that
/// matters for categorization; the rest is transaction-id/trace noise.
fn clean_description(raw: &str) -> String {
    raw.split("<br />")
        .next()
        .unwrap_or(raw)
        .replace("&amp;", "&")
        .replace("&gt;", ">")
        .replace("&lt;", "<")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn load_str(csv_text: &str) -> LoadResult {
        load_from_reader(Cursor::new(csv_text), false).expect("reader itself should not fail")
    }

    #[test]
    fn parses_valid_rows() {
        let result = load_str(
            "date,description,amount\n\
             2026-08-20,Union Realty,-1850.00\n\
             2026-08-26,Payroll Deposit,3120.00\n",
        );

        assert!(result.errors.is_empty());
        assert_eq!(result.transactions.len(), 2);

        let rent = &result.transactions[0];
        assert_eq!(rent.date, chrono::NaiveDate::from_ymd_opt(2026, 8, 20).unwrap());
        assert_eq!(rent.description, "Union Realty");
        assert_eq!(rent.amount, "-1850.00".parse().unwrap());
        assert_eq!(rent.category, None);

        let payroll = &result.transactions[1];
        assert_eq!(payroll.amount, "3120.00".parse().unwrap());
    }

    #[test]
    fn trims_whitespace_in_description() {
        let result = load_str("date,description,amount\n2026-08-20,  Union Realty  ,-1850.00\n");
        assert_eq!(result.transactions[0].description, "Union Realty");
    }

    #[test]
    fn reports_malformed_row_without_dropping_good_ones() {
        let result = load_str(
            "date,description,amount\n\
             2026-08-20,Union Realty,-1850.00\n\
             not-a-date,Broken Row,-10.00\n\
             2026-08-26,Payroll Deposit,3120.00\n",
        );

        // the two good rows still come through
        assert_eq!(result.transactions.len(), 2);

        // the bad row is reported against its real CSV line number, not dropped silently
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].row_number, 3);
        assert!(result.errors[0].message.contains("not-a-date"));
    }

    #[test]
    fn rejects_empty_description() {
        let result = load_str("date,description,amount\n2026-08-20,,-1850.00\n");
        assert_eq!(result.transactions.len(), 0);
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].message.contains("description"));
    }

    #[test]
    fn rejects_invalid_amount() {
        let result = load_str("date,description,amount\n2026-08-20,Union Realty,not-a-number\n");
        assert_eq!(result.transactions.len(), 0);
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].message.contains("not-a-number"));
    }

    // The tests below capture quirks of a real bank export: columns in a
    // different order with extra columns in between, US-style dates,
    // accounting-style amounts ($, commas, parens for negative), and
    // multi-line descriptions joined with literal "<br />" tags.

    #[test]
    fn columns_are_matched_by_header_name_not_position() {
        let result = load_str(
            "Date,Description,Comments,Check Number, Amount, Balance\n\
             \"8/3/2026\",\"WITHDRAWAL LMCU MORTGAGE\",\"\",\"\",\"($2,405.94)\",\"$26,817.37\"\n",
        );

        assert!(result.errors.is_empty());
        let tx = &result.transactions[0];
        assert_eq!(tx.date, chrono::NaiveDate::from_ymd_opt(2026, 8, 3).unwrap());
        assert_eq!(tx.description, "WITHDRAWAL LMCU MORTGAGE");
        assert_eq!(tx.amount, "-2405.94".parse().unwrap());
    }

    #[test]
    fn parses_a_positive_amount_with_dollar_sign_and_thousands_comma() {
        let result = load_str(
            "Date,Description,Comments,Check Number, Amount, Balance\n\
             \"4/1/2026\",\"DEPOSIT RBC MINISTRIES\",\"\",\"\",\"$1,753.26\",\"$9,327.12\"\n",
        );

        assert!(result.errors.is_empty());
        assert_eq!(result.transactions[0].amount, "1753.26".parse().unwrap());
    }

    #[test]
    fn strips_html_br_tags_keeping_only_the_merchant_line() {
        let result = load_str(
            "Date,Description,Comments,Check Number, Amount, Balance\n\
             \"8/4/2026\",\"WITHDRAWAL CONSUMERS ENERGY<br />TYPE: ENERGYBILL  ID: *2310<br />CO: CONSUMERS ENERGY\",\"\",\"\",\"($126.00)\",\"$26,691.37\"\n",
        );

        assert!(result.errors.is_empty());
        assert_eq!(result.transactions[0].description, "WITHDRAWAL CONSUMERS ENERGY");
    }

    #[test]
    fn missing_a_required_column_is_reported_as_an_error_up_front() {
        let outcome = load_from_reader(Cursor::new("Date,Description,Comments\n2026-08-20,Union Realty,\n"), false);
        assert!(outcome.is_err(), "expected an error when the amount column is missing entirely");
    }

    // A third real-world shape: a credit card export with no single Amount
    // column at all (separate Debit/Credit columns instead) and two date
    // columns (Transaction Date vs Posted Date — not literally "Date").

    #[test]
    fn derives_amount_from_separate_debit_and_credit_columns() {
        let result = load_str(
            "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n\
             2026-08-25,2026-08-26,2392,SAMS CLUB #6359,Merchandise,167.99,\n\
             2026-08-10,2026-08-10,2392,CAPITAL ONE ONLINE PYMT,Payment/Credit,,5800.00\n",
        );

        assert!(result.errors.is_empty());
        assert_eq!(result.transactions.len(), 2);

        let purchase = &result.transactions[0];
        assert_eq!(purchase.description, "SAMS CLUB #6359");
        assert_eq!(purchase.amount, "-167.99".parse().unwrap());

        let payment = &result.transactions[1];
        assert_eq!(payment.amount, "5800.00".parse().unwrap());
    }

    #[test]
    fn prefers_transaction_date_over_posted_date_when_there_is_no_plain_date_column() {
        let result = load_str(
            "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n\
             2026-08-25,2026-08-26,2392,SAMS CLUB #6359,Merchandise,167.99,\n",
        );

        assert_eq!(result.transactions[0].date, chrono::NaiveDate::from_ymd_opt(2026, 8, 25).unwrap());
    }

    #[test]
    fn a_row_with_neither_debit_nor_credit_populated_is_a_row_error_not_a_zero_amount() {
        let result = load_str(
            "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n\
             2026-08-25,2026-08-26,2392,SAMS CLUB #6359,Merchandise,167.99,\n\
             2026-08-26,2026-08-27,2392,MYSTERY ROW,Other,,\n",
        );

        assert_eq!(result.transactions.len(), 1);
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].message.contains("debit") || result.errors[0].message.contains("credit"));
    }

    #[test]
    fn missing_amount_debit_and_credit_columns_is_an_error_up_front() {
        let outcome = load_from_reader(
            Cursor::new("Transaction Date,Posted Date,Card No.,Description,Category\n2026-08-20,2026-08-21,1,Union Realty\n"),
            false,
        );
        assert!(outcome.is_err());
    }

    // A fourth real-world shape: a credit-card *statement* export using the
    // opposite sign convention from everything else — a charge is positive
    // (it increases what you owe), a payment is negative (it decreases what
    // you owe) — versus this crate's negative-means-money-out convention.

    #[test]
    fn invert_amounts_option_controls_whether_signs_flip() {
        // invert_amounts=true: a charge (positive in the file) becomes a
        // negative expense, a payment (negative in the file) becomes a
        // positive credit.
        let inverted = load_from_reader(
            Cursor::new(
                "Date,Description,Amount\n\
                 08/27/2026,APPLE.COM/BILL,2.99\n\
                 08/05/2026,AUTOPAY PAYMENT - THANK YOU,-43.08\n",
            ),
            true,
        )
        .unwrap();
        assert!(inverted.errors.is_empty());
        assert_eq!(inverted.transactions[0].amount, "-2.99".parse().unwrap());
        assert_eq!(inverted.transactions[1].amount, "43.08".parse().unwrap());

        // invert_amounts=false: signs are left exactly as in the file.
        let not_inverted = load_from_reader(Cursor::new("Date,Description,Amount\n08/27/2026,APPLE.COM/BILL,2.99\n"), false).unwrap();
        assert_eq!(not_inverted.transactions[0].amount, "2.99".parse().unwrap());
    }

    // A fifth real-world shape: no header row at all — every line, including
    // the first, is a plain (date, description, amount) data row.

    #[test]
    fn a_file_with_no_header_row_is_detected_and_every_row_is_parsed() {
        let result = load_str(
            "2026-08-05,\"Internet transfer to LAKE MICHIGAN CREDIT UNION\",-5800.0\n\
             2026-08-05,\"Internet transfer from LAKE MICHIGAN CREDIT UNION\",19000.0\n\
             2026-08-02,\"Interest Payment\",117.07\n",
        );

        assert!(result.errors.is_empty());
        assert_eq!(result.transactions.len(), 3, "the first row must not be mistaken for a header");
        assert_eq!(result.transactions[0].description, "Internet transfer to LAKE MICHIGAN CREDIT UNION");
        assert_eq!(result.transactions[0].amount, "-5800.0".parse().unwrap());
        assert_eq!(result.transactions[2].amount, "117.07".parse().unwrap());
    }

    #[test]
    fn a_leading_utf8_bom_does_not_break_header_column_matching() {
        // Excel's "CSV UTF-8" save option prepends a byte-order-mark —
        // left un-stripped, it silently attaches to the first header cell
        // ("date" becomes "\u{FEFF}date"), breaking find_column_exact's
        // match and turning a perfectly valid export into a "missing
        // required column: date" error.
        let mut bytes = vec![0xEFu8, 0xBB, 0xBF];
        bytes.extend_from_slice(b"date,description,amount\n2026-08-20,Union Realty,-1850.00\n");
        let result = load_from_reader(Cursor::new(bytes), false).unwrap();

        assert!(result.errors.is_empty());
        assert_eq!(result.transactions.len(), 1);
        assert_eq!(result.transactions[0].description, "Union Realty");
    }

    #[test]
    fn a_headerless_files_malformed_row_still_reports_its_real_line_number() {
        let result = load_str(
            "2026-08-05,Good Row,-5800.0\n\
             not-a-date,Broken Row,-10.00\n",
        );

        assert_eq!(result.transactions.len(), 1);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].row_number, 2);
    }

    // A sixth shape: this app's own Transactions CSV export (Date, Description,
    // Amount, Account, Category, Tags — see `toCsv`'s headers in
    // `src/App.tsx`), re-imported. The round trip only works if these
    // extra columns are actually read back, not just tolerated as noise
    // like a bank export's balance/check-number columns are.

    #[test]
    fn reads_back_this_apps_own_exported_account_category_and_tags_columns() {
        let result = load_str(
            "Date,Description,Amount,Account,Category,Tags\n\
             2026-08-20,Union Realty,-1850.00,Checking,Rent,\n\
             2026-08-26,Farmers Market,-42.50,Checking,Groceries,weekend; cash\n",
        );

        assert!(result.errors.is_empty());
        assert_eq!(result.transactions.len(), 2);
        assert_eq!(result.account_names, vec![Some("Checking".to_string()), Some("Checking".to_string())]);
        assert_eq!(result.transactions[0].category.as_deref(), Some("Rent"));
        assert_eq!(result.tags[0], Vec::<String>::new());
        assert_eq!(result.transactions[1].category.as_deref(), Some("Groceries"));
        assert_eq!(result.tags[1], vec!["weekend".to_string(), "cash".to_string()]);
    }

    #[test]
    fn a_blank_category_or_account_cell_is_none_not_an_empty_string() {
        let result = load_str("Date,Description,Amount,Account,Category,Tags\n2026-08-20,Union Realty,-1850.00,,,\n");

        assert_eq!(result.account_names, vec![None]);
        assert_eq!(result.transactions[0].category, None);
        assert_eq!(result.tags[0], Vec::<String>::new());
    }

    #[test]
    fn a_real_bank_export_without_those_columns_leaves_account_and_tags_empty() {
        // Confirms the new optional columns don't change behavior for the
        // overwhelmingly common case — a real bank CSV never has them.
        let result = load_str("date,description,amount\n2026-08-20,Union Realty,-1850.00\n");

        assert_eq!(result.account_names, vec![None]);
        assert_eq!(result.transactions[0].category, None);
        assert_eq!(result.tags[0], Vec::<String>::new());
    }
}
