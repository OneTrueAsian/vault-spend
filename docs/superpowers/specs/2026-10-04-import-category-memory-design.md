# Import: settle every guess before saving, and remember file category choices

Date: 2026-10-04
Status: approved design, awaiting spec review
Branch: import-category-memory (cut from `main` at `95b4124`, v1.2.9)

## Why

Today an import saves its rows first and categorizes afterwards. A file category the person
doesn't have ("Merchandise", "Gas/Automotive") is settled on the review screen by mapping it,
adding it, or not using it, but that choice is forgotten after every import, so the same bank
asks the same question each time. Guesses the auto-categorizer is unsure about are only
surfaced later, in the review list, after they have already changed totals.

The owner wants:

- Unknown file categories to fall back to the person's rules and the auto-categorizer, and to
  Uncategorized when those find nothing.
- Any row the app is less than 50% sure about to be settled by the person on the import review
  screen, before anything is saved.
- A file category the person maps to one of theirs to be remembered for the next import.

## Outcome

- Every imported row's category is decided on the review screen, in a fixed order (below).
- Rows the app cannot place with at least 50% confidence appear in a **Needs your choice** list,
  and Import stays disabled until each has a choice (a category, or "Leave uncategorized").
- A "use one of my categories" choice for a file category is remembered for every account and
  filled in next time; changing it on the review screen updates the memory.
- The existing "Unsure" mark in the review list (guesses under 70%) is unchanged, so a guess
  between 50% and 70% is saved but still flagged for a second look.
- All copy follows the plain-language rule (no "tracked", "published", "derived"; short sentences).

## Design

### 1. Order a row's category is decided in

On the review screen, before anything is written:

1. **The file's category matches one of the person's** (any casing) → their category, their
   spelling. Unchanged from today.
2. **The file's category has a remembered mapping** → the mapped category. The person's own
   earlier choice outranks a rule.
3. **Otherwise rules and the auto-categorizer** (`categorizer::categorize`), exactly as
   `categorize_uncategorized` runs them today, including contested-rule confidence:
   - a rule match with no confidence, or a result with confidence **≥ 0.5** → used;
   - confidence **< 0.5**, or no result at all → **needs a choice**.

This applies to every row the app must guess for: rows whose file category is unknown (and
whose unknown-category panel choice is "Let the app guess"), and rows from files that have no
category column. A row the person explicitly maps or adds through the unknown-category panel
takes that choice (steps 1-2 semantics) and never needs a choice.

A guess is only ever filed under a category the person already has (same guarantee as
`set_category_if_registered`).

### 2. Needs your choice (review screen)

- New component `src/ImportNeedsChoice.tsx`: one line per row (date, description, amount, the
  app's best guess if any with how sure it is in words), each with a `MenuSelect` of the
  person's categories plus **Leave uncategorized**. No option is preselected.
- A **Leave the rest uncategorized** button sets every row still without a choice. This keeps a
  first import (no history, no guesses) from demanding one click per row.
- `App.tsx` disables Import while any included row lacks a choice and says why in plain words
  ("Choose a category for 3 more rows, or leave them uncategorized."). Excluded (unchecked) rows
  never need a choice.
- Changing an unknown-category panel choice or a row's included state recomputes which rows need
  a choice, without re-reading the file, so choices already made are kept where still relevant.

### 3. Unknown file categories panel (`src/ImportCategoryReconcile.tsx`)

- "Don't use it" becomes **Let the app guess** (same `skip` action underneath).
- A remembered mapping is shown already selected. The default for an unremembered name stays
  "Let the app guess".
- On commit, each "use one of my categories" (`map_to`) choice is saved as the mapping for that
  name, replacing any earlier one. "Add as new" is not stored (the next import matches it by
  step 1). Choosing "Let the app guess" for a name that has a mapping removes the mapping.

### 4. Storage (`core/src/store/categories.rs`, schema in `core/src/store/schema.rs`)

New table, created with the others on every `Store::open` (additive, like all schema):

```sql
CREATE TABLE IF NOT EXISTS import_category_mappings (
    file_category TEXT PRIMARY KEY,   -- trimmed, lower-cased name from the file
    category      TEXT NOT NULL       -- one of the person's categories
);
```

- `Store::import_category_mappings() -> HashMap<String, String>`
- `Store::set_import_category_mapping(file_category, category)` / `remove_import_category_mapping`
- `rename_category` renames the `category` column's matches; `delete_category` deletes them. A
  mapping can never point to a category that no longer exists. If a mapping is somehow stale at
  import time, it is ignored (the row goes to step 3), never applied.
- A dedicated table rather than rules: rules match transaction descriptions, not file category
  names.

### 5. Commands (`src-tauri/src/commands.rs`)

- `preview_import` returns, per row, the step-1 match (if any) and the step-3 result
  `{ category: Option<String>, source: "rule" | "guess" | null, confidence: Option<f64> }`
  computed for every row without a step-1 match, plus each unmatched category's remembered
  mapping. The review screen derives "needs a choice" from these and the current panel choices
  (pure function in `src/importResolution.ts`, unit tested), so changing a panel choice needs no
  backend call.
- `commit_import` gains `row_choices: HashMap<usize, Option<String>>` (`None` = leave
  uncategorized). Before writing anything it recomputes resolutions and **refuses** the import
  if an included row that needs a choice has none, or a chosen category is not one of the
  person's. Rows the person picked are saved with `CategorySource::User` and taught the same way
  `correct_category` teaches (`learner::learn_from_correction` + persisted rule). Rows resolved by
  step 3 are saved with their source and confidence. Mappings are written in the same
  transaction as the rows. `categorize_uncategorized` and auto-linking run afterwards as today.
- The cutoff is `IMPORT_CHOICE_BELOW = 0.5` in `core/src/categorizer.rs`, documented next to the
  frontend's `LOW_CONFIDENCE = 0.7` (`src/importInbox.ts`): below 0.5 the person decides before
  saving; between 0.5 and 0.7 the guess is saved and marked "Unsure".

## Error handling

- A refused commit returns a plain message and writes nothing (rows, mappings, learned rules).
- A stale mapping or a guess naming a missing category is never applied; the row falls through
  to the next step or needs a choice.

## Testing (written first)

- Rust (`core/src/store/tests/categories.rs`, categorizer tests): each step of the order;
  confidence exactly 0.5 is used and 0.4999 needs a choice; contested rules below 0.5 need a
  choice; mappings survive reopen, follow rename, vanish on delete; stale mapping ignored.
- Rust (app crate): `commit_import` refuses an unsettled row and an unknown chosen category with
  nothing written; picked rows are `User` and produce a learned rule; mappings saved/replaced/
  removed per section 3.
- Vitest: `ImportNeedsChoice` (no preselection, Leave the rest, counts) and the
  `ImportCategoryReconcile` wording and prefill.
- E2E (new spec): import a file with an unknown category and an unguessable row; Import is
  disabled until settled; map the category; import a second file and see the mapping prefilled
  and applied. Existing import specs (feature97 and others) updated for the new wording.
- Full gate: tsc, lint, vitest, fmt, clippy, `cargo test --workspace`, full e2e.

## Out of scope

- Reconciling after import (filtering Transactions by "unknown file category").
- A settings screen to list or clear remembered mappings.
- Changing the 70% "Unsure" cutoff.
