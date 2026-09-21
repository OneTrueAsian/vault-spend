//! Recovery codes (plan v2 section 4.1): 26 random symbols from a 32-symbol alphabet with no
//! look-alike characters (130 bits), plus 2 checksum symbols, shown as seven groups of four.
use super::{ProtectionError, random_bytes};
use zeroize::Zeroizing;

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SYMBOLS: usize = 26;
const CHECK_SYMBOLS: usize = 2;

const _: () = assert!(SYMBOLS * 5 >= 128, "a recovery code must carry at least 128 bits");

/// The 26 normalized symbols. They are also the secret that is fed to the KDF.
pub struct RecoveryCode {
    symbols: Zeroizing<String>,
}

fn value_of(symbol: u8) -> Option<usize> {
    ALPHABET.iter().position(|&a| a == symbol)
}

/// Two symbols that catch every single mistyped symbol and every swap of neighbours. A typo
/// guard, not a security feature.
fn checksum(symbols: &[u8]) -> [u8; CHECK_SYMBOLS] {
    let sum: usize = symbols
        .iter()
        .enumerate()
        .map(|(i, &s)| (i + 1) * value_of(s).unwrap_or(0))
        .sum::<usize>()
        % 1024;
    [ALPHABET[sum >> 5], ALPHABET[sum & 31]]
}

impl RecoveryCode {
    pub fn generate() -> Self {
        // 256 is a multiple of 32, so masking a random byte to 5 bits is unbiased.
        let symbols: String = random_bytes::<SYMBOLS>().iter().map(|b| ALPHABET[(*b & 31) as usize] as char).collect();
        RecoveryCode {
            symbols: Zeroizing::new(symbols),
        }
    }

    /// `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`: the 26 symbols followed by the 2 checksum symbols.
    pub fn display(&self) -> String {
        let mut all = self.symbols.as_bytes().to_vec();
        all.extend_from_slice(&checksum(self.symbols.as_bytes()));
        all.chunks(4)
            .map(|group| std::str::from_utf8(group).expect("the alphabet is ASCII"))
            .collect::<Vec<_>>()
            .join("-")
    }

    /// Accepts what a person types: any case, with or without dashes and spaces, and the
    /// letters O, I and L read as 0, 1 and 1.
    pub fn parse(input: &str) -> Result<Self, ProtectionError> {
        let mut cleaned = Vec::new();
        for c in input.chars().filter(|c| !c.is_whitespace() && *c != '-') {
            let c = match c.to_ascii_uppercase() {
                'O' => '0',
                'I' | 'L' => '1',
                other => other,
            };
            if !c.is_ascii() || value_of(c as u8).is_none() {
                return Err(ProtectionError::InvalidRecoveryCode);
            }
            cleaned.push(c as u8);
        }
        if cleaned.len() != SYMBOLS + CHECK_SYMBOLS {
            return Err(ProtectionError::InvalidRecoveryCode);
        }
        let (symbols, check) = cleaned.split_at(SYMBOLS);
        if checksum(symbols)[..] != *check {
            return Err(ProtectionError::InvalidRecoveryCode);
        }
        Ok(RecoveryCode {
            symbols: Zeroizing::new(String::from_utf8(symbols.to_vec()).expect("the alphabet is ASCII")),
        })
    }

    pub fn secret_bytes(&self) -> &[u8] {
        self.symbols.as_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXED: &str = "0123456789ABCDEFGHJKMNPQRS"; // 26 valid symbols

    fn code_from(symbols: &str) -> RecoveryCode {
        RecoveryCode {
            symbols: Zeroizing::new(symbols.to_string()),
        }
    }

    #[test]
    fn a_generated_code_is_seven_groups_of_four_from_the_safe_alphabet() {
        let shown = RecoveryCode::generate().display();

        let groups: Vec<&str> = shown.split('-').collect();
        assert_eq!(groups.len(), 7);
        assert!(groups.iter().all(|g| g.len() == 4));
        assert!(shown.chars().filter(|c| *c != '-').all(|c| ALPHABET.contains(&(c as u8))));
        assert!(!shown.contains(['I', 'L', 'O', 'U']), "no look-alike characters");
    }

    #[test]
    fn a_code_carries_at_least_128_bits_and_no_two_are_alike() {
        assert!(SYMBOLS * 5 >= 128);
        assert_ne!(RecoveryCode::generate().display(), RecoveryCode::generate().display());
    }

    #[test]
    fn what_is_shown_parses_back_to_the_same_secret() {
        let code = RecoveryCode::generate();

        let parsed = RecoveryCode::parse(&code.display()).unwrap();

        assert_eq!(parsed.secret_bytes(), code.secret_bytes());
        assert_eq!(parsed.secret_bytes().len(), 26);
    }

    #[test]
    fn parsing_ignores_case_dashes_spaces_and_look_alike_letters() {
        let typed = code_from(FIXED)
            .display()
            .to_lowercase()
            .replace('-', " ")
            .replace('0', "o")
            .replace('1', "l");

        let parsed = RecoveryCode::parse(&typed).unwrap();

        assert_eq!(parsed.secret_bytes(), FIXED.as_bytes());
    }

    #[test]
    fn every_single_mistyped_symbol_is_caught() {
        let shown = code_from(FIXED).display().replace('-', "");
        for position in 0..shown.len() {
            let original = shown.as_bytes()[position];
            let replacement = ALPHABET.iter().copied().find(|a| *a != original).unwrap();
            let mut typo = shown.clone().into_bytes();
            typo[position] = replacement;
            assert!(RecoveryCode::parse(&String::from_utf8(typo).unwrap()).is_err(), "position {position}");
        }
    }

    #[test]
    fn swapping_two_neighbouring_symbols_is_caught() {
        let mut swapped = code_from(FIXED).display().replace('-', "").into_bytes();
        swapped.swap(3, 4);

        assert!(RecoveryCode::parse(&String::from_utf8(swapped).unwrap()).is_err());
    }

    #[test]
    fn wrong_length_and_illegal_characters_are_rejected() {
        let shown = code_from(FIXED).display();
        let too_short = shown[..shown.len() - 1].to_string();
        let too_long = format!("{shown}A");
        for bad in [
            String::new(),
            too_short,
            too_long,
            shown.replace('0', "U"),
            shown.replace('0', "#"),
            shown.replace('0', "é"),
        ] {
            assert_eq!(RecoveryCode::parse(&bad).err(), Some(ProtectionError::InvalidRecoveryCode), "{bad}");
        }
    }
}
