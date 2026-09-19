# Phase 3 handoff — item 11: Sankey diagram + daily-spend heatmap

Branch: `phase-3-sankey-heatmap`, based on `origin/release-1.2.7` (f1de2fb).
Started overnight while Phase 2 is still in acceptance testing, per the
owner's request. Nothing here touches `release-1.2.7` or `main`, there's no
version bump, no merge, no tag, no release, and no pull request.

## What was built, and where

Both new views live on the Reports tab (`src/ReportsView.tsx`) and follow
the page's existing range picker (Year to date / Last 12 months / Last 6
months / Last month) exactly the way the category table and the
by-member/by-tag breakdowns already do — no new UI for picking a range.

**1. Income → spending Sankey diagram**
- `src/sankey.ts` — pure layout module, no React/DOM:
  - `buildSankeyData(income, categories, maxCategories=8)` turns income +
    a flat category-total list into a small typed graph (nodes/links).
    Categories past the top 8 collapse into an "Other" node. If income
    exceeds spending, a "Left over" node appears on the right; if spending
    exceeds income, the graph gets a third column instead (see *Design
    decisions* below).
  - `layoutSankey(data, width, height, nodeWidth, nodePadding)` places
    nodes into columns (stacked top-to-bottom, scaled to fill the height)
    and slices each link's endpoints out of its source/target node — the
    same technique d3-sankey uses, reimplemented by hand since there's no
    charting dependency in this app (`src/charts.tsx` is all hand-rolled
    inline SVG, same pattern here).
  - `sankeyRibbonPath(...)` — one link's SVG path (two cubic Béziers).
- `src/sankey.test.ts` — 11 tests covering the graph construction (surplus,
  exact break-even, shortfall, zero-income shortfall, no-data, "Other"
  grouping, negative/zero amounts ignored) and the layout math (stacking,
  proportional link slicing, empty graph).
- `SankeySection` component, added directly inside `src/ReportsView.tsx`
  (same pattern as the existing `SavingsRateTrendSection`/`BreakdownTable`
  functions in that file) — turns a `SankeyLayout` into `<rect>`/`<path>`
  elements. Feeds off the category totals already being fetched for the
  category-by-month table (`table.rows`), so **no new backend call** was
  needed for this half of the feature.

**2. Daily-spend heatmap**
- `core/src/store.rs` — `Store::daily_spending(from_year, from_month,
  to_year, to_month)`, right next to `category_spending_by_month` and
  built the same way: excludes income, the `"Transfer"` category, linked
  transfer pairs (`LIVE_TRANSFER_LEG_IDS_SQL`), debt-payment bookkeeping
  rows and deleted transactions; counts a split purchase through its
  lines. Returns one row per day that actually had spending. 4 new unit
  tests in `mod tests`, modeled directly on `category_spending_by_month`'s
  own tests (day totaling, range/year-boundary, transfer/income/deleted
  exclusion, split purchases).
