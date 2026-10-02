# Comparisons: one household comparison, with each person's income in the Income details

Date: 2026-10-01
Status: approved design, awaiting spec review
Branch: release-1.2.9 (Comparisons have not shipped yet; v1.2.8 does not contain them)

## Why

Reports > Comparisons asks people to choose up front between **My household** and **One person**.
"One person" only ever compares income (the only figure published for a single person), and
income is always typed by hand, so the option uses none of the person's data and quietly drops
savings, investments, debt and spending. It is a confusing decision that most people cannot
make well, and it hides four comparisons from someone who lives alone.

The question it answers ("is my pay normal for my age?") is still worth answering. It moves into
the Income card's details instead of being a separate mode.

## Outcome

- There is no mode choice anywhere: setup dialog, details panel, Help, command palette.
- Everyone is compared as a household. Someone who lives alone is a household of one and gets all
  five comparisons.
- When income is entered per person, the Income card's details list each household member's own
  yearly income against the national median personal income for their age group.
- All copy follows the plain-language rule (written for people new to money terms; no "tracked",
  "published", "derived").

## Design

### 1. Stored setup (`core/src/comparisons/setup.rs`, `core/src/store/comparison_setup.rs`)

- Remove `ComparisonSetup::mode` and `ComparisonSetup::individual_person`.
- Remove `CohortChoice::mode`; a cohort choice is keyed by metric only.
- `ComparisonSetup::empty()` takes no argument.
- Bump `SETUP_FORMAT_VERSION` to 2. `get_comparison_setup` reads a version 1 payload by parsing it
  as JSON, dropping `mode`, `individualPerson`, and every `cohortChoices` entry whose `mode` is
  `"individual"` (removing `mode` from the rest), then deserialising as version 2. The row is
  rewritten as version 2 on the next save. Anything newer than 2 is still `Unsupported`.
  (Only test machines can hold a version 1 setup; this keeps them loading instead of erroring.)
- `ComparisonMode` stays in the engine and benchmark package (the package's references are
  tagged household or individual), but is no longer part of the setup or the report.

### 2. Validation and metrics (`validation.rs`, `metrics.rs`)

- Drop the individual-only rules (`individualPerson` must be a listed person, etc.).
- `metrics.rs`: the subject is always the household. Remove the `Individual` branches in
  allocation, income and spending (including the "Spending is only compared for the household"
  note).

### 3. Report (`report.rs`)

- `ComparisonsReport` loses `mode`. `subject_age` always uses `household_reference_person`.
  Every headline card uses the household definitions (`definition_for(metric)`).
- `SecondaryCard` gains `person: Option<PersonRef>` (`None` for the existing class lines such as
  Home debt). The UI keys and labels lines by it.
- New: personal income lines on the Income card. For each person with `in_household == true`, in
  setup order, when `income.household_method == PerPerson`:
  - The person has a per-person income entry and an age: compare their `gross_annual` against the
    `cps_pinc01_money_income_median` references (individual mode in the package) for their age,
    using the household's universe preference for income. Push a `SecondaryCard` with
    `person: Some(..)`, `definition_id: "cps_pinc01_money_income_median"`.
  - Their age is a range spanning more than one of those age groups: push the line with a result
    whose status says an exact age is needed (no guessed comparison). The UI shows
    "Enter an exact age, or a range inside one age group, to compare {name}'s income."
  - No income entry or no age: no line.
- `CardView` gains `personal_income_hint: bool`, true on the Income card when income is entered as
  one household total and at least one person is listed. The UI then shows: "Enter income for each
  person to also see how each person's pay compares with people their age."

### 4. Frontend

- `types.ts`, `setupDraft.ts`: drop `mode`, `individualPerson`, cohort-choice `mode`; follow the
  report shape (`SecondaryCard.person`, `personalIncomeHint`).
- `ComparisonSetupDialog.tsx`, `ComparisonDetailsPanel.tsx`: remove the Compare choice and the
  "Person compared" picker. The "Person whose age is used" picker stays.
- `fieldTips.ts`: remove `compare` and `subjectIndividual`; reword `subjectHousehold` if it refers
  to the mode.
- `ComparisonsView.tsx`, `ComparisonCard.tsx`: remove mode-dependent wording.
- `ComparisonDetailsDialog.tsx`: in "Also compared", key lines by definition + person, label a
  personal line with the person's name (`personLabel`), e.g. "Jordan (age 31)"; show the hint or
  the age-range message where applicable.
- `HelpView.tsx`, `paletteSearch`, `changelog.ts` (1.2.9 entry, if present), `csv.ts` if it exports
  the mode: update to one household comparison plus personal income lines.

### 5. Tests (written before the code)

- Rust (`core/tests/comparisons/`): report adds one personal line per household member with
  per-person income and an age; correct medians for the age group; no lines with a household
  total, and the hint is set; a range spanning two groups gives the "exact age" result; a roommate
  (`in_household == false`) gets no line; a stored version 1 setup with `mode: "individual"` loads
  as a version 2 household setup; package/engine tests adjusted for the removed mode.
- Vitest: setup dialog and details panel have no mode choice; details dialog renders personal
  lines, the hint and the age-range message; setupDraft without mode.
- E2E: rewrite `feature149_comparisons_individual_mode.mjs` as personal income in the Income
  details (lines appear with the right medians and survive a restart); update 144/145 and
  `e2e/lib/comparisons.mjs`, plus any help/palette spec that searches for "One person".
- Verification before done: `npm test`, `cargo test --workspace`, `npx tsc --noEmit`, and the full
  `npm run e2e` (release work).

## Out of scope

- Choosing an age group per person when a range spans several (needs per-person cohort choices).
- Personal comparisons for anything other than income (no national figures exist for them).
