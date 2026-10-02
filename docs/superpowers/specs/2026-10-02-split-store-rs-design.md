# Split `core/src/store.rs` into feature modules (L7, part 1)

**Date:** 2026-10-02 · **Branch:** `release-1.2.9` · **Source:** FQA/SQA review finding L7 ("Very large files").

## Goal

`core/src/store.rs` is 21,115 lines: ~1,000 lines of public types, one `impl Store` block of ~8,100 lines
(183 public methods, no section markers), ~250 lines of free helpers, and an inline `mod tests` of ~11,750
lines. Split it into feature modules so a reader can find, read and change one area (accounts, budgets,
recurring…) without opening the whole file.

**Success criteria**

- `store.rs` keeps only: the module list and re-exports, `Store` itself, `open`/`open_in_memory`, the
  activity-log helpers, and shared constants/helpers used by several modules. Target: under ~1,500 lines.
- No feature file over ~2,000 lines (tests included).
- **No behavior change and no public API change.** Every path that compiles today
  (`budget_core::store::StoredAccount`, `store.list_accounts()`, …) still compiles, in `core`, `src-tauri`,
  `core/tests`, and `core/examples`. No method is renamed, re-signatured or rewritten.
- Every test that exists today still exists and passes; the Rust test count is unchanged.

**Out of scope** (each gets its own spec later): `src-tauri/src/commands.rs`, `src/App.tsx`, `src/App.css`.
Also out of scope: fixing anything noticed during the move (log it instead), renaming, and regrouping
`core/src/store/` into deeper folders.

## Approach

Follow the existing convention (`sign_flip.rs`, `comparison_setup.rs`, `profile_ui_state.rs`):

- Each feature file is a child module `core/src/store/<feature>.rs` declared with `mod <feature>;` in
  `store.rs`, containing `impl Store { … }` with the moved methods, `use super::{Store, …}` for what it
  needs, and its own `#[cfg(test)] mod tests` holding the tests for those methods.
- Public types used by one feature move with it and are re-exported from `store.rs`
  (`pub use self::accounts::{StoredAccount, …};`), so external paths do not change. Types used by several
  features stay in `store.rs` (or move to a `store/types.rs` re-exported wholesale if that reads better;
  decided per type during the plan).
- A private method or helper that another module calls becomes `pub(super)` (or `pub(crate)` only if
  something outside `store` already uses it — today none can). Nothing becomes newly `pub`.
- Text is moved, never retyped: methods and tests are cut and pasted verbatim, with doc comments. Only
  `use` lines and visibility keywords change. Files stay CRLF.

### Steps (one commit each)

0. **Tests out first:** move the inline `mod tests` to `core/src/store/tests.rs` (`#[cfg(test)] mod tests;`).
   A pure move that halves `store.rs` and makes every later step's diff smaller. Shared test helpers
   (fixture builders) go to `store/test_support.rs` (`#[cfg(test)] pub(super)`), so feature test modules
   can use them.
1. **`schema.rs`:** `init_schema`, the ~50 `migrate_*`/`backfill_*`/`seed_*` methods (lines ~1110–2630).
2. **`accounts.rs`:** account CRUD, balances, checkpoints, reconciliation, setup import
   (`create_account` … `delete_account`, `apply_setup_import`, `roll_forward_monthly_balances`).
3. **`family.rs`:** family members.
4. **`rules.rs`:** rules, rule preview/apply, `labeled_history`.
5. **`transfers.rs`:** transfer linking, candidates, auto-link.
6. **`categories.rs`:** categories, import category reconciliation, `category_counts`.
7. **`transactions.rs`:** save/query/update/delete/restore, tags, splits, debt payments.
8. **`buckets.rs`:** buckets and sinking funds.
9. **`budgets.rs`:** budgets, actuals, rollover, month review, budget alerts.
10. **`insights.rs`:** anomaly flags, large expenses, dashboard insights, spend-day stats.
11. **`recurring.rs`:** recurring items, matches, candidates, recurring helpers (`classify_cadence`,
    `next_occurrence`, …).
12. **`investments.rs`:** holdings, snapshots, contributions, investment plan, allocation targets.
13. **`settings.rs`:** live price, app, background and backup settings; reminders.
14. **`assets.rs`**, **`forecast.rs`** (debt payoff, cash flow and bill-aware forecasts), **`reports.rs`**
    (monthly totals, spending by category, top merchants, net worth, contribution deltas).

Order may shift if a dependency makes a later group easier to move first; group boundaries follow the
method list as it stands at `ff0cfea`. If a group is over ~2,000 lines with tests, it splits further
(likely candidates: transactions, budgets).

## Verification (every step)

- `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -D warnings`, and
  `cargo test --workspace`. The test count must match the baseline from before step 0 exactly; a
  dropped test fails the step.
- Moved-not-changed check: a script compares the sorted set of non-blank, non-`use` lines across
  `store.rs` + `store/*.rs` before and after each step. Only visibility keywords, `mod`/`use` lines and
  re-exports may differ. Its output goes in the commit message.
- `src-tauri` builds (`cargo check --workspace` covers it).
- **After the last step:** `npx tauri build --debug --no-bundle` into `%TEMP%\vs-verify-target` and the full
  e2e suite (`node e2e/run-all.mjs`), since the app binary is rebuilt from the moved code.

No new tests are written: this is a move, and the existing suite (1,223 Rust tests) is the safety net.
The line-set check is what proves nothing was edited along the way.

## Risks

- **Private access across modules:** a moved method can call a private helper elsewhere. The compiler
  finds every case, and the fix is `pub(super)`, never `pub`.
- **Re-export misses:** a type that moves without a `pub use` breaks `src-tauri`. `cargo check --workspace`
  finds it.
- **Merge pain:** any other branch touching `store.rs` will conflict. There are no other active branches
  touching it (futuristic-refresh is merged), and each step is its own commit, so a conflict stays small.
- **Line endings:** `cargo fmt` once wrote LF. Check `git diff --ignore-space-at-eol` and restore CRLF.
