//! Dates and money on statement lines, recognised by hand (no regular expressions): every accepted form
//! comes from the layout's closed option set.

use super::layout::{AmountRules, Currency, DateFormat, DateRules, DecimalMark, NegativeStyle, Thousands};
use super::model::Period;
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use std::str::FromStr;

const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/// A date at the very start of a line, and what follows it.
#[derive(Debug, Clone, PartialEq)]
pub struct LeadingDate<'a> {
    pub date: NaiveDate,
    pub format: DateFormat,
    pub rest: &'a str,
}

pub fn leading_date<'a>(line: &'a str, rules: &DateRules, period: &Period) -> Option<LeadingDate<'a>> {
    let trimmed = line.trim_start();
    for &format in &rules.formats {
        let Some((date, used)) = parse_date_prefix(trimmed, format, period) else {
            continue;
        };
        let mut rest = strip_markers(&trimmed[used..], &rules.ignore_markers);
        if !(rest.is_empty() || rest.starts_with(char::is_whitespace)) {
            continue;
        }
        if rules.second_date {
            let r = rest.trim_start();
            if let Some((_, used2)) = parse_date_prefix(r, format, period) {
                let after = strip_markers(&r[used2..], &rules.ignore_markers);
                if after.is_empty() || after.starts_with(char::is_whitespace) {
                    rest = after;
                }
            }
        }
        return Some(LeadingDate {
            date,
            format,
            rest: rest.trim(),
        });
    }
    None
}

/// "- Aug 24, 2026 …" or "to 09/16/2026": the dated line is a period, not a transaction.
pub fn is_date_range(rest: &str, rules: &DateRules, period: &Period) -> bool {
    let r = rest.trim_start();
    let after = if let Some(x) = r.strip_prefix('-').or_else(|| r.strip_prefix('–')) {
        x
    } else if r.get(..3).is_some_and(|word| word.eq_ignore_ascii_case("to ")) {
        &r[3..]
    } else {
        return false;
    };
    leading_date(after, rules, period).is_some()
}

fn strip_markers<'a>(s: &'a str, markers: &[char]) -> &'a str {
    s.trim_start_matches(|c| markers.contains(&c))
}

fn digits(b: &[u8], start: usize, min: usize, max: usize) -> Option<(u32, usize)> {
    let mut i = start;
    while i < b.len() && i - start < max && b[i].is_ascii_digit() {
        i += 1;
    }
    if i - start < min || (i < b.len() && b[i].is_ascii_digit()) {
        return None;
    }
    std::str::from_utf8(&b[start..i]).ok()?.parse().ok().map(|n| (n, i))
}

fn sep(b: &[u8], i: usize, c: u8) -> Option<usize> {
    (b.get(i) == Some(&c)).then_some(i + 1)
}

fn spaces(b: &[u8], mut i: usize) -> Option<usize> {
    let start = i;
    while i < b.len() && b[i] == b' ' {
        i += 1;
    }
    (i > start).then_some(i)
}

fn month_name(b: &[u8]) -> Option<(u32, usize)> {
    if b.len() < 3 || !b[..3].iter().all(u8::is_ascii_alphabetic) {
        return None;
    }
    let head = std::str::from_utf8(&b[..3]).ok()?.to_ascii_lowercase();
    let month = MONTHS.iter().position(|m| *m == head)? as u32 + 1;
    let mut i = 3;
    while i < b.len() && b[i].is_ascii_alphabetic() {
        i += 1;
    }
    if b.get(i) == Some(&b'.') {
        i += 1;
    }
    Some((month, i))
}

fn infer_year(month: u32, day: u32, period: &Period) -> Option<NaiveDate> {
    let years = [period.start.year() - 1, period.start.year(), period.end.year(), period.end.year() + 1];
    years
        .iter()
        .filter_map(|&y| NaiveDate::from_ymd_opt(y, month, day))
        .min_by_key(|d| period.distance(*d))
}

