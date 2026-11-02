//! Commands: reconciling an account by uploading its statement (PDF or a bank download), teaching the
//! app a statement it couldn't read, and managing the statements it has learned. See
//! docs/STATEMENT-RECONCILE.md.

use super::*;
use crate::statement_review::{new_token, Session, Source};
pub use crate::statement_review::{Sessions, STALE};
use budget_core::csv_loader::LoadResult;
use budget_core::import_resolution::{automatic, effective_panel_choices, row_facts, Automatic};
use budget_core::statement::checks::{check_section, CheckOutcome, SectionChecks};
use budget_core::statement::layout::{built_in_layouts, StatementLayout, GENERAL_ID, GENERAL_INVESTMENT_ID};
use budget_core::statement::learn::{self, TeachMarks};
use budget_core::statement::matching::{match_items, suggest_flip, to_app_amount, AccountKind, AppItem, StatementItem};
use budget_core::statement::pdf_text::{read_pdf_lines, MAX_STATEMENT_BYTES};
use budget_core::statement::select::{choose, read_with, recognizes, LayoutOrigin};
use budget_core::statement::{Period, StatementLine, StatementRow, StatementSection};
use budget_core::store::{HoldingChange, ReconcileSource, StatementFinish, StoredHolding};
use std::io::Read;

#[cfg(test)]
mod tests;

const PROFILE_CHANGED: &str = "The profile changed. Close this statement and start again in the current profile.";
const NO_SUCH_PART: &str = "That part of the statement doesn't exist. Read the statement again.";
const EVERY_LINE: &str = "Choose what to do with every line on your statement first.";
const CANNOT_OPEN: &str = "Could not open this statement. Check its location and access.";
const ONE_CHANGE: &str = "Choose one change for each holding.";

/// A database error in plain words. Statement reading and the checks before finishing only read, so
/// nothing was changed; the finish itself reports its own errors (see `StatementFinishError`).
fn db(_: budget_core::store::StoreError) -> String {
    "Something went wrong reading your data. Nothing was changed. Please try again.".into()
}

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
    /// Which part of the statement this review shows (0 when it has only one).
    pub section_index: usize,
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

#[cfg(test)]
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

fn parse_period(start: &str, end: &str) -> Result<Period, String> {
    Period::new(parse_date(start)?, parse_date(end)?).map_err(str::to_string)
}

/// A statement file, read and parsed. Done before the profile is locked, since a large PDF can take a
/// while and needs nothing from the profile.
pub enum LoadedStatement {
    Pdf(Vec<StatementLine>),
    Download(LoadResult),
}

pub fn load_statement_file(path: &str) -> Result<LoadedStatement, String> {
    let file = std::path::Path::new(path);
    if file.is_dir() {
        return Err("Choose one statement file, not a folder.".into());
    }
    if !file.is_file() {
        return Err("That file isn't there anymore. Choose your statement again.".into());
    }
    let extension = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "pdf" | "csv" | "ofx" | "qfx" | "qif") {
        return Err("Choose a PDF statement or your bank's CSV, OFX, QFX or QIF download.".into());
    }
    if std::fs::metadata(file).map(|m| m.len() > MAX_STATEMENT_BYTES as u64).unwrap_or(false) {
        return Err("This file is too large to be a monthly statement.".into());
    }
    if extension == "pdf" {
        let mut bytes = Vec::new();
        std::fs::File::open(file)
            .map_err(|_| CANNOT_OPEN)?
            .take(MAX_STATEMENT_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| CANNOT_OPEN)?;
        Ok(LoadedStatement::Pdf(read_pdf_lines(bytes).map_err(|e| e.to_string())?))
    } else {
        Ok(LoadedStatement::Download(
            budget_core::importer::load_transactions(file, false, None).map_err(|_| CANNOT_OPEN)?,
        ))
    }
}

