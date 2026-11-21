//! Turns a loader's row message (written for developers) into a sentence for the person
//! reviewing an import. The mapping is on the message's wording, so a loader whose
//! wording changes must keep these tests passing.

/// What the review screen says about a row the loaders could not read.
pub fn plain_row_reason(message: &str) -> String {
    let date_of = |prefix: &str| message.strip_prefix(prefix).map(|d| d.trim().trim_matches('\''));
    if message == "row has neither a debit nor a credit amount" {
        "This row has no amount.".to_string()
    } else if message.starts_with("invalid amount") || message.starts_with("invalid debit amount") || message.starts_with("invalid credit amount") {
        "The amount isn't a number.".to_string()
    } else if let Some(date) = date_of("invalid date: ").or_else(|| date_of("invalid date ")) {
        format!("The date {date} isn't a real date.")
    } else if matches!(message, "missing payee (P) line" | "missing NAME/MEMO" | "empty description") {
        "This transaction has no description.".to_string()
    } else if message.starts_with("transaction never closed") {
        "This transaction is cut off; the file may be incomplete.".to_string()
    } else {
        "This row couldn't be read.".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_row_with_no_amount() {
        assert_eq!(plain_row_reason("row has neither a debit nor a credit amount"), "This row has no amount.");
    }

    #[test]
    fn an_amount_that_is_not_a_number() {
        for message in ["invalid amount 'abc'", "invalid debit amount 'x'", "invalid credit amount 'y'", "invalid amount: abc"] {
            assert_eq!(plain_row_reason(message), "The amount isn't a number.", "{message}");
        }
    }

    #[test]
    fn a_date_that_is_not_real_names_the_date() {
        assert_eq!(plain_row_reason("invalid date '13/45/2026'"), "The date 13/45/2026 isn't a real date.");
        assert_eq!(plain_row_reason("invalid date: 20261345"), "The date 20261345 isn't a real date.");
    }

    #[test]
    fn a_transaction_with_no_description() {
        for message in ["missing payee (P) line", "missing NAME/MEMO", "empty description"] {
            assert_eq!(plain_row_reason(message), "This transaction has no description.", "{message}");
        }
    }

    #[test]
    fn a_transaction_cut_off() {
        assert_eq!(
            plain_row_reason("transaction never closed (no </STMTTRN>)"),
            "This transaction is cut off; the file may be incomplete."
        );
    }

    #[test]
    fn anything_else_gets_the_general_sentence() {
        for message in ["missing date column", "unknown account type 'x'", "CSV error: record 3"] {
            assert_eq!(plain_row_reason(message), "This row couldn't be read.", "{message}");
        }
    }
}
