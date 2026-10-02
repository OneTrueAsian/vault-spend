//! Replays a real database through the categorizer to measure how good it is.
//!
//!     cargo run -p budget_core --release --example categorizer_eval -- <path-to.db> [--misses]
//!
//! The database is opened read-only and nothing is written, so it is safe to point at a copy of your
//! own data. Transactions are walked in date order. For each one the *current* `categorize()` predicts
//! using only what the app would have known at that moment (the seeded rules, rules learned from earlier
//! corrections, and a classifier trained on earlier labeled history). A transaction the person set
//! themselves (`category_source = 'user'`) is scored against the category they chose; it then teaches the
//! rule set and the training history exactly as a real correction does. Transactions a rule or the
//! classifier categorized are assumed accepted: they join the history but are not scored.
//!
//! An answer with a confidence under `LOW_CONFIDENCE` (the review inbox's "Unsure" cutoff) is *flagged* for
//! the person to check; every other answer is applied *silently*. Silent wrong answers are the ones that
//! do harm, so they are reported separately from flagged ones.
//!
//! `--misses` also prints each wrong or unanswered transaction (descriptions are personal data, so it is
//! off by default and nothing here ever stores them).

use budget_core::categorizer::categorize;
use budget_core::classifier::Classifier;
use budget_core::learner::learn_from_correction;
use budget_core::rules::RuleSet;
use budget_core::store::CategorySource;
use rusqlite::{Connection, OpenFlags};
use std::collections::BTreeMap;

/// The review inbox flags any answer below this confidence as "Unsure" (src/importInbox.ts).
const LOW_CONFIDENCE: f64 = 0.7;

struct Txn {
    month: String,
    description: String,
    category: String,
    scored: bool,
}

#[derive(Default, Clone, Copy)]
struct Tally {
    n: u32,
    correct: u32,
}

