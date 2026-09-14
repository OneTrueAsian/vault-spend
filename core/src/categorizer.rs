use crate::classifier::Classifier;
use crate::rules::RuleSet;
use crate::store::CategorySource;

/// Below this many labeled examples, the classifier is considered too thin
/// on data to trust — a transaction falls through to `Uncategorized`
/// instead of taking a wild guess from one or two corrections.
pub const MIN_TRAINING_EXAMPLES_FOR_CLASSIFIER: usize = 10;

/// The single place that decides how a transaction gets categorized: rules
/// first (this covers both a learned exact-merchant rule and a generic
/// keyword rule — see `RuleSet`), then the classifier once it has enough
/// labeled history to be trustworthy, otherwise `None` (Uncategorized)
/// rather than guessing. The returned `CategorySource` records which path
/// produced the answer, for display and for later corrections. The
/// confidence is only ever populated for a classifier guess — a rule match
/// is a deterministic decision, not a probability.
pub fn categorize(description: &str, rules: &RuleSet, classifier: Option<&Classifier>) -> Option<(String, CategorySource, Option<f64>)> {
    if let Some(category) = rules.categorize(description) {
        return Some((category, CategorySource::Rule, None));
    }

    let classifier = classifier?;
    if classifier.training_example_count() < MIN_TRAINING_EXAMPLES_FOR_CLASSIFIER {
        return None;
    }

    classifier
        .predict_with_confidence(description)
        .map(|(category, confidence)| (category, CategorySource::Classifier, Some(confidence)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::classifier::Classifier;
    use crate::rules::{Rule, RuleSet};
    use crate::store::CategorySource;

    fn well_trained_classifier() -> Classifier {
        // enough examples across two categories to clear the confidence bar
        let examples: Vec<(&str, &str)> = vec![
            ("Green Leaf Grocers", "Groceries"),
            ("Fresh Market Grocery", "Groceries"),
            ("Downtown Farmers Market", "Groceries"),
            ("Corner Grocery Stop", "Groceries"),
            ("Riverside Grocery Co", "Groceries"),
            ("Ferrywood Coffee Shop", "Dining Out"),
            ("Downtown Cafe", "Dining Out"),
            ("Riverside Bistro", "Dining Out"),
            ("Harbor Diner", "Dining Out"),
            ("Uptown Eatery", "Dining Out"),
        ];
        Classifier::train(&examples)
    }

    #[test]
    fn a_rule_match_wins_even_if_the_classifier_disagrees() {
        let rules = RuleSet::new(vec![Rule::new("ferrywood coffee", "Business Expense")]);
        let classifier = well_trained_classifier(); // would predict "Dining Out" for coffee shops

        let result = categorize("Ferrywood Coffee Shop", &rules, Some(&classifier));

        assert_eq!(result, Some(("Business Expense".to_string(), CategorySource::Rule, None)));
    }

    #[test]
    fn falls_back_to_the_classifier_once_it_has_enough_labeled_history() {
        let rules = RuleSet::new(vec![]); // no rule matches anything
        let classifier = well_trained_classifier();

        let (category, source, confidence) = categorize("Sunny Grocery Store", &rules, Some(&classifier)).unwrap();

        assert_eq!(category, "Groceries");
        assert_eq!(source, CategorySource::Classifier);
        let confidence = confidence.expect("a classifier guess must carry a confidence");
        assert!(confidence > 0.0 && confidence <= 1.0);
    }

    #[test]
    fn does_not_trust_a_classifier_trained_on_too_little_data() {
        let rules = RuleSet::new(vec![]);
        // just 2 examples — nowhere near enough to trust a guess from
        let classifier = Classifier::train(&[("Green Leaf Grocers", "Groceries"), ("Ferrywood Coffee Shop", "Dining Out")]);

        let result = categorize("Sunny Grocery Store", &rules, Some(&classifier));

        assert_eq!(result, None);
    }

    #[test]
    fn no_rules_and_no_classifier_leaves_it_uncategorized() {
        let rules = RuleSet::new(vec![]);
        let result = categorize("Anything At All", &rules, None);
        assert_eq!(result, None);
    }
}
