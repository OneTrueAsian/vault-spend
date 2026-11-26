//! VS-71: the technical cause of a backup, restore, key-file or update failure, kept with the plain message.
//!
//! Release builds have no console, so text printed to stderr is lost. The plain sentence the person reads comes
//! first; the cause follows after `DETAIL_SEPARATOR`, and the app shows it under a "Details" button with Copy, for
//! support. The cause is redacted first: the home folder (which names the Windows user) becomes `%USERPROFILE%`, a
//! web address loses its query (a signed download link carries a token there), newlines collapse and the length
//! is capped. Causes here are system and library errors (file, database, network); none carries file contents,
//! passwords or keys (VS-52).

/// Between the plain message and its detail. The frontend's `ERROR_DETAIL_SEPARATOR` must match.
pub const DETAIL_SEPARATOR: &str = "\n\u{1f}";

const MAX_DETAIL_CHARS: usize = 600;

/// `plain`, then the redacted `detail` after `DETAIL_SEPARATOR`. The detail also still goes to stderr for
/// debug builds. A detail that is itself a message with a detail keeps only that inner detail, the real cause.
pub fn with_detail(plain: &str, detail: impl std::fmt::Display) -> String {
    let detail = detail.to_string();
    let cause = detail.split_once(DETAIL_SEPARATOR).map_or(detail.as_str(), |(_, inner)| inner);
    let detail = redact(cause, home_folder().as_deref());
    eprintln!("{plain} [{detail}]");
    format!("{plain}{DETAIL_SEPARATOR}{detail}")
}

/// The plain message alone, without any detail.
#[cfg(test)]
pub fn plain_part(message: &str) -> &str {
    message.split(DETAIL_SEPARATOR).next().unwrap_or(message)
}

/// The detail alone, if there is one.
#[cfg(test)]
pub fn detail_part(message: &str) -> Option<&str> {
    message.split_once(DETAIL_SEPARATOR).map(|(_, detail)| detail)
}

fn home_folder() -> Option<String> {
    std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok().filter(|h| h.len() > 3)
}

fn redact(text: &str, home: Option<&str>) -> String {
    redact_spellings(text, &home.map(home_spellings).unwrap_or_default())
}

/// `redact` with every spelling of the home folder to hide, each in either slash style and any case.
fn redact_spellings(text: &str, spellings: &[String]) -> String {
    let mut out = without_url_queries(&text.split_whitespace().collect::<Vec<_>>().join(" "));
    for home in spellings {
        for form in [home.replace('/', "\\"), home.replace('\\', "/")] {
            out = replace_ignoring_case(&out, &form, "%USERPROFILE%");
        }
    }
    if out.chars().count() > MAX_DETAIL_CHARS {
        out = out.chars().take(MAX_DETAIL_CHARS).collect::<String>() + "…";
    }
    out
}

/// Every spelling of the home folder that must be hidden: the one the system reports, and its Windows short (8.3) spelling.
fn home_spellings(home: &str) -> Vec<String> {
    std::iter::once(home.to_string()).chain(short_spelling(home)).collect()
}

/// The Windows short (8.3) spelling of `path`, for example `C:\Users\RUNNER~1`, when the folder has one that differs from `path`.
/// A path typed in that spelling reaches an error detail without the long user name in it, so the long form alone would not match.
#[cfg(windows)]
fn short_spelling(path: &str) -> Option<String> {
    use windows::{core::PCWSTR, Win32::Storage::FileSystem::GetShortPathNameW};
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: `wide` is a NUL-terminated UTF-16 string that outlives both calls, and the buffer is sized by the first call.
    let needed = unsafe { GetShortPathNameW(PCWSTR(wide.as_ptr()), None) };
    if needed == 0 {
        return None;
    }
    let mut buffer = vec![0u16; needed as usize];
    let written = unsafe { GetShortPathNameW(PCWSTR(wide.as_ptr()), Some(&mut buffer)) } as usize;
    if written == 0 || written >= buffer.len() {
        return None;
    }
    let short = String::from_utf16(&buffer[..written]).ok()?;
    (!short.eq_ignore_ascii_case(path)).then_some(short)
}

#[cfg(not(windows))]
fn short_spelling(_path: &str) -> Option<String> {
    None
}

/// Every `http://` or `https://` address with its `?query` (and `#fragment`) cut to `?…`.
fn without_url_queries(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = ["http://", "https://"].iter().filter_map(|s| rest.find(s)).min() {
        out.push_str(&rest[..start]);
        let url_len = rest[start..].find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ')' | '>')).unwrap_or(rest.len() - start);
        let url = &rest[start..start + url_len];
        match url.find(['?', '#']) {
            Some(cut) => {
                out.push_str(&url[..cut]);
                out.push_str("?…");
            }
            None => out.push_str(url),
        }
        rest = &rest[start + url_len..];
    }
    out.push_str(rest);
    out
}

