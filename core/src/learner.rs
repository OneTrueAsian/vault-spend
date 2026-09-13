use crate::rules::RuleSet;

/// Turns a user's category correction into a rule, so the next transaction
/// from the same merchant is categorized correctly without asking again.
///
/// The rule matches on the transaction's trimmed description. Because
/// `RuleSet::categorize` matches by substring with longest-pattern-wins, a
/// full merchant description naturally outranks a shorter generic keyword
/// rule, and still matches later variants that merely append a store number
/// or location — without needing a separate "priority" concept.
pub fn learn_from_correction(rules: &mut RuleSet, description: &str, category: &str) {
    rules.upsert(description.trim(), category);
}

#[cfg(test)]
mod tests {
    use crate::rules::{Rule, RuleSet};

    use super::*;

    #[test]
    fn a_correction_creates_a_rule_for_that_merchant() {
        let mut rules = RuleSet::new(vec![]);
        learn_from_correction(&mut rules, "Ferrywood Coffee", "Dining Out");

        assert_eq!(rules.categorize("Ferrywood Coffee"), Some("Dining Out".to_string()));
        assert_eq!(rules.categorize("Some Unrelated Store"), None);
    }

    #[test]
    fn learned_rule_still_matches_a_later_variant_of_the_same_merchant() {
        // real bank exports often append a store number or location — the
        // next transaction from "the same merchant" won't be byte-identical.
        let mut rules = RuleSet::new(vec![]);
        learn_from_correction(&mut rules, "Ferrywood Coffee", "Dining Out");

        assert_eq!(rules.categorize("Ferrywood Coffee #482"), Some("Dining Out".to_string()));
    }

    #[test]
    fn correcting_the_same_merchant_again_updates_rather_than_duplicates() {
        let mut rules = RuleSet::new(vec![]);
        learn_from_correction(&mut rules, "Ferrywood Coffee", "Dining Out");
        learn_from_correction(&mut rules, "Ferrywood Coffee", "Coffee & Snacks");

        assert_eq!(rules.len(), 1);
        assert_eq!(rules.categorize("Ferrywood Coffee"), Some("Coffee & Snacks".to_string()));
    }

    #[test]
    fn a_learned_exact_merchant_rule_overrides_a_conflicting_generic_keyword_rule() {
        let mut rules = RuleSet::new(vec![Rule::new("coffee", "Dining Out")]);

        // the user says this specific coffee shop is actually a work expense
        learn_from_correction(&mut rules, "Ferrywood Coffee", "Business Expense");

        assert_eq!(rules.categorize("Ferrywood Coffee"), Some("Business Expense".to_string()));
        // the generic rule still applies to any other coffee merchant
        assert_eq!(rules.categorize("Some Other Coffee Shop"), Some("Dining Out".to_string()));
    }
}
