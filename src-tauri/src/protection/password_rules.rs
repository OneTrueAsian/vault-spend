//! The rule for choosing a new password: at least 12 characters and not on a list of passwords that are
//! already known to be guessed. It applies only where a password is chosen (turning protection on, changing
//! the password, setting one after recovery). Unlocking never calls it, so older, shorter passwords still open.

use std::collections::HashSet;
use std::sync::OnceLock;

pub const MIN_PASSWORD_CHARS: usize = 12;

/// Passwords of 12 or more characters from the NCSC "100k most used" list (SecLists, MIT), lowercased.
static COMMON_PASSWORDS: &str = include_str!("common_passwords.txt");

fn common_passwords() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| COMMON_PASSWORDS.lines().map(str::trim).filter(|line| !line.is_empty()).collect())
}

pub fn below_minimum(password: &str) -> bool {
    password.chars().count() < MIN_PASSWORD_CHARS
}

pub fn check_new_password(password: &str) -> Result<(), String> {
    if below_minimum(password) {
        return Err("Choose a password of at least 12 characters. A few unrelated words works well.".to_string());
    }
    if common_passwords().contains(password.to_lowercase().as_str()) {
        return Err("That password is too common and easy to guess. Try a few unrelated words instead.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eleven_characters_is_too_short() {
        let error = check_new_password("elevenchars").unwrap_err();
        assert!(error.contains("12"), "{error}");
    }

    #[test]
    fn twelve_characters_is_accepted() {
        assert!(check_new_password("twelve chars").is_ok());
    }

    #[test]
    fn length_counts_characters_not_bytes() {
        let password = "ñandú-ñandú!";
        assert_eq!(password.chars().count(), 12);
        assert!(password.len() > 12);
        assert!(check_new_password(password).is_ok());
    }

    #[test]
    fn a_listed_password_is_rejected_in_any_case() {
        let entry = common_passwords()
            .iter()
            .find(|entry| entry.chars().any(|c| c.is_ascii_alphabetic()))
            .expect("list has entries");
        let mixed: String = entry
            .chars()
            .enumerate()
            .map(|(i, c)| if i % 2 == 0 { c.to_ascii_uppercase() } else { c })
            .collect();
        let error = check_new_password(&mixed).unwrap_err();
        assert!(error.contains("common"), "{error}");
    }

    #[test]
    fn below_minimum_counts_characters() {
        assert!(below_minimum("short pass"));
        assert!(!below_minimum("long enough pass"));
    }

    #[test]
    fn the_example_phrases_are_not_on_the_list() {
        assert!(check_new_password("maple lantern river 42").is_ok());
        assert!(check_new_password("correct horse battery staple").is_ok());
    }

    #[test]
    fn a_shorter_existing_password_still_unlocks() {
        let dir = std::env::temp_dir().join(format!("vaultspend-password-rules-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let now = chrono::NaiveDate::from_ymd_opt(2026, 9, 24).unwrap().and_hms_opt(9, 0, 0).unwrap();
        let (_, key_file, _, _) =
            crate::protection::transition::create_protected_profile(&dir.join("config.json"), &dir.join("v.db"), "Sam", "old pass", now).unwrap();
        assert!(below_minimum("old pass"));
        assert!(key_file.unlock_with_password("old pass").is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