pub fn parse_date_prefix(s: &str, format: DateFormat, period: &Period) -> Option<(NaiveDate, usize)> {
    let b = s.as_bytes();
    let ymd = |y: i32, m: u32, d: u32| NaiveDate::from_ymd_opt(y, m, d);
    match format {
        DateFormat::MmDdYy | DateFormat::MmDdYyyy | DateFormat::DdMmYy | DateFormat::DdMmYyyy => {
            let (a, i) = digits(b, 0, 1, 2)?;
            let i = sep(b, i, b'/')?;
            let (c, i) = digits(b, i, 1, 2)?;
            let i = sep(b, i, b'/')?;
            let long = matches!(format, DateFormat::MmDdYyyy | DateFormat::DdMmYyyy);
            let (y, i) = if long { digits(b, i, 4, 4)? } else { digits(b, i, 2, 2)? };
            let year = if long { y as i32 } else { 2000 + y as i32 };
            let (m, d) = if matches!(format, DateFormat::DdMmYy | DateFormat::DdMmYyyy) {
                (c, a)
            } else {
                (a, c)
            };
            Some((ymd(year, m, d)?, i))
        }
        DateFormat::MmDd => {
            let (m, i) = digits(b, 0, 1, 2)?;
            let i = sep(b, i, b'/')?;
            let (d, i) = digits(b, i, 1, 2)?;
            if b.get(i) == Some(&b'/') {
                return None;
            }
            Some((infer_year(m, d, period)?, i))
        }
        DateFormat::YyyyMmDd => {
            let (y, i) = digits(b, 0, 4, 4)?;
            let i = sep(b, i, b'-')?;
            let (m, i) = digits(b, i, 2, 2)?;
            let i = sep(b, i, b'-')?;
            let (d, i) = digits(b, i, 2, 2)?;
            Some((ymd(y as i32, m, d)?, i))
        }
        DateFormat::MonDd => {
            let (m, i) = month_name(b)?;
            let i = spaces(b, i)?;
            let (d, i) = digits(b, i, 1, 2)?;
            if b.get(i) == Some(&b',') {
                return None;
            }
            Some((infer_year(m, d, period)?, i))
        }
        DateFormat::MonDdYyyy => {
            let (m, i) = month_name(b)?;
            let i = spaces(b, i)?;
            let (d, i) = digits(b, i, 1, 2)?;
            let i = sep(b, i, b',')?;
            let i = spaces(b, i)?;
            let (y, i) = digits(b, i, 4, 4)?;
            Some((ymd(y as i32, m, d)?, i))
        }
    }
}

/// A money amount on a line: its signed value, where it sits, and how a negative was written.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Money {
    pub value: Decimal,
    pub start: usize,
    pub end: usize,
    pub negative_style: Option<NegativeStyle>,
}

/// The widest reasonable reading, for teaching and for downloads.
pub fn permissive_amounts() -> AmountRules {
    AmountRules {
        negatives: vec![
            NegativeStyle::LeadingMinus,
            NegativeStyle::SpacedMinus,
            NegativeStyle::Parentheses,
            NegativeStyle::TrailingMinus,
            NegativeStyle::CrSuffix,
            NegativeStyle::DrSuffix,
        ],
        currency: Currency::Optional,
        thousands: Thousands::Comma,
        decimal: DecimalMark::Period,
    }
}

fn tokens(line: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start = None;
    for (i, c) in line.char_indices() {
        if c.is_whitespace() {
            if let Some(s) = start.take() {
                out.push((s, i));
            }
        } else if start.is_none() {
            start = Some(i);
        }
    }
    if let Some(s) = start {
        out.push((s, line.len()));
    }
    out
}

fn suffix_style(tok: &str, rules: &AmountRules) -> Option<NegativeStyle> {
    let style = if tok.eq_ignore_ascii_case("CR") {
        NegativeStyle::CrSuffix
    } else if tok.eq_ignore_ascii_case("DR") {
        NegativeStyle::DrSuffix
    } else {
        return None;
    };
    rules.negatives.contains(&style).then_some(style)
}

/// Every money amount on the line, in order.
pub fn find_money(line: &str, rules: &AmountRules) -> Vec<Money> {
    let toks = tokens(line);
    let mut out = Vec::new();
    let mut i = 0;
    while i < toks.len() {
        let (s, e) = toks[i];
        let tok = &line[s..e];
        if tok == "-"
            && rules.negatives.contains(&NegativeStyle::SpacedMinus)
            && let Some(&(ns, ne)) = toks.get(i + 1)
            && let Some((v, None)) = money_token(&line[ns..ne], rules)
        {
            out.push(Money {
                value: -v,
                start: s,
                end: ne,
                negative_style: Some(NegativeStyle::SpacedMinus),
            });
            i += 2;
            continue;
        }
        if let Some((mut value, mut style)) = money_token(tok, rules) {
            let mut end = e;
            if style.is_none()
                && let Some(&(ns, ne)) = toks.get(i + 1)
                && let Some(suffix) = suffix_style(&line[ns..ne], rules)
            {
                value = -value;
                style = Some(suffix);
                end = ne;
                i += 1;
            }
            out.push(Money {
                value,
                start: s,
                end,
                negative_style: style,
            });
        }
        i += 1;
    }
    out
}

