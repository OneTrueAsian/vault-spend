//! Acceptance test for requirement 5: after the user corrects a batch of
//! transactions once, a later batch needs strictly less manual help —
//! repeat merchants become automatic via a learned exact-merchant rule, and
//! brand-new-but-similar merchants become automatic via the classifier once
//! there's enough labeled history.

use budget_core::categorizer::{self, MIN_TRAINING_EXAMPLES_FOR_CLASSIFIER};
use budget_core::classifier::Classifier;
use budget_core::csv_loader;
use budget_core::learner;
use budget_core::models::AccountType;
use budget_core::rules::RuleSet;
use budget_core::store::{CategorySource, Store};
use std::collections::HashMap;

fn write_temp_csv(name: &str, contents: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("meadow-learning-loop-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    std::fs::write(&path, contents).unwrap();
    path
}

#[test]
fn categorization_gets_more_efficient_after_learning_from_corrections() {
    let store = Store::open_in_memory().unwrap();
    let account = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    let mut rules = RuleSet::seeded();

    // ---- Month 1: a fresh import, no learned history yet ----
    let month1_path = write_temp_csv(
        "month1.csv",
        "date,description,amount\n\
         2026-08-01,Union Realty Rent,-1850.00\n\
         2026-08-02,Green Leaf Grocers,-86.42\n\
         2026-08-03,Downtown Farmers Market,-54.30\n\
         2026-08-04,Ferrywood Coffee Shop,-6.75\n\
         2026-08-05,Downtown Cafe,-12.40\n\
         2026-08-06,Riverside Bistro Nights,-42.10\n\
         2026-08-07,Thread & Co Apparel,-64.20\n\
         2026-08-08,Harbor Cinema,-32.50\n\
         2026-08-09,Payroll Deposit,3120.00\n\
         2026-08-10,Northline Electric Co,-96.10\n",
    );
    let month1 = csv_loader::load_csv(&month1_path, false).unwrap();
    assert!(month1.errors.is_empty());
    store.save_transactions(account, &month1.transactions).unwrap();

    // Categorize month 1 with rules only (seed rules — nothing learned yet).
    let mut month1_manual_needed = 0usize;
    let mut labeled_history: Vec<(String, String)> = Vec::new();

    for stored in store.all_transactions().unwrap() {
        let description = stored.transaction.description.clone();
        match categorizer::categorize(&description, &rules, None) {
            Some((category, source, confidence)) => {
                store.set_category(stored.id, &category, source, confidence).unwrap();
                labeled_history.push((description, category));
            }
            None => {
                month1_manual_needed += 1;
                // the user fixes it by hand — that correction teaches the rule engine
                let corrected_category = match description.as_str() {
                    "Riverside Bistro Nights" => "Dining Out",
                    "Thread & Co Apparel" => "Shopping",
                    other => panic!("unexpected uncategorized transaction: {other}"),
                };
                learner::learn_from_correction(&mut rules, &description, corrected_category);
                store.set_category(stored.id, corrected_category, CategorySource::User, None).unwrap();
                labeled_history.push((description, corrected_category.to_string()));
            }
        }
    }

    assert_eq!(
        month1_manual_needed, 2,
        "expected exactly the two unseeded merchants to need manual fixing"
    );
    assert_eq!(labeled_history.len(), 10);
    assert!(labeled_history.len() >= MIN_TRAINING_EXAMPLES_FOR_CLASSIFIER);

    // Train the classifier from everything labeled so far (auto + corrected).
    let training_examples: Vec<(&str, &str)> = labeled_history.iter().map(|(d, c)| (d.as_str(), c.as_str())).collect();
    let classifier = Classifier::train(&training_examples);

    // ---- Month 2: repeat merchants + one brand-new-but-similar merchant ----
    let month2_path = write_temp_csv(
        "month2.csv",
        "date,description,amount\n\
         2026-09-01,Union Realty Rent,-1850.00\n\
         2026-09-04,Riverside Bistro Nights,-45.00\n\
         2026-09-07,Thread & Co Apparel,-38.90\n\
         2026-09-08,Harbor Cinema,-30.00\n\
         2026-09-10,Farmers Produce Stand,-21.15\n",
    );
    let month2 = csv_loader::load_csv(&month2_path, false).unwrap();
    assert!(month2.errors.is_empty());
    store.save_transactions(account, &month2.transactions).unwrap();

    let mut month2_manual_needed = 0usize;
    let mut month2_results: HashMap<String, (String, CategorySource)> = HashMap::new();

    for stored in store.all_transactions().unwrap() {
        if stored.transaction.category.is_some() {
            continue; // already handled above, from month 1
        }
        let description = stored.transaction.description.clone();
        match categorizer::categorize(&description, &rules, Some(&classifier)) {
            Some((category, source, confidence)) => {
                store.set_category(stored.id, &category, source, confidence).unwrap();
                month2_results.insert(description, (category, source));
            }
            None => month2_manual_needed += 1,
        }
    }

    // The whole point: strictly less manual work the second time around.
    assert!(
        month2_manual_needed < month1_manual_needed,
        "expected month 2 ({month2_manual_needed} manual) to need less manual help than month 1 ({month1_manual_needed})"
    );
    assert_eq!(month2_manual_needed, 0);

    // Repeat merchants hit the rule learned from last month's correction.
    assert_eq!(
        month2_results.get("Riverside Bistro Nights"),
        Some(&("Dining Out".to_string(), CategorySource::Rule))
    );
    assert_eq!(
        month2_results.get("Thread & Co Apparel"),
        Some(&("Shopping".to_string(), CategorySource::Rule))
    );

    // Seed rules still work, unaffected by everything learned.
    assert_eq!(month2_results.get("Union Realty Rent"), Some(&("Rent".to_string(), CategorySource::Rule)));
    assert_eq!(
        month2_results.get("Harbor Cinema"),
        Some(&("Entertainment".to_string(), CategorySource::Rule))
    );

    // A brand-new merchant, never seen exactly before and not matching any
    // keyword rule, is still caught — this time by the classifier, based on
    // word overlap with last month's Groceries corrections.
    assert_eq!(
        month2_results.get("Farmers Produce Stand"),
        Some(&("Groceries".to_string(), CategorySource::Classifier))
    );
}
