use crate::classifier::Classifier;
use crate::rules::{Rule, RuleSet};
use crate::store::CategorySource;

/// Below this many labeled examples, the classifier is considered too thin
/// on data to trust — a transaction falls through to `Uncategorized`
/// instead of taking a wild guess from one or two corrections.
pub const MIN_TRAINING_EXAMPLES_FOR_CLASSIFIER: usize = 10;

/// A rule is only called *contested* once the history it matches has at least this many transactions;
/// with less, two different categories are as likely to be an early change of mind as a real split.
pub const MIN_HISTORY_TO_CONTEST_A_RULE: usize = 3;

/// A rule is reliable while at least this share of the history it matches carries the category it
/// would assign. Below it, the merchant has been filed under more than one category often enough that
/// applying the rule silently would be a coin flip the person never sees.
pub const RELIABLE_RULE_AGREEMENT: f64 = 0.9;

/// A contested rule reports at most this confidence, which is just under the review inbox's "Unsure"
/// cutoff (`LOW_CONFIDENCE` in `src/importInbox.ts`), so a contested answer always lands in the inbox
/// instead of being applied silently however high the agreeing share is.
pub const CONTESTED_RULE_MAX_CONFIDENCE: f64 = 0.69;

/// The single place that decides how a transaction gets categorized: rules
/// first (this covers both a learned exact-merchant rule and a generic
/// keyword rule — see `RuleSet`), then the classifier once it has enough
/// labeled history to be trustworthy, otherwise `None` (Uncategorized)
/// rather than guessing. The returned `CategorySource` records which path
/// produced the answer, for display and for later corrections.
///
/// A rule match is a deterministic decision, so it normally carries no confidence. The exception is
/// a rule whose own history disagrees with it (`history` is the labeled history, as
/// `Store::labeled_history` returns it): the same merchant has been filed under several categories, so
/// the answer is returned with the share of matching history that agrees, capped below the inbox's
/// "Unsure" cutoff, and the person is asked to check it. A classifier guess always carries its confidence.
pub fn categorize(
    description: &str,
    rules: &RuleSet,
    history: &[(String, String)],
    classifier: Option<&Classifier>,
) -> Option<(String, CategorySource, Option<f64>)> {
    if let Some(rule) = rules.best_match(description) {
        let confidence = contested_confidence(rule, history);
        return Some((rule.category.clone(), CategorySource::Rule, confidence));
    }

    let classifier = classifier?;
    if classifier.training_example_count() < MIN_TRAINING_EXAMPLES_FOR_CLASSIFIER {
        return None;
    }

    classifier
        .predict_with_confidence(description)
        .map(|(category, confidence)| (category, CategorySource::Classifier, Some(confidence)))
}