/// One whitespace-free token as money: its signed value and how a negative was written.
pub fn money_token(tok: &str, rules: &AmountRules) -> Option<(Decimal, Option<NegativeStyle>)> {
    let allows = |s: NegativeStyle| rules.negatives.contains(&s);
    let mut t = tok.trim_end_matches([',', ';']);
    let mut style = None;
    if t.len() > 2 && t.starts_with('(') && t.ends_with(')') {
        if !allows(NegativeStyle::Parentheses) {
            return None;
        }
        t = &t[1..t.len() - 1];
        style = Some(NegativeStyle::Parentheses);
    }
    if style.is_none() && t.len() > 2 {
        // `get` rather than slicing: the last two bytes can fall inside a non-ASCII character.
        let upper = t.get(t.len() - 2..).map(str::to_ascii_uppercase);
        let candidate = match upper.as_deref() {
            Some("CR") => Some(NegativeStyle::CrSuffix),
            Some("DR") => Some(NegativeStyle::DrSuffix),
            _ => None,
        };
        if let Some(s) = candidate
            && t[..t.len() - 2].ends_with(|c: char| c.is_ascii_digit())
        {
            if !allows(s) {
                return None;
            }
            t = &t[..t.len() - 2];
            style = Some(s);
        }
    }
    if style.is_none() && t.starts_with('-') {
        if !allows(NegativeStyle::LeadingMinus) {
            return None;
        }
        t = &t[1..];
        style = Some(NegativeStyle::LeadingMinus);
    }
    if style.is_none() && t.len() > 1 && t.ends_with('-') {
        if !allows(NegativeStyle::TrailingMinus) {
            return None;
        }
        t = &t[..t.len() - 1];
        style = Some(NegativeStyle::TrailingMinus);
    }
    let had_symbol = t.starts_with('$');
    if had_symbol {
        t = &t[1..];
    } else if rules.currency == Currency::Required {
        return None;
    }
    if style.is_none() && had_symbol && t.starts_with('-') {
        if !allows(NegativeStyle::LeadingMinus) {
            return None;
        }
        t = &t[1..];
        style = Some(NegativeStyle::LeadingMinus);
    }
    let magnitude = plain_number(t, rules, Some(2))?;
    Some((if style.is_some() { -magnitude } else { magnitude }, style))
}

/// A number with exactly `decimals` digits after the decimal mark (0 = a whole number), with an
/// optional leading `$`. Used for share quantities and prices.
pub fn parse_number_token(tok: &str, rules: &AmountRules, decimals: u8) -> Option<Decimal> {
    let t = tok.trim_end_matches([',', ';']);
    let t = t.strip_prefix('$').unwrap_or(t);
    plain_number(t, rules, Some(decimals as usize))
}

fn marks(rules: &AmountRules) -> (char, Option<char>) {
    let decimal = match rules.decimal {
        DecimalMark::Period => '.',
        DecimalMark::Comma => ',',
    };
    let thousands = match rules.thousands {
        Thousands::Comma => Some(','),
        Thousands::Period => Some('.'),
        Thousands::Apostrophe => Some('\''),
        Thousands::None => None,
    };
    (decimal, thousands)
}

fn plain_number(t: &str, rules: &AmountRules, decimals: Option<usize>) -> Option<Decimal> {
    let (decimal, thousands) = marks(rules);
    let (int_part, frac) = match t.rfind(decimal) {
        Some(p) => (&t[..p], Some(&t[p + decimal.len_utf8()..])),
        None => (t, None),
    };
    let frac_ok = |f: &str| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit());
    match (decimals, frac) {
        (Some(0), None) | (None, None) => {}
        (Some(n), Some(f)) if n > 0 && f.len() == n && frac_ok(f) => {}
        (None, Some(f)) if frac_ok(f) => {}
        _ => return None,
    }
    if int_part.is_empty() {
        frac?;
    } else {
        let groups: Vec<&str> = match thousands {
            Some(c) => int_part.split(c).collect(),
            None => vec![int_part],
        };
        if groups.iter().any(|g| g.is_empty() || !g.bytes().all(|b| b.is_ascii_digit())) {
            return None;
        }
        if groups.len() > 1 && (groups[0].len() > 3 || groups[1..].iter().any(|g| g.len() != 3)) {
            return None;
        }
    }
    let digits: String = int_part.chars().filter(char::is_ascii_digit).collect();
    let text = match frac {
        Some(f) => format!("{}.{}", if digits.is_empty() { "0" } else { &digits }, f),
        None => digits,
    };
    Decimal::from_str(&text).ok()
}

