use std::collections::{BTreeMap, HashSet};

/// A Naive Bayes text classifier over word frequencies (the standard
/// pairing for Naive Bayes — TF-IDF weighting is normally paired with
/// other classifiers, not this one), trained fresh from a batch of
/// (description, category) history each time. Personal transaction
/// history is small enough that retraining from scratch is cheap, so
/// there's no need for incremental updates.
pub struct Classifier {
    // category -> word -> count in that category's training descriptions
    word_counts: BTreeMap<String, BTreeMap<String, u32>>,
    // category -> total word occurrences across its training descriptions
    category_word_totals: BTreeMap<String, u32>,
    // category -> number of training examples labeled with it
    category_doc_counts: BTreeMap<String, u32>,
    vocabulary: HashSet<String>,
    total_docs: u32,
}

impl Classifier {
    pub fn train(examples: &[(&str, &str)]) -> Self {
        let mut word_counts: BTreeMap<String, BTreeMap<String, u32>> = BTreeMap::new();
        let mut category_word_totals: BTreeMap<String, u32> = BTreeMap::new();
        let mut category_doc_counts: BTreeMap<String, u32> = BTreeMap::new();
        let mut vocabulary: HashSet<String> = HashSet::new();

        for (description, category) in examples {
            *category_doc_counts.entry((*category).to_string()).or_insert(0) += 1;
            let counts = word_counts.entry((*category).to_string()).or_default();
            for token in tokenize(description) {
                vocabulary.insert(token.clone());
                *counts.entry(token).or_insert(0) += 1;
                *category_word_totals.entry((*category).to_string()).or_insert(0) += 1;
            }
        }

        Classifier {
            word_counts,
            category_word_totals,
            category_doc_counts,
            vocabulary,
            total_docs: examples.len() as u32,
        }
    }

    /// How many labeled examples this classifier was trained on — callers
    /// use this to decide whether there's enough history to trust a
    /// prediction at all (see `categorizer::MIN_TRAINING_EXAMPLES_FOR_CLASSIFIER`).
    pub fn training_example_count(&self) -> usize {
        self.total_docs as usize
    }

    /// Picks the category with the highest posterior probability, or `None`
    /// if this classifier has no training data at all.
    pub fn predict(&self, description: &str) -> Option<String> {
        self.category_log_scores(description)
            .into_iter()
            .max_by(|(_, a), (_, b)| a.total_cmp(b))
            .map(|(category, _)| category)
    }

    /// Same winning category as `predict`, plus a genuine posterior
    /// probability (0.0–1.0) for it — the raw log-scores `predict` compares
    /// aren't probabilities on their own (they don't sum to 1 across
    /// categories), so this normalizes them with softmax first.
    pub fn predict_with_confidence(&self, description: &str) -> Option<(String, f64)> {
        let scores = self.category_log_scores(description);
        let (winner, winner_score) = scores.iter().max_by(|(_, a), (_, b)| a.total_cmp(b)).map(|(c, s)| (c.clone(), *s))?;

        // softmax, shifted by the max score for numerical stability — the
        // shift cancels out in the ratio, so the result is unaffected.
        let max_score = winner_score;
        let sum_exp: f64 = scores.iter().map(|(_, s)| (s - max_score).exp()).sum();
        let confidence = (winner_score - max_score).exp() / sum_exp;

        Some((winner, confidence))
    }

    /// Every trained category's log posterior score for `description` (not
    /// yet normalized into a probability — see `predict_with_confidence`).
    /// Empty if this classifier has no training data at all.
    fn category_log_scores(&self, description: &str) -> Vec<(String, f64)> {
        if self.total_docs == 0 {
            return Vec::new();
        }

        let tokens = tokenize(description);
        let vocab_size = self.vocabulary.len() as f64;
        let empty_counts = BTreeMap::new();

        let mut scores = Vec::with_capacity(self.category_doc_counts.len());
        for (category, &doc_count) in &self.category_doc_counts {
            let mut score = (doc_count as f64 / self.total_docs as f64).ln();

            let counts = self.word_counts.get(category).unwrap_or(&empty_counts);
            let category_total = *self.category_word_totals.get(category).unwrap_or(&0) as f64;

            for token in &tokens {
                // a word never seen in training carries no signal either way
                if !self.vocabulary.contains(token) {
                    continue;
                }
                let word_count = *counts.get(token).unwrap_or(&0) as f64;
                let probability = (word_count + 1.0) / (category_total + vocab_size);
                score += probability.ln();
            }

            scores.push((category.clone(), score));
        }
        scores
    }
}

