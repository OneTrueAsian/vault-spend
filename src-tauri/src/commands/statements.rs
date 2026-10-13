//! Commands: reconciling an account by uploading its statement (PDF or a bank download), teaching the
//! app a statement it couldn't read, and managing the statements it has learned. See
//! docs/STATEMENT-RECONCILE.md.

use super::*;
use crate::statement_review::{Session, Source};
pub use crate::statement_review::{Sessions, STALE};
use budget_core::import_resolution::{is_sure, Suggestion};
use budget_core::statement::checks::{check_section, CheckOutcome, SectionChecks};
use budget_core::statement::layout::{built_in_layouts, StatementLayout, GENERAL_ID, GENERAL_INVESTMENT_ID};
use budget_core::statement::learn::{self, TeachMarks};
use budget_core::statement::matching::{match_items, suggest_flip, to_app_amount, AccountKind, AppItem, StatementItem};
use budget_core::statement::pdf_text::{read_pdf_lines, MAX_STATEMENT_BYTES};
use budget_core::statement::select::{choose, read_with, recognizes, LayoutOrigin};
use budget_core::statement::{Period, StatementRow, StatementSection};
use budget_core::store::{HoldingChange, ReconcileSource, StatementFinish, StoredHolding};
use std::io::Read;

#[cfg(test)]
mod tests;

const PROFILE_CHANGED: &str = "The profile changed. Close this statement and start again in the current profile.";
const NO_SUCH_PART: &str = "That part of the statement doesn't exist. Read the statement again.";
const EVERY_LINE: &str = "Choose what to do with every line on your statement first.";
const CANNOT_OPEN: &str = "Could not open this statement. Check its location and access.";

fn ensure_generation(paths: &crate::config::AppPaths, generation: u64) -> Result<(), String> {
    if paths.current_generation() == generation {
        Ok(())
    } else {
        Err(PROFILE_CHANGED.into())
    }
}

// ---------- DTOs ----------

#[derive(Serialize, Debug)]
pub struct SectionChoiceDto {
    pub index: usize,
    pub name: String,
    pub row_count: usize,
    pub holding_count: usize,
}

#[derive(Serialize, Debug)]
pub struct StatementReadDto {
    pub token: String,
    pub sections: Vec<SectionChoiceDto>,
    pub review: Option<StatementReviewDto>,
}

#[derive(Serialize, Debug)]
pub struct CheckDto {
    pub outcome: String,
    pub expected: Option<String>,
    pub found: Option<String>,
}

impl From<&CheckOutcome> for CheckDto {
    fn from(c: &CheckOutcome) -> Self {
        match c {
            CheckOutcome::Passed => CheckDto {
                outcome: "passed".into(),
                expected: None,
                found: None,
            },
            CheckOutcome::Failed { expected, found } => CheckDto {
                outcome: "failed".into(),
                expected: Some(expected.to_string()),
                found: Some(found.to_string()),
            },
            CheckOutcome::NotAvailable => CheckDto {
                outcome: "not_available".into(),
                expected: None,
                found: None,
            },
        }
    }
}

#[derive(Serialize, Debug)]
pub struct ReviewRowDto {
    pub index: usize,
    pub date: String,
    pub description: String,
    /// In the app's sign for this account.
    pub amount: String,
    /// Loan accounts only: the part of a payment that lowers the loan balance, when the statement
    /// prints one (in the app's sign, like `amount`).
    pub principal: Option<String>,
    pub status: &'static str,
    pub match_id: Option<i64>,
    pub possible_ids: Vec<i64>,
}

#[derive(Serialize, Debug)]
pub struct AppTxDto {
    pub id: i64,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub change: String,
}

#[derive(Serialize, Debug)]
pub struct UnreadDto {
    pub line: usize,
    pub text: String,
}

#[derive(Serialize, Debug)]
pub struct HoldingReviewDto {
    pub symbol: String,
    pub name: String,
    pub statement_shares: String,
    pub price: Option<String>,
    pub market_value: String,
    /// The app's first holding (lot) of this symbol, the one an update changes.
    pub app_holding_id: Option<i64>,
    /// Every lot of this symbol in the app, added together.
    pub app_shares: Option<String>,
    pub status: &'static str,
}

#[derive(Serialize, Debug)]
pub struct AppHoldingDto {
    pub id: i64,
    pub symbol: String,
    pub name: String,
    pub shares: String,
}

