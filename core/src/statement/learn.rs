//! Learning how to read a statement: narrowing a general layout to what one statement used, suggesting
//! a name and recognition phrases, and deriving a layout from words the person clicked ("teaching").

use super::layout::{AmountPosition, BalancePair, DateFormat, HoldingField, NegativeStyle, StatementLayout, TotalsPair, is_safe_phrase};
use super::model::{Period, StatementLine, StatementSection};
use super::select::read_with;
use super::tokens::{find_money, leading_date, parse_date_prefix, permissive_amounts, without_money};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRef {
    pub line: usize,
    /// Character index of the clicked word in the line.
    pub start: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowMark {
    pub date: TextRef,
    pub amount: TextRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BalanceMark {
    StartEnd { start: TextRef, end: TextRef },
    Totals { additions: TextRef, subtractions: TextRef },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldingMark {
    pub symbol: TextRef,
    pub quantity: TextRef,
    pub price: Option<TextRef>,
    pub market_value: TextRef,
    pub total: TextRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeachMarks {
    #[serde(default)]
    pub rows: Vec<RowMark>,
    #[serde(default)]
    pub balances: Option<BalanceMark>,
    #[serde(default)]
    pub holdings: Vec<HoldingMark>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeachError {
    NothingMarked,
    DateNotFound,
    AmountNotFound,
    LabelLooksPersonal,
    NotThere,
}

impl std::fmt::Display for TeachError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            TeachError::NothingMarked => "Click at least one example first.",
            TeachError::DateNotFound => "The word you clicked for the date isn't a date. Click the transaction's date.",
            TeachError::AmountNotFound => "The word you clicked isn't an amount of money. Click the amount.",
            TeachError::LabelLooksPersonal => {
                "The words next to that amount look like an account number or contact details, so the app won't remember them."
            }
            TeachError::NotThere => "That example is no longer on the statement. Read the statement again.",
        })
    }
}

fn byte_index(text: &str, chars: usize) -> Option<usize> {
    text.char_indices().map(|(b, _)| b).chain(std::iter::once(text.len())).nth(chars)
}

fn line_at(lines: &[StatementLine], r: TextRef) -> Result<(&str, usize), TeachError> {
    let text = lines.get(r.line).ok_or(TeachError::NotThere)?.text.as_str();
    Ok((text, byte_index(text, r.start).ok_or(TeachError::NotThere)?))
}

type ClickedMoney = (usize, usize, Option<NegativeStyle>, rust_decimal::Decimal, String);

/// The money on the line whose range contains the clicked word ("$3,975.23" inside "- $3,975.23").
fn clicked_money(lines: &[StatementLine], r: TextRef) -> Result<ClickedMoney, TeachError> {
    let (text, at) = line_at(lines, r)?;
    let money = find_money(text, &permissive_amounts());
    let index = money.iter().position(|m| m.start <= at && at < m.end).ok_or(TeachError::AmountNotFound)?;
    let m = money[index];
    Ok((index, money.len(), m.negative_style, m.value, text[m.start..m.end].to_string()))
}

/// The words before an amount on its line (after any leading date) — or, when the amount is alone, the
/// line above.
fn label_for(lines: &[StatementLine], r: TextRef, period: &Period) -> Result<String, TeachError> {
    let (text, _) = line_at(lines, r)?;
    let money = find_money(text, &permissive_amounts());
    let mut label = without_money(text, &money);
    let any_date = super::layout::DateRules {
        formats: DateFormat::ALL.to_vec(),
        second_date: true,
        ignore_markers: vec![],
    };
    if let Some(d) = leading_date(&label, &any_date, period) {
        label = d.rest.to_string();
    }
    if label.trim().is_empty() && r.line > 0 {
        label = lines[r.line - 1].text.clone();
    }
    let label = label.trim().trim_end_matches([':', '=']).trim().to_string();
    if is_safe_phrase(&label) {
        Ok(label)
    } else {
        Err(TeachError::LabelLooksPersonal)
    }
}

fn decimals_in(text: &str) -> u8 {
    text.rsplit_once('.')
        .map(|(_, f)| f.chars().take_while(char::is_ascii_digit).count() as u8)
        .unwrap_or(0)
}

pub fn from_marks(base: &StatementLayout, lines: &[StatementLine], marks: &TeachMarks, period: &Period) -> Result<StatementLayout, TeachError> {
    if marks.rows.is_empty() && marks.balances.is_none() && marks.holdings.is_empty() {
        return Err(TeachError::NothingMarked);
    }
    let mut layout = base.clone();

    for row in &marks.rows {
        let (text, at) = line_at(lines, row.date)?;
        let clicked = &text[at..];
        let format = DateFormat::ALL
            .iter()
            .copied()
            .filter_map(|f| parse_date_prefix(clicked, f, period).map(|(d, _)| (f, d)))
            .filter(|(_, d)| period.contains_with_leeway(*d))
            .min_by_key(|(_, d)| period.distance(*d))
            .map(|(f, _)| f)
            .ok_or(TeachError::DateNotFound)?;
        layout.dates.formats.retain(|f| *f != format);
        layout.dates.formats.insert(0, format);

        let (index, count, style, _, _) = clicked_money(lines, row.amount)?;
        if let Some(style) = style
            && !layout.amounts.negatives.contains(&style)
        {
            layout.amounts.negatives.push(style);
        }
        layout.rows.running_balance = index + 1 < count;
        layout.rows.amount = if index == 0 { AmountPosition::First } else { AmountPosition::Last };
    }

    match &marks.balances {
        Some(BalanceMark::StartEnd { start, end }) => {
            let pair = BalancePair {
                start: Some(label_for(lines, *start, period)?),
                end: label_for(lines, *end, period)?,
            };
            let (column, _, _, _, _) = clicked_money(lines, *end)?;
            layout.balances.summary_column = column as u8;
            layout.balances.pairs.retain(|p| p != &pair);
            layout.balances.pairs.insert(0, pair);
        }
        Some(BalanceMark::Totals { additions, subtractions }) => {
            let pair = TotalsPair {
                additions: label_for(lines, *additions, period)?,
                subtractions: label_for(lines, *subtractions, period)?,
            };
            let (column, _, _, _, _) = clicked_money(lines, *additions)?;
            layout.balances.summary_column = column as u8;
            layout.balances.activity_totals.retain(|p| p != &pair);
            layout.balances.activity_totals.insert(0, pair);
        }
        None => {}
    }

    for h in &marks.holdings {
        line_at(lines, h.symbol)?;
        let quantity_text = word_at(lines, h.quantity)?;
        let price_text = h.price.map(|p| word_at(lines, p)).transpose()?;
        let total = label_for(lines, h.total, period)?;
        let heading = (0..h.symbol.line)
            .rev()
            .take(30)
            .map(|i| lines[i].text.trim())
            .find(|t| {
                !t.is_empty()
                    && !t.chars().any(|c| c.is_ascii_digit())
                    && t.split_whitespace().count() >= 1
                    && !super::holdings::is_ticker(t.split_whitespace().next().unwrap_or(""))
            })
            .map(str::to_string)
            .filter(|t| is_safe_phrase(t))
            .ok_or(TeachError::LabelLooksPersonal)?;
        let mut fields = vec![
            (h.symbol, HoldingField::Symbol),
            (h.quantity, HoldingField::Quantity),
            (h.market_value, HoldingField::MarketValue),
        ];
        if let Some(p) = h.price {
            fields.push((p, HoldingField::Price));
        }
        fields.sort_by_key(|(r, _)| (r.line, r.start));
        let mut order: Vec<HoldingField> = fields.into_iter().map(|(_, f)| f).collect();
        let symbol_at = order.iter().position(|f| *f == HoldingField::Symbol).unwrap_or(0);
        order.insert(symbol_at + 1, HoldingField::Name);
        let rules = layout.holdings.get_or_insert_with(|| super::layout::HoldingRules {
            heading: vec![],
            order: vec![],
            quantity_decimals: 0,
            price_decimals: 0,
            total: vec![],
            cash: vec![],
        });
        if !rules.heading.contains(&heading) {
            rules.heading.insert(0, heading);
        }
        if !rules.total.contains(&total) {
            rules.total.insert(0, total);
        }
        rules.order = order;
        rules.quantity_decimals = decimals_in(&quantity_text);
        rules.price_decimals = price_text.as_deref().map(decimals_in).unwrap_or(rules.price_decimals);
    }

    // Money out may be printed positive: keep whichever direction makes the statement add up.
    let try_both = |l: &StatementLayout| {
        let (_, checks) = read_with(lines, l, period);
        checks.iter().map(|c| c.passed() as i64 - c.failed() as i64).sum::<i64>()
    };
    let mut reversed = layout.clone();
    reversed.rows.reversed = !layout.rows.reversed;
    if try_both(&reversed) > try_both(&layout) {
        layout = reversed;
    }
    layout.validate().map_err(|_| TeachError::LabelLooksPersonal)?;
    Ok(layout)
}

fn word_at(lines: &[StatementLine], r: TextRef) -> Result<String, TeachError> {
    let (text, at) = line_at(lines, r)?;
    Ok(text[at..].split_whitespace().next().ok_or(TeachError::NotThere)?.to_string())
}

/// Keeps only the date formats and negative styles one successful reading actually used.
pub fn narrow(layout: &StatementLayout, lines: &[StatementLine], sections: &[StatementSection], period: &Period) -> StatementLayout {
    let mut out = layout.clone();
    let row_lines: Vec<&str> = sections.iter().flat_map(|s| s.rows.iter().map(|r| lines[r.line].text.as_str())).collect();
    let used: Vec<DateFormat> = layout
        .dates
        .formats
        .iter()
        .copied()
        .filter(|f| {
            let only = super::layout::DateRules {
                formats: vec![*f],
                ..layout.dates.clone()
            };
            row_lines.iter().any(|l| leading_date(l, &only, period).is_some())
        })
        .collect();
    if !used.is_empty() {
        out.dates.formats = used;
    }
    let mut styles: Vec<NegativeStyle> = Vec::new();
    for text in lines.iter().map(|l| l.text.as_str()) {
        for m in find_money(text, &layout.amounts) {
            if let Some(s) = m.negative_style
                && !styles.contains(&s)
            {
                styles.push(s);
            }
        }
    }
    out.amounts.negatives = styles;
    out
}

const GENERIC: &[&str] = &[
    "statement",
    "account",
    "summary",
    "page",
    "balance",
    "date",
    "total",
    "details",
    "activity",
    "transactions",
    "amount",
    "description",
    "of",
    "and",
    "the",
    "your",
    "for",
];

/// A name and up to two recognition phrases from page 1: short, safe lines of words (no digits) that
/// aren't the person's own account or household names.
pub fn suggest_name_and_phrases(lines: &[StatementLine], avoid: &[String]) -> (String, Vec<String>) {
    let avoid: Vec<String> = avoid.iter().map(|a| a.to_lowercase()).collect();
    let mut phrases: Vec<String> = Vec::new();
    for line in lines.iter().filter(|l| l.page == 0) {
        let t = line.text.trim();
        let words: Vec<&str> = t.split_whitespace().collect();
        let lower = t.to_lowercase();
        if !(2..=6).contains(&words.len())
            || !(4..=40).contains(&t.len())
            || t.chars().any(|c| c.is_ascii_digit())
            || !is_safe_phrase(t)
            || words
                .iter()
                .all(|w| GENERIC.contains(&w.to_lowercase().trim_matches(|c: char| !c.is_alphanumeric())))
            || avoid.iter().any(|a| !a.is_empty() && (lower.contains(a) || a.contains(&lower)))
            || phrases.iter().any(|p| p.eq_ignore_ascii_case(t))
        {
            continue;
        }
        phrases.push(t.to_string());
        if phrases.len() == 2 {
            break;
        }
    }
    let name = phrases.first().cloned().unwrap_or_else(|| "My statement".to_string());
    (name, phrases)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::checks::CheckOutcome;
    use crate::statement::fixture_pdf::fixture_lines;
    use crate::statement::layout::{DateFormat, GENERAL_ID, GENERAL_INVESTMENT_ID, built_in_layouts};
    use crate::statement::select::read_with;

    fn base(id: &str) -> StatementLayout {
        built_in_layouts().into_iter().find(|l| l.id == id).unwrap()
    }
    fn at(lines: &[StatementLine], line_text_start: &str, word: &str) -> TextRef {
        let line = lines.iter().position(|l| l.text.starts_with(line_text_start)).unwrap();
        let start = lines[line].text.find(word).unwrap();
        TextRef {
            line,
            start: lines[line].text[..start].chars().count(),
        }
    }

    #[test]
    fn teaching_a_day_first_reversed_bank() {
        let (lines, period) = fixture_lines("unknown-bank");
        let marks = TeachMarks {
            rows: vec![RowMark {
                date: at(&lines, "03/08", "03/08/2026"),
                amount: at(&lines, "03/08", "54.20"),
            }],
            balances: Some(BalanceMark::StartEnd {
                start: at(&lines, "Opening", "1,250.00"),
                end: at(&lines, "Closing", "3,132.00"),
            }),
            holdings: vec![],
        };
        let taught = from_marks(&base(GENERAL_ID), &lines, &marks, &period).unwrap();
        assert_eq!(taught.dates.formats[0], DateFormat::DdMmYyyy);
        assert!(taught.rows.reversed);
        let (sections, checks) = read_with(&lines, &taught, &period);
        assert_eq!(sections[0].rows.len(), 5);
        assert_eq!(checks[0].activity, CheckOutcome::Passed);

        // The next month reads with what was learned.
        let (next, next_period) = fixture_lines("unknown-bank-next");
        assert_eq!(read_with(&next, &taught, &next_period).1[0].activity, CheckOutcome::Passed);
    }

    #[test]
    fn teaching_a_holdings_table() {
        let (lines, period) = fixture_lines("unknown-brokerage");
        let marks = TeachMarks {
            rows: vec![],
            balances: None,
            holdings: vec![HoldingMark {
                symbol: at(&lines, "QQQZ", "QQQZ"),
                quantity: at(&lines, "10.5000", "10.5000"),
                price: Some(at(&lines, "10.5000", "$300.25")),
                market_value: at(&lines, "10.5000", "$3,152.63"),
                total: at(&lines, "Total Market Value", "$4,153.03"),
            }],
        };
        let taught = from_marks(&base(GENERAL_INVESTMENT_ID), &lines, &marks, &period).unwrap();
        let h = taught.holdings.as_ref().unwrap();
        assert_eq!((h.quantity_decimals, h.price_decimals), (4, 2));
        assert_eq!(read_with(&lines, &taught, &period).1[0].holdings, CheckOutcome::Passed);
    }

    #[test]
    fn marking_nothing_or_a_wrong_word_is_refused_plainly() {
        let (lines, period) = fixture_lines("unknown-bank");
        assert_eq!(
            from_marks(
                &base(GENERAL_ID),
                &lines,
                &TeachMarks {
                    rows: vec![],
                    balances: None,
                    holdings: vec![]
                },
                &period
            ),
            Err(TeachError::NothingMarked)
        );
        let bad = TeachMarks {
            rows: vec![RowMark {
                date: at(&lines, "Riverbend", "Riverbend"),
                amount: at(&lines, "03/08", "54.20"),
            }],
            balances: None,
            holdings: vec![],
        };
        assert_eq!(from_marks(&base(GENERAL_ID), &lines, &bad, &period), Err(TeachError::DateNotFound));
    }

    #[test]
    fn automatic_learning_keeps_only_what_was_seen() {
        let (lines, period) = fixture_lines("card-c");
        let general = base(GENERAL_ID);
        let (sections, _) = read_with(&lines, &general, &period);
        let narrowed = narrow(&general, &lines, &sections, &period);
        assert!(narrowed.dates.formats.contains(&DateFormat::MonDd));
        assert!(!narrowed.dates.formats.contains(&DateFormat::YyyyMmDd));
    }

    #[test]
    fn suggested_phrases_are_safe_and_avoid_the_persons_own_names() {
        let (lines, _) = fixture_lines("unknown-bank");
        let (name, phrases) = suggest_name_and_phrases(&lines, &["Everyday Account Statement".into()]);
        assert_eq!(name, "Riverbend Mutual Bank");
        assert_eq!(phrases, vec!["Riverbend Mutual Bank".to_string()]);
        assert!(phrases.iter().all(|p| crate::statement::layout::is_safe_phrase(p)));
    }
}
