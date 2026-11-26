# Folder imports: compact settings and a calmer Folder activity dialog

## Intent
With several accounts, Settings > Data > Folder imports grows by about 430px per export name, and the
Folder activity dialog becomes a wall of long file names and repeated "Older export - not queued" rows.
Both should stay short and scannable however many accounts and files there are.

## Goals
- Settings: each saved export name is one summary row; fields show only when a row is opened.
- Folder activity: shorter rows, and repeated "older export" noise collapsed.
- Same behaviour, data and data-* hooks as today.

## Non-goals / anti-goals
- No change to what is imported, skipped, saved or queued. No backend or API change.
- No new features (no bulk review, search or filters).
- Nothing the person needs to act on may become hidden (warnings, Review again, waiting exports).

## Approaches
Settings: (A) collapse rows - chosen by the owner; (B) denser always-open cards - still grows linearly;
(C) table - poor fit for long names and dropdowns.
Activity: (1) shorter rows plus grouped older-export noise - chosen as my call, the least change that fixes the mess;
(2) tabs or accounts-as-sections - more structure than the problem needs.

## Design: Settings (approach A)
- Saved name -> summary row (button, aria-expanded): the name, then "-> Account", then small facts:
  "Flipped signs" only when on, "CSV, Excel", "From Nov 19, 2026" or "All exports".
  Badges on the row: "Unsaved changes" (draft dirty) and "Account missing" (account_usable false).
- One row open at a time. A new name opens expanded. After Save the row closes. Removing keeps the existing confirm.
- Amounts help text is shown once above the list, not per card.
- "Which exports" shortened: the radio and date on one line where space allows; watermark note stays inside the open row.
- Save/Remove stay in the open row. Opening another row keeps unsaved edits (drafts already persist in state).
- Step 3 and the folder picker unchanged.

## Design: Folder activity (approach 1)
- Waiting and Recent rows lead with "Account - export dated Nov 16 to Nov 23"; the full file name is small and muted underneath (still the aria-label for buttons).
- Consecutive "Older export" entries collapse into one row: "12 older exports skipped (dated before Nov 19, 2026)" with a Show/Hide toggle; Review again stays reachable inside.
- Recent shows the newest 10 entries, then "Show more" (reveals all already loaded).
- Footnote count says how many are shown.

## Constraints
- Theme tokens and shared ModalShell/MenuSelect/DateField; plain-language copy.
- Update FolderImportsSettings.test.tsx, FolderActivityDialog.test.tsx and e2e/feature430 (open a row first). Targeted tests only; no full suite without approval.
- Screenshots reviewed per CLAUDE.md before handing over.

## Left to the builder
Exact spacing, badge styling, and the threshold for "Show more" (10 proposed).

## Calls I made (owner can overrule)
One-row-open-at-a-time; collapse after Save; grouping rule for older entries; 10-entry cap.