#[derive(Serialize, Debug)]
pub struct StatementReviewDto {
    pub token: String,
    pub account_kind: AccountKind,
    pub source: String,
    pub layout_name: Option<String>,
    pub recognized: bool,
    pub recognized_but_failed: bool,
    pub learnable: bool,
    pub section_name: String,
    pub period_start: String,
    pub period_end: String,
    pub starting_balance: Option<String>,
    pub ending_balance: Option<String>,
    pub ending_value: Option<String>,
    /// Where this statement picks up from: the last reconciliation on or before its end date (plus any
    /// cash investment statements moved since). `None` for investment accounts and the first time.
    pub previous_ending_balance: Option<String>,
    pub already_reconciled_through: Option<String>,
    /// Every row on the statement fell outside the dates entered (wrong dates, or dates misread).
    pub nothing_in_period: bool,
    pub activity_check: CheckDto,
    pub holdings_check: CheckDto,
    pub running_balance_breaks: usize,
    pub rows: Vec<ReviewRowDto>,
    pub app_transactions: Vec<AppTxDto>,
    pub not_on_statement: Vec<i64>,
    pub unread: Vec<UnreadDto>,
    pub suggest_flip: bool,
    pub flipped: bool,
    pub holdings: Vec<HoldingReviewDto>,
    pub app_only_holdings: Vec<AppHoldingDto>,
    pub suggested_name: String,
    pub suggested_phrases: Vec<String>,
}

