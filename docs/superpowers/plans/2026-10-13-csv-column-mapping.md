# CSV Column Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a CSV transactions file's headers aren't recognised, let the person say which column is the date, description and amount (or debit/credit) instead of the import failing with "missing required column", and remember that choice for the account.

**Architecture:** `csv_loader` gains a `ColumnMap` (column indexes) that, when given, replaces its by-name lookup, plus `inspect_csv` (headers, sample rows, what is missing). A saved map is stored per account as header *names* (`accounts.import_columns`), re-resolved against each new file's headers. One new command, `inspect_import_columns`, runs before the existing "Which way do the amounts go?" question; the chosen map is then threaded through `count_import_signs`, `preview_import` and `commit_import` (commit saves it in the same transaction as the sign preference). A new `ColumnMappingDialog` follows the existing `confirmInvert` promise-dialog pattern in `App.tsx`.

**Tech Stack:** Rust 2024 (`budget_core`, rusqlite, serde/serde_json, csv), Tauri v2 commands, React 19 + TypeScript, vitest, the WebDriver e2e harness.

**Spec:** the design agreed in chat on 2026-10-13 (bounded path, no spec file), restated here:
- CSV only. OFX/QFX/QIF are fixed formats and never ask.
- Trigger: a CSV whose date, description or amount (or debit+credit) column can't be found by name. A headerless file (first row is date, text, amount) is recognised today and never asks.
- "Match your columns" window: a dropdown per field, a live preview of the first rows, Import-continue disabled until date, description and amount are set, a toggle for separate debit/credit columns, Cancel changes nothing.
- Remembered per account, by header names; a later file whose headers still contain those names imports without asking; otherwise the window opens again with the guesses filled in.
- Out of scope: new date formats (loader still reads only `YYYY-MM-DD` and `M/D/YYYY`; other dates are rejected row by row as today), mapping for other file types, a per-bank store.

## Global Constraints

- Plain-language copy for non-financially-literate users: no jargon ("Which column has the date?", not "Map the date field").
- No behaviour change for any file the loader reads today: with no map, `load_csv` must behave exactly as now (existing csv_loader tests unchanged and green).
- Amounts: negative = money out. A map never changes sign handling; the existing flip question still applies.
- Money is `rust_decimal::Decimal`; dates `chrono::NaiveDate`. Source files are CRLF on Windows: use the Edit tool or `crlf_edit.py`; never rewrite whole files with a heredoc.
- Tests first for every change; run the full suite (`npx vitest run`, `cargo test --workspace`, then `node e2e/run-all.mjs`, never a sequential loop) before calling the work done.
- Never use real statements or real bank files in tests or the repo; fixtures are made-up.
- No push or merge without the owner.

## Review Focus

- A saved mapping whose column indexes are out of range for a new file (file has fewer columns): refuse with a plain message, never panic, never read the wrong column.
- Two fields mapped to the same column (date and description both column 1): the dialog must block it.
- A mapped amount column containing blanks or text on some rows: those rows are reported as bad rows with their line numbers; the rest import.
- A file with a header row where the amount column header is blank or duplicated ("Amount,Amount"): the picker must still list both as distinct options (labelled with their position) and the mapping must use the chosen index.
- Cancelling the window, or closing the app mid-way: nothing is saved and nothing imported; the saved mapping is only written when the import itself commits.
- Review token: the review token depends on the loaded rows, so preview and commit must load with the *same* map or the import is refused as "This file changed."

---

### Task 1: Column map and inspection in the CSV loader

**Files:**
- Modify: `core/src/csv_loader.rs`
- Modify: `core/src/importer.rs`
- Modify: `src-tauri/src/commands/import.rs` (3 call sites), `src-tauri/src/commands/statements.rs:343` (1 call site)
- Test: `core/src/csv_loader.rs` (its `tests` module), `core/src/importer.rs` tests

