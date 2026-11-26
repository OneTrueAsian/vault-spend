# Folder imports compact layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Settings > Folder imports and the Folder activity dialog short and scannable however many export names and files there are (VS-136, VS-137).

**Architecture:** Both changes are presentation-only inside `src/features/folderImports/`. Settings gets a per-row open/closed state and a summary line built from the draft; the dialog gets display helpers (stem stripping, grouping older entries, a row cap). No backend, API or data change.

**Tech Stack:** React + TypeScript, Vitest (jsdom, `createRoot` + `act`, no Testing Library), plain CSS with theme tokens.

**Spec:** `docs/superpowers/specs/2026-11-26-folder-imports-compact-design.md`

## Global Constraints

- Keep every existing `data-folder-*` hook and every button `aria-label` (they use the full file name).
- Plain-language UI copy; theme tokens only; shared `MenuSelect` / `DateField` unchanged.
- Preserve CRLF line endings and scoped diffs; no refactors beyond these two components.
- Targeted tests only: `npm test -- <path>` with the Node 22 at `tools/node-v22.23.4`; no full unit or e2e run without owner approval.
- Nothing the person must act on may be hidden: Review, Dismiss, Review again, "account deleted or hidden", unsaved edits.
- No commits until the owner asks.

## Review Focus

