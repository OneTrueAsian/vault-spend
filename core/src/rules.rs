/// A keyword/merchant rule: if `pattern` appears (case-insensitively)
/// anywhere in a transaction's description, it categorizes as `category`.
#[derive(Debug, Clone, PartialEq)]
pub struct Rule {
    pub pattern: String,
    pub category: String,
}

impl Rule {
    pub fn new(pattern: impl Into<String>, category: impl Into<String>) -> Self {
        Rule {
            pattern: pattern.into(),
            category: category.into(),
        }
    }
}

/// An ordered collection of rules. When more than one rule matches the same
/// description, the rule with the longest (most specific) pattern wins.
#[derive(Debug, Clone)]
pub struct RuleSet {
    rules: Vec<Rule>,
}

impl RuleSet {
    pub fn new(rules: Vec<Rule>) -> Self {
        RuleSet { rules }
    }

    pub fn categorize(&self, description: &str) -> Option<String> {
        let description = description.to_lowercase();
        self.rules
            .iter()
            .filter(|rule| description.contains(&rule.pattern.to_lowercase()))
            .max_by_key(|rule| rule.pattern.len())
            .map(|rule| rule.category.clone())
    }

    pub fn len(&self) -> usize {
        self.rules.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    /// Adds a rule for `pattern`, or updates its category if a rule with
    /// that exact pattern (case-insensitive) already exists.
    pub fn upsert(&mut self, pattern: impl Into<String>, category: impl Into<String>) {
        let pattern = pattern.into();
        let category = category.into();
        match self.rules.iter_mut().find(|rule| rule.pattern.eq_ignore_ascii_case(&pattern)) {
            Some(existing) => existing.category = category,
            None => self.rules.push(Rule::new(pattern, category)),
        }
    }

    /// A modest starter set of merchant/keyword rules covering common
    /// budget categories, so a fresh install isn't starting from nothing.
    pub fn seeded() -> Self {
        RuleSet::new(vec![
            Rule::new("rent", "Rent"),
            Rule::new("grocer", "Groceries"),
            Rule::new("market", "Groceries"),
            Rule::new("coffee", "Dining Out"),
            Rule::new("cafe", "Dining Out"),
            Rule::new("restaurant", "Dining Out"),
            Rule::new("electric", "Utilities"),
            Rule::new("water utility", "Utilities"),
            Rule::new("gas station", "Transportation"),
            Rule::new("transit", "Transportation"),
            Rule::new("cinema", "Entertainment"),
            Rule::new("movie", "Entertainment"),
            Rule::new("payroll", "Income"),
            Rule::new("interest payment", "Income"),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_a_known_merchant_keyword() {
        let rules = RuleSet::new(vec![Rule::new("starbucks", "Dining Out")]);
        assert_eq!(rules.categorize("STARBUCKS #1234 SEATTLE"), Some("Dining Out".to_string()));
    }

    #[test]
    fn matching_is_case_insensitive_on_both_sides() {
        let rules = RuleSet::new(vec![Rule::new("SHELL", "Transportation")]);
        assert_eq!(rules.categorize("shell gas station #42"), Some("Transportation".to_string()));
    }

    #[test]
    fn unmatched_description_returns_none() {
        let rules = RuleSet::new(vec![Rule::new("starbucks", "Dining Out")]);
        assert_eq!(rules.categorize("Union Realty rent payment"), None);
    }

    #[test]
    fn longest_matching_pattern_wins_on_conflict() {
        // "payment" alone would match too, but the more specific rule should win.
        let rules = RuleSet::new(vec![Rule::new("payment", "Fee"), Rule::new("card payment", "Transfer")]);
        assert_eq!(rules.categorize("Card Payment Received"), Some("Transfer".to_string()));
    }

    #[test]
    fn seed_rules_cover_a_few_common_categories() {
        let rules = RuleSet::seeded();
        assert_eq!(rules.categorize("Green Leaf Grocers"), Some("Groceries".to_string()));
        assert_eq!(rules.categorize("Ferrywood Coffee"), Some("Dining Out".to_string()));
        assert_eq!(rules.categorize("Union Realty (Rent)"), Some("Rent".to_string()));
    }
}