**Interfaces:**
- Produces (all `pub`, serde-derived so Tauri can pass them):
  - `enum AmountColumns { Single { column: usize }, DebitCredit { debit: usize, credit: usize } }` — `#[serde(tag = "kind", rename_all = "snake_case")]`
  - `struct ColumnMap { date: usize, description: usize, amount: AmountColumns, category: Option<usize> }` — `#[serde(default)]` on `category`
  - `struct CsvInspection { headers: Vec<String>, sample_rows: Vec<Vec<String>>, missing: Vec<String>, guess: ColumnGuess }` where `ColumnGuess` is `ColumnGuess { date: Option<usize>, description: Option<usize>, amount: Option<usize>, debit: Option<usize>, credit: Option<usize> }`; `missing` holds any of `"date"`, `"description"`, `"amount"`; a headerless file reports `missing: []` and `headers: []`
  - `fn inspect_csv(path: impl AsRef<Path>) -> std::io::Result<CsvInspection>`
  - `fn load_csv_with(path: impl AsRef<Path>, invert_amounts: bool, map: Option<&ColumnMap>) -> std::io::Result<LoadResult>`; `load_csv(path, invert)` becomes `load_csv_with(path, invert, None)`
  - `importer::load_transactions(path, invert_amounts, map: Option<&ColumnMap>)` (third parameter added; the map is ignored for OFX/QFX/QIF)

- [ ] **Step 1: Write the failing tests** in the `tests` module of `csv_loader.rs`:

```rust
#[test]
fn a_map_replaces_the_by_name_lookup() {
    let csv = "Posted,Memo,Amt\n2026-08-05,Coffee,-4.50\n2026-08-06,Pay,100.00\n";
    let map = ColumnMap { date: 0, description: 1, amount: AmountColumns::Single { column: 2 }, category: None };
    let result = load_from_reader_with(csv.as_bytes(), false, Some(&map)).unwrap();
    assert_eq!(result.transactions.len(), 2);
    assert_eq!(result.transactions[0].description, "Coffee");
    assert_eq!(result.transactions[1].amount, Decimal::from_str("100.00").unwrap());
}

#[test]
fn a_map_can_use_separate_debit_and_credit_columns() {
    let csv = "When,What,Out,In\n2026-08-05,Coffee,4.50,\n2026-08-06,Pay,,100.00\n";
    let map = ColumnMap { date: 0, description: 1, amount: AmountColumns::DebitCredit { debit: 2, credit: 3 }, category: None };
    let result = load_from_reader_with(csv.as_bytes(), false, Some(&map)).unwrap();
    assert_eq!(result.transactions[0].amount, Decimal::from_str("-4.50").unwrap());
    assert_eq!(result.transactions[1].amount, Decimal::from_str("100.00").unwrap());
}

#[test]
fn a_map_pointing_past_the_end_of_the_file_is_refused_plainly() {
    let csv = "Posted,Memo\n2026-08-05,Coffee\n";
    let map = ColumnMap { date: 0, description: 1, amount: AmountColumns::Single { column: 5 }, category: None };
    let err = load_from_reader_with(csv.as_bytes(), false, Some(&map)).unwrap_err();
    assert!(err.to_string().contains("column"), "{err}");
}

#[test]
fn a_bad_cell_in_a_mapped_column_is_a_row_error_and_the_rest_import() {
    let csv = "Posted,Memo,Amt\n2026-08-05,Coffee,-4.50\n2026-08-06,Pay,oops\n";
    let map = ColumnMap { date: 0, description: 1, amount: AmountColumns::Single { column: 2 }, category: None };
    let result = load_from_reader_with(csv.as_bytes(), false, Some(&map)).unwrap();
    assert_eq!(result.transactions.len(), 1);
    assert_eq!(result.errors[0].row_number, 3);
}

#[test]
fn inspecting_a_file_with_unknown_headers_lists_what_is_missing() {
    let csv = "Posted,Memo,Amt\n2026-08-05,Coffee,-4.50\n";
    let found = inspect_reader(csv.as_bytes()).unwrap();
    assert_eq!(found.headers, vec!["Posted", "Memo", "Amt"]);
    assert_eq!(found.missing, vec!["description", "amount"]);
    assert_eq!(found.guess.date, None, "'Posted' has no 'date' in it, so nothing is guessed for the date");
}

#[test]
fn inspecting_a_recognised_file_reports_nothing_missing() {
    let csv = "Date,Description,Amount\n2026-08-05,Coffee,-4.50\n";
    assert!(inspect_reader(csv.as_bytes()).unwrap().missing.is_empty());
}

#[test]
fn inspecting_a_headerless_file_reports_nothing_missing() {
    let csv = "2026-08-05,Coffee,-4.50\n";
    let found = inspect_reader(csv.as_bytes()).unwrap();
    assert!(found.missing.is_empty() && found.headers.is_empty());
}

#[test]
fn inspecting_keeps_only_the_first_five_sample_rows() {
    let mut csv = String::from("Posted,Memo,Amt\n");
    for d in 1..=9 {
        csv.push_str(&format!("2026-08-0{d},Row {d},-1.00\n"));
    }
    assert_eq!(inspect_reader(csv.as_bytes()).unwrap().sample_rows.len(), 5);
}
```
- [ ] **Step 2: Run to verify they fail** — `cargo test -p budget_core csv_loader` — Expected: compile errors (`ColumnMap`, `load_from_reader_with`, `inspect_reader` undefined).

