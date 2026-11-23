//! Watched-folder imports (VS-102): the pure rules for which files in a chosen folder belong to
//! which account mapping, and whether a file is new enough to be queued automatically.
//!
//! A file name is the stem, an optional `_` or ` - `, then a date or a date range, then `.<ext>`:
//! `2026-11-18`, `2026-11-11_to_2026-11-18`, `2026-11-11 to 2026-11-18`, `Nov 18, 2026` or
//! `Nov 11 to Nov 18, 2026` (month names short or full; the start's year may be left out). The
//! end date says how recent the export is; it never replaces any row's own date. These rules
//! decide only from the name, so an older export is skipped without being opened.

use chrono::NaiveDate;

/// Extensions a folder mapping may watch. OFX/QFX/QIF stay manual-only.
pub const FOLDER_EXTENSIONS: [&str; 2] = ["csv", "xlsx"];

/// The largest bank file a folder import reads, in bytes.
pub const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
/// The most rows one file may have.
pub const MAX_FILE_ROWS: usize = 50_000;
/// The most exports waiting for review at once.
pub const MAX_PENDING_BATCHES: usize = 200;
/// The most saved file bytes kept across all batches.
pub const MAX_STAGED_BYTES: i64 = 128 * 1024 * 1024;
/// How many activity entries are kept for display (receipts are never pruned).
pub const MAX_ACTIVITY_ROWS: i64 = 300;

/// The dates a matching file name carries. `start == end` for a single-date name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportDates {
    pub start: NaiveDate,
    pub end: NaiveDate,
}

/// Why a file name was not accepted for a mapping whose stem it starts with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NameProblem {
    /// Not this mapping's stem, or not a watched extension: the file is simply not this mapping's.
    NotThisMapping,
    /// The right stem and extension, but the date part is missing or not a real date.
    BadDate,
    /// A date range whose start is after its end.
    ReversedRange,
}

impl NameProblem {
    /// Plain words for the activity list.
    pub fn reason(&self) -> &'static str {
        match self {
            NameProblem::NotThisMapping => "Not one of your export names",
            NameProblem::BadDate => {
                "The name doesn't end with a real date like 2026-11-18 or Nov 18, 2026. Rename it so the date comes last (a copy saved as \"(1)\" needs renaming too)"
            }
            NameProblem::ReversedRange => "The date range in the name ends before it starts",
        }
    }
}

/// A saved stem compared the way a file's is: trimmed, any trailing `_` or ` - ` separator dropped,
/// any case.
pub fn normalize_stem(stem: &str) -> String {
    stem.trim().trim_end_matches(|c: char| c == '_' || c == '-' || c.is_whitespace()).to_lowercase()
}

/// The lower-case extension of `file_name`, if it has one.
pub fn extension_of(file_name: &str) -> Option<String> {
    let (_, ext) = file_name.rsplit_once('.')?;
    if ext.is_empty() { None } else { Some(ext.to_ascii_lowercase()) }
}

fn iso_date(s: &str) -> Option<NaiveDate> {
    // Exactly YYYY-MM-DD: chrono alone also accepts unpadded parts.
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    if !b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) {
        return None;
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

/// Whether `s` has the shape `dddd-dd-dd` (not necessarily a real date).
fn date_shaped(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

/// `s` split before its last `n` bytes, if that falls on a character boundary.
fn split_tail(s: &str, n: usize) -> Option<(&str, &str)> {
    let at = s.len().checked_sub(n)?;
    Some((s.get(..at)?, s.get(at..)?))
}

/// Dates read from the end of a name: the stem before them, and the start and end dates, or `None`
/// when the end has a date's shape but isn't a real date.
type ReadDates<'a> = (&'a str, Option<(NaiveDate, NaiveDate)>);

/// The dates at the end of a name without its extension, in any of the accepted forms.
fn read_dates(base: &str) -> Option<ReadDates<'_>> {
    iso_dates(base).or_else(|| month_dates(base))
}