#[derive(Serialize, Debug)]
pub struct StatementLineDto {
    pub index: usize,
    pub page: usize,
    pub text: String,
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MatchDecision {
    pub row: usize,
    pub transaction_id: i64,
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AddDecision {
    pub row: usize,
    pub date: String,
    pub description: String,
    pub amount: String,
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HoldingDecision {
    pub symbol: String,
    pub action: String,
    pub holding_id: Option<i64>,
    pub shares: Option<String>,
    pub price: Option<String>,
    pub cost_basis: Option<String>,
    pub name: Option<String>,
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveLayoutDecision {
    pub name: String,
    pub phrases: Vec<String>,
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct FinishDecisionsDto {
    pub matches: Vec<MatchDecision>,
    pub add: Vec<AddDecision>,
    pub skip: Vec<usize>,
    pub starting_balance: Option<String>,
    pub ending_balance: Option<String>,
    pub holdings: Vec<HoldingDecision>,
    pub finish_without_holdings: bool,
    pub ignore_unread: bool,
    pub save_layout: Option<SaveLayoutDecision>,
}

#[derive(Serialize, Debug)]
pub struct StatementFinishedDto {
    pub reconciliation_id: i64,
    pub added: usize,
    pub layout_saved: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct StatementLayoutDto {
    pub id: i64,
    pub name: String,
    pub phrases: Vec<String>,
    pub updated_at: String,
}

pub struct ReadStatementArgs {
    pub path: String,
    pub account_id: i64,
    pub period_start: String,
    pub period_end: String,
}

// ---------- reading ----------

fn sections_of(session: &Session) -> Vec<StatementSection> {
    match (&session.source, &session.layout) {
        (Source::Pdf, Some(layout)) => read_with(&session.lines, layout, &session.period).0,
        _ => vec![StatementSection {
            name: "Bank download".into(),
            rows: session.download_rows.clone(),
            dropped_out_of_period: session.download_dropped,
            ..Default::default()
        }],
    }
}

/// A download states no balances or totals, so nothing on it can be checked.
fn checks_of(session: &Session, section: &StatementSection) -> SectionChecks {
    match session.source {
        Source::Pdf => check_section(section),
        Source::Download { .. } => check_section(&StatementSection::default()),
    }
}

/// A statement amount (in the statement's own terms) in the app's sign for this account.
fn to_app(session: &Session, printed: Decimal) -> Decimal {
    match (&session.source, &session.layout) {
        (Source::Pdf, Some(layout)) => to_app_amount(printed, session.kind, &layout.signs, session.flip),
        (Source::Download { flip }, _) => {
            if *flip != session.flip {
                -printed
            } else {
                printed
            }
        }
        (Source::Pdf, None) => printed,
    }
}

/// A loan row's principal part in the app's sign; `None` on other accounts.
fn app_principal(session: &Session, row: &StatementRow) -> Option<Decimal> {
    if session.kind != AccountKind::Loan {
        return None;
    }
    row.principal.map(|p| to_app(session, p))
}

fn no_failures(checks: &SectionChecks) -> bool {
    !matches!(checks.activity, CheckOutcome::Failed { .. }) && !matches!(checks.holdings, CheckOutcome::Failed { .. })
}

pub fn read_statement_for(state: &mut AppState, sessions: &Sessions, generation: u64, args: ReadStatementArgs) -> Result<StatementReadDto, String> {
    let period = Period::new(parse_date(&args.period_start)?, parse_date(&args.period_end)?).map_err(str::to_string)?;
    let kind = state.store.account_kind(args.account_id).map_err(|e| e.to_string())?;
    let file = std::path::Path::new(&args.path);
    let extension = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !file.is_file() {
        return Err("Choose one statement file, not a folder.".into());
    }
    if std::fs::metadata(file).map(|m| m.len() > MAX_STATEMENT_BYTES as u64).unwrap_or(false) {
        return Err("This file is too large to be a monthly statement.".into());
    }

    let mut session = Session {
        token: new_token()?,
        generation,
        created: std::time::Instant::now(),
        signature: state.store.reconcile_signature(args.account_id).map_err(|e| e.to_string())?,
        account_id: args.account_id,
        kind,
        period,
        source: Source::Pdf,
        lines: vec![],
        download_rows: vec![],
        download_dropped: 0,
        layout: None,
        origin: None,
        recognized: false,
        recognized_but_failed: false,
        taught: false,
        section: 0,
        flip: false,
    };

    match extension.as_str() {
        "pdf" => {
            let mut bytes = Vec::new();
            std::fs::File::open(file)
                .map_err(|_| CANNOT_OPEN)?
                .take(MAX_STATEMENT_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| CANNOT_OPEN)?;
            session.lines = read_pdf_lines(bytes).map_err(|e| e.to_string())?;
            let learned: Vec<(i64, StatementLayout)> = state
                .store
                .list_statement_layouts()
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|l| (l.id, l.layout))
                .collect();
            let reading = choose(&session.lines, &period, &learned, &built_in_layouts(), kind == AccountKind::Investment);
            session.recognized = reading.recognized;
            session.recognized_but_failed = reading.recognized_but_failed;
            session.origin = Some(reading.origin);
            session.layout = Some(reading.layout);
        }
        "csv" | "ofx" | "qfx" | "qif" => {
            let loaded = budget_core::importer::load_transactions(file, false).map_err(|_| CANNOT_OPEN)?;
            let today = chrono::Local::now().date_naive();
            let flip = state
                .store
                .list_accounts(today)
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|a| a.id == args.account_id)
                .and_then(|a| a.import_flip_signs)
                .unwrap_or(false);
            session.source = Source::Download { flip };
            for (i, t) in loaded.transactions.iter().enumerate() {
                if period.contains_with_leeway(t.date) {
                    session.download_rows.push(StatementRow {
                        line: i,
                        date: t.date,
                        description: t.description.clone(),
                        amount: t.amount,
                        running_balance: None,
                        principal: None,
                    });
                } else {
                    session.download_dropped += 1;
                }
            }
        }
        _ => return Err("Choose a PDF statement or your bank's CSV, OFX, QFX or QIF download.".into()),
    }

    let sections = sections_of(&session);
    let choices: Vec<SectionChoiceDto> = sections
        .iter()
        .enumerate()
        .map(|(index, s)| SectionChoiceDto {
            index,
            name: s.name.clone(),
            row_count: s.rows.len(),
            holding_count: s.holdings.len(),
        })
        .collect();
    let token = session.token.clone();
    let review = if sections.len() == 1 {
        Some(build_review(state, &session)?)
    } else {
        None
    };
    sessions.replace(session)?;
    Ok(StatementReadDto {
        token,
        sections: choices,
        review,
    })
}

fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "Could not start a safe statement review.")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn symbol_key(s: &str) -> String {
    s.trim().to_uppercase()
}

/// This account's holdings (every lot).
fn account_holdings(state: &AppState, account_id: i64) -> Result<Vec<StoredHolding>, String> {
    let today = chrono::Local::now().date_naive();
    Ok(state
        .store
        .list_holdings(today)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|h| h.account_id == account_id)
        .collect())
}

fn build_review(state: &AppState, session: &Session) -> Result<StatementReviewDto, String> {
    let sections = sections_of(session);
    let section = sections.get(session.section).ok_or(NO_SUCH_PART)?;
    let checks = checks_of(session, section);
    let period = &session.period;

    let items: Vec<StatementItem> = section
        .rows
        .iter()
        .enumerate()
        .map(|(index, r)| StatementItem {
            index,
            date: r.date,
            description: r.description.clone(),
            amount: to_app(session, r.amount),
        })
        .collect();
    let candidates = state.store.statement_candidates(session.account_id, period).map_err(|e| e.to_string())?;
    let app_items: Vec<AppItem> = candidates
        .iter()
        .map(|c| AppItem {
            id: c.id,
            date: c.date,
            description: c.description.clone(),
            amount: c.amount,
        })
        .collect();
    let matched = match_items(&items, &app_items, period);

    let rows = items
        .iter()
        .zip(&section.rows)
        .map(|(item, row)| {
            let m = matched.matched.iter().find(|(i, _)| *i == item.index).map(|(_, id)| *id);
            let p = matched
                .possible
                .iter()
                .find(|(i, _)| *i == item.index)
                .map(|(_, ids)| ids.clone())
                .unwrap_or_default();
            ReviewRowDto {
                index: item.index,
                date: item.date.to_string(),
                description: item.description.clone(),
                amount: item.amount.to_string(),
                principal: app_principal(session, row).map(|p| p.to_string()),
                status: if m.is_some() {
                    "matched"
                } else if !p.is_empty() {
                    "possible"
                } else {
                    "missing"
                },
                match_id: m,
                possible_ids: p,
            }
        })
        .collect();

    let (holdings, app_only_holdings) = if session.kind == AccountKind::Investment {
        let app = account_holdings(state, session.account_id)?;
        let reviewed = section
            .holdings
            .iter()
            .map(|h| {
                let lots: Vec<&StoredHolding> = app.iter().filter(|a| symbol_key(&a.symbol) == symbol_key(&h.symbol)).collect();
                let held: Option<Decimal> = (!lots.is_empty()).then(|| lots.iter().map(|a| a.shares).sum());
                HoldingReviewDto {
                    symbol: h.symbol.clone(),
                    name: h.name.clone(),
                    statement_shares: h.shares.normalize().to_string(),
                    price: h.price.map(|p| p.to_string()),
                    market_value: h.market_value.to_string(),
                    app_holding_id: lots.first().map(|a| a.id),
                    app_shares: held.map(|s| s.normalize().to_string()),
                    status: match held {
                        Some(s) if s == h.shares => "same",
                        Some(_) => "different",
                        None => "missing_in_app",
                    },
                }
            })
            .collect();
        let only = app
            .iter()
            .filter(|a| !section.holdings.iter().any(|h| symbol_key(&h.symbol) == symbol_key(&a.symbol)))
            .map(|a| AppHoldingDto {
                id: a.id,
                symbol: a.symbol.clone(),
                name: a.name.clone(),
                shares: a.shares.normalize().to_string(),
            })
            .collect();
        (reviewed, only)
    } else {
        (vec![], vec![])
    };

    // An investment statement states no balance to continue from (its record keeps the total value for
    // reference only), so only other accounts are told where this statement picks up from.
    let previous_ending_balance = if session.kind == AccountKind::Investment {
        None
    } else {
        state
            .store
            .reconcile_starting_point(session.account_id, period.end)
            .map_err(|e| e.to_string())?
    };
    let last = state.store.last_reconciliation(session.account_id).map_err(|e| e.to_string())?;
    let today = chrono::Local::now().date_naive();
    let avoid: Vec<String> = state
        .store
        .list_accounts(today)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|a| a.account.name)
        .chain(state.store.list_family_members().map_err(|e| e.to_string())?.into_iter().map(|m| m.name))
        .collect();
    let (suggested_name, suggested_phrases) = learn::suggest_name_and_phrases(&session.lines, &avoid);
    let learnable = matches!(session.source, Source::Pdf) && !session.recognized && (session.taught || no_failures(&checks));
    let layout_name = match (&session.origin, &session.layout) {
        (Some(LayoutOrigin::Learned { .. }) | Some(LayoutOrigin::BuiltIn { .. }), Some(l)) if session.recognized => Some(l.name.clone()),
        _ => None,
    };

    Ok(StatementReviewDto {
        token: session.token.clone(),
        account_kind: session.kind,
        source: match session.source {
            Source::Pdf => "pdf",
            Source::Download { .. } => "download",
        }
        .into(),
        layout_name,
        recognized: session.recognized,
        recognized_but_failed: session.recognized_but_failed,
        learnable,
        section_name: section.name.clone(),
        period_start: period.start.to_string(),
        period_end: period.end.to_string(),
        starting_balance: section.starting_balance.map(|d| d.to_string()),
        ending_balance: section.ending_balance.map(|d| d.to_string()),
        ending_value: section.ending_value.map(|d| d.to_string()),
        previous_ending_balance: previous_ending_balance.map(|d| d.to_string()),
        already_reconciled_through: last.filter(|(date, _)| period.end <= *date).map(|(date, _)| date.to_string()),
        nothing_in_period: section.rows.is_empty() && section.dropped_out_of_period > 0,
        activity_check: (&checks.activity).into(),
        holdings_check: (&checks.holdings).into(),
        running_balance_breaks: checks.running_balance_breaks.len(),
        rows,
        app_transactions: candidates
            .iter()
            .map(|c| AppTxDto {
                id: c.id,
                date: c.date.to_string(),
                description: c.description.clone(),
                amount: c.amount.to_string(),
                change: c.change.to_string(),
            })
            .collect(),
        not_on_statement: matched.not_on_statement,
        unread: section
            .unread
            .iter()
            .map(|u| UnreadDto {
                line: u.line,
                text: u.text.clone(),
            })
            .collect(),
        suggest_flip: !session.flip && suggest_flip(&items, &app_items, period),
        flipped: session.flip,
        holdings,
        app_only_holdings,
        suggested_name,
        suggested_phrases,
    })
}

pub fn review_statement_for(
    state: &mut AppState,
    sessions: &Sessions,
    generation: u64,
    token: &str,
    section_index: usize,
    flip: bool,
) -> Result<StatementReviewDto, String> {
    sessions.with(token, generation, |session| {
        if sections_of(session).len() <= section_index {
            return Err(NO_SUCH_PART.into());
        }
        session.section = section_index;
        session.flip = flip;
        build_review(state, session)
    })
}

pub fn statement_lines_for(sessions: &Sessions, generation: u64, token: &str) -> Result<Vec<StatementLineDto>, String> {
    sessions.with(token, generation, |session| {
        Ok(session
            .lines
            .iter()
            .enumerate()
            .map(|(index, l)| StatementLineDto {
                index,
                page: l.page,
                text: l.text.clone(),
            })
            .collect())
    })
}

pub fn teach_statement_layout_for(
    state: &mut AppState,
    sessions: &Sessions,
    generation: u64,
    token: &str,
    marks: TeachMarks,
) -> Result<StatementReviewDto, String> {
    sessions.with(token, generation, |session| {
        if !matches!(session.source, Source::Pdf) {
            return Err("Only a PDF statement can be taught.".into());
        }
        let (base, origin) = teaching_base(state, session)?;
        let taught = learn::from_marks(&base, &session.lines, &marks, &session.period).map_err(|e| e.to_string())?;
        session.layout = Some(taught);
        session.origin = Some(origin);
        session.taught = true;
        session.recognized = false;
        if sections_of(session).len() <= session.section {
            session.section = 0;
        }
        build_review(state, session)
    })
}

/// What teaching starts from, and what saving it then updates: the learned (else built-in) layout that
/// recognises this statement, so teaching a bank whose statement changed updates how the app reads it;
/// otherwise the general layout for this kind of account. Never the best guess from reading, which may
/// be another bank's layout with rules that don't apply here. Every call starts from the same base, so
/// the marks sent each time are all the examples the person has marked so far.
fn teaching_base(state: &AppState, session: &Session) -> Result<(StatementLayout, LayoutOrigin), String> {
    let learned = state.store.list_statement_layouts().map_err(|e| e.to_string())?;
    if let Some(l) = learned.into_iter().find(|l| recognizes(&l.layout, &session.lines)) {
        return Ok((l.layout, LayoutOrigin::Learned { id: l.id }));
    }
    let built_ins = built_in_layouts();
    let general = if session.kind == AccountKind::Investment {
        GENERAL_INVESTMENT_ID
    } else {
        GENERAL_ID
    };
    let base = built_ins
        .iter()
        .find(|l| recognizes(l, &session.lines))
        .or_else(|| built_ins.iter().find(|l| l.id == general))
        .cloned()
        .ok_or(STALE)?;
    let origin = LayoutOrigin::BuiltIn { id: base.id.clone() };
    Ok((base, origin))
}

/// The category to file an added row under: only a sure guess, and only under a category the person
/// already has (a guess never adds one to their list).
fn sure_category(
    state: &AppState,
    history: &[(String, String)],
    classifier: &budget_core::classifier::Classifier,
    description: &str,
) -> Result<Option<String>, String> {
    let guess = categorizer::categorize(description, &state.rules, history, Some(classifier))
        .map(|(category, source, confidence)| Suggestion {
            category,
            source,
            confidence,
        })
        .filter(is_sure);
    match guess {
        Some(s) => state.store.find_category(&s.category).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

/// The holdings changes the person chose. An update sets the symbol's total across every lot the app
/// holds by changing the chosen lot by the difference, because the statement check compares totals.
fn holding_changes(
    state: &AppState,
    session: &Session,
    section: &StatementSection,
    decisions: &[HoldingDecision],
) -> Result<Vec<HoldingChange>, String> {
    const SHARES: &str = "Enter the share count.";
    let app = if decisions.is_empty() {
        vec![]
    } else {
        account_holdings(state, session.account_id)?
    };
    let mut changes = Vec::new();
    for h in decisions {
        let shares = h.shares.as_deref().filter(|s| !s.trim().is_empty()).map(parse_amount).transpose()?;
        let on_statement = section.holdings.iter().find(|s| symbol_key(&s.symbol) == symbol_key(&h.symbol));
        match h.action.as_str() {
            "update" => {
                let id = h.holding_id.ok_or(STALE)?;
                let lot = app.iter().find(|a| a.id == id).ok_or(STALE)?;
                let target = shares.or(on_statement.map(|s| s.shares)).ok_or(SHARES)?;
                let held: Decimal = app
                    .iter()
                    .filter(|a| symbol_key(&a.symbol) == symbol_key(&lot.symbol))
                    .map(|a| a.shares)
                    .sum();
                changes.push(HoldingChange::SetShares {
                    holding_id: id,
                    shares: lot.shares + (target - held),
                });
            }
            "add" => {
                let shares = shares.or(on_statement.map(|s| s.shares)).ok_or(SHARES)?;
                let price = match h.price.as_deref().filter(|p| !p.trim().is_empty()) {
                    Some(p) => parse_amount(p)?,
                    None => on_statement
                        .and_then(|s| s.price.or_else(|| (s.shares > Decimal::ZERO).then(|| s.market_value / s.shares)))
                        .unwrap_or_default(),
                };
                let name = h
                    .name
                    .as_deref()
                    .map(str::trim)
                    .filter(|n| !n.is_empty())
                    .map(str::to_string)
                    .or(on_statement.map(|s| s.name.trim().to_string()).filter(|n| !n.is_empty()))
                    .unwrap_or_else(|| h.symbol.trim().to_string());
                let cost_basis = h
                    .cost_basis
                    .as_deref()
                    .filter(|c| !c.trim().is_empty())
                    .map(parse_amount)
                    .transpose()?
                    .ok_or("Enter what you paid for each holding you add.")?;
                changes.push(HoldingChange::Add {
                    symbol: h.symbol.clone(),
                    name,
                    shares,
                    price,
                    cost_basis,
                });
            }
            "remove" => changes.push(HoldingChange::Remove {
                holding_id: h.holding_id.ok_or(STALE)?,
            }),
            "leave" => {}
            _ => return Err("Choose what to do with each holding.".into()),
        }
    }
    Ok(changes)
}

fn optional_amount(value: Option<&str>) -> Result<Option<Decimal>, String> {
    value.filter(|s| !s.trim().is_empty()).map(parse_amount).transpose()
}

pub fn finish_statement_reconciliation_for(
    state: &mut AppState,
    sessions: &Sessions,
    generation: u64,
    token: &str,
    d: FinishDecisionsDto,
) -> Result<StatementFinishedDto, String> {
    let result = sessions.with(token, generation, |session| {
        if state.store.reconcile_signature(session.account_id).map_err(|e| e.to_string())? != session.signature {
            return Err(STALE.into());
        }
        let sections = sections_of(session);
        let section = sections.get(session.section).ok_or(STALE)?;
        let checks = checks_of(session, section);

        // Every statement row: exactly one of matched, added or skipped.
        let mut seen = vec![0usize; section.rows.len()];
        for i in d
            .matches
            .iter()
            .map(|m| m.row)
            .chain(d.add.iter().map(|a| a.row))
            .chain(d.skip.iter().copied())
        {
            *seen.get_mut(i).ok_or(EVERY_LINE)? += 1;
        }
        if seen.iter().any(|n| *n != 1) {
            return Err(EVERY_LINE.into());
        }

        let (history, classifier) = build_classifier(state)?;
        let mut add = Vec::with_capacity(d.add.len());
        let mut add_principal = Vec::with_capacity(d.add.len());
        for a in &d.add {
            let description = a.description.trim();
            if description.is_empty() {
                return Err("Every transaction you add needs a description.".into());
            }
            let amount = parse_amount(&a.amount)?;
            // A principal part equal to the whole amount says nothing more (a charge such as a fee
            // counts in full anyway), so only a real split is passed on.
            add_principal.push(app_principal(session, &section.rows[a.row]).filter(|p| *p != amount));
            add.push(budget_core::models::Transaction {
                date: parse_date(&a.date)?,
                description: description.to_string(),
                amount,
                category: sure_category(state, &history, &classifier, description)?,
            });
        }
        if add_principal.iter().all(Option::is_none) {
            add_principal.clear();
        }

        let investment = session.kind == AccountKind::Investment;
        let holdings = holding_changes(state, session, section, &d.holdings)?;
        let holdings_readable = checks.holdings == CheckOutcome::Passed;
        if d.finish_without_holdings && holdings_readable {
            return Err("Your holdings were read correctly, so check their share counts before finishing.".into());
        }
        // Holdings that were read but don't add up (or can't be checked) are not compared with the app.
        let holdings_unchecked = matches!(checks.holdings, CheckOutcome::Failed { .. }) || (!holdings_readable && !section.holdings.is_empty());
        if investment && holdings_unchecked && !d.finish_without_holdings {
            return Err("The app couldn't read your holdings correctly. Teach it how to read them, or finish without checking holdings.".into());
        }
        let statement_shares = (investment && holdings_readable && !d.finish_without_holdings)
            .then(|| section.holdings.iter().map(|h| (h.symbol.clone(), h.shares)).collect());

        let layout = match (&d.save_layout, &session.layout) {
            (Some(save), Some(layout)) => {
                let learnable = matches!(session.source, Source::Pdf)
                    && !session.recognized
                    && (session.taught || no_failures(&checks))
                    && (section.unread.is_empty() || d.ignore_unread);
                if !learnable {
                    return Err("The app can't remember this statement yet, because some of it still couldn't be read.".into());
                }
                let mut l = if session.taught {
                    layout.clone()
                } else {
                    learn::narrow(layout, &session.lines, &sections, &session.period)
                };
                l.recognize = save.phrases.iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
                if l.recognize.is_empty() {
                    return Err("Choose at least one phrase from your statement so the app can recognise it.".into());
                }
                if !holdings_readable {
                    l.holdings = None;
                }
                // An accepted sign flip is remembered for this kind of account.
                if session.flip {
                    let signs = &mut l.signs;
                    let flag = match session.kind {
                        AccountKind::Cash => &mut signs.flip_cash,
                        AccountKind::Credit => &mut signs.flip_credit,
                        AccountKind::Loan => &mut signs.flip_loan,
                        AccountKind::Investment => &mut signs.flip_investment,
                    };
                    *flag = !*flag;
                }
                let existing = match &session.origin {
                    Some(LayoutOrigin::Learned { id }) => Some(*id),
                    _ => None,
                };
                Some((existing, save.name.clone(), l))
            }
            _ => None,
        };

        let finish = StatementFinish {
            account_id: session.account_id,
            period: session.period,
            statement_start: optional_amount(d.starting_balance.as_deref())?,
            statement_end: optional_amount(d.ending_balance.as_deref())?,
            ending_value: section.ending_value,
            source: match session.source {
                Source::Pdf => ReconcileSource::StatementPdf,
                Source::Download { .. } => ReconcileSource::StatementDownload,
            },
            matched: d.matches.iter().map(|m| m.transaction_id).collect(),
            add,
            add_principal,
            matched_principal: vec![],
            holdings,
            statement_shares,
            layout: layout.clone(),
        };
        let done = state
            .store
            .finish_statement_reconciliation(&finish, chrono::Local::now().naive_local())
            .map_err(|e| e.to_string())?;
        Ok(StatementFinishedDto {
            reconciliation_id: done.reconciliation_id,
            added: done.added,
            layout_saved: layout.map(|(_, name, _)| name.trim().to_string()),
        })
    });
    if result.is_ok() {
        sessions.clear();
    }
    result
}

fn list_statement_layouts_for(state: &AppState) -> Result<Vec<StatementLayoutDto>, String> {
    Ok(state
        .store
        .list_statement_layouts()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|l| StatementLayoutDto {
            id: l.id,
            name: l.name,
            phrases: l.layout.recognize,
            updated_at: l.updated_at,
        })
        .collect())
}

fn rename_statement_layout_for(state: &AppState, id: i64, name: &str) -> Result<(), String> {
    state
        .store
        .rename_statement_layout(id, name, chrono::Local::now().naive_local())
        .map_err(|e| e.to_string())
}

fn delete_statement_layout_for(state: &AppState, id: i64) -> Result<(), String> {
    state.store.delete_statement_layout(id).map_err(|e| e.to_string())
}

// ---------- Tauri wrappers ----------

// One argument per field the page sends, plus the managed state every command takes.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn read_statement(
    path: String,
    account_id: i64,
    period_start: String,
    period_end: String,
    generation: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    sessions: tauri::State<Sessions>,
) -> Result<StatementReadDto, String> {
    let mut state = state.lock()?;
    ensure_generation(&paths, generation)?;
    read_statement_for(
        &mut state,
        &sessions,
        generation,
        ReadStatementArgs {
            path,
            account_id,
            period_start,
            period_end,
        },
    )
}

#[tauri::command]
pub fn review_statement(
    token: String,
    section_index: usize,
    flip: bool,
    generation: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    sessions: tauri::State<Sessions>,
) -> Result<StatementReviewDto, String> {
    let mut state = state.lock()?;
    ensure_generation(&paths, generation)?;
    review_statement_for(&mut state, &sessions, generation, &token, section_index, flip)
}

#[tauri::command]
pub fn statement_lines(
    token: String,
    generation: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    sessions: tauri::State<Sessions>,
) -> Result<Vec<StatementLineDto>, String> {
    let _state = state.lock()?;
    ensure_generation(&paths, generation)?;
    statement_lines_for(&sessions, generation, &token)
}

#[tauri::command]
pub fn teach_statement_layout(
    token: String,
    marks: TeachMarks,
    generation: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    sessions: tauri::State<Sessions>,
) -> Result<StatementReviewDto, String> {
    let mut state = state.lock()?;
    ensure_generation(&paths, generation)?;
    teach_statement_layout_for(&mut state, &sessions, generation, &token, marks)
}

#[tauri::command]
pub fn finish_statement_reconciliation(
    token: String,
    decisions: FinishDecisionsDto,
    generation: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    sessions: tauri::State<Sessions>,
) -> Result<StatementFinishedDto, String> {
    let mut state = state.lock()?;
    ensure_generation(&paths, generation)?;
    finish_statement_reconciliation_for(&mut state, &sessions, generation, &token, decisions)
}

#[tauri::command]
pub fn cancel_statement_review(sessions: tauri::State<Sessions>) {
    sessions.clear();
}

#[tauri::command]
pub fn list_statement_layouts(state: tauri::State<AppStateHandle>) -> Result<Vec<StatementLayoutDto>, String> {
    let state = state.lock()?;
    list_statement_layouts_for(&state)
}

#[tauri::command]
pub fn rename_statement_layout(id: i64, name: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    rename_statement_layout_for(&state, id, &name)
}

#[tauri::command]
pub fn delete_statement_layout(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    delete_statement_layout_for(&state, id)
}