- [ ] **Step 3: Implement.** In `csv_loader.rs`:
  - Add `use serde::{Deserialize, Serialize};` and the three types above with `#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]` (`CsvInspection` and `ColumnGuess` derive `Serialize` only).
  - Rename the body of `load_from_reader` to `load_from_reader_with(reader, invert_amounts, map: Option<&ColumnMap>)`; keep `load_from_reader(reader, invert)` as a one-line wrapper passing `None` so existing tests compile. In the header branch, when `map` is `Some`, skip the by-name lookups and build `(date_col, description_col, amount_source, extra, &rows[1..], 2)` from the map (`extra.category = map.category`; account/tags/notes still found by name). A mapped file always treats row 1 as the header (the person chose columns from a header list). Before reading rows, check every mapped index is `< first_row.len()` and return `std::io::Error::new(InvalidData, "The columns you picked aren't all in this file. Pick them again.")` otherwise.
  - Add `inspect_reader` (private) and `pub fn inspect_csv(path)` = `inspect_reader(File::open(path)?)`. `inspect_reader` reads all records (as the loader does), returns the empty-headers/empty-missing result for an empty or headerless file, and otherwise fills `headers` (trimmed), `sample_rows` (next 5 records, each cell trimmed), `guess` from the existing `find_date_column` / `find_column_exact` helpers (each `.ok()`/`Option`), and `missing` for each of date, description, and amount-or-(debit and credit) not found.
  - Add `pub fn load_csv_with(path, invert, map)` and make `load_csv` call it with `None`.
  - In `importer.rs` change `load_transactions` to take `map: Option<&ColumnMap>` and pass it to `csv_loader::load_csv_with`; OFX/QIF arms ignore it. Update the four calls in `importer.rs` tests to pass `None`.
  - Update the call sites `src-tauri/src/commands/import.rs:137,160,303` and `src-tauri/src/commands/statements.rs:343` to pass `None` for now.