impl Tally {
    fn add(&mut self, correct: bool) {
        self.n += 1;
        self.correct += u32::from(correct);
    }
    fn pct(&self) -> String {
        if self.n == 0 {
            "   - ".into()
        } else {
            format!("{:5.1}%", 100.0 * f64::from(self.correct) / f64::from(self.n))
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let path = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .expect("usage: categorizer_eval <path-to.db> [--misses]");
    let show_misses = args.iter().any(|a| a == "--misses");

    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).expect("open the database read-only");
    let mut stmt = conn
        .prepare(
            "SELECT description, category, category_source, substr(date, 1, 7) FROM transactions
             WHERE deleted_at IS NULL AND category IS NOT NULL AND category != ''
             ORDER BY date, id",
        )
        .expect("prepare");
    let txns: Vec<Txn> = stmt
        .query_map([], |row| {
            let source: Option<String> = row.get(2)?;
            Ok(Txn {
                month: row.get(3)?,
                description: row.get(0)?,
                category: row.get(1)?,
                scored: source.as_deref() == Some("user"),
            })
        })
        .expect("query")
        .map(|r| r.expect("row"))
        .collect();

    let mut rules = RuleSet::seeded();
    let mut history: Vec<(String, String)> = Vec::new();
    let mut classifier: Option<Classifier> = None;

    let (mut rule_t, mut class_t, mut overall) = (Tally::default(), Tally::default(), Tally::default());
    let (mut silent, mut flagged) = (Tally::default(), Tally::default());
    let (mut silent_first, mut silent_second) = (Tally::default(), Tally::default());
    let mut abstained = 0u32;
    let (mut first_half, mut second_half) = (Tally::default(), Tally::default());
    let mut buckets: [Tally; 4] = [Tally::default(); 4];
    let mut brier_sum = 0.0f64;
    let mut confusions: BTreeMap<(String, String), u32> = BTreeMap::new();
    let scored_total = txns.iter().filter(|t| t.scored).count();
    let mut scored_seen = 0usize;

    // Review workload: what every transaction, not just the ones the person set, would get on arrival.
    // month -> (arrived, flagged or unanswered)
    let mut workload: BTreeMap<String, (u32, u32)> = BTreeMap::new();
    // why: no answer, a contested rule, an unsure classifier guess; and how many of each were right
    let (mut why_none, mut why_rule, mut why_class) = (0u32, Tally::default(), Tally::default());

    for txn in &txns {
        let arrival = categorize(&txn.description, &rules, &history, classifier.as_ref());
        let needs_look = match &arrival {
            None => true,
            Some((_, _, confidence)) => confidence.is_some_and(|c| c < LOW_CONFIDENCE),
        };
        match &arrival {
            None => why_none += 1,
            Some((category, source, Some(c))) if *c < LOW_CONFIDENCE => {
                let right = *category == txn.category;
                if *source == CategorySource::Rule {
                    why_rule.add(right)
                } else {
                    why_class.add(right)
                }
            }
            _ => {}
        }
        let entry = workload.entry(txn.month.clone()).or_default();
        entry.0 += 1;
        entry.1 += u32::from(needs_look);
        if txn.scored {
            scored_seen += 1;
            let guess = categorize(&txn.description, &rules, &history, classifier.as_ref());
            match &guess {
                None => {
                    abstained += 1;
                    if show_misses {
                        println!("NO ANSWER  {:<40} want {}", txn.description, txn.category);
                    }
                }
                Some((category, source, confidence)) => {
                    let correct = *category == txn.category;
                    if confidence.is_some_and(|c| c < LOW_CONFIDENCE) {
                        flagged.add(correct)
                    } else {
                        silent.add(correct);
                        if scored_seen * 2 <= scored_total {
                            silent_first.add(correct)
                        } else {
                            silent_second.add(correct)
                        }
                    }
                    match source {
                        CategorySource::Rule => rule_t.add(correct),
                        _ => {
                            class_t.add(correct);
                            let c = confidence.unwrap_or(0.0);
                            brier_sum += (c - f64::from(u8::from(correct))).powi(2);
                            let i = if c < 0.5 {
                                0
                            } else if c < 0.7 {
                                1
                            } else if c < 0.9 {
                                2
                            } else {
                                3
                            };
                            buckets[i].add(correct);
                        }
                    }
                    if !correct {
                        *confusions.entry((txn.category.clone(), category.clone())).or_default() += 1;
                        if show_misses {
                            println!("WRONG      {:<40} want {} got {} ({:?})", txn.description, txn.category, category, source);
                        }
                    }
                }
            }
            let correct = guess.as_ref().is_some_and(|(c, _, _)| *c == txn.category);
            overall.add(correct);
            if scored_seen * 2 <= scored_total {
                first_half.add(correct)
            } else {
                second_half.add(correct)
            }
            // A person's own choice teaches the rule set, exactly like a correction in the app.
            learn_from_correction(&mut rules, &txn.description, &txn.category);
        }
        history.push((txn.description.clone(), txn.category.clone()));
        let examples: Vec<(&str, &str)> = history.iter().map(|(d, c)| (d.as_str(), c.as_str())).collect();
        classifier = Some(Classifier::train(&examples));
    }

    let answered = rule_t.n + class_t.n;
    let (arrived, looks): (u32, u32) = workload.values().fold((0, 0), |(a, l), (x, y)| (a + x, l + y));
    println!(
        "Review workload over every transaction as it arrived: {looks} of {arrived} ({:.1}%) needed a look",
        pct(looks, arrived)
    );
    println!(
        "  because: no answer {why_none}; contested rule {} ({} of them right); unsure classifier {} ({} right)",
        why_rule.n,
        why_rule.pct(),
        why_class.n,
        why_class.pct()
    );
    for (month, (a, l)) in &workload {
        println!("  {month}: {l:>3} of {a:>3}");
    }
    println!();
    println!("transactions replayed: {}   scored (set by the person): {}", txns.len(), scored_total);
    println!();
    println!("Of the {} transactions the person categorized themselves:", scored_total);
    println!(
        "  answered correctly ........ {:5.1}%  ({} of {})",
        pct(overall.correct, overall.n),
        overall.correct,
        overall.n
    );
    println!(
        "  answered wrongly .......... {:5.1}%  ({})",
        pct(answered - overall.correct, overall.n),
        answered - overall.correct
    );
    println!("  no answer (Uncategorized) . {:5.1}%  ({})", pct(abstained, overall.n), abstained);
    println!();
    println!(
        "  applied silently .. {:>4} answers, {} correct  -> {} silent mistakes",
        silent.n,
        silent.pct(),
        silent.n - silent.correct
    );
    println!(
        "  silent mistakes by half of history: first {} of {}, second {} of {}",
        silent_first.n - silent_first.correct,
        silent_first.n,
        silent_second.n - silent_second.correct,
        silent_second.n
    );
    println!(
        "  flagged for review  {:>4} answers, {} correct  -> {} mistakes caught",
        flagged.n,
        flagged.pct(),
        flagged.n - flagged.correct
    );
    println!("  no answer ......... {:>4}", abstained);
    println!();
    println!("  by rule ........... {:>4} answers, {} correct", rule_t.n, rule_t.pct());
    println!("  by classifier ..... {:>4} answers, {} correct", class_t.n, class_t.pct());
    println!(
        "  learning curve: first half {} correct, second half {} correct",
        pct_tally(&first_half),
        pct_tally(&second_half)
    );
    println!();
    println!(
        "Classifier calibration (Brier score, lower is better; 0.25 = no better than a coin): {:.4}",
        if class_t.n == 0 { 0.0 } else { brier_sum / f64::from(class_t.n) }
    );
    println!("Classifier accuracy by its own stated confidence:");
    for (label, t) in ["< 50%", "50-70%", "70-90%", ">= 90%"].iter().zip(buckets.iter()) {
        println!("  {label:>7}: {:>4} guesses, {} correct", t.n, t.pct());
    }
    if !confusions.is_empty() {
        let mut top: Vec<_> = confusions.into_iter().collect();
        top.sort_by_key(|entry| std::cmp::Reverse(entry.1));
        println!();
        println!("Most common mistakes (wanted -> got):");
        for ((want, got), n) in top.into_iter().take(8) {
            println!("  {n:>3}  {want} -> {got}");
        }
    }
}

fn pct(part: u32, whole: u32) -> f64 {
    if whole == 0 { 0.0 } else { 100.0 * f64::from(part) / f64::from(whole) }
}

fn pct_tally(t: &Tally) -> String {
    t.pct()
}