/// The line with its money removed and whitespace tidied — what's left is description.
pub fn without_money(line: &str, money: &[Money]) -> String {
    let mut out = String::new();
    let mut at = 0;
    for m in money {
        out.push_str(&line[at..m.start]);
        out.push(' ');
        at = m.end;
    }
    out.push_str(&line[at..]);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod date_tests {
    use super::*;
    use crate::statement::layout::{DateFormat::*, DateRules};

    fn d(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }
    fn period(a: &str, b: &str) -> Period {
        Period::new(d(a), d(b)).unwrap()
    }
    fn rules(formats: &[DateFormat], second: bool) -> DateRules {
        DateRules {
            formats: formats.to_vec(),
            second_date: second,
            ignore_markers: vec!['*'],
        }
    }

    #[test]
    fn short_us_dates_with_a_posting_marker() {
        let p = period("2026-07-22", "2026-08-21");
        let found = leading_date("08/05/26* AUTOPAY PAYMENT RECEIVED", &rules(&[MmDdYy], false), &p).unwrap();
        assert_eq!((found.date, found.rest), (d("2026-08-05"), "AUTOPAY PAYMENT RECEIVED"));
    }

    #[test]
    fn a_missing_year_comes_from_the_period_even_across_new_year() {
        let p = period("2026-12-15", "2027-01-14");
        let r = rules(&[MmDd], false);
        assert_eq!(leading_date("12/20 Coffee 4.50", &r, &p).unwrap().date, d("2026-12-20"));
        assert_eq!(leading_date("01/05 Coffee 4.50", &r, &p).unwrap().date, d("2027-01-05"));
    }

    #[test]
    fn a_leap_day_without_a_year_is_found() {
        let p = period("2028-02-01", "2028-02-29");
        assert_eq!(
            leading_date("02/29 Rent 900.00", &rules(&[MmDd], false), &p).unwrap().date,
            d("2028-02-29")
        );
    }

    #[test]
    fn month_names_with_a_posting_date() {
        let p = period("2026-07-25", "2026-08-24");
        let found = leading_date("Aug 1 Aug 3 STARBUCKS 800-782-7282 WA $10.00", &rules(&[MonDd], true), &p).unwrap();
        assert_eq!((found.date, found.rest), (d("2026-08-01"), "STARBUCKS 800-782-7282 WA $10.00"));
    }

    #[test]
    fn a_full_month_name_date_needs_its_own_format() {
        let p = period("2026-07-25", "2026-08-24");
        assert!(leading_date("Jul 25, 2026 - Aug 24, 2026", &rules(&[MonDd], false), &p).is_none());
        let found = leading_date("Jul 25, 2026 - Aug 24, 2026", &rules(&[MonDdYyyy], false), &p).unwrap();
        assert_eq!(found.date, d("2026-07-25"));
        assert!(is_date_range(found.rest, &rules(&[MonDdYyyy], false), &p));
    }

    #[test]
    fn things_that_only_look_like_dates_are_not_dates() {
        let p = period("2026-08-01", "2026-08-31");
        let r = rules(&[MmDdYy, MmDdYyyy, MmDd], false);
        assert!(leading_date("08/05/2026x Store", &r, &p).is_none());
        assert!(leading_date("123/05 Store", &r, &p).is_none());
        assert!(leading_date("13/45/26 Store", &r, &p).is_none());
        assert!(
            leading_date("09/05/26. This date may not be the same", &r, &p).is_none(),
            "a date must be followed by a space"
        );
        assert!(leading_date("Closing Date 08/21/26", &r, &p).is_none(), "only at the start of the line");
    }

    #[test]
    fn day_first_dates_only_when_the_layout_says_so() {
        let p = period("2026-08-01", "2026-08-31");
        assert!(leading_date("15/08/2026 Pharmacy 18.45", &rules(&[MmDdYyyy], false), &p).is_none());
        assert_eq!(
            leading_date("15/08/2026 Pharmacy 18.45", &rules(&[DdMmYyyy], false), &p).unwrap().date,
            d("2026-08-15")
        );
    }

    #[test]
    fn iso_dates() {
        let p = period("2026-08-01", "2026-08-31");
        assert_eq!(
            leading_date("2026-08-09 Gas -30.00", &rules(&[YyyyMmDd], false), &p).unwrap().date,
            d("2026-08-09")
        );
    }
}

#[cfg(test)]
mod money_tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn values(line: &str) -> Vec<Decimal> {
        find_money(line, &permissive_amounts()).into_iter().map(|m| m.value).collect()
    }

    #[test]
    fn every_negative_style_seen_on_real_statements() {
        assert_eq!(values("Payments/Credits -$43.08"), vec![dec!(-43.08)]);
        assert_eq!(values("Jul 31 Jul 31 ONLINE PYMT - $3,975.23"), vec![dec!(-3975.23)]);
        assert_eq!(values("($10.84) $144.21"), vec![dec!(-10.84), dec!(144.21)]);
        assert_eq!(values("Transfer received 75.00 CR"), vec![dec!(-75.00)]);
        assert_eq!(values("Refund 12.00-"), vec![dec!(-12.00)]);
    }

    #[test]
    fn only_two_decimal_numbers_are_money() {
        assert_eq!(values("05/12 Audible*AJ63E4WA3 Amzn.com/bill NJ .99"), vec![dec!(0.99)]);
        assert_eq!(values("04/26 AMAZON.COM AMZN.COM/BILLWA 8.64 864"), vec![dec!(8.64)]);
        assert_eq!(values("Bought 10.000 at $43.62 ($436.15)"), vec![dec!(43.62), dec!(-436.15)]);
        assert!(values("REINVEST AT 9.470 Quantity 1.054 252.523 $339.3500 5.500% 1,936 800-782-7282").is_empty());
        assert_eq!(values("New Balance = $1,442.49"), vec![dec!(1442.49)]);
    }

    #[test]
    fn a_style_the_layout_does_not_allow_is_not_money() {
        let mut rules = permissive_amounts();
        rules.negatives = vec![NegativeStyle::LeadingMinus];
        assert!(find_money("($10.84)", &rules).is_empty());
        rules.currency = Currency::Required;
        assert!(find_money("33.91", &rules).is_empty());
        assert_eq!(find_money("$33.91", &rules)[0].value, dec!(33.91));
    }

    #[test]
    fn european_marks() {
        let mut rules = permissive_amounts();
        rules.thousands = Thousands::Period;
        rules.decimal = DecimalMark::Comma;
        assert_eq!(find_money("Miete -1.234,56", &rules)[0].value, dec!(-1234.56));
    }

    #[test]
    fn bad_grouping_is_not_money() {
        assert!(values("12,34.56 1234,567.00").is_empty());
    }

    #[test]
    fn numbers_with_a_set_number_of_decimals() {
        let r = permissive_amounts();
        assert_eq!(parse_number_token("252.523", &r, 3), Some(dec!(252.523)));
        assert_eq!(parse_number_token("$339.3500", &r, 4), Some(dec!(339.35)));
        assert_eq!(parse_number_token("10.5000", &r, 3), None);
        assert_eq!(parse_number_token("1,050", &r, 0), Some(dec!(1050)));
    }

    #[test]
    fn the_text_around_the_money_is_kept() {
        let line = "Jul 31 ONLINE PYMT - $3,975.23 thanks";
        let money = find_money(line, &permissive_amounts());
        assert_eq!(without_money(line, &money), "Jul 31 ONLINE PYMT thanks");
    }
}