- [ ] **Step 4: Run** `cargo test --workspace` — Expected: all pass, including every existing csv_loader test unchanged.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "Let the CSV loader read columns by position when given a column map"`

---

### Task 2: Remember a column choice per account

**Files:**
- Create: `core/src/store/import_columns.rs` (store functions, migration, tests)
- Modify: `core/src/store.rs` (add `mod import_columns;`), `core/src/store/schema.rs` (call the migration next to `migrate_add_account_import_flip_signs_if_missing`), `core/src/csv_loader.rs` (names type)
- Modify: `core/src/store/imports.rs` (`ImportBatch.column_names`)

**Interfaces:**
- Consumes: `ColumnMap`, `AmountColumns`, `CsvInspection.headers` from Task 1.
- Produces:
  - `struct ColumnNames { date: String, description: String, amount: AmountNames, category: Option<String> }`, `enum AmountNames { Single { column: String }, DebitCredit { debit: String, credit: String } }` (serde, `tag = "kind"`) in `csv_loader.rs`
  - `ColumnMap::names(&self, headers: &[String]) -> Option<ColumnNames>` (None when an index is out of range)
  - `ColumnNames::resolve(&self, headers: &[String]) -> Option<ColumnMap>` — each name matched with `trim().eq_ignore_ascii_case`, first match wins; `None` unless every name is found
  - `Store::set_account_import_columns(&self, account_id: i64, names: &ColumnNames) -> rusqlite::Result<()>`
  - `Store::account_import_columns(&self, account_id: i64) -> rusqlite::Result<Option<ColumnNames>>` (a malformed stored value reads as `None`)
  - `ImportBatch.column_names: Option<(i64, ColumnNames)>`, written inside `commit_import_batch` next to `sign_preference`

- [ ] **Step 1: Write the failing tests** (in `import_columns.rs` `tests`, using `Store::open_in_memory()` and `get_or_create_account` like the neighbouring `sign_flip.rs` tests):

```rust
#[test]
fn a_saved_choice_round_trips_by_header_name() {
    let store = Store::open_in_memory().unwrap();
    let acct = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    assert_eq!(store.account_import_columns(acct).unwrap(), None);
    let names = ColumnNames { date: "Posted".into(), description: "Memo".into(), amount: AmountNames::Single { column: "Amt".into() }, category: None };
    store.set_account_import_columns(acct, &names).unwrap();
    assert_eq!(store.account_import_columns(acct).unwrap(), Some(names));
}

#[test]
fn a_saved_choice_resolves_against_a_reordered_file() {
    let names = ColumnNames { date: "Posted".into(), description: "Memo".into(), amount: AmountNames::Single { column: "Amt".into() }, category: None };
    let headers: Vec<String> = ["amt", "Memo", "Extra", " posted "].iter().map(|s| s.to_string()).collect();
    let map = names.resolve(&headers).unwrap();
    assert_eq!((map.date, map.description), (3, 1));
    assert_eq!(map.amount, AmountColumns::Single { column: 0 });
}

#[test]
fn a_saved_choice_does_not_resolve_when_a_header_is_gone() {
    let names = ColumnNames { date: "Posted".into(), description: "Memo".into(), amount: AmountNames::Single { column: "Amt".into() }, category: None };
    let headers: Vec<String> = ["Posted", "Memo"].iter().map(|s| s.to_string()).collect();
    assert_eq!(names.resolve(&headers), None);
}

#[test]
fn an_unreadable_stored_value_reads_as_no_choice() {
    let store = Store::open_in_memory().unwrap();
    let acct = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    store.conn.execute("UPDATE accounts SET import_columns = 'not json' WHERE id = ?1", [acct]).unwrap();
    assert_eq!(store.account_import_columns(acct).unwrap(), None);
}

