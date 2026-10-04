//! Deciding each imported row's category on the review screen, before anything is saved.

use crate::categorizer;
use crate::classifier::Classifier;
use crate::csv_loader::LoadResult;
use crate::models::Transaction;
use crate::rules::RuleSet;
use crate::store::{CategorySource, ImportCategoryChoice, Store, import_category_key};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// A guess (a rule or the auto-categorizer) less sure than this is not applied on import: the
/// row waits on the review screen for the person to choose. The review list's own "Unsure" mark
/// (`LOW_CONFIDENCE` = 0.7 in `src/importInbox.ts`) is a separate, later check: a guess from 0.5
/// up to 0.7 is saved, and still marked "Unsure" there for a second look.
pub const IMPORT_CHOICE_BELOW: f64 = 0.5;

/// What the rules or the auto-categorizer would file a row under, always one of the person's
/// categories in their spelling.
#[derive(Debug, Clone, PartialEq)]
pub struct Suggestion {
    pub category: String,
    pub source: CategorySource,
    pub confidence: Option<f64>,
}

/// What the review screen needs to know about one row to decide its category.
#[derive(Debug, Clone, PartialEq)]
pub struct RowFacts {
    /// The person's category the file's own category matches (any casing), in their spelling.
    pub matched_category: Option<String>,
    /// The file's own category name, trimmed; `None` when the file has none for this row.
    pub file_category: Option<String>,
    /// The rules' or auto-categorizer's answer, for every row without a `matched_category`.
    pub suggestion: Option<Suggestion>,
}

/// How a row is filed without asking the person.
#[derive(Debug, Clone, PartialEq)]
pub enum Automatic {
    /// The file's own category, or the person's panel choice for it (map to one of theirs, or add it).
    File(String),
    /// A rule or auto-categorizer answer sure enough to use.
    Guess(Suggestion),
}

#[derive(Debug, Clone, PartialEq)]
pub enum ImportResolutionError {
    /// Two choices were sent for one file category under different casing.
    ConflictingChoices(String),
}

impl std::fmt::Display for ImportResolutionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImportResolutionError::ConflictingChoices(name) => {
                write!(
                    f,
                    "Two different choices were made for the file category \"{name}\". Review the import again."
                )
            }
        }
    }
}

impl std::error::Error for ImportResolutionError {}

/// Whether a suggestion is sure enough to file a row without asking. A rule with no confidence is a
/// plain match and is sure; anything else must carry a real probability of at least
/// `IMPORT_CHOICE_BELOW`.
pub fn is_sure(suggestion: &Suggestion) -> bool {
    match suggestion.confidence {
        None => suggestion.source == CategorySource::Rule,
        Some(c) => c.is_finite() && (IMPORT_CHOICE_BELOW..=1.0).contains(&c),
    }
}

/// The panel's choice for each file category, keyed by `import_category_key`: what the review
/// screen sent, and for a name it did not send, the remembered mapping. Two sent choices for one
/// name under different casing are refused rather than one silently winning.
pub fn effective_panel_choices(
    sent: &HashMap<String, ImportCategoryChoice>,
    remembered: &HashMap<String, String>,
) -> Result<HashMap<String, ImportCategoryChoice>, ImportResolutionError> {
    let mut choices: HashMap<String, ImportCategoryChoice> = remembered
        .iter()
        .map(|(k, v)| (k.clone(), ImportCategoryChoice::MapTo(v.clone())))
        .collect();
    let mut seen: HashMap<String, &ImportCategoryChoice> = HashMap::new();
    for (name, choice) in sent {
        let key = import_category_key(name);
        if let Some(earlier) = seen.insert(key.clone(), choice)
            && earlier != choice
        {
            return Err(ImportResolutionError::ConflictingChoices(name.trim().to_string()));
        }
        choices.insert(key, choice.clone());
    }
    Ok(choices)
}

/// How a row is filed without asking, or `None` when the person has to choose: the file's own
/// category when it matches one of theirs; else the panel's choice for that name (map or add);
/// else a sure rule or auto-categorizer answer. `panel` is keyed by `import_category_key`.
pub fn automatic(facts: &RowFacts, panel: &HashMap<String, ImportCategoryChoice>) -> Option<Automatic> {
    if let Some(matched) = &facts.matched_category {
        return Some(Automatic::File(matched.clone()));
    }
    if let Some(name) = &facts.file_category {
        match panel.get(&import_category_key(name)) {
            Some(ImportCategoryChoice::MapTo(target)) => return Some(Automatic::File(target.trim().to_string())),
            Some(ImportCategoryChoice::Create) => return Some(Automatic::File(name.trim().to_string())),
            Some(ImportCategoryChoice::Skip) | None => {}
        }
    }
    facts.suggestion.as_ref().filter(|s| is_sure(s)).cloned().map(Automatic::Guess)
}

