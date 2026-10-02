/// A keyword/merchant rule: if `pattern` appears anywhere in a transaction's description, it
/// categorizes as `category`. Both sides are compared as merchant names (`merchant_key`): case,
/// digits, punctuation and a leading card-processor prefix are ignored, so a rule learned from
/// "SPEEDWAY 44289" also matches "SPEEDWAY 44290". The pattern is stored exactly as written.
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

    /// Whether this rule matches `description`. The one definition of a match: the categorizer, the
    /// contested-history check, the rules manager's counts and its "would change" preview all use it.
    pub fn matches(&self, description: &str) -> bool {
        let key = merchant_key(&self.pattern);
        if key.is_empty() {
            // A pattern with no letters (e.g. "7-11") has no merchant name to compare, so it is matched
            // as written rather than becoming an empty key that would match every description.
            let pattern = self.pattern.trim().to_lowercase();
            return !pattern.is_empty() && description.to_lowercase().contains(&pattern);
        }
        merchant_key(description).contains(&key)
    }

    /// How specific the rule is, for "most specific rule wins": the length of its merchant name, so a
    /// store number in a learned pattern neither helps nor hurts it.
    fn specificity(&self) -> usize {
        let key = merchant_key(&self.pattern);
        if key.is_empty() { self.pattern.trim().len() } else { key.len() }
    }
}

/// Card processors that put their own prefix before the merchant's name ("SQ *BLUE BOTTLE",
/// "TST* BLUE BOTTLE").
const PROCESSOR_PREFIXES: [&str; 5] = ["paypal", "tst", "sq", "sp", "pp"];

/// A description reduced to its merchant name for matching: lowercased, a leading card-processor
/// prefix removed, and everything but letters turned into single spaces. "SQ *Blue-Bottle #12" and
/// "BLUE BOTTLE 7" both become "blue bottle".
pub fn merchant_key(text: &str) -> String {
    let lower = text.to_lowercase();
    let mut rest = lower.trim_start();
    for prefix in PROCESSOR_PREFIXES {
        if let Some(after) = rest.strip_prefix(prefix)
            && let Some(merchant) = after.trim_start().strip_prefix('*')
        {
            rest = merchant;
            break;
        }
    }
    rest.chars()
        .map(|c| if c.is_alphabetic() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
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
        self.best_match(description).map(|rule| rule.category.clone())
    }

    /// The rule that would categorize `description` — the same
    /// longest-pattern-wins pick `categorize` makes, but returning the rule
    /// itself so a caller can tell *which* rule owns a description (the
    /// rules manager needs that to avoid a broad new rule stealing
    /// transactions that a more specific one already claims).
    pub fn best_match(&self, description: &str) -> Option<&Rule> {
        self.rules
            .iter()
            .filter(|rule| rule.matches(description))
            .max_by_key(|rule| rule.specificity())
    }

    pub fn rules(&self) -> &[Rule] {
        &self.rules
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

    // ---- matching ignores store numbers, punctuation and card-processor prefixes ----

    #[test]
    fn a_rule_learned_from_one_store_number_matches_another() {
        // Learned rules are the full description, so the old store number used to block every other store.
        let rules = RuleSet::new(vec![Rule::new("SPEEDWAY 44289", "Gas")]);
        assert_eq!(rules.categorize("SPEEDWAY 44290"), Some("Gas".to_string()));
        assert_eq!(rules.categorize("SPEEDWAY #512 GRAND RAPIDS"), Some("Gas".to_string()));
    }

    #[test]
    fn punctuation_and_spacing_do_not_matter() {
        let rules = RuleSet::new(vec![Rule::new("WAL-MART #123", "Groceries")]);
        assert_eq!(rules.categorize("WAL MART SUPERCENTER"), Some("Groceries".to_string()));
    }

    #[test]
    fn a_card_processor_prefix_does_not_hide_the_merchant() {
        let rules = RuleSet::new(vec![Rule::new("SQ *BLUE BOTTLE", "Dining Out")]);
        assert_eq!(rules.categorize("TST* BLUE BOTTLE CAFE"), Some("Dining Out".to_string()));
        assert_eq!(rules.categorize("Blue Bottle"), Some("Dining Out".to_string()));
    }

    #[test]
    fn a_keyword_still_matches_inside_a_longer_word() {
        // The built-in rules rely on it: "grocer" must keep matching "Grocery".
        let rules = RuleSet::new(vec![Rule::new("grocer", "Groceries")]);
        assert_eq!(rules.categorize("Fresh Grocery Outlet"), Some("Groceries".to_string()));
    }

    #[test]
    fn a_pattern_with_no_letters_matches_as_written() {
        let rules = RuleSet::new(vec![Rule::new("7-11", "Snacks")]);
        assert_eq!(rules.categorize("7-11 STORE 22"), Some("Snacks".to_string()));
        assert_eq!(rules.categorize("Corner Store"), None, "a letterless pattern must never match everything");
    }

    #[test]
    fn the_most_specific_merchant_wins_regardless_of_its_store_number() {
        let rules = RuleSet::new(vec![
            Rule::new("coffee", "Dining Out"),
            Rule::new("FERRYWOOD COFFEE 12", "Business Expense"),
        ]);
        assert_eq!(rules.categorize("FERRYWOOD COFFEE 99"), Some("Business Expense".to_string()));
    }

    #[test]
    fn a_rule_and_a_description_match_through_one_shared_function() {
        let rule = Rule::new("SPEEDWAY 44289", "Gas");
        assert!(rule.matches("speedway 1"));
        assert!(!rule.matches("shell 1"));
    }
}
