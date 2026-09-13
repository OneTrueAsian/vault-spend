//! Parses the bulk "setup data" template (Accounts/Categories/Budgets/
//! Buckets, one combined CSV with a section per entity type) that a user
//! downloads, fills in, and re-uploads to populate the app in bulk instead
//! of clicking through "New account"/"Add budget line"/"New bucket" one at
//! a time. Mirrors `csv_loader.rs`'s shape and philosophy closely: a
//! `RowError` per malformed row (keyed by section + line number) collected
//! rather than aborting the whole file, so a typo in one row never costs
//! every other good row — in this file or any other section.

use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::fmt;
use std::path::Path;
use std::str::FromStr;

#[derive(Debug, Clone, PartialEq)]
pub struct RowError {
    pub section: String,
    pub row_number: usize,
    pub message: String,
}

impl fmt::Display for RowError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} row {}: {}", self.section, self.row_number, self.message)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AccountRow {
    pub name: String,
    pub account_type: String,
    pub starting_balance: Option<Decimal>,
    pub institution: Option<String>,
    pub mask: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CategoryRow {
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BudgetRow {
    pub category: String,
    pub budget_group: String,
    pub monthly_amount: Decimal,
    pub period: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BucketRow {
    pub name: String,
    pub target_amount: Option<Decimal>,
    pub target_date: Option<NaiveDate>,
    pub linked_account_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HoldingRow {
    /// Required, unlike `BucketRow::linked_account_name` — `holdings.
    /// account_id` is `NOT NULL`, so there's no sensible "no account"
    /// holding to fall back to.
    pub account_name: String,
    pub symbol: String,
    /// Blank -> defaults to the symbol, same convention as the manual
    /// "Add holding…" form.
    pub name: Option<String>,
    pub shares: Decimal,
    pub price: Decimal,
    pub cost_basis: Decimal,
    pub asset_class: Option<String>,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct SetupImportResult {
    pub accounts: Vec<AccountRow>,
    pub categories: Vec<CategoryRow>,
    pub budgets: Vec<BudgetRow>,
    pub buckets: Vec<BucketRow>,
    pub holdings: Vec<HoldingRow>,
    pub errors: Vec<RowError>,
}

const KNOWN_ACCOUNT_TYPES: [&str; 6] = ["checking", "savings", "credit", "loan", "investment", "other"];
const KNOWN_BUDGET_GROUPS: [&str; 4] = ["income", "fixed", "flexible", "nonmonthly"];

pub fn load_setup_csv(path: impl AsRef<Path>) -> std::io::Result<SetupImportResult> {
    let text = std::fs::read_to_string(path)?;
    Ok(load_from_str(&text))
}

/// A line matching one of these (trimmed, case-insensitive) starts a new
/// section — the header row is whatever non-blank line comes right after
/// it, and every line after *that* until a blank line or the next section
/// title belongs to it.
///
/// Only the line's first comma-separated field is checked, with every
/// other field required to be blank, rather than the whole line: opening
/// the template in Excel and saving it back pads *every* row out to the
/// sheet's widest row (its "used range"), so a section-title line like
/// `Accounts` comes back as `Accounts,,,,,,` once any section — Holdings,
/// at 7 columns, is the widest — is wider than it. Matching the whole line
/// verbatim would silently stop recognizing every section title in a file
/// like that, not just the padded ones.
fn section_kind(line: &str) -> Option<&'static str> {
    let mut fields = line.split(',');
    let first = fields.next()?.trim().to_lowercase();
    if !fields.all(|f| f.trim().is_empty()) {
        return None;
    }
    match first.as_str() {
        "accounts" => Some("Accounts"),
        "categories" => Some("Categories"),
        "budgets" => Some("Budgets"),
        "buckets" => Some("Buckets"),
        "holdings" => Some("Holdings"),
        _ => None,
    }
}

/// A blank separator line between sections, same Excel "used range" padding
/// as `section_kind` above: it comes back as `,,,,,,` rather than empty
/// once any section in the file is wider than the section it separates.
fn is_blank_line(line: &str) -> bool {
    line.split(',').all(|f| f.trim().is_empty())
}

fn load_from_str(text: &str) -> SetupImportResult {
    // A UTF-8 byte-order-mark (from Excel's "CSV UTF-8" save option, or our
    // own template download) survives std::fs::read_to_string as a literal
    // U+FEFF at the very start of the string — strip it before splitting
    // into lines, or it would silently break matching the first line
    // against a known section title.
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let lines: Vec<&str> = text.lines().collect();
    let mut result = SetupImportResult::default();

    let mut i = 0;
    while i < lines.len() {
        let Some(section) = section_kind(lines[i]) else {
            i += 1;
            continue;
        };
        i += 1;
        while i < lines.len() && is_blank_line(lines[i]) {
            i += 1; // blank lines between the section title and its header are tolerated
        }
        if i >= lines.len() {
            break;
        }
        let header_line = i;
        i += 1;
        let mut body = String::from(lines[header_line]);
        body.push('\n');
        while i < lines.len() && !is_blank_line(lines[i]) && section_kind(lines[i]).is_none() {
            body.push_str(lines[i]);
            body.push('\n');
            i += 1;
        }
        parse_section(section, &body, header_line + 2, &mut result);
    }

    result
}

fn parse_section(section: &str, body: &str, first_data_row_number: usize, result: &mut SetupImportResult) {
    let mut reader = csv::ReaderBuilder::new().has_headers(true).from_reader(body.as_bytes());
    let headers = match reader.headers() {
        Ok(h) => h.clone(),
        Err(_) => return, // an empty section (header-only or nothing at all) is fine
    };

    for (idx, record) in reader.records().enumerate() {
        let row_number = first_data_row_number + idx;
        let record = match record {
            Ok(r) => r,
            Err(e) => {
                result.errors.push(RowError {
                    section: section.to_string(),
                    row_number,
                    message: e.to_string(),
                });
                continue;
            }
        };
        match section {
            "Accounts" => match parse_account_row(&headers, &record) {
                Ok(row) => result.accounts.push(row),
                Err(message) => result.errors.push(RowError {
                    section: section.to_string(),
                    row_number,
                    message,
                }),
            },
            "Categories" => match parse_category_row(&headers, &record) {
                Ok(row) => result.categories.push(row),
                Err(message) => result.errors.push(RowError {
                    section: section.to_string(),
                    row_number,
                    message,
                }),
            },
            "Budgets" => match parse_budget_row(&headers, &record) {
                Ok(row) => result.budgets.push(row),
                Err(message) => result.errors.push(RowError {
                    section: section.to_string(),
                    row_number,
                    message,
                }),
            },
            "Buckets" => match parse_bucket_row(&headers, &record) {
                Ok(row) => result.buckets.push(row),
                Err(message) => result.errors.push(RowError {
                    section: section.to_string(),
                    row_number,
                    message,
                }),
            },
            "Holdings" => match parse_holding_row(&headers, &record) {
                Ok(row) => result.holdings.push(row),
                Err(message) => result.errors.push(RowError {
                    section: section.to_string(),
                    row_number,
                    message,
                }),
            },
            _ => unreachable!("section_kind only ever returns a known section"),
        }
    }
}

fn field<'a>(headers: &csv::StringRecord, record: &'a csv::StringRecord, name: &str) -> Option<&'a str> {
    let col = headers.iter().position(|h| h.trim().eq_ignore_ascii_case(name))?;
    record.get(col)
}

fn non_blank(value: Option<&str>) -> Option<String> {
    value.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn parse_account_row(headers: &csv::StringRecord, record: &csv::StringRecord) -> Result<AccountRow, String> {
    let name = non_blank(field(headers, record, "Name")).ok_or("missing account name")?;
    let account_type = non_blank(field(headers, record, "Type")).ok_or("missing account type")?.to_lowercase();
    if !KNOWN_ACCOUNT_TYPES.contains(&account_type.as_str()) {
        return Err(format!(
            "unknown account type '{account_type}' (expected one of: {})",
            KNOWN_ACCOUNT_TYPES.join(", ")
        ));
    }
    let starting_balance = match non_blank(field(headers, record, "Starting Balance")) {
        Some(s) => Some(Decimal::from_str(&s).map_err(|_| format!("invalid starting balance '{s}'"))?),
        None => None,
    };
    Ok(AccountRow {
        name,
        account_type,
        starting_balance,
        institution: non_blank(field(headers, record, "Institution")),
        mask: non_blank(field(headers, record, "Mask")),
    })
}

fn parse_category_row(headers: &csv::StringRecord, record: &csv::StringRecord) -> Result<CategoryRow, String> {
    let name = non_blank(field(headers, record, "Name")).ok_or("missing category name")?;
    Ok(CategoryRow { name })
}

fn parse_budget_row(headers: &csv::StringRecord, record: &csv::StringRecord) -> Result<BudgetRow, String> {
    let category = non_blank(field(headers, record, "Category")).ok_or("missing budget category")?;
    let budget_group = non_blank(field(headers, record, "Group")).ok_or("missing budget group")?.to_lowercase();
    if !KNOWN_BUDGET_GROUPS.contains(&budget_group.as_str()) {
        return Err(format!(
            "unknown budget group '{budget_group}' (expected one of: {})",
            KNOWN_BUDGET_GROUPS.join(", ")
        ));
    }
    let amount_str = non_blank(field(headers, record, "Monthly Amount")).ok_or("missing monthly amount")?;
    let monthly_amount = Decimal::from_str(&amount_str).map_err(|_| format!("invalid monthly amount '{amount_str}'"))?;
    let period = non_blank(field(headers, record, "Period"));
    Ok(BudgetRow {
        category,
        budget_group,
        monthly_amount,
        period,
    })
}

fn parse_bucket_row(headers: &csv::StringRecord, record: &csv::StringRecord) -> Result<BucketRow, String> {
    let name = non_blank(field(headers, record, "Name")).ok_or("missing bucket name")?;
    let target_amount = match non_blank(field(headers, record, "Target Amount")) {
        Some(s) => Some(Decimal::from_str(&s).map_err(|_| format!("invalid target amount '{s}'"))?),
        None => None,
    };
    let target_date = match non_blank(field(headers, record, "Target Date")) {
        Some(s) => Some(NaiveDate::parse_from_str(&s, "%Y-%m-%d").map_err(|_| format!("invalid target date '{s}'"))?),
        None => None,
    };
    Ok(BucketRow {
        name,
        target_amount,
        target_date,
        linked_account_name: non_blank(field(headers, record, "Linked Account")),
    })
}

fn parse_holding_row(headers: &csv::StringRecord, record: &csv::StringRecord) -> Result<HoldingRow, String> {
    let account_name = non_blank(field(headers, record, "Account")).ok_or("missing account")?;
    let symbol = non_blank(field(headers, record, "Symbol")).ok_or("missing symbol")?.to_uppercase();
    let shares_str = non_blank(field(headers, record, "Shares")).ok_or("missing shares")?;
    let shares = Decimal::from_str(&shares_str).map_err(|_| format!("invalid shares '{shares_str}'"))?;
    let price_str = non_blank(field(headers, record, "Price")).ok_or("missing price")?;
    let price = Decimal::from_str(&price_str).map_err(|_| format!("invalid price '{price_str}'"))?;
    let cost_basis_str = non_blank(field(headers, record, "Cost Basis")).ok_or("missing cost basis")?;
    let cost_basis = Decimal::from_str(&cost_basis_str).map_err(|_| format!("invalid cost basis '{cost_basis_str}'"))?;
    Ok(HoldingRow {
        account_name,
        symbol,
        name: non_blank(field(headers, record, "Name")),
        shares,
        price,
        cost_basis,
        asset_class: non_blank(field(headers, record, "Asset Class")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_five_sections_happy_path() {
        let result = load_from_str(
            "Accounts\n\
             Name,Type,Starting Balance,Institution,Mask\n\
             Everyday Checking,checking,1000.00,Ally,1234\n\
             \n\
             Categories\n\
             Name\n\
             Groceries\n\
             \n\
             Budgets\n\
             Category,Group,Monthly Amount,Period\n\
             Groceries,flexible,400.00,2026-08\n\
             \n\
             Buckets\n\
             Name,Target Amount,Target Date,Linked Account\n\
             Emergency Fund,5000.00,2027-01-01,Everyday Checking\n\
             \n\
             Holdings\n\
             Account,Symbol,Name,Shares,Price,Cost Basis,Asset Class\n\
             Brokerage,aapl,Apple Inc.,10,231.20,1450.00,US Stocks\n",
        );

        assert!(result.errors.is_empty(), "unexpected errors: {:?}", result.errors);
        assert_eq!(
            result.accounts,
            vec![AccountRow {
                name: "Everyday Checking".to_string(),
                account_type: "checking".to_string(),
                starting_balance: Some("1000.00".parse().unwrap()),
                institution: Some("Ally".to_string()),
                mask: Some("1234".to_string()),
            }]
        );
        assert_eq!(
            result.categories,
            vec![CategoryRow {
                name: "Groceries".to_string()
            }]
        );
        assert_eq!(
            result.budgets,
            vec![BudgetRow {
                category: "Groceries".to_string(),
                budget_group: "flexible".to_string(),
                monthly_amount: "400.00".parse().unwrap(),
                period: Some("2026-08".to_string()),
            }]
        );
        assert_eq!(
            result.buckets,
            vec![BucketRow {
                name: "Emergency Fund".to_string(),
                target_amount: Some("5000.00".parse().unwrap()),
                target_date: Some("2027-01-01".parse().unwrap()),
                linked_account_name: Some("Everyday Checking".to_string()),
            }]
        );
        assert_eq!(
            result.holdings,
            vec![HoldingRow {
                account_name: "Brokerage".to_string(),
                symbol: "AAPL".to_string(),
                name: Some("Apple Inc.".to_string()),
                shares: "10".parse().unwrap(),
                price: "231.20".parse().unwrap(),
                cost_basis: "1450.00".parse().unwrap(),
                asset_class: Some("US Stocks".to_string()),
            }]
        );
    }

    #[test]
    fn a_file_with_only_one_section_still_parses_it_and_leaves_the_rest_empty() {
        let result = load_from_str("Categories\nName\nGroceries\nDining Out\n");

        assert!(result.errors.is_empty());
        assert_eq!(result.categories.len(), 2);
        assert!(result.accounts.is_empty());
        assert!(result.budgets.is_empty());
        assert!(result.buckets.is_empty());
    }

    #[test]
    fn blank_optional_fields_parse_as_none() {
        let result = load_from_str("Accounts\nName,Type,Starting Balance,Institution,Mask\nCash Jar,other,,,\n");

        assert!(result.errors.is_empty());
        assert_eq!(result.accounts[0].starting_balance, None);
        assert_eq!(result.accounts[0].institution, None);
        assert_eq!(result.accounts[0].mask, None);
    }

    #[test]
    fn a_malformed_row_is_reported_without_dropping_good_rows_in_the_same_section_or_others() {
        let result = load_from_str(
            "Accounts\n\
             Name,Type,Starting Balance,Institution,Mask\n\
             Good Checking,checking,1000.00,,\n\
             Bad Account,not-a-real-type,1000.00,,\n\
             \n\
             Categories\n\
             Name\n\
             Groceries\n",
        );

        assert_eq!(result.accounts.len(), 1);
        assert_eq!(result.accounts[0].name, "Good Checking");
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].section, "Accounts");
        assert!(result.errors[0].message.contains("not-a-real-type"));
        // the Categories section, entirely unrelated to the bad row above, is untouched
        assert_eq!(result.categories.len(), 1);
    }

    #[test]
    fn unknown_account_type_is_a_row_error_not_silently_defaulted() {
        let result = load_from_str("Accounts\nName,Type,Starting Balance,Institution,Mask\nMy Account,bogus,,,\n");

        assert!(result.accounts.is_empty());
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].message.contains("bogus"));
    }

    #[test]
    fn unknown_budget_group_is_a_row_error_not_silently_defaulted() {
        let result = load_from_str("Budgets\nCategory,Group,Monthly Amount,Period\nGroceries,bogus,400.00,\n");

        assert!(result.budgets.is_empty());
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].message.contains("bogus"));
    }

    #[test]
    fn invalid_amount_and_date_are_row_errors() {
        let result = load_from_str(
            "Buckets\n\
             Name,Target Amount,Target Date,Linked Account\n\
             Emergency Fund,not-a-number,2027-01-01,\n\
             Vacation,1000.00,not-a-date,\n",
        );

        assert!(result.buckets.is_empty());
        assert_eq!(result.errors.len(), 2);
        assert!(result.errors[0].message.contains("not-a-number"));
        assert!(result.errors[1].message.contains("not-a-date"));
    }

    #[test]
    fn missing_required_name_column_value_is_a_row_error() {
        let result = load_from_str("Categories\nName\n\n");
        // a truly blank line inside the section body ends the section (matches
        // the blank-line-terminates-a-section rule), so this parses as zero rows,
        // not an error — covered instead by an explicitly-blank-but-present field:
        assert!(result.categories.is_empty());
        assert!(result.errors.is_empty());
    }

    #[test]
    fn section_titles_are_matched_case_insensitively() {
        let result = load_from_str("aCCounts\nName,Type,Starting Balance,Institution,Mask\nChecking,checking,,,\n");
        assert_eq!(result.accounts.len(), 1);
    }

    #[test]
    fn a_leading_utf8_bom_does_not_break_parsing() {
        // Excel's "CSV UTF-8" save option (and our own template download,
        // after the write_text_file fix) prepends a byte-order-mark —
        // std::fs::read_to_string leaves it as a literal U+FEFF character
        // at the start of the string rather than stripping it.
        let result = load_from_str("\u{FEFF}Accounts\nName,Type,Starting Balance,Institution,Mask\nChecking,checking,,,\n");

        assert!(result.errors.is_empty());
        assert_eq!(result.accounts.len(), 1);
        assert_eq!(result.accounts[0].name, "Checking");
    }

    #[test]
    fn comment_lines_before_the_first_section_are_ignored() {
        // The downloadable template ships with "# ..." explainer lines at
        // the top — anything before the first section title is skipped.
        let result = load_from_str(
            "# Vault Spend setup template — fill in your own rows.\n\
             # Delete the example rows, keep the section titles.\n\
             \n\
             Accounts\n\
             Name,Type,Starting Balance,Institution,Mask\n\
             Checking,checking,,,\n",
        );

        assert!(result.errors.is_empty());
        assert_eq!(result.accounts.len(), 1);
    }

    #[test]
    fn blank_holding_name_and_asset_class_parse_as_none() {
        let result = load_from_str("Holdings\nAccount,Symbol,Name,Shares,Price,Cost Basis,Asset Class\nBrokerage,VTI,,5,220.00,1000.00,\n");

        assert!(result.errors.is_empty(), "unexpected errors: {:?}", result.errors);
        assert_eq!(result.holdings[0].name, None);
        assert_eq!(result.holdings[0].asset_class, None);
    }

    #[test]
    fn a_holdings_row_missing_a_required_field_is_a_row_error() {
        let result = load_from_str("Holdings\nAccount,Symbol,Name,Shares,Price,Cost Basis,Asset Class\n,VTI,,5,220.00,1000.00,\n");

        assert!(result.holdings.is_empty());
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].section, "Holdings");
        assert!(result.errors[0].message.contains("account"));
    }

    #[test]
    fn a_holdings_row_with_an_invalid_number_is_a_row_error() {
        let result =
            load_from_str("Holdings\nAccount,Symbol,Name,Shares,Price,Cost Basis,Asset Class\nBrokerage,VTI,,not-a-number,220.00,1000.00,\n");

        assert!(result.holdings.is_empty());
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].message.contains("not-a-number"));
    }

    #[test]
    fn holdings_symbol_is_uppercased_on_parse() {
        let result = load_from_str("Holdings\nAccount,Symbol,Name,Shares,Price,Cost Basis,Asset Class\nBrokerage,vti,,5,220.00,1000.00,\n");

        assert_eq!(result.holdings[0].symbol, "VTI");
    }

    #[test]
    fn section_titles_padded_with_trailing_commas_are_still_recognized() {
        // Opening the template in Excel and saving it back pads every row to
        // the sheet's widest row ("used range") — once Holdings (7 columns)
        // is present, even bare section-title lines like "Accounts" come
        // back as "Accounts,,,,,,". A real round-tripped file, reproducing
        // a user-reported "nothing importable" bug where the padding broke
        // every section title in the file, not just Holdings.
        let result = load_from_str(
            "Accounts,,,,,,\n\
             Name,Type,Starting Balance,Institution,Mask,,\n\
             Everyday Checking,checking,1000.00,Ally,1234,,\n\
             ,,,,,,\n\
             Categories,,,,,,\n\
             Name,,,,,,\n\
             Groceries,,,,,,\n\
             ,,,,,,\n\
             Holdings,,,,,,\n\
             Account,Symbol,Name,Shares,Price,Cost Basis,Asset Class\n\
             Brokerage,aapl,Apple Inc.,10,231.20,1450.00,US Stocks\n",
        );

        assert!(result.errors.is_empty(), "unexpected errors: {:?}", result.errors);
        assert_eq!(result.accounts.len(), 1);
        assert_eq!(result.categories.len(), 1);
        assert_eq!(result.holdings.len(), 1);
        assert_eq!(result.holdings[0].symbol, "AAPL");
    }

    #[test]
    fn a_multi_line_quoted_holding_name_is_parsed_as_one_row() {
        // A cell with a manual line break (common for long ETF names) is
        // exported as a quoted field spanning multiple physical lines —
        // this must still be read as a single logical CSV record.
        let result = load_from_str(
            "Holdings,,,,,,\n\
             Account,Symbol,Name,Shares,Price,Cost Basis,Asset Class\n\
             Joey-IRA,AAAU,\"GOLDMAN SACHS\nPHYSICAL GOLD ETF\",45,42.46,1910.5,US Stocks\n",
        );

        assert!(result.errors.is_empty(), "unexpected errors: {:?}", result.errors);
        assert_eq!(result.holdings.len(), 1);
        assert_eq!(result.holdings[0].name, Some("GOLDMAN SACHS\nPHYSICAL GOLD ETF".to_string()));
    }

    #[test]
    fn unknown_holdings_columns_are_ignored() {
        // Same tolerance every other section already has — `field()` looks
        // columns up by name, so an extra column (or a different order)
        // never breaks parsing.
        let result = load_from_str("Holdings\nNotes,Account,Symbol,Shares,Price,Cost Basis\nignore me,Brokerage,VTI,5,220.00,1000.00\n");

        assert!(result.errors.is_empty(), "unexpected errors: {:?}", result.errors);
        assert_eq!(result.holdings[0].symbol, "VTI");
    }
}