#[test]
fn the_column_is_added_to_an_older_database_and_the_migration_is_idempotent() {
    let store = Store::open_in_memory().unwrap();
    store.conn.execute("ALTER TABLE accounts DROP COLUMN import_columns", []).unwrap();
    store.migrate_add_account_import_columns_if_missing().unwrap();
    store.migrate_add_account_import_columns_if_missing().unwrap();
}
```

- [ ] **Step 2: Run** `cargo test -p budget_core import_columns` — Expected: FAIL (items undefined).

- [ ] **Step 3: Implement** the types and the two conversions in `csv_loader.rs`; in `import_columns.rs` copy the shape of `sign_flip.rs`'s `set_account_import_flip_signs` and `migrate_add_account_import_flip_signs_if_missing` with `import_columns TEXT` (nullable), storing `serde_json::to_string(names)` and reading with `serde_json::from_str(..).ok()`. Register the migration in `schema.rs` after `migrate_add_account_import_flip_signs_if_missing()?;`. In `imports.rs` add the `column_names` field to `ImportBatch` (it derives `Default`, so existing constructors using `..ImportBatch::default()` still compile) and, in `commit_import_batch` right after the `sign_preference` block, `if let Some((account_id, names)) = &batch.column_names { self.set_account_import_columns(*account_id, names)?; }`. Add a test in `imports.rs`'s tests that a committed batch with `column_names: Some(..)` stores them and that a batch that fails (e.g. unknown category) stores nothing.

- [ ] **Step 4: Run** `cargo test --workspace` — Expected: all pass.

- [ ] **Step 5: Commit** — `git commit -am "Remember a CSV column choice per account"` (after `git add -A`).

---

### Task 3: Commands — inspect, thread the map, save on commit

**Files:**
- Modify: `src-tauri/src/commands/import.rs`, `src-tauri/src/lib.rs` (register `commands::inspect_import_columns`; keep the registration list order the neighbours use), `src/mutationFreshness.ts` only if it lists `commit_import` params (it does not; no change expected)
- Test: `src-tauri/src/commands/import.rs` `tests` module (use the same helpers the existing `commit_import_for` / `preview_import_for` tests use)

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces:
  - `#[derive(Serialize)] struct ColumnInspectionDto { status: String /* "ok" | "saved" | "needs_mapping" */, headers: Vec<String>, sample_rows: Vec<Vec<String>>, missing: Vec<String>, guess: ColumnGuess, map: Option<ColumnMap> }`
  - `#[tauri::command] fn inspect_import_columns(path: String, account_id: i64, state) -> Result<ColumnInspectionDto, String>` — non-CSV extension or nothing missing → `status: "ok"`, `map: None`; something missing and the account's saved names resolve against the file's headers → `status: "saved"`, `map: Some(resolved)`; otherwise `status: "needs_mapping"`, `map: None`
  - `count_import_signs(path, column_map: Option<ColumnMap>)`, `preview_import(path, invert_amounts, account_id, column_map: Option<ColumnMap>, state)`, `commit_import(..., column_map: Option<ColumnMap>, ...)`, and `CommitImportRequest.column_map: Option<ColumnMap>`
  - In `commit_import_for`: when `req.column_map` is `Some`, inspect the file's headers (`csv_loader::inspect_csv`), compute `names = map.names(&headers)` and set `batch.column_names = Some((req.default_account_id, names))`

- [ ] **Step 1: Write the failing tests** (write a small temp-CSV helper beside the existing ones):
  1. `inspect_reports_ok_for_a_recognised_csv` — standard headers → `status "ok"`.
  2. `inspect_reports_needs_mapping_for_unknown_headers` — headers `Posted,Memo,Amt` → `"needs_mapping"`, `missing == ["description","amount"]`, 5-row cap holds.
  3. `inspect_applies_a_saved_choice_when_the_headers_still_match` — save names with `set_account_import_columns`, inspect → `"saved"` and `map` indexes match; and after changing a header name in the file → `"needs_mapping"` again.
  4. `inspect_treats_other_file_types_as_ok` — a `.ofx` path → `"ok"`.
  5. `preview_and_commit_with_the_same_map_agree_on_the_review_token` — preview with a map, commit with the same map succeeds; commit with `None` on that file errors (missing column), never imports wrong columns.
  6. `committing_with_a_map_saves_it_for_the_account` — after commit, `account_import_columns(acct)` equals the names; a failed commit (stale token) saves nothing.

- [ ] **Step 2: Run** `cargo test -p vaultspend inspect_` — Expected: FAIL (command missing).

