//! Turns a loader's row message (written for developers) into a sentence for the person
//! reviewing an import. The mapping is on the message's wording, so a loader whose
//! wording changes must keep these tests passing.

/// What the review screen says about a row the loaders could not read.
pub fn plain_row_reason(message: &str) -> String {
    let date_of = |prefix: &str| message.strip_prefix(prefix).map(|d| d.trim().trim_matches('\''));
    let quoted = || {
        let (start, end) = (message.find('\'')?, message.rfind('\'')?);
        (end > start).then(|| &message[start + 1..end])
    };
    let numeric_field = || {
        let rest = message.strip_prefix("invalid ")?;
        let field = rest[..rest.find(" '")?].to_string();
        ["starting balance", "monthly amount", "target amount", "shares", "price", "cost basis"]
            .contains(&field.as_str())
            .then_some(field)
    };
    if matches!(message, "missing DTPOSTED" | "missing date (D) line") {
        "This row has no date.".to_string()
    } else if matches!(message, "missing TRNAMT" | "missing amount (T/U) line") {
        "This row has no amount.".to_string()
    } else if let (Some(field), Some(value)) = (numeric_field(), quoted()) {
        format!("{value} isn't a number for {field}.")
    } else if let (Some(value), true) = (quoted(), message.starts_with("invalid target date ")) {
        format!("The date {value} isn't a real date.")
    } else if let (Some(value), true) = (quoted(), message.starts_with("unknown account type ")) {
        format!("{value} isn't an account type Vault Spend knows.")
    } else if let (Some(value), true) = (quoted(), message.starts_with("unknown budget group ")) {
        format!("{value} isn't a budget group Vault Spend knows.")
    } else if let Some(field) = message.strip_prefix("missing ").filter(|f| !f.ends_with(" column") && !f.contains(['(', '/'])) {
        format!("This row has no {}.", if field == "bucket name" { "goal name" } else { field })
    } else if message == "row has neither a debit nor a credit amount" {
        "This row has no amount.".to_string()
    } else if message.starts_with("invalid amount") || message.starts_with("invalid debit amount") || message.starts_with("invalid credit amount") {
        if message.trim_end_matches([':', ' ', '\'']).ends_with("amount") {
            "This row has no amount.".to_string()
        } else {
            "The amount isn't a number.".to_string()
        }
    } else if let Some(date) = date_of("invalid date: ").or_else(|| date_of("invalid date ")) {
        if date.is_empty() {
            "This row has no date.".to_string()
        } else {
            format!("The date {date} isn't a real date.")
        }
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
    fn an_empty_date_is_said_to_be_missing_not_wrong() {
        for message in ["invalid date ''", "invalid date: ", "invalid date: ''"] {
            assert_eq!(plain_row_reason(message), "This row has no date.", "{message}");
        }
    }

    #[test]
    fn an_empty_amount_is_said_to_be_missing_not_wrong() {
        for message in ["invalid amount ''", "invalid debit amount ''", "invalid credit amount ''", "invalid amount: "] {
            assert_eq!(plain_row_reason(message), "This row has no amount.", "{message}");
        }
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
    fn a_missing_date_or_amount_in_an_ofx_or_qif_record() {
        for message in ["missing DTPOSTED", "missing date (D) line"] {
            assert_eq!(plain_row_reason(message), "This row has no date.", "{message}");
        }
        for message in ["missing TRNAMT", "missing amount (T/U) line"] {
            assert_eq!(plain_row_reason(message), "This row has no amount.", "{message}");
        }
    }

    #[test]
    fn a_setup_row_missing_a_field_names_the_field() {
        assert_eq!(plain_row_reason("missing account name"), "This row has no account name.");
        assert_eq!(plain_row_reason("missing budget category"), "This row has no budget category.");
        assert_eq!(plain_row_reason("missing cost basis"), "This row has no cost basis.");
        assert_eq!(plain_row_reason("missing symbol"), "This row has no symbol.");
        assert_eq!(plain_row_reason("missing bucket name"), "This row has no goal name.");
    }

    #[test]
    fn a_setup_number_that_is_not_a_number_names_the_field_and_value() {
        assert_eq!(plain_row_reason("invalid monthly amount 'lots'"), "lots isn't a number for monthly amount.");
        assert_eq!(plain_row_reason("invalid target amount 'x1'"), "x1 isn't a number for target amount.");
        assert_eq!(plain_row_reason("invalid starting balance 'n/a'"), "n/a isn't a number for starting balance.");
        assert_eq!(plain_row_reason("invalid shares 'two'"), "two isn't a number for shares.");
        assert_eq!(plain_row_reason("invalid price 'p'"), "p isn't a number for price.");
        assert_eq!(plain_row_reason("invalid cost basis 'q'"), "q isn't a number for cost basis.");
    }

    #[test]
    fn a_setup_target_date_that_is_not_real() {
        assert_eq!(plain_row_reason("invalid target date '2026-13-40'"), "The date 2026-13-40 isn't a real date.");
    }

    #[test]
    fn an_unknown_setup_account_type_or_budget_group_names_the_value() {
        assert_eq!(
            plain_row_reason("unknown account type 'piggy' (expected one of: checking, savings)"),
            "piggy isn't an account type Vault Spend knows."
        );
        assert_eq!(
            plain_row_reason("unknown budget group 'misc' (expected one of: income, fixed)"),
            "misc isn't a budget group Vault Spend knows."
        );
    }

    #[test]
    fn a_missing_csv_column_stays_on_the_general_sentence() {
        assert_eq!(plain_row_reason("missing date column"), "This row couldn't be read.");
    }

    #[test]
    fn anything_else_gets_the_general_sentence() {
        for message in ["missing date column", "CSV error: record 3"] {
            assert_eq!(plain_row_reason(message), "This row couldn't be read.", "{message}");
        }
    }
}