/// `Some(confidence)` when the history the rule matches (by `Rule::matches`, exactly as it matches a new
/// transaction) is too split to trust its category; `None` when the rule is reliable or there is too
/// little history to say.
fn contested_confidence(rule: &Rule, history: &[(String, String)]) -> Option<f64> {
    let (mut matching, mut agreeing) = (0usize, 0usize);
    for (description, labeled) in history {
        if rule.matches(description) {
            matching += 1;
            agreeing += usize::from(*labeled == rule.category);
        }
    }
    if matching < MIN_HISTORY_TO_CONTEST_A_RULE {
        return None;
    }
    let share = agreeing as f64 / matching as f64;
    (share < RELIABLE_RULE_AGREEMENT).then_some(share.min(CONTESTED_RULE_MAX_CONFIDENCE))
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

        let result = categorize("Ferrywood Coffee Shop", &rules, &[], Some(&classifier));

        assert_eq!(result, Some(("Business Expense".to_string(), CategorySource::Rule, None)));
    }

    #[test]
    fn falls_back_to_the_classifier_once_it_has_enough_labeled_history() {
        let rules = RuleSet::new(vec![]); // no rule matches anything
        let classifier = well_trained_classifier();

        let (category, source, confidence) = categorize("Sunny Grocery Store", &rules, &[], Some(&classifier)).unwrap();

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

        let result = categorize("Sunny Grocery Store", &rules, &[], Some(&classifier));

        assert_eq!(result, None);
    }

    #[test]
    fn no_rules_and_no_classifier_leaves_it_uncategorized() {
        let rules = RuleSet::new(vec![]);
        let result = categorize("Anything At All", &rules, &[], None);
        assert_eq!(result, None);
    }

    // ---- a rule whose own history disagrees with it is flagged, not applied silently ----

    fn history(entries: &[(&str, &str, usize)]) -> Vec<(String, String)> {
        entries
            .iter()
            .flat_map(|(d, c, n)| std::iter::repeat_n((d.to_string(), c.to_string()), *n))
            .collect()
    }

    fn sams_rule() -> RuleSet {
        RuleSet::new(vec![Rule::new("sams club", "Gas")])
    }

    #[test]
    fn a_rule_whose_merchant_history_all_agrees_is_applied_silently() {
        let past = history(&[("SAMS CLUB #6359", "Gas", 6)]);

        let result = categorize("SAMS CLUB #6359", &sams_rule(), &past, None);

        assert_eq!(result, Some(("Gas".to_string(), CategorySource::Rule, None)));
    }

    #[test]
    fn a_rule_whose_merchant_history_is_split_is_flagged_with_the_share_that_agrees() {
        let past = history(&[("SAMS CLUB #6359", "Gas", 5), ("SAMS CLUB #6359", "Groceries", 5)]);

        let (category, source, confidence) = categorize("SAMS CLUB #6359", &sams_rule(), &past, None).unwrap();

        assert_eq!((category.as_str(), source), ("Gas", CategorySource::Rule));
        let confidence = confidence.expect("a contested rule must say how sure it is");
        assert!((confidence - 0.5).abs() < 1e-9, "5 of 10 agree, got {confidence}");
    }

    #[test]
    fn a_contested_rule_never_reports_a_confidence_the_inbox_would_treat_as_sure() {
        // 8 of 10 agree: contested, but the share (0.8) is above the inbox's 0.7 "Unsure" cutoff.
        let past = history(&[("SAMS CLUB #6359", "Gas", 8), ("SAMS CLUB #6359", "Groceries", 2)]);

        let (_, _, confidence) = categorize("SAMS CLUB #6359", &sams_rule(), &past, None).unwrap();

        assert!(confidence.unwrap() < 0.7, "got {confidence:?}");
    }

    #[test]
    fn nine_in_ten_agreeing_is_reliable_enough_to_stay_silent() {
        let past = history(&[("SAMS CLUB #6359", "Gas", 9), ("SAMS CLUB #6359", "Groceries", 1)]);

        let result = categorize("SAMS CLUB #6359", &sams_rule(), &past, None);

        assert_eq!(result, Some(("Gas".to_string(), CategorySource::Rule, None)));
    }

    #[test]
    fn too_little_history_to_call_a_rule_contested_leaves_it_silent() {
        let past = history(&[("SAMS CLUB #6359", "Gas", 1), ("SAMS CLUB #6359", "Groceries", 1)]);

        let result = categorize("SAMS CLUB #6359", &sams_rule(), &past, None);

        assert_eq!(result, Some(("Gas".to_string(), CategorySource::Rule, None)));
    }

    #[test]
    fn history_the_rule_does_not_match_is_ignored() {
        let past = history(&[("SAMS CLUB #6359", "Gas", 5), ("COSTCO", "Groceries", 20)]);

        let result = categorize("SAMS CLUB #6359", &sams_rule(), &past, None);

        assert_eq!(result, Some(("Gas".to_string(), CategorySource::Rule, None)));
    }

    #[test]
    fn history_is_matched_the_way_the_rule_matches_case_insensitive_substring() {
        let past = history(&[("Sams Club Gas 123", "Gas", 3), ("SAMS CLUB MERCH", "Groceries", 3)]);

        let (_, _, confidence) = categorize("sams club", &sams_rule(), &past, None).unwrap();

        assert!(confidence.is_some(), "mixed history under differently cased descriptions is still mixed");
    }

    #[test]
    fn history_under_other_store_numbers_counts_toward_a_rule_learned_from_one() {
        let rules = RuleSet::new(vec![Rule::new("SAMS CLUB #6359", "Gas")]);
        let past = history(&[("SAMS CLUB #6359", "Gas", 2), ("SAMS CLUB 8812", "Groceries", 3)]);

        let (_, _, confidence) = categorize("SAMS CLUB #6359", &rules, &past, None).unwrap();

        assert!(confidence.is_some(), "the other store's Groceries history makes this merchant contested");
    }

    #[test]
    fn a_contested_rule_still_beats_the_classifier() {
        let past = history(&[("SAMS CLUB #6359", "Gas", 5), ("SAMS CLUB #6359", "Groceries", 5)]);
        let classifier = well_trained_classifier();

        let (_, source, _) = categorize("SAMS CLUB #6359", &sams_rule(), &past, Some(&classifier)).unwrap();

        assert_eq!(source, CategorySource::Rule);
    }
}