- [ ] **Step 3: Implement** per the interfaces. Reuse `csv_loader::inspect_csv` for the CSV case, decided by extension exactly as `importer::load_transactions` does (anything that isn't `ofx`/`qfx`/`qif` is CSV). Pass `column_map.as_ref()` to every `importer::load_transactions` call in this file. Convert `io::Error` to the user string with `e.to_string()` as today.

- [ ] **Step 4: Run** `cargo test --workspace` and `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all -- --check` — Expected: clean.

- [ ] **Step 5: Commit** — `git commit -am "Add inspect_import_columns and carry the column choice through the import"`.

---

### Task 4: The "Match your columns" window and import flow

**Files:**
- Create: `src/columnMapping.ts` (types + pure helpers), `src/ColumnMappingDialog.tsx`, `src/ColumnMappingDialog.css` (or the nearest existing dialog stylesheet, following `ConfirmInvertDialog`)
- Modify: `src/appTypes.ts` (`PendingDialog` gains `{ kind: "columnMapping"; resolve: (map: ColumnMap | null) => void; inspection: ColumnInspection }`, `PendingImport.columnMap: ColumnMap | null`), `src/App.tsx` (`askColumnMap`, `handleImport`, render), `src/useImportReview.ts` (`begin(path, invertAmounts, accountId, columnMap)`; send `columnMap` in both `preview_import` calls and in `commit_import`)
- Test: `src/columnMapping.test.ts`, `src/ColumnMappingDialog.test.tsx`, update `src/useImportReview` tests that assert the invoke arguments

**Interfaces:**
- Consumes: the command shapes from Task 3 (snake_case fields as serialised; invoke argument keys are camelCase: `columnMap`).
- Produces in `columnMapping.ts`:
  - `type AmountColumns = { kind: "single"; column: number } | { kind: "debit_credit"; debit: number; credit: number }`
  - `type ColumnMap = { date: number; description: number; amount: AmountColumns; category?: number | null }`
  - `type ColumnInspection = { status: "ok" | "saved" | "needs_mapping"; headers: string[]; sample_rows: string[][]; missing: string[]; guess: { date: number | null; description: number | null; amount: number | null; debit: number | null; credit: number | null }; map: ColumnMap | null }`
  - `type Draft = { date: number | null; description: number | null; split: boolean; amount: number | null; debit: number | null; credit: number | null }`
  - `draftFromGuess(inspection): Draft` (fills `split` true when `debit` and `credit` were guessed and `amount` was not)
  - `draftProblem(draft): string | null` — plain-language reason the draft can't be used yet ("Pick the column that has the date." / "…the description." / "…the amount." / "Each field needs its own column." when two fields share a column), else `null`
  - `toColumnMap(draft): ColumnMap` (throws if `draftProblem` is non-null)
  - `columnLabel(headers, index): string` — the header text, or "Column N" for an empty header, with " (column N)" appended to a header text that appears more than once

- [ ] **Step 1: Write the failing tests.**
  - `columnMapping.test.ts`: `draftFromGuess` fills guessed columns and sets `split` for debit/credit; `draftProblem` returns each message for a missing date/description/amount, the shared-column message when date and description are both 1, and `null` for a complete draft; `toColumnMap` builds both amount shapes and throws on an incomplete draft; `columnLabel` shows "Column 2" for a blank header and disambiguates duplicate headers ("Amount (column 3)", "Amount (column 5)").
  - `ColumnMappingDialog.test.tsx` (jsdom, same harness as `ConfirmInvertDialog` tests): renders a dropdown labelled "Which column has the date?", "…the description?", "…the amount?"; the preview table shows the file's headers and the sample rows; the Continue button is disabled until the draft is complete and shows the draft's `draftProblem` text as the reason; picking columns enables it and clicking calls `onConfirm` with the `ColumnMap`; ticking "Money in and money out are in separate columns" swaps the amount dropdown for "money out" and "money in" dropdowns; Cancel calls `onCancel` and never `onConfirm`; Escape cancels; the first dropdown has focus on open.
  - `useImportReview` tests: `begin` passes `columnMap` to `preview_import`, and the retry preview and `commit_import` pass the same `columnMap`.

- [ ] **Step 2: Run** `npx vitest run src/columnMapping.test.ts src/ColumnMappingDialog.test.tsx` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement.** Copy the layout/markup conventions (modal panel, `modal-secondary`/primary buttons, focus handling, Escape) from `ConfirmInvertDialog` (find it with `grep -rn "ConfirmInvertDialog" src`). Copy text, in this order: title "Match your columns"; body "We couldn't tell which columns in this file are the date, the description and the amount. Pick them below. We'll remember your choice for {account name}."; the three questions above; the preview caption "The first rows of your file"; buttons "Cancel" and "Continue". In `App.tsx`:
  ```ts
  function askColumnMap(inspection: ColumnInspection): Promise<ColumnMap | null> {
    return new Promise((resolve) => setDialog({ kind: "columnMapping", resolve, inspection }));
  }
  ```
  and in `handleImport`, after the file is chosen and before `count_import_signs`:
  ```ts
  let columnMap: ColumnMap | null = null;
  const inspection = await invoke<ColumnInspection>("inspect_import_columns", { path, accountId }).catch(() => null);
  if (inspection?.status === "saved") columnMap = inspection.map;
  if (inspection?.status === "needs_mapping") {
    columnMap = await askColumnMap(inspection);
    if (!columnMap) return; // cancelled: nothing read, nothing saved
  }
  const counts = await invoke<ImportSignCounts>("count_import_signs", { path, columnMap }).catch(() => null);
  ```
  then pass `columnMap` to `importReview.begin(path, invertAmounts, accountId, columnMap)`. If `inspect_import_columns` itself fails, fall through with `columnMap = null` so the old error message still appears from the import. Render the dialog next to `confirmInvert` (resolve with the map or `null`, then `setDialog(null)`), passing the account name for the body text.

- [ ] **Step 4: Run** `npx vitest run`, `npx tsc --noEmit`, `npm run lint` — Expected: all pass, 0 lint errors.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "Ask which columns are which when a CSV's headers aren't recognised"`.

---

### Task 5: End-to-end spec, docs and the full gate

**Files:**
- Create: `e2e/feature303_csv_column_mapping.mjs` (use the next free number; check `ls e2e | sort -V | tail`), a made-up CSV written to a temp dir by the spec itself
- Modify: `docs/CSV-EXPORT.md` only if it describes import (check; otherwise add a short "Importing a file with unfamiliar headers" section to the Help text that already documents Import — find it with `grep -rn "Which way do the amounts go" src docs`), `e2e/README.md` if it lists specs

- [ ] **Step 1: Write the spec.** Seed one checking account (`seedFixture`, as in `e2e/feature300_statement_upload.mjs`). Write `bank.csv` with headers `Posted,Memo,Amt` and three made-up rows. Drive the import through the existing helpers used by `feature164_import_review_dialogs.mjs` (find how it chooses a file; the native picker can't be driven, so follow that spec's mechanism). Assert: (1) the "Match your columns" window opens instead of an error; Continue is disabled; (2) after picking date/description/amount it enables and the normal review lists the three rows with the right amounts; (3) importing succeeds; (4) importing a second file with the same headers goes straight to the review with no window; (5) a third file with a renamed header (`Memo` → `Details`) opens the window again with the other fields pre-filled; (6) Cancel on the window imports nothing and leaves the account unchanged.

- [ ] **Step 2: Run** `node e2e/feature303_csv_column_mapping.mjs` — expected to FAIL first if run before Tasks 1-4 are built into the desktop binary; run after `cargo build --workspace --bins; npx tauri build --debug --no-bundle`. Expected: PASS.

- [ ] **Step 3: Full gate** (PowerShell, outputs to `$env:TEMP`): `npx vitest run`, `npm run lint`, `npx tsc --noEmit`, `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all -- --check`, then `node e2e/run-all.mjs` (all specs, parallel). A failure is fixed, never deferred, and the gate re-run.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "Test and document CSV column mapping"`.

---

## Self-review

- **Spec coverage:** trigger (Task 3 `status`), window with preview/validation/debit-credit/cancel (Task 4), remembered per account by names (Task 2, saved on commit in Task 3), CSV-only (Task 1 importer ignores the map for other types; Task 3 `"ok"` for other extensions), no behaviour change without a map (Task 1 wrapper + unchanged tests). Out-of-scope items are stated in the Spec section.
- **Placeholders:** none. The e2e file-choosing mechanism is named by reference to the existing spec to copy.
- **Type consistency:** `ColumnMap`/`AmountColumns` (Task 1) → `ColumnNames`/`AmountNames` (Task 2) → `ColumnInspectionDto.map` (Task 3) → TS `ColumnMap`/`ColumnInspection` (Task 4); the invoke argument is `columnMap` everywhere and the Rust parameter `column_map`.
