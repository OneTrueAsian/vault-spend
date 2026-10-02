//! Categorization rules: saving, previewing and applying them, and the labeled history the categorizer learns from.

use super::{CategorySource, Store};
use crate::rules::{Rule, RuleSet};
use rusqlite::params;

/// One persisted categorization rule (see `rules::Rule`) plus how many
/// current transactions its pattern matches — what Settings' rules manager
/// lists. `match_count` counts every live transaction whose description
/// contains the pattern, including ones a longer, more specific rule
/// actually wins, so read it as "how much this pattern touches", not "how
/// many transactions it categorized".
#[derive(Debug, Clone, PartialEq)]
pub struct StoredRule {
    pub pattern: String,
    pub category: String,
    pub match_count: usize,
}

/// What saving a rule would do to transactions already on the books — see
/// `Store::preview_rule`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RulePreview {
    /// Live transactions whose description contains the pattern.
    pub matching: usize,
    /// The subset that would actually be re-categorized: never one you
    /// categorized yourself, never a split purchase, never one a more
    /// specific rule owns, and not one already in the target category.
    pub would_change: usize,
}

impl Store {
    /// Persists a learned rule (see `learner::learn_from_correction`) so it
    /// survives past this run. Upserts by pattern, same as `RuleSet::upsert`.
    pub fn upsert_rule(&self, pattern: &str, category: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO rules (pattern, category) VALUES (?1, ?2)
             ON CONFLICT(pattern) DO UPDATE SET category = excluded.category",
            params![pattern, category],
        )?;
        Ok(())
    }

    /// Every rule persisted so far, as a ready-to-use `RuleSet`. Empty on a
    /// fresh store — callers fall back to `RuleSet::seeded()` themselves.
    pub fn load_rules(&self) -> rusqlite::Result<RuleSet> {
        let mut stmt = self.conn.prepare("SELECT pattern, category FROM rules")?;
        let rows = stmt.query_map([], |row| Ok(Rule::new(row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;

        let mut rules = Vec::new();
        for row in rows {
            rules.push(row?);
        }
        Ok(RuleSet::new(rules))
    }

    /// Persists the built-in starter rules (`RuleSet::seeded`) the first
    /// time it's called on a database that has none, then never again.
    ///
    /// The starter set used to live only in memory, as a fallback for an
    /// *empty* rules table — so the moment a user's first correction saved
    /// one learned rule, the starters silently vanished on the next launch.
    /// Persisting them makes every rule visible and deletable in the rules
    /// manager, and the one-time flag (`app_settings.default_rules_seeded`)
    /// is what lets "delete every rule" actually stick instead of
    /// re-seeding an empty table each launch. A database that already has
    /// rules gets the flag set without any defaults added — it's had its
    /// own history with them. Returns whether defaults were inserted.
    pub fn seed_default_rules_once(&self) -> rusqlite::Result<bool> {
        let already_seeded: bool = self
            .conn
            .query_row("SELECT default_rules_seeded FROM app_settings WHERE id = 1", [], |row| row.get(0))
            .unwrap_or(false);
        if already_seeded {
            return Ok(false);
        }

        let has_rules: bool = self.conn.query_row("SELECT EXISTS(SELECT 1 FROM rules)", [], |row| row.get(0))?;
        let mut inserted = false;
        if !has_rules {
            for rule in RuleSet::seeded().rules() {
                self.upsert_rule(&rule.pattern, &rule.category)?;
            }
            inserted = true;
        }
        self.conn.execute(
            "INSERT INTO app_settings (id, default_rules_seeded) VALUES (1, 1)
             ON CONFLICT(id) DO UPDATE SET default_rules_seeded = 1",
            [],
        )?;
        Ok(inserted)
    }

    /// Descriptions of every live transaction, lowercased — what a rule's
    /// pattern is matched against. Excludes `apply_debt_payment`'s generated
    /// transactions, same as `all_transactions`.
    fn live_descriptions_lowercased(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT description FROM transactions
             WHERE deleted_at IS NULL AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?.to_lowercase());
        }
        Ok(result)
    }

    /// Every persisted rule with how many transactions its pattern matches,
    /// grouped by category (then pattern) — the rules manager's list.
    pub fn list_rules(&self) -> rusqlite::Result<Vec<StoredRule>> {
        let rules = self.load_rules()?;
        let descriptions = self.live_descriptions_lowercased()?;
        let mut result: Vec<StoredRule> = rules
            .rules()
            .iter()
            .map(|rule| {
                let match_count = descriptions.iter().filter(|d| rule.matches(d)).count();
                StoredRule {
                    pattern: rule.pattern.clone(),
                    category: rule.category.clone(),
                    match_count,
                }
            })
            .collect();
        result.sort_by(|a, b| {
            a.category
                .to_lowercase()
                .cmp(&b.category.to_lowercase())
                .then_with(|| a.pattern.to_lowercase().cmp(&b.pattern.to_lowercase()))
        });
        Ok(result)
    }

    /// Removes a rule. Never touches a transaction it already categorized —
    /// deleting a rule only stops it applying from now on. An unknown
    /// pattern is a harmless no-op.
    pub fn delete_rule(&self, pattern: &str) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM rules WHERE pattern = ?1", params![pattern])?;
        Ok(())
    }

    /// Edits a rule in place: drops `old_pattern` and saves `new_pattern` →
    /// `category` (which may be the same pattern with a different category,
    /// or a reworded pattern).
    pub fn rename_rule(&self, old_pattern: &str, new_pattern: &str, category: &str) -> rusqlite::Result<()> {
        self.delete_rule(old_pattern)?;
        self.upsert_rule(new_pattern, category)
    }

    /// The transactions saving `pattern` → `category` would re-categorize,
    /// and how many the pattern touches at all. `replacing` names an
    /// existing rule the new one is standing in for (an edit), so a
    /// longer old pattern can't shadow the edited one in the preview.
    ///
    /// A transaction is only changed if the rule would genuinely own it
    /// (longest matching pattern wins, exactly as at import time) and it
    /// isn't one the user categorized by hand, a split purchase, or already
    /// in the target category.
    fn rule_candidates(&self, pattern: &str, category: &str, replacing: Option<&str>) -> rusqlite::Result<(usize, Vec<i64>)> {
        let pattern = pattern.trim();
        if pattern.is_empty() {
            return Ok((0, Vec::new()));
        }

        let mut rules = RuleSet::new(
            self.load_rules()?
                .rules()
                .iter()
                .filter(|r| replacing.is_none_or(|old| !r.pattern.eq_ignore_ascii_case(old)))
                .cloned()
                .collect(),
        );
        rules.upsert(pattern, category);
        let candidate = Rule::new(pattern, category);

        let split_parents: std::collections::HashSet<i64> = {
            let mut stmt = self.conn.prepare("SELECT DISTINCT transaction_id FROM transaction_splits")?;
            let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };

        let mut stmt = self.conn.prepare(
            "SELECT id, description, category, category_source FROM transactions
             WHERE deleted_at IS NULL AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;

        let mut matching = 0;
        let mut ids = Vec::new();
        for row in rows {
            let (id, description, current_category, source) = row?;
            if !candidate.matches(&description) {
                continue;
            }
            matching += 1;
            if source.as_deref() == Some("user") || split_parents.contains(&id) {
                continue;
            }
            if current_category.as_deref() == Some(category) {
                continue;
            }
            let owned_by_this_rule = rules
                .best_match(&description)
                .is_some_and(|winner| winner.pattern.eq_ignore_ascii_case(pattern));
            if owned_by_this_rule {
                ids.push(id);
            }
        }
        Ok((matching, ids))
    }

    /// See `rule_candidates` — the read-only "here's what saving this would
    /// do" the rules manager shows before you commit.
    pub fn preview_rule(&self, pattern: &str, category: &str, replacing: Option<&str>) -> rusqlite::Result<RulePreview> {
        let (matching, ids) = self.rule_candidates(pattern, category, replacing)?;
        Ok(RulePreview {
            matching,
            would_change: ids.len(),
        })
    }

    /// Re-categorizes exactly the transactions `preview_rule` counts, as
    /// rule-sourced (so a later user correction still outranks it). Returns
    /// how many changed.
    pub fn apply_rule_to_existing(&self, pattern: &str, category: &str) -> rusqlite::Result<usize> {
        let (_, ids) = self.rule_candidates(pattern, category, None)?;
        for id in &ids {
            self.set_category(*id, category, CategorySource::Rule, None)?;
        }
        Ok(ids.len())
    }

    /// (description, category) for every transaction categorized by a rule
    /// or confirmed by the user — the training corpus for
    /// `Classifier::train`. Deliberately excludes the classifier's own past
    /// guesses: training the next classifier on an earlier unconfident
    /// guess would let it reinforce itself indefinitely across imports,
    /// since nothing distinguishes a self-generated guess from real ground
    /// truth once it's sitting in the table with a category.
    pub fn labeled_history(&self) -> rusqlite::Result<Vec<(String, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT description, category FROM transactions
             WHERE category IS NOT NULL AND category_source IN ('rule', 'user') AND deleted_at IS NULL",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }
}