/// Lowercases and splits on non-alphanumeric characters, dropping purely
/// numeric tokens (store numbers, dates) so "STARBUCKS #1001" and
/// "starbucks #2002" share the signal that matters: `starbucks`.
fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty() && !token.chars().all(|c| c.is_ascii_digit()))
        .map(|token| token.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn training_set() -> Vec<(&'static str, &'static str)> {
        vec![
            ("Green Leaf Grocers", "Groceries"),
            ("Fresh Market Grocery", "Groceries"),
            ("Downtown Farmers Market", "Groceries"),
            ("Ferrywood Coffee Shop", "Dining Out"),
            ("Downtown Cafe", "Dining Out"),
            ("Riverside Bistro", "Dining Out"),
        ]
    }

    #[test]
    fn predicts_a_category_for_a_description_never_seen_before() {
        let classifier = Classifier::train(&training_set());

        assert_eq!(classifier.predict("Sunny Grocery Store"), Some("Groceries".to_string()));
        assert_eq!(classifier.predict("Corner Coffee House"), Some("Dining Out".to_string()));
    }

    #[test]
    fn ignores_store_numbers_so_repeat_merchants_still_match() {
        let mut examples = training_set();
        examples.push(("STARBUCKS #1001", "Dining Out"));
        let classifier = Classifier::train(&examples);

        assert_eq!(classifier.predict("starbucks #2002"), Some("Dining Out".to_string()));
    }

    #[test]
    fn falls_back_to_the_more_common_category_when_no_words_overlap() {
        // 3 Groceries examples vs 1 Dining Out example, and a query with
        // words in neither vocabulary — only the prior can decide.
        let examples = vec![
            ("Green Leaf Grocers", "Groceries"),
            ("Fresh Market Grocery", "Groceries"),
            ("Downtown Farmers Market", "Groceries"),
            ("Ferrywood Coffee Shop", "Dining Out"),
        ];
        let classifier = Classifier::train(&examples);

        assert_eq!(classifier.predict("Xyzzy Quux Foobar"), Some("Groceries".to_string()));
    }

    #[test]
    fn untrained_classifier_predicts_nothing_and_has_no_confidence() {
        let classifier = Classifier::train(&[]);
        assert_eq!(classifier.predict("anything at all"), None);
        assert_eq!(classifier.predict_with_confidence("anything at all"), None);
    }

    #[test]
    fn predict_with_confidence_agrees_with_predict_on_the_winning_category() {
        let classifier = Classifier::train(&training_set());

        let (category, confidence) = classifier.predict_with_confidence("Sunny Grocery Store").unwrap();

        assert_eq!(category, "Groceries");
        assert_eq!(classifier.predict("Sunny Grocery Store"), Some(category));
        assert!(
            confidence > 0.0 && confidence <= 1.0,
            "confidence must be a real probability, got {confidence}"
        );
    }

    #[test]
    fn predict_with_confidence_is_higher_for_a_clearer_match() {
        let classifier = Classifier::train(&training_set());

        // "Grocery" and "Market" both appear heavily in the Groceries
        // training set with no Dining Out overlap — a clean match.
        let (_, clear_confidence) = classifier.predict_with_confidence("Sunny Grocery Market").unwrap();
        // A word salad with no vocabulary overlap at all is won only by
        // the category prior — the weakest possible win.
        let (_, ambiguous_confidence) = classifier.predict_with_confidence("Xyzzy Quux Foobar").unwrap();

        assert!(
            clear_confidence > ambiguous_confidence,
            "a description with unambiguous keyword overlap should be more confident \
             ({clear_confidence}) than one decided purely by the category prior ({ambiguous_confidence})"
        );
    }
}
