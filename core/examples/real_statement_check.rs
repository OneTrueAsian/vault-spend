//! LOCAL ONLY. Reads the owner's real statements and prints counts — never statement text or amounts
//! (unless `--show-unread`, which prints unread lines to this terminal only; never paste them anywhere).
//!
//! Periods come from `<folder>\periods.txt` (kept next to the statements, outside the repo), one line per
//! file: `file name|YYYY-MM-DD|YYYY-MM-DD|kind` where kind is cash, credit, loan or investment.
//!
//! cargo run -p budget_core --release --example real_statement_check -- "E:\misc\Programming\Claude\Statements" [--no-builtins] [--show-unread] [--only LAYOUT_ID] [--window N A B] [--shape N] [--rows N] [--holdings N]
//!
//! Privacy-preserving diagnostics for tuning a layout (N is the 0-based position in periods.txt):
//!   --window N A B  prints statement lines A..B of file N with only generic statement words shown (every
//!               other word is `~`) and digits as 9, so layout labels and line structure can be compared
//!               without seeing names, merchants or amounts. Line numbers match `unread line` numbers.
//!   --shape N     prints each unread line of file N with letters shown as a/A and digits as 9.
//!   --rows N      prints each row of file N: day offset, sign and size of the amount, masked description.
//!   --holdings N  prints each holding of file N: line, digit counts of shares and value, masked name.

use budget_core::statement::Period;
use budget_core::statement::checks::{CheckOutcome, check_section};
use budget_core::statement::layout::{GENERAL_ID, GENERAL_INVESTMENT_ID, built_in_layouts};
use budget_core::statement::pdf_text::read_pdf_lines;
use budget_core::statement::select::choose;

/// Generic statement words that may be shown. Every other word (names, merchants, addresses) is hidden.
const VOCAB: &[&str] = &[
    "account",
    "summary",
    "balance",
    "previous",
    "new",
    "beginning",
    "ending",
    "opening",
    "closing",
    "starting",
    "total",
    "totals",
    "payment",
    "payments",
    "credit",
    "credits",
    "debit",
    "debits",
    "charges",
    "charge",
    "fees",
    "merchant",
    "name",
    "or",
    "of",
    "date",
    "transaction",
    "rewards",
    "points",
    "fee",
    "interest",
    "charged",
    "minimum",
    "due",
    "limit",
    "available",
    "cash",
    "advance",
    "advances",
    "activity",
    "additions",
    "subtractions",
    "addition",
    "subtraction",
    "holdings",
    "holding",
    "value",
    "market",
    "period",
    "principal",
    "escrow",
    "amount",
    "transactions",
    "purchases",
    "purchase",
    "forward",
    "outstanding",
    "year",
    "to",
    "from",
    "for",
    "and",
    "the",
    "on",
    "in",
    "this",
    "your",
    "current",
    "month",
    "day",
    "days",
    "billing",
    "cycle",
    "statement",
    "share",
    "id",
    "deposit",
    "deposits",
    "withdrawal",
    "withdrawals",
    "dividend",
    "dividends",
    "securities",
    "equivalents",
    "money",
    "sweep",
    "income",
    "expenses",
    "other",
    "past",
    "late",
    "plan",
    "pay",
    "over",
    "time",
    "annual",
    "percentage",
    "rate",
    "apr",
    "calculation",
    "average",
    "daily",
    "regular",
    "savings",
    "checking",
    "loan",
    "mortgage",
    "home",
    "tax",
    "taxes",
    "insurance",
    "unpaid",
    "year-to-date",
    "ytd",
    "quarter",
    "page",
    "continued",
    "details",
    "detail",
    "reference",
    "number",
    "description",
    "prior",
    "next",
    "adjustments",
    "adjustment",
    "refunds",
    "refund",
    "returns",
    "rebate",
    "cashback",
    "back",
    "earned",
    "redeemed",
    "bonus",
    "purchased",
    "sold",
    "bought",
    "reinvest",
    "reinvestment",
    "shares",
    "quantity",
    "price",
    "cost",
    "basis",
    "gain",
    "loss",
    "unrealized",
    "realized",
    "change",
    "net",
    "gross",
    "estimated",
    "annualized",
    "yield",
    "cr",
    "dr",
];

