//! How statement text is compared with layout labels.

/// Lower-case with every whitespace character removed: "Account Summary" and "AccountSummary" agree.
pub fn squash(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect()
}

pub fn starts_with_label(line: &str, label: &str) -> bool {
    let label = squash(label);
    !label.is_empty() && squash(line).starts_with(&label)
}

pub fn contains_label(line: &str, label: &str) -> bool {
    let label = squash(label);
    !label.is_empty() && squash(line).contains(&label)
}

/// The line is the label and nothing else (its amount is on a following line).
pub fn is_label_only(line: &str, label: &str) -> bool {
    let label = squash(label);
    !label.is_empty() && squash(line) == label
}

/// `phrase` appears anywhere in `line`, ignoring case and runs of whitespace.
pub fn contains_phrase(line: &str, phrase: &str) -> bool {
    let norm = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let phrase = norm(phrase);
    !phrase.is_empty() && norm(line).contains(&phrase)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_ignore_case_and_whitespace_and_match_at_the_start() {
        assert!(starts_with_label("AccountSummary", "Account Summary"));
        assert!(starts_with_label("New Balance: $34.90", "new balance"));
        assert!(!starts_with_label("If you pay your New Balance in full", "New Balance"));
        assert!(contains_label("EVERYDAY CHECKING Share Account ID 01", "Share Account ID"));
        assert!(is_label_only("  New   Balance ", "New Balance"));
        assert!(!is_label_only("New Balance $52.36", "New Balance"));
        assert!(contains_phrase(
            "Jul 25, 2026 - Aug 24, 2026 | 31 days in Billing Cycle",
            "days in billing cycle"
        ));
    }
}
