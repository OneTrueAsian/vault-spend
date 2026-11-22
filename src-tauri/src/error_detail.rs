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
    let mut out = without_url_queries(&text.split_whitespace().collect::<Vec<_>>().join(" "));
    if let Some(home) = home {
        for form in [home.replace('/', "\\"), home.replace('\\', "/")] {
            out = replace_ignoring_case(&out, &form, "%USERPROFILE%");
        }
    }
    if out.chars().count() > MAX_DETAIL_CHARS {
        out = out.chars().take(MAX_DETAIL_CHARS).collect::<String>() + "…";
    }
    out
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