/// `2026-11-18`, `2026-11-11_to_2026-11-18` or `2026-11-11 to 2026-11-18`.
fn iso_dates(base: &str) -> Option<ReadDates<'_>> {
    let (rest, end) = split_tail(base, 10).filter(|(_, end)| date_shaped(end))?;
    let range = split_tail(rest, 4)
        .filter(|(_, sep)| sep.eq_ignore_ascii_case("_to_") || sep.eq_ignore_ascii_case(" to "))
        .and_then(|(before, _)| split_tail(before, 10))
        .filter(|(_, start)| date_shaped(start));
    let (stem, start) = range.unwrap_or((rest, end));
    Some((stem, iso_date(start).zip(iso_date(end))))
}

/// A month's number from its name: short (`Nov`, also `Sept`) or full (`November`), any case.
fn month_number(word: &str) -> Option<u32> {
    const MONTHS: [&str; 12] = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    let word = word.to_ascii_lowercase();
    if word == "sept" {
        return Some(9);
    }
    MONTHS
        .iter()
        .position(|m| word == *m || (word.len() == 3 && m.starts_with(word.as_str())))
        .map(|i| i as u32 + 1)
}

/// `Nov 18` or `Nov 18, 2026` at the end of `s`: what comes before it, the month, the day and the
/// year if given.
fn month_day(s: &str) -> Option<(&str, u32, u32, Option<i32>)> {
    let s = s.trim_end();
    let (s, year) = match split_tail(s, 4).filter(|(_, y)| y.bytes().all(|b| b.is_ascii_digit())) {
        Some((before, y)) if before.trim_end().ends_with(',') => (before.trim_end().strip_suffix(',')?, Some(y.parse().ok()?)),
        _ => (s, None),
    };
    let (before, day) = s.rsplit_once(' ')?;
    if day.is_empty() || day.len() > 2 || !day.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (before, month) = before.rsplit_once(' ').unwrap_or(("", before));
    Some((before, month_number(month)?, day.parse().ok()?, year))
}

/// `Nov 18, 2026`, `Nov 11 to Nov 18, 2026` or `Nov 11, 2026 to Nov 18, 2026`. A start without a
/// year is in the end's year, or the year before when its month comes later (`Dec 28 to Jan 4, 2027`).
fn month_dates(base: &str) -> Option<ReadDates<'_>> {
    let (rest, end_month, end_day, end_year) = month_day(base)?;
    let end_year = end_year?;
    let end = NaiveDate::from_ymd_opt(end_year, end_month, end_day);
    let range = split_tail(rest, 3)
        .filter(|(_, to)| to.eq_ignore_ascii_case(" to"))
        .and_then(|(before, _)| month_day(before));
    let Some((stem, start_month, start_day, start_year)) = range else {
        return Some((rest, end.map(|e| (e, e))));
    };
    let start_year = start_year.unwrap_or(if start_month > end_month { end_year - 1 } else { end_year });
    Some((stem, NaiveDate::from_ymd_opt(start_year, start_month, start_day).zip(end)))
}

/// Reads `file_name` against a mapping's `stem` and watched `extensions` (lower case).
pub fn match_export_name(stem: &str, extensions: &[String], file_name: &str) -> Result<ExportDates, NameProblem> {
    let stem = normalize_stem(stem);
    if stem.is_empty() {
        return Err(NameProblem::NotThisMapping);
    }
    let Some(ext) = extension_of(file_name) else {
        return Err(NameProblem::NotThisMapping);
    };
    if !extensions.iter().any(|e| e.eq_ignore_ascii_case(&ext)) {
        return Err(NameProblem::NotThisMapping);
    }
    let base = &file_name[..file_name.len() - ext.len() - 1];
    // The dates are read from the end of the name; everything before them is the name's stem.
    // Slicing uses `str::get` and `rsplit_once`, so a name with accented or other multi-byte
    // characters is never cut inside a character.
    let Some((name_stem, dates)) = read_dates(base) else {
        // No date at the end: this mapping's file with a bad name if it starts with the stem and a
        // separator (for example a browser's "(1)" copy), anyone else's otherwise.
        let lower = base.to_lowercase();
        let ours = lower
            .strip_prefix(stem.as_str())
            .is_some_and(|rest| rest.starts_with('_') || rest.starts_with(" -"));
        return Err(if ours { NameProblem::BadDate } else { NameProblem::NotThisMapping });
    };
    if normalize_stem(name_stem) != stem {
        return Err(NameProblem::NotThisMapping);
    }
    let Some((start, end)) = dates else {
        return Err(NameProblem::BadDate);
    };
    if start > end {
        return Err(NameProblem::ReversedRange);
    }
    Ok(ExportDates { start, end })
}