#[cfg(test)]
mod robustness_tests {
    use super::*;
    use crate::statement::layout::DateFormat;

    /// Real statements carry accents, bullets, euro signs and non-breaking spaces. Nothing the reader
    /// does to a line may panic when such a character sits anywhere in it.
    #[test]
    fn non_ascii_text_anywhere_in_a_line_never_panics() {
        let rules = permissive_amounts();
        let dates = DateRules {
            formats: DateFormat::ALL.to_vec(),
            second_date: true,
            ignore_markers: vec!['*'],
        };
        let period = Period::new("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap()).unwrap();
        let bases = [
            "12.50",
            "(10.84)",
            "- $3,975.23",
            "75.00 CR",
            "12.00-",
            "-$43.08",
            "to 08/05/26",
            "- Aug 24, 2026",
            "Aug 5 Aug 6 Caf\u{e9} 4.50",
            "08/05/26* AUTOPAY 4.50 864",
            "10.000 at $43.62 ($436.15)",
        ];
        for base in bases {
            let positions: Vec<usize> = base.char_indices().map(|(i, _)| i).chain(std::iter::once(base.len())).collect();
            for at in positions {
                for ch in ['\u{e9}', '\u{2014}', '\u{2022}', '\u{20ac}', '\u{a0}', '\u{65e5}'] {
                    let mut line = base.to_string();
                    line.insert(at, ch);
                    let _ = find_money(&line, &rules);
                    let _ = money_token(&line, &rules);
                    let _ = parse_number_token(&line, &rules, 2);
                    let _ = without_money(&line, &find_money(&line, &rules));
                    let _ = leading_date(&line, &dates, &period);
                    let _ = is_date_range(&line, &dates, &period);
                }
            }
        }
    }
}