- A collapsed row whose account was deleted or hidden still says so in its summary (not only inside the open form).
- Unsaved edits in a row survive collapsing it and opening another.
- A save that fails leaves the row open with its edits.
- Fewer than 3 consecutive older entries stay as normal rows (the e2e spec's single older file still reads as before).
- A file name matching no export name, or an entry with no account (`folder_ok`), keeps the full file name as its lead.
- Review again is still reachable for entries inside a collapsed group once it is shown, and only on the newest entry per file.

---

### Task 1: Settings summary rows (VS-136)

**Files:**
- Modify: `src/features/folderImports/FolderImportsSettings.tsx`
- Modify: `src/features/folderImports/FolderImports.css`
- Test: `src/features/folderImports/FolderImportsSettings.test.tsx`

**Interfaces:**
- Produces: state `openKey: string | null`; each mapping block keeps `data-folder-mapping={id|"new"}` and gains a header button `data-folder-toggle={id|"new"}` (`aria-expanded`). A draft with `id === null` is always open. Fields render only when the row is open.

- [ ] **Step 1: Write failing tests** (add to the Settings test file; update the existing tests that touch a saved row's fields to click `[data-folder-toggle='<id>']` first: "shows a deleted or hidden account", "labels each name's fields", "keeps unsaved names and edits", "can start an export name over", "explains export names…" (watermark parts), "gives Which exports its own row", "explains the newest imported export").
  - `"shows each saved name as one summary line and opens its fields on request"`: saved mapping `{stem:"Card", account "Max Checking", invert_amounts:true, extensions:["csv","xlsx"], initial_cutoff:"2026-11-19"}` → `[data-folder-mapping='5']` text contains `Card`, `Max Checking`, `Flipped signs`, `CSV, Excel`, `From Nov 19, 2026`; it has no `[data-folder-stem]`; after clicking `[data-folder-toggle='5']`, `aria-expanded` is `"true"` and the stem input exists.
  - `"keeps one saved name open at a time"`: two saved names; open 5 then 6 → 5 has no stem input, 6 has one.
  - `"says an account problem and unsaved edits on the collapsed line"`: mapping with `account_usable:false` text contains `deleted or hidden`; after typing in an open row and opening another, the first line contains `Unsaved changes` and reopening shows the typed value.
  - `"closes a name after it is saved"`: open 5, click `[data-folder-save-mapping]` → no stem input in 5.
  - `"explains the Amounts choice once, not on every name"`: two saved names opened/with a new draft → the phrase `Most checking and savings exports` occurs once in the card text.
- [ ] **Step 2: Run** `npm test -- src/features/folderImports/FolderImportsSettings.test.tsx` — expect the new tests FAIL.
- [ ] **Step 3: Implement** in `FolderImportsSettings.tsx`: `const [openKey, setOpenKey] = useState<string | null>(null)`; `addDraft` also `setOpenKey(newKey)`; `save` calls `setOpenKey(null)` inside its `run` action after `client.saveMapping` succeeds. Add `summaryOf(d, saved, accounts): { title, account, facts: string[] }` (facts: `Flipped signs` if `d.invert`; `CSV, Excel` / `CSV` / `Excel workbook` / `No file types`; `All exports` or `From ${formatDisplayDate(d.cutoff)}`). Render a header `<button type="button" className="folder-settings-summary" aria-expanded aria-controls data-folder-toggle>` with title, `→ account`, facts and badges (`Unsaved changes` when `d.dirty && d.id !== null`; `Account deleted or hidden` when `saved && !saved.account_usable`); wrap the existing fields and actions in `{open && (...)}`. New drafts render no toggle and are always open. Move the Amounts help paragraph out of the per-card field to one `<p className="modal-message-secondary">` after the "date in the name" paragraph.
- [ ] **Step 4: CSS** in `FolderImports.css`: `.folder-settings-summary` (full-width, flex-wrap, left-aligned, transparent background, token borders/text, focus-visible ring), muted facts, a small badge style using `--accent-soft` / `--accent-soft-text`.
- [ ] **Step 5: Run** the Settings test file — expect all PASS; run `npx tsc --noEmit -p .` and `npx eslint src/features/folderImports` — expect no errors.

### Task 2: Folder activity rows (VS-137)

**Files:**
- Modify: `src/features/folderImports/FolderActivityDialog.tsx`
- Modify: `src/features/folderImports/FolderImports.css`
- Test: `src/features/folderImports/FolderActivityDialog.test.tsx`

**Interfaces:**
- Produces (module-private, exported only if a test needs them): `leadOf(fileName: string, accountName: string | null, stems: string[]): string | null` — when a stem (longest first, case-insensitive) prefixes the file name and an account name exists, returns `` `${accountName} · ${rest}` `` where `rest` is the file name minus the stem and leading `[\s_\-–]+`; otherwise `null` (the file name is the lead). `groupOlder(entries): Row[]` where `Row = { kind: "entry"; entry } | { kind: "older"; entries }` collapsing runs of 3 or more consecutive `outcome === "older"` entries. Constants `OLDER_RUN_MIN = 3`, `RECENT_ROWS_SHOWN = 10`.

- [ ] **Step 1: Write failing tests** (dialog test file; the shared `state()` helper gets `mappings` with stem `Bank Max Checking` for the lead tests only):
  - `"leads a waiting export with its account and dates, file name underneath"`: `[data-folder-pending='5'] .folder-activity-file` text is `Max Checking · Nov 11 to Nov 18`; the row still contains the file name and `saved copy kept`.
  - `"leads a recent file with its account and the rest of the name when a name matches"`: entry `Bank Max Checking_2026-10-01.csv` → lead `Max Checking · 2026-10-01.csv`; its `title` is the full file name; with no matching stem the lead is the full file name.
  - `"collapses three or more older exports in a row into one line that can be shown"`: five consecutive `older` entries → no `[data-folder-activity-entry='older']` rows, a `[data-folder-older-group]` row reading `5 older exports skipped`; clicking its toggle (`aria-expanded` false→true) shows 5 rows and the newest still offers `data-folder-review-again`; two older in a row stay plain rows.
  - `"shows the newest 10 rows and then more on request"`: 14 distinct non-older entries → 10 `[data-folder-activity-entry]`, text `Showing the newest 10 of 14 recent entries`; clicking `[data-folder-show-more]` shows 14 and the button disappears.
  - Existing tests must still pass unchanged (they contain `3 recent entries shown`, file-name aria-labels and the outcome text).
- [ ] **Step 2: Run** `npm test -- src/features/folderImports/FolderActivityDialog.test.tsx` — expect the new tests FAIL.
- [ ] **Step 3: Implement** the two helpers, `useState` for `expandedGroups: Set<number>` (keyed by the group's first entry id) and `showAll: boolean`; pending lead `` `${batch.account_name ?? "An account that was removed"} · ${exportDates(batch)}` `` with the file name as the muted line (single line, ellipsis, `title`); recent rows use `leadOf(...) ?? entry.file_name`, put the account in the muted line only when the lead is the bare file name, and set `title` to the full file name; render older groups as a row with a `Show` / `Hide` button (`aria-expanded`, `data-folder-older-group`, `data-folder-older-toggle`) and the normal rows when shown; cap at `RECENT_ROWS_SHOWN` rows with a `data-folder-show-more` button; footnote reads `${count(recent.length, ...)} shown` when nothing is hidden, otherwise `Showing the newest ${n} of ${recent.length} recent entries.`
- [ ] **Step 4: CSS** `.folder-activity-filename` (nowrap, ellipsis, min-width 0) and group row styling using existing tokens.
- [ ] **Step 5: Run** the dialog test file — expect all PASS; run tsc and eslint as in Task 1.

### Task 3: E2E spec, look-and-feel check, changelog

**Files:**
- Modify: `e2e/feature430_folder_imports.mjs:157`
- Modify: `src/shared/lib/changelog.ts` (only if a 1.3.6 entry exists or the release skill expects one: user-facing Enhancements)

- [ ] **Step 1:** Change the older-export assertion at line 157 to check `iso(30)` and `Older export — not queued` instead of the full `olderName` (the row now leads with the account and the rest of the name; the full name is in `title`).
- [ ] **Step 2:** Run `npm run e2e -- --list` to confirm the spec still loads. Running the compiled-app spec needs a build and exclusive desktop access, so ask the owner first.
- [ ] **Step 3:** Render both screens with many accounts and files in a browser against the dev server (Playwright) at the screenshot widths, and read the screenshots for geometry and contrast (jsdom proves neither).
- [ ] **Step 4:** Add the changelog Enhancement line if the 1.3.6 entry exists; run its test file.