/// Reads, then reviews: what the command does in two steps, reading before it takes the profile lock.
#[cfg(test)]
pub fn read_statement_for(state: &mut AppState, sessions: &Sessions, generation: u64, args: ReadStatementArgs) -> Result<StatementReadDto, String> {
    let period = parse_period(&args.period_start, &args.period_end)?;
    let loaded = load_statement_file(&args.path)?;
    review_loaded_statement(state, sessions, generation, args.account_id, period, loaded)
}

fn account_kind(state: &AppState, account_id: i64) -> Result<AccountKind, String> {
    state.store.account_kind(account_id).map_err(|e| match e {
        budget_core::store::StoreError::QueryReturnedNoRows => "That account isn't in the app anymore. Choose another account.".into(),
        other => db(other),
    })
}

pub fn review_loaded_statement(
    state: &mut AppState,
    sessions: &Sessions,
    generation: u64,
    account_id: i64,
    period: Period,
    loaded: LoadedStatement,
) -> Result<StatementReadDto, String> {
    let kind = account_kind(state, account_id)?;
    let mut session = Session {
        token: new_token()?,
        generation,
        created: std::time::Instant::now(),
        signature: state.store.reconcile_signature(account_id).map_err(db)?,
        account_id,
        kind,
        period,
        source: Source::Pdf,
        lines: vec![],
        download_rows: vec![],
        download_categories: vec![],
        download_dropped: 0,
        layout: None,
        origin: None,
        recognized: false,
        recognized_but_failed: false,
        taught: false,
        section: 0,
        flip: false,
    };

    match loaded {
        LoadedStatement::Pdf(lines) => {
            session.lines = lines;
            let learned: Vec<(i64, StatementLayout)> = state
                .store
                .list_statement_layouts()
                .map_err(db)?
                .into_iter()
                .map(|l| (l.id, l.layout))
                .collect();
            let reading = choose(&session.lines, &period, &learned, &built_in_layouts(), kind == AccountKind::Investment);
            session.recognized = reading.recognized;
            session.recognized_but_failed = reading.recognized_but_failed;
            session.origin = Some(reading.origin);
            session.layout = Some(reading.layout);
        }
        LoadedStatement::Download(loaded) => {
            let today = chrono::Local::now().date_naive();
            let flip = state
                .store
                .list_accounts(today)
                .map_err(db)?
                .into_iter()
                .find(|a| a.id == account_id)
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
                    session.download_categories.push(t.category.clone());
                } else {
                    session.download_dropped += 1;
                }
            }
        }
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

fn symbol_key(s: &str) -> String {
    s.trim().to_uppercase()
}

/// This account's holdings (every lot).
fn account_holdings(state: &AppState, account_id: i64) -> Result<Vec<StoredHolding>, String> {
    let today = chrono::Local::now().date_naive();
    Ok(state
        .store
        .list_holdings(today)
        .map_err(db)?
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
    let candidates = state.store.statement_candidates(session.account_id, period).map_err(db)?;
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
        state.store.reconcile_starting_point(session.account_id, period.end).map_err(db)?
    };
    let last = state.store.last_reconciliation(session.account_id).map_err(db)?;
    let today = chrono::Local::now().date_naive();
    let avoid: Vec<String> = state
        .store
        .list_accounts(today)
        .map_err(db)?
        .into_iter()
        .map(|a| a.account.name)
        .chain(state.store.list_family_members().map_err(db)?.into_iter().map(|m| m.name))
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
        section_index: session.section,
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

/// Shows another part of the statement, or the same part with its signs flipped. The review gets a new
/// token and a fresh 10 minutes (see `Session::renew`).
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
        // A failed rebuild leaves the session as the page still shows it.
        let (section, flipped) = (session.section, session.flip);
        session.section = section_index;
        session.flip = flip;
        let review = renewed_review(state, session);
        if review.is_err() {
            session.section = section;
            session.flip = flipped;
        }
        review
    })
}