/// The facts for every row, in file order. Every row without a matching file category gets the
/// rules' and auto-categorizer's answer (as `categorize_uncategorized` would give it), even one
/// whose file category is remembered, so the screen can switch to "Let the app guess" without
/// asking again. An answer naming a category the person doesn't have is dropped. A pure read.
pub fn row_facts(
    store: &Store,
    txns: &[Transaction],
    rules: &RuleSet,
    history: &[(String, String)],
    classifier: Option<&Classifier>,
) -> rusqlite::Result<Vec<RowFacts>> {
    let mut out = Vec::with_capacity(txns.len());
    for tx in txns {
        let file_category = tx.category.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string);
        let matched_category = match &file_category {
            Some(name) => store.find_category(name)?,
            None => None,
        };
        let suggestion = if matched_category.is_some() {
            None
        } else {
            match categorizer::categorize(&tx.description, rules, history, classifier) {
                Some((category, source, confidence)) => store.find_category(&category)?.map(|category| Suggestion {
                    category,
                    source,
                    confidence,
                }),
                None => None,
            }
        };
        out.push(RowFacts {
            matched_category,
            file_category,
            suggestion,
        });
    }
    Ok(out)
}

/// A fingerprint of a parsed import file: every row's date, description, amount, category,
/// account, tags and notes, in order, plus the count of rows that could not be read. Row choices
/// are sent back by row number, so the import is refused when the file changed after review.
pub fn review_token(loaded: &LoadResult) -> String {
    const NONE: &str = "\u{0}none";
    let mut hasher = Sha256::new();
    let mut field = |bytes: &[u8]| {
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(bytes);
    };
    field(loaded.errors.len().to_string().as_bytes());
    field(loaded.transactions.len().to_string().as_bytes());
    for (i, tx) in loaded.transactions.iter().enumerate() {
        field(tx.date.to_string().as_bytes());
        field(tx.description.as_bytes());
        field(tx.amount.to_string().as_bytes());
        field(tx.category.as_deref().unwrap_or(NONE).as_bytes());
        field(loaded.account_names.get(i).and_then(|o| o.as_deref()).unwrap_or(NONE).as_bytes());
        let tags = loaded.tags.get(i).map(Vec::as_slice).unwrap_or(&[]);
        field(tags.len().to_string().as_bytes());
        for tag in tags {
            field(tag.as_bytes());
        }
        field(loaded.notes.get(i).and_then(|o| o.as_deref()).unwrap_or(NONE).as_bytes());
    }
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::categorizer::CONTESTED_RULE_MAX_CONFIDENCE;
    use crate::csv_loader::LoadResult;
    use crate::models::Transaction;
    use crate::rules::{Rule, RuleSet};
    use crate::store::{CategorySource, ImportCategoryChoice, Store};
    use chrono::NaiveDate;
    use rust_decimal::Decimal;
    use std::collections::HashMap;
    use std::str::FromStr;

    fn tx(description: &str, category: Option<&str>) -> Transaction {
        Transaction {
            date: NaiveDate::from_ymd_opt(2026, 1, 5).unwrap(),
            description: description.to_string(),
            amount: Decimal::from_str("-12.34").unwrap(),
            category: category.map(str::to_string),
        }
    }

    fn sure(category: &str, source: CategorySource, confidence: Option<f64>) -> Suggestion {
        Suggestion {
            category: category.to_string(),
            source,
            confidence,
        }
    }

    fn facts(matched: Option<&str>, file: Option<&str>, suggestion: Option<Suggestion>) -> RowFacts {
        RowFacts {
            matched_category: matched.map(str::to_string),
            file_category: file.map(str::to_string),
            suggestion,
        }
    }

    fn panel(entries: &[(&str, ImportCategoryChoice)]) -> HashMap<String, ImportCategoryChoice> {
        entries.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }

    // ---- the cutoff ----

    #[test]
    fn a_rule_with_no_confidence_is_sure() {
        assert!(is_sure(&sure("Groceries", CategorySource::Rule, None)));
    }

    #[test]
    fn exactly_half_sure_is_used_and_just_under_half_is_not() {
        assert!(is_sure(&sure("Groceries", CategorySource::Classifier, Some(0.5))));
        assert!(!is_sure(&sure("Groceries", CategorySource::Classifier, Some(0.4999))));
        assert!(is_sure(&sure("Groceries", CategorySource::Classifier, Some(0.6999))));
        assert!(is_sure(&sure("Groceries", CategorySource::Classifier, Some(0.7))));
        assert_eq!(IMPORT_CHOICE_BELOW, 0.5);
    }

    #[test]
    fn a_contested_rule_below_half_is_not_sure() {
        assert!(!is_sure(&sure("Groceries", CategorySource::Rule, Some(0.3))));
        assert!(is_sure(&sure("Groceries", CategorySource::Rule, Some(CONTESTED_RULE_MAX_CONFIDENCE))));
    }

    #[test]
    fn a_guess_with_no_or_a_broken_confidence_is_never_sure() {
        assert!(!is_sure(&sure("Groceries", CategorySource::Classifier, None)));
        assert!(!is_sure(&sure("Groceries", CategorySource::Classifier, Some(f64::NAN))));
        assert!(!is_sure(&sure("Groceries", CategorySource::Classifier, Some(1.5))));
        assert!(!is_sure(&sure("Groceries", CategorySource::Rule, Some(f64::INFINITY))));
    }

    // ---- the order ----

    #[test]
    fn an_exact_file_match_wins_over_memory_and_rules() {
        let f = facts(Some("Groceries"), Some("groceries"), Some(sure("Dining", CategorySource::Rule, None)));
        let p = panel(&[("groceries", ImportCategoryChoice::MapTo("Shopping".into()))]);
        assert_eq!(automatic(&f, &p), Some(Automatic::File("Groceries".into())));
    }

    #[test]
    fn a_panel_map_wins_over_a_rule() {
        let f = facts(None, Some("Merchandise"), Some(sure("Dining", CategorySource::Rule, None)));
        let p = panel(&[("merchandise", ImportCategoryChoice::MapTo("Shopping".into()))]);
        assert_eq!(automatic(&f, &p), Some(Automatic::File("Shopping".into())));
    }

    #[test]
    fn a_panel_create_uses_the_files_own_name() {
        let f = facts(None, Some("Merchandise"), None);
        let p = panel(&[("merchandise", ImportCategoryChoice::Create)]);
        assert_eq!(automatic(&f, &p), Some(Automatic::File("Merchandise".into())));
    }

    #[test]
    fn letting_the_app_guess_uses_a_sure_suggestion() {
        let s = sure("Dining", CategorySource::Classifier, Some(0.8));
        let f = facts(None, Some("Merchandise"), Some(s.clone()));
        let p = panel(&[("merchandise", ImportCategoryChoice::Skip)]);
        assert_eq!(automatic(&f, &p), Some(Automatic::Guess(s)));
    }

    #[test]
    fn letting_the_app_guess_with_an_unsure_or_no_suggestion_needs_a_choice() {
        let p = panel(&[("merchandise", ImportCategoryChoice::Skip)]);
        let unsure = facts(None, Some("Merchandise"), Some(sure("Dining", CategorySource::Classifier, Some(0.2))));
        assert_eq!(automatic(&unsure, &p), None);
        let none = facts(None, Some("Merchandise"), None);
        assert_eq!(automatic(&none, &p), None);
    }

    #[test]
    fn a_row_from_a_file_with_no_category_column_is_guessed_too() {
        let s = sure("Dining", CategorySource::Rule, None);
        assert_eq!(automatic(&facts(None, None, Some(s.clone())), &HashMap::new()), Some(Automatic::Guess(s)));
        assert_eq!(automatic(&facts(None, None, None), &HashMap::new()), None);
    }

    // ---- the panel's effective choices ----

    #[test]
    fn a_remembered_mapping_fills_in_a_name_the_screen_did_not_send() {
        let remembered: HashMap<String, String> = [("merchandise".to_string(), "Shopping".to_string())].into();
        let eff = effective_panel_choices(&HashMap::new(), &remembered).unwrap();
        assert_eq!(eff.get("merchandise"), Some(&ImportCategoryChoice::MapTo("Shopping".into())));
    }

    #[test]
    fn an_explicit_let_the_app_guess_overrides_a_remembered_mapping() {
        let remembered: HashMap<String, String> = [("merchandise".to_string(), "Shopping".to_string())].into();
        let sent = panel(&[("Merchandise", ImportCategoryChoice::Skip)]);
        let eff = effective_panel_choices(&sent, &remembered).unwrap();
        assert_eq!(eff.get("merchandise"), Some(&ImportCategoryChoice::Skip));
    }

    #[test]
    fn two_sent_choices_for_one_name_under_different_casing_are_refused() {
        let sent = panel(&[
            ("Merchandise", ImportCategoryChoice::Skip),
            ("MERCHANDISE ", ImportCategoryChoice::Create),
        ]);
        assert!(matches!(
            effective_panel_choices(&sent, &HashMap::new()),
            Err(ImportResolutionError::ConflictingChoices(_))
        ));
    }

    // ---- facts from a real store ----

    #[test]
    fn row_facts_match_the_persons_category_and_suggest_for_the_rest() {
        let store = Store::open_in_memory().unwrap();
        store.create_category("Groceries", None).unwrap();
        store.create_category("Dining", None).unwrap();
        let rules = RuleSet::new(vec![Rule::new("PIZZA", "dining")]);
        let txns = vec![
            tx("SUNNY MARKET", Some(" groceries ")),
            tx("PIZZA PLACE", Some("Merchandise")),
            tx("PIZZA HUT", None),
            tx("UNKNOWN THING", Some("   ")),
        ];
        let got = row_facts(&store, &txns, &rules, &[], None).unwrap();

        assert_eq!(got[0].matched_category.as_deref(), Some("Groceries"));
        assert!(got[0].suggestion.is_none(), "a matched row needs no guess");

        assert_eq!(got[1].matched_category, None);
        assert_eq!(got[1].file_category.as_deref(), Some("Merchandise"));
        let s = got[1].suggestion.as_ref().unwrap();
        assert_eq!((s.category.as_str(), s.source, s.confidence), ("Dining", CategorySource::Rule, None));

        assert_eq!(got[2].file_category, None);
        assert_eq!(got[2].suggestion.as_ref().unwrap().category, "Dining");

        assert_eq!(got[3].file_category, None, "a whitespace-only name is no name");
        assert!(got[3].suggestion.is_none());
    }

    #[test]
    fn a_suggestion_for_a_category_the_person_does_not_have_is_dropped() {
        let store = Store::open_in_memory().unwrap();
        let rules = RuleSet::new(vec![Rule::new("PIZZA", "Dining")]);
        let got = row_facts(&store, &[tx("PIZZA PLACE", None)], &rules, &[], None).unwrap();
        assert!(got[0].suggestion.is_none());
    }

    // ---- the review token ----

    fn loaded(txns: Vec<Transaction>) -> LoadResult {
        let n = txns.len();
        LoadResult {
            transactions: txns,
            errors: Vec::new(),
            account_names: vec![None; n],
            tags: vec![Vec::new(); n],
            notes: vec![None; n],
        }
    }

    #[test]
    fn the_review_token_is_stable_for_the_same_file() {
        let a = loaded(vec![tx("A", None), tx("B", Some("X"))]);
        assert_eq!(review_token(&a), review_token(&a.clone()));
    }

    #[test]
    fn the_review_token_changes_when_anything_a_row_decision_uses_changes() {
        let base = loaded(vec![tx("A", None), tx("B", Some("X"))]);
        let t = review_token(&base);
        let mut changed = Vec::new();
        let mut c = base.clone();
        c.transactions.swap(0, 1);
        changed.push(c);
        let mut c = base.clone();
        c.transactions[0].description = "A2".into();
        changed.push(c);
        let mut c = base.clone();
        c.transactions[1].category = Some("Y".into());
        changed.push(c);
        let mut c = base.clone();
        c.transactions[0].amount = Decimal::from_str("-12.35").unwrap();
        changed.push(c);
        let mut c = base.clone();
        c.account_names[0] = Some("Checking".into());
        changed.push(c);
        let mut c = base.clone();
        c.tags[1] = vec!["trip".into()];
        changed.push(c);
        let mut c = base.clone();
        c.notes[0] = Some("note".into());
        changed.push(c);
        let mut c = base.clone();
        c.transactions.push(tx("C", None));
        c.account_names.push(None);
        c.tags.push(Vec::new());
        c.notes.push(None);
        changed.push(c);
        for (i, c) in changed.iter().enumerate() {
            assert_ne!(review_token(c), t, "change {i} kept the same token");
        }
    }

    #[test]
    fn the_review_token_does_not_confuse_field_boundaries() {
        let a = loaded(vec![tx("AB", Some("C"))]);
        let b = loaded(vec![tx("A", Some("BC"))]);
        assert_ne!(review_token(&a), review_token(&b));
    }
}