fn replace_ignoring_case(text: &str, needle: &str, with: &str) -> String {
    if needle.is_empty() {
        return text.to_string();
    }
    let lower_text = text.to_lowercase();
    let lower_needle = needle.to_lowercase();
    // Lower-casing can change byte lengths outside ASCII; fall back to an exact replace then.
    if lower_text.len() != text.len() || lower_needle.len() != needle.len() {
        return text.replace(needle, with);
    }
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    while let Some(found) = lower_text[at..].find(&lower_needle) {
        out.push_str(&text[at..at + found]);
        out.push_str(with);
        at += found + needle.len();
    }
    out.push_str(&text[at..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_plain_message_comes_first_and_the_detail_after_the_separator() {
        let message = with_detail("The backup wasn't saved.", "Access is denied. (os error 5)");
        assert_eq!(plain_part(&message), "The backup wasn't saved.");
        assert_eq!(detail_part(&message), Some("Access is denied. (os error 5)"));
        assert_eq!(plain_part("No detail here."), "No detail here.");
        assert_eq!(detail_part("No detail here."), None);
    }

    #[test]
    fn a_message_with_a_detail_passed_on_as_a_detail_keeps_only_the_inner_cause() {
        let inner = with_detail("The second copy wasn't saved.", "Access is denied. (os error 5)");
        let outer = with_detail("Nothing was restored.", &inner);
        assert_eq!(plain_part(&outer), "Nothing was restored.");
        assert_eq!(detail_part(&outer), Some("Access is denied. (os error 5)"));
    }

    #[test]
    fn the_home_folder_is_redacted_in_either_slash_style_and_any_case() {
        let home = Some(r"C:\Users\Jamie");
        assert_eq!(
            redact(r"couldn't write c:\users\JAMIE\AppData\Roaming\x.db: denied", home),
            r"couldn't write %USERPROFILE%\AppData\Roaming\x.db: denied"
        );
        assert_eq!(redact("failed at C:/Users/Jamie/backups", home), "failed at %USERPROFILE%/backups");
        assert_eq!(redact(r"D:\Data\x.db", home), r"D:\Data\x.db", "a folder outside home stays as it is");
    }

    #[test]
    fn the_short_8_3_spelling_of_the_home_folder_is_redacted_too() {
        // VS-133: the hosted runner's temp folder is spelled C:\Users\RUNNER~1 while the user's home is C:\Users\runneradmin.
        let spellings = [r"C:\Users\runneradmin".to_string(), r"C:\Users\RUNNER~1".to_string()];
        assert_eq!(
            redact_spellings(r"couldn't write C:\Users\RUNNER~1\AppData\Local\Temp\x.db: denied", &spellings),
            r"couldn't write %USERPROFILE%\AppData\Local\Temp\x.db: denied"
        );
        assert_eq!(
            redact_spellings("failed at c:/users/runner~1/backups and C:/Users/runneradmin/more", &spellings),
            "failed at %USERPROFILE%/backups and %USERPROFILE%/more"
        );
        assert_eq!(redact_spellings(r"D:\Data\x.db", &spellings), r"D:\Data\x.db", "a folder outside home stays as it is");
    }

    #[test]
    fn no_spellings_redacts_no_folder() {
        assert_eq!(redact_spellings(r"C:\Users\Jamie\x.db", &[]), r"C:\Users\Jamie\x.db");
    }

    #[cfg(windows)]
    #[test]
    fn the_system_supplies_the_short_spelling_when_the_folder_has_one() {
        assert_eq!(short_spelling(r"C:\this\folder\does\not\exist"), None, "a missing folder has no short spelling");
        let long = std::env::temp_dir().join("vs133_a_long_folder_name_without_a_short_form_of_its_own");
        std::fs::create_dir_all(&long).unwrap();
        let long_text = long.to_string_lossy().to_string();
        match short_spelling(&long_text) {
            Some(short) => {
                assert!(short.contains('~') && short.len() < long_text.len(), "{short} should be the 8.3 form of {long_text}");
                let all = home_spellings(&long_text);
                assert_eq!(redact_spellings(&format!(r"couldn't write {short}\x.db"), &all), r"couldn't write %USERPROFILE%\x.db");
            }
            None => assert!(!long_text.contains('~'), "8.3 names are switched off for this volume, so there is no short spelling to find"),
        }
        std::fs::remove_dir_all(&long).unwrap();
    }

    #[test]
    fn a_web_address_loses_its_query_and_fragment() {
        assert_eq!(
            redact("error sending request for url (https://objects.example.com/a/setup.exe?X-Amz-Signature=abc&token=xyz): timed out", None),
            "error sending request for url (https://objects.example.com/a/setup.exe?…): timed out"
        );
        assert_eq!(redact("see http://example.com/page#secret now", None), "see http://example.com/page?… now");
        assert_eq!(redact("plain https://example.com/latest.json", None), "plain https://example.com/latest.json");
    }

    #[test]
    fn newlines_collapse_and_a_long_detail_is_capped() {
        assert_eq!(redact("first line\nsecond\r\n  third", None), "first line second third");
        let long = redact(&"x".repeat(2000), None);
        assert_eq!(long.chars().count(), MAX_DETAIL_CHARS + 1);
        assert!(long.ends_with('…'));
    }
}