fn renewed_review(state: &AppState, session: &mut Session) -> Result<StatementReviewDto, String> {
    let mut review = build_review(state, session)?;
    session.renew()?;
    review.token = session.token.clone();
    Ok(review)
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

/// Rereads the statement with what the person marked. The review gets a new token and a fresh 10
/// minutes, so teaching a few examples never runs the review out of time.
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
        // A failed rebuild leaves the session as the page still shows it.
        let before = (
            session.layout.clone(),
            session.origin.clone(),
            session.taught,
            session.recognized,
            session.section,
        );
        session.layout = Some(taught);
        session.origin = Some(origin);
        session.taught = true;
        session.recognized = false;
        if sections_of(session).len() <= session.section {
            session.section = 0;
        }
        let review = renewed_review(state, session);
        if review.is_err() {
            (session.layout, session.origin, session.taught, session.recognized, session.section) = before;
        }
        review
    })
}

/// What teaching starts from, and what saving it then updates: the learned (else built-in) layout that
/// recognizes this statement, so teaching a bank whose statement changed updates how the app reads it;
/// otherwise the general layout for this kind of account. Never the best guess from reading, which may
/// be another bank's layout with rules that don't apply here. Every call starts from the same base, so
/// the marks sent each time are all the examples the person has marked so far.
fn teaching_base(state: &AppState, session: &Session) -> Result<(StatementLayout, LayoutOrigin), String> {
    let learned = state.store.list_statement_layouts().map_err(db)?;
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

/// The category for each row to add, decided the way an import decides it without asking: the
/// download's own category when it is one of the person's; else what the person said that file
/// category means last time (the import category memory); else a sure rule or auto-categorizer answer.
/// Only ever one of the person's own categories, so adding rows never adds a category.
fn categories_for(state: &AppState, rows: &[budget_core::models::Transaction]) -> Result<Vec<Option<String>>, String> {
    let (history, classifier) = build_classifier(state)?;
    let facts = row_facts(&state.store, rows, &state.rules, &history, Some(&classifier)).map_err(db)?;
    let remembered = state.store.import_category_mappings().map_err(db)?;
    let panel = effective_panel_choices(&std::collections::HashMap::new(), &remembered).map_err(|e| e.to_string())?;
    facts
        .iter()
        .map(|f| match automatic(f, &panel) {
            Some(Automatic::File(name)) => state.store.find_category(&name).map_err(db),
            Some(Automatic::Guess(s)) => state.store.find_category(&s.category).map_err(db),
            None => Ok(None),
        })
        .collect()
}

/// The holdings changes the person chose, at most one per symbol. An update sets the symbol's total
/// across every lot the app holds, because the statement check compares totals: a rise goes on the
/// chosen lot; a fall comes off the chosen lot first, then the others, none below zero.
fn holding_changes(app: &[StoredHolding], section: &StatementSection, decisions: &[HoldingDecision]) -> Result<Vec<HoldingChange>, String> {
    const SHARES: &str = "Enter the share count.";
    let mut decided = std::collections::HashSet::new();
    let mut changes = Vec::new();
    for h in decisions {
        if matches!(h.action.as_str(), "update" | "add") && !decided.insert(symbol_key(&h.symbol)) {
            return Err(ONE_CHANGE.into());
        }
        let shares = h.shares.as_deref().filter(|s| !s.trim().is_empty()).map(parse_amount).transpose()?;
        let on_statement = section.holdings.iter().find(|s| symbol_key(&s.symbol) == symbol_key(&h.symbol));
        match h.action.as_str() {
            "update" => {
                let id = h.holding_id.ok_or(STALE)?;
                let chosen = app.iter().find(|a| a.id == id).ok_or(STALE)?;
                if symbol_key(&chosen.symbol) != symbol_key(&h.symbol) {
                    return Err(STALE.into());
                }
                let target = shares.or(on_statement.map(|s| s.shares)).ok_or(SHARES)?;
                if target < Decimal::ZERO {
                    return Err("A share count can't be below zero.".into());
                }
                // The chosen lot first, then the symbol's other lots in the order they were added.
                let lots: Vec<&StoredHolding> = std::iter::once(chosen)
                    .chain(app.iter().filter(|a| a.id != id && symbol_key(&a.symbol) == symbol_key(&chosen.symbol)))
                    .collect();
                let held: Decimal = lots.iter().map(|a| a.shares).sum();
                if target >= held {
                    changes.push(HoldingChange::SetShares {
                        holding_id: id,
                        shares: chosen.shares + (target - held),
                    });
                } else {
                    let mut excess = held - target;
                    for lot in lots {
                        if excess <= Decimal::ZERO {
                            break;
                        }
                        let cut = lot.shares.min(excess);
                        if cut > Decimal::ZERO {
                            changes.push(HoldingChange::SetShares {
                                holding_id: lot.id,
                                shares: lot.shares - cut,
                            });
                            excess -= cut;
                        }
                    }
                }
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

/// A loan row's principal part to pass on with `amount` (in the app's sign): only a real split. A
/// principal part equal to the whole amount says nothing more (a charge such as a fee counts in full
/// anyway).
fn principal_to_pass(session: &Session, row: &StatementRow, amount: Decimal) -> Option<Decimal> {
    // Only a payment toward the loan can have a principal part; a fee or interest charge can't.
    app_principal(session, row).filter(|p| *p != amount && amount > Decimal::ZERO)
}

fn none_if_all_none(parts: Vec<Option<Decimal>>) -> Vec<Option<Decimal>> {
    if parts.iter().all(Option::is_none) {
        vec![]
    } else {
        parts
    }
}

pub fn finish_statement_reconciliation_for(
    state: &mut AppState,
    sessions: &Sessions,
    generation: u64,
    token: &str,
    d: FinishDecisionsDto,
) -> Result<StatementFinishedDto, String> {
    let result = sessions.with(token, generation, |session| {
        if state.store.reconcile_signature(session.account_id).map_err(db)? != session.signature {
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

        // A match pairs a statement line with an app transaction of exactly the same amount.
        let candidates = state.store.statement_candidates(session.account_id, &session.period).map_err(db)?;
        let mut matched_principal = Vec::with_capacity(d.matches.len());
        for m in &d.matches {
            let row = &section.rows[m.row];
            let amount = to_app(session, row.amount);
            let candidate = candidates.iter().find(|c| c.id == m.transaction_id).ok_or(STALE)?;
            if candidate.amount != amount {
                return Err("A transaction you matched has a different amount from its line on your statement. Choose its match again.".into());
            }
            matched_principal.push(principal_to_pass(session, row, amount));
        }

        let mut add = Vec::with_capacity(d.add.len());
        let mut add_principal = Vec::with_capacity(d.add.len());
        for a in &d.add {
            let description = a.description.trim();
            if description.is_empty() {
                return Err("Every transaction you add needs a description.".into());
            }
            // The date and amount come from the statement line held here, never from the page; the
            // page's copy must agree with it (it won't when the page is out of step, for example after
            // a failed flip).
            let row = &section.rows[a.row];
            let amount = to_app(session, row.amount);
            if parse_amount(&a.amount)? != amount || parse_date(&a.date)? != row.date {
                return Err(STALE.into());
            }
            add_principal.push(principal_to_pass(session, row, amount));
            add.push(budget_core::models::Transaction {
                date: row.date,
                description: description.to_string(),
                amount,
                // The download's own category, read by `categories_for` below.
                category: match session.source {
                    Source::Download { .. } => session.download_categories.get(a.row).cloned().flatten(),
                    Source::Pdf => None,
                },
            });
        }
        let categories = categories_for(state, &add)?;
        for (tx, category) in add.iter_mut().zip(categories) {
            tx.category = category;
        }

        let investment = session.kind == AccountKind::Investment;
        let app_holdings = if investment {
            account_holdings(state, session.account_id)?
        } else {
            vec![]
        };
        let holdings = holding_changes(&app_holdings, section, &d.holdings)?;
        let holdings_readable = checks.holdings == CheckOutcome::Passed;
        if d.finish_without_holdings && holdings_readable {
            return Err("Your holdings were read correctly, so check their share counts before finishing.".into());
        }
        // Share counts are compared only when the statement's holdings were read and add up. Otherwise
        // the person says so by finishing without checking them, unless there are none to check: the
        // statement lists none (and prints no holdings total) and neither does the app.
        let nothing_to_check = section.holdings.is_empty() && section.holdings_total.is_none() && app_holdings.is_empty();
        if investment && !holdings_readable && !d.finish_without_holdings && !nothing_to_check {
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
                    return Err("Choose at least one phrase from your statement so the app can recognize it.".into());
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
            add_principal: none_if_all_none(add_principal),
            matched_principal: none_if_all_none(matched_principal),
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

/// Ends the review `token` belongs to.
fn cancel_statement_review_for(paths: &crate::config::AppPaths, sessions: &Sessions, generation: u64, token: &str) -> Result<(), String> {
    ensure_generation(paths, generation)?;
    sessions.cancel(token);
    Ok(())
}

fn list_statement_layouts_for(state: &AppState, paths: &crate::config::AppPaths, generation: u64) -> Result<Vec<StatementLayoutDto>, String> {
    ensure_generation(paths, generation)?;
    Ok(state
        .store
        .list_statement_layouts()
        .map_err(db)?
        .into_iter()
        .map(|l| StatementLayoutDto {
            id: l.id,
            name: l.name,
            phrases: l.layout.recognize,
            updated_at: l.updated_at,
        })
        .collect())
}

fn rename_statement_layout_for(state: &AppState, paths: &crate::config::AppPaths, generation: u64, id: i64, name: &str) -> Result<(), String> {
    ensure_generation(paths, generation)?;
    state
        .store
        .rename_statement_layout(id, name, chrono::Local::now().naive_local())
        .map_err(|e| e.to_string())
}

fn delete_statement_layout_for(state: &AppState, paths: &crate::config::AppPaths, generation: u64, id: i64) -> Result<(), String> {
    ensure_generation(paths, generation)?;
    state
        .store
        .delete_statement_layout(id)
        .map_err(|_| "Something went wrong removing this. Nothing was changed. Please try again.".to_string())
}

// ---------- Tauri wrappers ----------

/// Reads and parses the file before taking the profile lock (a large PDF takes a while and needs
/// nothing from the profile), then reviews it under the lock.
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
    ensure_generation(&paths, generation)?;
    let period = parse_period(&period_start, &period_end)?;
    let loaded = load_statement_file(&path)?;
    let mut state = state.lock()?;
    ensure_generation(&paths, generation)?;
    review_loaded_statement(&mut state, &sessions, generation, account_id, period, loaded)
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
pub fn cancel_statement_review(
    token: String,
    generation: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    sessions: tauri::State<Sessions>,
) -> Result<(), String> {
    let _state = state.lock()?;
    cancel_statement_review_for(&paths, &sessions, generation, &token)
}

#[tauri::command]
pub fn list_statement_layouts(
    generation: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
) -> Result<Vec<StatementLayoutDto>, String> {
    let state = state.lock()?;
    list_statement_layouts_for(&state, &paths, generation)
}

#[tauri::command]
pub fn rename_statement_layout(
    id: i64,
    name: String,
    generation: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
) -> Result<(), String> {
    let state = state.lock()?;
    rename_statement_layout_for(&state, &paths, generation, id, &name)
}

#[tauri::command]
pub fn delete_statement_layout(
    id: i64,
    generation: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
) -> Result<(), String> {
    let state = state.lock()?;
    delete_statement_layout_for(&state, &paths, generation, id)
}
