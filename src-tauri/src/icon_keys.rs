/// An icon key is a picker key: 1 to 64 characters from `[a-z0-9-]`, not starting with `-`.
/// Every key the pickers offer fits; anything else is rejected before it is stored.
pub fn valid_icon_key(key: &str) -> bool {
    (1..=64).contains(&key.len()) && !key.starts_with('-') && key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// `None` (clear the icon) is always allowed; a key must pass `valid_icon_key`.
pub fn check_icon_key(key: Option<&str>) -> Result<(), String> {
    match key {
        Some(k) if !valid_icon_key(k) => Err("That icon isn't available.".to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_icon_key_accepts_picker_keys_and_rejects_others() {
        for ok in ["piggy-bank", "a", "avatar-12", "account-avatar-profile-1"] {
            assert!(valid_icon_key(ok), "{ok} should be accepted");
        }
        let too_long = "a".repeat(65);
        for bad in ["", "constructor()", "__proto__", "A", too_long.as_str(), "../x", "key with space", "-lead"] {
            assert!(!valid_icon_key(bad), "{bad} should be rejected");
        }
        assert!(valid_icon_key(&"a".repeat(64)));
    }
}
