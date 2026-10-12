//! Dates and money on statement lines, recognised by hand (no regular expressions): every accepted form
//! comes from the layout's closed option set.

use super::layout::{DateFormat, DateRules};
use super::model::Period;
use chrono::{Datelike, NaiveDate};

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
    } else if r.len() > 3 && r[..3].eq_ignore_ascii_case("to ") {
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
