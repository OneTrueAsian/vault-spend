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

/// Where `label` ends (a byte offset into `line`) when it appears anywhere in the line, ignoring case and
/// whitespace; `None` when it does not appear.
pub fn label_end(line: &str, label: &str) -> Option<usize> {
    let wanted: Vec<char> = label.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect();
    if wanted.is_empty() {
        return None;
    }
    let starts: Vec<usize> = line.char_indices().map(|(i, _)| i).collect();
    'start: for &start in &starts {
        let mut matched = 0;
        for (offset, c) in line[start..].char_indices() {
            if c.is_whitespace() {
                if matched == 0 {
                    continue 'start;
                }
                continue;
            }
            let mut lower = c.to_lowercase();
            let (first, second) = (lower.next(), lower.next());
            if first != Some(wanted[matched]) || second.is_some() {
                continue 'start;
            }
            matched += 1;
            if matched == wanted.len() {
                return Some(start + offset + c.len_utf8());
            }
        }
    }
    None
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

    #[test]
    fn a_label_is_found_anywhere_in_a_line_and_its_end_is_reported() {
        let line = "For the Previous  Balance $9,999.99 now";
        let end = label_end(line, "previous balance").unwrap();
        assert_eq!(&line[end..], " $9,999.99 now");
        assert_eq!(label_end("no such thing here", "New Balance"), None);
        assert_eq!(label_end("New Balance", ""), None);
        // Multi-byte characters before and inside the line never confuse the offsets.
        let accented = "Caf\u{e9} \u{2014} New Balance = $80.00";
        let end = label_end(accented, "New Balance").unwrap();
        assert_eq!(&accented[end..], " = $80.00");
    }
}
