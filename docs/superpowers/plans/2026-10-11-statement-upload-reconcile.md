# Statement Upload Reconciling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person reconcile any account by uploading its monthly statement (PDF, or a CSV/OFX/QFX/QIF download), with a reader that learns statement layouts it has never seen, a shared "pick up from last time" balance rule for manual and statement reconciling, and an activity-plus-share-count reconciliation for investment accounts.

**Architecture:** A new pure module `core/src/statement/` turns PDF text (read in content order through one small adapter) into sections, rows, balances and holdings, driven entirely by `StatementLayout` data (built-in JSON plus learned layouts stored per profile). Pure matching pairs statement rows with the account's unsettled transactions. A new `core/src/store/reconcile.rs` owns the shared balance rule and the one-transaction statement finish. Tauri commands hold one short-lived, profile-generation-bound review session (`src-tauri/src/statement_review.rs`), and a React owner hook plus two dialogs drive upload → (section choice) → review / teach → finish.

**Tech Stack:** Rust 2024 (`budget_core`, rusqlite/SQLCipher, rust_decimal, chrono, serde_json), `pdf_oxide` 0.3.x (MIT OR Apache-2.0) behind an adapter, Tauri v2 commands, React 19 + TypeScript + Vite, vitest (jsdom, `createRoot` + `act`, no Testing Library), WebdriverIO E2E through `e2e/run-all.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-11-statement-upload-reconcile-design.md` (read it before starting; this plan argues from it).

## Execution Method (chosen by the owner, 2026-10-11)

Hybrid. Not started yet; use this split when the owner says to begin.

- **Subagent-driven** (`superpowers:subagent-driven-development`: an implementer subagent, then a reviewer subagent, per task) for the tasks that write or decide financial data: **1, 2, 15, 16, 17, 18, 19, 20, 21**.
- **Native** (`superpowers:executing-plans`, in the main session) for **3–14 and 22–25**. Tasks 8 and 13 stay native so the owner's real statements are never sent to extra agents.
- After Task 25: one fresh reviewer checks the whole branch before any merge.
- Check in with the owner before Task 13 (each statement's period, for `periods.txt`) and at the end (full gate, branch review, UAT page). No push, merge or release without the owner's say-so.

## Global Constraints

- Work in a git worktree on a new branch `feature/statement-reconcile` cut from `release-1.3.1` (`superpowers:using-git-worktrees`). Another session edits the main checkout; never commit its files.
- Use **PowerShell, not Git Bash, for cargo and npx builds** (Git Bash's perl breaks the vendored OpenSSL build). Node **22.19+**.
- Build order before any E2E run: `cargo build --workspace --bins`, then `npx tauri build --debug --no-bundle` **last**; retry once if it prints "failed to build app" and check for `Built application at:`.
- E2E: only `node e2e/run-all.mjs` (`--spec=<numbers>` for targeted runs), never a sequential loop. Capture full output to a file.
- Component tests use `react-dom/client` `createRoot` + `act()`; **no `@testing-library/react`**. `MenuSelect` is the only single-select; no native `<select>`.
- On-screen copy is for people new to money terms: never "tracked", "published", "convention" (guard: `src/plainLanguage.test.ts`); also never show "layout", "parse", "cleared" or "unmatched" — say "how to read this bank's statements", "ticked", "on your statement".
- Tauri command modules are re-exported with a **glob** (`pub use self::statements::*;`); a named re-export drops Tauri's hidden `__cmd__` macros.
- Schema changes are additive only (`CREATE TABLE IF NOT EXISTS`, `migrate_*_if_missing`).
- Limits (verbatim from spec): files over **20 MB** or PDFs over **200 pages** are refused; a layout document is at most **16 KiB**; a review token expires after **10 minutes**; matching leeway **7 days** around the period; automatic match **within 3 days**; possible match **4–10 days**; teaching asks for **up to three** examples per kind.
- An amount is only ever matched when it is **exactly** equal; a difference of one cent is never matched.
- Statement files are read locally and never copied, cached to disk or logged. The owner's real statements in `E:\misc\Programming\Claude\Statements` are **never** committed or quoted; anything that reads them prints counts only.
- Layout recognition phrases and every layout label must pass `is_safe_phrase` (no run of 4+ digits, no `@`, fewer than 7 digits in total).
- No `regex` crate in `core` (layouts are a closed option set; tokenizing is hand-written).
- Fixture dates in E2E specs must be relative (`e2e/lib/dates.mjs`; a guard test rejects hard-coded dates). Core unit tests may use fixed dates.
- Source files are CRLF in the working tree (`core.autocrlf` on). If a build rewrites `src-tauri/Cargo.toml` with only line-ending changes, restore it with `git checkout -- src-tauri/Cargo.toml` and never stage it.
- Commit after every task with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push without the owner's say-so.

## Review Focus

1. **The person types the wrong period** (e.g. the month before the statement): every row falls outside the window. Expect the plain "No transactions were found between {start} and {end}. Check the dates, or make sure this is the statement for {account}." message at the top of the review, with Finish unavailable (the difference can't be $0.00 with no rows) and the Teach/download/by-hand options offered (an unknown bank whose dates were misread looks the same). Tests: Task 19, `read_statement_with_the_wrong_period_says_no_transactions_were_found`; Task 21, `says plainly when nothing on the statement falls in the dates entered`.
2. **Two identical transactions** (two $4.50 coffees on one day, both in the app and both on the statement): expect both matched one-to-one, not two "possible match" rows forever. Test: Task 16, `identical_twins_match_one_to_one_instead_of_staying_possible`.
3. **A stored layout that no longer validates** (schema bump, damaged row): reading a statement must skip it and carry on with the others. Test: Task 17, `a_stored_layout_that_fails_validation_is_skipped_not_fatal`.
4. **Uploading a period that is already reconciled** (same statement twice, or an older month): settled rows are not candidates, so everything would look missing and "Add" would create duplicates. Expect a warning ("You already reconciled this account through {date}…") and no pre-selected Add. Test: Task 19, `an_already_reconciled_period_is_flagged`.
5. **A month with no activity** (savings section with only starting and ending balance): expect the section to read, its check to pass with zero rows, and finishing to work when start = end. Test: Task 10, `a_section_with_no_rows_still_checks_and_reads`.

---

## File Structure

**Core (`core/`)**
- `src/statement/mod.rs` — module root and re-exports.
- `src/statement/model.rs` — `StatementLine`, `Period`, `StatementRow`, `UnreadLine`, `StatementHolding`, `StatementSection`.
- `src/statement/text.rs` — label matching that ignores case and whitespace (`squash`, `starts_with_label`, `contains_label`).
- `src/statement/layout.rs` — `StatementLayout` model, strict validation, JSON, `is_safe_phrase`, built-in loading.
- `src/statement/tokens.rs` — dates (with year inference) and money/number recognition.
- `src/statement/fixture_pdf.rs` — tiny PDF writer plus fictional fixture statements (shared by tests, the fixture generator example and E2E).
- `src/statement/pdf_text.rs` — the only file that touches the PDF library: bytes → `Vec<StatementLine>` in content order.
- `src/statement/rows.rs` — groups lines into rows.
- `src/statement/sections.rs` — sections, balance/total labels, skipped sections, holdings hand-off; `read_statement`.
- `src/statement/holdings.rs` — holdings entries.
- `src/statement/checks.rs` — activity, holdings and running-balance checks.
- `src/statement/select.rs` — recognition and best-of layout choice.
- `src/statement/learn.rs` — automatic narrowing, phrase suggestions, teaching from marks, merging.
- `src/statement/matching.rs` — sign conversion, one-to-one matching, flip suggestion.
- `data/statement_layouts/*.json` — built-in layouts: `general`, `general-investment`, `amex`, `chase-card`, `capital-one`, `credit-union`, `mortgage`, `lpl`.
- `src/store/reconcile.rs` — balance rule, manual finish, candidates for matching, atomic statement finish.
- `src/store/statement_layouts.rs` — learned layout storage.
- `src/store/schema.rs` — new table, columns, backfill.
- `examples/statement_fixtures.rs` — writes fixture PDFs for E2E.
- `examples/real_statement_check.rs` — local-only count report over the owner's statements.
- Tests: `src/store/tests/reconcile.rs`, `src/store/tests/statement_layouts.rs`, plus `#[cfg(test)] mod tests` inside each `statement/*.rs`.

**Tauri (`src-tauri/`)**
- `src/statement_review.rs` — the one review session (profile generation, token, 10-minute expiry).
- `src/commands/statements.rs` (+ `src/commands/statements/tests.rs`) — statement commands.
- `src/commands/accounts.rs` — reworked manual reconcile commands.
- `src/commands.rs`, `src/lib.rs` — registration.

**Frontend (`src/`)**
- `statementContracts.ts` (+ test) — types and runtime validation of every statement response.
- `reconcileMath.ts` (+ test) — exact decimal arithmetic for the on-screen difference.
- `useStatementReconcile.ts` (+ test) — owner hook for the upload flow.
- `StatementReviewDialog.tsx` (+ test), `StatementTeachDialog.tsx` (+ test), `StatementLayoutsSection.tsx` (+ test), `StatementReconcile.css`.
- `AccountDetailView.tsx` (+ test) — manual rework and the upload entry point.
- `SettingsView.tsx`, `HelpView.tsx` — Settings section, help text.

**E2E (`e2e/`)**
- `feature80_reconciliation.mjs` (update), `feature300_statement_upload.mjs`, `feature301_statement_teach.mjs`, `feature302_statement_investment.mjs`, `lib/statementFixtures.mjs`.

**Docs**
- `docs/STATEMENT-RECONCILE.md`, link from `docs/ARCHITECTURE.md`.

---

## Phase A — Shared reconciliation rule

### Task 1: Schema for settled transactions, richer records and learned layouts

**Files:**
- Modify: `core/src/store/schema.rs` (CREATE batch; migration list after `migrate_add_notes_to_transactions_if_missing`; index block)
- Test: `core/src/store/tests/schema.rs`

**Interfaces:**
- Produces: column `transactions.reconciliation_id INTEGER NULL`; columns `reconciliations.period_start TEXT`, `starting_balance TEXT`, `source TEXT`, `holdings_checked INTEGER` (all nullable); table `statement_layouts(id, name, layout, created_at, updated_at)`; `Store::link_existing_reconciliations(&self) -> rusqlite::Result<()>`; private `Store::table_has_column(&self, table: &str, column: &str) -> rusqlite::Result<bool>`.

- [ ] **Step 1: Write the failing tests** (append to `core/src/store/tests/schema.rs`)

```rust
#[test]
fn a_fresh_store_has_the_reconciliation_link_columns_and_layout_table() {
    let store = Store::open_in_memory().unwrap();
    assert!(store.table_has_column("transactions", "reconciliation_id").unwrap());
    for column in ["period_start", "starting_balance", "source", "holdings_checked"] {
        assert!(store.table_has_column("reconciliations", column).unwrap(), "{column}");
    }
    let count: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM statement_layouts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn existing_reconciliations_settle_the_ticked_rows_dated_on_or_before_them() {
    let store = Store::open_in_memory().unwrap();
    let acct = store.get_or_create_account("Old Checking", AccountType::Checking).unwrap();
    store
        .save_transactions(
            acct,
            &[tx("2026-07-10", "July rent", "-900.00"), tx("2026-08-10", "August rent", "-900.00"), tx("2026-08-12", "Unticked", "-5.00")],
        )
        .unwrap();
    let july = id_of(&store, "July rent", "2026-07-10");
    let august = id_of(&store, "August rent", "2026-08-10");
    let unticked = id_of(&store, "Unticked", "2026-08-12");
    store.set_transactions_cleared(&[july, august], true).unwrap();
    store
        .conn
        .execute_batch(&format!(
            "INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES ({acct}, '2026-07-31', '100.00', '2026-08-01 09:00:00');
             INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES ({acct}, '2026-08-31', '-800.00', '2026-09-01 09:00:00');"
        ))
        .unwrap();

    store.link_existing_reconciliations().unwrap();

    let link = |id: i64| -> Option<i64> {
        store
            .conn
            .query_row("SELECT reconciliation_id FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
            .unwrap()
    };
    let first: i64 = store.conn.query_row("SELECT MIN(id) FROM reconciliations", [], |r| r.get(0)).unwrap();
    assert_eq!(link(july), Some(first), "July's tick belongs to the July reconciliation");
    assert_eq!(link(august), Some(first + 1), "August's tick belongs to the August one");
    assert_eq!(link(unticked), None, "an unticked row is never settled");

    // Running it again changes nothing.
    store.link_existing_reconciliations().unwrap();
    assert_eq!(link(july), Some(first));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (PowerShell): `cargo test -p budget_core --lib store::tests::schema -- --nocapture`
Expected: compile errors `no method named table_has_column` / `link_existing_reconciliations`.

- [ ] **Step 3: Implement**

In the big `execute_batch` CREATE list (after `profile_ui_state`), add:

```sql
            CREATE TABLE IF NOT EXISTS statement_layouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                layout TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
```

After `self.migrate_add_notes_to_transactions_if_missing()?;` add `self.migrate_add_reconciliation_links_if_missing()?;`, and add to the index `execute_batch`:

```sql
             CREATE INDEX IF NOT EXISTS idx_transactions_account_reconciliation ON transactions(account_id, reconciliation_id) WHERE deleted_at IS NULL;
```

Add to `impl Store` in `schema.rs`:

```rust
    /// Whether `table` already has `column` — the check every additive migration makes.
    pub(crate) fn table_has_column(&self, table: &str, column: &str) -> rusqlite::Result<bool> {
        let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let names = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(names.iter().any(|name| name == column))
    }

    /// `reconciliation_id` records which finished reconciliation settled a ticked transaction, so the
    /// next reconciliation picks up from the last one's ending balance (see `store/reconcile.rs`). The
    /// richer `reconciliations` columns describe how each one was done. All nullable: rows written before
    /// this keep working.
    fn migrate_add_reconciliation_links_if_missing(&self) -> rusqlite::Result<()> {
        if !self.table_has_column("transactions", "reconciliation_id")? {
            self.conn.execute("ALTER TABLE transactions ADD COLUMN reconciliation_id INTEGER", [])?;
            self.link_existing_reconciliations()?;
        }
        for (column, ddl) in [
            ("period_start", "ALTER TABLE reconciliations ADD COLUMN period_start TEXT"),
            ("starting_balance", "ALTER TABLE reconciliations ADD COLUMN starting_balance TEXT"),
            ("source", "ALTER TABLE reconciliations ADD COLUMN source TEXT"),
            ("holdings_checked", "ALTER TABLE reconciliations ADD COLUMN holdings_checked INTEGER"),
        ] {
            if !self.table_has_column("reconciliations", column)? {
                self.conn.execute(ddl, [])?;
            }
        }
        Ok(())
    }

    /// Before `reconciliation_id` existed, a finished reconciliation settled every ticked transaction
    /// dated on or before its statement date. Links each such row to the earliest reconciliation that
    /// covers it; rows already linked are left alone, so running it twice changes nothing.
    pub(crate) fn link_existing_reconciliations(&self) -> rusqlite::Result<()> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, account_id, statement_date FROM reconciliations ORDER BY statement_date, id")?;
        let recs = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        for (id, account_id, date) in recs {
            self.conn.execute(
                "UPDATE transactions SET reconciliation_id = ?1
                 WHERE account_id = ?2 AND cleared = 1 AND reconciliation_id IS NULL AND date <= ?3",
                params![id, account_id, date],
            )?;
        }
        Ok(())
    }
```

Make sure `params` is imported in `schema.rs` (`use rusqlite::params;` if not already).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p budget_core --lib store::tests::schema`
Expected: PASS (all schema tests, including the existing index test).

- [ ] **Step 5: Commit**

```bash
git add core/src/store/schema.rs core/src/store/tests/schema.rs
git commit -m "Add reconciliation links, richer reconciliation records and the statement layout table"
```

---

### Task 2: The shared "pick up from last time" balance rule

**Files:**
- Create: `core/src/store/reconcile.rs`
- Modify: `core/src/store.rs` (add `mod reconcile; pub use reconcile::*;` next to the other feature modules), `core/src/store/accounts.rs` (remove `ReconciliationStatus`, `reconciliation_status`, `finish_reconciliation`; change `reconcile_candidates`)
- Create test: `core/src/store/tests/reconcile.rs`; modify `core/src/store/tests.rs` (`mod reconcile;`), `core/src/store/tests/accounts.rs` (delete the five old balance tests, keep `reconcilable`, `last_reconciliation` and candidate tests updated as shown)

**Interfaces:**
- Produces:
  - `pub enum AccountKind { Cash, Credit, Loan, Investment }` with `AccountKind::of(AccountType) -> AccountKind` (Checking/Savings/Other → Cash), defined here in `core/src/store/reconcile.rs`; Task 16 re-exports it from `core/src/statement/matching.rs` (`pub use crate::store::AccountKind;`).
  - `pub fn balance_change(kind: AccountKind, amount: Decimal, principal: Option<Decimal>) -> Decimal`
  - `pub enum ReconcileSource { Manual, StatementPdf, StatementDownload }` with `fn as_str(self) -> &'static str` (`"manual"`, `"statement_pdf"`, `"statement_download"`).
  - `pub struct ReconcileStatus { pub starting_point: Option<Decimal>, pub needs_starting_balance: bool, pub ticked_change: Decimal, pub ticked_count: usize, pub difference: Option<Decimal> }`
  - `pub struct FinishReconciliation { pub account_id: i64, pub period_start: Option<NaiveDate>, pub statement_date: NaiveDate, pub statement_start: Option<Decimal>, pub statement_end: Decimal, pub source: ReconcileSource }`
  - `Store::account_kind(&self, account_id: i64) -> rusqlite::Result<AccountKind>`
  - `Store::reconcile_status(&self, account_id: i64, statement_start: Option<Decimal>, statement_end: Decimal) -> rusqlite::Result<ReconcileStatus>`
  - `Store::finish_reconciliation(&self, req: &FinishReconciliation, now: NaiveDateTime) -> rusqlite::Result<Option<i64>>` (`None` = didn't balance, nothing written)
  - `Store::reconcile_candidates(&self, account_id, statement_date)` keeps its signature; settled now means `reconciliation_id IS NOT NULL`.

- [ ] **Step 1: Write the failing tests** — create `core/src/store/tests/reconcile.rs`:

```rust
use super::*;
use crate::store::{FinishReconciliation, ReconcileSource};

fn finish(store: &Store, acct: i64, date: &str, start: Option<&str>, end: &str) -> Option<i64> {
    store
        .finish_reconciliation(
            &FinishReconciliation {
                account_id: acct,
                period_start: None,
                statement_date: day(date),
                statement_start: start.map(dec),
                statement_end: dec(end),
                source: ReconcileSource::Manual,
            },
            test_now(),
        )
        .unwrap()
}

/// A checking account with +200 (07-15), -50 (08-10), -30 (09-05).
fn checking(store: &Store) -> (i64, [i64; 3]) {
    let acct = store.get_or_create_account("Statement Checking", AccountType::Checking).unwrap();
    store
        .save_transactions(acct, &[tx("2026-07-15", "Deposit", "200.00"), tx("2026-08-10", "Coffee", "-50.00"), tx("2026-09-05", "Gas", "-30.00")])
        .unwrap();
    (acct, [id_of(store, "Deposit", "2026-07-15"), id_of(store, "Coffee", "2026-08-10"), id_of(store, "Gas", "2026-09-05")])
}

#[test]
fn the_first_reconciliation_starts_from_the_statements_starting_balance() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, _]) = checking(&store);
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();

    let without = store.reconcile_status(acct, None, dec("1150.00")).unwrap();
    assert!(without.needs_starting_balance);
    assert_eq!(without.difference, None, "no starting point yet, so no difference");

    let with = store.reconcile_status(acct, Some(dec("1000.00")), dec("1150.00")).unwrap();
    assert_eq!(with.starting_point, Some(dec("1000.00")));
    assert_eq!(with.ticked_change, dec("150.00"));
    assert_eq!(with.ticked_count, 2);
    assert_eq!(with.difference, Some(Decimal::ZERO));
}

#[test]
fn later_reconciliations_pick_up_from_the_last_ending_balance_and_ignore_a_typed_start() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
    assert!(finish(&store, acct, "2026-08-31", Some("1000.00"), "1150.00").is_some());

    store.set_transactions_cleared(&[gas], true).unwrap();
    let status = store.reconcile_status(acct, Some(dec("9999.00")), dec("1120.00")).unwrap();
    assert!(!status.needs_starting_balance);
    assert_eq!(status.starting_point, Some(dec("1150.00")));
    assert_eq!(status.ticked_change, dec("-30.00"), "only what the last reconciliation didn't settle");
    assert_eq!(status.difference, Some(Decimal::ZERO));
}

#[test]
fn a_late_item_dated_before_the_last_statement_still_counts_once() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, _]) = checking(&store);
    store.set_transactions_cleared(&[deposit], true).unwrap();
    assert!(finish(&store, acct, "2026-08-31", Some("1000.00"), "1200.00").is_some());

    // Coffee (08-10) only showed up on September's statement.
    store.set_transactions_cleared(&[coffee], true).unwrap();
    let status = store.reconcile_status(acct, None, dec("1150.00")).unwrap();
    assert_eq!(status.difference, Some(Decimal::ZERO));
}

#[test]
fn finishing_refuses_a_nonzero_difference_and_writes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, _, _]) = checking(&store);
    store.set_transactions_cleared(&[deposit], true).unwrap();

    assert_eq!(finish(&store, acct, "2026-08-31", Some("1000.00"), "1150.00"), None);
    assert_eq!(store.last_reconciliation(acct).unwrap(), None);
    let linked: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM transactions WHERE reconciliation_id IS NOT NULL", [], |r| r.get(0))
        .unwrap();
    assert_eq!(linked, 0);
}

#[test]
fn finishing_records_the_details_and_settles_the_ticked_rows() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
    let id = store
        .finish_reconciliation(
            &FinishReconciliation {
                account_id: acct,
                period_start: Some(day("2026-07-01")),
                statement_date: day("2026-08-31"),
                statement_start: Some(dec("1000.00")),
                statement_end: dec("1150.00"),
                source: ReconcileSource::Manual,
            },
            test_now(),
        )
        .unwrap()
        .expect("balances");

    let (period_start, starting, source): (Option<String>, Option<String>, Option<String>) = store
        .conn
        .query_row("SELECT period_start, starting_balance, source FROM reconciliations WHERE id = ?1", params![id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap();
    assert_eq!((period_start.as_deref(), starting.as_deref(), source.as_deref()), (Some("2026-07-01"), Some("1000.00"), Some("manual")));
    let settled = |tid: i64| -> Option<i64> {
        store.conn.query_row("SELECT reconciliation_id FROM transactions WHERE id = ?1", params![tid], |r| r.get(0)).unwrap()
    };
    assert_eq!((settled(deposit), settled(coffee), settled(gas)), (Some(id), Some(id), None));
}

#[test]
fn a_credit_card_reconciles_on_what_is_owed() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Card", AccountType::Credit).unwrap();
    // A card added while it already owed $300: the app's limit-based balance never matters here.
    store
        .save_transactions(card, &[tx("2026-08-03", "Groceries", "-80.00"), tx("2026-08-20", "Payment", "300.00")])
        .unwrap();
    let ids = [id_of(&store, "Groceries", "2026-08-03"), id_of(&store, "Payment", "2026-08-20")];
    store.set_transactions_cleared(&ids, true).unwrap();

    let status = store.reconcile_status(card, Some(dec("300.00")), dec("80.00")).unwrap();
    assert_eq!(status.ticked_change, dec("-220.00"), "a charge raises what is owed; a payment lowers it");
    assert_eq!(status.difference, Some(Decimal::ZERO));
}

#[test]
fn a_loan_reconciles_on_outstanding_principal() {
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    store.save_transactions(loan, &[tx("2026-09-01", "Payment", "2405.94")]).unwrap();
    let payment = id_of(&store, "Payment", "2026-09-01");
    store
        .conn
        .execute("UPDATE transactions SET principal_amount = '355.17' WHERE id = ?1", params![payment])
        .unwrap();
    store.set_transactions_cleared(&[payment], true).unwrap();

    let status = store.reconcile_status(loan, Some(dec("317195.46")), dec("316840.29")).unwrap();
    assert_eq!(status.ticked_change, dec("-355.17"));
    assert_eq!(status.difference, Some(Decimal::ZERO));
}

#[test]
fn balance_change_follows_each_account_kind() {
    use crate::store::{balance_change, AccountKind};
    assert_eq!(balance_change(AccountKind::Cash, dec("-5"), None), dec("-5"));
    assert_eq!(balance_change(AccountKind::Investment, dec("12"), None), dec("12"));
    assert_eq!(balance_change(AccountKind::Credit, dec("-5"), None), dec("5"));
    assert_eq!(balance_change(AccountKind::Loan, dec("100"), Some(dec("40"))), dec("-40"));
    assert_eq!(balance_change(AccountKind::Loan, dec("100"), None), dec("-100"));
}

#[test]
fn candidates_drop_rows_settled_by_any_reconciliation_even_late_ones() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
    finish(&store, acct, "2026-08-31", Some("1000.00"), "1150.00").unwrap();
    store.set_transactions_cleared(&[gas], true).unwrap();

    let candidates = store.reconcile_candidates(acct, day("2026-09-30")).unwrap();
    assert_eq!(candidates.iter().map(|c| c.id).collect::<Vec<_>>(), vec![gas]);
}
```

In `core/src/store/tests.rs` add `mod reconcile;` to the module list. In `core/src/store/tests/accounts.rs`, delete these five tests (their behaviour moves to `reconcile.rs`): `the_cleared_balance_is_the_opening_balance_plus_the_transactions_marked_cleared`, `the_difference_is_what_the_statement_says_minus_what_has_cleared`, `clearing_can_be_undone_and_a_deleted_transaction_stops_counting`, `a_reconciliation_can_only_be_finished_when_the_difference_is_zero`, `reconcile_candidates_are_uncleared_rows_plus_anything_cleared_since_the_last_reconciliation`. Replace the body of `the_latest_reconciliation_is_the_one_reported` with:

```rust
#[test]
fn the_latest_reconciliation_is_the_one_reported() {
    use crate::store::{FinishReconciliation, ReconcileSource};
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = reconcilable(&store, "1000.00");
    let finish = |date: &str, start: Option<&str>, end: &str| {
        store
            .finish_reconciliation(
                &FinishReconciliation { account_id: acct, period_start: None, statement_date: day(date), statement_start: start.map(dec), statement_end: dec(end), source: ReconcileSource::Manual },
                test_now(),
            )
            .unwrap()
    };
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
    finish("2026-08-31", Some("1000.00"), "1150.00").unwrap();
    store.set_transactions_cleared(&[gas], true).unwrap();
    finish("2026-09-30", None, "1120.00").unwrap();

    assert_eq!(store.last_reconciliation(acct).unwrap(), Some((day("2026-09-30"), dec("1120.00"))));
}
```

Also add a deleted-row case to `reconcile.rs`:

```rust
#[test]
fn a_deleted_ticked_transaction_stops_counting() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, _]) = checking(&store);
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
    store.delete_transaction(deposit, test_now()).unwrap();
    let status = store.reconcile_status(acct, Some(dec("1000.00")), dec("950.00")).unwrap();
    assert_eq!((status.ticked_change, status.ticked_count), (dec("-50.00"), 1));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p budget_core --lib store::tests::reconcile`
Expected: compile errors (no `FinishReconciliation`, `reconcile_status`, …).

- [ ] **Step 3: Implement** — create `core/src/store/reconcile.rs`:

```rust
//! Reconciling an account against a statement: the balance rule shared by manual and statement
//! reconciling, and the finished record.
//!
//! The rule picks up from last time: the last finished reconciliation's ending balance (or, the first
//! time, the statement's own starting balance) plus the change from every ticked transaction that no
//! finished reconciliation has settled yet must equal the statement's ending balance exactly. Balances
//! are in the statement's terms: cash in the account, what is owed on a card, or the principal still
//! owed on a loan. Which reconciliation settled a transaction is stored on it (`reconciliation_id`),
//! because late items can be dated before the previous statement's end.

use super::Store;
use crate::models::AccountType;
use chrono::{NaiveDate, NaiveDateTime};
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

/// How a statement states this account's balance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountKind {
    /// Checking, savings and other cash accounts: money in the account.
    Cash,
    /// What is owed on the card.
    Credit,
    /// Principal still owed.
    Loan,
    /// Cash activity of an investment account (its value moves with the market; see `store/reconcile.rs`
    /// `finish_statement_reconciliation` for how investment statements finish).
    Investment,
}

impl AccountKind {
    pub fn of(account_type: AccountType) -> Self {
        match account_type {
            AccountType::Checking | AccountType::Savings | AccountType::Other => AccountKind::Cash,
            AccountType::Credit => AccountKind::Credit,
            AccountType::Loan => AccountKind::Loan,
            AccountType::Investment => AccountKind::Investment,
        }
    }
}

/// How one app transaction moves the statement's balance. A card charge is stored negative and raises
/// what is owed; a loan payment is stored positive and lowers the principal owed (by its principal part
/// when one was recorded, matching `account_balance_as_of`).
pub fn balance_change(kind: AccountKind, amount: Decimal, principal: Option<Decimal>) -> Decimal {
    match kind {
        AccountKind::Cash | AccountKind::Investment => amount,
        AccountKind::Credit => -amount,
        AccountKind::Loan => -principal.unwrap_or(amount),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReconcileSource {
    Manual,
    StatementPdf,
    StatementDownload,
}

impl ReconcileSource {
    pub fn as_str(self) -> &'static str {
        match self {
            ReconcileSource::Manual => "manual",
            ReconcileSource::StatementPdf => "statement_pdf",
            ReconcileSource::StatementDownload => "statement_download",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReconcileStatus {
    /// The last finished reconciliation's ending balance, else the statement starting balance given.
    pub starting_point: Option<Decimal>,
    /// True on an account's first reconciliation: the statement's starting balance is needed.
    pub needs_starting_balance: bool,
    pub ticked_change: Decimal,
    pub ticked_count: usize,
    /// `statement_end - (starting_point + ticked_change)`; `None` until there is a starting point.
    pub difference: Option<Decimal>,
}

pub struct FinishReconciliation {
    pub account_id: i64,
    pub period_start: Option<NaiveDate>,
    pub statement_date: NaiveDate,
    pub statement_start: Option<Decimal>,
    pub statement_end: Decimal,
    pub source: ReconcileSource,
}

fn dec(s: &str) -> Decimal {
    Decimal::from_str(s).expect("amounts stored by this crate are valid decimals")
}

impl Store {
    pub fn account_kind(&self, account_id: i64) -> rusqlite::Result<AccountKind> {
        let account_type: String =
            self.conn
                .query_row("SELECT account_type FROM accounts WHERE id = ?1", params![account_id], |r| r.get(0))?;
        Ok(AccountKind::of(AccountType::parse(&account_type).unwrap_or(AccountType::Other)))
    }

    /// The change from every ticked, not-yet-settled, non-deleted transaction on the account.
    pub(crate) fn unsettled_ticked_change(&self, account_id: i64, kind: AccountKind) -> rusqlite::Result<(Decimal, usize)> {
        let mut stmt = self.conn.prepare(
            "SELECT amount, principal_amount FROM transactions
             WHERE account_id = ?1 AND cleared = 1 AND reconciliation_id IS NULL AND deleted_at IS NULL",
        )?;
        let rows = stmt
            .query_map(params![account_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let change = rows
            .iter()
            .map(|(amount, principal)| balance_change(kind, dec(amount), principal.as_deref().map(dec)))
            .sum();
        Ok((change, rows.len()))
    }

    pub fn reconcile_status(&self, account_id: i64, statement_start: Option<Decimal>, statement_end: Decimal) -> rusqlite::Result<ReconcileStatus> {
        let kind = self.account_kind(account_id)?;
        let last = self.last_reconciliation(account_id)?.map(|(_, balance)| balance);
        let starting_point = last.or(statement_start);
        let (ticked_change, ticked_count) = self.unsettled_ticked_change(account_id, kind)?;
        Ok(ReconcileStatus {
            starting_point,
            needs_starting_balance: last.is_none(),
            ticked_change,
            ticked_count,
            difference: starting_point.map(|start| statement_end - (start + ticked_change)),
        })
    }

    /// Records a finished reconciliation and settles every ticked, unsettled transaction on the
    /// account — only when the difference is exactly zero. `None` means nothing was written.
    pub fn finish_reconciliation(&self, req: &FinishReconciliation, now: NaiveDateTime) -> rusqlite::Result<Option<i64>> {
        let tx = self.conn.unchecked_transaction()?;
        let status = self.reconcile_status(req.account_id, req.statement_start, req.statement_end)?;
        if status.difference != Some(Decimal::ZERO) {
            return Ok(None);
        }
        let id = self.insert_reconciliation(req, status.starting_point, None, now)?;
        self.settle_ticked(req.account_id, id)?;
        tx.commit()?;
        Ok(Some(id))
    }

    pub(crate) fn insert_reconciliation(
        &self,
        req: &FinishReconciliation,
        starting: Option<Decimal>,
        holdings_checked: Option<bool>,
        now: NaiveDateTime,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at, period_start, starting_balance, source, holdings_checked)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                req.account_id,
                req.statement_date.to_string(),
                req.statement_end.to_string(),
                now.to_string(),
                req.period_start.map(|d| d.to_string()),
                starting.map(|d| d.to_string()),
                req.source.as_str(),
                holdings_checked.map(i64::from),
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub(crate) fn settle_ticked(&self, account_id: i64, reconciliation_id: i64) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE transactions SET reconciliation_id = ?1
             WHERE account_id = ?2 AND cleared = 1 AND reconciliation_id IS NULL AND deleted_at IS NULL",
            params![reconciliation_id, account_id],
        )?;
        Ok(())
    }
}
```

In `core/src/store.rs` add `mod reconcile;` and `pub use reconcile::*;` beside the other feature modules. In `core/src/store/accounts.rs`, delete `ReconciliationStatus`, `reconciliation_status` and `finish_reconciliation`, and change `reconcile_candidates` to:

```rust
    /// The transactions to tick through for a statement ending on `statement_date`: everything dated on
    /// or before it that hasn't been ticked, plus anything ticked that no finished reconciliation has
    /// settled yet (so a tick can still be undone).
    pub fn reconcile_candidates(&self, account_id: i64, statement_date: NaiveDate) -> rusqlite::Result<Vec<AccountTransaction>> {
        self.account_transactions_where(
            account_id,
            "AND t.reconciliation_id IS NULL AND (t.cleared = 1 OR t.date <= ?3)",
            i64::MAX,
            Some(statement_date),
        )
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p budget_core --lib store::tests`
Expected: PASS. (`src-tauri` won't compile until Task 3; that is expected.)

- [ ] **Step 5: Commit**

```bash
git add core/src/store.rs core/src/store/reconcile.rs core/src/store/accounts.rs core/src/store/tests.rs core/src/store/tests/reconcile.rs core/src/store/tests/accounts.rs
git commit -m "Reconcile by picking up from the last reconciliation, for every account kind"
```

---

### Task 3: Manual reconciling for every account, using the shared rule

**Files:**
- Modify: `src-tauri/src/commands/accounts.rs:255-345`, `src-tauri/src/lib.rs` (handler list near line 396)
- Modify: `src/AccountDetailView.tsx`, `src/AccountDetailView.test.tsx`, `src/HelpView.tsx` (line ~172 and ~1361 wording)
- Modify: `e2e/feature80_reconciliation.mjs`

**Interfaces:**
- Consumes: `Store::reconcile_status`, `Store::finish_reconciliation`, `FinishReconciliation`, `ReconcileSource` (Task 2).
- Produces (commands):
  - `reconcile_status(accountId: i64, statementStart: Option<String>, statementEnd: String) -> ReconcileStatusDto { starting_point: Option<String>, needs_starting_balance: bool, ticked_change: String, ticked_count: usize, difference: Option<String> }`
  - `finish_reconciliation(accountId: i64, periodStart: Option<String>, statementDate: String, statementStart: Option<String>, statementEnd: String) -> bool`
  - `reconciliation_status` is removed (replaced by `reconcile_status`).

- [ ] **Step 1: Write the failing frontend test** — add to `src/AccountDetailView.test.tsx` (follow its existing `createRoot` + `act` setup and `invoke` mock):

```tsx
it("asks for a starting balance on the first reconciliation and offers reconciling on a credit card", async () => {
  const card = { ...checkingAccount, id: 9, name: "Rewards Card", account_type: "credit" };
  mockInvoke({
    account_balance_history: [],
    list_account_transactions: [],
    last_reconciliation: null,
    reconcile_candidates: [],
    reconcile_status: { starting_point: "300.00", needs_starting_balance: true, ticked_change: "0", ticked_count: 0, difference: "-220.00" },
  });
  await render(<AccountDetailView account={card} onBack={() => {}} onOpenTransactions={() => {}} onOpenPayment={() => {}} onMessage={() => {}} />);

  expect(container.textContent).not.toContain("Reconciliation is for checking and savings accounts");
  const start = container.querySelector<HTMLInputElement>("[data-statement-start-balance]");
  expect(start).not.toBeNull();
  expect(container.textContent).toContain("Amount owed at the start of the statement");
});

it("hides the starting balance after a previous reconciliation", async () => {
  mockInvoke({
    account_balance_history: [],
    list_account_transactions: [],
    last_reconciliation: { statement_date: "2026-08-31", statement_balance: "1150.00" },
  });
  await render(<AccountDetailView account={checkingAccount} onBack={() => {}} onOpenTransactions={() => {}} onOpenPayment={() => {}} onMessage={() => {}} />);
  expect(container.querySelector("[data-statement-start-balance]")).toBeNull();
  expect(container.textContent).toContain("Picks up from your last reconciliation");
});
```

(`checkingAccount`, `mockInvoke`, `render` and `container` are the file's existing helpers; if a helper is named differently, use the existing one.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/AccountDetailView.test.tsx`
Expected: FAIL (the "Reconciliation is for checking and savings accounts" message is still shown; no `[data-statement-start-balance]`).

- [ ] **Step 3: Implement the commands** — in `src-tauri/src/commands/accounts.rs` replace `ReconciliationStatusDto`, `reconciliation_status` and `finish_reconciliation` with:

```rust
#[derive(Serialize)]
pub struct ReconcileStatusDto {
    pub starting_point: Option<String>,
    pub needs_starting_balance: bool,
    pub ticked_change: String,
    pub ticked_count: usize,
    pub difference: Option<String>,
}

fn optional_amount(value: Option<String>) -> Result<Option<Decimal>, String> {
    value.filter(|v| !v.trim().is_empty()).map(|v| parse_amount(&v)).transpose()
}

#[tauri::command]
pub fn reconcile_status(
    account_id: i64,
    statement_start: Option<String>,
    statement_end: String,
    state: tauri::State<AppStateHandle>,
) -> Result<ReconcileStatusDto, String> {
    let state = state.lock()?;
    let status = state
        .store
        .reconcile_status(account_id, optional_amount(statement_start)?, parse_amount(&statement_end)?)
        .map_err(|e| e.to_string())?;
    Ok(ReconcileStatusDto {
        starting_point: status.starting_point.map(|d| d.to_string()),
        needs_starting_balance: status.needs_starting_balance,
        ticked_change: status.ticked_change.to_string(),
        ticked_count: status.ticked_count,
        difference: status.difference.map(|d| d.to_string()),
    })
}

/// Records the reconciliation if it balances; `false` means it didn't and nothing was recorded.
#[tauri::command]
pub fn finish_reconciliation(
    account_id: i64,
    period_start: Option<String>,
    statement_date: String,
    statement_start: Option<String>,
    statement_end: String,
    state: tauri::State<AppStateHandle>,
) -> Result<bool, String> {
    let state = state.lock()?;
    let req = budget_core::store::FinishReconciliation {
        account_id,
        period_start: period_start.filter(|p| !p.is_empty()).map(|p| parse_date(&p)).transpose()?,
        statement_date: parse_date(&statement_date)?,
        statement_start: optional_amount(statement_start)?,
        statement_end: parse_amount(&statement_end)?,
        source: budget_core::store::ReconcileSource::Manual,
    };
    state
        .store
        .finish_reconciliation(&req, chrono::Local::now().naive_local())
        .map(|id| id.is_some())
        .map_err(|e| e.to_string())
}
```

In `src-tauri/src/lib.rs` replace `commands::reconciliation_status,` with `commands::reconcile_status,`.

- [ ] **Step 4: Implement the view** — in `src/AccountDetailView.tsx`:
  - Delete `RECONCILABLE_TYPES` and `canReconcile`; every account type reconciles.
  - Replace `type ReconciliationStatus` with `type ReconcileStatus = { starting_point: string | null; needs_starting_balance: boolean; ticked_change: string; ticked_count: number; difference: string | null };`.
  - Add state `const [periodStart, setPeriodStart] = useState("");` and `const [statementStart, setStatementStart] = useState("");`.
  - Add the balance wording helper:

```tsx
/** What a statement calls this account's balance, in plain words. */
function balanceWords(accountType: string): { start: string; end: string } {
  if (accountType === "credit") return { start: "Amount owed at the start of the statement", end: "Amount owed at the end of the statement" };
  if (accountType === "loan") return { start: "Principal owed at the start of the statement", end: "Principal owed at the end of the statement" };
  return { start: "Starting balance on the statement", end: "Ending balance on the statement" };
}
```

  - `loadReconciliation` calls `invoke<ReconcileStatus>("reconcile_status", { accountId: account.id, statementStart: lastRec ? null : statementStart, statementEnd: statementBalance })`.
  - `balanceValid` additionally requires, when `!lastRec`, `statementStart.trim() !== "" && isValidDecimalString(statementStart)`.
  - `finish()` invokes `finish_reconciliation` with `{ accountId: account.id, periodStart: periodStart || null, statementDate, statementStart: lastRec ? null : statementStart, statementEnd: statementBalance }`, and on success also clears `statementStart` and `periodStart`.
  - The form shows, in order: "Statement start date" (`DateField`, optional, `data-statement-period-start`), "Statement end date" (existing field, relabelled), then **only when `!lastRec`** a field labelled `balanceWords(account.account_type).start` with `data-statement-start-balance`, then the ending field labelled `balanceWords(...).end`. When `lastRec` exists, show `<p className="modal-message-secondary">Picks up from your last reconciliation on {formatDisplayDate(lastRec.statement_date)} ({formatAmount(lastRec.statement_balance)}).</p>`.
  - Intro copy: "Enter the dates and balances from your statement, then tick each transaction that appears on it. When the difference reaches $0.00 the two agree."
  - Summary labels: "Statement" → "Statement ending", "Cleared" → "Ticked so far" showing `status.starting_point` + `status.ticked_change` (compute with `addDecimalStrings` from Task 20's `reconcileMath.ts` once it exists; until then show `formatAmount(String(parseFloat(status.starting_point ?? "0") + parseFloat(status.ticked_change)))`, and replace it in Task 23), keep `data-cleared-balance` on that figure. Difference shows `status.difference ?? "—"`; `difference === 0` uses `status.difference !== null && parseFloat(status.difference) === 0`.
  - Table header "Cleared" → "On statement"; checkbox `aria-label={`On statement: ${t.description}`}`.
  - Investment accounts: show above the form `<p className="modal-message-secondary">For an investment account this checks its cash activity. Uploading the statement also checks your share counts.</p>`.
- In `src/HelpView.tsx` change "a checking or savings account's row" to "an account's row", and in the reconcile help paragraph use "ticked" instead of "cleared".

- [ ] **Step 5: Update the E2E spec** — in `e2e/feature80_reconciliation.mjs`, after setting the ending balance and before "Start reconciling", type the starting balance: `await (await browser.$("[data-statement-start-balance]")).setValue("1000.00");` (the account's first reconciliation). The second reconciliation in the spec must **not** find that field: add `assert(!(await (await browser.$("[data-statement-start-balance]")).isExisting()), "the second reconciliation picks up from the first");`. Update any text assertion that reads "Cleared" to "On statement".

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/AccountDetailView.test.tsx src/plainLanguage.test.ts` → PASS.
Run (PowerShell): `cargo test --workspace` → PASS.
Build (PowerShell): `cargo build --workspace --bins; npx tauri build --debug --no-bundle`, then `node e2e/run-all.mjs --spec=80 > $env:TEMP\vs-e2e-80.log 2>&1` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/accounts.rs src-tauri/src/lib.rs src/AccountDetailView.tsx src/AccountDetailView.test.tsx src/HelpView.tsx e2e/feature80_reconciliation.mjs
git commit -m "Reconcile any account by hand, picking up from the last reconciliation"
```

## Phase B — The statement reader (pure core)

Every file in this phase lives in `core/src/statement/` and has its tests in a `#[cfg(test)] mod tests` at the bottom of the same file. Run them with `cargo test -p budget_core --lib statement::` (PowerShell).

Rules used throughout the reader (from the spec and the real statements):
- **Content order.** Lines arrive in the order the PDF draws them; nothing is re-sorted by position.
- **Money has exactly two decimals.** `8.64` is money; `864`, `10.000`, `$339.3500` and `5.500%` are not.
- **Label matching.** Balance, total, section, skip and heading labels compare with case and all whitespace ignored (`"Account Summary"` matches `"AccountSummary"`), and must match at the **start** of the line (after a leading date, if there is one), except `section_start`, which may appear anywhere in the line. `ignore_lines` phrases match anywhere in the line, ignoring case.
- **Label-only lines.** When a line *is* exactly a label (nothing else on it), its amount is the first money in the next three lines (Amex prints "New Balance" and "$52.36" on separate lines; LPL prints "Total Account Holdings", two caption lines, then the amount).
- **Rows** start at a line that begins with a date and end at the first line that carries money. A dated line with no money within four following lines goes to "Couldn't read". A dated line followed by "-", "–" or "to" and another date is a date range, not a row. Rows dated more than 7 days outside the period are dropped quietly.
- **`rows.reversed`**: some banks print money out as a positive number. When set, each row's amount is negated as it is read, so `start + rows = end` always holds in the statement's own terms.

### Task 4: Statement model, label matching and the layout format

**Files:**
- Create: `core/src/statement/mod.rs`, `core/src/statement/model.rs`, `core/src/statement/text.rs`, `core/src/statement/layout.rs`
- Create: `core/data/statement_layouts/general.json`, `core/data/statement_layouts/general-investment.json`
- Modify: `core/src/lib.rs` (`pub mod statement;`)

**Interfaces:**
- Produces (`model.rs`):
  - `pub struct StatementLine { pub page: usize, pub text: String }`
  - `pub struct Period { pub start: NaiveDate, pub end: NaiveDate }` with `Period::new(start, end) -> Result<Period, &'static str>`, `pub const LEEWAY_DAYS: i64 = 7`, `fn contains_with_leeway(&self, d) -> bool`, `fn contains(&self, d) -> bool`, `fn distance(&self, d) -> i64`
  - `pub struct StatementRow { pub line: usize, pub date: NaiveDate, pub description: String, pub amount: Decimal, pub running_balance: Option<Decimal> }` (amount in the statement's own terms, after `rows.reversed`)
  - `pub struct UnreadLine { pub line: usize, pub text: String }`
  - `pub struct StatementHolding { pub line: usize, pub symbol: String, pub name: String, pub shares: Decimal, pub price: Option<Decimal>, pub market_value: Decimal }`
  - `pub struct StatementSection { pub name: String, pub first_line: usize, pub starting_balance: Option<Decimal>, pub ending_balance: Option<Decimal>, pub activity_totals: Option<(Decimal, Decimal)>, pub ending_value: Option<Decimal>, pub rows: Vec<StatementRow>, pub unread: Vec<UnreadLine>, pub dropped_out_of_period: usize, pub holdings: Vec<StatementHolding>, pub holdings_cash: Option<Decimal>, pub holdings_total: Option<Decimal> }` (`Default`)
- Produces (`text.rs`): `pub fn squash(s: &str) -> String`, `pub fn starts_with_label(line: &str, label: &str) -> bool`, `pub fn contains_label(line: &str, label: &str) -> bool`, `pub fn is_label_only(line: &str, label: &str) -> bool`, `pub fn contains_phrase(line: &str, phrase: &str) -> bool`
- Produces (`layout.rs`): `StatementLayout` and its parts (below), `LayoutError`, `is_safe_phrase(&str) -> bool`, `StatementLayout::{from_json, to_json, validate}`, `built_in_layouts() -> Vec<StatementLayout>`, `GENERAL_ID = "general"`, `GENERAL_INVESTMENT_ID = "general-investment"`.

- [ ] **Step 1: Write the failing tests** — at the bottom of `layout.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_built_in_general_layouts_load_and_validate() {
        let ids: Vec<String> = built_in_layouts().into_iter().map(|l| l.id).collect();
        assert!(ids.contains(&GENERAL_ID.to_string()));
        assert!(ids.contains(&GENERAL_INVESTMENT_ID.to_string()));
    }

    #[test]
    fn a_layout_round_trips_through_json() {
        let general = built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap();
        assert_eq!(StatementLayout::from_json(&general.to_json()).unwrap(), general);
    }

    #[test]
    fn unknown_fields_and_free_form_patterns_are_refused() {
        let general = built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&general.to_json()).unwrap();
        value["regex"] = serde_json::json!("(.*)");
        assert!(matches!(StatementLayout::from_json(&value.to_string()), Err(LayoutError::Malformed(_))));
    }

    #[test]
    fn oversized_documents_are_refused_before_parsing() {
        let huge = format!("{{\"name\":\"{}\"}}", "x".repeat(MAX_LAYOUT_BYTES));
        assert_eq!(StatementLayout::from_json(&huge), Err(LayoutError::TooLarge));
    }

    #[test]
    fn personal_looking_phrases_are_refused() {
        assert!(is_safe_phrase("Opening/Closing Date"));
        assert!(is_safe_phrase("Riverbend Mutual Bank"));
        assert!(!is_safe_phrase("Account ending 6700"), "four digits in a row");
        assert!(!is_safe_phrase("me@example.com"));
        assert!(!is_safe_phrase("Call 616-555-0100"), "a phone number");
        assert!(!is_safe_phrase(""));
        let mut layout = built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap();
        layout.recognize = vec!["Card ending 61006".into()];
        assert!(layout.validate().is_err());
        layout.recognize = vec![];
        layout.balances.pairs[0].end = "Balance for 1234567".into();
        assert!(layout.validate().is_err(), "labels follow the same rule");
    }

    #[test]
    fn holdings_rules_need_symbol_quantity_and_value_once_each() {
        let mut layout = built_in_layouts().into_iter().find(|l| l.id == GENERAL_INVESTMENT_ID).unwrap();
        layout.holdings.as_mut().unwrap().order = vec![HoldingField::Symbol, HoldingField::MarketValue];
        assert!(layout.validate().is_err());
        layout.holdings.as_mut().unwrap().order = vec![HoldingField::Symbol, HoldingField::Quantity, HoldingField::Quantity, HoldingField::MarketValue];
        assert!(layout.validate().is_err());
    }

    #[test]
    fn a_newer_schema_is_refused_plainly() {
        let mut layout = built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap();
        layout.schema = LAYOUT_SCHEMA + 1;
        assert!(layout.validate().is_err());
    }
}
```

and at the bottom of `text.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_ignore_case_and_whitespace_and_match_at_the_start() {
        assert!(starts_with_label("AccountSummary", "Account Summary"));
        assert!(starts_with_label("New Balance: $34.90", "new balance"));
        assert!(!starts_with_label("If you pay your New Balance in full", "New Balance"));
        assert!(contains_label("EVERYDAY CHECKING Share Account ID 01", "Share Account ID"));
        assert!(is_label_only("  New   Balance ", "New Balance"));
        assert!(!is_label_only("New Balance $52.36", "New Balance"));
        assert!(contains_phrase("Jul 25, 2026 - Aug 24, 2026 | 31 days in Billing Cycle", "days in billing cycle"));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p budget_core --lib statement::`
Expected: compile error (module `statement` not found).

- [ ] **Step 3: Implement**

`core/src/lib.rs`: add `pub mod statement;`.

`core/src/statement/mod.rs`:

```rust
//! Reading bank, card, loan and brokerage statements into rows, balances and holdings, and checking
//! that the reading adds up. Every bank-specific choice comes from a `StatementLayout` (data); nothing
//! in this module names a bank. See docs/STATEMENT-RECONCILE.md.

pub mod layout;
pub mod model;
pub mod text;

pub use model::*;
```

(Later tasks add `pub mod tokens; pub mod fixture_pdf; pub mod pdf_text; pub mod rows; pub mod holdings; pub mod sections; pub mod checks; pub mod select; pub mod learn; pub mod matching;` as they create each file.)

`core/src/statement/model.rs`:

```rust
use chrono::{Duration, NaiveDate};
use rust_decimal::Decimal;

/// One line of statement text, in the order the PDF draws it. `page` counts from 0.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatementLine {
    pub page: usize,
    pub text: String,
}

/// The dates the person says the statement covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Period {
    pub start: NaiveDate,
    pub end: NaiveDate,
}

impl Period {
    /// Rows dated this many days outside the period still count (transaction versus posting dates).
    pub const LEEWAY_DAYS: i64 = 7;

    pub fn new(start: NaiveDate, end: NaiveDate) -> Result<Self, &'static str> {
        if start > end {
            return Err("The statement's start date must be on or before its end date.");
        }
        Ok(Period { start, end })
    }

    pub fn contains(&self, date: NaiveDate) -> bool {
        date >= self.start && date <= self.end
    }

    pub fn contains_with_leeway(&self, date: NaiveDate) -> bool {
        date >= self.start - Duration::days(Self::LEEWAY_DAYS) && date <= self.end + Duration::days(Self::LEEWAY_DAYS)
    }

    /// Days from the period to `date`; 0 inside it.
    pub fn distance(&self, date: NaiveDate) -> i64 {
        if date < self.start {
            (self.start - date).num_days()
        } else if date > self.end {
            (date - self.end).num_days()
        } else {
            0
        }
    }
}

/// One statement transaction. `amount` is in the statement's own terms (after `rows.reversed`), so a
/// section's starting balance plus its rows equals its ending balance.
#[derive(Debug, Clone, PartialEq)]
pub struct StatementRow {
    pub line: usize,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
    pub running_balance: Option<Decimal>,
}

/// Text that looked like a transaction (it starts with a date) but had no amount.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnreadLine {
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StatementHolding {
    pub line: usize,
    pub symbol: String,
    pub name: String,
    pub shares: Decimal,
    pub price: Option<Decimal>,
    pub market_value: Decimal,
}

/// One account's part of a statement.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct StatementSection {
    pub name: String,
    pub first_line: usize,
    pub starting_balance: Option<Decimal>,
    pub ending_balance: Option<Decimal>,
    /// (additions, subtractions) as printed: subtractions are negative.
    pub activity_totals: Option<(Decimal, Decimal)>,
    /// An investment account's total value, for reference only.
    pub ending_value: Option<Decimal>,
    pub rows: Vec<StatementRow>,
    pub unread: Vec<UnreadLine>,
    pub dropped_out_of_period: usize,
    pub holdings: Vec<StatementHolding>,
    pub holdings_cash: Option<Decimal>,
    pub holdings_total: Option<Decimal>,
}
```

`core/src/statement/text.rs`:

```rust
//! How statement text is compared with layout labels.

/// Lower-case with every whitespace character removed: "Account Summary" and "AccountSummary" agree.
pub fn squash(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect()
}

pub fn starts_with_label(line: &str, label: &str) -> bool {
    let label = squash(label);
    !label.is_empty() && squash(line).starts_with(&label)
}

pub fn contains_label(line: &str, label: &str) -> bool {
    let label = squash(label);
    !label.is_empty() && squash(line).contains(&label)
}

/// The line is the label and nothing else (its amount is on a following line).
pub fn is_label_only(line: &str, label: &str) -> bool {
    let label = squash(label);
    !label.is_empty() && squash(line) == label
}

/// `phrase` appears anywhere in `line`, ignoring case and runs of whitespace.
pub fn contains_phrase(line: &str, phrase: &str) -> bool {
    let norm = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let phrase = norm(phrase);
    !phrase.is_empty() && norm(line).contains(&phrase)
}
```

`core/src/statement/layout.rs`:

```rust
//! A statement layout: everything bank-specific about reading a statement, as data. Built from a
//! closed set of options (no free-form patterns, nothing executable), size-limited and validated on
//! every load, because learned layouts come from statement text.

use serde::{Deserialize, Serialize};

pub const LAYOUT_SCHEMA: u32 = 1;
pub const MAX_LAYOUT_BYTES: usize = 16 * 1024;
pub const GENERAL_ID: &str = "general";
pub const GENERAL_INVESTMENT_ID: &str = "general-investment";
const MAX_TEXT: usize = 80;
const MAX_LIST: usize = 32;
const ALLOWED_MARKERS: [char; 3] = ['*', '#', '+'];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatementLayout {
    pub schema: u32,
    pub id: String,
    pub name: String,
    /// Text found on page 1 of every statement from this bank. All must appear for a match.
    #[serde(default)]
    pub recognize: Vec<String>,
    pub dates: DateRules,
    pub amounts: AmountRules,
    pub rows: RowRules,
    pub balances: BalanceRules,
    /// Headings whose content is ignored until the next section starts.
    #[serde(default)]
    pub skip_sections: Vec<String>,
    /// Lines containing any of these phrases are ignored.
    #[serde(default)]
    pub ignore_lines: Vec<String>,
    #[serde(default)]
    pub holdings: Option<HoldingRules>,
    #[serde(default)]
    pub signs: SignRules,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DateFormat {
    MmDdYy,
    MmDdYyyy,
    MmDd,
    MonDd,
    MonDdYyyy,
    YyyyMmDd,
    DdMmYy,
    DdMmYyyy,
}

impl DateFormat {
    pub const ALL: [DateFormat; 8] = [
        DateFormat::MmDdYy,
        DateFormat::MmDdYyyy,
        DateFormat::MmDd,
        DateFormat::MonDd,
        DateFormat::MonDdYyyy,
        DateFormat::YyyyMmDd,
        DateFormat::DdMmYy,
        DateFormat::DdMmYyyy,
    ];
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DateRules {
    pub formats: Vec<DateFormat>,
    /// Rows carry a second (posting) date right after the first.
    #[serde(default)]
    pub second_date: bool,
    #[serde(default)]
    pub ignore_markers: Vec<char>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NegativeStyle {
    LeadingMinus,
    SpacedMinus,
    Parentheses,
    TrailingMinus,
    CrSuffix,
    DrSuffix,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Currency {
    Optional,
    Required,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Thousands {
    Comma,
    Period,
    Apostrophe,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecimalMark {
    Period,
    Comma,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AmountRules {
    pub negatives: Vec<NegativeStyle>,
    pub currency: Currency,
    pub thousands: Thousands,
    pub decimal: DecimalMark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AmountPosition {
    First,
    Last,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RowRules {
    /// Which money amount on the closing line is the transaction (prices can come before it).
    pub amount: AmountPosition,
    /// A running balance follows the amount.
    #[serde(default)]
    pub running_balance: bool,
    /// Description lines may follow the amount.
    #[serde(default)]
    pub description_after_amount: bool,
    /// Money out is printed as a positive number (and money in negative or marked CR).
    #[serde(default)]
    pub reversed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BalancePair {
    #[serde(default)]
    pub start: Option<String>,
    pub end: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TotalsPair {
    pub additions: String,
    pub subtractions: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BalanceRules {
    #[serde(default)]
    pub pairs: Vec<BalancePair>,
    /// Text that starts a new account section (may appear anywhere in the line).
    #[serde(default)]
    pub section_start: Vec<String>,
    /// Which column of a multi-column summary line to read (0 = first, "current month").
    #[serde(default)]
    pub summary_column: u8,
    #[serde(default)]
    pub activity_totals: Vec<TotalsPair>,
    /// An investment account's total value (reference only).
    #[serde(default)]
    pub value: Option<BalancePair>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HoldingField {
    Symbol,
    Name,
    Quantity,
    Price,
    MarketValue,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HoldingRules {
    pub heading: Vec<String>,
    pub order: Vec<HoldingField>,
    pub quantity_decimals: u8,
    pub price_decimals: u8,
    pub total: Vec<String>,
    /// Cash lines whose amount is part of the total holdings value.
    #[serde(default)]
    pub cash: Vec<String>,
}

/// Reverses the default statement → app sign conversion for an account kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignRules {
    #[serde(default)]
    pub flip_cash: bool,
    #[serde(default)]
    pub flip_credit: bool,
    #[serde(default)]
    pub flip_loan: bool,
    #[serde(default)]
    pub flip_investment: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutError {
    TooLarge,
    Malformed(String),
    Invalid(&'static str),
}

impl std::fmt::Display for LayoutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LayoutError::TooLarge => write!(f, "This statement setting is too large."),
            LayoutError::Malformed(_) => write!(f, "This statement setting is damaged."),
            LayoutError::Invalid(why) => write!(f, "{why}"),
        }
    }
}

impl std::error::Error for LayoutError {}

/// Text that is safe to keep in a layout: no run of four or more digits (account numbers), no email
/// address, and fewer than seven digits in total (phone numbers).
pub fn is_safe_phrase(s: &str) -> bool {
    let t = s.trim();
    if t.is_empty() || t.chars().count() > MAX_TEXT || t.contains('@') {
        return false;
    }
    let (mut run, mut total) = (0, 0);
    for c in t.chars() {
        if c.is_ascii_digit() {
            run += 1;
            total += 1;
            if run >= 4 {
                return false;
            }
        } else {
            run = 0;
        }
    }
    total < 7
}

const PERSONAL: LayoutError =
    LayoutError::Invalid("A statement label looks like it holds an account number, email address or phone number.");

fn phrase(s: &str) -> Result<(), LayoutError> {
    if is_safe_phrase(s) { Ok(()) } else { Err(PERSONAL) }
}

fn phrases(list: &[String]) -> Result<(), LayoutError> {
    if list.len() > MAX_LIST {
        return Err(LayoutError::Invalid("A statement setting has too many labels."));
    }
    list.iter().try_for_each(|s| phrase(s))
}

impl StatementLayout {
    pub fn from_json(json: &str) -> Result<Self, LayoutError> {
        if json.len() > MAX_LAYOUT_BYTES {
            return Err(LayoutError::TooLarge);
        }
        let layout: StatementLayout = serde_json::from_str(json).map_err(|e| LayoutError::Malformed(e.to_string()))?;
        layout.validate()?;
        Ok(layout)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("a layout always serializes")
    }

    pub fn validate(&self) -> Result<(), LayoutError> {
        use LayoutError::Invalid;
        if self.schema != LAYOUT_SCHEMA {
            return Err(Invalid("This statement setting was saved by a newer version of the app."));
        }
        if self.id.is_empty()
            || self.id.len() > MAX_TEXT
            || !self.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            return Err(Invalid("A statement setting has a damaged name."));
        }
        phrase(&self.name)?;
        phrases(&self.recognize)?;
        phrases(&self.skip_sections)?;
        phrases(&self.ignore_lines)?;
        phrases(&self.balances.section_start)?;
        if self.balances.pairs.len() > MAX_LIST || self.balances.activity_totals.len() > MAX_LIST {
            return Err(Invalid("A statement setting has too many labels."));
        }
        for pair in self.balances.pairs.iter().chain(self.balances.value.iter()) {
            if let Some(start) = &pair.start {
                phrase(start)?;
            }
            phrase(&pair.end)?;
        }
        for totals in &self.balances.activity_totals {
            phrase(&totals.additions)?;
            phrase(&totals.subtractions)?;
        }
        if self.balances.summary_column > 5 {
            return Err(Invalid("A statement setting reads a column that doesn't exist."));
        }
        if self.dates.formats.is_empty() || self.dates.formats.len() > DateFormat::ALL.len() {
            return Err(Invalid("A statement setting has no date formats."));
        }
        if self.dates.ignore_markers.iter().any(|c| !ALLOWED_MARKERS.contains(c)) {
            return Err(Invalid("A statement setting ignores an unexpected character."));
        }
        if self.amounts.negatives.len() > 6 {
            return Err(Invalid("A statement setting has too many amount styles."));
        }
        if matches!(
            (self.amounts.thousands, self.amounts.decimal),
            (Thousands::Comma, DecimalMark::Comma) | (Thousands::Period, DecimalMark::Period)
        ) {
            return Err(Invalid("A statement setting uses the same mark for thousands and decimals."));
        }
        if let Some(h) = &self.holdings {
            if h.heading.is_empty() || h.total.is_empty() {
                return Err(Invalid("A statement setting for holdings is incomplete."));
            }
            phrases(&h.heading)?;
            phrases(&h.total)?;
            phrases(&h.cash)?;
            let count = |f: HoldingField| h.order.iter().filter(|x| **x == f).count();
            let required_once = [HoldingField::Symbol, HoldingField::Quantity, HoldingField::MarketValue]
                .into_iter()
                .all(|f| count(f) == 1);
            let optional_at_most_once = count(HoldingField::Name) <= 1 && count(HoldingField::Price) <= 1;
            if !required_once || !optional_at_most_once || h.quantity_decimals > 6 || h.price_decimals > 6 {
                return Err(Invalid("A statement setting for holdings is incomplete."));
            }
        }
        Ok(())
    }
}

const BUILT_IN_JSON: &[&str] = &[
    include_str!("../../data/statement_layouts/general.json"),
    include_str!("../../data/statement_layouts/general-investment.json"),
];

/// The layouts shipped with the app. Each is covered by tests, so loading cannot fail.
pub fn built_in_layouts() -> Vec<StatementLayout> {
    BUILT_IN_JSON
        .iter()
        .map(|json| StatementLayout::from_json(json).expect("built-in statement layouts are valid"))
        .collect()
}
```

`core/data/statement_layouts/general.json`:

```json
{
  "schema": 1,
  "id": "general",
  "name": "General",
  "dates": { "formats": ["mm_dd_yy", "mm_dd_yyyy", "mm_dd", "mon_dd", "mon_dd_yyyy", "yyyy_mm_dd"], "second_date": true, "ignore_markers": ["*"] },
  "amounts": { "negatives": ["leading_minus", "spaced_minus", "parentheses", "trailing_minus", "cr_suffix"], "currency": "optional", "thousands": "comma", "decimal": "period" },
  "rows": { "amount": "first" },
  "balances": {
    "pairs": [
      { "start": "Previous Balance", "end": "New Balance" },
      { "start": "Beginning Balance", "end": "Ending Balance" },
      { "start": "Opening Balance", "end": "Closing Balance" },
      { "start": "Starting Balance", "end": "Ending Balance" },
      { "start": "Balance Forward", "end": "Ending Balance" }
    ]
  }
}
```

`core/data/statement_layouts/general-investment.json`:

```json
{
  "schema": 1,
  "id": "general-investment",
  "name": "General investment",
  "dates": { "formats": ["mm_dd", "mm_dd_yy", "mm_dd_yyyy", "mon_dd", "mon_dd_yyyy", "yyyy_mm_dd"], "second_date": true, "ignore_markers": ["*"] },
  "amounts": { "negatives": ["leading_minus", "spaced_minus", "parentheses"], "currency": "optional", "thousands": "comma", "decimal": "period" },
  "rows": { "amount": "last" },
  "balances": {
    "pairs": [
      { "start": "Beginning Cash Balance", "end": "Ending Cash Balance" },
      { "start": "Opening Cash Balance", "end": "Closing Cash Balance" },
      { "start": "Cash Beginning Balance", "end": "Cash Ending Balance" }
    ],
    "section_start": ["Account Summary"],
    "activity_totals": [
      { "additions": "Total Additions", "subtractions": "Total Subtractions" },
      { "additions": "Total Credits", "subtractions": "Total Debits" }
    ],
    "value": { "start": "Starting Value", "end": "Total Ending Value" }
  },
  "skip_sections": ["Cash Sweep Activity", "Sweep Activity"],
  "holdings": {
    "heading": ["Account Holdings", "Portfolio Holdings", "Holdings"],
    "order": ["symbol", "name", "quantity", "price", "market_value"],
    "quantity_decimals": 3,
    "price_decimals": 4,
    "total": ["Total Account Holdings", "Total Market Value", "Total Securities", "Total Holdings"],
    "cash": ["Total Cash and Cash Equivalents"]
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p budget_core --lib statement::`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add core/src/lib.rs core/src/statement core/data/statement_layouts
git commit -m "Add the statement model and the validated statement layout format"
```

---

### Task 5: Dates on statement lines

**Files:**
- Create: `core/src/statement/tokens.rs` (dates part); add `pub mod tokens;` to `mod.rs`

**Interfaces:**
- Consumes: `DateFormat`, `DateRules`, `Period`.
- Produces: `pub struct LeadingDate<'a> { pub date: NaiveDate, pub format: DateFormat, pub rest: &'a str }`; `pub fn leading_date<'a>(line: &'a str, rules: &DateRules, period: &Period) -> Option<LeadingDate<'a>>`; `pub fn parse_date_prefix(s: &str, format: DateFormat, period: &Period) -> Option<(NaiveDate, usize)>` (byte length consumed); `pub fn is_date_range(rest: &str, rules: &DateRules, period: &Period) -> bool`.

- [ ] **Step 1: Write the failing tests** (in `tokens.rs`)

```rust
#[cfg(test)]
mod date_tests {
    use super::*;
    use crate::statement::layout::{DateFormat::*, DateRules};

    fn d(s: &str) -> NaiveDate { s.parse().unwrap() }
    fn period(a: &str, b: &str) -> Period { Period::new(d(a), d(b)).unwrap() }
    fn rules(formats: &[DateFormat], second: bool) -> DateRules {
        DateRules { formats: formats.to_vec(), second_date: second, ignore_markers: vec!['*'] }
    }

    #[test]
    fn short_us_dates_with_a_posting_marker() {
        let p = period("2026-07-22", "2026-08-21");
        let found = leading_date("08/05/26* AUTOPAY PAYMENT RECEIVED", &rules(&[MmDdYy], false), &p).unwrap();
        assert_eq!((found.date, found.rest), (d("2026-08-05"), "AUTOPAY PAYMENT RECEIVED"));
    }

    #[test]
    fn a_missing_year_comes_from_the_period_even_across_new_year() {
        let p = period("2026-12-15", "2027-01-14");
        let r = rules(&[MmDd], false);
        assert_eq!(leading_date("12/20 Coffee 4.50", &r, &p).unwrap().date, d("2026-12-20"));
        assert_eq!(leading_date("01/05 Coffee 4.50", &r, &p).unwrap().date, d("2027-01-05"));
    }

    #[test]
    fn a_leap_day_without_a_year_is_found() {
        let p = period("2028-02-01", "2028-02-29");
        assert_eq!(leading_date("02/29 Rent 900.00", &rules(&[MmDd], false), &p).unwrap().date, d("2028-02-29"));
    }

    #[test]
    fn month_names_with_a_posting_date() {
        let p = period("2026-07-25", "2026-08-24");
        let found = leading_date("Aug 1 Aug 3 STARBUCKS 800-782-7282 WA $10.00", &rules(&[MonDd], true), &p).unwrap();
        assert_eq!((found.date, found.rest), (d("2026-08-01"), "STARBUCKS 800-782-7282 WA $10.00"));
    }

    #[test]
    fn a_full_month_name_date_needs_its_own_format() {
        let p = period("2026-07-25", "2026-08-24");
        assert!(leading_date("Jul 25, 2026 - Aug 24, 2026", &rules(&[MonDd], false), &p).is_none());
        let found = leading_date("Jul 25, 2026 - Aug 24, 2026", &rules(&[MonDdYyyy], false), &p).unwrap();
        assert_eq!(found.date, d("2026-07-25"));
        assert!(is_date_range(found.rest, &rules(&[MonDdYyyy], false), &p));
    }

    #[test]
    fn things_that_only_look_like_dates_are_not_dates() {
        let p = period("2026-08-01", "2026-08-31");
        let r = rules(&[MmDdYy, MmDdYyyy, MmDd], false);
        assert!(leading_date("08/05/2026x Store", &r, &p).is_none());
        assert!(leading_date("123/05 Store", &r, &p).is_none());
        assert!(leading_date("13/45/26 Store", &r, &p).is_none());
        assert!(leading_date("09/05/26. This date may not be the same", &r, &p).is_none(), "a date must be followed by a space");
        assert!(leading_date("Closing Date 08/21/26", &r, &p).is_none(), "only at the start of the line");
    }

    #[test]
    fn day_first_dates_only_when_the_layout_says_so() {
        let p = period("2026-08-01", "2026-08-31");
        assert!(leading_date("15/08/2026 Pharmacy 18.45", &rules(&[MmDdYyyy], false), &p).is_none());
        assert_eq!(leading_date("15/08/2026 Pharmacy 18.45", &rules(&[DdMmYyyy], false), &p).unwrap().date, d("2026-08-15"));
    }

    #[test]
    fn iso_dates() {
        let p = period("2026-08-01", "2026-08-31");
        assert_eq!(leading_date("2026-08-09 Gas -30.00", &rules(&[YyyyMmDd], false), &p).unwrap().date, d("2026-08-09"));
    }
}
```

- [ ] **Step 2: Run to verify failure** — `cargo test -p budget_core --lib statement::tokens` → compile error.

- [ ] **Step 3: Implement** (top of `tokens.rs`):

```rust
//! Dates and money on statement lines, recognised by hand (no regular expressions): every accepted form
//! comes from the layout's closed option set.

use super::layout::{AmountRules, Currency, DateFormat, DateRules, DecimalMark, NegativeStyle, Thousands};
use super::model::Period;
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use std::str::FromStr;

const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/// A date at the very start of a line, and what follows it.
#[derive(Debug, Clone, PartialEq)]
pub struct LeadingDate<'a> {
    pub date: NaiveDate,
    pub format: DateFormat,
    pub rest: &'a str,
}

pub fn leading_date<'a>(line: &'a str, rules: &DateRules, period: &Period) -> Option<LeadingDate<'a>> {
    let trimmed = line.trim_start();
    for &format in &rules.formats {
        let Some((date, used)) = parse_date_prefix(trimmed, format, period) else { continue };
        let mut rest = strip_markers(&trimmed[used..], &rules.ignore_markers);
        if !(rest.is_empty() || rest.starts_with(char::is_whitespace)) {
            continue;
        }
        if rules.second_date {
            let r = rest.trim_start();
            if let Some((_, used2)) = parse_date_prefix(r, format, period) {
                let after = strip_markers(&r[used2..], &rules.ignore_markers);
                if after.is_empty() || after.starts_with(char::is_whitespace) {
                    rest = after;
                }
            }
        }
        return Some(LeadingDate { date, format, rest: rest.trim() });
    }
    None
}

/// "- Aug 24, 2026 …" or "to 09/16/2026": the dated line is a period, not a transaction.
pub fn is_date_range(rest: &str, rules: &DateRules, period: &Period) -> bool {
    let r = rest.trim_start();
    let after = if let Some(x) = r.strip_prefix('-').or_else(|| r.strip_prefix('–')) {
        x
    } else if r.len() > 3 && r[..3].eq_ignore_ascii_case("to ") {
        &r[3..]
    } else {
        return false;
    };
    leading_date(after, rules, period).is_some()
}

fn strip_markers<'a>(s: &'a str, markers: &[char]) -> &'a str {
    s.trim_start_matches(|c| markers.contains(&c))
}

fn digits(b: &[u8], start: usize, min: usize, max: usize) -> Option<(u32, usize)> {
    let mut i = start;
    while i < b.len() && i - start < max && b[i].is_ascii_digit() {
        i += 1;
    }
    if i - start < min || (i < b.len() && b[i].is_ascii_digit()) {
        return None;
    }
    std::str::from_utf8(&b[start..i]).ok()?.parse().ok().map(|n| (n, i))
}

fn sep(b: &[u8], i: usize, c: u8) -> Option<usize> {
    (b.get(i) == Some(&c)).then_some(i + 1)
}

fn spaces(b: &[u8], mut i: usize) -> Option<usize> {
    let start = i;
    while i < b.len() && b[i] == b' ' {
        i += 1;
    }
    (i > start).then_some(i)
}

fn month_name(b: &[u8]) -> Option<(u32, usize)> {
    if b.len() < 3 || !b[..3].iter().all(u8::is_ascii_alphabetic) {
        return None;
    }
    let head = std::str::from_utf8(&b[..3]).ok()?.to_ascii_lowercase();
    let month = MONTHS.iter().position(|m| *m == head)? as u32 + 1;
    let mut i = 3;
    while i < b.len() && b[i].is_ascii_alphabetic() {
        i += 1;
    }
    if b.get(i) == Some(&b'.') {
        i += 1;
    }
    Some((month, i))
}

fn infer_year(month: u32, day: u32, period: &Period) -> Option<NaiveDate> {
    let years = [period.start.year() - 1, period.start.year(), period.end.year(), period.end.year() + 1];
    years
        .iter()
        .filter_map(|&y| NaiveDate::from_ymd_opt(y, month, day))
        .min_by_key(|d| period.distance(*d))
}

pub fn parse_date_prefix(s: &str, format: DateFormat, period: &Period) -> Option<(NaiveDate, usize)> {
    let b = s.as_bytes();
    let ymd = |y: i32, m: u32, d: u32| NaiveDate::from_ymd_opt(y, m, d);
    match format {
        DateFormat::MmDdYy | DateFormat::MmDdYyyy | DateFormat::DdMmYy | DateFormat::DdMmYyyy => {
            let (a, i) = digits(b, 0, 1, 2)?;
            let i = sep(b, i, b'/')?;
            let (c, i) = digits(b, i, 1, 2)?;
            let i = sep(b, i, b'/')?;
            let long = matches!(format, DateFormat::MmDdYyyy | DateFormat::DdMmYyyy);
            let (y, i) = if long { digits(b, i, 4, 4)? } else { digits(b, i, 2, 2)? };
            let year = if long { y as i32 } else { 2000 + y as i32 };
            let (m, d) = if matches!(format, DateFormat::DdMmYy | DateFormat::DdMmYyyy) { (c, a) } else { (a, c) };
            Some((ymd(year, m, d)?, i))
        }
        DateFormat::MmDd => {
            let (m, i) = digits(b, 0, 1, 2)?;
            let i = sep(b, i, b'/')?;
            let (d, i) = digits(b, i, 1, 2)?;
            if b.get(i) == Some(&b'/') {
                return None;
            }
            Some((infer_year(m, d, period)?, i))
        }
        DateFormat::YyyyMmDd => {
            let (y, i) = digits(b, 0, 4, 4)?;
            let i = sep(b, i, b'-')?;
            let (m, i) = digits(b, i, 2, 2)?;
            let i = sep(b, i, b'-')?;
            let (d, i) = digits(b, i, 2, 2)?;
            Some((ymd(y as i32, m, d)?, i))
        }
        DateFormat::MonDd => {
            let (m, i) = month_name(b)?;
            let i = spaces(b, i)?;
            let (d, i) = digits(b, i, 1, 2)?;
            if b.get(i) == Some(&b',') {
                return None;
            }
            Some((infer_year(m, d, period)?, i))
        }
        DateFormat::MonDdYyyy => {
            let (m, i) = month_name(b)?;
            let i = spaces(b, i)?;
            let (d, i) = digits(b, i, 1, 2)?;
            let i = sep(b, i, b',')?;
            let i = spaces(b, i)?;
            let (y, i) = digits(b, i, 4, 4)?;
            Some((ymd(y as i32, m, d)?, i))
        }
    }
}
```

- [ ] **Step 4: Run to verify pass** — `cargo test -p budget_core --lib statement::tokens` → PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/statement/mod.rs core/src/statement/tokens.rs
git commit -m "Recognise statement dates, including dates without a year"
```

---

### Task 6: Money and numbers on statement lines

**Files:**
- Modify: `core/src/statement/tokens.rs` (money part)

**Interfaces:**
- Produces: `pub struct Money { pub value: Decimal, pub start: usize, pub end: usize, pub negative_style: Option<NegativeStyle> }` (byte range in the line); `pub fn find_money(line: &str, rules: &AmountRules) -> Vec<Money>`; `pub fn money_token(tok: &str, rules: &AmountRules) -> Option<(Decimal, Option<NegativeStyle>)>`; `pub fn parse_number_token(tok: &str, rules: &AmountRules, decimals: u8) -> Option<Decimal>`; `pub fn without_money(line: &str, money: &[Money]) -> String`; `pub fn permissive_amounts() -> AmountRules` (every negative style, optional currency, comma thousands, period decimal — used by teaching).

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod money_tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn values(line: &str) -> Vec<Decimal> {
        find_money(line, &permissive_amounts()).into_iter().map(|m| m.value).collect()
    }

    #[test]
    fn every_negative_style_seen_on_real_statements() {
        assert_eq!(values("Payments/Credits -$43.08"), vec![dec!(-43.08)]);
        assert_eq!(values("Jul 31 Jul 31 ONLINE PYMT - $3,975.23"), vec![dec!(-3975.23)]);
        assert_eq!(values("($10.84) $144.21"), vec![dec!(-10.84), dec!(144.21)]);
        assert_eq!(values("Transfer received 75.00 CR"), vec![dec!(-75.00)]);
        assert_eq!(values("Refund 12.00-"), vec![dec!(-12.00)]);
    }

    #[test]
    fn only_two_decimal_numbers_are_money() {
        assert_eq!(values("05/12 Audible*AJ63E4WA3 Amzn.com/bill NJ .99"), vec![dec!(0.99)]);
        assert_eq!(values("04/26 AMAZON.COM AMZN.COM/BILLWA 8.64 864"), vec![dec!(8.64)]);
        assert_eq!(values("Bought 10.000 at $43.62 ($436.15)"), vec![dec!(43.62), dec!(-436.15)]);
        assert!(values("REINVEST AT 9.470 Quantity 1.054 252.523 $339.3500 5.500% 1,936 800-782-7282").is_empty());
        assert_eq!(values("New Balance = $1,442.49"), vec![dec!(1442.49)]);
    }

    #[test]
    fn a_style_the_layout_does_not_allow_is_not_money() {
        let mut rules = permissive_amounts();
        rules.negatives = vec![NegativeStyle::LeadingMinus];
        assert!(find_money("($10.84)", &rules).is_empty());
        rules.currency = Currency::Required;
        assert!(find_money("33.91", &rules).is_empty());
        assert_eq!(find_money("$33.91", &rules)[0].value, dec!(33.91));
    }

    #[test]
    fn european_marks() {
        let mut rules = permissive_amounts();
        rules.thousands = Thousands::Period;
        rules.decimal = DecimalMark::Comma;
        assert_eq!(find_money("Miete -1.234,56", &rules)[0].value, dec!(-1234.56));
    }

    #[test]
    fn bad_grouping_is_not_money() {
        assert!(values("12,34.56 1234,567.00").is_empty());
    }

    #[test]
    fn numbers_with_a_set_number_of_decimals() {
        let r = permissive_amounts();
        assert_eq!(parse_number_token("252.523", &r, 3), Some(dec!(252.523)));
        assert_eq!(parse_number_token("$339.3500", &r, 4), Some(dec!(339.35)));
        assert_eq!(parse_number_token("10.5000", &r, 3), None);
        assert_eq!(parse_number_token("1,050", &r, 0), Some(dec!(1050)));
    }

    #[test]
    fn the_text_around_the_money_is_kept() {
        let line = "Jul 31 ONLINE PYMT - $3,975.23 thanks";
        let money = find_money(line, &permissive_amounts());
        assert_eq!(without_money(line, &money), "Jul 31 ONLINE PYMT thanks");
    }
}
```

Add `rust_decimal_macros = "1"` to `[dev-dependencies]` in `core/Cargo.toml` if it is not already there.

- [ ] **Step 2: Run to verify failure** — `cargo test -p budget_core --lib statement::tokens::money_tests` → compile error.

- [ ] **Step 3: Implement** (append to `tokens.rs`, above the test modules):

```rust
/// A money amount on a line: its signed value, where it sits, and how a negative was written.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Money {
    pub value: Decimal,
    pub start: usize,
    pub end: usize,
    pub negative_style: Option<NegativeStyle>,
}

/// The widest reasonable reading, for teaching and for downloads.
pub fn permissive_amounts() -> AmountRules {
    AmountRules {
        negatives: vec![
            NegativeStyle::LeadingMinus,
            NegativeStyle::SpacedMinus,
            NegativeStyle::Parentheses,
            NegativeStyle::TrailingMinus,
            NegativeStyle::CrSuffix,
            NegativeStyle::DrSuffix,
        ],
        currency: Currency::Optional,
        thousands: Thousands::Comma,
        decimal: DecimalMark::Period,
    }
}

fn tokens(line: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start = None;
    for (i, c) in line.char_indices() {
        if c.is_whitespace() {
            if let Some(s) = start.take() {
                out.push((s, i));
            }
        } else if start.is_none() {
            start = Some(i);
        }
    }
    if let Some(s) = start {
        out.push((s, line.len()));
    }
    out
}

fn suffix_style(tok: &str, rules: &AmountRules) -> Option<NegativeStyle> {
    let style = if tok.eq_ignore_ascii_case("CR") {
        NegativeStyle::CrSuffix
    } else if tok.eq_ignore_ascii_case("DR") {
        NegativeStyle::DrSuffix
    } else {
        return None;
    };
    rules.negatives.contains(&style).then_some(style)
}

/// Every money amount on the line, in order.
pub fn find_money(line: &str, rules: &AmountRules) -> Vec<Money> {
    let toks = tokens(line);
    let mut out = Vec::new();
    let mut i = 0;
    while i < toks.len() {
        let (s, e) = toks[i];
        let tok = &line[s..e];
        if tok == "-" && rules.negatives.contains(&NegativeStyle::SpacedMinus) {
            if let Some(&(ns, ne)) = toks.get(i + 1) {
                if let Some((v, None)) = money_token(&line[ns..ne], rules) {
                    out.push(Money { value: -v, start: s, end: ne, negative_style: Some(NegativeStyle::SpacedMinus) });
                    i += 2;
                    continue;
                }
            }
        }
        if let Some((mut value, mut style)) = money_token(tok, rules) {
            let mut end = e;
            if style.is_none() {
                if let Some(&(ns, ne)) = toks.get(i + 1) {
                    if let Some(suffix) = suffix_style(&line[ns..ne], rules) {
                        value = -value;
                        style = Some(suffix);
                        end = ne;
                        i += 1;
                    }
                }
            }
            out.push(Money { value, start: s, end, negative_style: style });
        }
        i += 1;
    }
    out
}

/// One whitespace-free token as money: its signed value and how a negative was written.
pub fn money_token(tok: &str, rules: &AmountRules) -> Option<(Decimal, Option<NegativeStyle>)> {
    let allows = |s: NegativeStyle| rules.negatives.contains(&s);
    let mut t = tok.trim_end_matches([',', ';']);
    let mut style = None;
    if t.len() > 2 && t.starts_with('(') && t.ends_with(')') {
        if !allows(NegativeStyle::Parentheses) {
            return None;
        }
        t = &t[1..t.len() - 1];
        style = Some(NegativeStyle::Parentheses);
    }
    if style.is_none() && t.len() > 2 {
        let upper = t[t.len() - 2..].to_ascii_uppercase();
        let candidate = match upper.as_str() {
            "CR" => Some(NegativeStyle::CrSuffix),
            "DR" => Some(NegativeStyle::DrSuffix),
            _ => None,
        };
        if let Some(s) = candidate {
            if t[..t.len() - 2].ends_with(|c: char| c.is_ascii_digit()) {
                if !allows(s) {
                    return None;
                }
                t = &t[..t.len() - 2];
                style = Some(s);
            }
        }
    }
    if style.is_none() && t.starts_with('-') {
        if !allows(NegativeStyle::LeadingMinus) {
            return None;
        }
        t = &t[1..];
        style = Some(NegativeStyle::LeadingMinus);
    }
    if style.is_none() && t.len() > 1 && t.ends_with('-') {
        if !allows(NegativeStyle::TrailingMinus) {
            return None;
        }
        t = &t[..t.len() - 1];
        style = Some(NegativeStyle::TrailingMinus);
    }
    let had_symbol = t.starts_with('$');
    if had_symbol {
        t = &t[1..];
    } else if rules.currency == Currency::Required {
        return None;
    }
    if style.is_none() && had_symbol && t.starts_with('-') {
        if !allows(NegativeStyle::LeadingMinus) {
            return None;
        }
        t = &t[1..];
        style = Some(NegativeStyle::LeadingMinus);
    }
    let magnitude = plain_number(t, rules, Some(2))?;
    Some((if style.is_some() { -magnitude } else { magnitude }, style))
}

/// A number with exactly `decimals` digits after the decimal mark (0 = a whole number), with an
/// optional leading `$`. Used for share quantities and prices.
pub fn parse_number_token(tok: &str, rules: &AmountRules, decimals: u8) -> Option<Decimal> {
    let t = tok.trim_end_matches([',', ';']);
    let t = t.strip_prefix('$').unwrap_or(t);
    plain_number(t, rules, Some(decimals as usize))
}

fn marks(rules: &AmountRules) -> (char, Option<char>) {
    let decimal = match rules.decimal {
        DecimalMark::Period => '.',
        DecimalMark::Comma => ',',
    };
    let thousands = match rules.thousands {
        Thousands::Comma => Some(','),
        Thousands::Period => Some('.'),
        Thousands::Apostrophe => Some('\''),
        Thousands::None => None,
    };
    (decimal, thousands)
}

fn plain_number(t: &str, rules: &AmountRules, decimals: Option<usize>) -> Option<Decimal> {
    let (decimal, thousands) = marks(rules);
    let (int_part, frac) = match t.rfind(decimal) {
        Some(p) => (&t[..p], Some(&t[p + decimal.len_utf8()..])),
        None => (t, None),
    };
    let frac_ok = |f: &str| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit());
    match (decimals, frac) {
        (Some(0), None) | (None, None) => {}
        (Some(n), Some(f)) if n > 0 && f.len() == n && frac_ok(f) => {}
        (None, Some(f)) if frac_ok(f) => {}
        _ => return None,
    }
    if int_part.is_empty() {
        frac?;
    } else {
        let groups: Vec<&str> = match thousands {
            Some(c) => int_part.split(c).collect(),
            None => vec![int_part],
        };
        if groups.iter().any(|g| g.is_empty() || !g.bytes().all(|b| b.is_ascii_digit())) {
            return None;
        }
        if groups.len() > 1 && (groups[0].len() > 3 || groups[1..].iter().any(|g| g.len() != 3)) {
            return None;
        }
    }
    let digits: String = int_part.chars().filter(char::is_ascii_digit).collect();
    let text = match frac {
        Some(f) => format!("{}.{}", if digits.is_empty() { "0" } else { &digits }, f),
        None => digits,
    };
    Decimal::from_str(&text).ok()
}

/// The line with its money removed and whitespace tidied — what's left is description.
pub fn without_money(line: &str, money: &[Money]) -> String {
    let mut out = String::new();
    let mut at = 0;
    for m in money {
        out.push_str(&line[at..m.start]);
        out.push(' ');
        at = m.end;
    }
    out.push_str(&line[at..]);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}
```

- [ ] **Step 4: Run to verify pass** — `cargo test -p budget_core --lib statement::tokens` → PASS.

- [ ] **Step 5: Commit**

```bash
git add core/Cargo.toml core/src/statement/tokens.rs
git commit -m "Recognise money and share numbers on statement lines"
```

---

### Task 7: Fictional fixture statements and a tiny PDF writer

**Files:**
- Create: `core/src/statement/fixture_pdf.rs`; add `pub mod fixture_pdf;` to `mod.rs`

**Interfaces:**
- Produces: `pub fn build_pdf(pages: &[Vec<String>]) -> Vec<u8>`; `pub fn fixture(name: &str) -> Option<(Vec<Vec<String>>, (NaiveDate, NaiveDate))>` returning the pages and the period, for names `card-a`, `card-b`, `card-c`, `credit-union`, `mortgage`, `brokerage`, `brokerage-quarterly`, `unknown-bank`, `unknown-bank-next`, `unknown-brokerage`, `unknown-brokerage-next`; `pub fn fixture_lines(name: &str) -> (Vec<StatementLine>, Period)` (pages flattened, for parser tests that skip the PDF step); `pub const FIXTURE_NAMES: &[&str]`.

All fixture names, institutions, numbers and amounts are fictional. They copy only the **shape** of the six real layouts and of two unknown ones.

- [ ] **Step 1: Write the failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pdf_is_well_formed_enough_to_find_its_cross_reference_table() {
        let pdf = build_pdf(&[vec!["Hello (world)".into(), "Second line".into()]]);
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.starts_with("%PDF-1.4"));
        let startxref: usize = text.rsplit("startxref\n").next().unwrap().lines().next().unwrap().parse().unwrap();
        assert!(text[startxref..].starts_with("xref"));
        assert!(text.contains("(Hello \\(world\\)) Tj"));
    }

    #[test]
    fn every_fixture_has_a_period_and_lines() {
        for name in FIXTURE_NAMES {
            let (lines, period) = fixture_lines(name);
            assert!(!lines.is_empty(), "{name}");
            assert!(period.start <= period.end, "{name}");
        }
        assert!(fixture("no-such-fixture").is_none());
    }
}
```

- [ ] **Step 2: Run to verify failure** — `cargo test -p budget_core --lib statement::fixture_pdf` → compile error.

- [ ] **Step 3: Implement** `core/src/statement/fixture_pdf.rs`:

```rust
//! A tiny PDF writer for tests, and fictional statements copying the shapes of real layouts. Each line
//! is drawn by its own text operation at its own height, in order, so the PDF's content order is exactly
//! the order given. No real names, institutions, account numbers or amounts appear here.

use super::model::{Period, StatementLine};
use chrono::NaiveDate;

pub fn build_pdf(pages: &[Vec<String>]) -> Vec<u8> {
    let mut objects: Vec<String> = Vec::new();
    let page_ids: Vec<usize> = (0..pages.len()).map(|i| 4 + i * 2).collect();
    objects.push("<< /Type /Catalog /Pages 2 0 R >>".into());
    objects.push(format!(
        "<< /Type /Pages /Kids [{}] /Count {} >>",
        page_ids.iter().map(|id| format!("{id} 0 R")).collect::<Vec<_>>().join(" "),
        pages.len()
    ));
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".into());
    for (i, lines) in pages.iter().enumerate() {
        assert!(lines.len() <= 60, "fixture pages hold at most 60 lines");
        objects.push(format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>",
            page_ids[i] + 1
        ));
        let mut stream = String::from("BT\n/F1 9 Tf\n");
        for (n, line) in lines.iter().enumerate() {
            let y = 760 - (n as i64) * 12;
            stream.push_str(&format!("1 0 0 1 40 {y} Tm\n({}) Tj\n", escape(line)));
        }
        stream.push_str("ET\n");
        objects.push(format!("<< /Length {} >>\nstream\n{}endstream", stream.len(), stream));
    }
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, body).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for offset in offsets {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).as_bytes(),
    );
    out
}

fn escape(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars().filter(|c| c.is_ascii() && !c.is_control()) {
        if matches!(c, '(' | ')' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

pub const FIXTURE_NAMES: &[&str] = &[
    "card-a",
    "card-b",
    "card-c",
    "credit-union",
    "mortgage",
    "brokerage",
    "brokerage-quarterly",
    "unknown-bank",
    "unknown-bank-next",
    "unknown-brokerage",
    "unknown-brokerage-next",
];

fn d(s: &str) -> NaiveDate {
    s.parse().expect("fixture dates are valid")
}

fn page(lines: &[&str]) -> Vec<String> {
    lines.iter().map(|s| s.to_string()).collect()
}

pub fn fixture(name: &str) -> Option<(Vec<Vec<String>>, (NaiveDate, NaiveDate))> {
    Some(match name {
        // A card: "Previous/New Balance", MM/DD/YY dates with a posting marker, the amount on its own line.
        "card-a" => (
            vec![
                page(&[
                    "Northwind Card Services",
                    "Closing Date 08/21/26",
                    "New Balance",
                    "$52.36",
                    "Payment Due Date 09/15/26",
                    "Previous Balance $43.08",
                    "Payments/Credits -$43.08",
                ]),
                page(&[
                    "Payments and Credits",
                    "Detail *Indicates posting date",
                    "08/05/26* AUTOPAY PAYMENT RECEIVED - THANK YOU",
                    "Sample Bank Branch",
                    "-$43.08",
                    "New Charges",
                    "07/24/26 STREAMING SERVICE INTERNET CHARGE CA",
                    "MUSIC STORE",
                    "$7.40",
                    "07/27/26 STREAMING SERVICE INTERNET CHARGE CA",
                    "$2.99",
                    "08/17/26 CLOUD STORAGE INTERNET CHARGE CA",
                    "$11.99",
                    "08/20/26 VIDEO SERVICE SANTA MONICA CA",
                    "$19.99",
                    "08/20/26 HOME CAMERA PLAN HAWTHORNE CA",
                    "$9.99",
                    "Total Fees for this Period $0.00",
                    "09/05/26. This date may not be the same date your bank will debit your",
                ]),
            ],
            (d("2026-07-22"), d("2026-08-21")),
        ),
        // A card: MM/DD without a year, amounts without "$", a rewards-points column and order-number lines,
        // plus a rewards section that repeats a purchase and must be skipped.
        "card-b" => (
            vec![page(&[
                "ACCOUNT SUMMARY",
                "Previous Balance $33.33",
                "Payment, Credits -$33.33",
                "New Balance $34.90",
                "Opening/Closing Date 04/27/26 - 05/26/26",
                "ACCOUNT ACTIVITY",
                "PAYMENTS AND OTHER CREDITS",
                "04/30 Payment Thank You - Web -33.33",
                "PURCHASE",
                "05/05 ONLINE MARKET*AB12 Market.example/bill WA 33.91",
                "Order Number 111-2222222-3333333",
                "05/12 AUDIOBOOKS*XY Market.example/bill NJ .99",
                "Order Number D01-4444444-5555555",
                "REWARDS ACTIVITY",
                "04/26 ONLINE MARKET MARKET.EXAMPLE/BILLWA 8.64 864",
            ])],
            (d("2026-04-27"), d("2026-05-26")),
        ),
        // A card: "Mon D Mon D" transaction and posting dates, payments as "- $1,234.56".
        "card-c" => (
            vec![page(&[
                "Previous Balance $3,651.55",
                "Payments - $9,775.23",
                "New Balance = $1,442.49",
                "Jul 25, 2026 - Aug 24, 2026 | 31 days in Billing Cycle",
                "Payments, Credits and Adjustments",
                "Trans Date Post Date Description Amount",
                "Jul 31 Jul 31 ONLINE PAYMENT - $3,975.23",
                "Aug 10 Aug 10 ONLINE PAYMENT - $5,800.00",
                "Transactions",
                "Jul 27 Jul 28 FOOD DELIVERY HELP.EXAMPLE CA $44.90",
                "Jul 30 Jul 31 ADOPTION SERVICES GA $5,798.00",
                "Aug 2 Aug 3 WAREHOUSE CLUB #100 SPRINGFIELD MI $70.54",
                "Aug 4 Aug 4 AI ASSISTANT SUB EXAMPLE.COM CA $20.00",
                "Aug 16 Aug 18 GROCERY STORE #020 SPRINGFIELD MI $142.09",
                "Aug 18 Aug 19 VIDEO PRIME*F48 Market.example/bill WA $1,490.64",
            ])],
            (d("2026-07-25"), d("2026-08-24")),
        ),
        // Several accounts in one statement, brackets for money out, a running balance after each amount.
        "credit-union" => (
            vec![page(&[
                "Statement Period 08/01/2026 - 08/31/2026",
                "MEMBER SAVINGS Share Account ID 00",
                "Aug 01 Beginning Balance $6.44",
                "Aug 31 Ending Balance $6.44",
                "EVERYDAY CHECKING Share Account ID 01",
                "Total Deposits $130.00",
                "Total Withdrawals $41.81",
                "Trans Eff Date Transaction Withdrawal Deposit Balance",
                "Aug 01 Beginning Balance $155.05",
                "Aug 06 Aug 06 Withdrawal Debit Card Debit Card",
                "2400000000000001 CORNER CAFE",
                "MI 08/06/2026",
                "($10.84) $144.21",
                "Aug 07 Aug 07 Deposit ACH EXAMPLE EMPLOYER TYPE: PAYROLL",
                "$65.00 $209.21",
                "Aug 13 Aug 13 Withdrawal Bill Payment MUSIC SERVICE",
                "($0.99) $208.22",
                "Aug 21 Aug 21 Deposit ACH EXAMPLE EMPLOYER TYPE: PAYROLL",
                "$65.00 $273.22",
                "Aug 24 Aug 24 Withdrawal Debit Card Debit Card",
                "2400000000000002 WING PLACE",
                "($29.98) $243.24",
                "Aug 31 Ending Balance $243.24",
            ])],
            (d("2026-08-01"), d("2026-08-31")),
        ),
        // A home loan: an ending principal only, and a payment split into columns with the total last.
        "mortgage" => (
            vec![page(&[
                "HOME LOAN STATEMENT",
                "Payment Due Date 10/01/2026",
                "Principal $356.80",
                "Interest $1,452.18",
                "Regular Monthly Payment $2,405.94",
                "Outstanding Principal $316,840.29",
                "Escrow Balance $2,144.35",
                "Transaction Activity (08/18/2026 to 09/16/2026)",
                "Date Description Principal Interest Escrow Total",
                "09/01/26 Payment $355.17 $1,453.81 $596.96 $2,405.94",
                "09/10/26 Mortgage Insurance",
                "($85.12) ($85.12)",
            ])],
            (d("2026-08-18"), d("2026-09-16")),
        ),
        "brokerage" => (brokerage(false), (d("2026-08-01"), d("2026-08-31"))),
        "brokerage-quarterly" => (brokerage(true), (d("2026-08-01"), d("2026-08-31"))),
        // An unknown bank: day-first dates, money out printed positive, money in marked CR.
        "unknown-bank" => (unknown_bank("08", "1,250.00", "3,132.00"), (d("2026-08-01"), d("2026-08-31"))),
        "unknown-bank-next" => (unknown_bank("09", "3,132.00", "5,014.00"), (d("2026-09-01"), d("2026-09-30"))),
        // An unknown brokerage: cash balances, "Total Market Value", four-decimal quantities, prices with two.
        "unknown-brokerage" => (unknown_brokerage("08"), (d("2026-08-01"), d("2026-08-31"))),
        "unknown-brokerage-next" => (unknown_brokerage("09"), (d("2026-09-01"), d("2026-09-30"))),
        _ => return None,
    })
}

fn brokerage(quarterly: bool) -> Vec<Vec<String>> {
    let mut activity = vec!["Activity Summary", "Total Additions $53.68 $119.03 $75,063.68", "Total Subtractions ($9.98) ($9,559.36) ($73,126.87)", "Activity Details", "Date Security ID / Description Transaction Amount"];
    if quarterly {
        activity.push("07/16 ABCD ALPHA HOLDINGS INC CL A Bought 10.000 at $43.62 ($436.15)");
        activity.push("07/16 EFGH EXAMPLE INCOME FUND CL I2 Bought 38.528 at $9.59 ($369.48)");
    }
    activity.extend([
        "08/03 EFGH EXAMPLE INCOME FUND CL I2 REINVEST AT 9.470 Dividend Reinvest Quantity 1.054 ($9.98)",
        "08/03 EFGH EXAMPLE INCOME FUND CL I2 073126 251.46900 AS OF",
        "Cash Dividend $9.98",
        "08/05 IJKL CORE BOND ETF 080526 97 Cash Dividend $18.50",
        "08/07 MNOP SHORT BOND ETF 080726 100 Cash Dividend $17.58",
        "08/10 QRST FREE CASH FLOW ETF 081026 50 Cash Dividend $1.67",
        "08/28 UVWX LARGE CAP DIVIDEND ETF 082826 42 Cash Dividend $5.46",
        "08/31 DEPOSIT CASH ACCOUNT 083126 1,936 Interest $0.49",
        "Cash Sweep Activity",
        "Date Description Transaction Amount",
        "08/03 DEPOSIT CASH ACCOUNT Sweep (Deposit) $9.98",
        "08/05 DEPOSIT CASH ACCOUNT Sweep (Deposit) $18.50",
    ]);
    vec![
        page(&[
            "Portfolio Summary August 2026",
            "Starting Value $94,870.66 $0.00",
            "Portfolio Ending Value $95,312.79 $95,312.79",
            "Account Summary",
            "Growth Account",
            "Starting Value $83,349.13 $83,863.17 $0.00",
            "Total Ending Value $84,089.71 $84,089.71 $84,089.71",
            "Account Holdings",
            "Cash and Cash Equivalents",
            "Total Cash and Cash Equivalents $1,936.81",
            "Security ID / Description Quantity Price Market Value",
            "ABCD ALPHA HOLDINGS INC CL A",
            "C",
            "50.000",
            "$339.3500",
            "$16,967.50 $44.00",
            "0.26%",
            "EFGH EXAMPLE INCOME FUND CL",
            "I2",
            "252.523",
            "$9.4700",
            "$2,391.39 $115.00",
            "Total Account Holdings",
            "Market Value",
            "$21,295.70 $159.00",
        ]),
        page(&activity),
        page(&[
            "Account Summary",
            "Income Account",
            "Starting Value $10,951.09 $11,007.49 $0.00",
            "Total Ending Value $11,223.08 $11,223.08 $11,223.08",
            "Account Holdings",
            "YZAB TREASURY ETF",
            "20.000",
            "$50.0000",
            "$1,000.00 $30.00",
            "Total Account Holdings",
            "Market Value",
            "$1,000.00 $30.00",
            "Activity Summary",
            "Total Additions $7.95 $15.29 $13,165.02",
            "Total Subtractions ($1.81) ($714.14) ($12,381.39)",
            "Activity Details",
            "08/15 YZAB TREASURY ETF 081526 20 Cash Dividend $7.95",
            "08/31 ADVISORY FEE ($1.81)",
            "Cash Sweep Activity",
            "08/15 DEPOSIT CASH ACCOUNT Sweep (Deposit) $7.95",
        ]),
    ]
}

fn unknown_bank(month: &str, opening: &str, closing: &str) -> Vec<Vec<String>> {
    let line = |day: &str, rest: &str| format!("{day}/{month}/2026 {rest}");
    vec![vec![
        "Riverbend Mutual Bank".into(),
        "Everyday Account Statement".into(),
        format!("Opening balance {opening}"),
        "Date Details Amount".into(),
        line("03", "Supermarket purchase 54.20"),
        line("05", "Salary EXAMPLE EMPLOYER 2,000.00 CR"),
        line("12", "Electricity bill 120.35"),
        line("19", "Pharmacy 18.45"),
        line("27", "Transfer received 75.00 CR"),
        format!("Closing balance {closing}"),
    ]]
}

fn unknown_brokerage(month: &str) -> Vec<Vec<String>> {
    vec![vec![
        "Harborview Investing".into(),
        "Account Summary".into(),
        "Brokerage Account".into(),
        "Beginning Cash Balance $500.00".into(),
        "Ending Cash Balance $1,212.40".into(),
        "Holdings".into(),
        "Symbol Description Quantity Price Value".into(),
        "QQQZ NASDAQ TRACKER FUND".into(),
        "10.5000 $300.25 $3,152.63".into(),
        "VTIZ TOTAL MARKET FUND".into(),
        "4.0000 $250.10 $1,000.40".into(),
        "Total Market Value $4,153.03".into(),
        "Activity".into(),
        format!("{month}/02/2026 Deposit from bank $1,000.00"),
        format!("{month}/09/2026 Bought QQQZ 1.0000 at $300.10 -$300.10"),
        format!("{month}/20/2026 Dividend VTIZ $12.50"),
    ]]
}

/// The fixture's pages flattened into lines, for parser tests that skip the PDF step.
pub fn fixture_lines(name: &str) -> (Vec<StatementLine>, Period) {
    let (pages, (start, end)) = fixture(name).unwrap_or_else(|| panic!("no fixture {name}"));
    let lines = pages
        .iter()
        .enumerate()
        .flat_map(|(page, lines)| lines.iter().map(move |text| StatementLine { page, text: text.clone() }))
        .collect();
    (lines, Period::new(start, end).expect("fixture periods are valid"))
}
```

Note: `unknown-bank-next` reuses the same rows; its opening is August's closing and its closing is that plus August's net change (+1,882.00), so it adds up the same way.

- [ ] **Step 4: Run to verify pass** — `cargo test -p budget_core --lib statement::fixture_pdf` → PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/statement/mod.rs core/src/statement/fixture_pdf.rs
git commit -m "Add fictional statement fixtures and a tiny PDF writer for tests"
```

---

### Task 8: PDF text in content order (library gate, part 1)

**Files:**
- Modify: `core/Cargo.toml` (`pdf_oxide`), `docs/THIRD-PARTY-NOTICES.txt` (add pdf_oxide's MIT notice in the existing format)
- Create: `core/src/statement/pdf_text.rs`; add `pub mod pdf_text;` to `mod.rs`

**Interfaces:**
- Produces: `pub const MAX_STATEMENT_BYTES: usize = 20 * 1024 * 1024`; `pub const MAX_STATEMENT_PAGES: usize = 200`; `pub enum PdfTextError { TooLarge, TooManyPages, Encrypted, NoText, Unreadable }` (with `Display` giving the spec's messages); `pub fn read_pdf_lines(bytes: Vec<u8>) -> Result<Vec<StatementLine>, PdfTextError>`; `pub(crate) fn group_into_lines(page: usize, spans: impl IntoIterator<Item = (String, f32, f32)>) -> Vec<StatementLine>`.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::fixture_pdf::{build_pdf, fixture};

    #[test]
    fn spans_on_one_baseline_join_and_a_new_baseline_starts_a_line() {
        let lines = group_into_lines(
            0,
            vec![("08/05/26".to_string(), 700.0, 9.0), ("AUTOPAY".to_string(), 700.2, 9.0), ("-$43.08".to_string(), 688.0, 9.0)],
        );
        assert_eq!(lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>(), vec!["08/05/26 AUTOPAY", "-$43.08"]);
    }

    #[test]
    fn a_fixture_pdf_reads_back_in_content_order() {
        for name in ["card-a", "credit-union", "brokerage"] {
            let (pages, _) = fixture(name).unwrap();
            let lines = read_pdf_lines(build_pdf(&pages)).unwrap();
            let expected: Vec<(usize, String)> =
                pages.iter().enumerate().flat_map(|(p, ls)| ls.iter().map(move |l| (p, l.trim().to_string()))).collect();
            let got: Vec<(usize, String)> = lines.into_iter().map(|l| (l.page, l.text)).collect();
            assert_eq!(got, expected, "{name}");
        }
    }

    #[test]
    fn a_pdf_without_text_is_reported_as_a_picture() {
        assert_eq!(read_pdf_lines(build_pdf(&[vec![], vec![]])), Err(PdfTextError::NoText));
    }

    #[test]
    fn garbage_is_unreadable_and_huge_files_are_refused_first() {
        assert_eq!(read_pdf_lines(b"not a pdf at all".to_vec()), Err(PdfTextError::Unreadable));
        assert_eq!(read_pdf_lines(vec![0u8; MAX_STATEMENT_BYTES + 1]), Err(PdfTextError::TooLarge));
    }

    #[test]
    fn messages_are_plain() {
        assert!(PdfTextError::NoText.to_string().contains("picture of the statement"));
        assert!(PdfTextError::Encrypted.to_string().contains("save an unlocked copy"));
    }
}
```

- [ ] **Step 2: Run to verify failure** — compile error (no `pdf_text`).

- [ ] **Step 3: Add the dependency and check its weight**

In `core/Cargo.toml` `[dependencies]` add `pdf_oxide = "0.3"`. Then (PowerShell):

```powershell
cargo tree -p budget_core -e normal --prefix none | Select-String -Pattern '^(ort|tract|pyo3|image|onnx)' 
```

Expected: no output. If any heavy optional crate appears, change the line to `pdf_oxide = { version = "0.3", default-features = false }` and re-run; text extraction must still compile. Record the chosen form in the commit message.

- [ ] **Step 4: Implement** `core/src/statement/pdf_text.rs`:

```rust
//! The only file that touches the PDF library: statement bytes in, text lines in content order out.
//! Swapping the library means changing this file alone.

use super::model::StatementLine;

pub const MAX_STATEMENT_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_STATEMENT_PAGES: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdfTextError {
    TooLarge,
    TooManyPages,
    Encrypted,
    NoText,
    Unreadable,
}

impl std::fmt::Display for PdfTextError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            PdfTextError::TooLarge | PdfTextError::TooManyPages => "This file is too large to be a monthly statement.",
            PdfTextError::Encrypted | PdfTextError::Unreadable => {
                "This PDF can't be opened. If it has a password, save an unlocked copy from your bank's website."
            }
            PdfTextError::NoText => {
                "This PDF is a picture of the statement, so the app can't read its text. You can use your bank's CSV or OFX download, or reconcile by hand."
            }
        })
    }
}

impl std::error::Error for PdfTextError {}

pub fn read_pdf_lines(bytes: Vec<u8>) -> Result<Vec<StatementLine>, PdfTextError> {
    if bytes.len() > MAX_STATEMENT_BYTES {
        return Err(PdfTextError::TooLarge);
    }
    let doc = pdf_oxide::PdfDocument::from_bytes(bytes).map_err(classify)?;
    if doc.is_encrypted() && !doc.authenticate(b"").unwrap_or(false) {
        return Err(PdfTextError::Encrypted);
    }
    let pages = doc.page_count().map_err(classify)?;
    if pages > MAX_STATEMENT_PAGES {
        return Err(PdfTextError::TooManyPages);
    }
    let mut lines = Vec::new();
    for page in 0..pages {
        let spans = doc.extract_spans(page).map_err(classify)?;
        lines.extend(group_into_lines(page, spans.into_iter().map(|s| (s.text, s.bbox.y, s.font_size))));
    }
    if lines.is_empty() {
        return Err(PdfTextError::NoText);
    }
    Ok(lines)
}

fn classify(error: pdf_oxide::error::Error) -> PdfTextError {
    let text = error.to_string().to_ascii_lowercase();
    if text.contains("encrypt") || text.contains("password") { PdfTextError::Encrypted } else { PdfTextError::Unreadable }
}

/// Spans arrive in the order the PDF draws them. A new line starts when the baseline moves by more
/// than half the font size; spans on one baseline are joined with a space.
pub(crate) fn group_into_lines(page: usize, spans: impl IntoIterator<Item = (String, f32, f32)>) -> Vec<StatementLine> {
    let mut lines: Vec<StatementLine> = Vec::new();
    let mut last: Option<(f32, f32)> = None;
    for (text, y, size) in spans {
        if text.trim().is_empty() {
            continue;
        }
        let same_line = last.is_some_and(|(ly, ls)| (y - ly).abs() <= ls.max(size).max(1.0) * 0.5);
        match lines.last_mut() {
            Some(line) if same_line => {
                if !line.text.ends_with(' ') && !text.starts_with(' ') {
                    line.text.push(' ');
                }
                line.text.push_str(&text);
            }
            _ => lines.push(StatementLine { page, text: text.clone() }),
        }
        last = Some((y, size));
    }
    for line in &mut lines {
        line.text = line.text.split_whitespace().collect::<Vec<_>>().join(" ");
    }
    lines
}
```

If the field names on `pdf_oxide`'s span type differ (check with `cargo doc -p pdf_oxide --no-deps --open` or the docs.rs page for `TextSpan`), adapt only the closure in `read_pdf_lines`.

- [ ] **Step 5: Run to verify pass**

Run: `cargo test -p budget_core --lib statement::pdf_text`
Expected: PASS.

**Gate:** if `a_fixture_pdf_reads_back_in_content_order` fails because spans come back merged across lines or re-ordered, replace the loop body with `doc.extract_text(page)` split on `'\n'` (each non-empty trimmed line becomes a `StatementLine`). If that also fails, switch the dependency to `pdf-extract = "0.7"` and build lines from `pdf_extract::extract_text_from_mem(&bytes)` split on `'\n'` with form feeds (`'\x0c'`) as page breaks; `PdfTextError` and the tests stay the same. Task 13's real-statement check is the second half of this gate.

- [ ] **Step 6: Commit**

```bash
git add core/Cargo.toml Cargo.lock core/src/statement/mod.rs core/src/statement/pdf_text.rs docs/THIRD-PARTY-NOTICES.txt
git commit -m "Read statement PDF text in content order through one adapter"
```

---

### Task 9: Rows

**Files:**
- Create: `core/src/statement/rows.rs`; add `pub mod rows;`

**Interfaces:**
- Consumes: `leading_date`, `is_date_range`, `find_money`, `without_money`, `StatementLayout`, `Period`.
- Produces: `pub struct RowReader<'l>` with `RowReader::new(layout: &'l StatementLayout, period: Period) -> Self`, `push_line(&mut self, index: usize, text: &str)`, `flush(&mut self)`, and public fields `rows: Vec<StatementRow>`, `unread: Vec<UnreadLine>`, `dropped: usize`; `pub const MAX_EXTRA_LINES: usize = 4`.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::layout::{built_in_layouts, AmountPosition, GENERAL_ID};
    use rust_decimal_macros::dec;

    fn general() -> StatementLayout {
        built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap()
    }
    fn period(a: &str, b: &str) -> Period {
        Period::new(a.parse().unwrap(), b.parse().unwrap()).unwrap()
    }
    fn read(layout: &StatementLayout, p: Period, lines: &[&str]) -> RowReader<'static> {
        let layout: &'static StatementLayout = Box::leak(Box::new(layout.clone()));
        let mut r = RowReader::new(layout, p);
        for (i, l) in lines.iter().enumerate() {
            r.push_line(i, l);
        }
        r.flush();
        r
    }

    #[test]
    fn a_row_can_wrap_over_several_lines() {
        let r = read(&general(), period("2026-07-22", "2026-08-21"), &["08/05/26* AUTOPAY PAYMENT RECEIVED", "Sample Bank Branch", "-$43.08"]);
        assert_eq!(r.rows.len(), 1);
        assert_eq!(r.rows[0].amount, dec!(-43.08));
        assert_eq!(r.rows[0].description, "AUTOPAY PAYMENT RECEIVED Sample Bank Branch");
        assert_eq!(r.rows[0].line, 0);
    }

    #[test]
    fn a_dated_line_with_no_amount_goes_to_couldnt_read() {
        let r = read(&general(), period("2026-08-01", "2026-08-31"), &["08/10/26 Mystery line", "a", "b", "c", "d", "e", "08/11/26 Coffee 4.50"]);
        assert_eq!(r.unread.len(), 1);
        assert_eq!(r.unread[0].text, "08/10/26 Mystery line");
        assert_eq!(r.rows.len(), 1);
    }

    #[test]
    fn a_date_range_line_is_not_a_row() {
        let r = read(&general(), period("2026-07-25", "2026-08-24"), &["Jul 25, 2026 - Aug 24, 2026 | 31 days in Billing Cycle", "Jul 31 Jul 31 ONLINE PAYMENT - $3,975.23"]);
        assert!(r.unread.is_empty());
        assert_eq!(r.rows.len(), 1);
    }

    #[test]
    fn rows_well_outside_the_period_are_dropped_quietly() {
        let r = read(&general(), period("2026-08-01", "2026-08-31"), &["07/16/26 Bought 1.000 at $5.00 ($5.00)", "07/28/26 Late coffee 4.50", "08/03/26 Coffee 4.50"]);
        assert_eq!(r.dropped, 1, "07-16 is more than 7 days before");
        assert_eq!(r.rows.len(), 2, "07-28 is within the leeway");
    }

    #[test]
    fn the_last_amount_and_a_running_balance() {
        let mut layout = general();
        layout.rows.amount = AmountPosition::Last;
        let r = read(&layout, period("2026-08-01", "2026-08-31"), &["08/03/26 Bought 10.000 at $43.62 ($436.15)"]);
        assert_eq!(r.rows[0].amount, dec!(-436.15));

        let mut layout = general();
        layout.rows.running_balance = true;
        let r = read(&layout, period("2026-08-01", "2026-08-31"), &["Aug 06 Aug 06 Withdrawal", "($10.84) $144.21"]);
        assert_eq!((r.rows[0].amount, r.rows[0].running_balance), (dec!(-10.84), Some(dec!(144.21))));
    }

    #[test]
    fn reversed_statements_flip_each_row_as_it_is_read() {
        let mut layout = general();
        layout.rows.reversed = true;
        let r = read(&layout, period("2026-08-01", "2026-08-31"), &["08/03/26 Supermarket 54.20", "08/05/26 Salary 2,000.00 CR"]);
        assert_eq!(r.rows.iter().map(|x| x.amount).collect::<Vec<_>>(), vec![dec!(-54.20), dec!(2000.00)]);
    }

    #[test]
    fn description_lines_after_the_amount_when_the_layout_says_so() {
        let mut layout = general();
        layout.rows.description_after_amount = true;
        let r = read(&layout, period("2026-08-01", "2026-08-31"), &["08/03/26 Card purchase 12.00", "CORNER CAFE SPRINGFIELD"]);
        assert_eq!(r.rows[0].description, "Card purchase CORNER CAFE SPRINGFIELD");
    }
}
```

- [ ] **Step 2: Run to verify failure** — compile error.

- [ ] **Step 3: Implement** `core/src/statement/rows.rs`:

```rust
//! Grouping statement lines into rows: a row starts at a line beginning with a date and ends at the
//! first line that carries money.

use super::layout::{AmountPosition, StatementLayout};
use super::model::{Period, StatementRow, UnreadLine};
use super::tokens::{find_money, is_date_range, leading_date, without_money, Money};
use chrono::NaiveDate;
use rust_decimal::Decimal;

pub const MAX_EXTRA_LINES: usize = 4;

struct Pending {
    line: usize,
    date: NaiveDate,
    first_text: String,
    description: Vec<String>,
    extra_lines: usize,
}

pub struct RowReader<'l> {
    layout: &'l StatementLayout,
    period: Period,
    pending: Option<Pending>,
    last_row_line: Option<usize>,
    pub rows: Vec<StatementRow>,
    pub unread: Vec<UnreadLine>,
    pub dropped: usize,
}

impl<'l> RowReader<'l> {
    pub fn new(layout: &'l StatementLayout, period: Period) -> Self {
        RowReader { layout, period, pending: None, last_row_line: None, rows: Vec::new(), unread: Vec::new(), dropped: 0 }
    }

    pub fn push_line(&mut self, index: usize, text: &str) {
        let text = text.trim();
        if let Some(found) = leading_date(text, &self.layout.dates, &self.period) {
            self.flush();
            if is_date_range(found.rest, &self.layout.dates, &self.period) {
                return;
            }
            self.pending = Some(Pending { line: index, date: found.date, first_text: text.to_string(), description: Vec::new(), extra_lines: 0 });
            self.consume(index, found.rest);
            return;
        }
        if self.pending.is_some() {
            self.consume(index, text);
            return;
        }
        if self.layout.rows.description_after_amount
            && !text.is_empty()
            && find_money(text, &self.layout.amounts).is_empty()
            && self.last_row_line.is_some_and(|l| index <= l + 2)
        {
            if let Some(row) = self.rows.last_mut() {
                row.description = format!("{} {}", row.description, text).trim().to_string();
            }
        }
    }

    fn consume(&mut self, index: usize, text: &str) {
        let money = find_money(text, &self.layout.amounts);
        let pending = self.pending.as_mut().expect("consume runs with a pending row");
        if money.is_empty() {
            if !text.is_empty() {
                pending.description.push(text.to_string());
            }
            if index != pending.line {
                pending.extra_lines += 1;
            }
            if pending.extra_lines > MAX_EXTRA_LINES {
                self.flush();
            }
            return;
        }
        let (amount, running_balance) = pick(&money, self.layout);
        let rest = without_money(text, &money);
        if !rest.is_empty() {
            pending.description.push(rest);
        }
        let pending = self.pending.take().expect("checked above");
        let amount = if self.layout.rows.reversed { -amount } else { amount };
        if self.period.contains_with_leeway(pending.date) {
            self.rows.push(StatementRow {
                line: pending.line,
                date: pending.date,
                description: pending.description.join(" ").split_whitespace().collect::<Vec<_>>().join(" "),
                amount,
                running_balance,
            });
            self.last_row_line = Some(index);
        } else {
            self.dropped += 1;
        }
    }

    /// Ends any row still waiting for its amount: it couldn't be read.
    pub fn flush(&mut self) {
        if let Some(p) = self.pending.take() {
            if self.period.contains_with_leeway(p.date) {
                self.unread.push(UnreadLine { line: p.line, text: p.first_text });
            } else {
                self.dropped += 1;
            }
        }
    }
}

fn pick(money: &[Money], layout: &StatementLayout) -> (Decimal, Option<Decimal>) {
    if layout.rows.running_balance && money.len() >= 2 {
        let body = &money[..money.len() - 1];
        let amount = match layout.rows.amount {
            AmountPosition::First => body[0],
            AmountPosition::Last => body[body.len() - 1],
        };
        (amount.value, Some(money[money.len() - 1].value))
    } else {
        let amount = match layout.rows.amount {
            AmountPosition::First => money[0],
            AmountPosition::Last => money[money.len() - 1],
        };
        (amount.value, None)
    }
}
```

- [ ] **Step 4: Run to verify pass** — `cargo test -p budget_core --lib statement::rows` → PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/statement/mod.rs core/src/statement/rows.rs
git commit -m "Group statement lines into rows"
```

---

### Task 10: Sections, balances, totals and skipped sections

**Files:**
- Create: `core/src/statement/sections.rs`; add `pub mod sections;`

**Interfaces:**
- Consumes: `RowReader`, `HoldingsReader` (Task 11 — in this task call a stub: holdings lines are collected but not parsed; Task 11 replaces the stub), text helpers, `find_money`, `leading_date`.
- Produces: `pub fn read_statement(lines: &[StatementLine], layout: &StatementLayout, period: &Period) -> Vec<StatementSection>`; `pub(crate) fn label_amount(lines: &[StatementLine], i: usize, label: &str, layout: &StatementLayout, period: &Period) -> Option<Decimal>`.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::fixture_pdf::fixture_lines;
    use crate::statement::layout::{built_in_layouts, BalancePair, GENERAL_ID, GENERAL_INVESTMENT_ID};
    use rust_decimal_macros::dec;

    fn layout(id: &str) -> StatementLayout {
        built_in_layouts().into_iter().find(|l| l.id == id).unwrap()
    }

    #[test]
    fn a_label_only_line_takes_its_amount_from_the_next_lines() {
        let (lines, period) = fixture_lines("card-a");
        let sections = read_statement(&lines, &layout(GENERAL_ID), &period);
        assert_eq!(sections.len(), 1);
        assert_eq!((sections[0].starting_balance, sections[0].ending_balance), (Some(dec!(43.08)), Some(dec!(52.36))));
        assert_eq!(sections[0].rows.len(), 6);
        assert!(sections[0].unread.is_empty());
    }

    #[test]
    fn section_starts_split_one_pdf_into_accounts_and_balances_after_a_date_still_count() {
        let (lines, period) = fixture_lines("credit-union");
        let mut l = layout(GENERAL_ID);
        l.balances.section_start = vec!["Share Account ID".into()];
        let sections = read_statement(&lines, &l, &period);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].name, "MEMBER SAVINGS Share Account ID 00");
        assert_eq!((sections[1].starting_balance, sections[1].ending_balance), (Some(dec!(155.05)), Some(dec!(243.24))));
        assert_eq!(sections[1].rows.len(), 5);
    }

    #[test]
    fn a_section_with_no_rows_still_checks_and_reads() {
        let (lines, period) = fixture_lines("credit-union");
        let mut l = layout(GENERAL_ID);
        l.balances.section_start = vec!["Share Account ID".into()];
        let savings = &read_statement(&lines, &l, &period)[0];
        assert!(savings.rows.is_empty());
        assert_eq!((savings.starting_balance, savings.ending_balance), (Some(dec!(6.44)), Some(dec!(6.44))));
    }

    #[test]
    fn the_first_summary_column_and_activity_totals_and_skipped_sweeps() {
        let (lines, period) = fixture_lines("brokerage");
        let sections = read_statement(&lines, &layout(GENERAL_INVESTMENT_ID), &period);
        assert_eq!(sections.len(), 2, "the portfolio page before the first account is not an account");
        assert_eq!(sections[0].name, "Account Summary — Growth Account");
        assert_eq!(sections[0].activity_totals, Some((dec!(53.68), dec!(-9.98))));
        assert_eq!(sections[0].ending_value, Some(dec!(84089.71)));
        assert_eq!(sections[0].rows.iter().map(|r| r.amount).sum::<Decimal>(), dec!(43.70), "sweep rows are skipped");
        assert_eq!(sections[1].rows.len(), 2);
    }

    #[test]
    fn an_end_only_pair_reads_a_loan_principal() {
        let (lines, period) = fixture_lines("mortgage");
        let mut l = layout(GENERAL_ID);
        l.rows.amount = crate::statement::layout::AmountPosition::Last;
        l.balances.pairs = vec![BalancePair { start: None, end: "Outstanding Principal".into() }];
        let s = &read_statement(&lines, &l, &period)[0];
        assert_eq!((s.starting_balance, s.ending_balance), (None, Some(dec!(316840.29))));
        assert_eq!(s.rows.iter().map(|r| r.amount).collect::<Vec<_>>(), vec![dec!(2405.94), dec!(-85.12)]);
    }

    #[test]
    fn ignored_lines_are_skipped_wherever_the_phrase_appears() {
        let (lines, period) = fixture_lines("card-b");
        let mut l = layout(GENERAL_ID);
        l.ignore_lines = vec!["Order Number".into()];
        let s = &read_statement(&lines, &l, &period)[0];
        assert!(s.rows.iter().all(|r| !r.description.contains("Order Number")));
    }
}
```

- [ ] **Step 2: Run to verify failure** — compile error.

- [ ] **Step 3: Implement** `core/src/statement/sections.rs`:

```rust
//! Splitting a statement into account sections and reading each section's balances, totals, rows
//! and holdings.

use super::holdings::HoldingsReader;
use super::layout::StatementLayout;
use super::model::{Period, StatementLine, StatementSection};
use super::rows::RowReader;
use super::text::{contains_label, contains_phrase, is_label_only, starts_with_label};
use super::tokens::{find_money, leading_date};
use rust_decimal::Decimal;

const LOOKAHEAD_LINES: usize = 3;

/// The amount for `label` on line `i`: on the line itself (picking the layout's summary column), or —
/// when the line is the label alone — the first money on one of the next three lines. A leading date
/// ("Aug 01 Beginning Balance $155.05") is skipped before matching.
pub(crate) fn label_amount(lines: &[StatementLine], i: usize, label: &str, layout: &StatementLayout, period: &Period) -> Option<Decimal> {
    let text = lines[i].text.trim();
    let body = leading_date(text, &layout.dates, period).map(|d| d.rest).unwrap_or(text);
    if !starts_with_label(body, label) {
        return None;
    }
    let money = find_money(body, &layout.amounts);
    if !money.is_empty() {
        let column = (layout.balances.summary_column as usize).min(money.len() - 1);
        return Some(money[column].value);
    }
    if is_label_only(body, label) {
        for next in lines.iter().skip(i + 1).take(LOOKAHEAD_LINES) {
            let money = find_money(&next.text, &layout.amounts);
            if !money.is_empty() {
                let column = (layout.balances.summary_column as usize).min(money.len() - 1);
                return Some(money[column].value);
            }
        }
    }
    None
}

struct SectionBuilder<'l> {
    section: StatementSection,
    rows: RowReader<'l>,
    holdings: Option<HoldingsReader<'l>>,
}

impl<'l> SectionBuilder<'l> {
    fn new(name: String, first_line: usize, layout: &'l StatementLayout, period: Period) -> Self {
        SectionBuilder {
            section: StatementSection { name, first_line, ..Default::default() },
            rows: RowReader::new(layout, period),
            holdings: layout.holdings.as_ref().map(|h| HoldingsReader::new(h, &layout.amounts)),
        }
    }

    fn finish(mut self) -> StatementSection {
        self.rows.flush();
        self.section.rows = self.rows.rows;
        self.section.unread = self.rows.unread;
        self.section.dropped_out_of_period = self.rows.dropped;
        if let Some(h) = self.holdings {
            self.section.holdings = h.finish();
        }
        self.section
    }

    /// Reads balance/total/value labels on line `i`; true when the line was a label line.
    fn take_labels(&mut self, lines: &[StatementLine], i: usize, layout: &StatementLayout, period: &Period) -> bool {
        let s = &mut self.section;
        let mut hit = false;
        for pair in &layout.balances.pairs {
            if let Some(start) = &pair.start {
                if let Some(v) = label_amount(lines, i, start, layout, period) {
                    s.starting_balance.get_or_insert(v);
                    hit = true;
                }
            }
            if let Some(v) = label_amount(lines, i, &pair.end, layout, period) {
                s.ending_balance.get_or_insert(v);
                hit = true;
            }
        }
        for totals in &layout.balances.activity_totals {
            if let Some(v) = label_amount(lines, i, &totals.additions, layout, period) {
                let entry = s.activity_totals.get_or_insert((v, Decimal::ZERO));
                entry.0 = v;
                hit = true;
            }
            if let Some(v) = label_amount(lines, i, &totals.subtractions, layout, period) {
                let entry = s.activity_totals.get_or_insert((Decimal::ZERO, v));
                entry.1 = v;
                hit = true;
            }
        }
        if let Some(value) = &layout.balances.value {
            if let Some(v) = label_amount(lines, i, &value.end, layout, period) {
                s.ending_value.get_or_insert(v);
                hit = true;
            }
            if value.start.as_deref().is_some_and(|start| label_amount(lines, i, start, layout, period).is_some()) {
                hit = true;
            }
        }
        hit
    }
}

pub fn read_statement(lines: &[StatementLine], layout: &StatementLayout, period: &Period) -> Vec<StatementSection> {
    let is_start = |text: &str| layout.balances.section_start.iter().any(|label| contains_label(text, label));
    let use_sections = lines.iter().any(|l| is_start(&l.text));
    let mut sections = Vec::new();
    let mut current = (!use_sections).then(|| SectionBuilder::new("Statement".into(), 0, layout, *period));
    let mut skipping = false;
    let mut in_holdings = false;

    for (i, line) in lines.iter().enumerate() {
        let text = line.text.trim();
        if use_sections && is_start(text) {
            if let Some(done) = current.take() {
                sections.push(done.finish());
            }
            // A heading that is only the label ("Account Summary") takes the account's name from the next line.
            let label_only = layout.balances.section_start.iter().any(|label| is_label_only(text, label));
            let name = match (label_only, lines.get(i + 1)) {
                (true, Some(next)) => format!("{text} — {}", next.text.trim()),
                _ => text.to_string(),
            };
            current = Some(SectionBuilder::new(name.chars().take(60).collect(), i, layout, *period));
            skipping = false;
            in_holdings = false;
            continue;
        }
        let Some(builder) = current.as_mut() else { continue };
        if layout.skip_sections.iter().any(|label| starts_with_label(text, label)) {
            builder.rows.flush();
            skipping = true;
            continue;
        }
        if skipping || text.is_empty() || layout.ignore_lines.iter().any(|p| contains_phrase(text, p)) {
            continue;
        }
        if let Some(rules) = &layout.holdings {
            if rules.heading.iter().any(|label| starts_with_label(text, label)) {
                builder.rows.flush();
                in_holdings = true;
                continue;
            }
            if in_holdings {
                if let Some(total) = rules.total.iter().find_map(|label| label_amount(lines, i, label, layout, period)) {
                    builder.section.holdings_total.get_or_insert(total);
                    in_holdings = false;
                    continue;
                }
                if let Some(cash) = rules.cash.iter().find_map(|label| label_amount(lines, i, label, layout, period)) {
                    builder.section.holdings_cash.get_or_insert(cash);
                    continue;
                }
                if let Some(h) = builder.holdings.as_mut() {
                    h.push_line(i, text);
                }
                continue;
            }
            if let Some(cash) = rules.cash.iter().find_map(|label| label_amount(lines, i, label, layout, period)) {
                builder.section.holdings_cash.get_or_insert(cash);
                continue;
            }
        }
        if builder.take_labels(lines, i, layout, period) {
            continue;
        }
        builder.rows.push_line(i, text);
    }
    if let Some(done) = current {
        sections.push(done.finish());
    }
    sections
}
```

Note the label-only lookahead: the amount line after a label-only line is still pushed to the row reader, which ignores it because no row is pending. The `cash` check outside holdings mode handles statements (like the brokerage fixture) whose cash line comes right after the heading.

For this task, create a minimal `core/src/statement/holdings.rs` so it compiles (Task 11 fills it in):

```rust
use super::layout::{AmountRules, HoldingRules};
use super::model::StatementHolding;

pub struct HoldingsReader<'l> {
    _rules: &'l HoldingRules,
    _amounts: &'l AmountRules,
}

impl<'l> HoldingsReader<'l> {
    pub fn new(rules: &'l HoldingRules, amounts: &'l AmountRules) -> Self {
        HoldingsReader { _rules: rules, _amounts: amounts }
    }
    pub fn push_line(&mut self, _index: usize, _text: &str) {}
    pub fn finish(self) -> Vec<StatementHolding> {
        Vec::new()
    }
}
```

and add `pub mod holdings; pub mod sections;` to `mod.rs`.

- [ ] **Step 4: Run to verify pass** — `cargo test -p budget_core --lib statement::sections` → PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/statement/mod.rs core/src/statement/sections.rs core/src/statement/holdings.rs
git commit -m "Read statement sections, balances, activity totals and skipped sections"
```

---

### Task 11: Holdings

**Files:**
- Modify: `core/src/statement/holdings.rs` (replace the stub)

**Interfaces:**
- Produces: `HoldingsReader::new(rules: &HoldingRules, amounts: &AmountRules)`, `push_line(&mut self, index: usize, text: &str)`, `finish(self) -> Vec<StatementHolding>`; `pub fn is_ticker(word: &str) -> bool`.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::fixture_pdf::fixture_lines;
    use crate::statement::layout::{built_in_layouts, HoldingField, GENERAL_INVESTMENT_ID};
    use crate::statement::sections::read_statement;
    use rust_decimal_macros::dec;

    fn investment() -> crate::statement::layout::StatementLayout {
        built_in_layouts().into_iter().find(|l| l.id == GENERAL_INVESTMENT_ID).unwrap()
    }

    #[test]
    fn holdings_entries_span_several_lines_and_skip_markers() {
        let (lines, period) = fixture_lines("brokerage");
        let s = &read_statement(&lines, &investment(), &period)[0];
        assert_eq!(s.holdings.len(), 2);
        assert_eq!(
            (s.holdings[0].symbol.as_str(), s.holdings[0].name.as_str(), s.holdings[0].shares, s.holdings[0].price, s.holdings[0].market_value),
            ("ABCD", "ALPHA HOLDINGS INC", dec!(50.000), Some(dec!(339.35)), dec!(16967.50))
        );
        assert_eq!(s.holdings_cash, Some(dec!(1936.81)));
        assert_eq!(s.holdings_total, Some(dec!(21295.70)));
    }

    #[test]
    fn a_different_decimal_count_reads_nothing_until_taught() {
        let (lines, period) = fixture_lines("unknown-brokerage");
        let mut layout = investment();
        let s = &read_statement(&lines, &layout, &period)[0];
        assert!(s.holdings.is_empty());
        assert_eq!(s.holdings_total, Some(dec!(4153.03)));

        let h = layout.holdings.as_mut().unwrap();
        h.quantity_decimals = 4;
        h.price_decimals = 2;
        h.order = vec![HoldingField::Symbol, HoldingField::Name, HoldingField::Quantity, HoldingField::Price, HoldingField::MarketValue];
        let s = &read_statement(&lines, &layout, &period)[0];
        assert_eq!(s.holdings.iter().map(|h| (h.symbol.as_str(), h.shares)).collect::<Vec<_>>(), vec![("QQQZ", dec!(10.5)), ("VTIZ", dec!(4))]);
    }

    #[test]
    fn tickers_look_like_tickers() {
        assert!(is_ticker("ABCD") && is_ticker("BRK.B") && is_ticker("C"));
        assert!(!is_ticker("Mutual") && !is_ticker("DEPOSIT") && !is_ticker("50.000") && !is_ticker("$9.47"));
    }
}
```

- [ ] **Step 2: Run to verify failure** — the first test fails (no holdings read).

- [ ] **Step 3: Implement** (replace `holdings.rs` above its tests):

```rust
//! Holdings entries: a line starting with a ticker, then name text and the numbers in the layout's
//! order (quantity, price, market value). Subtotal lines ("Total …") and one- or two-letter markers
//! are ignored. An entry is complete once its market value is read.

use super::layout::{AmountRules, HoldingField, HoldingRules};
use super::model::StatementHolding;
use super::tokens::{money_token, parse_number_token};
use rust_decimal::Decimal;

pub fn is_ticker(word: &str) -> bool {
    let mut chars = word.chars();
    let Some(first) = chars.next() else { return false };
    word.len() <= 6
        && first.is_ascii_uppercase()
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '.' || c == '-')
}

struct Pending {
    line: usize,
    symbol: String,
    name: Vec<String>,
    next: usize,
    shares: Option<Decimal>,
    price: Option<Decimal>,
}

pub struct HoldingsReader<'l> {
    rules: &'l HoldingRules,
    amounts: &'l AmountRules,
    numeric: Vec<HoldingField>,
    pending: Option<Pending>,
    done: Vec<StatementHolding>,
}

impl<'l> HoldingsReader<'l> {
    pub fn new(rules: &'l HoldingRules, amounts: &'l AmountRules) -> Self {
        let numeric = rules
            .order
            .iter()
            .copied()
            .filter(|f| matches!(f, HoldingField::Quantity | HoldingField::Price | HoldingField::MarketValue))
            .collect();
        HoldingsReader { rules, amounts, numeric, pending: None, done: Vec::new() }
    }

    pub fn push_line(&mut self, index: usize, text: &str) {
        let text = text.trim();
        if text.is_empty() || text.to_ascii_lowercase().starts_with("total") {
            return;
        }
        if self.pending.is_none() {
            let Some(first) = text.split_whitespace().next() else { return };
            if !is_ticker(first) {
                return;
            }
            self.pending = Some(Pending { line: index, symbol: first.to_string(), name: Vec::new(), next: 0, shares: None, price: None });
            let rest = text[first.len()..].to_string();
            self.consume(&rest);
            return;
        }
        self.consume(text);
    }

    fn consume(&mut self, text: &str) {
        for tok in text.split_whitespace() {
            let Some(p) = self.pending.as_mut() else { return };
            match self.numeric.get(p.next) {
                Some(HoldingField::Quantity) if p.shares.is_none() => {
                    if let Some(v) = parse_number_token(tok, self.amounts, self.rules.quantity_decimals) {
                        p.shares = Some(v);
                        p.next += 1;
                        continue;
                    }
                }
                Some(HoldingField::Price) => {
                    if let Some(v) = parse_number_token(tok, self.amounts, self.rules.price_decimals) {
                        p.price = Some(v);
                        p.next += 1;
                        continue;
                    }
                }
                Some(HoldingField::MarketValue) => {
                    if let Some((v, _)) = money_token(tok, self.amounts) {
                        let p = self.pending.take().expect("checked above");
                        if let Some(shares) = p.shares {
                            self.done.push(StatementHolding {
                                line: p.line,
                                symbol: p.symbol,
                                name: p.name.join(" "),
                                shares,
                                price: p.price,
                                market_value: v,
                            });
                        }
                        return;
                    }
                }
                _ => {}
            }
            if p.shares.is_none() && tok.len() > 2 && tok.chars().any(|c| c.is_alphabetic()) {
                p.name.push(tok.to_string());
            }
        }
    }

    pub fn finish(self) -> Vec<StatementHolding> {
        self.done
    }
}
```

- [ ] **Step 4: Run to verify pass** — `cargo test -p budget_core --lib statement::` → PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/statement/holdings.rs
git commit -m "Read holdings entries from investment statements"
```

---

### Task 12: Checks

**Files:**
- Create: `core/src/statement/checks.rs`; add `pub mod checks;`

**Interfaces:**
- Produces: `pub enum CheckOutcome { Passed, Failed { expected: Decimal, found: Decimal }, NotAvailable }`; `pub struct SectionChecks { pub activity: CheckOutcome, pub holdings: CheckOutcome, pub running_balance_breaks: Vec<usize> }` with `fn passed(&self) -> usize`, `fn failed(&self) -> usize`; `pub fn check_section(s: &StatementSection) -> SectionChecks`.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::fixture_pdf::fixture_lines;
    use crate::statement::layout::{built_in_layouts, GENERAL_ID, GENERAL_INVESTMENT_ID};
    use crate::statement::sections::read_statement;
    use rust_decimal_macros::dec;

    fn checks(fixture: &str, id: &str, tweak: impl Fn(&mut crate::statement::layout::StatementLayout)) -> Vec<SectionChecks> {
        let (lines, period) = fixture_lines(fixture);
        let mut layout = built_in_layouts().into_iter().find(|l| l.id == id).unwrap();
        tweak(&mut layout);
        read_statement(&lines, &layout, &period).iter().map(check_section).collect()
    }

    #[test]
    fn start_plus_rows_equals_end() {
        assert_eq!(checks("card-a", GENERAL_ID, |_| {})[0].activity, CheckOutcome::Passed);
        assert_eq!(checks("card-c", GENERAL_ID, |_| {})[0].activity, CheckOutcome::Passed);
    }

    #[test]
    fn a_misread_is_caught() {
        let c = checks("card-b", GENERAL_ID, |_| {});
        assert!(matches!(c[0].activity, CheckOutcome::Failed { .. }), "the repeated rewards purchase is counted");
        let c = checks("card-b", GENERAL_ID, |l| l.skip_sections = vec!["Rewards Activity".into()]);
        assert_eq!(c[0].activity, CheckOutcome::Passed);
    }

    #[test]
    fn activity_totals_and_holdings_totals_for_brokerages() {
        let c = checks("brokerage", GENERAL_INVESTMENT_ID, |_| {});
        assert_eq!((c[0].activity.clone(), c[0].holdings.clone()), (CheckOutcome::Passed, CheckOutcome::Passed));
        assert_eq!(c[1].activity, CheckOutcome::Passed);
        let quarterly = checks("brokerage-quarterly", GENERAL_INVESTMENT_ID, |_| {});
        assert_eq!(quarterly[0].activity, CheckOutcome::Passed, "earlier months of the quarter are dropped");
    }

    #[test]
    fn unreadable_holdings_fail_against_the_printed_total() {
        let c = checks("unknown-brokerage", GENERAL_INVESTMENT_ID, |_| {});
        assert_eq!(c[0].activity, CheckOutcome::Passed, "cash balances check the activity");
        assert_eq!(c[0].holdings, CheckOutcome::Failed { expected: dec!(4153.03), found: dec!(0) });
    }

    #[test]
    fn running_balances_are_checked_row_by_row() {
        let c = checks("credit-union", GENERAL_ID, |l| {
            l.balances.section_start = vec!["Share Account ID".into()];
            l.rows.running_balance = true;
        });
        assert_eq!(c[1].activity, CheckOutcome::Passed);
        assert!(c[1].running_balance_breaks.is_empty());
    }

    #[test]
    fn no_balances_means_not_available() {
        let c = checks("mortgage", GENERAL_ID, |_| {});
        assert_eq!(c[0].activity, CheckOutcome::NotAvailable);
    }
}
```

- [ ] **Step 2: Run to verify failure** — compile error.

- [ ] **Step 3: Implement** `core/src/statement/checks.rs`:

```rust
//! Does the reading add up? Activity: the statement's activity totals, else start + rows = end.
//! Holdings: market values (plus cash) = the printed total holdings value. Running balances: each row
//! continues from the one before.

use super::model::StatementSection;
use rust_decimal::Decimal;

#[derive(Debug, Clone, PartialEq)]
pub enum CheckOutcome {
    Passed,
    Failed { expected: Decimal, found: Decimal },
    NotAvailable,
}

impl CheckOutcome {
    fn compare(expected: Decimal, found: Decimal) -> Self {
        if expected == found { CheckOutcome::Passed } else { CheckOutcome::Failed { expected, found } }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SectionChecks {
    pub activity: CheckOutcome,
    pub holdings: CheckOutcome,
    /// Statement lines where a running balance doesn't follow from the one before.
    pub running_balance_breaks: Vec<usize>,
}

impl SectionChecks {
    pub fn passed(&self) -> usize {
        [&self.activity, &self.holdings].into_iter().filter(|c| **c == CheckOutcome::Passed).count()
    }
    pub fn failed(&self) -> usize {
        [&self.activity, &self.holdings].into_iter().filter(|c| matches!(c, CheckOutcome::Failed { .. })).count()
            + usize::from(!self.running_balance_breaks.is_empty())
    }
}

pub fn check_section(s: &StatementSection) -> SectionChecks {
    let sum: Decimal = s.rows.iter().map(|r| r.amount).sum();
    let activity = match (s.activity_totals, s.starting_balance, s.ending_balance) {
        (Some((additions, subtractions)), _, _) => CheckOutcome::compare(additions + subtractions, sum),
        (None, Some(start), Some(end)) => CheckOutcome::compare(end, start + sum),
        _ => CheckOutcome::NotAvailable,
    };
    let holdings = match s.holdings_total {
        Some(total) => CheckOutcome::compare(
            total,
            s.holdings.iter().map(|h| h.market_value).sum::<Decimal>() + if s.holdings.is_empty() { Decimal::ZERO } else { s.holdings_cash.unwrap_or_default() },
        ),
        None => CheckOutcome::NotAvailable,
    };
    let mut breaks = Vec::new();
    let mut previous = s.starting_balance;
    for row in &s.rows {
        if let Some(balance) = row.running_balance {
            if previous.is_some_and(|p| p + row.amount != balance) {
                breaks.push(row.line);
            }
            previous = Some(balance);
        }
    }
    SectionChecks { activity, holdings, running_balance_breaks: breaks }
}
```

(Cash only counts toward the holdings total once securities were read, so an unreadable table reports `found: 0` rather than the cash alone.)

- [ ] **Step 4: Run to verify pass** — `cargo test -p budget_core --lib statement::` → PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/statement/mod.rs core/src/statement/checks.rs
git commit -m "Check that a statement reading adds up"
```

---

### Task 13: Built-in layouts for the owner's six institutions, and the real-statement check (library gate, part 2)

**Files:**
- Create: `core/data/statement_layouts/{amex,chase-card,capital-one,credit-union,mortgage,lpl}.json`
- Modify: `core/src/statement/layout.rs` (`BUILT_IN_JSON` gains the six files)
- Create: `core/examples/real_statement_check.rs`
- Test: add to `layout.rs` tests

**Interfaces:**
- Produces: built-in ids `amex`, `chase-card`, `capital-one`, `credit-union`, `mortgage`, `lpl`.

These start from what the real statements showed and are then **tuned against the real statements** in Step 5. Recognition phrases are institution text (public), never personal.

- [ ] **Step 1: Write the failing test** (in `layout.rs` tests)

```rust
#[test]
fn each_owner_layout_reads_its_fictional_fixture_and_adds_up() {
    use crate::statement::checks::{check_section, CheckOutcome};
    use crate::statement::fixture_pdf::fixture_lines;
    use crate::statement::sections::read_statement;
    let pairs = [("amex", "card-a"), ("chase-card", "card-b"), ("capital-one", "card-c"), ("credit-union", "credit-union"), ("mortgage", "mortgage"), ("lpl", "brokerage")];
    for (id, fixture) in pairs {
        let layout = built_in_layouts().into_iter().find(|l| l.id == id).unwrap_or_else(|| panic!("{id}"));
        let (lines, period) = fixture_lines(fixture);
        let sections = read_statement(&lines, &layout, &period);
        assert!(!sections.is_empty(), "{id}");
        for s in &sections {
            let c = check_section(s);
            assert!(!matches!(c.activity, CheckOutcome::Failed { .. }), "{id}: {:?}", c.activity);
            assert!(!matches!(c.holdings, CheckOutcome::Failed { .. }), "{id}: {:?}", c.holdings);
            assert!(c.running_balance_breaks.is_empty(), "{id}");
            assert!(s.unread.is_empty(), "{id}: {:?}", s.unread);
        }
    }
}
```

- [ ] **Step 2: Run to verify failure** — panics on `amex` (not built in yet).

- [ ] **Step 3: Write the six layouts**

`amex.json`:
```json
{ "schema": 1, "id": "amex", "name": "American Express", "recognize": ["American Express"],
  "dates": { "formats": ["mm_dd_yy"], "ignore_markers": ["*"] },
  "amounts": { "negatives": ["leading_minus"], "currency": "optional", "thousands": "comma", "decimal": "period" },
  "rows": { "amount": "first" },
  "balances": { "pairs": [{ "start": "Previous Balance", "end": "New Balance" }] } }
```

`chase-card.json`:
```json
{ "schema": 1, "id": "chase-card", "name": "Chase card", "recognize": ["Opening/Closing Date"],
  "dates": { "formats": ["mm_dd"] },
  "amounts": { "negatives": ["leading_minus"], "currency": "optional", "thousands": "comma", "decimal": "period" },
  "rows": { "amount": "first" },
  "balances": { "pairs": [{ "start": "Previous Balance", "end": "New Balance" }] },
  "skip_sections": ["Rewards Activity"],
  "ignore_lines": ["Order Number"] }
```

`capital-one.json`:
```json
{ "schema": 1, "id": "capital-one", "name": "Capital One", "recognize": ["Capital One"],
  "dates": { "formats": ["mon_dd"], "second_date": true },
  "amounts": { "negatives": ["spaced_minus", "leading_minus"], "currency": "optional", "thousands": "comma", "decimal": "period" },
  "rows": { "amount": "first" },
  "balances": { "pairs": [{ "start": "Previous Balance", "end": "New Balance" }] },
  "ignore_lines": ["days in Billing Cycle"] }
```

`credit-union.json`:
```json
{ "schema": 1, "id": "credit-union", "name": "Credit union", "recognize": ["Share Account ID"],
  "dates": { "formats": ["mon_dd"], "second_date": true },
  "amounts": { "negatives": ["parentheses"], "currency": "optional", "thousands": "comma", "decimal": "period" },
  "rows": { "amount": "first", "running_balance": true },
  "balances": { "pairs": [{ "start": "Beginning Balance", "end": "Ending Balance" }], "section_start": ["Share Account ID"] } }
```

`mortgage.json`:
```json
{ "schema": 1, "id": "mortgage", "name": "Home loan", "recognize": ["Outstanding Principal", "Transaction Activity"],
  "dates": { "formats": ["mm_dd_yy"] },
  "amounts": { "negatives": ["parentheses"], "currency": "optional", "thousands": "comma", "decimal": "period" },
  "rows": { "amount": "last" },
  "balances": { "pairs": [{ "end": "Outstanding Principal" }] } }
```

`lpl.json`:
```json
{ "schema": 1, "id": "lpl", "name": "LPL Financial", "recognize": ["LPL Financial"],
  "dates": { "formats": ["mm_dd"] },
  "amounts": { "negatives": ["parentheses"], "currency": "optional", "thousands": "comma", "decimal": "period" },
  "rows": { "amount": "last" },
  "balances": {
    "section_start": ["Account Summary"],
    "activity_totals": [{ "additions": "Total Additions", "subtractions": "Total Subtractions" }],
    "value": { "start": "Starting Value", "end": "Total Ending Value" } },
  "skip_sections": ["Cash Sweep Activity"],
  "holdings": { "heading": ["Account Holdings"], "order": ["symbol", "name", "quantity", "price", "market_value"],
    "quantity_decimals": 3, "price_decimals": 4, "total": ["Total Account Holdings"], "cash": ["Total Cash and Cash Equivalents"] } }
```

Add the six `include_str!` lines to `BUILT_IN_JSON`.

- [ ] **Step 4: Run to verify pass** — `cargo test -p budget_core --lib statement::` → PASS.

- [ ] **Step 5: Write the local-only real-statement check** — `core/examples/real_statement_check.rs`:

```rust
//! LOCAL ONLY. Reads the owner's real statements and prints counts — never statement text or amounts
//! (unless `--show-unread`, which prints unread lines to this terminal only; never paste them anywhere).
//!
//! Periods come from `<folder>\periods.txt` (kept next to the statements, outside the repo), one line per
//! file: `file name|YYYY-MM-DD|YYYY-MM-DD|kind` where kind is cash, credit, loan or investment.
//!
//! cargo run -p budget_core --release --example real_statement_check -- "E:\misc\Programming\Claude\Statements" [--no-builtins] [--show-unread]

use budget_core::statement::checks::{check_section, CheckOutcome};
use budget_core::statement::layout::{built_in_layouts, GENERAL_ID, GENERAL_INVESTMENT_ID};
use budget_core::statement::pdf_text::read_pdf_lines;
use budget_core::statement::select::choose;
use budget_core::statement::Period;

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
    let show_unread = args.iter().any(|a| a == "--show-unread");
    let periods = std::fs::read_to_string(folder.join("periods.txt")).expect("periods.txt next to the statements");
    let builtins: Vec<_> = built_in_layouts()
        .into_iter()
        .filter(|l| !no_builtins || l.id == GENERAL_ID || l.id == GENERAL_INVESTMENT_ID)
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
        let reading = choose(&lines, &period, &[], &builtins, investment);
        for (i, s) in reading.sections.iter().enumerate() {
            let c = check_section(s);
            if matches!(c.activity, CheckOutcome::Failed { .. }) || matches!(c.holdings, CheckOutcome::Failed { .. }) || !s.unread.is_empty() {
                failures += 1;
            }
            println!(
                "#{n}.{i}: layout={} recognized={} rows={} unread={} dropped={} holdings={} activity={} holdings_check={} running_breaks={}",
                reading.layout.id, reading.recognized, s.rows.len(), s.unread.len(), s.dropped_out_of_period, s.holdings.len(),
                outcome(&c.activity), outcome(&c.holdings), c.running_balance_breaks.len()
            );
            if show_unread {
                for u in &s.unread {
                    println!("    unread line {}: {}", u.line, u.text);
                }
            }
        }
    }
    println!("{failures} section(s) need attention");
    std::process::exit(if failures == 0 { 0 } else { 1 });
}
```

This example uses `select::choose` from Task 14. **Do Steps 5–7 after Task 14 is committed** (the executor should come back to them; they are listed here because they close this task's gate).

- [ ] **Step 6: Write `periods.txt` locally** (outside the repo, never committed) in `E:\misc\Programming\Claude\Statements\periods.txt`, one line per statement, with the period printed on each statement (closing-date windows for cards, statement period for the credit union and LPL, "Transaction Activity" dates for the mortgage) and the kind. Open each PDF to read its period.

- [ ] **Step 7: Run the gate** (PowerShell):

```powershell
cargo run -p budget_core --release --example real_statement_check -- "E:\misc\Programming\Claude\Statements" > "$env:TEMP\vs-real-check.txt"
Get-Content "$env:TEMP\vs-real-check.txt"
```

Acceptance: every section shows `activity=passed` (or `n/a` for the mortgage), every LPL account shows `holdings_check=passed`, `unread=0`, `running_breaks=0`, the expected layout id per file, and `recognized=true`. Where a section fails, run with `--show-unread` for that run only, adjust **only** the JSON layouts (labels, skip sections, ignore phrases, decimals) or, if a reading rule is genuinely missing, the reader with a new fixture-based test that reproduces the shape with fictional data. Re-run until it passes. If the PDF text itself comes back scrambled (rows missing or amounts beside the wrong dates), apply the Task 8 gate fallback. Then run once more with `--no-builtins` and keep the count summary for the final report (how many sections the general layouts alone read).

- [ ] **Step 8: Commit** (JSON and example only; nothing from the statements folder)

```bash
git add core/data/statement_layouts core/src/statement/layout.rs core/examples/real_statement_check.rs
git commit -m "Add built-in statement layouts for six institutions and a local-only real-statement check"
```

---

### Task 14: Choosing a layout

**Files:**
- Create: `core/src/statement/select.rs`; add `pub mod select;`

**Interfaces:**
- Consumes: `read_statement`, `check_section`, `StatementLayout`.
- Produces: `pub enum LayoutOrigin { Learned { id: i64 }, BuiltIn { id: String } }`; `pub struct Reading { pub layout: StatementLayout, pub origin: LayoutOrigin, pub recognized: bool, pub recognized_but_failed: bool, pub sections: Vec<StatementSection>, pub checks: Vec<SectionChecks> }`; `pub fn recognizes(layout: &StatementLayout, lines: &[StatementLine]) -> bool`; `pub fn read_with(lines, layout, period) -> (Vec<StatementSection>, Vec<SectionChecks>)`; `pub fn choose(lines: &[StatementLine], period: &Period, learned: &[(i64, StatementLayout)], built_ins: &[StatementLayout], investment: bool) -> Reading`.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::fixture_pdf::fixture_lines;
    use crate::statement::layout::{built_in_layouts, GENERAL_ID};

    fn builtins() -> Vec<StatementLayout> { built_in_layouts() }

    #[test]
    fn a_recognised_layout_is_used_when_it_adds_up() {
        let (lines, period) = fixture_lines("card-b");
        let r = choose(&lines, &period, &[], &builtins(), false);
        assert_eq!((r.layout.id.as_str(), r.recognized), ("chase-card", true));
    }

    #[test]
    fn an_unrecognised_statement_gets_the_best_reading() {
        let (lines, period) = fixture_lines("card-c");
        let r = choose(&lines, &period, &[], &builtins(), false);
        assert!(!r.recognized);
        assert!(r.checks.iter().all(|c| c.failed() == 0));
    }

    #[test]
    fn learned_layouts_win_over_built_ins() {
        let (lines, period) = fixture_lines("card-b");
        let mut mine = builtins().into_iter().find(|l| l.id == "chase-card").unwrap();
        mine.id = "learned".into();
        let r = choose(&lines, &period, &[(7, mine)], &builtins(), false);
        assert_eq!(r.origin, LayoutOrigin::Learned { id: 7 });
    }

    #[test]
    fn a_recognised_layout_that_stopped_adding_up_is_reported() {
        let (lines, period) = fixture_lines("card-b");
        let mut broken = builtins().into_iter().find(|l| l.id == "chase-card").unwrap();
        broken.id = "learned".into();
        broken.skip_sections.clear();
        broken.ignore_lines.clear();
        let general = builtins().into_iter().filter(|l| l.id == GENERAL_ID).collect::<Vec<_>>();
        let r = choose(&lines, &period, &[(3, broken)], &general, false);
        assert!(r.recognized_but_failed);
    }

    #[test]
    fn a_reversed_bank_is_read_the_right_way_round() {
        let (lines, period) = fixture_lines("unknown-bank");
        // Day-first dates aren't in the general layout, so this one needs teaching (Task 15);
        // with the format added, choosing finds the reversed reading by itself.
        let mut general = builtins().into_iter().find(|l| l.id == GENERAL_ID).unwrap();
        general.dates.formats = vec![crate::statement::layout::DateFormat::DdMmYyyy];
        let r = choose(&lines, &period, &[], &[general], false);
        assert!(r.layout.rows.reversed);
        assert_eq!(r.checks[0].activity, crate::statement::checks::CheckOutcome::Passed);
    }
}
```

- [ ] **Step 2: Run to verify failure** — compile error.

- [ ] **Step 3: Implement** `core/src/statement/select.rs`:

```rust
//! Choosing how to read a statement: a recognised layout (learned first, then built-in) when it adds up;
//! otherwise the best of every layout, each also tried with money in/out reversed.

use super::checks::{check_section, SectionChecks};
use super::layout::{StatementLayout, GENERAL_ID, GENERAL_INVESTMENT_ID};
use super::model::{Period, StatementLine, StatementSection};
use super::sections::read_statement;
use super::text::squash;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutOrigin {
    Learned { id: i64 },
    BuiltIn { id: String },
}

#[derive(Debug, Clone)]
pub struct Reading {
    pub layout: StatementLayout,
    pub origin: LayoutOrigin,
    pub recognized: bool,
    pub recognized_but_failed: bool,
    pub sections: Vec<StatementSection>,
    pub checks: Vec<SectionChecks>,
}

pub fn recognizes(layout: &StatementLayout, lines: &[StatementLine]) -> bool {
    if layout.recognize.is_empty() {
        return false;
    }
    let first_page = squash(&lines.iter().filter(|l| l.page == 0).map(|l| l.text.as_str()).collect::<Vec<_>>().join(" "));
    layout.recognize.iter().all(|p| first_page.contains(&squash(p)))
}

pub fn read_with(lines: &[StatementLine], layout: &StatementLayout, period: &Period) -> (Vec<StatementSection>, Vec<SectionChecks>) {
    let sections = read_statement(lines, layout, period);
    let checks = sections.iter().map(check_section).collect();
    (sections, checks)
}

fn score(sections: &[StatementSection], checks: &[SectionChecks]) -> (usize, i64, usize, i64) {
    let passed = checks.iter().map(SectionChecks::passed).sum();
    let failed = checks.iter().map(SectionChecks::failed).sum::<usize>() as i64;
    let items = sections.iter().map(|s| s.rows.len() + s.holdings.len()).sum();
    let unread = sections.iter().map(|s| s.unread.len()).sum::<usize>() as i64;
    (passed, -failed, items, -unread)
}

fn acceptable(sections: &[StatementSection], checks: &[SectionChecks]) -> bool {
    checks.iter().all(|c| c.failed() == 0) && sections.iter().any(|s| !s.rows.is_empty() || !s.holdings.is_empty() || s.ending_balance.is_some())
}

pub fn choose(lines: &[StatementLine], period: &Period, learned: &[(i64, StatementLayout)], built_ins: &[StatementLayout], investment: bool) -> Reading {
    let mut recognized_but_failed = false;
    let candidates: Vec<(LayoutOrigin, &StatementLayout)> = learned
        .iter()
        .map(|(id, l)| (LayoutOrigin::Learned { id: *id }, l))
        .chain(built_ins.iter().map(|l| (LayoutOrigin::BuiltIn { id: l.id.clone() }, l)))
        .collect();

    for (origin, layout) in &candidates {
        if recognizes(layout, lines) {
            let (sections, checks) = read_with(lines, layout, period);
            if acceptable(&sections, &checks) {
                return Reading { layout: (*layout).clone(), origin: origin.clone(), recognized: true, recognized_but_failed: false, sections, checks };
            }
            recognized_but_failed = true;
        }
    }

    // Generals first (the investment one first for an investment account), then everything else.
    let rank = |l: &StatementLayout| match (l.id.as_str(), investment) {
        (GENERAL_INVESTMENT_ID, true) | (GENERAL_ID, false) => 0,
        (GENERAL_ID, true) | (GENERAL_INVESTMENT_ID, false) => 1,
        _ => 2,
    };
    let mut ordered = candidates.clone();
    ordered.sort_by_key(|(_, l)| rank(l));

    let mut best: Option<(_, Reading)> = None;
    for (origin, layout) in ordered {
        for reversed in [layout.rows.reversed, !layout.rows.reversed] {
            let mut tried = layout.clone();
            tried.rows.reversed = reversed;
            let (sections, checks) = read_with(lines, &tried, period);
            let s = score(&sections, &checks);
            if best.as_ref().is_none_or(|(b, _)| s > *b) {
                best = Some((s, Reading { layout: tried, origin: origin.clone(), recognized: false, recognized_but_failed, sections, checks }));
            }
        }
    }
    best.expect("there is always at least one built-in layout").1
}
```

- [ ] **Step 4: Run to verify pass** — `cargo test -p budget_core --lib statement::` → PASS. Then complete Task 13 Steps 5–8.

- [ ] **Step 5: Commit**

```bash
git add core/src/statement/mod.rs core/src/statement/select.rs
git commit -m "Choose how to read a statement: recognised layouts first, else the best reading"
```

---

### Task 15: Learning — automatic narrowing, suggested names and teaching

**Files:**
- Create: `core/src/statement/learn.rs`; add `pub mod learn;`

**Interfaces:**
- Consumes: tokens, `read_with`, `check_section`, `StatementLayout`, `is_safe_phrase`.
- Produces:
  - `pub fn narrow(layout: &StatementLayout, lines: &[StatementLine], sections: &[StatementSection], period: &Period) -> StatementLayout` — keeps only the date formats and negative styles actually seen.
  - `pub fn suggest_name_and_phrases(lines: &[StatementLine], avoid: &[String]) -> (String, Vec<String>)`
  - `#[derive(Deserialize)] #[serde(rename_all = "camelCase")] pub struct TextRef { pub line: usize, pub start: usize }` (`start` is a **character** index of the clicked word)
  - `pub struct RowMark { pub date: TextRef, pub amount: TextRef }`
  - `#[serde(tag = "kind", rename_all = "snake_case")] pub enum BalanceMark { StartEnd { start: TextRef, end: TextRef }, Totals { additions: TextRef, subtractions: TextRef } }`
  - `pub struct HoldingMark { pub symbol: TextRef, pub quantity: TextRef, pub price: Option<TextRef>, pub market_value: TextRef, pub total: TextRef }`
  - `pub struct TeachMarks { pub rows: Vec<RowMark>, pub balances: Option<BalanceMark>, pub holdings: Vec<HoldingMark> }` (all `Deserialize`, camelCase)
  - `pub enum TeachError { NothingMarked, DateNotFound, AmountNotFound, LabelLooksPersonal, NotThere }` with plain `Display`
  - `pub fn from_marks(base: &StatementLayout, lines: &[StatementLine], marks: &TeachMarks, period: &Period) -> Result<StatementLayout, TeachError>`

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::checks::CheckOutcome;
    use crate::statement::fixture_pdf::fixture_lines;
    use crate::statement::layout::{built_in_layouts, DateFormat, GENERAL_ID, GENERAL_INVESTMENT_ID};
    use crate::statement::select::read_with;

    fn base(id: &str) -> StatementLayout { built_in_layouts().into_iter().find(|l| l.id == id).unwrap() }
    fn at(lines: &[StatementLine], line_text_start: &str, word: &str) -> TextRef {
        let line = lines.iter().position(|l| l.text.starts_with(line_text_start)).unwrap();
        let start = lines[line].text.find(word).unwrap();
        TextRef { line, start: lines[line].text[..start].chars().count() }
    }

    #[test]
    fn teaching_a_day_first_reversed_bank() {
        let (lines, period) = fixture_lines("unknown-bank");
        let marks = TeachMarks {
            rows: vec![RowMark { date: at(&lines, "03/08", "03/08/2026"), amount: at(&lines, "03/08", "54.20") }],
            balances: Some(BalanceMark::StartEnd { start: at(&lines, "Opening", "1,250.00"), end: at(&lines, "Closing", "3,132.00") }),
            holdings: vec![],
        };
        let taught = from_marks(&base(GENERAL_ID), &lines, &marks, &period).unwrap();
        assert_eq!(taught.dates.formats[0], DateFormat::DdMmYyyy);
        assert!(taught.rows.reversed);
        let (sections, checks) = read_with(&lines, &taught, &period);
        assert_eq!(sections[0].rows.len(), 5);
        assert_eq!(checks[0].activity, CheckOutcome::Passed);

        // The next month reads with what was learned.
        let (next, next_period) = fixture_lines("unknown-bank-next");
        assert_eq!(read_with(&next, &taught, &next_period).1[0].activity, CheckOutcome::Passed);
    }

    #[test]
    fn teaching_a_holdings_table() {
        let (lines, period) = fixture_lines("unknown-brokerage");
        let marks = TeachMarks {
            rows: vec![],
            balances: None,
            holdings: vec![HoldingMark {
                symbol: at(&lines, "QQQZ", "QQQZ"),
                quantity: at(&lines, "10.5000", "10.5000"),
                price: Some(at(&lines, "10.5000", "$300.25")),
                market_value: at(&lines, "10.5000", "$3,152.63"),
                total: at(&lines, "Total Market Value", "$4,153.03"),
            }],
        };
        let taught = from_marks(&base(GENERAL_INVESTMENT_ID), &lines, &marks, &period).unwrap();
        let h = taught.holdings.as_ref().unwrap();
        assert_eq!((h.quantity_decimals, h.price_decimals), (4, 2));
        assert_eq!(read_with(&lines, &taught, &period).1[0].holdings, CheckOutcome::Passed);
    }

    #[test]
    fn marking_nothing_or_a_wrong_word_is_refused_plainly() {
        let (lines, period) = fixture_lines("unknown-bank");
        assert_eq!(from_marks(&base(GENERAL_ID), &lines, &TeachMarks { rows: vec![], balances: None, holdings: vec![] }, &period), Err(TeachError::NothingMarked));
        let bad = TeachMarks { rows: vec![RowMark { date: at(&lines, "Riverbend", "Riverbend"), amount: at(&lines, "03/08", "54.20") }], balances: None, holdings: vec![] };
        assert_eq!(from_marks(&base(GENERAL_ID), &lines, &bad, &period), Err(TeachError::DateNotFound));
    }

    #[test]
    fn automatic_learning_keeps_only_what_was_seen() {
        let (lines, period) = fixture_lines("card-c");
        let general = base(GENERAL_ID);
        let (sections, _) = read_with(&lines, &general, &period);
        let narrowed = narrow(&general, &lines, &sections, &period);
        assert!(narrowed.dates.formats.contains(&DateFormat::MonDd));
        assert!(!narrowed.dates.formats.contains(&DateFormat::YyyyMmDd));
    }

    #[test]
    fn suggested_phrases_are_safe_and_avoid_the_persons_own_names() {
        let (lines, _) = fixture_lines("unknown-bank");
        let (name, phrases) = suggest_name_and_phrases(&lines, &["Everyday Account Statement".into()]);
        assert_eq!(name, "Riverbend Mutual Bank");
        assert_eq!(phrases, vec!["Riverbend Mutual Bank".to_string()]);
        assert!(phrases.iter().all(|p| crate::statement::layout::is_safe_phrase(p)));
    }
}
```

- [ ] **Step 2: Run to verify failure** — compile error.

- [ ] **Step 3: Implement** `core/src/statement/learn.rs`:

```rust
//! Learning how to read a statement: narrowing a general layout to what one statement used, suggesting
//! a name and recognition phrases, and deriving a layout from words the person clicked ("teaching").

use super::layout::{AmountPosition, BalancePair, DateFormat, HoldingField, NegativeStyle, StatementLayout, TotalsPair, is_safe_phrase};
use super::model::{Period, StatementLine, StatementSection};
use super::select::read_with;
use super::tokens::{find_money, leading_date, parse_date_prefix, permissive_amounts, without_money};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRef {
    pub line: usize,
    /// Character index of the clicked word in the line.
    pub start: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowMark {
    pub date: TextRef,
    pub amount: TextRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BalanceMark {
    StartEnd { start: TextRef, end: TextRef },
    Totals { additions: TextRef, subtractions: TextRef },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldingMark {
    pub symbol: TextRef,
    pub quantity: TextRef,
    pub price: Option<TextRef>,
    pub market_value: TextRef,
    pub total: TextRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeachMarks {
    #[serde(default)]
    pub rows: Vec<RowMark>,
    #[serde(default)]
    pub balances: Option<BalanceMark>,
    #[serde(default)]
    pub holdings: Vec<HoldingMark>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeachError {
    NothingMarked,
    DateNotFound,
    AmountNotFound,
    LabelLooksPersonal,
    NotThere,
}

impl std::fmt::Display for TeachError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            TeachError::NothingMarked => "Click at least one example first.",
            TeachError::DateNotFound => "The word you clicked for the date isn't a date. Click the transaction's date.",
            TeachError::AmountNotFound => "The word you clicked isn't an amount of money. Click the amount.",
            TeachError::LabelLooksPersonal => "The words next to that amount look like an account number or contact details, so the app won't remember them.",
            TeachError::NotThere => "That example is no longer on the statement. Read the statement again.",
        })
    }
}

fn byte_index(text: &str, chars: usize) -> Option<usize> {
    text.char_indices().map(|(b, _)| b).chain(std::iter::once(text.len())).nth(chars)
}

fn line_at<'a>(lines: &'a [StatementLine], r: TextRef) -> Result<(&'a str, usize), TeachError> {
    let text = lines.get(r.line).ok_or(TeachError::NotThere)?.text.as_str();
    Ok((text, byte_index(text, r.start).ok_or(TeachError::NotThere)?))
}

/// The money on the line whose range contains the clicked word ("$3,975.23" inside "- $3,975.23").
fn clicked_money(lines: &[StatementLine], r: TextRef) -> Result<(usize, usize, Option<NegativeStyle>, rust_decimal::Decimal, String), TeachError> {
    let (text, at) = line_at(lines, r)?;
    let money = find_money(text, &permissive_amounts());
    let index = money.iter().position(|m| m.start <= at && at < m.end).ok_or(TeachError::AmountNotFound)?;
    let m = money[index];
    Ok((index, money.len(), m.negative_style, m.value, text[m.start..m.end].to_string()))
}

/// The words before an amount on its line (after any leading date) — or, when the amount is alone, the
/// line above.
fn label_for(lines: &[StatementLine], r: TextRef, period: &Period) -> Result<String, TeachError> {
    let (text, _) = line_at(lines, r)?;
    let money = find_money(text, &permissive_amounts());
    let mut label = without_money(text, &money);
    let any_date = super::layout::DateRules { formats: DateFormat::ALL.to_vec(), second_date: true, ignore_markers: vec![] };
    if let Some(d) = leading_date(&label, &any_date, period) {
        label = d.rest.to_string();
    }
    if label.trim().is_empty() && r.line > 0 {
        label = lines[r.line - 1].text.clone();
    }
    let label = label.trim().trim_end_matches([':', '=']).trim().to_string();
    if is_safe_phrase(&label) { Ok(label) } else { Err(TeachError::LabelLooksPersonal) }
}

fn decimals_in(text: &str) -> u8 {
    text.rsplit_once('.').map(|(_, f)| f.chars().take_while(char::is_ascii_digit).count() as u8).unwrap_or(0)
}

pub fn from_marks(base: &StatementLayout, lines: &[StatementLine], marks: &TeachMarks, period: &Period) -> Result<StatementLayout, TeachError> {
    if marks.rows.is_empty() && marks.balances.is_none() && marks.holdings.is_empty() {
        return Err(TeachError::NothingMarked);
    }
    let mut layout = base.clone();

    for row in &marks.rows {
        let (text, at) = line_at(lines, row.date)?;
        let clicked = &text[at..];
        let format = DateFormat::ALL
            .iter()
            .copied()
            .filter_map(|f| parse_date_prefix(clicked, f, period).map(|(d, _)| (f, d)))
            .filter(|(_, d)| period.contains_with_leeway(*d))
            .min_by_key(|(_, d)| period.distance(*d))
            .map(|(f, _)| f)
            .ok_or(TeachError::DateNotFound)?;
        layout.dates.formats.retain(|f| *f != format);
        layout.dates.formats.insert(0, format);

        let (index, count, style, _, _) = clicked_money(lines, row.amount)?;
        if let Some(style) = style {
            if !layout.amounts.negatives.contains(&style) {
                layout.amounts.negatives.push(style);
            }
        }
        layout.rows.running_balance = index + 1 < count;
        layout.rows.amount = if index == 0 { AmountPosition::First } else { AmountPosition::Last };
    }

    match &marks.balances {
        Some(BalanceMark::StartEnd { start, end }) => {
            let pair = BalancePair { start: Some(label_for(lines, *start, period)?), end: label_for(lines, *end, period)? };
            let (column, _, _, _, _) = clicked_money(lines, *end)?;
            layout.balances.summary_column = column as u8;
            layout.balances.pairs.retain(|p| p != &pair);
            layout.balances.pairs.insert(0, pair);
        }
        Some(BalanceMark::Totals { additions, subtractions }) => {
            let pair = TotalsPair { additions: label_for(lines, *additions, period)?, subtractions: label_for(lines, *subtractions, period)? };
            let (column, _, _, _, _) = clicked_money(lines, *additions)?;
            layout.balances.summary_column = column as u8;
            layout.balances.activity_totals.retain(|p| p != &pair);
            layout.balances.activity_totals.insert(0, pair);
        }
        None => {}
    }

    for h in &marks.holdings {
        line_at(lines, h.symbol)?;
        let quantity_text = word_at(lines, h.quantity)?;
        let price_text = h.price.map(|p| word_at(lines, p)).transpose()?;
        let total = label_for(lines, h.total, period)?;
        let heading = (0..h.symbol.line)
            .rev()
            .take(30)
            .map(|i| lines[i].text.trim())
            .find(|t| !t.is_empty() && !t.chars().any(|c| c.is_ascii_digit()) && t.split_whitespace().count() >= 1 && !super::holdings::is_ticker(t.split_whitespace().next().unwrap_or("")))
            .map(str::to_string)
            .filter(|t| is_safe_phrase(t))
            .ok_or(TeachError::LabelLooksPersonal)?;
        let mut fields = vec![(h.symbol, HoldingField::Symbol), (h.quantity, HoldingField::Quantity), (h.market_value, HoldingField::MarketValue)];
        if let Some(p) = h.price {
            fields.push((p, HoldingField::Price));
        }
        fields.sort_by_key(|(r, _)| (r.line, r.start));
        let mut order: Vec<HoldingField> = fields.into_iter().map(|(_, f)| f).collect();
        let symbol_at = order.iter().position(|f| *f == HoldingField::Symbol).unwrap_or(0);
        order.insert(symbol_at + 1, HoldingField::Name);
        let rules = layout.holdings.get_or_insert_with(|| super::layout::HoldingRules {
            heading: vec![],
            order: vec![],
            quantity_decimals: 0,
            price_decimals: 0,
            total: vec![],
            cash: vec![],
        });
        if !rules.heading.contains(&heading) {
            rules.heading.insert(0, heading);
        }
        if !rules.total.contains(&total) {
            rules.total.insert(0, total);
        }
        rules.order = order;
        rules.quantity_decimals = decimals_in(&quantity_text);
        rules.price_decimals = price_text.as_deref().map(decimals_in).unwrap_or(rules.price_decimals);
    }

    // Money out may be printed positive: keep whichever direction makes the statement add up.
    let try_both = |l: &StatementLayout| {
        let (_, checks) = read_with(lines, l, period);
        checks.iter().map(|c| c.passed() as i64 - c.failed() as i64).sum::<i64>()
    };
    let mut reversed = layout.clone();
    reversed.rows.reversed = !layout.rows.reversed;
    if try_both(&reversed) > try_both(&layout) {
        layout = reversed;
    }
    layout.validate().map_err(|_| TeachError::LabelLooksPersonal)?;
    Ok(layout)
}

fn word_at(lines: &[StatementLine], r: TextRef) -> Result<String, TeachError> {
    let (text, at) = line_at(lines, r)?;
    Ok(text[at..].split_whitespace().next().ok_or(TeachError::NotThere)?.to_string())
}

/// Keeps only the date formats and negative styles one successful reading actually used.
pub fn narrow(layout: &StatementLayout, lines: &[StatementLine], sections: &[StatementSection], period: &Period) -> StatementLayout {
    let mut out = layout.clone();
    let row_lines: Vec<&str> = sections.iter().flat_map(|s| s.rows.iter().map(|r| lines[r.line].text.as_str())).collect();
    let used: Vec<DateFormat> = layout
        .dates
        .formats
        .iter()
        .copied()
        .filter(|f| {
            let only = super::layout::DateRules { formats: vec![*f], ..layout.dates.clone() };
            row_lines.iter().any(|l| leading_date(l, &only, period).is_some())
        })
        .collect();
    if !used.is_empty() {
        out.dates.formats = used;
    }
    let mut styles: Vec<NegativeStyle> = Vec::new();
    for text in lines.iter().map(|l| l.text.as_str()) {
        for m in find_money(text, &layout.amounts) {
            if let Some(s) = m.negative_style {
                if !styles.contains(&s) {
                    styles.push(s);
                }
            }
        }
    }
    out.amounts.negatives = styles;
    out
}

const GENERIC: &[&str] = &["statement", "account", "summary", "page", "balance", "date", "total", "details", "activity", "transactions", "amount", "description", "of", "and", "the", "your", "for"];

/// A name and up to two recognition phrases from page 1: short, safe lines of words (no digits) that
/// aren't the person's own account or household names.
pub fn suggest_name_and_phrases(lines: &[StatementLine], avoid: &[String]) -> (String, Vec<String>) {
    let avoid: Vec<String> = avoid.iter().map(|a| a.to_lowercase()).collect();
    let mut phrases: Vec<String> = Vec::new();
    for line in lines.iter().filter(|l| l.page == 0) {
        let t = line.text.trim();
        let words: Vec<&str> = t.split_whitespace().collect();
        let lower = t.to_lowercase();
        if !(2..=6).contains(&words.len())
            || !(4..=40).contains(&t.len())
            || t.chars().any(|c| c.is_ascii_digit())
            || !is_safe_phrase(t)
            || words.iter().all(|w| GENERIC.contains(&w.to_lowercase().trim_matches(|c: char| !c.is_alphanumeric())))
            || avoid.iter().any(|a| !a.is_empty() && (lower.contains(a) || a.contains(&lower)))
            || phrases.iter().any(|p| p.eq_ignore_ascii_case(t))
        {
            continue;
        }
        phrases.push(t.to_string());
        if phrases.len() == 2 {
            break;
        }
    }
    let name = phrases.first().cloned().unwrap_or_else(|| "My statement".to_string());
    (name, phrases)
}
```

(Up to two candidates are returned; the review screen ticks the first by default and lets the person tick the second. In the test fixture only one line qualifies.)

- [ ] **Step 4: Run to verify pass** — `cargo test -p budget_core --lib statement::` → PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/statement/mod.rs core/src/statement/learn.rs
git commit -m "Learn statement layouts automatically and from the person's examples"
```

---

### Task 16: Matching statement rows to the account's transactions

**Files:**
- Create: `core/src/statement/matching.rs`; add `pub mod matching;`

**Interfaces:**
- Consumes: `AccountKind` (Task 2, re-exported here), `Period`, `SignRules`.
- Produces: `pub use crate::store::AccountKind;`; `pub fn to_app_amount(printed: Decimal, kind: AccountKind, signs: &SignRules, flip: bool) -> Decimal`; `pub struct StatementItem { pub index: usize, pub date: NaiveDate, pub description: String, pub amount: Decimal }`; `pub struct AppItem { pub id: i64, pub date: NaiveDate, pub description: String, pub amount: Decimal }`; `pub struct MatchResult { pub matched: Vec<(usize, i64)>, pub possible: Vec<(usize, Vec<i64>)>, pub missing: Vec<usize>, pub not_on_statement: Vec<i64> }`; `pub const AUTO_DAYS: i64 = 3`; `pub const POSSIBLE_DAYS: i64 = 10`; `pub fn match_items(items: &[StatementItem], app: &[AppItem], period: &Period) -> MatchResult`; `pub fn suggest_flip(items: &[StatementItem], app: &[AppItem], period: &Period) -> bool`.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn d(s: &str) -> NaiveDate { s.parse().unwrap() }
    fn p() -> Period { Period::new(d("2026-08-01"), d("2026-08-31")).unwrap() }
    fn item(i: usize, date: &str, desc: &str, amt: Decimal) -> StatementItem { StatementItem { index: i, date: d(date), description: desc.into(), amount: amt } }
    fn app(id: i64, date: &str, desc: &str, amt: Decimal) -> AppItem { AppItem { id, date: d(date), description: desc.into(), amount: amt } }

    #[test]
    fn signs_follow_the_account_kind() {
        let s = SignRules::default();
        assert_eq!(to_app_amount(dec!(7.40), AccountKind::Credit, &s, false), dec!(-7.40));
        assert_eq!(to_app_amount(dec!(-43.08), AccountKind::Credit, &s, false), dec!(43.08));
        assert_eq!(to_app_amount(dec!(-10.84), AccountKind::Cash, &s, false), dec!(-10.84));
        assert_eq!(to_app_amount(dec!(2405.94), AccountKind::Loan, &s, false), dec!(2405.94));
        assert_eq!(to_app_amount(dec!(-10.84), AccountKind::Cash, &s, true), dec!(10.84));
        let flipped = SignRules { flip_credit: true, ..Default::default() };
        assert_eq!(to_app_amount(dec!(7.40), AccountKind::Credit, &flipped, false), dec!(7.40));
    }

    #[test]
    fn exact_amount_within_three_days_matches_closest_date_first() {
        let r = match_items(&[item(0, "2026-08-10", "COFFEE SHOP", dec!(-4.50))], &[app(1, "2026-08-13", "Coffee", dec!(-4.50)), app(2, "2026-08-11", "Coffee", dec!(-4.50))], &p());
        assert_eq!(r.matched, vec![(0, 2)]);
        assert_eq!(r.not_on_statement, vec![1]);
    }

    #[test]
    fn a_cent_off_never_matches() {
        let r = match_items(&[item(0, "2026-08-10", "Gas", dec!(-30.00))], &[app(1, "2026-08-10", "Gas", dec!(-30.01))], &p());
        assert_eq!((r.matched.len(), r.missing), (0, vec![0]));
    }

    #[test]
    fn four_to_ten_days_off_is_only_possible() {
        let r = match_items(&[item(0, "2026-08-10", "Rent", dec!(-900))], &[app(1, "2026-08-17", "Rent", dec!(-900))], &p());
        assert_eq!(r.possible, vec![(0, vec![1])]);
        assert!(r.matched.is_empty() && r.not_on_statement.is_empty());
    }

    #[test]
    fn two_different_equally_good_candidates_are_possible_not_guessed() {
        let r = match_items(&[item(0, "2026-08-10", "TRANSFER", dec!(-50))], &[app(1, "2026-08-09", "Savings", dec!(-50)), app(2, "2026-08-11", "Gift", dec!(-50))], &p());
        assert_eq!(r.possible, vec![(0, vec![1, 2])]);
    }

    #[test]
    fn the_better_description_breaks_a_date_tie() {
        let r = match_items(&[item(0, "2026-08-10", "CORNER CAFE SPRINGFIELD", dec!(-4.50))], &[app(1, "2026-08-11", "Bakery", dec!(-4.50)), app(2, "2026-08-09", "Corner Cafe", dec!(-4.50))], &p());
        assert_eq!(r.matched, vec![(0, 2)]);
    }

    #[test]
    fn identical_twins_match_one_to_one_instead_of_staying_possible() {
        let r = match_items(
            &[item(0, "2026-08-10", "COFFEE", dec!(-4.50)), item(1, "2026-08-10", "COFFEE", dec!(-4.50))],
            &[app(5, "2026-08-10", "Coffee", dec!(-4.50)), app(6, "2026-08-10", "Coffee", dec!(-4.50))],
            &p(),
        );
        assert_eq!(r.matched, vec![(0, 5), (1, 6)]);
        assert!(r.possible.is_empty());
    }

    #[test]
    fn a_flip_is_suggested_only_when_clearly_better() {
        let items = [item(0, "2026-08-03", "A", dec!(7.40)), item(1, "2026-08-04", "B", dec!(2.99))];
        let app_items = [app(1, "2026-08-03", "A", dec!(-7.40)), app(2, "2026-08-04", "B", dec!(-2.99))];
        assert!(suggest_flip(&items, &app_items, &p()));
        let right = [item(0, "2026-08-03", "A", dec!(-7.40)), item(1, "2026-08-04", "B", dec!(-2.99))];
        assert!(!suggest_flip(&right, &app_items, &p()));
    }
}
```

- [ ] **Step 2: Run to verify failure** — compile error.

- [ ] **Step 3: Implement** `core/src/statement/matching.rs`:

```rust
//! Pairing statement rows with the account's not-yet-settled transactions, one to one. An amount must
//! be exactly equal; a date within 3 days matches automatically, 4–10 days (or a tie between two
//! different candidates) is only a possible match the person confirms.

pub use crate::store::AccountKind;
use super::layout::SignRules;
use super::model::Period;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::collections::HashSet;

pub const AUTO_DAYS: i64 = 3;
pub const POSSIBLE_DAYS: i64 = 10;

/// Statement amount (statement's own terms) → the app's sign for this kind of account.
pub fn to_app_amount(printed: Decimal, kind: AccountKind, signs: &SignRules, flip: bool) -> Decimal {
    let (base, layout_flip) = match kind {
        AccountKind::Cash => (printed, signs.flip_cash),
        AccountKind::Credit => (-printed, signs.flip_credit),
        AccountKind::Loan => (printed, signs.flip_loan),
        AccountKind::Investment => (printed, signs.flip_investment),
    };
    if layout_flip != flip { -base } else { base }
}

#[derive(Debug, Clone, PartialEq)]
pub struct StatementItem {
    pub index: usize,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AppItem {
    pub id: i64,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct MatchResult {
    pub matched: Vec<(usize, i64)>,
    pub possible: Vec<(usize, Vec<i64>)>,
    pub missing: Vec<usize>,
    pub not_on_statement: Vec<i64>,
}

fn words(s: &str) -> HashSet<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() >= 3)
        .map(str::to_string)
        .collect()
}

/// Shared-word share of two descriptions, 0–1000.
fn similarity(a: &str, b: &str) -> i64 {
    let (a, b) = (words(a), words(b));
    let union = a.union(&b).count();
    if union == 0 { 0 } else { (a.intersection(&b).count() * 1000 / union) as i64 }
}

pub fn match_items(items: &[StatementItem], app: &[AppItem], period: &Period) -> MatchResult {
    // (days apart, -similarity, item position, app position)
    let mut pairs: Vec<(i64, i64, usize, usize)> = Vec::new();
    for (ii, item) in items.iter().enumerate() {
        for (ai, a) in app.iter().enumerate() {
            let days = (a.date - item.date).num_days().abs();
            if a.amount == item.amount && days <= AUTO_DAYS {
                pairs.push((days, -similarity(&item.description, &a.description), ii, ai));
            }
        }
    }
    pairs.sort();
    let same_app = |x: usize, y: usize| app[x].date == app[y].date && app[x].amount == app[y].amount && app[x].description.eq_ignore_ascii_case(&app[y].description);

    let mut result = MatchResult::default();
    let mut used_item = vec![false; items.len()];
    let mut used_app = vec![false; app.len()];
    let mut in_possible: HashSet<usize> = HashSet::new();
    for &(days, sim, ii, ai) in &pairs {
        if used_item[ii] || used_app[ai] {
            continue;
        }
        let ties: Vec<usize> = pairs
            .iter()
            .filter(|&&(d, s, i, a)| i == ii && a != ai && d == days && s == sim && !used_app[a] && !same_app(a, ai))
            .map(|&(_, _, _, a)| a)
            .collect();
        used_item[ii] = true;
        if ties.is_empty() {
            used_app[ai] = true;
            result.matched.push((items[ii].index, app[ai].id));
        } else {
            let mut ids: Vec<i64> = std::iter::once(ai).chain(ties.iter().copied()).map(|a| app[a].id).collect();
            ids.sort();
            in_possible.extend(std::iter::once(ai).chain(ties));
            result.possible.push((items[ii].index, ids));
        }
    }
    for (ii, item) in items.iter().enumerate() {
        if used_item[ii] {
            continue;
        }
        let ids: Vec<i64> = app
            .iter()
            .enumerate()
            .filter(|(ai, a)| !used_app[*ai] && a.amount == item.amount && (a.date - item.date).num_days().abs() <= POSSIBLE_DAYS)
            .map(|(ai, a)| {
                in_possible.insert(ai);
                a.id
            })
            .collect();
        if ids.is_empty() { result.missing.push(item.index) } else { result.possible.push((item.index, ids)) }
    }
    result.matched.sort();
    result.possible.sort();
    result.not_on_statement = app
        .iter()
        .enumerate()
        .filter(|(ai, a)| !used_app[*ai] && !in_possible.contains(ai) && period.contains(a.date))
        .map(|(_, a)| a.id)
        .collect();
    result
}

/// Suggest reversing every sign when that matches strictly more rows and at least half of them.
pub fn suggest_flip(items: &[StatementItem], app: &[AppItem], period: &Period) -> bool {
    let normal = match_items(items, app, period).matched.len();
    let flipped: Vec<StatementItem> = items.iter().map(|i| StatementItem { amount: -i.amount, ..i.clone() }).collect();
    let reversed = match_items(&flipped, app, period).matched.len();
    reversed > normal && reversed * 2 >= items.len()
}
```

- [ ] **Step 4: Run to verify pass** — `cargo test -p budget_core --lib statement::` → PASS. Also run the whole core: `cargo test -p budget_core` → PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/statement/mod.rs core/src/statement/matching.rs
git commit -m "Match statement rows to the account's transactions one to one"
```

## Phase C — Storage and commands

### Task 17: Learned layouts in the profile

**Files:**
- Create: `core/src/store/statement_layouts.rs`; modify `core/src/store.rs` (`mod statement_layouts; pub use statement_layouts::*;`)
- Create test: `core/src/store/tests/statement_layouts.rs`; add `mod statement_layouts;` to `core/src/store/tests.rs`

**Interfaces:**
- Produces: `pub struct StoredLayout { pub id: i64, pub name: String, pub layout: StatementLayout, pub updated_at: String }`; `pub enum LayoutSaveError { Name, Missing, Layout(LayoutError), Db(rusqlite::Error) }` (`Display`); `Store::list_statement_layouts(&self) -> rusqlite::Result<Vec<StoredLayout>>`; `Store::save_statement_layout(&self, id: Option<i64>, name: &str, layout: &StatementLayout, now: NaiveDateTime) -> Result<i64, LayoutSaveError>`; `Store::rename_statement_layout(&self, id: i64, name: &str, now: NaiveDateTime) -> Result<(), LayoutSaveError>`; `Store::delete_statement_layout(&self, id: i64) -> rusqlite::Result<()>`.

- [ ] **Step 1: Write the failing tests** — `core/src/store/tests/statement_layouts.rs`:

```rust
use super::*;
use crate::statement::layout::{built_in_layouts, GENERAL_ID};

fn general() -> crate::statement::layout::StatementLayout {
    built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap()
}

#[test]
fn a_learned_layout_is_saved_listed_renamed_and_removed() {
    let store = Store::open_in_memory().unwrap();
    let mut layout = general();
    layout.recognize = vec!["Riverbend Mutual Bank".into()];
    let id = store.save_statement_layout(None, "Riverbend", &layout, test_now()).unwrap();

    let listed = store.list_statement_layouts().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!((listed[0].id, listed[0].name.as_str(), listed[0].layout.name.as_str()), (id, "Riverbend", "Riverbend"));
    assert_eq!(listed[0].layout.recognize, vec!["Riverbend Mutual Bank".to_string()]);

    store.rename_statement_layout(id, "Riverbend checking", test_now()).unwrap();
    assert_eq!(store.list_statement_layouts().unwrap()[0].name, "Riverbend checking");

    store.delete_statement_layout(id).unwrap();
    assert!(store.list_statement_layouts().unwrap().is_empty());
}

#[test]
fn names_that_look_personal_are_refused() {
    let store = Store::open_in_memory().unwrap();
    assert!(matches!(store.save_statement_layout(None, "Card 61006", &general(), test_now()), Err(LayoutSaveError::Name)));
    assert!(matches!(store.save_statement_layout(None, "  ", &general(), test_now()), Err(LayoutSaveError::Name)));
}

#[test]
fn a_stored_layout_that_fails_validation_is_skipped_not_fatal() {
    let store = Store::open_in_memory().unwrap();
    store.save_statement_layout(None, "Good", &general(), test_now()).unwrap();
    store
        .conn
        .execute(
            "INSERT INTO statement_layouts (name, layout, created_at, updated_at) VALUES ('Broken', '{\"schema\":99}', 'x', 'x')",
            [],
        )
        .unwrap();
    let names: Vec<String> = store.list_statement_layouts().unwrap().into_iter().map(|l| l.name).collect();
    assert_eq!(names, vec!["Good".to_string()]);
}

#[test]
fn updating_a_missing_layout_says_so() {
    let store = Store::open_in_memory().unwrap();
    assert!(matches!(store.save_statement_layout(Some(999), "Gone", &general(), test_now()), Err(LayoutSaveError::Missing)));
}
```

- [ ] **Step 2: Run to verify failure** — `cargo test -p budget_core --lib store::tests::statement_layouts` → compile error.

- [ ] **Step 3: Implement** `core/src/store/statement_layouts.rs`:

```rust
//! Statement layouts the app learned for this profile. Stored as validated JSON; a row that no longer
//! validates (damaged, or written by a newer app) is skipped rather than breaking statement reading.

use super::Store;
use crate::statement::layout::{is_safe_phrase, LayoutError, StatementLayout};
use chrono::NaiveDateTime;
use rusqlite::params;

#[derive(Debug, Clone, PartialEq)]
pub struct StoredLayout {
    pub id: i64,
    pub name: String,
    pub layout: StatementLayout,
    pub updated_at: String,
}

#[derive(Debug)]
pub enum LayoutSaveError {
    Name,
    Missing,
    Layout(LayoutError),
    Db(rusqlite::Error),
}

impl From<rusqlite::Error> for LayoutSaveError {
    fn from(e: rusqlite::Error) -> Self {
        LayoutSaveError::Db(e)
    }
}

impl std::fmt::Display for LayoutSaveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LayoutSaveError::Name => write!(f, "Give it a name of up to 80 characters, without account numbers, email addresses or phone numbers."),
            LayoutSaveError::Missing => write!(f, "That statement is no longer in the list. Read the statement again."),
            LayoutSaveError::Layout(e) => write!(f, "{e}"),
            LayoutSaveError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for LayoutSaveError {}

impl Store {
    pub fn list_statement_layouts(&self) -> rusqlite::Result<Vec<StoredLayout>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, layout, updated_at FROM statement_layouts ORDER BY name COLLATE NOCASE, id")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows
            .into_iter()
            .filter_map(|(id, name, json, updated_at)| StatementLayout::from_json(&json).ok().map(|layout| StoredLayout { id, name, layout, updated_at }))
            .collect())
    }

    pub fn save_statement_layout(&self, id: Option<i64>, name: &str, layout: &StatementLayout, now: NaiveDateTime) -> Result<i64, LayoutSaveError> {
        let name = name.trim();
        if !is_safe_phrase(name) {
            return Err(LayoutSaveError::Name);
        }
        let mut layout = layout.clone();
        layout.name = name.to_string();
        layout.id = "learned".to_string();
        layout.validate().map_err(LayoutSaveError::Layout)?;
        let json = layout.to_json();
        match id {
            Some(id) => {
                let changed = self.conn.execute(
                    "UPDATE statement_layouts SET name = ?1, layout = ?2, updated_at = ?3 WHERE id = ?4",
                    params![name, json, now.to_string(), id],
                )?;
                if changed == 0 {
                    return Err(LayoutSaveError::Missing);
                }
                Ok(id)
            }
            None => {
                self.conn.execute(
                    "INSERT INTO statement_layouts (name, layout, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                    params![name, json, now.to_string()],
                )?;
                Ok(self.conn.last_insert_rowid())
            }
        }
    }

    pub fn rename_statement_layout(&self, id: i64, name: &str, now: NaiveDateTime) -> Result<(), LayoutSaveError> {
        let stored = self.list_statement_layouts()?.into_iter().find(|l| l.id == id).ok_or(LayoutSaveError::Missing)?;
        self.save_statement_layout(Some(id), name, &stored.layout, now).map(|_| ())
    }

    pub fn delete_statement_layout(&self, id: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM statement_layouts WHERE id = ?1", params![id])?;
        Ok(())
    }
}
```

- [ ] **Step 4: Run to verify pass** — `cargo test -p budget_core --lib store::tests::statement_layouts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store.rs core/src/store/statement_layouts.rs core/src/store/tests.rs core/src/store/tests/statement_layouts.rs
git commit -m "Store learned statement layouts per profile"
```

---

### Task 18: Statement candidates, the review signature and the one-step statement finish

**Files:**
- Modify: `core/src/store/reconcile.rs`, `core/src/store/investments.rs` (`update_holding_shares`)
- Test: `core/src/store/tests/reconcile.rs`

**Interfaces:**
- Consumes: `Period`, `StatementLayout`, `save_statement_layout`, `save_transactions_with_ids`, `set_transactions_cleared`, `create_holding`, `delete_holding`, `balance_change`, `reconcile_status`, `insert_reconciliation`, `settle_ticked`.
- Produces:
  - `pub struct CandidateTx { pub id: i64, pub date: NaiveDate, pub description: String, pub amount: Decimal, pub change: Decimal }`
  - `Store::statement_candidates(&self, account_id: i64, period: &Period) -> rusqlite::Result<Vec<CandidateTx>>`
  - `Store::reconcile_signature(&self, account_id: i64) -> rusqlite::Result<String>`
  - `Store::update_holding_shares(&self, id: i64, shares: Decimal) -> rusqlite::Result<()>`
  - `pub enum HoldingChange { SetShares { holding_id: i64, shares: Decimal }, Add { symbol: String, name: String, shares: Decimal, price: Decimal, cost_basis: Decimal }, Remove { holding_id: i64 } }`
  - `pub struct StatementFinish { pub account_id: i64, pub period: Period, pub statement_start: Option<Decimal>, pub statement_end: Option<Decimal>, pub ending_value: Option<Decimal>, pub source: ReconcileSource, pub matched: Vec<i64>, pub add: Vec<Transaction>, pub holdings: Vec<HoldingChange>, pub statement_shares: Option<Vec<(String, Decimal)>>, pub layout: Option<(Option<i64>, String, StatementLayout)> }`
  - `pub enum StatementFinishError { DoesNotBalance, SharesDiffer(String), NotThisAccount, AlreadyInApp, Layout(LayoutSaveError), Db(rusqlite::Error) }` (`Display` = the plain messages below)
  - `pub struct StatementFinished { pub reconciliation_id: i64, pub added: usize, pub layout_id: Option<i64> }`
  - `Store::finish_statement_reconciliation(&self, f: &StatementFinish, now: NaiveDateTime) -> Result<StatementFinished, StatementFinishError>`

- [ ] **Step 1: Write the failing tests** (append to `core/src/store/tests/reconcile.rs`):

```rust
use crate::statement::Period;
use crate::store::{HoldingChange, StatementFinish, StatementFinishError};

fn august() -> Period {
    Period::new(day("2026-08-01"), day("2026-08-31")).unwrap()
}

fn finish_cash(acct: i64, matched: Vec<i64>, add: Vec<Transaction>, start: &str, end: &str) -> StatementFinish {
    StatementFinish {
        account_id: acct,
        period: august(),
        statement_start: Some(dec(start)),
        statement_end: Some(dec(end)),
        ending_value: None,
        source: ReconcileSource::StatementPdf,
        matched,
        add,
        holdings: vec![],
        statement_shares: None,
        layout: None,
    }
}

#[test]
fn candidates_are_unsettled_rows_near_the_period_with_their_balance_change() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Card", AccountType::Credit).unwrap();
    store
        .save_transactions(card, &[tx("2026-07-20", "Too early", "-1.00"), tx("2026-07-28", "Leeway", "-2.00"), tx("2026-08-15", "Inside", "-3.00")])
        .unwrap();
    let c = store.statement_candidates(card, &august()).unwrap();
    assert_eq!(c.iter().map(|x| x.description.as_str()).collect::<Vec<_>>(), vec!["Leeway", "Inside"]);
    assert_eq!(c[1].change, dec("3.00"), "a card charge raises what is owed");
}

#[test]
fn a_statement_finish_ticks_adds_settles_and_unticks_what_was_not_on_it() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[gas], true).unwrap(); // ticked early; not on this statement
    let done = store
        .finish_statement_reconciliation(&finish_cash(acct, vec![coffee], vec![tx("2026-08-20", "Bank fee", "-5.00")], "1200.00", "1145.00"), test_now())
        .unwrap();
    assert_eq!(done.added, 1);
    let settled = |id: i64| -> Option<i64> {
        store.conn.query_row("SELECT reconciliation_id FROM transactions WHERE id = ?1", params![id], |r| r.get(0)).unwrap()
    };
    assert_eq!(settled(coffee), Some(done.reconciliation_id));
    assert_eq!(settled(gas), None);
    let gas_ticked: bool = store.conn.query_row("SELECT cleared FROM transactions WHERE id = ?1", params![gas], |r| r.get(0)).unwrap();
    assert!(!gas_ticked);
    let _ = deposit;
    let source: String = store.conn.query_row("SELECT source FROM reconciliations WHERE id = ?1", params![done.reconciliation_id], |r| r.get(0)).unwrap();
    assert_eq!(source, "statement_pdf");
}

#[test]
fn a_statement_finish_that_does_not_balance_writes_nothing_at_all() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, _]) = checking(&store);
    let result = store.finish_statement_reconciliation(&finish_cash(acct, vec![coffee], vec![tx("2026-08-20", "Bank fee", "-5.00")], "1200.00", "9999.00"), test_now());
    assert!(matches!(result, Err(StatementFinishError::DoesNotBalance)));
    let fee: i64 = store.conn.query_row("SELECT COUNT(*) FROM transactions WHERE description = 'Bank fee'", [], |r| r.get(0)).unwrap();
    assert_eq!(fee, 0, "the added transaction was rolled back");
    assert_eq!(store.last_reconciliation(acct).unwrap(), None);
}

#[test]
fn a_transaction_from_another_account_is_refused() {
    let store = Store::open_in_memory().unwrap();
    let (acct, _) = checking(&store);
    let other = store.get_or_create_account("Other", AccountType::Checking).unwrap();
    store.save_transactions(other, &[tx("2026-08-10", "Elsewhere", "-50.00")]).unwrap();
    let elsewhere = id_of(&store, "Elsewhere", "2026-08-10");
    let result = store.finish_statement_reconciliation(&finish_cash(acct, vec![elsewhere], vec![], "1200.00", "1150.00"), test_now());
    assert!(matches!(result, Err(StatementFinishError::NotThisAccount)));
}

#[test]
fn an_investment_finish_fixes_share_counts_and_requires_them_to_match() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let held = store.create_holding(brokerage, "ABCD", "Alpha", dec("49"), dec("300"), dec("10000"), None).unwrap();
    let base = StatementFinish {
        account_id: brokerage,
        period: august(),
        statement_start: None,
        statement_end: None,
        ending_value: Some(dec("84089.71")),
        source: ReconcileSource::StatementPdf,
        matched: vec![],
        add: vec![tx("2026-08-05", "Cash Dividend", "18.50")],
        holdings: vec![],
        statement_shares: Some(vec![("ABCD".into(), dec("50.000")), ("EFGH".into(), dec("252.523"))]),
        layout: None,
    };

    let refused = store.finish_statement_reconciliation(&base, test_now());
    assert!(matches!(refused, Err(StatementFinishError::SharesDiffer(ref s)) if s == "ABCD"));

    let fixed = StatementFinish {
        holdings: vec![
            HoldingChange::SetShares { holding_id: held, shares: dec("50") },
            HoldingChange::Add { symbol: "EFGH".into(), name: "Example Income".into(), shares: dec("252.523"), price: dec("9.47"), cost_basis: dec("2400") },
        ],
        ..base
    };
    let done = store.finish_statement_reconciliation(&fixed, test_now()).unwrap();
    let checked: Option<i64> = store
        .conn
        .query_row("SELECT holdings_checked FROM reconciliations WHERE id = ?1", params![done.reconciliation_id], |r| r.get(0))
        .unwrap();
    assert_eq!(checked, Some(1));
    assert_eq!(store.list_holdings(far_future()).unwrap().len(), 2);
}

#[test]
fn a_learned_layout_is_saved_in_the_same_step_and_rolled_back_with_it() {
    use crate::statement::layout::{built_in_layouts, GENERAL_ID};
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, _]) = checking(&store);
    let layout = built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap();
    let mut f = finish_cash(acct, vec![coffee], vec![], "1200.00", "9999.00");
    f.layout = Some((None, "Riverbend".into(), layout.clone()));
    assert!(store.finish_statement_reconciliation(&f, test_now()).is_err());
    assert!(store.list_statement_layouts().unwrap().is_empty());

    f.statement_end = Some(dec("1150.00"));
    let done = store.finish_statement_reconciliation(&f, test_now()).unwrap();
    assert!(done.layout_id.is_some());
    assert_eq!(store.list_statement_layouts().unwrap().len(), 1);
}

#[test]
fn the_review_signature_changes_when_the_account_changes() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, _, _]) = checking(&store);
    let before = store.reconcile_signature(acct).unwrap();
    assert_eq!(before, store.reconcile_signature(acct).unwrap());
    store.set_transactions_cleared(&[deposit], true).unwrap();
    assert_ne!(before, store.reconcile_signature(acct).unwrap());
}
```

- [ ] **Step 2: Run to verify failure** — compile error.

- [ ] **Step 3: Implement**

In `core/src/store/investments.rs`:

```rust
    /// Sets a holding's share count (reconciling against a statement).
    pub fn update_holding_shares(&self, id: i64, shares: Decimal) -> rusqlite::Result<()> {
        self.conn.execute("UPDATE holdings SET shares = ?1 WHERE id = ?2", params![shares.to_string(), id])?;
        Ok(())
    }
```

Append to `core/src/store/reconcile.rs` (add imports `use crate::models::Transaction; use crate::statement::layout::StatementLayout; use crate::statement::Period; use super::LayoutSaveError; use chrono::Duration; use sha2::{Digest, Sha256}; use std::collections::HashMap;`):

```rust
/// A transaction a statement row could match: not yet settled, dated near the statement period.
#[derive(Debug, Clone, PartialEq)]
pub struct CandidateTx {
    pub id: i64,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
    /// How it moves the statement's balance (see `balance_change`).
    pub change: Decimal,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HoldingChange {
    SetShares { holding_id: i64, shares: Decimal },
    Add { symbol: String, name: String, shares: Decimal, price: Decimal, cost_basis: Decimal },
    Remove { holding_id: i64 },
}

/// Everything one statement reconciliation writes, applied together or not at all.
pub struct StatementFinish {
    pub account_id: i64,
    pub period: Period,
    pub statement_start: Option<Decimal>,
    pub statement_end: Option<Decimal>,
    /// An investment statement's total value, kept for reference.
    pub ending_value: Option<Decimal>,
    pub source: ReconcileSource,
    pub matched: Vec<i64>,
    /// Statement rows to add, already in the app's sign and categorised.
    pub add: Vec<Transaction>,
    pub holdings: Vec<HoldingChange>,
    /// Investment statements: the share counts the app must hold afterwards; `None` = not checked.
    pub statement_shares: Option<Vec<(String, Decimal)>>,
    /// (existing learned layout to update, name, layout) to remember for next time.
    pub layout: Option<(Option<i64>, String, StatementLayout)>,
}

#[derive(Debug)]
pub enum StatementFinishError {
    DoesNotBalance,
    SharesDiffer(String),
    NotThisAccount,
    AlreadyInApp,
    Layout(LayoutSaveError),
    Db(rusqlite::Error),
}

impl From<rusqlite::Error> for StatementFinishError {
    fn from(e: rusqlite::Error) -> Self {
        let constraint = matches!(&e, rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation);
        if constraint { StatementFinishError::AlreadyInApp } else { StatementFinishError::Db(e) }
    }
}

impl std::fmt::Display for StatementFinishError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StatementFinishError::DoesNotBalance => write!(f, "That doesn't balance yet — the difference has to be $0.00."),
            StatementFinishError::SharesDiffer(symbol) => write!(f, "The share count for {symbol} still differs from your statement."),
            StatementFinishError::NotThisAccount => write!(f, "Your data changed while you were reviewing. Please read the statement again."),
            StatementFinishError::AlreadyInApp => write!(f, "One of the transactions to add is already in the app. Read the statement again."),
            StatementFinishError::Layout(e) => write!(f, "{e}"),
            StatementFinishError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for StatementFinishError {}

#[derive(Debug, Clone, PartialEq)]
pub struct StatementFinished {
    pub reconciliation_id: i64,
    pub added: usize,
    pub layout_id: Option<i64>,
}

impl Store {
    pub fn statement_candidates(&self, account_id: i64, period: &Period) -> rusqlite::Result<Vec<CandidateTx>> {
        let kind = self.account_kind(account_id)?;
        let from = period.start - Duration::days(Period::LEEWAY_DAYS);
        let to = period.end + Duration::days(Period::LEEWAY_DAYS);
        let mut stmt = self.conn.prepare(
            "SELECT id, date, description, amount, principal_amount FROM transactions
             WHERE account_id = ?1 AND reconciliation_id IS NULL AND deleted_at IS NULL AND date >= ?2 AND date <= ?3
             ORDER BY date, id",
        )?;
        let rows = stmt
            .query_map(params![account_id, from.to_string(), to.to_string()], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, Option<String>>(4)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows
            .into_iter()
            .map(|(id, date, description, amount, principal)| {
                let amount = dec(&amount);
                CandidateTx {
                    id,
                    date: NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("dates stored by this crate are valid"),
                    description,
                    amount,
                    change: balance_change(kind, amount, principal.as_deref().map(dec)),
                }
            })
            .collect())
    }

    /// A fingerprint of everything a statement review relies on for this account (its transactions'
    /// amounts, dates, ticks and settlement, its holdings and its last reconciliation), so finishing can
    /// tell whether anything changed while the person was reviewing.
    pub fn reconcile_signature(&self, account_id: i64) -> rusqlite::Result<String> {
        let mut hasher = Sha256::new();
        let mut stmt = self.conn.prepare(
            "SELECT id || '|' || date || '|' || amount || '|' || COALESCE(principal_amount, '') || '|' || cleared || '|' ||
                    COALESCE(reconciliation_id, '') || '|' || COALESCE(deleted_at, '')
             FROM transactions WHERE account_id = ?1 ORDER BY id",
        )?;
        for row in stmt.query_map(params![account_id], |r| r.get::<_, String>(0))? {
            hasher.update(row?.as_bytes());
            hasher.update(b"\n");
        }
        let mut stmt = self.conn.prepare("SELECT id || '|' || symbol || '|' || shares FROM holdings WHERE account_id = ?1 ORDER BY id")?;
        for row in stmt.query_map(params![account_id], |r| r.get::<_, String>(0))? {
            hasher.update(row?.as_bytes());
            hasher.update(b"\n");
        }
        let last: Option<i64> = self.conn.query_row("SELECT MAX(id) FROM reconciliations WHERE account_id = ?1", params![account_id], |r| r.get(0))?;
        hasher.update(last.unwrap_or(0).to_string().as_bytes());
        Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
    }

    fn holding_in_account(&self, holding_id: i64, account_id: i64) -> Result<(), StatementFinishError> {
        let n: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM holdings WHERE id = ?1 AND account_id = ?2", params![holding_id, account_id], |r| r.get(0))?;
        if n == 1 { Ok(()) } else { Err(StatementFinishError::NotThisAccount) }
    }

    pub fn finish_statement_reconciliation(&self, f: &StatementFinish, now: NaiveDateTime) -> Result<StatementFinished, StatementFinishError> {
        let tx = self.conn.unchecked_transaction()?;
        let kind = self.account_kind(f.account_id)?;

        let mut matched = f.matched.clone();
        matched.sort_unstable();
        matched.dedup();
        if matched.len() != f.matched.len() {
            return Err(StatementFinishError::NotThisAccount);
        }
        for id in &matched {
            let n: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM transactions WHERE id = ?1 AND account_id = ?2 AND reconciliation_id IS NULL AND deleted_at IS NULL",
                params![id, f.account_id],
                |r| r.get(0),
            )?;
            if n != 1 {
                return Err(StatementFinishError::NotThisAccount);
            }
        }

        // The statement decides what is ticked: anything ticked earlier but not on it waits for next time.
        self.conn.execute(
            "UPDATE transactions SET cleared = 0 WHERE account_id = ?1 AND reconciliation_id IS NULL AND cleared = 1",
            params![f.account_id],
        )?;
        let added = self.save_transactions_with_ids(f.account_id, &f.add)?;
        let ticked: Vec<i64> = matched.iter().chain(added.iter()).copied().collect();
        self.set_transactions_cleared(&ticked, true)?;

        for change in &f.holdings {
            match change {
                HoldingChange::SetShares { holding_id, shares } => {
                    self.holding_in_account(*holding_id, f.account_id)?;
                    self.update_holding_shares(*holding_id, *shares)?;
                }
                HoldingChange::Add { symbol, name, shares, price, cost_basis } => {
                    self.create_holding(f.account_id, symbol.trim(), name.trim(), *shares, *price, *cost_basis, None)?;
                }
                HoldingChange::Remove { holding_id } => {
                    self.holding_in_account(*holding_id, f.account_id)?;
                    self.delete_holding(*holding_id)?;
                }
            }
        }

        let (statement_end, starting, holdings_checked) = if kind == AccountKind::Investment {
            if let Some(expected) = &f.statement_shares {
                let mut stmt = self.conn.prepare("SELECT symbol, shares FROM holdings WHERE account_id = ?1")?;
                let mut held: HashMap<String, Decimal> = HashMap::new();
                for row in stmt.query_map(params![f.account_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
                    let (symbol, shares) = row?;
                    *held.entry(symbol.trim().to_uppercase()).or_default() += dec(&shares);
                }
                for (symbol, shares) in expected {
                    if held.get(&symbol.trim().to_uppercase()) != Some(shares) {
                        return Err(StatementFinishError::SharesDiffer(symbol.clone()));
                    }
                }
            }
            (f.ending_value.unwrap_or_default(), None, Some(f.statement_shares.is_some()))
        } else {
            let end = f.statement_end.ok_or(StatementFinishError::DoesNotBalance)?;
            let status = self.reconcile_status(f.account_id, f.statement_start, end)?;
            if status.difference != Some(Decimal::ZERO) {
                return Err(StatementFinishError::DoesNotBalance);
            }
            (end, status.starting_point, None)
        };

        let record = FinishReconciliation {
            account_id: f.account_id,
            period_start: Some(f.period.start),
            statement_date: f.period.end,
            statement_start: None,
            statement_end,
            source: f.source,
        };
        let reconciliation_id = self.insert_reconciliation(&record, starting, holdings_checked, now)?;
        self.settle_ticked(f.account_id, reconciliation_id)?;
        let layout_id = match &f.layout {
            Some((id, name, layout)) => Some(self.save_statement_layout(*id, name, layout, now).map_err(StatementFinishError::Layout)?),
            None => None,
        };
        tx.commit()?;
        Ok(StatementFinished { reconciliation_id, added: added.len(), layout_id })
    }
}
```

`ReconcileSource` needs `#[derive(Clone, Copy)]` (already). If `save_transactions_with_ids` or `set_transactions_cleared` ever opens its own transaction, the nested `unchecked_transaction` call would fail with "cannot start a transaction within a transaction" — both are plain statements today (checked when writing this plan); if that changes, use `SAVEPOINT` there instead.

- [ ] **Step 4: Run to verify pass** — `cargo test -p budget_core` → PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/reconcile.rs core/src/store/investments.rs core/src/store/tests/reconcile.rs
git commit -m "Finish a statement reconciliation in one step, including share counts and learned layouts"
```

---

### Task 19: Statement review session and commands

**Files:**
- Create: `src-tauri/src/statement_review.rs`; register the module in `src-tauri/src/lib.rs` (`mod statement_review;`) and manage it (`.manage(statement_review::Sessions::default())` beside `holding_import::Sessions`)
- Create: `src-tauri/src/commands/statements.rs`, `src-tauri/src/commands/statements/tests.rs`
- Modify: `src-tauri/src/commands.rs` (`mod statements; pub use self::statements::*;`), `src-tauri/src/lib.rs` (handler list)

**Interfaces:**
- Consumes: everything in `budget_core::statement`, `Store::{statement_candidates, reconcile_signature, finish_statement_reconciliation, list_statement_layouts, rename_statement_layout, delete_statement_layout, list_holdings, last_reconciliation, account_kind, list_accounts, list_family_members}`, `importer::load_transactions`, `build_classifier`, `budget_core::categorizer::categorize`, `import_resolution::{is_sure, Suggestion}`.
- Produces (commands; every one takes `generation: u64` and refuses a mismatch with "The profile changed. Close this statement and start again in the current profile."):
  - `read_statement(path: String, accountId: i64, periodStart: String, periodEnd: String, generation) -> StatementReadDto { token, sections: Vec<SectionChoiceDto { index, name, row_count, holding_count }>, review: Option<StatementReviewDto> }`
  - `review_statement(token: String, sectionIndex: usize, flip: bool, generation) -> StatementReviewDto`
  - `statement_lines(token, generation) -> Vec<StatementLineDto { index, page, text }>`
  - `teach_statement_layout(token, marks: TeachMarks, generation) -> StatementReviewDto`
  - `finish_statement_reconciliation(token, decisions: FinishDecisionsDto, generation) -> StatementFinishedDto { reconciliation_id, added, layout_saved: Option<String> }`
  - `cancel_statement_review() -> ()`
  - `list_statement_layouts() -> Vec<StatementLayoutDto { id, name, phrases, updated_at }>`, `rename_statement_layout(id, name)`, `delete_statement_layout(id)`
  - `StatementReviewDto` fields (snake_case JSON): `token, account_kind ("cash"|"credit"|"loan"|"investment"), source ("pdf"|"download"), layout_name: Option<String>, recognized, recognized_but_failed, learnable, section_name, period_start, period_end, starting_balance: Option<String>, ending_balance: Option<String>, ending_value: Option<String>, previous_ending_balance: Option<String>, already_reconciled_through: Option<String>, nothing_in_period: bool, activity_check: CheckDto, holdings_check: CheckDto, running_balance_breaks: usize, rows: Vec<ReviewRowDto { index, date, description, amount, status ("matched"|"possible"|"missing"), match_id: Option<i64>, possible_ids: Vec<i64> }>, app_transactions: Vec<AppTxDto { id, date, description, amount, change }>, not_on_statement: Vec<i64>, unread: Vec<UnreadDto { line, text }>, suggest_flip, flipped, holdings: Vec<HoldingReviewDto { symbol, name, statement_shares, price: Option<String>, market_value, app_holding_id: Option<i64>, app_shares: Option<String>, status ("same"|"different"|"missing_in_app") }>, app_only_holdings: Vec<AppHoldingDto { id, symbol, name, shares }>, suggested_name, suggested_phrases: Vec<String>` where `CheckDto = { outcome: "passed"|"failed"|"not_available", expected: Option<String>, found: Option<String> }`.
  - `FinishDecisionsDto` (camelCase JSON): `matches: Vec<{ row, transactionId }>, add: Vec<{ row, date, description, amount }>, skip: Vec<usize>, startingBalance: Option<String>, endingBalance: Option<String>, holdings: Vec<{ symbol, action: "update"|"add"|"remove"|"leave", holdingId: Option<i64>, shares: Option<String>, price: Option<String>, costBasis: Option<String>, name: Option<String> }>, finishWithoutHoldings: bool, ignoreUnread: bool, saveLayout: Option<{ name, phrases: Vec<String> }>`.

- [ ] **Step 1: Write the failing tests** — `src-tauri/src/commands/statements/tests.rs` (follows `commands/import/tests.rs`: a real profile in a temp folder; commands are exercised through their `*_for` functions):

```rust
use super::*;
use budget_core::models::AccountType;
use budget_core::statement::fixture_pdf::{build_pdf, fixture};

fn profile(name: &str) -> (AppState, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("vaultspend-statement-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    (AppState::open(dir.join("profile.db")).unwrap(), dir)
}

fn write_fixture(dir: &std::path::Path, name: &str) -> (String, String, String) {
    let (pages, (start, end)) = fixture(name).unwrap();
    let path = dir.join(format!("{name}.pdf"));
    std::fs::write(&path, build_pdf(&pages)).unwrap();
    (path.to_string_lossy().into_owned(), start.to_string(), end.to_string())
}

fn read(state: &mut AppState, sessions: &Sessions, path: &str, account: i64, start: &str, end: &str) -> Result<StatementReadDto, String> {
    read_statement_for(state, sessions, 1, ReadStatementArgs { path: path.into(), account_id: account, period_start: start.into(), period_end: end.into() })
}

#[test]
fn a_card_statement_is_read_matched_and_finished_and_the_bank_is_learned() {
    let (mut state, dir) = profile("card");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    // Two of the six charges are already in the app, in the app's sign.
    state.store.save_transactions(card, &[
        budget_core::models::Transaction { date: "2026-07-24".parse().unwrap(), description: "Streaming".into(), amount: "-7.40".parse().unwrap(), category: None },
        budget_core::models::Transaction { date: "2026-08-05".parse().unwrap(), description: "Autopay".into(), amount: "43.08".parse().unwrap(), category: None },
    ]).unwrap();
    let (path, start, end) = write_fixture(&dir, "card-a");

    let read = read(&mut state, &sessions, &path, card, &start, &end).unwrap();
    let review = read.review.expect("one section, so the review comes straight back");
    assert_eq!(review.activity_check.outcome, "passed");
    assert!(!review.recognized && review.learnable);
    let matched: Vec<_> = review.rows.iter().filter(|r| r.status == "matched").collect();
    assert_eq!(matched.len(), 2);
    let missing: Vec<_> = review.rows.iter().filter(|r| r.status == "missing").collect();
    assert_eq!(missing.len(), 4);

    let decisions = FinishDecisionsDto {
        matches: matched.iter().map(|r| MatchDecision { row: r.index, transaction_id: r.match_id.unwrap() }).collect(),
        add: missing.iter().map(|r| AddDecision { row: r.index, date: r.date.clone(), description: r.description.clone(), amount: r.amount.clone() }).collect(),
        skip: vec![],
        starting_balance: Some("43.08".into()),
        ending_balance: Some("52.36".into()),
        holdings: vec![],
        finish_without_holdings: false,
        ignore_unread: false,
        save_layout: Some(SaveLayoutDecision { name: "Northwind".into(), phrases: vec!["Northwind Card Services".into()] }),
    };
    let done = finish_statement_reconciliation_for(&mut state, &sessions, 1, &review.token, decisions).unwrap();
    assert_eq!(done.added, 4);
    assert_eq!(done.layout_saved.as_deref(), Some("Northwind"));
    assert_eq!(state.store.list_statement_layouts().unwrap().len(), 1);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn read_statement_with_the_wrong_period_says_no_transactions_were_found() {
    let (mut state, dir) = profile("wrong-period");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    let (path, _, _) = write_fixture(&dir, "card-a");
    // Every row falls outside these dates. The review says so (the screen shows "No transactions were
    // found between …") instead of refusing outright, because an unknown bank whose dates were misread
    // looks exactly the same and needs the Teach option.
    let review = read(&mut state, &sessions, &path, card, "2026-05-01", "2026-05-31").unwrap().review.unwrap();
    assert!(review.nothing_in_period);
    assert!(review.rows.is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_already_reconciled_period_is_flagged() {
    let (mut state, dir) = profile("already");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    state.store.finish_reconciliation(&budget_core::store::FinishReconciliation {
        account_id: card, period_start: None, statement_date: "2026-08-31".parse().unwrap(),
        statement_start: Some("0".parse().unwrap()), statement_end: "0".parse().unwrap(), source: budget_core::store::ReconcileSource::Manual,
    }, chrono::Local::now().naive_local()).unwrap();
    let (path, start, end) = write_fixture(&dir, "card-a");
    let review = read(&mut state, &sessions, &path, card, &start, &end).unwrap().review.unwrap();
    assert_eq!(review.already_reconciled_through.as_deref(), Some("2026-08-31"));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn several_sections_are_offered_for_choosing_first() {
    let (mut state, dir) = profile("sections");
    let sessions = Sessions::default();
    let checking = state.store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let (path, start, end) = write_fixture(&dir, "credit-union");
    let read = read(&mut state, &sessions, &path, checking, &start, &end).unwrap();
    assert!(read.review.is_none());
    assert_eq!(read.sections.len(), 2);
    let review = review_statement_for(&mut state, &sessions, 1, &read.token, 1, false).unwrap();
    assert_eq!(review.rows.len(), 5);
    assert_eq!(review.activity_check.outcome, "passed");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_stale_token_or_another_profile_generation_is_refused() {
    let (mut state, dir) = profile("stale");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    let (path, start, end) = write_fixture(&dir, "card-a");
    let token = read(&mut state, &sessions, &path, card, &start, &end).unwrap().token;
    assert_eq!(review_statement_for(&mut state, &sessions, 2, &token, 0, false).err().unwrap(), STALE);
    assert_eq!(review_statement_for(&mut state, &sessions, 1, "not-the-token", 0, false).err().unwrap(), STALE);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_change_to_the_account_while_reviewing_refuses_the_finish() {
    let (mut state, dir) = profile("changed");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    let (path, start, end) = write_fixture(&dir, "card-a");
    let review = read(&mut state, &sessions, &path, card, &start, &end).unwrap().review.unwrap();
    state.store.save_transactions(card, &[budget_core::models::Transaction { date: "2026-08-10".parse().unwrap(), description: "New".into(), amount: "-1.00".parse().unwrap(), category: None }]).unwrap();
    let err = finish_statement_reconciliation_for(&mut state, &sessions, 1, &review.token, FinishDecisionsDto::default()).err().unwrap();
    assert_eq!(err, STALE);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn every_row_needs_exactly_one_decision() {
    let (mut state, dir) = profile("decisions");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    let (path, start, end) = write_fixture(&dir, "card-a");
    let review = read(&mut state, &sessions, &path, card, &start, &end).unwrap().review.unwrap();
    let err = finish_statement_reconciliation_for(&mut state, &sessions, 1, &review.token, FinishDecisionsDto { skip: vec![0], ..Default::default() }).err().unwrap();
    assert_eq!(err, "Choose what to do with every line on your statement first.");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn teaching_an_unknown_bank_then_recognising_it_next_month() {
    let (mut state, dir) = profile("teach");
    let sessions = Sessions::default();
    let checking = state.store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let (path, start, end) = write_fixture(&dir, "unknown-bank");
    let first = read(&mut state, &sessions, &path, checking, &start, &end).unwrap().review.unwrap();
    assert_ne!(first.activity_check.outcome, "passed");
    assert!(first.nothing_in_period, "day-first dates read month-first fall outside the period");
    let lines = statement_lines_for(&sessions, 1, &first.token).unwrap();
    let find = |prefix: &str, word: &str| {
        let l = lines.iter().find(|l| l.text.starts_with(prefix)).unwrap();
        budget_core::statement::learn::TextRef { line: l.index, start: l.text[..l.text.find(word).unwrap()].chars().count() }
    };
    let marks = budget_core::statement::learn::TeachMarks {
        rows: vec![budget_core::statement::learn::RowMark { date: find("03/08", "03/08/2026"), amount: find("03/08", "54.20") }],
        balances: Some(budget_core::statement::learn::BalanceMark::StartEnd { start: find("Opening", "1,250.00"), end: find("Closing", "3,132.00") }),
        holdings: vec![],
    };
    let taught = teach_statement_layout_for(&mut state, &sessions, 1, &first.token, marks).unwrap();
    assert_eq!(taught.activity_check.outcome, "passed");
    assert!(taught.learnable);
    let add: Vec<AddDecision> = taught.rows.iter().map(|r| AddDecision { row: r.index, date: r.date.clone(), description: r.description.clone(), amount: r.amount.clone() }).collect();
    finish_statement_reconciliation_for(&mut state, &sessions, 1, &taught.token, FinishDecisionsDto {
        add, starting_balance: Some("1250.00".into()), ending_balance: Some("3132.00".into()),
        save_layout: Some(SaveLayoutDecision { name: "Riverbend".into(), phrases: taught.suggested_phrases.clone() }),
        ..Default::default()
    }).unwrap();

    let (path, start, end) = write_fixture(&dir, "unknown-bank-next");
    let next = read(&mut state, &sessions, &path, checking, &start, &end).unwrap().review.unwrap();
    assert!(next.recognized);
    assert_eq!(next.layout_name.as_deref(), Some("Riverbend"));
    assert_eq!(next.activity_check.outcome, "passed");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_download_file_is_reviewed_without_learning() {
    let (mut state, dir) = profile("download");
    let sessions = Sessions::default();
    let checking = state.store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let csv = dir.join("aug.csv");
    std::fs::write(&csv, "Date,Description,Amount\n2026-08-03,Coffee,-4.50\n2026-07-01,Old,-1.00\n").unwrap();
    let review = read(&mut state, &sessions, &csv.to_string_lossy(), checking, "2026-08-01", "2026-08-31").unwrap().review.unwrap();
    assert_eq!((review.source.as_str(), review.rows.len(), review.learnable), ("download", 1, false));
    assert_eq!(review.activity_check.outcome, "not_available");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_unknown_brokerage_compares_share_counts_once_holdings_are_taught() {
    let (mut state, dir) = profile("brokerage");
    let sessions = Sessions::default();
    let account = state.store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    state.store.create_holding(account, "QQQZ", "Tracker", "10".parse().unwrap(), "300".parse().unwrap(), "2500".parse().unwrap(), None).unwrap();
    let (path, start, end) = write_fixture(&dir, "unknown-brokerage");
    let first = read(&mut state, &sessions, &path, account, &start, &end).unwrap().review.unwrap();
    assert_eq!((first.activity_check.outcome.as_str(), first.holdings_check.outcome.as_str()), ("passed", "failed"));
    let lines = statement_lines_for(&sessions, 1, &first.token).unwrap();
    let at = |prefix: &str, word: &str| {
        let l = lines.iter().find(|l| l.text.starts_with(prefix)).unwrap();
        budget_core::statement::learn::TextRef { line: l.index, start: l.text[..l.text.find(word).unwrap()].chars().count() }
    };
    let taught = teach_statement_layout_for(&mut state, &sessions, 1, &first.token, budget_core::statement::learn::TeachMarks {
        rows: vec![],
        balances: None,
        holdings: vec![budget_core::statement::learn::HoldingMark {
            symbol: at("QQQZ", "QQQZ"), quantity: at("10.5000", "10.5000"), price: Some(at("10.5000", "$300.25")),
            market_value: at("10.5000", "$3,152.63"), total: at("Total Market Value", "$4,153.03"),
        }],
    }).unwrap();
    assert_eq!(taught.holdings_check.outcome, "passed");
    let statuses: Vec<(&str, &str)> = taught.holdings.iter().map(|h| (h.symbol.as_str(), h.status)).collect();
    assert_eq!(statuses, vec![("QQQZ", "different"), ("VTIZ", "missing_in_app")]);
    let _ = std::fs::remove_dir_all(dir);
}
```

(`FinishDecisionsDto` derives `Default`; `HoldingReviewDto.status` is a `&'static str`.)

- [ ] **Step 2: Run to verify failure** — `cargo test -p vaultspend --lib commands::statements` (use the `src-tauri` package name from `src-tauri/Cargo.toml` if it differs) → compile error.

- [ ] **Step 3: Implement the session store** — `src-tauri/src/statement_review.rs`:

```rust
//! The one statement review in progress. In memory only, bound to the profile generation, the account's
//! review signature and a 10-minute lifetime. A profile switch, lock, expiry or change to the account
//! ends it with one plain message.

use budget_core::statement::layout::StatementLayout;
use budget_core::statement::matching::AccountKind;
use budget_core::statement::select::LayoutOrigin;
use budget_core::statement::{Period, StatementLine, StatementRow};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const LIFETIME: Duration = Duration::from_secs(600);
pub const STALE: &str = "Your data changed while you were reviewing. Please read the statement again.";

pub enum Source {
    Pdf,
    /// A CSV/OFX/QFX/QIF download; `flip` is the account's remembered import direction.
    Download { flip: bool },
}

pub struct Session {
    pub token: String,
    pub generation: u64,
    pub created: Instant,
    pub signature: String,
    pub account_id: i64,
    pub kind: AccountKind,
    pub period: Period,
    pub source: Source,
    pub lines: Vec<StatementLine>,
    pub download_rows: Vec<StatementRow>,
    pub download_dropped: usize,
    pub layout: Option<StatementLayout>,
    pub origin: Option<LayoutOrigin>,
    pub recognized: bool,
    pub recognized_but_failed: bool,
    pub taught: bool,
    pub section: usize,
    pub flip: bool,
}

#[derive(Default)]
pub struct Sessions(pub Mutex<Option<Session>>);

impl Sessions {
    pub fn replace(&self, session: Session) -> Result<(), String> {
        *self.0.lock().map_err(|_| "Could not open the statement review.")? = Some(session);
        Ok(())
    }

    pub fn with<T>(&self, token: &str, generation: u64, f: impl FnOnce(&mut Session) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.0.lock().map_err(|_| "Could not open the statement review.")?;
        let valid = guard.as_ref().is_some_and(|s| s.token == token && s.generation == generation && s.created.elapsed() < LIFETIME);
        if !valid {
            *guard = None;
            return Err(STALE.to_string());
        }
        f(guard.as_mut().expect("checked above"))
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = None;
        }
    }
}
```

- [ ] **Step 4: Implement the commands** — `src-tauri/src/commands/statements.rs`. Each `#[tauri::command]` locks the profile, checks `paths.current_generation() == generation` (else the "profile changed" message), then calls its `*_for` function, which the tests use directly.

```rust
//! Commands: reconciling an account by uploading its statement (PDF or a bank download), teaching the
//! app a statement it couldn't read, and managing the statements it has learned. See
//! docs/STATEMENT-RECONCILE.md.

use super::*;
pub use crate::statement_review::{Sessions, STALE};
use crate::statement_review::{Session, Source};
use budget_core::import_resolution::{is_sure, Suggestion};
use budget_core::statement::checks::{check_section, CheckOutcome};
use budget_core::statement::layout::{built_in_layouts, StatementLayout};
use budget_core::statement::learn::{self, TeachMarks};
use budget_core::statement::matching::{match_items, suggest_flip, to_app_amount, AccountKind, AppItem, StatementItem};
use budget_core::statement::pdf_text::{read_pdf_lines, MAX_STATEMENT_BYTES};
use budget_core::statement::select::{choose, read_with, LayoutOrigin};
use budget_core::statement::{Period, StatementRow, StatementSection};
use budget_core::store::{HoldingChange, ReconcileSource, StatementFinish};
use std::io::Read;

#[cfg(test)]
mod tests;

const PROFILE_CHANGED: &str = "The profile changed. Close this statement and start again in the current profile.";

fn ensure_generation(paths: &crate::config::AppPaths, generation: u64) -> Result<(), String> {
    if paths.current_generation() == generation { Ok(()) } else { Err(PROFILE_CHANGED.into()) }
}

// ---------- DTOs ----------

#[derive(Serialize)]
pub struct SectionChoiceDto { pub index: usize, pub name: String, pub row_count: usize, pub holding_count: usize }

#[derive(Serialize)]
pub struct StatementReadDto { pub token: String, pub sections: Vec<SectionChoiceDto>, pub review: Option<StatementReviewDto> }

#[derive(Serialize, Debug)]
pub struct CheckDto { pub outcome: String, pub expected: Option<String>, pub found: Option<String> }

impl From<&CheckOutcome> for CheckDto {
    fn from(c: &CheckOutcome) -> Self {
        match c {
            CheckOutcome::Passed => CheckDto { outcome: "passed".into(), expected: None, found: None },
            CheckOutcome::Failed { expected, found } => CheckDto { outcome: "failed".into(), expected: Some(expected.to_string()), found: Some(found.to_string()) },
            CheckOutcome::NotAvailable => CheckDto { outcome: "not_available".into(), expected: None, found: None },
        }
    }
}

#[derive(Serialize, Debug)]
pub struct ReviewRowDto { pub index: usize, pub date: String, pub description: String, pub amount: String, pub status: &'static str, pub match_id: Option<i64>, pub possible_ids: Vec<i64> }
#[derive(Serialize, Debug)]
pub struct AppTxDto { pub id: i64, pub date: String, pub description: String, pub amount: String, pub change: String }
#[derive(Serialize, Debug)]
pub struct UnreadDto { pub line: usize, pub text: String }
#[derive(Serialize, Debug)]
pub struct HoldingReviewDto { pub symbol: String, pub name: String, pub statement_shares: String, pub price: Option<String>, pub market_value: String, pub app_holding_id: Option<i64>, pub app_shares: Option<String>, pub status: &'static str }
#[derive(Serialize, Debug)]
pub struct AppHoldingDto { pub id: i64, pub symbol: String, pub name: String, pub shares: String }

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

#[derive(Serialize)]
pub struct StatementLineDto { pub index: usize, pub page: usize, pub text: String }

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MatchDecision { pub row: usize, pub transaction_id: i64 }
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AddDecision { pub row: usize, pub date: String, pub description: String, pub amount: String }
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HoldingDecision { pub symbol: String, pub action: String, pub holding_id: Option<i64>, pub shares: Option<String>, pub price: Option<String>, pub cost_basis: Option<String>, pub name: Option<String> }
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveLayoutDecision { pub name: String, pub phrases: Vec<String> }
#[derive(Deserialize, Default)]
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

#[derive(Serialize)]
pub struct StatementFinishedDto { pub reconciliation_id: i64, pub added: usize, pub layout_saved: Option<String> }

#[derive(Serialize)]
pub struct StatementLayoutDto { pub id: i64, pub name: String, pub phrases: Vec<String>, pub updated_at: String }

pub struct ReadStatementArgs { pub path: String, pub account_id: i64, pub period_start: String, pub period_end: String }

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

fn to_app(session: &Session, printed: Decimal) -> Decimal {
    match (&session.source, &session.layout) {
        (Source::Pdf, Some(layout)) => to_app_amount(printed, session.kind, &layout.signs, session.flip),
        (Source::Download { flip }, _) => if *flip != session.flip { -printed } else { printed },
        (Source::Pdf, None) => printed,
    }
}

pub fn read_statement_for(state: &mut AppState, sessions: &Sessions, generation: u64, args: ReadStatementArgs) -> Result<StatementReadDto, String> {
    let period = Period::new(parse_date(&args.period_start)?, parse_date(&args.period_end)?)?;
    let kind = state.store.account_kind(args.account_id).map_err(|e| e.to_string())?;
    let file = std::path::Path::new(&args.path);
    let extension = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !file.is_file() {
        return Err("Choose one statement file, not a folder.".into());
    }
    if std::fs::metadata(file).map(|m| m.len() as usize > MAX_STATEMENT_BYTES).unwrap_or(false) {
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
                .map_err(|_| "Could not open this statement. Check its location and access.")?
                .take(MAX_STATEMENT_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "Could not open this statement. Check its location and access.")?;
            session.lines = read_pdf_lines(bytes).map_err(|e| e.to_string())?;
            let learned: Vec<(i64, StatementLayout)> =
                state.store.list_statement_layouts().map_err(|e| e.to_string())?.into_iter().map(|l| (l.id, l.layout)).collect();
            let reading = choose(&session.lines, &period, &learned, &built_in_layouts(), kind == AccountKind::Investment);
            session.recognized = reading.recognized;
            session.recognized_but_failed = reading.recognized_but_failed;
            session.origin = Some(reading.origin);
            session.layout = Some(reading.layout);
        }
        "csv" | "ofx" | "qfx" | "qif" => {
            let loaded = budget_core::importer::load_transactions(file, false).map_err(|e| e.to_string())?;
            let today = chrono::Local::now().date_naive();
            let flip = state.store.list_accounts(today).map_err(|e| e.to_string())?
                .into_iter().find(|a| a.id == args.account_id).and_then(|a| a.import_flip_signs).unwrap_or(false);
            session.source = Source::Download { flip };
            for (i, t) in loaded.transactions.iter().enumerate() {
                if period.contains_with_leeway(t.date) {
                    session.download_rows.push(StatementRow { line: i, date: t.date, description: t.description.clone(), amount: t.amount, running_balance: None });
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
        .map(|(index, s)| SectionChoiceDto { index, name: s.name.clone(), row_count: s.rows.len(), holding_count: s.holdings.len() })
        .collect();
    let token = session.token.clone();
    let review = if sections.len() == 1 { Some(build_review(state, &session)?) } else { None };
    sessions.replace(session)?;
    Ok(StatementReadDto { token, sections: choices, review })
}

fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "Could not start a safe statement review.")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn build_review(state: &AppState, session: &Session) -> Result<StatementReviewDto, String> {
    let sections = sections_of(session);
    let section = sections.get(session.section).ok_or("That part of the statement doesn't exist. Read the statement again.")?;
    let checks = match session.source { Source::Pdf => check_section(section), Source::Download { .. } => check_section(&StatementSection::default()) };
    let period = &session.period;

    let items: Vec<StatementItem> = section.rows.iter().enumerate()
        .map(|(index, r)| StatementItem { index, date: r.date, description: r.description.clone(), amount: to_app(session, r.amount) })
        .collect();
    let candidates = state.store.statement_candidates(session.account_id, period).map_err(|e| e.to_string())?;
    let app_items: Vec<AppItem> = candidates.iter().map(|c| AppItem { id: c.id, date: c.date, description: c.description.clone(), amount: c.amount }).collect();
    let matched = match_items(&items, &app_items, period);

    let rows = items.iter().map(|item| {
        let m = matched.matched.iter().find(|(i, _)| *i == item.index).map(|(_, id)| *id);
        let p = matched.possible.iter().find(|(i, _)| *i == item.index).map(|(_, ids)| ids.clone()).unwrap_or_default();
        ReviewRowDto {
            index: item.index,
            date: item.date.to_string(),
            description: item.description.clone(),
            amount: item.amount.to_string(),
            status: if m.is_some() { "matched" } else if !p.is_empty() { "possible" } else { "missing" },
            match_id: m,
            possible_ids: p,
        }
    }).collect();

    let today = chrono::Local::now().date_naive();
    let (holdings, app_only_holdings) = if session.kind == AccountKind::Investment {
        let app: Vec<_> = state.store.list_holdings(today).map_err(|e| e.to_string())?.into_iter().filter(|h| h.account_id == session.account_id).collect();
        let key = |s: &str| s.trim().to_uppercase();
        let reviewed = section.holdings.iter().map(|h| {
            let mine = app.iter().find(|a| key(&a.symbol) == key(&h.symbol));
            HoldingReviewDto {
                symbol: h.symbol.clone(),
                name: h.name.clone(),
                statement_shares: h.shares.normalize().to_string(),
                price: h.price.map(|p| p.to_string()),
                market_value: h.market_value.to_string(),
                app_holding_id: mine.map(|a| a.id),
                app_shares: mine.map(|a| a.shares.normalize().to_string()),
                status: match mine { Some(a) if a.shares == h.shares => "same", Some(_) => "different", None => "missing_in_app" },
            }
        }).collect();
        let only = app.iter().filter(|a| !section.holdings.iter().any(|h| key(&h.symbol) == key(&a.symbol)))
            .map(|a| AppHoldingDto { id: a.id, symbol: a.symbol.clone(), name: a.name.clone(), shares: a.shares.normalize().to_string() }).collect();
        (reviewed, only)
    } else {
        (vec![], vec![])
    };

    let last = state.store.last_reconciliation(session.account_id).map_err(|e| e.to_string())?;
    let avoid: Vec<String> = state.store.list_accounts(today).map_err(|e| e.to_string())?.into_iter().map(|a| a.account.name)
        .chain(state.store.list_family_members().map_err(|e| e.to_string())?.into_iter().map(|m| m.name))
        .collect();
    let (suggested_name, suggested_phrases) = learn::suggest_name_and_phrases(&session.lines, &avoid);
    let no_failures = !matches!(checks.activity, CheckOutcome::Failed { .. }) && !matches!(checks.holdings, CheckOutcome::Failed { .. });
    let learnable = matches!(session.source, Source::Pdf) && !session.recognized && (session.taught || no_failures);
    let layout_name = match (&session.origin, &session.layout) {
        (Some(LayoutOrigin::Learned { .. }) | Some(LayoutOrigin::BuiltIn { .. }), Some(l)) if session.recognized => Some(l.name.clone()),
        _ => None,
    };

    Ok(StatementReviewDto {
        token: session.token.clone(),
        account_kind: session.kind,
        source: match session.source { Source::Pdf => "pdf", Source::Download { .. } => "download" }.into(),
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
        previous_ending_balance: last.map(|(_, b)| b.to_string()),
        already_reconciled_through: last.filter(|(date, _)| period.end <= *date).map(|(date, _)| date.to_string()),
        nothing_in_period: section.rows.is_empty() && section.dropped_out_of_period > 0,
        activity_check: (&checks.activity).into(),
        holdings_check: (&checks.holdings).into(),
        running_balance_breaks: checks.running_balance_breaks.len(),
        rows,
        app_transactions: candidates.iter().map(|c| AppTxDto { id: c.id, date: c.date.to_string(), description: c.description.clone(), amount: c.amount.to_string(), change: c.change.to_string() }).collect(),
        not_on_statement: matched.not_on_statement,
        unread: section.unread.iter().map(|u| UnreadDto { line: u.line, text: u.text.clone() }).collect(),
        suggest_flip: !session.flip && suggest_flip(&items, &app_items, period),
        flipped: session.flip,
        holdings,
        app_only_holdings,
        suggested_name,
        suggested_phrases,
    })
}

pub fn review_statement_for(state: &mut AppState, sessions: &Sessions, generation: u64, token: &str, section_index: usize, flip: bool) -> Result<StatementReviewDto, String> {
    sessions.with(token, generation, |session| {
        if sections_of(session).len() <= section_index {
            return Err("That part of the statement doesn't exist. Read the statement again.".into());
        }
        session.section = section_index;
        session.flip = flip;
        build_review(state, session)
    })
}

pub fn statement_lines_for(sessions: &Sessions, generation: u64, token: &str) -> Result<Vec<StatementLineDto>, String> {
    sessions.with(token, generation, |session| {
        Ok(session.lines.iter().enumerate().map(|(index, l)| StatementLineDto { index, page: l.page, text: l.text.clone() }).collect())
    })
}

pub fn teach_statement_layout_for(state: &mut AppState, sessions: &Sessions, generation: u64, token: &str, marks: TeachMarks) -> Result<StatementReviewDto, String> {
    sessions.with(token, generation, |session| {
        if !matches!(session.source, Source::Pdf) {
            return Err("Only a PDF statement can be taught.".into());
        }
        let base = session.layout.clone().ok_or(STALE)?;
        let taught = learn::from_marks(&base, &session.lines, &marks, &session.period).map_err(|e| e.to_string())?;
        session.layout = Some(taught);
        session.taught = true;
        session.recognized = false;
        build_review(state, session)
    })
}

fn categorize(state: &AppState, description: &str) -> Result<Option<String>, String> {
    let (history, classifier) = build_classifier(state)?;
    Ok(budget_core::categorizer::categorize(description, &state.rules, &history, Some(&classifier))
        .map(|(category, source, confidence)| Suggestion { category, source, confidence })
        .filter(is_sure)
        .map(|s| s.category))
}

pub fn finish_statement_reconciliation_for(state: &mut AppState, sessions: &Sessions, generation: u64, token: &str, d: FinishDecisionsDto) -> Result<StatementFinishedDto, String> {
    let result = sessions.with(token, generation, |session| {
        if state.store.reconcile_signature(session.account_id).map_err(|e| e.to_string())? != session.signature {
            return Err(STALE.into());
        }
        let sections = sections_of(session);
        let section = sections.get(session.section).ok_or(STALE)?;
        let checks = check_section(section);

        // Every statement row: exactly one of matched, added or skipped.
        let mut seen = vec![0usize; section.rows.len()];
        for i in d.matches.iter().map(|m| m.row).chain(d.add.iter().map(|a| a.row)).chain(d.skip.iter().copied()) {
            *seen.get_mut(i).ok_or("Choose what to do with every line on your statement first.")? += 1;
        }
        if seen.iter().any(|n| *n != 1) {
            return Err("Choose what to do with every line on your statement first.".into());
        }

        let mut add = Vec::with_capacity(d.add.len());
        for a in &d.add {
            let description = a.description.trim();
            if description.is_empty() {
                return Err("Every transaction you add needs a description.".into());
            }
            add.push(budget_core::models::Transaction {
                date: parse_date(&a.date)?,
                description: description.to_string(),
                amount: parse_amount(&a.amount)?,
                category: categorize(state, description)?,
            });
        }

        let investment = session.kind == AccountKind::Investment;
        let mut holdings = Vec::new();
        for h in &d.holdings {
            let shares = h.shares.as_deref().map(parse_amount).transpose()?;
            match h.action.as_str() {
                "update" => holdings.push(HoldingChange::SetShares { holding_id: h.holding_id.ok_or(STALE)?, shares: shares.ok_or("Enter the share count.")? }),
                "add" => holdings.push(HoldingChange::Add {
                    symbol: h.symbol.clone(),
                    name: h.name.clone().unwrap_or_else(|| h.symbol.clone()),
                    shares: shares.ok_or("Enter the share count.")?,
                    price: h.price.as_deref().map(parse_amount).transpose()?.unwrap_or_default(),
                    cost_basis: h.cost_basis.as_deref().filter(|c| !c.trim().is_empty()).map(parse_amount).transpose()?
                        .ok_or("Enter what you paid for each holding you add.")?,
                }),
                "remove" => holdings.push(HoldingChange::Remove { holding_id: h.holding_id.ok_or(STALE)? }),
                "leave" => {}
                _ => return Err("Choose what to do with each holding.".into()),
            }
        }
        let holdings_readable = checks.holdings == CheckOutcome::Passed;
        if d.finish_without_holdings && holdings_readable {
            return Err("Your holdings were read correctly, so check their share counts before finishing.".into());
        }
        let statement_shares = (investment && !d.finish_without_holdings)
            .then(|| section.holdings.iter().map(|h| (h.symbol.clone(), h.shares)).collect());

        let layout = match (&d.save_layout, &session.layout) {
            (Some(save), Some(layout)) => {
                let no_failures = !matches!(checks.activity, CheckOutcome::Failed { .. }) && !matches!(checks.holdings, CheckOutcome::Failed { .. });
                let learnable = matches!(session.source, Source::Pdf) && !session.recognized && (session.taught || no_failures) && (section.unread.is_empty() || d.ignore_unread);
                if !learnable {
                    return Err("This statement can't be remembered yet — some of it still couldn't be read.".into());
                }
                let mut l = if session.taught { layout.clone() } else { learn::narrow(layout, &session.lines, &sections, &session.period) };
                l.recognize = save.phrases.iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
                if l.recognize.is_empty() {
                    return Err("Choose at least one phrase from your statement so the app can recognise it.".into());
                }
                if !holdings_readable {
                    l.holdings = None;
                }
                let existing = match &session.origin { Some(LayoutOrigin::Learned { id }) => Some(*id), _ => None };
                Some((existing, save.name.clone(), l))
            }
            _ => None,
        };

        let finish = StatementFinish {
            account_id: session.account_id,
            period: session.period,
            statement_start: d.starting_balance.as_deref().filter(|s| !s.trim().is_empty()).map(parse_amount).transpose()?,
            statement_end: d.ending_balance.as_deref().filter(|s| !s.trim().is_empty()).map(parse_amount).transpose()?,
            ending_value: section.ending_value,
            source: match session.source { Source::Pdf => ReconcileSource::StatementPdf, Source::Download { .. } => ReconcileSource::StatementDownload },
            matched: d.matches.iter().map(|m| m.transaction_id).collect(),
            add,
            holdings,
            statement_shares,
            layout: layout.clone(),
        };
        let done = state.store.finish_statement_reconciliation(&finish, chrono::Local::now().naive_local()).map_err(|e| e.to_string())?;
        Ok(StatementFinishedDto { reconciliation_id: done.reconciliation_id, added: done.added, layout_saved: layout.map(|(_, name, _)| name.trim().to_string()) })
    });
    if result.is_ok() {
        sessions.clear();
    }
    result
}

// ---------- Tauri wrappers ----------

#[tauri::command]
pub fn read_statement(path: String, account_id: i64, period_start: String, period_end: String, generation: u64,
    state: tauri::State<AppStateHandle>, paths: tauri::State<crate::config::AppPaths>, sessions: tauri::State<Sessions>) -> Result<StatementReadDto, String> {
    let mut state = state.lock()?;
    ensure_generation(&paths, generation)?;
    read_statement_for(&mut state, &sessions, generation, ReadStatementArgs { path, account_id, period_start, period_end })
}

#[tauri::command]
pub fn review_statement(token: String, section_index: usize, flip: bool, generation: u64,
    state: tauri::State<AppStateHandle>, paths: tauri::State<crate::config::AppPaths>, sessions: tauri::State<Sessions>) -> Result<StatementReviewDto, String> {
    let mut state = state.lock()?;
    ensure_generation(&paths, generation)?;
    review_statement_for(&mut state, &sessions, generation, &token, section_index, flip)
}

#[tauri::command]
pub fn statement_lines(token: String, generation: u64, state: tauri::State<AppStateHandle>, paths: tauri::State<crate::config::AppPaths>, sessions: tauri::State<Sessions>) -> Result<Vec<StatementLineDto>, String> {
    let _state = state.lock()?;
    ensure_generation(&paths, generation)?;
    statement_lines_for(&sessions, generation, &token)
}

#[tauri::command]
pub fn teach_statement_layout(token: String, marks: TeachMarks, generation: u64,
    state: tauri::State<AppStateHandle>, paths: tauri::State<crate::config::AppPaths>, sessions: tauri::State<Sessions>) -> Result<StatementReviewDto, String> {
    let mut state = state.lock()?;
    ensure_generation(&paths, generation)?;
    teach_statement_layout_for(&mut state, &sessions, generation, &token, marks)
}

#[tauri::command]
pub fn finish_statement_reconciliation(token: String, decisions: FinishDecisionsDto, generation: u64,
    state: tauri::State<AppStateHandle>, paths: tauri::State<crate::config::AppPaths>, sessions: tauri::State<Sessions>) -> Result<StatementFinishedDto, String> {
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
    Ok(state.store.list_statement_layouts().map_err(|e| e.to_string())?.into_iter()
        .map(|l| StatementLayoutDto { id: l.id, name: l.name, phrases: l.layout.recognize, updated_at: l.updated_at }).collect())
}

#[tauri::command]
pub fn rename_statement_layout(id: i64, name: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.rename_statement_layout(id, &name, chrono::Local::now().naive_local()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_statement_layout(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.delete_statement_layout(id).map_err(|e| e.to_string())
}
```

Notes for the implementer:
- `StatementSection` and `StatementRow` need `Clone` (they derive it in Task 4).
- `CheckOutcome` must derive `PartialEq` (it does) for `checks.holdings == CheckOutcome::Passed`.
- If `list_family_members` has a different name, use the store's household-member listing used by `commands/accounts.rs`.
- `AccountKind` must derive `Serialize` with `rename_all = "snake_case"` (Task 2 does).
- Holding the session's lines in memory for the review is necessary for teaching; it never touches disk and ends on finish, cancel, expiry, profile change or the next upload.

Register in `src-tauri/src/lib.rs` `invoke_handler`: `commands::read_statement, commands::review_statement, commands::statement_lines, commands::teach_statement_layout, commands::finish_statement_reconciliation, commands::cancel_statement_review, commands::list_statement_layouts, commands::rename_statement_layout, commands::delete_statement_layout,` and `.manage(statement_review::Sessions::default())`.

- [ ] **Step 5: Run to verify pass** (PowerShell): `cargo test --workspace` → PASS; `cargo clippy --workspace --all-targets -- -D warnings` → clean; `cargo fmt --all -- --check` → clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/statement_review.rs src-tauri/src/commands/statements.rs src-tauri/src/commands/statements src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "Add statement upload, teaching and finishing commands"
```

---

## Phase D — The screens

### Task 20: Statement contracts, exact on-screen arithmetic and the owner hook

**Files:**
- Create: `src/statementContracts.ts`, `src/statementContracts.test.ts`, `src/reconcileMath.ts`, `src/reconcileMath.test.ts`, `src/useStatementReconcile.ts`, `src/useStatementReconcile.test.tsx`

**Interfaces:**
- Consumes: the Task 19 command names and DTO shapes; `contractChecks`; `getCurrentGeneration` from `./profileUiState`; `open` from `./nativeDialog`.
- Produces:
  - `statementContracts.ts`: types `AccountKind`, `CheckResult`, `ReviewRow`, `AppTransaction`, `HoldingReview`, `AppOnlyHolding`, `StatementReview`, `StatementRead`, `StatementLineText`, `StatementFinished`, `StatementLayoutSummary`, `TextRef`, `TeachMarks`, `FinishDecisions`; validators `validateStatementRead(v): StatementRead`, `validateStatementReview(v): StatementReview`, `validateStatementLines(v): StatementLineText[]`, `validateStatementFinished(v): StatementFinished`, `validateStatementLayouts(v): StatementLayoutSummary[]` (each throws `Error("The app received an unexpected statement response. Read the statement again.")`).
  - `reconcileMath.ts`: `toUnits(s: string): bigint`, `fromUnits(u: bigint): string`, `addAmounts(values: string[]): string`, `changeFor(kind: AccountKind, amount: string): string`, `statementDifference(end: string, start: string, changes: string[]): string`, `isZero(s: string): boolean`.
  - `useStatementReconcile(accountId: number)`: returns `{ phase, error, busy, start(periodStart, periodEnd, kind?: "pdf" | "download"), chooseSection(index), setFlip(flip), openTeach(), teach(marks), finish(decisions), cancel() }` where `phase` is `{ kind: "idle" } | { kind: "choose_section"; read: StatementRead } | { kind: "review"; review: StatementReview } | { kind: "teach"; review: StatementReview; lines: StatementLineText[]; attempts: number } | { kind: "done"; finished: StatementFinished }`.

- [ ] **Step 1: Write the failing tests**

`src/reconcileMath.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addAmounts, changeFor, fromUnits, isZero, statementDifference, toUnits } from "./reconcileMath";

describe("reconcile arithmetic", () => {
  it("adds money exactly, without floating-point drift", () => {
    expect(addAmounts(["0.10", "0.20"])).toBe("0.30");
    expect(addAmounts(["-43.08", "52.36", "7.40"])).toBe("16.68");
    expect(fromUnits(toUnits("-0.5"))).toBe("-0.50");
  });
  it("computes the statement difference the same way the app does", () => {
    expect(statementDifference("1150.00", "1000.00", ["200.00", "-50.00"])).toBe("0.00");
    expect(isZero(statementDifference("80.00", "300.00", [changeFor("credit", "-80.00"), changeFor("credit", "300.00")]))).toBe(true);
  });
  it("follows each account kind for rows being added", () => {
    expect(changeFor("cash", "-5.00")).toBe("-5.00");
    expect(changeFor("credit", "-5.00")).toBe("5.00");
    expect(changeFor("loan", "100.00")).toBe("-100.00");
  });
  it("refuses text that isn't an amount", () => {
    expect(() => toUnits("12abc")).toThrow();
  });
});
```

`src/statementContracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateStatementRead, validateStatementReview } from "./statementContracts";
import { sampleReview } from "./statementTestFixtures";

describe("statement contracts", () => {
  it("accepts a well-formed review", () => {
    expect(validateStatementReview(sampleReview()).rows).toHaveLength(2);
  });
  it("refuses a review with a malformed amount or unknown status", () => {
    const bad = sampleReview();
    bad.rows[0].amount = "7,40";
    expect(() => validateStatementReview(bad)).toThrow("unexpected statement response");
    const worse = sampleReview();
    (worse.rows[0] as { status: string }).status = "maybe";
    expect(() => validateStatementReview(worse)).toThrow();
  });
  it("accepts a read that asks for a section choice", () => {
    expect(validateStatementRead({ token: "t", sections: [{ index: 0, name: "Savings", row_count: 0, holding_count: 0 }], review: null }).review).toBeNull();
  });
});
```

Create `src/statementTestFixtures.ts` (excluded from the plain-language scan by its name pattern `testFixtures`? — no: the guard skips names matching `/testFixtures|TestUtils/`; name it `statementTestUtils.ts` and import `sampleReview` from `./statementTestUtils` in the tests above):

```ts
import type { StatementReview } from "./statementContracts";

export function sampleReview(overrides: Partial<StatementReview> = {}): StatementReview {
  return {
    token: "tok",
    account_kind: "credit",
    source: "pdf",
    layout_name: null,
    recognized: false,
    recognized_but_failed: false,
    learnable: true,
    section_name: "Statement",
    period_start: "2026-07-22",
    period_end: "2026-08-21",
    starting_balance: "43.08",
    ending_balance: "52.36",
    ending_value: null,
    previous_ending_balance: null,
    already_reconciled_through: null,
    nothing_in_period: false,
    activity_check: { outcome: "passed", expected: null, found: null },
    holdings_check: { outcome: "not_available", expected: null, found: null },
    running_balance_breaks: 0,
    rows: [
      { index: 0, date: "2026-07-24", description: "STREAMING SERVICE", amount: "-7.40", status: "matched", match_id: 11, possible_ids: [] },
      { index: 1, date: "2026-08-17", description: "CLOUD STORAGE", amount: "-11.99", status: "missing", match_id: null, possible_ids: [] },
    ],
    app_transactions: [{ id: 11, date: "2026-07-24", description: "Streaming", amount: "-7.40", change: "7.40" }],
    not_on_statement: [],
    unread: [],
    suggest_flip: false,
    flipped: false,
    holdings: [],
    app_only_holdings: [],
    suggested_name: "Northwind Card Services",
    suggested_phrases: ["Northwind Card Services"],
    ...overrides,
  };
}
```

`src/useStatementReconcile.test.tsx` (hook harness with `createRoot` + `act`, mocking `invoke`, `./nativeDialog` and `./profileUiState`):

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { useStatementReconcile } from "./useStatementReconcile";
import { sampleReview } from "./statementTestUtils";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./nativeDialog", () => ({ open: vi.fn(() => Promise.resolve("C:/statements/aug.pdf")) }));
vi.mock("./profileUiState", () => ({ getCurrentGeneration: () => Promise.resolve(7) }));

let hook: ReturnType<typeof useStatementReconcile>;
function Probe() { hook = useStatementReconcile(5); return null; }

describe("useStatementReconcile", () => {
  let root: Root;
  beforeEach(async () => {
    root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
  });
  afterEach(() => { act(() => root.unmount()); vi.mocked(invoke).mockReset(); });

  it("reads the chosen file for the period and opens the review", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ token: "tok", sections: [{ index: 0, name: "Statement", row_count: 2, holding_count: 0 }], review: sampleReview() });
    await act(async () => hook.start("2026-07-22", "2026-08-21"));
    expect(invoke).toHaveBeenCalledWith("read_statement", { path: "C:/statements/aug.pdf", accountId: 5, periodStart: "2026-07-22", periodEnd: "2026-08-21", generation: 7 });
    expect(hook.phase.kind).toBe("review");
  });

  it("asks which account when the statement holds several", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ token: "tok", sections: [{ index: 0, name: "Savings", row_count: 0, holding_count: 0 }, { index: 1, name: "Checking", row_count: 5, holding_count: 0 }], review: null });
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
    expect(hook.phase.kind).toBe("choose_section");
    vi.mocked(invoke).mockResolvedValueOnce(sampleReview());
    await act(async () => hook.chooseSection(1));
    expect(invoke).toHaveBeenLastCalledWith("review_statement", { token: "tok", sectionIndex: 1, flip: false, generation: 7 });
    expect(hook.phase.kind).toBe("review");
  });

  it("shows the backend's message and stays where it was when reading fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("This PDF is a picture of the statement, so the app can't read its text.");
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
    expect(hook.phase.kind).toBe("idle");
    expect(hook.error).toContain("picture of the statement");
  });

  it("counts teaching attempts", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ token: "tok", sections: [], review: sampleReview({ activity_check: { outcome: "failed", expected: "1", found: "2" } }) });
    await act(async () => hook.start("2026-08-01", "2026-08-31"));
    vi.mocked(invoke).mockResolvedValueOnce([{ index: 0, page: 0, text: "Opening balance 1,250.00" }]);
    await act(async () => hook.openTeach());
    expect(hook.phase.kind).toBe("teach");
    vi.mocked(invoke).mockResolvedValueOnce(sampleReview({ activity_check: { outcome: "failed", expected: "1", found: "2" } }));
    await act(async () => hook.teach({ rows: [], balances: null, holdings: [] }));
    expect(hook.phase.kind === "teach" && hook.phase.attempts).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/reconcileMath.test.ts src/statementContracts.test.ts src/useStatementReconcile.test.tsx` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/reconcileMath.ts`:

```ts
import type { AccountKind } from "./statementContracts";

const SCALE = 4;
const UNIT = 10n ** BigInt(SCALE);

/** An amount string as an exact integer of 1/10,000ths. */
export function toUnits(s: string): bigint {
  const m = /^(-?)(\d*)(?:\.(\d+))?$/.exec(s.trim());
  if (!m || (m[2] === "" && m[3] === undefined) || (m[3] ?? "").length > SCALE) throw new Error(`Not an amount: ${s}`);
  const value = BigInt(m[2] || "0") * UNIT + BigInt((m[3] ?? "").padEnd(SCALE, "0") || "0");
  return m[1] ? -value : value;
}

/** Back to a string with at least two decimals. */
export function fromUnits(u: bigint): string {
  const negative = u < 0n;
  const a = negative ? -u : u;
  let frac = (a % UNIT).toString().padStart(SCALE, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${negative && a !== 0n ? "-" : ""}${a / UNIT}.${frac}`;
}

export const addAmounts = (values: string[]) => fromUnits(values.reduce((sum, v) => sum + toUnits(v), 0n));

/** How a transaction being added moves the statement's balance (mirrors `balance_change` in Rust). */
export function changeFor(kind: AccountKind, amount: string): string {
  return kind === "credit" || kind === "loan" ? fromUnits(-toUnits(amount)) : fromUnits(toUnits(amount));
}

/** end − (start + Σ changes). */
export const statementDifference = (end: string, start: string, changes: string[]) =>
  fromUnits(toUnits(end) - (toUnits(start) + changes.reduce((sum, c) => sum + toUnits(c), 0n)));

export const isZero = (s: string) => toUnits(s) === 0n;
```

`src/statementContracts.ts`:

```ts
import { array, boolean, date, decimal, id, integer, nullable, object, string, type Check } from "./contractChecks";

export type AccountKind = "cash" | "credit" | "loan" | "investment";
export type CheckResult = { outcome: "passed" | "failed" | "not_available"; expected: string | null; found: string | null };
export type ReviewRow = { index: number; date: string; description: string; amount: string; status: "matched" | "possible" | "missing"; match_id: number | null; possible_ids: number[] };
export type AppTransaction = { id: number; date: string; description: string; amount: string; change: string };
export type HoldingReview = { symbol: string; name: string; statement_shares: string; price: string | null; market_value: string; app_holding_id: number | null; app_shares: string | null; status: "same" | "different" | "missing_in_app" };
export type AppOnlyHolding = { id: number; symbol: string; name: string; shares: string };
export type StatementReview = {
  token: string; account_kind: AccountKind; source: "pdf" | "download"; layout_name: string | null;
  recognized: boolean; recognized_but_failed: boolean; learnable: boolean; section_name: string;
  period_start: string; period_end: string; starting_balance: string | null; ending_balance: string | null; ending_value: string | null;
  previous_ending_balance: string | null; already_reconciled_through: string | null; nothing_in_period: boolean;
  activity_check: CheckResult; holdings_check: CheckResult; running_balance_breaks: number;
  rows: ReviewRow[]; app_transactions: AppTransaction[]; not_on_statement: number[];
  unread: { line: number; text: string }[]; suggest_flip: boolean; flipped: boolean;
  holdings: HoldingReview[]; app_only_holdings: AppOnlyHolding[]; suggested_name: string; suggested_phrases: string[];
};
export type StatementRead = { token: string; sections: { index: number; name: string; row_count: number; holding_count: number }[]; review: StatementReview | null };
export type StatementLineText = { index: number; page: number; text: string };
export type StatementFinished = { reconciliation_id: number; added: number; layout_saved: string | null };
export type StatementLayoutSummary = { id: number; name: string; phrases: string[]; updated_at: string };
export type TextRef = { line: number; start: number };
export type TeachMarks = {
  rows: { date: TextRef; amount: TextRef }[];
  balances: { kind: "start_end"; start: TextRef; end: TextRef } | { kind: "totals"; additions: TextRef; subtractions: TextRef } | null;
  holdings: { symbol: TextRef; quantity: TextRef; price: TextRef | null; marketValue: TextRef; total: TextRef }[];
};
export type FinishDecisions = {
  matches: { row: number; transactionId: number }[];
  add: { row: number; date: string; description: string; amount: string }[];
  skip: number[];
  startingBalance: string | null;
  endingBalance: string | null;
  holdings: { symbol: string; action: "update" | "add" | "remove" | "leave"; holdingId: number | null; shares: string | null; price: string | null; costBasis: string | null; name: string | null }[];
  finishWithoutHoldings: boolean;
  ignoreUnread: boolean;
  saveLayout: { name: string; phrases: string[] } | null;
};

const oneOf = (...values: string[]): Check => (v) => typeof v === "string" && values.includes(v);
const ids = array(id);
const check = object({ outcome: oneOf("passed", "failed", "not_available"), expected: nullable(decimal), found: nullable(decimal) });
const reviewCheck = object({
  token: string, account_kind: oneOf("cash", "credit", "loan", "investment"), source: oneOf("pdf", "download"), layout_name: nullable(string),
  recognized: boolean, recognized_but_failed: boolean, learnable: boolean, section_name: string, period_start: date, period_end: date,
  starting_balance: nullable(decimal), ending_balance: nullable(decimal), ending_value: nullable(decimal),
  previous_ending_balance: nullable(decimal), already_reconciled_through: nullable(date), nothing_in_period: boolean,
  activity_check: check, holdings_check: check, running_balance_breaks: integer,
  rows: array(object({ index: integer, date, description: string, amount: decimal, status: oneOf("matched", "possible", "missing"), match_id: nullable(id), possible_ids: ids })),
  app_transactions: array(object({ id, date, description: string, amount: decimal, change: decimal })),
  not_on_statement: ids, unread: array(object({ line: integer, text: string })), suggest_flip: boolean, flipped: boolean,
  holdings: array(object({ symbol: string, name: string, statement_shares: decimal, price: nullable(decimal), market_value: decimal, app_holding_id: nullable(id), app_shares: nullable(decimal), status: oneOf("same", "different", "missing_in_app") })),
  app_only_holdings: array(object({ id, symbol: string, name: string, shares: decimal })),
  suggested_name: string, suggested_phrases: array(string),
});
const readCheck = object({ token: string, sections: array(object({ index: integer, name: string, row_count: integer, holding_count: integer })), review: nullable(reviewCheck) });

function validated<T>(c: Check, v: unknown): T {
  if (!c(v)) throw new Error("The app received an unexpected statement response. Read the statement again.");
  return v as T;
}

export const validateStatementReview = (v: unknown) => validated<StatementReview>(reviewCheck, v);
export const validateStatementRead = (v: unknown) => validated<StatementRead>(readCheck, v);
export const validateStatementLines = (v: unknown) => validated<StatementLineText[]>(array(object({ index: integer, page: integer, text: string })), v);
export const validateStatementFinished = (v: unknown) => validated<StatementFinished>(object({ reconciliation_id: id, added: integer, layout_saved: nullable(string) }), v);
export const validateStatementLayouts = (v: unknown) => validated<StatementLayoutSummary[]>(array(object({ id, name: string, phrases: array(string), updated_at: string })), v);
```

`src/useStatementReconcile.ts`:

```ts
import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "./nativeDialog";
import { getCurrentGeneration } from "./profileUiState";
import { errorMessage } from "./errorMessage";
import {
  validateStatementFinished, validateStatementLines, validateStatementRead, validateStatementReview,
  type FinishDecisions, type StatementFinished, type StatementLineText, type StatementRead, type StatementReview, type TeachMarks,
} from "./statementContracts";

export type StatementPhase =
  | { kind: "idle" }
  | { kind: "choose_section"; read: StatementRead }
  | { kind: "review"; review: StatementReview }
  | { kind: "teach"; review: StatementReview; lines: StatementLineText[]; attempts: number }
  | { kind: "done"; finished: StatementFinished };

/** Owns the upload → review → (teach) → finish flow for one account. Every call carries the profile
 * generation, so a profile switch mid-review is refused by the backend. */
export function useStatementReconcile(accountId: number) {
  const [phase, setPhase] = useState<StatementPhase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useRef<string | null>(null);
  const generation = useRef<number | null>(null);
  const flip = useRef(false);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }, []);

  const start = useCallback((periodStart: string, periodEnd: string, kind: "pdf" | "download" = "pdf") => run(async () => {
    const filters = kind === "pdf" ? [{ name: "Statement (PDF)", extensions: ["pdf"] }] : [{ name: "Bank download", extensions: ["csv", "ofx", "qfx", "qif"] }];
    const path = await open({ multiple: false, directory: false, filters });
    if (typeof path !== "string") return;
    generation.current = await getCurrentGeneration();
    flip.current = false;
    const read = validateStatementRead(await invoke("read_statement", { path, accountId, periodStart, periodEnd, generation: generation.current }));
    token.current = read.token;
    setPhase(read.review ? { kind: "review", review: read.review } : { kind: "choose_section", read });
  }), [accountId, run]);

  const review = useCallback(async (sectionIndex: number) => {
    const r = validateStatementReview(await invoke("review_statement", { token: token.current, sectionIndex, flip: flip.current, generation: generation.current }));
    setPhase({ kind: "review", review: r });
  }, []);

  const section = useRef(0);
  const chooseSection = useCallback((index: number) => run(async () => { section.current = index; await review(index); }), [review, run]);
  const setFlip = useCallback((value: boolean) => run(async () => { flip.current = value; await review(section.current); }), [review, run]);

  const openTeach = useCallback(() => run(async () => {
    if (phase.kind !== "review") return;
    const lines = validateStatementLines(await invoke("statement_lines", { token: token.current, generation: generation.current }));
    setPhase({ kind: "teach", review: phase.review, lines, attempts: 0 });
  }), [phase, run]);

  const teach = useCallback((marks: TeachMarks) => run(async () => {
    if (phase.kind !== "teach") return;
    const r = validateStatementReview(await invoke("teach_statement_layout", { token: token.current, marks, generation: generation.current }));
    const stillFailing = r.activity_check.outcome === "failed" || r.holdings_check.outcome === "failed";
    setPhase(stillFailing ? { kind: "teach", review: r, lines: phase.lines, attempts: phase.attempts + 1 } : { kind: "review", review: r });
  }), [phase, run]);

  const finish = useCallback((decisions: FinishDecisions) => run(async () => {
    const finished = validateStatementFinished(await invoke("finish_statement_reconciliation", { token: token.current, decisions, generation: generation.current }));
    token.current = null;
    setPhase({ kind: "done", finished });
  }), [run]);

  const cancel = useCallback(() => {
    token.current = null;
    setError(null);
    setPhase({ kind: "idle" });
    void invoke("cancel_statement_review").catch(() => {});
  }, []);

  const backToReview = useCallback(() => { if (phase.kind === "teach") setPhase({ kind: "review", review: phase.review }); }, [phase]);

  return { phase, error, busy, start, chooseSection, setFlip, openTeach, teach, finish, cancel, backToReview };
}
```

(If `nativeDialog`'s `open` options differ for the installed `@tauri-apps/plugin-dialog`, match the call in `App.tsx`'s import picker.)

- [ ] **Step 4: Run to verify pass** — the three test files PASS; `npx vitest run src/plainLanguage.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/statementContracts.ts src/statementContracts.test.ts src/statementTestUtils.ts src/reconcileMath.ts src/reconcileMath.test.ts src/useStatementReconcile.ts src/useStatementReconcile.test.tsx
git commit -m "Add statement contracts, exact reconcile arithmetic and the upload flow hook"
```

---

### Task 21: The statement review dialog

**Files:**
- Create: `src/StatementReviewDialog.tsx`, `src/StatementReviewDialog.test.tsx`, `src/StatementReconcile.css`

**Interfaces:**
- Consumes: `StatementReview`, `FinishDecisions`, `reconcileMath`, `ModalShell`, `formatAmount`, `formatDisplayDate`, `isValidDecimalString`.
- Produces: `StatementReviewDialog({ review, accountName, busy, error, onFlip(flip), onTeach(), onUseDownload(), onReconcileByHand(), onFinish(decisions), onCancel() })`; pure helper `export function initialChoices(review): Map<number, RowChoice>` and `export function canFinish(review, state): { ok: boolean; reason: string | null; difference: string | null }` (exported for tests).

Behaviour (all copy plain):
- Header: `section_name`, the period, and "Read using: {layout_name}" when recognized.
- Status banner:
  - activity check failed → "Some of this statement couldn't be read." plus buttons **Teach the app how to read this statement** (`data-teach`), **Use your bank's CSV or OFX download instead** (`data-use-download`), **Reconcile by hand** (`data-reconcile-by-hand`); the person may also continue reviewing.
  - `recognized_but_failed` → "This bank's statements look different from last time." and the same Teach button.
  - `already_reconciled_through` → "You already reconciled this account through {date}. Lines from before then are not offered for adding." and **no row starts as Add**.
  - `suggest_flip` → "The amounts look reversed compared with your transactions. Flip them?" button (`data-flip`); `flipped` → "Amounts flipped." with an undo button.
- Balances (not for investments): "Starting balance" input — shown only when `previous_ending_balance` is null, prefilled from `starting_balance`; otherwise the text "Picks up from your last reconciliation ({amount})". "Ending balance" input prefilled from `ending_balance`. For credit cards the labels say "Amount owed at the start/end"; loans "Principal owed at the start/end".
- Rows table (`data-statement-row={index}`), one row per statement line with a choice control:
  - matched → "Matches: {app description} on {date}" with a **Not a match** button (turns it into an unresolved row).
  - possible → buttons for each candidate "Same as {description} on {date}" plus **Add it** and **Skip**.
  - missing → **Add** (default unless already reconciled) / **Skip**; when Add is chosen, editable description field.
- "In the app, not on your statement" list (`not_on_statement` resolved against `app_transactions`) with the note "These stay unticked. They may appear on next month's statement, or they may be duplicates."
- "Couldn't read" list of `unread` lines with a checkbox **Ignore the lines the app couldn't read** (`data-ignore-unread`).
- Investments: holdings table (`data-holding={symbol}`): same → "Matches"; different → **Update the app to {n} shares** (default) / **Leave it**; missing_in_app → **Add this holding** with a required "What you paid in total" input (`data-cost-basis`) / **Leave it**; app_only → **Remove from the app** / **Leave it** (default leave). When `holdings_check.outcome === "failed"`: "The app couldn't read your holdings correctly." with Teach and a **Finish without checking holdings** checkbox.
- Remember section when `learnable`: "We'll recognise statements like this next time." Name input (default `suggested_name`) and one checkbox per `suggested_phrases` entry (first ticked) labelled "Recognise it by: “{phrase}”" (`data-remember-phrase`). A tick-box **Remember this statement** (default on).
- Footer: Difference (cash/credit/loan) computed with `statementDifference(end, start, changes)` where `start = previous_ending_balance ?? startingInput`, `changes` = `change` of each chosen app transaction + `changeFor(kind, amount)` of each added row; shown with `data-difference` and `data-balanced`. **Finish reconciliation** (`data-statement-finish`) disabled unless `canFinish(...).ok`; the reason shows beneath it.

- [ ] **Step 1: Write the failing tests** — `src/StatementReviewDialog.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StatementReviewDialog, canFinish, initialChoices } from "./StatementReviewDialog";
import { sampleReview } from "./statementTestUtils";

let container: HTMLDivElement;
let root: Root;
const noop = () => {};
async function render(review = sampleReview(), onFinish = vi.fn()) {
  await act(async () => root.render(
    <StatementReviewDialog review={review} accountName="Card" busy={false} error={null} onFlip={noop} onTeach={noop} onUseDownload={noop} onReconcileByHand={noop} onFinish={onFinish} onCancel={noop} />,
  ));
  return onFinish;
}

describe("StatementReviewDialog", () => {
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("matched rows start matched and missing rows start as Add", () => {
    const choices = initialChoices(sampleReview());
    expect(choices.get(0)).toEqual({ kind: "match", transactionId: 11 });
    expect(choices.get(1)).toMatchObject({ kind: "add" });
  });

  it("nothing starts as Add when the period was already reconciled", () => {
    const choices = initialChoices(sampleReview({ already_reconciled_through: "2026-08-31" }));
    expect(choices.get(1)).toBeUndefined();
  });

  it("finishes only when the difference is exactly zero", async () => {
    // start 43.08 + matched 7.40 (owed up) + added 11.99 (owed up) = 62.47 ≠ 52.36
    const review = sampleReview();
    expect(canFinish(review, { choices: initialChoices(review), start: "43.08", end: "52.36", holdings: new Map(), finishWithoutHoldings: false }).ok).toBe(false);
    expect(canFinish(review, { choices: initialChoices(review), start: "43.08", end: "62.47", holdings: new Map(), finishWithoutHoldings: false }).ok).toBe(true);
  });

  it("sends one decision per statement line and the phrases to remember", async () => {
    const review = sampleReview({ ending_balance: "62.47" });
    const onFinish = await render(review);
    const finish = document.querySelector<HTMLButtonElement>("[data-statement-finish]")!;
    expect(finish.disabled).toBe(false);
    await act(async () => finish.click());
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({
      matches: [{ row: 0, transactionId: 11 }],
      add: [{ row: 1, date: "2026-08-17", description: "CLOUD STORAGE", amount: "-11.99" }],
      skip: [],
      startingBalance: "43.08",
      endingBalance: "62.47",
      saveLayout: { name: "Northwind Card Services", phrases: ["Northwind Card Services"] },
    }));
  });

  it("offers teaching, the download and reconciling by hand when the statement doesn't add up", async () => {
    await render(sampleReview({ activity_check: { outcome: "failed", expected: "52.36", found: "60.00" } }));
    expect(document.body.textContent).toContain("Some of this statement couldn't be read.");
    for (const sel of ["[data-teach]", "[data-use-download]", "[data-reconcile-by-hand]"]) expect(document.querySelector(sel)).not.toBeNull();
  });

  it("an investment needs every share count to match, or finishing without holdings when they couldn't be read", () => {
    const review = sampleReview({
      account_kind: "investment", starting_balance: null, ending_balance: null, learnable: false,
      holdings: [{ symbol: "QQQZ", name: "Tracker", statement_shares: "10.5", price: "300.25", market_value: "3152.63", app_holding_id: 4, app_shares: "10", status: "different" }],
    });
    const base = { choices: initialChoices(review), start: "", end: "", finishWithoutHoldings: false };
    expect(canFinish(review, { ...base, holdings: new Map([["QQQZ", { action: "leave" as const }]]) }).ok).toBe(false);
    expect(canFinish(review, { ...base, holdings: new Map([["QQQZ", { action: "update" as const }]]) }).ok).toBe(true);
  });

  it("says plainly when nothing on the statement falls in the dates entered", async () => {
    await render(sampleReview({ rows: [], nothing_in_period: true, activity_check: { outcome: "failed", expected: "52.36", found: "43.08" } }));
    expect(document.body.textContent).toContain("No transactions were found between");
    expect(document.body.textContent).toContain("make sure this is the statement for Card");
    expect(document.querySelector("[data-teach]")).not.toBeNull();
  });

  it("uses no jargon", async () => {
    await render();
    expect(document.body.textContent).not.toMatch(/\b(cleared|layout|parse|unmatched|tracked|published)\b/i);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (module missing).

- [ ] **Step 3: Implement** `src/StatementReviewDialog.tsx`:

```tsx
import "./StatementReconcile.css";
import { useMemo, useState } from "react";
import { ModalShell } from "./Modal";
import { formatAmount, formatDisplayDate, isValidDecimalString } from "./format";
import { changeFor, isZero, statementDifference } from "./reconcileMath";
import type { FinishDecisions, StatementReview } from "./statementContracts";

export type RowChoice = { kind: "match"; transactionId: number } | { kind: "add"; description: string } | { kind: "skip" };
export type HoldingChoice = { action: "update" | "add" | "remove" | "leave"; costBasis?: string };
type FinishState = { choices: Map<number, RowChoice>; start: string; end: string; holdings: Map<string, HoldingChoice>; finishWithoutHoldings: boolean };

export function initialChoices(review: StatementReview): Map<number, RowChoice> {
  const choices = new Map<number, RowChoice>();
  for (const row of review.rows) {
    if (row.status === "matched" && row.match_id !== null) choices.set(row.index, { kind: "match", transactionId: row.match_id });
    else if (row.status === "missing" && !review.already_reconciled_through) choices.set(row.index, { kind: "add", description: row.description });
  }
  return choices;
}

function initialHoldings(review: StatementReview): Map<string, HoldingChoice> {
  const out = new Map<string, HoldingChoice>();
  for (const h of review.holdings) out.set(h.symbol, { action: h.status === "different" ? "update" : h.status === "missing_in_app" ? "add" : "leave" });
  for (const h of review.app_only_holdings) out.set(`app:${h.id}`, { action: "leave" });
  return out;
}

export function canFinish(review: StatementReview, s: FinishState): { ok: boolean; reason: string | null; difference: string | null } {
  if (review.rows.some((r) => !s.choices.has(r.index))) return { ok: false, reason: "Choose what to do with every line on your statement.", difference: null };
  const used = [...s.choices.values()].filter((c) => c.kind === "match").map((c) => (c as { transactionId: number }).transactionId);
  if (new Set(used).size !== used.length) return { ok: false, reason: "One of your transactions is matched to two lines.", difference: null };
  if ([...s.choices.values()].some((c) => c.kind === "add" && !c.description.trim())) return { ok: false, reason: "Every transaction you add needs a description.", difference: null };
  if (review.account_kind === "investment") {
    if (review.holdings_check.outcome === "failed" && s.finishWithoutHoldings) return { ok: true, reason: null, difference: null };
    for (const h of review.holdings) {
      const c = s.holdings.get(h.symbol);
      if (h.status === "different" && c?.action !== "update") return { ok: false, reason: `Update ${h.symbol} to match your statement first.`, difference: null };
      if (h.status === "missing_in_app" && (c?.action !== "add" || !c.costBasis || !isValidDecimalString(c.costBasis)))
        return { ok: false, reason: `Add ${h.symbol} with what you paid for it first.`, difference: null };
    }
    return { ok: true, reason: null, difference: null };
  }
  const start = review.previous_ending_balance ?? s.start;
  if (!isValidDecimalString(start) || !isValidDecimalString(s.end)) return { ok: false, reason: "Enter the statement's balances.", difference: null };
  const byId = new Map(review.app_transactions.map((t) => [t.id, t]));
  const changes = review.rows.flatMap((r) => {
    const c = s.choices.get(r.index);
    if (c?.kind === "match") return [byId.get(c.transactionId)?.change ?? "0"];
    if (c?.kind === "add") return [changeFor(review.account_kind, r.amount)];
    return [];
  });
  const difference = statementDifference(s.end, start, changes);
  return isZero(difference) ? { ok: true, reason: null, difference } : { ok: false, reason: "The difference has to be $0.00.", difference };
}

function balanceWords(kind: StatementReview["account_kind"]) {
  if (kind === "credit") return { start: "Amount owed at the start", end: "Amount owed at the end" };
  if (kind === "loan") return { start: "Principal owed at the start", end: "Principal owed at the end" };
  return { start: "Starting balance", end: "Ending balance" };
}

export function StatementReviewDialog(props: {
  review: StatementReview; accountName: string; busy: boolean; error: string | null;
  onFlip: (flip: boolean) => void; onTeach: () => void; onUseDownload: () => void; onReconcileByHand: () => void;
  onFinish: (d: FinishDecisions) => void; onCancel: () => void;
}) {
  const { review } = props;
  const [choices, setChoices] = useState(() => initialChoices(review));
  const [start, setStart] = useState(review.starting_balance ?? "");
  const [end, setEnd] = useState(review.ending_balance ?? "");
  const [holdings, setHoldings] = useState(() => initialHoldings(review));
  const [finishWithoutHoldings, setFinishWithoutHoldings] = useState(false);
  const [ignoreUnread, setIgnoreUnread] = useState(false);
  const [remember, setRemember] = useState(true);
  const [name, setName] = useState(review.suggested_name);
  const [phrases, setPhrases] = useState<string[]>(review.suggested_phrases.slice(0, 1));
  const byId = useMemo(() => new Map(review.app_transactions.map((t) => [t.id, t])), [review]);
  const status = canFinish(review, { choices, start, end, holdings, finishWithoutHoldings });
  const words = balanceWords(review.account_kind);
  const investment = review.account_kind === "investment";
  const needsHelp = review.activity_check.outcome === "failed" || review.recognized_but_failed;
  const setChoice = (index: number, c: RowChoice | null) => setChoices((m) => { const n = new Map(m); if (c) n.set(index, c); else n.delete(index); return n; });
  const setHolding = (key: string, c: HoldingChoice) => setHoldings((m) => new Map(m).set(key, c));

  function submit() {
    const d: FinishDecisions = {
      matches: [], add: [], skip: [],
      startingBalance: investment || review.previous_ending_balance ? null : start,
      endingBalance: investment ? null : end,
      holdings: [], finishWithoutHoldings, ignoreUnread,
      saveLayout: review.learnable && remember && phrases.length > 0 ? { name: name.trim(), phrases } : null,
    };
    for (const r of review.rows) {
      const c = choices.get(r.index)!;
      if (c.kind === "match") d.matches.push({ row: r.index, transactionId: c.transactionId });
      else if (c.kind === "add") d.add.push({ row: r.index, date: r.date, description: c.description.trim(), amount: r.amount });
      else d.skip.push(r.index);
    }
    for (const h of review.holdings) {
      const c = holdings.get(h.symbol) ?? { action: "leave" };
      d.holdings.push({ symbol: h.symbol, action: c.action, holdingId: h.app_holding_id, shares: h.statement_shares, price: h.price, costBasis: c.costBasis ?? null, name: h.name || h.symbol });
    }
    for (const h of review.app_only_holdings) {
      const c = holdings.get(`app:${h.id}`) ?? { action: "leave" };
      d.holdings.push({ symbol: h.symbol, action: c.action, holdingId: h.id, shares: null, price: null, costBasis: null, name: h.name });
    }
    props.onFinish(d);
  }

  const footer = (
    <div className="statement-footer">
      {!investment && (
        <span className={status.difference && isZero(status.difference) ? "reconcile-figure reconcile-balanced" : "reconcile-figure reconcile-off"} data-difference data-balanced={status.ok ? "true" : "false"}>
          Difference {status.difference ? formatAmount(status.difference) : "—"}
        </span>
      )}
      {status.reason && <span className="modal-message-secondary">{status.reason}</span>}
      <button type="button" className="modal-secondary" onClick={props.onCancel} disabled={props.busy}>Not now</button>
      <button type="button" onClick={submit} disabled={!status.ok || props.busy} data-statement-finish>Finish reconciliation</button>
    </div>
  );

  return (
    <ModalShell title={`Reconcile ${props.accountName}`} onCancel={props.onCancel} wide dismissOnOverlayClick={false} footer={footer}>
      <div className="statement-review" data-statement-review>
        <p className="modal-message-secondary">
          {review.section_name} · {formatDisplayDate(review.period_start)} – {formatDisplayDate(review.period_end)}
          {review.layout_name ? ` · Read using: ${review.layout_name}` : ""}
        </p>
        {props.error && <p className="statement-error" role="alert">{props.error}</p>}
        {needsHelp && (
          <div className="statement-banner" data-needs-help>
            <p>{review.recognized_but_failed ? "This bank's statements look different from last time." : "Some of this statement couldn't be read."}</p>
            <div className="statement-banner-actions">
              {review.source === "pdf" && <button type="button" onClick={props.onTeach} data-teach>Teach the app how to read this statement</button>}
              <button type="button" className="modal-secondary" onClick={props.onUseDownload} data-use-download>Use your bank's CSV or OFX download instead</button>
              <button type="button" className="modal-secondary" onClick={props.onReconcileByHand} data-reconcile-by-hand>Reconcile by hand</button>
            </div>
          </div>
        )}
        {review.nothing_in_period && (
          <p className="statement-banner" data-nothing-in-period>
            No transactions were found between {formatDisplayDate(review.period_start)} and {formatDisplayDate(review.period_end)}. Check the dates, or make
            sure this is the statement for {props.accountName}.
          </p>
        )}
        {review.already_reconciled_through && (
          <p className="statement-banner">You already reconciled this account through {formatDisplayDate(review.already_reconciled_through)}. Lines from before then are not offered for adding.</p>
        )}
        {review.suggest_flip && (
          <p className="statement-banner">The amounts look reversed compared with your transactions. <button type="button" onClick={() => props.onFlip(true)} data-flip>Flip them</button></p>
        )}
        {review.flipped && <p className="modal-message-secondary">Amounts flipped. <button type="button" className="link-button" onClick={() => props.onFlip(false)}>Undo</button></p>}

        {!investment && (
          <div className="statement-balances">
            {review.previous_ending_balance === null ? (
              <label className="labeled-field"><span className="labeled-field-label">{words.start}</span>
                <input value={start} onChange={(e) => setStart(e.target.value)} data-statement-review-start /></label>
            ) : (
              <p className="modal-message-secondary">Picks up from your last reconciliation ({formatAmount(review.previous_ending_balance)}).</p>
            )}
            <label className="labeled-field"><span className="labeled-field-label">{words.end}</span>
              <input value={end} onChange={(e) => setEnd(e.target.value)} data-statement-review-end /></label>
          </div>
        )}

        <table className="ledger statement-rows">
          <thead><tr><th>Date</th><th>On your statement</th><th className="amount-col">Amount</th><th>In the app</th></tr></thead>
          <tbody>
            {review.rows.map((r) => {
              const c = choices.get(r.index);
              const matchedTx = c?.kind === "match" ? byId.get(c.transactionId) : undefined;
              return (
                <tr key={r.index} data-statement-row={r.index} data-choice={c?.kind ?? "none"}>
                  <td className="date-cell">{formatDisplayDate(r.date)}</td>
                  <td>{r.description}</td>
                  <td className="amount-col">{formatAmount(r.amount)}</td>
                  <td>
                    {matchedTx ? (
                      <span>Matches “{matchedTx.description}” on {formatDisplayDate(matchedTx.date)} <button type="button" className="link-button" onClick={() => setChoice(r.index, null)} data-not-a-match>Not a match</button></span>
                    ) : (
                      <span className="statement-choices">
                        {r.possible_ids.map((id) => { const t = byId.get(id); return t ? (
                          <button key={id} type="button" className="modal-secondary" onClick={() => setChoice(r.index, { kind: "match", transactionId: id })} data-same-as={id}>Same as “{t.description}” on {formatDisplayDate(t.date)}</button>
                        ) : null; })}
                        <button type="button" className={c?.kind === "add" ? "" : "modal-secondary"} onClick={() => setChoice(r.index, { kind: "add", description: r.description })} data-add-row>Add it</button>
                        <button type="button" className={c?.kind === "skip" ? "" : "modal-secondary"} onClick={() => setChoice(r.index, { kind: "skip" })} data-skip-row>Skip</button>
                        {c?.kind === "add" && (
                          <input aria-label="Description for the new transaction" value={c.description} onChange={(e) => setChoice(r.index, { kind: "add", description: e.target.value })} />
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {review.not_on_statement.length > 0 && (
          <div className="statement-section" data-not-on-statement>
            <h3>In the app, not on your statement</h3>
            <p className="modal-message-secondary">These stay unticked. They may appear on next month's statement, or they may be duplicates.</p>
            <ul>{review.not_on_statement.map((id) => { const t = byId.get(id); return t ? <li key={id}>{formatDisplayDate(t.date)} · {t.description} · {formatAmount(t.amount)}</li> : null; })}</ul>
          </div>
        )}

        {review.unread.length > 0 && (
          <div className="statement-section" data-unread>
            <h3>Couldn't read</h3>
            <ul>{review.unread.map((u) => <li key={u.line}>{u.text}</li>)}</ul>
            <label><input type="checkbox" checked={ignoreUnread} onChange={(e) => setIgnoreUnread(e.target.checked)} data-ignore-unread /> Ignore the lines the app couldn't read</label>
          </div>
        )}

        {investment && (
          <div className="statement-section" data-holdings>
            <h3>Share counts</h3>
            {review.holdings_check.outcome === "failed" && (
              <div className="statement-banner">
                <p>The app couldn't read your holdings correctly.</p>
                {review.source === "pdf" && <button type="button" onClick={props.onTeach} data-teach-holdings>Teach the app how to read your holdings</button>}
                <label><input type="checkbox" checked={finishWithoutHoldings} onChange={(e) => setFinishWithoutHoldings(e.target.checked)} data-finish-without-holdings /> Finish without checking holdings</label>
              </div>
            )}
            {review.ending_value && <p className="modal-message-secondary">Value on the statement: {formatAmount(review.ending_value)} (for reference — it changes with the market).</p>}
            <table className="ledger">
              <thead><tr><th>Holding</th><th className="amount-col">On your statement</th><th className="amount-col">In the app</th><th></th></tr></thead>
              <tbody>
                {review.holdings.map((h) => {
                  const c = holdings.get(h.symbol) ?? { action: "leave" };
                  return (
                    <tr key={h.symbol} data-holding={h.symbol} data-holding-status={h.status}>
                      <td>{h.symbol} {h.name}</td>
                      <td className="amount-col">{h.statement_shares} shares</td>
                      <td className="amount-col">{h.app_shares ? `${h.app_shares} shares` : "—"}</td>
                      <td>
                        {h.status === "same" && "Matches"}
                        {h.status === "different" && (<>
                          <button type="button" className={c.action === "update" ? "" : "modal-secondary"} onClick={() => setHolding(h.symbol, { action: "update" })} data-update-holding>Update the app to {h.statement_shares} shares</button>
                          <button type="button" className={c.action === "leave" ? "" : "modal-secondary"} onClick={() => setHolding(h.symbol, { action: "leave" })}>Leave it</button>
                        </>)}
                        {h.status === "missing_in_app" && (<>
                          <button type="button" className={c.action === "add" ? "" : "modal-secondary"} onClick={() => setHolding(h.symbol, { action: "add", costBasis: c.costBasis })} data-add-holding>Add this holding</button>
                          <button type="button" className={c.action === "leave" ? "" : "modal-secondary"} onClick={() => setHolding(h.symbol, { action: "leave" })}>Leave it</button>
                          {c.action === "add" && (
                            <label className="labeled-field"><span className="labeled-field-label">What you paid in total</span>
                              <input value={c.costBasis ?? ""} onChange={(e) => setHolding(h.symbol, { action: "add", costBasis: e.target.value })} data-cost-basis placeholder="0.00" /></label>
                          )}
                        </>)}
                      </td>
                    </tr>
                  );
                })}
                {review.app_only_holdings.map((h) => {
                  const c = holdings.get(`app:${h.id}`) ?? { action: "leave" };
                  return (
                    <tr key={`app-${h.id}`} data-app-only-holding={h.symbol}>
                      <td>{h.symbol} {h.name}</td><td className="amount-col">—</td><td className="amount-col">{h.shares} shares</td>
                      <td>
                        <button type="button" className={c.action === "remove" ? "" : "modal-secondary"} onClick={() => setHolding(`app:${h.id}`, { action: "remove" })}>Remove from the app</button>
                        <button type="button" className={c.action === "leave" ? "" : "modal-secondary"} onClick={() => setHolding(`app:${h.id}`, { action: "leave" })}>Leave it</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {review.learnable && (
          <div className="statement-section" data-remember>
            <label><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-remember-toggle /> Remember this statement — we'll recognise statements like this next time.</label>
            {remember && (<>
              <label className="labeled-field"><span className="labeled-field-label">Name</span><input value={name} onChange={(e) => setName(e.target.value)} data-remember-name /></label>
              {review.suggested_phrases.map((p) => (
                <label key={p}><input type="checkbox" checked={phrases.includes(p)} onChange={(e) => setPhrases((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))} data-remember-phrase /> Recognise it by: “{p}”</label>
              ))}
              {review.unread.length > 0 && !ignoreUnread && <p className="modal-message-secondary">Tick “Ignore the lines the app couldn't read” to remember this statement.</p>}
            </>)}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
```

`src/StatementReconcile.css` — layout only, using existing tokens (follow `Ledger.css` naming; no new colours):

```css
.statement-review { display: flex; flex-direction: column; gap: 16px; }
.statement-banner { padding: 12px 14px; border-radius: 10px; background: var(--surface-2, rgba(127, 127, 127, 0.08)); }
.statement-banner-actions, .statement-choices { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.statement-balances { display: flex; flex-wrap: wrap; gap: 16px; }
.statement-section h3 { margin: 0 0 6px; font-size: 1rem; }
.statement-footer { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: flex-end; }
.statement-error { color: var(--danger, #c0392b); }
.statement-teach-line { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 0; }
.statement-teach-word { padding: 1px 4px; border-radius: 4px; border: 1px solid transparent; background: none; font: inherit; cursor: pointer; }
.statement-teach-word[data-marked] { border-color: var(--accent, #3b82f6); background: var(--accent-soft, rgba(59, 130, 246, 0.12)); }
```

(Before committing, open `src/Ledger.css` and `src/App.css` and replace the fallback variables above with the project's real token names for surface, accent and danger.)

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/StatementReviewDialog.test.tsx src/plainLanguage.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/StatementReviewDialog.tsx src/StatementReviewDialog.test.tsx src/StatementReconcile.css
git commit -m "Add the statement review screen"
```

---

### Task 22: The teaching dialog

**Files:**
- Create: `src/StatementTeachDialog.tsx`, `src/StatementTeachDialog.test.tsx`

**Interfaces:**
- Consumes: `StatementLineText`, `TeachMarks`, `TextRef`, `AccountKind`, `ModalShell`.
- Produces: `StatementTeachDialog({ lines, kind, attempts, busy, error, needs: { rows: boolean; holdings: boolean }, onTeach(marks), onBack(), onGiveUp() })`; exported `steps(kind, needs)` and `MAX_ATTEMPTS = 3`.

Behaviour:
- The statement's lines are shown one per row (`.statement-teach-line`), each word a button (`.statement-teach-word`, `data-line`, `data-start` = character index of the word).
- A step prompt walks through the marks, one click each:
  - when `needs.rows`: "Click the date of one transaction." → "Click that transaction's amount." → balance choice for investments ("This statement shows totals of money added and taken out" / "This statement shows a cash balance at the start and end" / "This statement shows neither", `data-balance-kind`) or for other accounts "Click the starting balance." → "Click the ending balance." (with a **This statement doesn't show these** button, `data-no-balances`).
  - when `needs.holdings`: "Click the symbol of one holding." → "Click its number of shares." → "Click its price." (with **It has no price**) → "Click its value." → "Click the total value of all holdings."
- Each clicked word is highlighted (`data-marked`). **Undo last click** (`data-undo-mark`).
- When every step is done, **Check my examples** (`data-teach-submit`) calls `onTeach(marks)`.
- `attempts >= 1` shows "That still doesn't add up. Show the app one more example." and restarts the steps with the previous marks kept for the other kinds; at `attempts >= MAX_ATTEMPTS` show "The app still can't read this statement. You can use your bank's CSV or OFX download, or reconcile by hand." and only **Back** / **Use another way** (`onGiveUp`).

- [ ] **Step 1: Write the failing test** — `src/StatementTeachDialog.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StatementTeachDialog, MAX_ATTEMPTS } from "./StatementTeachDialog";

const lines = [
  { index: 0, page: 0, text: "Riverbend Mutual Bank" },
  { index: 1, page: 0, text: "Opening balance 1,250.00" },
  { index: 2, page: 0, text: "03/08/2026 Supermarket purchase 54.20" },
  { index: 3, page: 0, text: "Closing balance 3,132.00" },
];
let container: HTMLDivElement;
let root: Root;
const word = (line: number, text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(`[data-line="${line}"]`)].find((b) => b.textContent === text)!;

describe("StatementTeachDialog", () => {
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("collects one click per step and sends character positions", async () => {
    const onTeach = vi.fn();
    await act(async () => root.render(<StatementTeachDialog lines={lines} kind="cash" attempts={0} busy={false} error={null} needs={{ rows: true, holdings: false }} onTeach={onTeach} onBack={() => {}} onGiveUp={() => {}} />));
    expect(document.body.textContent).toContain("Click the date of one transaction.");
    await act(async () => word(2, "03/08/2026").click());
    await act(async () => word(2, "54.20").click());
    await act(async () => word(1, "1,250.00").click());
    await act(async () => word(3, "3,132.00").click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-teach-submit]")!.click());
    expect(onTeach).toHaveBeenCalledWith({
      rows: [{ date: { line: 2, start: 0 }, amount: { line: 2, start: 32 } }],
      balances: { kind: "start_end", start: { line: 1, start: 16 }, end: { line: 3, start: 16 } },
      holdings: [],
    });
  });

  it("stops offering more examples after three tries", async () => {
    await act(async () => root.render(<StatementTeachDialog lines={lines} kind="cash" attempts={MAX_ATTEMPTS} busy={false} error={null} needs={{ rows: true, holdings: false }} onTeach={() => {}} onBack={() => {}} onGiveUp={() => {}} />));
    expect(document.body.textContent).toContain("The app still can't read this statement.");
    expect(document.querySelector("[data-teach-submit]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement** `src/StatementTeachDialog.tsx`:

```tsx
import "./StatementReconcile.css";
import { useMemo, useState } from "react";
import { ModalShell } from "./Modal";
import type { AccountKind, StatementLineText, TeachMarks, TextRef } from "./statementContracts";

export const MAX_ATTEMPTS = 3;

type StepId = "date" | "amount" | "balance_kind" | "start" | "end" | "symbol" | "quantity" | "price" | "value" | "total";
type BalanceKind = "start_end" | "totals" | "none";

const PROMPTS: Record<StepId, string> = {
  date: "Click the date of one transaction.",
  amount: "Click that transaction's amount.",
  balance_kind: "What does this statement show for the account's money?",
  start: "Click the starting balance.",
  end: "Click the ending balance.",
  symbol: "Click the symbol of one holding.",
  quantity: "Click its number of shares.",
  price: "Click its price.",
  value: "Click its value.",
  total: "Click the total value of all holdings.",
};

export function steps(kind: AccountKind, needs: { rows: boolean; holdings: boolean }, balanceKind: BalanceKind | null): StepId[] {
  const out: StepId[] = [];
  if (needs.rows) {
    out.push("date", "amount");
    if (kind === "investment") out.push("balance_kind");
    if (kind !== "investment" || (balanceKind !== null && balanceKind !== "none")) out.push("start", "end");
  }
  if (needs.holdings) out.push("symbol", "quantity", "price", "value", "total");
  return out;
}

function words(text: string): { word: string; start: number }[] {
  const out: { word: string; start: number }[] = [];
  const chars = [...text];
  let i = 0;
  while (i < chars.length) {
    if (/\s/.test(chars[i])) { i++; continue; }
    const start = i;
    while (i < chars.length && !/\s/.test(chars[i])) i++;
    out.push({ word: chars.slice(start, i).join(""), start });
  }
  return out;
}

export function StatementTeachDialog(props: {
  lines: StatementLineText[]; kind: AccountKind; attempts: number; busy: boolean; error: string | null;
  needs: { rows: boolean; holdings: boolean };
  onTeach: (marks: TeachMarks) => void; onBack: () => void; onGiveUp: () => void;
}) {
  const [balanceKind, setBalanceKind] = useState<BalanceKind | null>(props.kind === "investment" ? null : "start_end");
  const [marks, setMarks] = useState<Partial<Record<StepId, TextRef | null>>>({});
  const order = steps(props.kind, props.needs, balanceKind);
  const current = order.find((s) => !(s in marks) && !(s === "balance_kind" && balanceKind !== null));
  const exhausted = props.attempts >= MAX_ATTEMPTS;
  const marked = useMemo(() => new Set(Object.values(marks).filter(Boolean).map((r) => `${r!.line}:${r!.start}`)), [marks]);

  function click(ref: TextRef) {
    if (!current || current === "balance_kind") return;
    setMarks((m) => ({ ...m, [current]: ref }));
  }

  function undo() {
    const done = order.filter((s) => s in marks);
    const last = done[done.length - 1];
    if (!last) return;
    setMarks((m) => { const n = { ...m }; delete n[last]; return n; });
  }

  function submit() {
    const m = marks;
    const result: TeachMarks = { rows: [], balances: null, holdings: [] };
    if (m.date && m.amount) result.rows.push({ date: m.date, amount: m.amount });
    if (m.start && m.end) {
      result.balances = balanceKind === "totals" ? { kind: "totals", additions: m.start, subtractions: m.end } : { kind: "start_end", start: m.start, end: m.end };
    }
    if (m.symbol && m.quantity && m.value && m.total) {
      result.holdings.push({ symbol: m.symbol, quantity: m.quantity, price: m.price ?? null, marketValue: m.value, total: m.total });
    }
    props.onTeach(result);
    setMarks({});
  }

  const footer = (
    <div className="statement-footer">
      <button type="button" className="modal-secondary" onClick={props.onBack} disabled={props.busy}>Back</button>
      {exhausted ? (
        <button type="button" onClick={props.onGiveUp} data-teach-give-up>Use another way</button>
      ) : (<>
        <button type="button" className="modal-secondary" onClick={undo} disabled={props.busy} data-undo-mark>Undo last click</button>
        <button type="button" onClick={submit} disabled={props.busy || current !== undefined} data-teach-submit>Check my examples</button>
      </>)}
    </div>
  );

  const prompt = current === "start" && balanceKind === "totals" ? "Click the total of money added." : current === "end" && balanceKind === "totals" ? "Click the total of money taken out." : current ? PROMPTS[current] : "That's everything. Check your examples.";

  return (
    <ModalShell title="Teach the app how to read this statement" onCancel={props.onBack} wide dismissOnOverlayClick={false} footer={footer}>
      <div className="statement-review" data-statement-teach>
        {props.error && <p className="statement-error" role="alert">{props.error}</p>}
        {exhausted ? (
          <p className="statement-banner">The app still can't read this statement. You can use your bank's CSV or OFX download, or reconcile by hand.</p>
        ) : (<>
          {props.attempts > 0 && <p className="statement-banner">That still doesn't add up. Show the app one more example.</p>}
          <p data-teach-prompt><strong>{prompt}</strong></p>
          {current === "balance_kind" && (
            <div className="statement-banner-actions">
              <button type="button" onClick={() => setBalanceKind("totals")} data-balance-kind="totals">This statement shows totals of money added and taken out</button>
              <button type="button" onClick={() => setBalanceKind("start_end")} data-balance-kind="start_end">This statement shows a cash balance at the start and end</button>
              <button type="button" className="modal-secondary" onClick={() => setBalanceKind("none")} data-balance-kind="none">This statement shows neither</button>
            </div>
          )}
          {(current === "start") && props.kind !== "investment" && (
            <button type="button" className="modal-secondary" onClick={() => setMarks((m) => ({ ...m, start: null, end: null }))} data-no-balances>This statement doesn't show these</button>
          )}
          {current === "price" && <button type="button" className="modal-secondary" onClick={() => setMarks((m) => ({ ...m, price: null }))}>It has no price</button>}
        </>)}
        <div className="statement-teach-lines">
          {props.lines.map((l) => (
            <div key={l.index} className="statement-teach-line">
              {words(l.text).map((w) => (
                <button key={w.start} type="button" className="statement-teach-word" data-line={l.index} data-start={w.start}
                  data-marked={marked.has(`${l.index}:${w.start}`) ? "" : undefined} disabled={exhausted || props.busy}
                  onClick={() => click({ line: l.index, start: w.start })}>{w.word}</button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}
```

(The expected `start: 32` in the test is the character index of "54.20" in "03/08/2026 Supermarket purchase 54.20"; `start: 16` is the index of the amount after "Opening balance " / "Closing balance ".)

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/StatementTeachDialog.test.tsx src/plainLanguage.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/StatementTeachDialog.tsx src/StatementTeachDialog.test.tsx
git commit -m "Add the teach-the-app screen for statements it can't read"
```

---

### Task 23: Wiring — Account Detail entry point, Settings list and help text

**Files:**
- Modify: `src/AccountDetailView.tsx`, `src/AccountDetailView.test.tsx`, `src/SettingsView.tsx`, `src/HelpView.tsx`
- Create: `src/StatementLayoutsSection.tsx`, `src/StatementLayoutsSection.test.tsx`

**Interfaces:**
- Consumes: `useStatementReconcile`, `StatementReviewDialog`, `StatementTeachDialog`, `addAmounts`, `validateStatementLayouts`.
- Produces: `StatementLayoutsSection({ onMessage })`.

- [ ] **Step 1: Write the failing tests**

Add to `src/AccountDetailView.test.tsx`:

```tsx
it("offers uploading a statement next to reconciling by hand", async () => {
  mockInvoke({ account_balance_history: [], list_account_transactions: [], last_reconciliation: null });
  await render(<AccountDetailView account={checkingAccount} onBack={() => {}} onOpenTransactions={() => {}} onOpenPayment={() => {}} onMessage={() => {}} />);
  const upload = container.querySelector<HTMLButtonElement>("[data-upload-statement]");
  expect(upload).not.toBeNull();
  expect(upload!.textContent).toBe("Upload a statement");
  expect(container.querySelector("[data-upload-download]")?.textContent).toBe("Use a CSV or OFX download");
  expect(upload!.disabled).toBe(true); // needs the statement's start and end dates first
});
```

`src/StatementLayoutsSection.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { StatementLayoutsSection } from "./StatementLayoutsSection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
let container: HTMLDivElement;
let root: Root;

describe("StatementLayoutsSection", () => {
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.mocked(invoke).mockReset(); });

  it("lists, renames and removes learned statements", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => (cmd === "list_statement_layouts" ? [{ id: 3, name: "Riverbend", phrases: ["Riverbend Mutual Bank"], updated_at: "2026-10-11 10:00:00" }] : null));
    await act(async () => root.render(<StatementLayoutsSection onMessage={() => {}} />));
    expect(container.textContent).toContain("Riverbend");
    expect(container.textContent).toContain("Riverbend Mutual Bank");

    await act(async () => container.querySelector<HTMLButtonElement>("[data-remove-layout='3']")!.click());
    await act(async () => container.querySelector<HTMLButtonElement>("[data-confirm-remove-layout='3']")!.click());
    expect(invoke).toHaveBeenCalledWith("delete_statement_layout", { id: 3 });
  });

  it("explains when there are none", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await act(async () => root.render(<StatementLayoutsSection onMessage={() => {}} />));
    expect(container.textContent).toContain("When you upload a statement from a new bank");
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

`src/StatementLayoutsSection.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "./errorMessage";
import { validateStatementLayouts, type StatementLayoutSummary } from "./statementContracts";

/** Settings: the statements the app has learned to read on this profile. */
export function StatementLayoutsSection({ onMessage }: { onMessage: (text: string, kind: "success" | "error" | "info") => void }) {
  const [layouts, setLayouts] = useState<StatementLayoutSummary[]>([]);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const load = useCallback(async () => setLayouts(validateStatementLayouts(await invoke("list_statement_layouts"))), []);
  useEffect(() => { load().catch((e) => onMessage(errorMessage(e), "error")); }, [load, onMessage]);

  async function act(work: () => Promise<unknown>, done: string) {
    try { await work(); await load(); onMessage(done, "success"); } catch (e) { onMessage(errorMessage(e), "error"); }
  }

  return (
    <div className="card" data-statement-layouts>
      <div className="card-head"><span className="reports-section-title">Statements the app knows how to read</span></div>
      {layouts.length === 0 ? (
        <p className="modal-message-secondary">When you upload a statement from a new bank and finish reconciling, the app remembers how to read it. Those banks show up here.</p>
      ) : (
        <ul className="feature-toggle-list">
          {layouts.map((l) => (
            <li key={l.id} className="feature-toggle-row" data-layout={l.id}>
              <span className="feature-toggle-text">
                {editing?.id === l.id ? (
                  <input value={editing.name} onChange={(e) => setEditing({ id: l.id, name: e.target.value })} aria-label="Name" data-rename-input />
                ) : (
                  <span className="feature-toggle-label">{l.name}</span>
                )}
                <span className="modal-message-secondary">Recognised by: {l.phrases.map((p) => `“${p}”`).join(", ")}</span>
              </span>
              {editing?.id === l.id ? (
                <button type="button" onClick={() => void act(() => invoke("rename_statement_layout", { id: l.id, name: editing.name }), "Renamed.").then(() => setEditing(null))}>Save</button>
              ) : (
                <button type="button" className="modal-secondary" onClick={() => setEditing({ id: l.id, name: l.name })} data-rename-layout={l.id}>Rename</button>
              )}
              {confirming === l.id ? (
                <button type="button" onClick={() => void act(() => invoke("delete_statement_layout", { id: l.id }), "Removed. The app will ask for help with this bank's next statement.").then(() => setConfirming(null))} data-confirm-remove-layout={l.id}>Yes, remove it</button>
              ) : (
                <button type="button" className="modal-secondary" onClick={() => setConfirming(l.id)} data-remove-layout={l.id}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

In `src/SettingsView.tsx`, render `<StatementLayoutsSection onMessage={onMessage} />` right after `<PrivacySection … />` (use the view's existing message callback prop; if it is named differently, pass that one).

In `src/AccountDetailView.tsx`:
- `const statement = useStatementReconcile(account.id);`
- In the reconcile card's not-reconciling form, below "Start reconciling", add:

```tsx
<div className="reconcile-upload">
  <p className="modal-message-secondary">Or let the app check your statement for you. Enter the statement's start and end dates above, then upload it.</p>
  <button type="button" disabled={!periodStart || statement.busy} onClick={() => void statement.start(periodStart, statementDate)} data-upload-statement>Upload a statement</button>
  <button type="button" className="modal-secondary" disabled={!periodStart || statement.busy} onClick={() => void statement.start(periodStart, statementDate, "download")} data-upload-download>Use a CSV or OFX download</button>
  {statement.error && statement.phase.kind === "idle" && <p className="statement-error" role="alert" data-statement-error>{statement.error}</p>}
</div>
```

- After the card, render the flow:

```tsx
{statement.phase.kind === "choose_section" && (
  <ModalShell title="Which account is this?" onCancel={statement.cancel}>
    <p className="modal-message-secondary">This statement covers more than one account. Choose the part for {account.name}.</p>
    {statement.phase.read.sections.map((s) => (
      <button key={s.index} type="button" className="modal-secondary" onClick={() => void statement.chooseSection(s.index)} data-statement-section={s.index}>
        {s.name} ({s.row_count} transactions{s.holding_count ? `, ${s.holding_count} holdings` : ""})
      </button>
    ))}
  </ModalShell>
)}
{statement.phase.kind === "review" && (
  <StatementReviewDialog
    key={statement.phase.review.token + String(statement.phase.review.flipped) + statement.phase.review.activity_check.outcome}
    review={statement.phase.review}
    accountName={account.name}
    busy={statement.busy}
    error={statement.error}
    onFlip={(f) => void statement.setFlip(f)}
    onTeach={() => void statement.openTeach()}
    onUseDownload={() => { statement.cancel(); void statement.start(periodStart, statementDate, "download"); }}
    onReconcileByHand={() => { statement.cancel(); reconcileCardRef.current?.scrollIntoView({ block: "start" }); }}
    onFinish={(d) => void statement.finish(d)}
    onCancel={statement.cancel}
  />
)}
{statement.phase.kind === "teach" && (
  <StatementTeachDialog
    lines={statement.phase.lines}
    kind={statement.phase.review.account_kind}
    attempts={statement.phase.attempts}
    busy={statement.busy}
    error={statement.error}
    needs={{
      rows: statement.phase.review.activity_check.outcome !== "passed",
      holdings: statement.phase.review.account_kind === "investment" && statement.phase.review.holdings_check.outcome === "failed",
    }}
    onTeach={(m) => void statement.teach(m)}
    onBack={statement.backToReview}
    onGiveUp={statement.backToReview}
  />
)}
```

- When `statement.phase.kind === "done"`: in an effect, call `loadOverview()`, show `onMessage(\`Reconciled ${account.name} through ${formatDisplayDate(statementDate)}.${finished.added ? \` Added ${finished.added} transaction${finished.added === 1 ? "" : "s"}.\` : ""}${finished.layout_saved ? \` The app will recognise ${finished.layout_saved} statements next time.\` : ""}\`, "success")`, then `statement.cancel()`.
- Replace the temporary "Ticked so far" arithmetic from Task 3 with `addAmounts([status.starting_point ?? "0", status.ticked_change])`.

In `src/HelpView.tsx`, add to the Accounts help a paragraph: "You can also upload your monthly statement. Enter the statement's start and end dates, choose **Upload a statement**, and the app checks each line against your transactions. Anything missing can be added with one click. If the app hasn't seen your bank's statements before, it may ask you to click a few examples — it remembers them for next time. A picture-only PDF can't be read; use your bank's CSV or OFX download instead."

- [ ] **Step 4: Run to verify pass** — `npx vitest run` (full frontend) → PASS; `npm run lint` → clean; `npx tsc --noEmit -p .` (or the project's type-check script) → clean.

- [ ] **Step 5: Commit**

```bash
git add src/AccountDetailView.tsx src/AccountDetailView.test.tsx src/SettingsView.tsx src/HelpView.tsx src/StatementLayoutsSection.tsx src/StatementLayoutsSection.test.tsx
git commit -m "Offer statement uploads on every account and list learned statements in Settings"
```

---

## Phase E — End to end, docs and the gate

### Task 24: End-to-end specs in the compiled app

**Files:**
- Create: `e2e/lib/statementPdf.mjs`, `e2e/lib/statementPdf.test.mjs`, `e2e/feature300_statement_upload.mjs`, `e2e/feature301_statement_teach.mjs`, `e2e/feature302_statement_investment.mjs`

**Interfaces:**
- Consumes: `launchApp`, `stubFilePicker`, `waitUntilOrDiagnose` (`e2e/harness.mjs`), `seedFixture` (`e2e/lib/seed.mjs`), `isoDaysFromNow` and helpers (`e2e/lib/dates.mjs`), `makeTempDir` (`e2e/lib/tempDir.mjs`).
- Produces: `buildPdf(pages: string[][]): Buffer` (same output shape as the Rust writer), and statement builders with **relative** dates: `checkingStatement({ start, end, opening, rows })`, `unknownBankStatement({ start, end, opening, rows })`, `unknownBrokerageStatement({ start, end, beginningCash, rows, holdings })`.

- [ ] **Step 1: Write the helper test** — `e2e/lib/statementPdf.test.mjs` (runs under vitest with the harness unit tests):

```js
import { describe, expect, it } from "vitest";
import { buildPdf } from "./statementPdf.mjs";

describe("statement PDF writer", () => {
  it("writes a cross-reference table where startxref points", () => {
    const pdf = buildPdf([["Hello (world)", "Second"]]).toString("latin1");
    const at = Number(pdf.split("startxref\n")[1].split("\n")[0]);
    expect(pdf.slice(at, at + 4)).toBe("xref");
    expect(pdf).toContain("(Hello \\(world\\)) Tj");
  });
});
```

- [ ] **Step 2: Implement** `e2e/lib/statementPdf.mjs` — a line-for-line port of `build_pdf` from Task 7 (same objects, `Tm` per line, escaping, offsets), plus the three builders. Dates come from the caller (`isoDaysFromNow`), formatted by the builder: checking uses `MM/DD/YYYY` with "Beginning Balance"/"Ending Balance"; the unknown bank uses `DD/MM/YYYY`, money out positive and money in with ` CR`, headed "Riverbend Mutual Bank"; the brokerage uses `MM/DD/YYYY`, "Beginning Cash Balance"/"Ending Cash Balance", a "Holdings" table with four-decimal quantities and two-decimal prices, and "Total Market Value", headed "Harborview Investing". Each builder computes its own closing balances from the rows so the statement always adds up.

- [ ] **Step 3: Write `e2e/feature300_statement_upload.mjs`** — known-shape checking statement, automatic learning, and pick-up-from-last-time:
  1. Seed a checking account ("Everyday Checking", starting balance `1000.00`) with two transactions inside last month's period (one of them on the statement, one not), using `isoDaysFromNow`.
  2. Write two statements with `checkingStatement`: month A (rows: the seeded one, plus one that isn't in the app) and month B (one new row).
  3. Accounts → Details → set "Statement start date" and "Statement end date" to month A, `stubFilePicker(browser, [pathA])`, click `[data-upload-statement]`.
  4. In `[data-statement-review]`: assert one `[data-choice="match"]` row and one `[data-choice="add"]` row; assert `[data-not-on-statement]` lists the seeded row that isn't on the statement; type the starting balance into `[data-statement-review-start]`; wait for `[data-difference][data-balanced="true"]`; leave **Remember** ticked; click `[data-statement-finish]`.
  5. Assert the success toast mentions "recognise" and `[data-last-reconciled]` shows month A's end date.
  6. Set month B's dates, `stubFilePicker(browser, [pathB])`, upload: assert the review shows "Read using:" (recognised), **no** `[data-statement-review-start]` (picks up from last time), and the difference balances after the default Add; finish.
  7. Settings → assert `[data-statement-layouts]` lists the learned statement; remove it via `[data-remove-layout]` → `[data-confirm-remove-layout]`.
  8. Take screenshots of both review screens when `VAULTSPEND_E2E_SHOTS` is set, and **look at them** before calling the task done.

- [ ] **Step 4: Write `e2e/feature301_statement_teach.mjs`** — unknown bank:
  1. Seed "Riverbend Checking" with nothing; write two `unknownBankStatement` months.
  2. Upload month 1: assert `[data-needs-help]` with "Some of this statement couldn't be read." and buttons `[data-teach]`, `[data-use-download]`, `[data-reconcile-by-hand]`.
  3. Click `[data-teach]`; click, in order, the first transaction's date word, its amount word, the opening balance amount and the closing balance amount (`[data-line][data-start]` buttons found by text); click `[data-teach-submit]`.
  4. Assert the review now shows the activity check passed (no `[data-needs-help]`), every row defaults to Add, the starting balance is prefilled, the difference balances, `[data-remember]` is shown with "Riverbend Mutual Bank" ticked; finish.
  5. Upload month 2: assert it is recognised (`Read using: Riverbend…`), no teaching, finish.
  6. Also assert a picture-only PDF (`buildPdf([[]])`) shows `[data-statement-error]` containing "picture of the statement".

- [ ] **Step 5: Write `e2e/feature302_statement_investment.mjs`** — unknown brokerage with share counts:
  1. Seed an investment account "Harborview Brokerage" with holding `QQQZ` at 10 shares (via the seed's SQL into `holdings`), and the deposit transaction for month 1 already in the app.
  2. Upload month 1: assert the activity check passes, `[data-holdings]` shows "The app couldn't read your holdings correctly."; click `[data-teach-holdings]`, mark QQQZ's symbol, quantity, price, value and the "Total Market Value" amount; submit.
  3. Assert `[data-holding="QQQZ"][data-holding-status="different"]` and `[data-holding="VTIZ"][data-holding-status="missing_in_app"]`; keep "Update the app to 10.5 shares"; choose **Add this holding** for VTIZ and type a cost basis into `[data-cost-basis]`; resolve the activity rows; finish.
  4. Open Investments and assert QQQZ shows 10.5 shares and VTIZ exists.
  5. Upload month 2: assert recognised, holdings read without teaching (`[data-holding-status="same"]` for both), finish.

- [ ] **Step 6: Run** (PowerShell, after building per the Global Constraints):

```powershell
npx vitest run e2e/lib/statementPdf.test.mjs
cargo build --workspace --bins; npx tauri build --debug --no-bundle
node e2e/run-all.mjs --spec=80,300,301,302 > "$env:TEMP\vs-e2e-statement.log" 2>&1; Get-Content "$env:TEMP\vs-e2e-statement.log" -Tail 40
```

Expected: 4/4 pass. Look at every screenshot taken.

- [ ] **Step 7: Commit**

```bash
git add e2e/lib/statementPdf.mjs e2e/lib/statementPdf.test.mjs e2e/feature300_statement_upload.mjs e2e/feature301_statement_teach.mjs e2e/feature302_statement_investment.mjs
git commit -m "Add end-to-end specs for statement upload, teaching and investment share counts"
```

---

### Task 25: Contract doc, full gate and owner acceptance

**Files:**
- Create: `docs/STATEMENT-RECONCILE.md`
- Modify: `docs/ARCHITECTURE.md` (link it from the financial/IPC owners list), `docs/THIRD-PARTY-NOTICES.txt` (if not done in Task 8)

- [ ] **Step 1: Write `docs/STATEMENT-RECONCILE.md`** covering, briefly and in this order: purpose; the shared balance rule and `reconciliation_id`; the reader pipeline (`pdf_text` → `sections`/`rows`/`holdings` → `checks` → `select`) and the content-order rule; the layout format and its safety limits (closed options, 16 KiB, `is_safe_phrase`); learning (automatic, teaching, corrections) and where learned layouts live; matching rules (exact amount, 3/10/7-day windows, one-to-one, flip suggestion); investment reconciliation (activity + share counts, `holdings_checked`); the review session (generation, signature, 10 minutes, in-memory lines); privacy (no copies, no logs, nothing leaves the computer, real statements never committed); tests and the local-only `real_statement_check` example with its `periods.txt` format.

- [ ] **Step 2: Run the full gate** (PowerShell), capturing each output to a file under `$env:TEMP`:

```powershell
npx vitest run
npm run lint
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
cargo build --workspace --bins; npx tauri build --debug --no-bundle
node e2e/run-all.mjs > "$env:TEMP\vs-e2e-full.log" 2>&1
```

Expected: all pass, full desktop E2E N/N. A failure is fixed (never deferred), and the whole gate re-run.

- [ ] **Step 3: Re-run the real-statement check** (Task 13 Step 7) on the final code, with and without `--no-builtins`; keep the count summaries for the report.

- [ ] **Step 4: Owner acceptance (UAT)** — build the UAT page from `E:\misc\Programming\Claude\uat-template\` (`build-uat-page.py statement-reconcile`), staged in the scratchpad, with Do → Expect checks and screenshots for: manual reconcile on a credit card (first time asks for the starting amount owed, second time picks up); uploading each of the owner's real statements against a **copy** of the real profile database (never the original); teaching an unknown statement; an investment statement's share counts; Settings list; a scanned PDF message. Publish it and ask the owner to mark Pass/Fail and sign off. Zero false matches on the owner's statements is a sign-off criterion.

- [ ] **Step 5: Commit**

```bash
git add docs/STATEMENT-RECONCILE.md docs/ARCHITECTURE.md docs/THIRD-PARTY-NOTICES.txt
git commit -m "Document statement reconciling"
```

---

## Self-review notes (for the plan author; kept for reviewers)

- **Spec coverage:** goal/success → Tasks 13, 24, 25; PDF + download inputs → 8, 19; one-click add → 18, 19, 21; all account types → 2, 3; exact $0.00 → 2, 18, 21; layouts as data → 4, 13; learning automatic/teach/corrections → 14, 15, 19, 21, 22 (corrections are teaching marks sent from the review via the Teach button; a learned layout is updated in place via `LayoutOrigin::Learned`); no sharing → absent by design; pick-up balance rule → 1, 2; investments activity + shares + holdings learning → 11, 12, 15, 18, 19, 21, 22; data flow/commands/token → 19; errors → 8, 19, 21; privacy → 8, 19, 25; tests → every task plus 24; out of scope respected.
- **Deliberate narrowing:** the teach screen asks for a transaction's date and amount (the description is whatever lies between), rather than a separate description click; the derivation never needs it.
- **Types used across tasks:** `AccountKind` (Task 2, re-exported in 16), `Period`/`StatementRow`/`StatementSection` (4), `Money` (6), `LayoutOrigin`/`Reading` (14), `TeachMarks`/`TextRef` (15, mirrored in TS 20), `CandidateTx`/`StatementFinish` (18), DTO names (19, mirrored in 20).