- `src-tauri/src/commands.rs` — `daily_spending` Tauri command (same shape
  as `category_spending_by_month`'s), plus `DailySpendAmountDto`.
- `src-tauri/src/lib.rs` — registered in `invoke_handler`.
- `src/heatmap.ts` — pure layout module:
  - `buildHeatmapWeeks(daily, from, to)` lays a flat list of
    `{date, amount}` out as whole Sunday-first weeks covering `from..to`,
    padding partial weeks at both ends (padding days carry `inRange:
    false` and amount 0, never real data).
  - `heatmapBucket(amount, max, bucketCount=5)` — which color step an
    amount falls into; 0 is always "no spending," kept distinct from the
    bottom of the proportional scale.
- `src/heatmap.test.ts` — 10 tests (week padding, date-to-amount mapping,
  multi-week ranges, month/year-boundary ranges, inverted range, bucket
  edges/clamping).
- `DailySpendHeatmapSection` component, also in `src/ReportsView.tsx`.
- `src/reportRange.ts` — added `monthStartDate`/`monthEndDate` (a
  `YearMonth` → "YYYY-MM-DD" pair), since the heatmap needs day-level
  bounds and the rest of the range machinery only dealt in months; 3 new
  tests in `src/reportRange.test.ts`.

**3. Cross-cutting requirements**
- **Themes**: every color is a CSS variable (`var(--accent)`,
  `var(--positive)`, `var(--negative)`, `var(--text-faint)`, category
  colors from the same hex palette `CashFlowView`/`DashboardView` already
  use) or `color-mix(in srgb, var(--accent) X%, var(--surface))` for the
  heatmap's intensity steps — the same technique already used elsewhere in
  `src/App.css` (search "one set of 5 works for every palette via
  `color-mix`"), so it works in Slate/Futuristic/Transparent × light/dark
  without per-theme overrides.
- **Accessibility + Privacy mode**: both SVG/grid visuals are marked
  `aria-hidden`/`role="presentation"` and carry no dollar figures in any
  `aria-label` (so nothing leaks through the accessibility tree while
  Privacy mode is hiding amounts). A visually-hidden (`.sr-only`, new
  utility class in `App.css`) `<table>` next to each one lists every exact
  figure as real DOM text, which `startPrivacyMask` (`src/privacy.ts`)
  finds and masks exactly like every other amount on the page — the
  Sankey's own visible `<text>` labels are real DOM text too, so the
  numbers are never hidden *only* in an attribute or a canvas. The heatmap
  additionally has a live-updating status line (`aria-live="polite"`)
  that names the hovered/focused day's total in plain text, since tabbing
  through ~180 day buttons one at a time is a lot to ask of a
  keyboard/screen-reader user without it.
- **Narrow widths**: both sections' wide content
  (`.heatmap-grid`/`.sankey-svg`'s container) sits inside `.table-scroll`
  or renders as a responsive `width="100%"` SVG, matching how the existing
  category-by-month table avoids pushing the whole page sideways.
- **Empty state**: both sections show a plain "No income or spending in
  this range." / "No spending in this range." message (reusing the page's
  existing `.empty-state` class) instead of an empty SVG/grid.

## Design decisions

- **Shortfall handling.** When spending exceeds income, there's no honest
  way to say how much of any *one* category was funded by income versus
  the shortfall — so instead of guessing, the graph gets a third column:
  Income and a "Shortfall" node both flow into a single "Total spending"
  node, which then fans out to the categories. When income covers
  spending, it stays the simpler two-column shape the task described
  (Income straight into each category, plus "Left over"). See
  `buildSankeyData`'s doc comment and the `layoutSankey` tests for both
  shapes.
- **The Sankey needed no new backend call.** `category_spending_by_month`
  already returns exactly the (already transfer-excluded) category totals
  the diagram needs, and `ReportsView` already fetches it for the
  category-by-month table — `SankeySection` just reuses `table.rows`.
- **The heatmap's date range is clamped to today**, not the full
  `to`-month, when the selected preset's end month is the current month
  (Year to date / Last 12/6 months) — otherwise the grid would pad the
  rest of an in-progress month with meaningless empty cells. `Last month`
  is unaffected (it's always a complete month in the past).
- **Bucket 0 is reserved for "no spending"** rather than being the bottom
  of the proportional 1..N scale, so a $0 day and a very-small-but-nonzero
  day never render identically.
- **Color reuse**: category colors reuse the exact palette
  `CashFlowView`/`DashboardView` already use for their donuts, so a
  category's color is consistent across the app rather than introducing a
  fourth ad hoc palette.

## Test commands run, and their results

All run from the repo root on this Linux sandbox.

```
npm ci                                    # 382 packages installed, clean
npx tsc --noEmit                          # no output — clean
npx vitest run                            # 26 files, 332 tests passed (was 308 before this branch; +24 new: 11 in sankey.test.ts, 10 in heatmap.test.ts, 3 in reportRange.test.ts)
cargo test -p budget_core                 # 557 passed, 0 failed (was 553; +4 new daily_spending tests)
rustfmt --edition 2024 core/src/store.rs  # no diff beyond what I wrote
rustfmt --edition 2021 src-tauri/src/commands.rs  # no diff beyond what I wrote
rustfmt --edition 2021 src-tauri/src/lib.rs       # no diff (one added line, already formatted)
```

`cargo test --workspace` (which would also compile and test the
`src-tauri` crate) does **not** run in this sandbox — `cargo check -p
vaultspend` fails during the `gdk-sys` build script with `Package
'gdk-3.0' was not found in the pkg-config search path`, a missing native
GTK dev package that has nothing to do with this change (it's a Tauri v2 +
Linux desktop-integration dependency; the real app targets Windows). This
is exactly the situation the task briefing anticipated ("if the system
libraries allow"); they don't, here.

## What could NOT be verified

- **`src-tauri` does not compile-check here** (see above), so
  `daily_spending` in `src-tauri/src/commands.rs` and its registration in
  `src-tauri/src/lib.rs` are **unverified by the compiler** — I matched
  `category_spending_by_month`'s command signature and DTO shape exactly
  (same argument names/types, same `state.lock()` → `map_err` →
  `.into_iter().map(...)` shape) and ran `rustfmt` over it, but nobody has
  actually built this crate against this change.
- **`e2e/feature89_sankey_and_heatmap.mjs` has never been run.** It needs
  a Windows desktop with `tauri-driver`, which this environment doesn't
  have. It's modeled closely on `e2e/feature81_reports_hub.mjs` (same
  `seedFixture`/`launchApp` pattern, same style of `data-*` selectors) and
  I reviewed it by hand, but it is genuinely unverified — treat every
  assertion in it as a claim to check, not a fact.
- **No screenshot or live interaction** — I cannot run the Tauri app or a
  browser here, so I have not seen the Sankey diagram or the heatmap
  rendered, checked their pixel layout, tested keyboard-only navigation by
  hand, or confirmed Privacy mode's masking against the real running page
  (only that `startPrivacyMask`'s TreeWalker-based approach, which doesn't
  care about SVG vs. HTML or `aria-hidden`, will reach the `<text>`/`<td>`
  nodes I added — verified by reading `src/privacy.ts`, not by running
  it).
- `cargo test --workspace` (integration/workspace-level tests beyond
  `budget_core`) — blocked by the same `gdk-sys` issue.

## Demo walkthrough

Using the repo's own demo dataset (`e2e/lib/demo-seed.mjs`, the same one
`npm run demo` seeds) run in this sandbox with the environment's current
date treated as **2026-09-19** — since the dataset is date-relative,
these exact figures only hold for that date; on any other day the same
walkthrough works but the numbers will differ. **August 2026** ("Last
month" from 2026-09-19) is a fully-elapsed month, so its numbers are
stable and are what I used below (the amounts came from replaying the
seed's SQL and running the same exclusion logic `daily_spending`/
`category_spending_by_month` use, by hand, against the resulting SQLite
file — not from the Tauri app itself, which I can't launch here).

1. Open **Reports**, click **Last month**.
2. **Income → spending** card: Income $6,400.00 (two $2,200 paychecks +
   one $2,000 stray "Dormant Deposit" income row from the dormant "Old
   Checking" account). Spending $5,572.67 across Rent ($2,270 — the
   regular $1,850 rent plus a $420 "Landlord Payment" from the
   reconciliation-practice "Statement Checking" account, both dated in
   August), Groceries ($677.40), Dining Out ($565.00), "Savings Goal"
   ($500 — the monthly transfer-to-savings row; it's an *ordinary*
   category on both legs in this dataset, only kept out of spending by
   its transfer *link*, not its category name, so it's a good check that
   linked-pair exclusion is actually wired up and not just the `"Transfer"`
   category name), Shopping ($455.35), Utilities ($231.70), Insurance
   ($175.00), Health ($154.10) as the top 8, and an "Other" node totaling
   $544.12 (Gas + Subscriptions + Entertainment + Uncategorized +
   Household + Pet Care). Income exceeds spending, so there's a
   **"Left over"** flow of $827.33 — not a shortfall.
3. **Daily spending** heatmap: August had spending on 25 of its 31 days.
   The single biggest day is **August 1** at $1,850.00 (rent posts on the
   1st). Hovering or tab-focusing that cell should show "Aug 1, 2026:
   $1,850.00" in the status line under the grid and light up as the
   darkest cell on the legend's scale. August 23–25 and 28–29 have no
   transactions at all in this dataset, so those 5 cells should sit at
   the lightest ("no spending") step.
4. Turn on **Privacy mode** (Settings, or wherever the app's Privacy
   toggle lives): every dollar figure in both the visible Sankey labels
   and the "Aug 1, 2026: ••••" status line should mask to `••••`; the
   diagram's shapes/bar lengths stay visible (masking is text-only, same
   as everywhere else in the app).
5. Switch to **Year to date** or another preset: both sections should
   refetch and redraw for the new range without a page reload, the same
   way the existing category table already does.
6. Resize the window to ~960px and ~800px wide: neither section should
   push the page into horizontal scrolling; the heatmap's grid scrolls
   within its own frame if it's wider than the card.

## Proposed user-acceptance checklist

All figures assume the demo dataset seeded on **2026-09-19** (i.e. `npm
run demo` run that same day) and the **Last month** (August 2026) range,
per the walkthrough above — re-derive them from the app's own Reports
table if testing on a different day.

- Do: Open Reports → Last month. Expect: an "Income → spending" card
  appears above the category-by-month table, and a "Daily spending" card
  appears below it.
- Do: Read the Income → spending diagram's left side. Expect: a single
  "Income" flow reading $6,400.00.
- Do: Read the diagram's right side. Expect: Rent, Groceries, Dining Out,
  Savings Goal, Shopping, Utilities, Insurance, and Health each appear as
  their own flow (in that order, biggest first), plus an "Other" flow of
  $544.12 and a "Left over" flow of $827.33 — no "Shortfall" flow.
- Do: Look for the word "Transfer" anywhere in the diagram or its hidden
  summary table. Expect: it never appears — transfers are excluded by
  both category name and linked-pair, not just one or the other.
- Do: Switch to a range where spending is known to exceed income (or
  temporarily delete some income rows in a throwaway profile). Expect:
  the "Left over" flow is replaced by a "Shortfall" flow feeding in from
  the left alongside Income, and every category total still adds up to
  total spending shown in the summary tiles above.
- Do: Hover the August 1 cell in the Daily spending heatmap. Expect: the
  status line below the grid reads "Aug 1, 2026: $1,850.00", and that
  cell is visually the most intense on the grid.
- Do: Tab through the heatmap using only the keyboard. Expect: each
  in-range day is reachable and focusing it updates the same status line;
  days outside the selected range are skipped, not just visually blank.
- Do: Turn on Privacy mode. Expect: every dollar amount in both new
  sections (visible Sankey labels, the heatmap status line, and — via
  screen reader or "Inspect Element" — their hidden summary tables) masks
  to "••••"; nothing "real" is visible only through a tooltip.
- Do: Resize the window to 960px, then 800px wide. Expect: no horizontal
  scrollbar on the page itself; if the heatmap grid is wider than its
  card, it scrolls inside its own frame instead.
- Do: Switch the range to one with genuinely no transactions (e.g. a
  freshly created empty profile, any preset). Expect: both new sections
  show a plain "No income or spending in this range." / "No spending in
  this range." message instead of an empty chart.
- Do: Switch between Slate, Futuristic, and Transparent styles, in both
  light and dark, with Last month selected. Expect: both sections remain
  legible and on-theme in all six combinations — no hardcoded colors that
  clash, and no fixed-position elements that escape the Transparent
  style's backdrop blur (neither section uses `position: fixed`).
- Do: Open Help and search "sankey" or "heatmap". Expect: the Reports
  bullet under "A tour of the tabs" appears. Do: search "backup".
  Expect: only the Settings bullet and the automatic-backups FAQ entry
  appear — the Reports bullet must not show up for "backup" (its tags
  don't include that word).