/// Whether an export may be queued automatically.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Eligibility {
    Eligible,
    /// Strictly older than the cutoff or the last successful import's export date.
    Older { limit: NaiveDate },
}

/// An export is skipped when its end date is strictly before both limits' later one. A same-date
/// export stays eligible (its content may be new; receipts catch identical files).
pub fn eligibility(end: NaiveDate, initial_cutoff: Option<NaiveDate>, watermark: Option<NaiveDate>) -> Eligibility {
    match initial_cutoff.into_iter().chain(watermark).max() {
        Some(limit) if end < limit => Eligibility::Older { limit },
        _ => Eligibility::Eligible,
    }
}

/// Shown for an export whose name is dated in the future.
pub const FUTURE_REASON: &str = "The date in the name is in the future, so it isn't queued. Check the name and rename the file.";

/// Whether an export's end date is more than a day after `today` (a day is allowed for time
/// zones). Such a name is a typo: approving it would make every real export after it look older.
pub fn dated_in_future(end: NaiveDate, today: NaiveDate) -> bool {
    end > today + chrono::Days::new(1)
}

/// Names that are never a finished export: partial downloads, editor locks and hidden files.
pub fn is_temporary_name(file_name: &str) -> bool {
    let lower = file_name.to_lowercase();
    lower.starts_with('.')
        || lower.starts_with("~$")
        || [".crdownload", ".part", ".partial", ".tmp", ".download"].iter().any(|s| lower.ends_with(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn exts() -> Vec<String> {
        vec!["csv".to_string(), "xlsx".to_string()]
    }

    #[test]
    fn stem_with_or_without_its_trailing_underscore_matches_a_single_date() {
        for stem in ["Bank Max Checking", "Bank Max Checking_", "  bank max checking_  "] {
            let dates = match_export_name(stem, &exts(), "Bank Max Checking_2026-11-18.csv").unwrap();
            assert_eq!(dates, ExportDates { start: d("2026-11-18"), end: d("2026-11-18") }, "{stem}");
        }
    }

    #[test]
    fn a_date_range_uses_its_end_and_must_not_be_reversed() {
        let dates = match_export_name("Bank Max Checking_", &exts(), "Bank Max Checking_2026-11-11_to_2026-11-18.csv").unwrap();
        assert_eq!(dates.start, d("2026-11-11"));
        assert_eq!(dates.end, d("2026-11-18"));
        assert_eq!(
            match_export_name("Bank Max Checking", &exts(), "Bank Max Checking_2026-11-18_to_2026-11-11.csv"),
            Err(NameProblem::ReversedRange)
        );
    }

    #[test]
    fn extensions_match_in_any_case_and_only_watched_ones_count() {
        assert!(match_export_name("Bank Max Checking", &exts(), "Bank Max Checking_2026-11-18.CSV").is_ok());
        assert!(match_export_name("Bank Max Checking", &exts(), "Bank Max Checking_2026-11-18.Xlsx").is_ok());
        assert_eq!(
            match_export_name("Bank Max Checking", &["csv".to_string()], "Bank Max Checking_2026-11-18.xlsx"),
            Err(NameProblem::NotThisMapping)
        );
        assert_eq!(match_export_name("Bank Max Checking", &exts(), "Bank Max Checking_2026-11-18.ofx"), Err(NameProblem::NotThisMapping));
        assert_eq!(match_export_name("Bank Max Checking", &exts(), "Bank Max Checking_2026-11-18"), Err(NameProblem::NotThisMapping));
    }

    #[test]
    fn malformed_or_invalid_dates_are_this_mappings_bad_name() {
        for name in [
            "Bank Max Checking_2026-02-30.csv",
            "Bank Max Checking_2026-11-1.csv",
            "Bank Max Checking_latest.csv",
            "Bank Max Checking_2026-13-01_to_2026-11-18.csv",
            "Bank Max Checking_20261118.csv",
        ] {
            assert_eq!(match_export_name("Bank Max Checking", &exts(), name), Err(NameProblem::BadDate), "{name}");
        }
    }

    #[test]
    fn other_accounts_names_are_not_fuzzily_matched() {
        for name in [
            "Bank Max Savings_2026-11-18.csv",
            "Bank Max Checking Joint_2026-11-18.csv",
            "Max Checking_2026-11-18.csv",
            "Other Bank Max Checking_2026-11-18.csv",
        ] {
            assert_eq!(match_export_name("Bank Max Checking", &exts(), name), Err(NameProblem::NotThisMapping), "{name}");
        }
    }

    #[test]
    fn names_with_accents_or_other_characters_never_panic() {
        for name in ["Café Checking.csv", "xéaaaaaaaaa.csv", "é.csv", "Ünïcödé Bänk_2026-11-18.csv", "Bank Max Checkingé_to_2026-11-18.csv"] {
            assert_eq!(match_export_name("Bank Max Checking", &exts(), name), Err(NameProblem::NotThisMapping), "{name}");
        }
        assert!(match_export_name("Café Checking", &exts(), "Café Checking_2026-11-18.csv").is_ok());
        assert!(match_export_name("Café Checking", &exts(), "café checking_2026-11-11_to_2026-11-18.csv").is_ok());
        assert_eq!(match_export_name("Café Checking", &exts(), "Café Checking_ünknown.csv"), Err(NameProblem::BadDate));
    }

    #[test]
    fn a_stem_containing_to_still_reads_a_single_date() {
        let dates = match_export_name("Checking_to_Savings", &exts(), "Checking_to_Savings_2026-11-18.csv").unwrap();
        assert_eq!(dates.end, d("2026-11-18"));
        let range = match_export_name("Checking_to_Savings", &exts(), "Checking_to_Savings_2026-11-01_to_2026-11-18.csv").unwrap();
        assert_eq!((range.start, range.end), (d("2026-11-01"), d("2026-11-18")));
    }

    #[test]
    fn another_export_name_that_starts_with_this_stem_is_not_this_mappings() {
        assert_eq!(match_export_name("Chase", &exts(), "Chase_Savings_2026-11-18.csv"), Err(NameProblem::NotThisMapping));
        // A browser's duplicate copy is this mapping's, with a name that needs fixing.
        assert_eq!(match_export_name("Chase", &exts(), "Chase_2026-11-18 (1).csv"), Err(NameProblem::BadDate));
        assert!(NameProblem::BadDate.reason().contains("(1)"));
    }

    const LMCU: &str = "Lake Michigan Credit Union - Household (02)";

    #[test]
    fn a_dash_separated_name_with_an_iso_range_joined_by_to_matches() {
        for stem in [LMCU, "Lake Michigan Credit Union - Household (02) -", "lake michigan credit union - household (02)"] {
            let dates = match_export_name(stem, &exts(), "Lake Michigan Credit Union - Household (02) - 2026-11-16 to 2026-11-23.csv").unwrap();
            assert_eq!((dates.start, dates.end), (d("2026-11-16"), d("2026-11-23")), "{stem}");
        }
        let single = match_export_name(LMCU, &exts(), "Lake Michigan Credit Union - Household (02) - 2026-11-23.csv").unwrap();
        assert_eq!((single.start, single.end), (d("2026-11-23"), d("2026-11-23")));
    }

    #[test]
    fn month_name_dates_match_with_the_year_on_the_end_only_or_on_both() {
        let cases = [
            ("Lake Michigan Credit Union - Household (02) - Nov 16 to Nov 23, 2026.csv", "2026-11-16", "2026-11-23"),
            ("Lake Michigan Credit Union - Household (02) - November 16 to November 23, 2026.csv", "2026-11-16", "2026-11-23"),
            ("Lake Michigan Credit Union - Household (02) - nov 16, 2026 to NOV 23, 2026.CSV", "2026-11-16", "2026-11-23"),
            ("Lake Michigan Credit Union - Household (02) - Nov 23, 2026.csv", "2026-11-23", "2026-11-23"),
            ("Lake Michigan Credit Union - Household (02) - Sept 5 to Sep 12, 2026.csv", "2026-09-05", "2026-09-12"),
            // A range across New Year: the start without a year is in the year before.
            ("Lake Michigan Credit Union - Household (02) - Dec 28 to Jan 4, 2027.csv", "2026-12-28", "2027-01-04"),
        ];
        for (name, start, end) in cases {
            let dates = match_export_name(LMCU, &exts(), name).unwrap_or_else(|e| panic!("{name}: {e:?}"));
            assert_eq!((dates.start, dates.end), (d(start), d(end)), "{name}");
        }
    }

    #[test]
    fn month_name_dates_that_are_not_real_or_run_backwards_are_this_mappings_bad_name() {
        assert_eq!(
            match_export_name(LMCU, &exts(), "Lake Michigan Credit Union - Household (02) - Nov 31, 2026.csv"),
            Err(NameProblem::BadDate)
        );
        assert_eq!(
            match_export_name(LMCU, &exts(), "Lake Michigan Credit Union - Household (02) - Nov 23 to Nov 16, 2026.csv"),
            Err(NameProblem::ReversedRange)
        );
        assert_eq!(
            match_export_name(LMCU, &exts(), "Lake Michigan Credit Union - Household (02) - Nov 16 to Nov 23, 2026 (1).csv"),
            Err(NameProblem::BadDate),
            "a browser's copy of this name"
        );
        assert_eq!(
            match_export_name(LMCU, &exts(), "Lake Michigan Credit Union - Savings (01) - Nov 16 to Nov 23, 2026.csv"),
            Err(NameProblem::NotThisMapping),
            "another account's export at the same bank"
        );
        assert!(NameProblem::BadDate.reason().contains("Nov 18, 2026"));
    }

    #[test]
    fn age_uses_the_later_of_cutoff_and_watermark_and_same_date_stays_eligible() {
        assert_eq!(eligibility(d("2026-11-10"), Some(d("2026-11-15")), None), Eligibility::Older { limit: d("2026-11-15") });
        assert_eq!(eligibility(d("2026-11-15"), Some(d("2026-11-15")), None), Eligibility::Eligible);
        assert_eq!(
            eligibility(d("2026-11-16"), Some(d("2026-11-01")), Some(d("2026-11-18"))),
            Eligibility::Older { limit: d("2026-11-18") }
        );
        assert_eq!(eligibility(d("2026-11-18"), Some(d("2026-11-01")), Some(d("2026-11-18"))), Eligibility::Eligible);
        assert_eq!(eligibility(d("2001-01-01"), None, None), Eligibility::Eligible, "include-existing setup has no cutoff");
    }

    #[test]
    fn temporary_and_hidden_names_are_never_exports() {
        for name in ["~$Bank Max Checking_2026-11-18.xlsx", "Bank Max Checking_2026-11-18.csv.crdownload", ".Bank_2026-11-18.csv", "x.tmp"] {
            assert!(is_temporary_name(name), "{name}");
        }
        assert!(!is_temporary_name("Bank Max Checking_2026-11-18.csv"));
    }
}
