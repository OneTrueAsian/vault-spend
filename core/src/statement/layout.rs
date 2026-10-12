//! A statement layout: everything bank-specific about reading a statement, as data. Built from a
//! closed set of options (no free-form patterns, nothing executable), size-limited and validated on
//! every load, because learned layouts come from statement text.

use serde::{Deserialize, Serialize};

pub const LAYOUT_SCHEMA: u32 = 1;
pub const MAX_LAYOUT_BYTES: usize = 16 * 1024;
pub const GENERAL_ID: &str = "general";
pub const GENERAL_INVESTMENT_ID: &str = "general-investment";
const MAX_TEXT: usize = 80;
const MAX_LIST: usize = 32;
const ALLOWED_MARKERS: [char; 3] = ['*', '#', '+'];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatementLayout {
    pub schema: u32,
    pub id: String,
    pub name: String,
    /// Text found on page 1 of every statement from this bank. All must appear for a match.
    #[serde(default)]
    pub recognize: Vec<String>,
    pub dates: DateRules,
    pub amounts: AmountRules,
    pub rows: RowRules,
    pub balances: BalanceRules,
    /// Headings whose content is ignored until the next section starts.
    #[serde(default)]
    pub skip_sections: Vec<String>,
    /// Lines containing any of these phrases are ignored.
    #[serde(default)]
    pub ignore_lines: Vec<String>,
    #[serde(default)]
    pub holdings: Option<HoldingRules>,
    #[serde(default)]
    pub signs: SignRules,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DateFormat {
    MmDdYy,
    MmDdYyyy,
    MmDd,
    MonDd,
    MonDdYyyy,
    YyyyMmDd,
    DdMmYy,
    DdMmYyyy,
}

impl DateFormat {
    pub const ALL: [DateFormat; 8] = [
        DateFormat::MmDdYy,
        DateFormat::MmDdYyyy,
        DateFormat::MmDd,
        DateFormat::MonDd,
        DateFormat::MonDdYyyy,
        DateFormat::YyyyMmDd,
        DateFormat::DdMmYy,
        DateFormat::DdMmYyyy,
    ];
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DateRules {
    pub formats: Vec<DateFormat>,
    /// Rows carry a second (posting) date right after the first.
    #[serde(default)]
    pub second_date: bool,
    #[serde(default)]
    pub ignore_markers: Vec<char>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NegativeStyle {
    LeadingMinus,
    SpacedMinus,
    Parentheses,
    TrailingMinus,
    CrSuffix,
    DrSuffix,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Currency {
    Optional,
    Required,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Thousands {
    Comma,
    Period,
    Apostrophe,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecimalMark {
    Period,
    Comma,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AmountRules {
    pub negatives: Vec<NegativeStyle>,
    pub currency: Currency,
    pub thousands: Thousands,
    pub decimal: DecimalMark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AmountPosition {
    First,
    Last,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RowRules {
    /// Which money amount on the closing line is the transaction (prices can come before it).
    pub amount: AmountPosition,
    /// A running balance follows the amount.
    #[serde(default)]
    pub running_balance: bool,
    /// Description lines may follow the amount.
    #[serde(default)]
    pub description_after_amount: bool,
    /// Money out is printed as a positive number (and money in negative or marked CR).
    #[serde(default)]
    pub reversed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BalancePair {
    #[serde(default)]
    pub start: Option<String>,
    pub end: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TotalsPair {
    pub additions: String,
    pub subtractions: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BalanceRules {
    #[serde(default)]
    pub pairs: Vec<BalancePair>,
    /// Text that starts a new account section (may appear anywhere in the line).
    #[serde(default)]
    pub section_start: Vec<String>,
    /// Which column of a multi-column summary line to read (0 = first, "current month").
    #[serde(default)]
    pub summary_column: u8,
    #[serde(default)]
    pub activity_totals: Vec<TotalsPair>,
    /// An investment account's total value (reference only).
    #[serde(default)]
    pub value: Option<BalancePair>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HoldingField {
    Symbol,
    Name,
    Quantity,
    Price,
    MarketValue,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HoldingRules {
    pub heading: Vec<String>,
    pub order: Vec<HoldingField>,
    pub quantity_decimals: u8,
    pub price_decimals: u8,
    pub total: Vec<String>,
    /// Cash lines whose amount is part of the total holdings value.
    #[serde(default)]
    pub cash: Vec<String>,
}

/// Reverses the default statement → app sign conversion for an account kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignRules {
    #[serde(default)]
    pub flip_cash: bool,
    #[serde(default)]
    pub flip_credit: bool,
    #[serde(default)]
    pub flip_loan: bool,
    #[serde(default)]
    pub flip_investment: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutError {
    TooLarge,
    Malformed(String),
    Invalid(&'static str),
}

impl std::fmt::Display for LayoutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LayoutError::TooLarge => write!(f, "This statement setting is too large."),
            LayoutError::Malformed(_) => write!(f, "This statement setting is damaged."),
            LayoutError::Invalid(why) => write!(f, "{why}"),
        }
    }
}

impl std::error::Error for LayoutError {}

/// Text that is safe to keep in a layout: no run of four or more digits (account numbers), no email
/// address, and fewer than seven digits in total (phone numbers).
pub fn is_safe_phrase(s: &str) -> bool {
    let t = s.trim();
    if t.is_empty() || t.chars().count() > MAX_TEXT || t.contains('@') {
        return false;
    }
    let (mut run, mut total) = (0, 0);
    for c in t.chars() {
        if c.is_ascii_digit() {
            run += 1;
            total += 1;
            if run >= 4 {
                return false;
            }
        } else {
            run = 0;
        }
    }
    total < 7
}

const PERSONAL: LayoutError = LayoutError::Invalid("A statement label looks like it holds an account number, email address or phone number.");

fn phrase(s: &str) -> Result<(), LayoutError> {
    if is_safe_phrase(s) { Ok(()) } else { Err(PERSONAL) }
}

fn phrases(list: &[String]) -> Result<(), LayoutError> {
    if list.len() > MAX_LIST {
        return Err(LayoutError::Invalid("A statement setting has too many labels."));
    }
    list.iter().try_for_each(|s| phrase(s))
}

impl StatementLayout {
    pub fn from_json(json: &str) -> Result<Self, LayoutError> {
        if json.len() > MAX_LAYOUT_BYTES {
            return Err(LayoutError::TooLarge);
        }
        let layout: StatementLayout = serde_json::from_str(json).map_err(|e| LayoutError::Malformed(e.to_string()))?;
        layout.validate()?;
        Ok(layout)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("a layout always serializes")
    }

    pub fn validate(&self) -> Result<(), LayoutError> {
        use LayoutError::Invalid;
        if self.schema != LAYOUT_SCHEMA {
            return Err(Invalid("This statement setting was saved by a newer version of the app."));
        }
        if self.id.is_empty() || self.id.len() > MAX_TEXT || !self.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
            return Err(Invalid("A statement setting has a damaged name."));
        }
        phrase(&self.name)?;
        phrases(&self.recognize)?;
        phrases(&self.skip_sections)?;
        phrases(&self.ignore_lines)?;
        phrases(&self.balances.section_start)?;
        if self.balances.pairs.len() > MAX_LIST || self.balances.activity_totals.len() > MAX_LIST {
            return Err(Invalid("A statement setting has too many labels."));
        }
        for pair in self.balances.pairs.iter().chain(self.balances.value.iter()) {
            if let Some(start) = &pair.start {
                phrase(start)?;
            }
            phrase(&pair.end)?;
        }
        for totals in &self.balances.activity_totals {
            phrase(&totals.additions)?;
            phrase(&totals.subtractions)?;
        }
        if self.balances.summary_column > 5 {
            return Err(Invalid("A statement setting reads a column that doesn't exist."));
        }
        if self.dates.formats.is_empty() || self.dates.formats.len() > DateFormat::ALL.len() {
            return Err(Invalid("A statement setting has no date formats."));
        }
        if self.dates.ignore_markers.iter().any(|c| !ALLOWED_MARKERS.contains(c)) {
            return Err(Invalid("A statement setting ignores an unexpected character."));
        }
        if self.amounts.negatives.len() > 6 {
            return Err(Invalid("A statement setting has too many amount styles."));
        }
        if matches!(
            (self.amounts.thousands, self.amounts.decimal),
            (Thousands::Comma, DecimalMark::Comma) | (Thousands::Period, DecimalMark::Period)
        ) {
            return Err(Invalid("A statement setting uses the same mark for thousands and decimals."));
        }
        if let Some(h) = &self.holdings {
            if h.heading.is_empty() || h.total.is_empty() {
                return Err(Invalid("A statement setting for holdings is incomplete."));
            }
            phrases(&h.heading)?;
            phrases(&h.total)?;
            phrases(&h.cash)?;
            let count = |f: HoldingField| h.order.iter().filter(|x| **x == f).count();
            let required_once = [HoldingField::Symbol, HoldingField::Quantity, HoldingField::MarketValue]
                .into_iter()
                .all(|f| count(f) == 1);
            let optional_at_most_once = count(HoldingField::Name) <= 1 && count(HoldingField::Price) <= 1;
            if !required_once || !optional_at_most_once || h.quantity_decimals > 6 || h.price_decimals > 6 {
                return Err(Invalid("A statement setting for holdings is incomplete."));
            }
        }
        Ok(())
    }
}

const BUILT_IN_JSON: &[&str] = &[
    include_str!("../../data/statement_layouts/general.json"),
    include_str!("../../data/statement_layouts/general-investment.json"),
    include_str!("../../data/statement_layouts/amex.json"),
    include_str!("../../data/statement_layouts/chase-card.json"),
    include_str!("../../data/statement_layouts/capital-one.json"),
    include_str!("../../data/statement_layouts/credit-union.json"),
    include_str!("../../data/statement_layouts/mortgage.json"),
    include_str!("../../data/statement_layouts/lpl.json"),
];

/// The layouts shipped with the app. Each is covered by tests, so loading cannot fail.
pub fn built_in_layouts() -> Vec<StatementLayout> {
    BUILT_IN_JSON
        .iter()
        .map(|json| StatementLayout::from_json(json).expect("built-in statement layouts are valid"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_built_in_general_layouts_load_and_validate() {
        let ids: Vec<String> = built_in_layouts().into_iter().map(|l| l.id).collect();
        assert!(ids.contains(&GENERAL_ID.to_string()));
        assert!(ids.contains(&GENERAL_INVESTMENT_ID.to_string()));
    }

    #[test]
    fn a_layout_round_trips_through_json() {
        let general = built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap();
        assert_eq!(StatementLayout::from_json(&general.to_json()).unwrap(), general);
    }

    #[test]
    fn unknown_fields_and_free_form_patterns_are_refused() {
        let general = built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&general.to_json()).unwrap();
        value["regex"] = serde_json::json!("(.*)");
        assert!(matches!(StatementLayout::from_json(&value.to_string()), Err(LayoutError::Malformed(_))));
    }

    #[test]
    fn oversized_documents_are_refused_before_parsing() {
        let huge = format!("{{\"name\":\"{}\"}}", "x".repeat(MAX_LAYOUT_BYTES));
        assert_eq!(StatementLayout::from_json(&huge), Err(LayoutError::TooLarge));
    }

    #[test]
    fn personal_looking_phrases_are_refused() {
        assert!(is_safe_phrase("Opening/Closing Date"));
        assert!(is_safe_phrase("Riverbend Mutual Bank"));
        assert!(!is_safe_phrase("Account ending 6700"), "four digits in a row");
        assert!(!is_safe_phrase("me@example.com"));
        assert!(!is_safe_phrase("Call 616-555-0100"), "a phone number");
        assert!(!is_safe_phrase(""));
        let mut layout = built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap();
        layout.recognize = vec!["Card ending 61006".into()];
        assert!(layout.validate().is_err());
        layout.recognize = vec![];
        layout.balances.pairs[0].end = "Balance for 1234567".into();
        assert!(layout.validate().is_err(), "labels follow the same rule");
    }

    #[test]
    fn holdings_rules_need_symbol_quantity_and_value_once_each() {
        let mut layout = built_in_layouts().into_iter().find(|l| l.id == GENERAL_INVESTMENT_ID).unwrap();
        layout.holdings.as_mut().unwrap().order = vec![HoldingField::Symbol, HoldingField::MarketValue];
        assert!(layout.validate().is_err());
        layout.holdings.as_mut().unwrap().order = vec![
            HoldingField::Symbol,
            HoldingField::Quantity,
            HoldingField::Quantity,
            HoldingField::MarketValue,
        ];
        assert!(layout.validate().is_err());
    }

    #[test]
    fn a_newer_schema_is_refused_plainly() {
        let mut layout = built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap();
        layout.schema = LAYOUT_SCHEMA + 1;
        assert!(layout.validate().is_err());
    }

    #[test]
    fn each_owner_layout_reads_its_fictional_fixture_and_adds_up() {
        use crate::statement::checks::{CheckOutcome, check_section};
        use crate::statement::fixture_pdf::fixture_lines;
        use crate::statement::sections::read_statement;
        let pairs = [
            ("amex", "card-a"),
            ("chase-card", "card-b"),
            ("capital-one", "card-c"),
            ("credit-union", "credit-union"),
            ("mortgage", "mortgage"),
            ("lpl", "brokerage"),
        ];
        for (id, fixture) in pairs {
            let layout = built_in_layouts().into_iter().find(|l| l.id == id).unwrap_or_else(|| panic!("{id}"));
            let (lines, period) = fixture_lines(fixture);
            let sections = read_statement(&lines, &layout, &period);
            assert!(!sections.is_empty(), "{id}");
            for s in &sections {
                let c = check_section(s);
                assert!(!matches!(c.activity, CheckOutcome::Failed { .. }), "{id}: {:?}", c.activity);
                assert!(!matches!(c.holdings, CheckOutcome::Failed { .. }), "{id}: {:?}", c.holdings);
                assert!(c.running_balance_breaks.is_empty(), "{id}");
                assert!(s.unread.is_empty(), "{id}: {:?}", s.unread);
            }
        }
    }
}