/// A line with only generic statement words kept: other words become `~`, digits become 9.
fn vocab_line(text: &str) -> String {
    text.split_whitespace()
        .map(|tok| {
            let core: String = tok.chars().filter(|c| c.is_alphabetic() || *c == '-').collect::<String>().to_lowercase();
            let has_digit = tok.chars().any(|c| c.is_ascii_digit());
            let has_letter = tok.chars().any(|c| c.is_alphabetic());
            if has_digit {
                if has_letter {
                    "~9".to_string()
                } else {
                    tok.chars().map(|c| if c.is_ascii_digit() { '9' } else { c }).collect()
                }
            } else if !has_letter || VOCAB.contains(&core.as_str()) {
                tok.to_string()
            } else {
                "~".to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Letters become a/A and digits 9: only the structure of a line is left.
fn shape(text: &str) -> String {
    text.chars()
        .map(|c| {
            if c.is_ascii_digit() {
                '9'
            } else if c.is_uppercase() {
                'A'
            } else if c.is_alphabetic() {
                'a'
            } else {
                c
            }
        })
        .collect()
}

fn index_arg(args: &[String], flag: &str) -> Option<usize> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
}

/// For a failed activity check: what the shortfall looks like, without printing any amount.
fn shortfall_hint(c: &CheckOutcome, rows: &[budget_core::statement::StatementRow]) -> String {
    let CheckOutcome::Failed { expected, found } = c else {
        return String::new();
    };
    let diff = *expected - *found;
    let digits = diff.abs().trunc().to_string().len();
    let single = rows.iter().position(|r| r.amount == diff).map(|i| format!("equals row {i}"));
    let negated = rows.iter().position(|r| r.amount == -diff).map(|i| format!("equals minus row {i}"));
    let doubled = rows
        .iter()
        .position(|r| r.amount * rust_decimal::Decimal::from(2) == diff)
        .map(|i| format!("equals twice row {i}"));
    format!(
        " shortfall(sign={}, whole_digits={digits}, {})",
        if diff.is_sign_negative() { "-" } else { "+" },
        single.or(negated).or(doubled).unwrap_or_else(|| "no single row".to_string())
    )
}

/// For a failed activity check: which single change would have made it pass (no amounts shown).
fn repair_hints(section: &budget_core::statement::StatementSection) -> String {
    let passes = |s: &budget_core::statement::StatementSection| check_section(s).activity == CheckOutcome::Passed;
    let mut hints = Vec::new();
    for k in 0..section.rows.len() {
        let mut dropped = section.clone();
        dropped.rows.remove(k);
        if passes(&dropped) {
            hints.push(format!("dropping row {k}"));
        }
        let mut flipped = section.clone();
        flipped.rows[k].amount = -flipped.rows[k].amount;
        if passes(&flipped) {
            hints.push(format!("flipping the sign of row {k}"));
        }
    }
    let mut all = section.clone();
    all.rows.iter_mut().for_each(|r| r.amount = -r.amount);
    if passes(&all) {
        hints.push("reversing every sign".to_string());
    }
    if hints.is_empty() {
        "no single drop, flip or reversal fixes it".to_string()
    } else {
        format!("would pass after: {}", hints.join("; "))
    }
}

/// For a failed holdings check: which single change would have made it pass (no amounts shown).
fn holdings_hints(section: &budget_core::statement::StatementSection) -> String {
    let passes = |s: &budget_core::statement::StatementSection| check_section(s).holdings == CheckOutcome::Passed;
    let mut hints = Vec::new();
    for k in 0..section.holdings.len() {
        let mut dropped = section.clone();
        dropped.holdings.remove(k);
        if passes(&dropped) {
            hints.push(format!("dropping holding {k}"));
        }
    }
    let mut deduped = section.clone();
    let mut seen = Vec::new();
    deduped.holdings.retain(|h| {
        let key = (h.symbol.clone(), h.shares, h.market_value);
        if seen.contains(&key) {
            false
        } else {
            seen.push(key);
            true
        }
    });
    if deduped.holdings.len() != section.holdings.len() && passes(&deduped) {
        hints.push(format!(
            "keeping each security once ({} -> {} entries)",
            section.holdings.len(),
            deduped.holdings.len()
        ));
    }
    let mut no_cash = section.clone();
    no_cash.holdings_cash = None;
    if passes(&no_cash) {
        hints.push("leaving the cash line out".to_string());
    }
    let mut twice = section.clone();
    twice.holdings_cash = section.holdings_cash.map(|c| c * rust_decimal::Decimal::from(2));
    if passes(&twice) {
        hints.push("counting the cash line twice".to_string());
    }
    let off = match check_section(section).holdings {
        CheckOutcome::Failed { expected, found } => {
            let d = expected - found;
            let hit = section
                .holdings
                .iter()
                .position(|h| h.market_value == d.abs())
                .map(|i| format!(", equals holding {i}"))
                .unwrap_or_default();
            format!(
                " off by {}{}.dd{hit};",
                if d.is_sign_negative() { "-" } else { "+" },
                "9".repeat(d.abs().trunc().to_string().len())
            )
        }
        _ => String::new(),
    };
    format!(
        "holdings read={} cash_line={} total_line={};{off} {}",
        section.holdings.len(),
        yn(section.holdings_cash.is_some()),
        yn(section.holdings_total.is_some()),
        if hints.is_empty() {
            "no single drop or cash change fixes it".to_string()
        } else {
            format!("would pass after: {}", hints.join("; "))
        }
    )
}

fn yn(found: bool) -> &'static str {
    if found { "Y" } else { "N" }
}

fn outcome(c: &CheckOutcome) -> &'static str {
    match c {
        CheckOutcome::Passed => "passed",
        CheckOutcome::Failed { .. } => "FAILED",
        CheckOutcome::NotAvailable => "n/a",
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let folder = std::path::PathBuf::from(args.first().expect("pass the statements folder"));
    let no_builtins = args.iter().any(|a| a == "--no-builtins");
    let only = args.iter().position(|a| a == "--only").and_then(|i| args.get(i + 1)).cloned();
    let show_unread = args.iter().any(|a| a == "--show-unread");
    let window = args.iter().position(|a| a == "--window").and_then(|i| {
        let get = |k: usize| args.get(i + k).and_then(|v| v.parse::<usize>().ok());
        Some((get(1)?, get(2)?, get(3)?))
    });
    let shape_for = index_arg(&args, "--shape");
    let rows_for = index_arg(&args, "--rows");
    let holdings_for = index_arg(&args, "--holdings");
    let periods = std::fs::read_to_string(folder.join("periods.txt")).expect("periods.txt next to the statements");
    let builtins: Vec<_> = built_in_layouts()
        .into_iter()
        .filter(|l| !no_builtins || l.id == GENERAL_ID || l.id == GENERAL_INVESTMENT_ID)
        .filter(|l| only.as_ref().is_none_or(|id| &l.id == id))
        .collect();
    let mut failures = 0;
    for (n, entry) in periods.lines().filter(|l| !l.trim().is_empty()).enumerate() {
        let parts: Vec<&str> = entry.split('|').collect();
        let period = Period::new(parts[1].parse().unwrap(), parts[2].parse().unwrap()).unwrap();
        let investment = parts.get(3).is_some_and(|k| *k == "investment");
        let bytes = std::fs::read(folder.join(parts[0])).expect("statement file");
        let lines = match read_pdf_lines(bytes) {
            Ok(lines) => lines,
            Err(e) => {
                println!("#{n}: could not read ({e:?})");
                failures += 1;
                continue;
            }
        };
        if let Some((file, from, to)) = window
            && file == n
        {
            for (i, line) in lines.iter().enumerate().skip(from).take(to.saturating_sub(from) + 1) {
                println!("    {i:>4} p{}: {}", line.page, vocab_line(&line.text));
            }
        }
        let reading = choose(&lines, &period, &[], &builtins, investment);
        for (i, s) in reading.sections.iter().enumerate() {
            let c = check_section(s);
            if matches!(c.activity, CheckOutcome::Failed { .. }) || matches!(c.holdings, CheckOutcome::Failed { .. }) || !s.unread.is_empty() {
                failures += 1;
            }
            println!(
                "#{n}.{i}: layout={} recognized={} rows={} unread={} dropped={} holdings={} activity={} holdings_check={} running_breaks={} start={} end={} totals={}",
                reading.layout.id,
                reading.recognized,
                s.rows.len(),
                s.unread.len(),
                s.dropped_out_of_period,
                s.holdings.len(),
                outcome(&c.activity),
                outcome(&c.holdings),
                c.running_balance_breaks.len(),
                yn(s.starting_balance.is_some()),
                yn(s.ending_balance.is_some()),
                yn(s.activity_totals.is_some())
            );
            let hint = shortfall_hint(&c.activity, &s.rows);
            if !hint.is_empty() {
                println!("    #{n}.{i}{hint}; {}", repair_hints(s));
            }
            if matches!(c.holdings, CheckOutcome::Failed { .. }) {
                println!("    #{n}.{i} {}", holdings_hints(s));
            }
            if show_unread {
                for u in &s.unread {
                    println!("    unread line {}: {}", u.line, u.text);
                }
            }
            if rows_for == Some(n) {
                for r in &s.rows {
                    println!(
                        "    row @{:>4} +{:>3}d {}{}.dd{} | {}",
                        r.line,
                        (r.date - period.start).num_days(),
                        if r.amount.is_sign_negative() { "-" } else { "+" },
                        "9".repeat(r.amount.abs().trunc().to_string().len()),
                        r.running_balance.map(|_| " (running balance)").unwrap_or_default(),
                        vocab_line(&r.description)
                    );
                }
            }
            if holdings_for == Some(n) {
                for h in &s.holdings {
                    println!(
                        "    holding @{:>4} price~{}d {}| shares {}.d value {}.dd | {}",
                        h.line,
                        if h.shares.is_zero() {
                            0
                        } else {
                            (h.market_value / h.shares).abs().trunc().to_string().len()
                        },
                        h.price
                            .map(|p| format!("printed {}d ", p.abs().trunc().to_string().len()))
                            .unwrap_or_default(),
                        "9".repeat(h.shares.abs().trunc().to_string().len()),
                        "9".repeat(h.market_value.abs().trunc().to_string().len()),
                        vocab_line(&h.name)
                    );
                }
            }
            if shape_for == Some(n) {
                for u in &s.unread {
                    println!("    unread shape {}: {}", u.line, shape(&u.text));
                }
            }
        }
    }
    println!("{failures} section(s) need attention");
    std::process::exit(if failures == 0 { 0 } else { 1 });
}
