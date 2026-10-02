# Comparisons: Household Only, With Personal Income Lines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "My household / One person" comparison mode, and show each household member's own income against people their age inside the Income card's details.

**Architecture:** The stored setup drops `mode`, `individualPerson`, the cohort-choice `mode` and the typed-total `subject` (format version 2, with a loader that upgrades version 1 payloads). The Rust report always compares the household; for the Income card it adds one `SecondaryCard` per household member (with a new `person` field) compared against the Census PINC-01 personal medians, plus a `personalIncomeHint` flag. The React side removes the mode controls and renders the new lines.

**Tech Stack:** Rust (`core/`, serde, rust_decimal), React + TypeScript (Vitest, jsdom), Tauri e2e (WebdriverIO, `e2e/*.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-01-comparisons-household-only-design.md`

## Global Constraints

- Branch `release-1.2.9`. Comparisons are unreleased (v1.2.8 does not contain them).
- `SETUP_FORMAT_VERSION` becomes `2` in both `core/src/comparisons/setup.rs` and `src/comparisons/setupDraft.ts`. A stored version 1 setup must still load; anything above 2 stays `Unsupported`.
- `ComparisonMode` stays in `types.rs` / `types.ts` and in `CardQuery`: benchmark references are tagged household/individual. It leaves the setup and the report.
- Personal income definition id: `cps_pinc01_money_income_median`. Household income stays `cps_hinc02_money_income_median`.
- Copy is plain language for people new to money terms: no "tracked", "published", "derived", "individual mode". Exact strings:
  - Hint: `Enter income for each person to also see how each person's pay compares with people their age.`
  - Age-range line: `Enter an exact age, or a range inside one age group, to compare {name}'s income.`
- Spec amendment (made while planning): typed totals (`manualOverrides`) lose `subject` too. It only ever pointed at the One person subject; keeping it would leave invisible, inert entries.
- Tests first for every behaviour change. Before calling the work done: `npm test`, `cargo test --workspace`, `npx tsc --noEmit`, `npx tauri build --debug --no-bundle`, then the full `npm run e2e` (never a sequential loop over specs).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A version 1 setup saved in One person mode, with a cohort choice and a per-person typed total, must load as a valid household setup (not a "Corrupt"/"Unsupported" error) — pinned in Task 1 store test.
2. A household member whose income is negative or zero (money income can be negative) must not crash or mislead: the personal line shows "not comparable", never a percentage — pinned in Task 2.
3. A roommate (`in_household == false`) with an income entry from an old setup must not get a personal line — pinned in Task 2.
4. The details dialog with two personal lines must not produce duplicate React keys (both lines share a definition id) — pinned in Task 4.
5. Switching income from "Separately for each person" back to "One household total" keeps the per-person entries but hides the lines and shows the hint — pinned in Task 2 (`personal_income_hint`) and Task 4.

---

### Task 1: Setup format 2 — drop the mode from the stored setup, validation, metrics and report

**Files:**
- Modify: `core/src/comparisons/setup.rs` (constants, `ManualOverride`, `CohortChoice`, `ComparisonSetup`, `empty`, new `upgrade_v1_payload`)
- Modify: `core/src/store/comparison_setup.rs:89-109` (`get_comparison_setup`)
- Modify: `core/src/comparisons/validation.rs:113-121, 230-252, 274-291`
- Modify: `core/src/comparisons/metrics.rs:183-219, 251, 296-301, 412-447, 474-480, 539-560`
- Modify: `core/src/comparisons/report.rs` (mode-dependent helpers, `ComparisonsReport`)
- Test: `core/tests/comparisons/store_tests.rs`, `setup_tests.rs`, `metrics_tests.rs`, `report_tests.rs`, `snapshot_tests.rs`

**Interfaces:**
- Produces: `ComparisonSetup::empty() -> ComparisonSetup` (no argument); `ComparisonSetup` without `mode`/`individual_person`; `CohortChoice { metric, reference_id }`; `ManualOverride { metric, amount }`; `pub fn upgrade_v1_payload(payload: &str) -> serde_json::Result<String>` in `setup.rs`; `ComparisonsReport { package_version, cards }` (no `mode`); `fn definition_for(metric: MetricId) -> Option<&'static str>` in `report.rs`.

- [ ] **Step 1: Write the failing store test for the version 1 upgrade**

Add to `core/tests/comparisons/store_tests.rs`, following the file's existing raw-row pattern (`a_stored_setup_from_a_newer_app_is_reported_not_misread`: open a file store, drop it, write the row with `rusqlite`, reopen). That newer-version test already pins the `Unsupported` case and stays as it is.

```rust
#[test]
fn a_version_1_setup_saved_in_one_person_mode_loads_as_a_household_setup() {
    let dir = temp_dir("v1-upgrade");
    let path = dir.join("v1.db");
    let partner = {
        let store = Store::open(&path).unwrap();
        store.create_family_member("Partner").unwrap()
    };
    let v1 = serde_json::json!({
        "formatVersion": 1,
        "mode": "individual",
        "householdReferencePerson": { "kind": "owner" },
        "individualPerson": { "kind": "member", "id": partner },
        "people": [
            { "person": { "kind": "owner" }, "age": { "age": { "kind": "exact", "age": 42 }, "confirmedOn": "2026-09-01" }, "inHousehold": true },
            { "person": { "kind": "member", "id": partner }, "age": null, "inHousehold": true }
        ],
        "income": { "householdMethod": "by_person", "householdTotal": null, "perPerson": [] },
        "spending": { "period": null, "accountIds": [], "completenessConfirmed": false, "manualAnnual": null, "categoryMappings": [] },
        "savingsOverrides": [], "investmentClasses": [], "debtClasses": [], "debtExclusions": [], "allocations": [],
        "balanceConfirmations": [],
        "manualOverrides": [
            { "metric": "savings", "subject": null, "amount": { "value": "25000", "measuredOn": "2026-09-01", "explanation": "Statement" } },
            { "metric": "debt", "subject": { "kind": "member", "id": partner }, "amount": { "value": "900", "measuredOn": "2026-09-01", "explanation": "Card" } }
        ],
        "cohortChoices": [
            { "mode": "household", "metric": "income", "referenceId": "cps_hinc02_money_income_median:40-44" },
            { "mode": "individual", "metric": "income", "referenceId": "cps_pinc01_money_income_median:40-44" }
        ],
        "universePreferences": []
    });
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute(
            "INSERT INTO comparison_setup (id, format_version, revision, payload, updated_at) VALUES (1, 1, 4, ?1, 'x')",
            [v1.to_string()],
        )
        .unwrap();
    }
    let store = Store::open(&path).unwrap();
    let stored = store.get_comparison_setup().expect("a version 1 setup still loads");
    assert_eq!(stored.revision, 4);
    let setup = stored.setup.unwrap();
    assert_eq!(setup.format_version, SETUP_FORMAT_VERSION);
    assert_eq!(setup.household_reference_person, Some(PersonRef::Owner));
    assert_eq!(setup.manual_overrides.len(), 1, "the one-person typed total is dropped");
    assert_eq!(setup.manual_overrides[0].metric, MetricId::Savings);
    assert_eq!(
        setup.cohort_choices,
        vec![CohortChoice { metric: MetricId::Income, reference_id: "cps_hinc02_money_income_median:40-44".into() }]
    );
}
```

`a_damaged_payload_is_reported_as_corrupt` (format 1, `'{not json'`) must keep passing: the upgrade fails to parse and maps to `Corrupt`.

- [ ] **Step 2: Run it to see it fail**

Run: `cargo test -p budget_core --test comparisons a_version_1_setup -- --nocapture`
Expected: FAIL to compile (`CohortChoice` has a `mode` field / `upgrade` missing), or fail with `Unsupported { found: 1 }`.

- [ ] **Step 3: Change the setup types**

In `core/src/comparisons/setup.rs`:

```rust
pub const SETUP_FORMAT_VERSION: u32 = 2;
```

`ManualOverride` becomes (doc comment updated):

```rust
/// A comparable total typed in place of the household's own figure. Stays active until removed or replaced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManualOverride {
    pub metric: MetricId,
    pub amount: ManualAmount,
}
```

`CohortChoice` becomes:

```rust
/// The published cohort the person picked when their age band spans several, per metric.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CohortChoice {
    pub metric: MetricId,
    pub reference_id: String,
}
```

In `ComparisonSetup`, delete `pub mode: ComparisonMode,`, delete `individual_person` and its doc comment, and change the reference person's doc to `/// The one person whose age is used for every comparison.` In `empty`:

```rust
    /// A valid, empty setup: nothing chosen, nothing confirmed.
    pub fn empty() -> Self {
        ComparisonSetup {
            format_version: SETUP_FORMAT_VERSION,
            household_reference_person: None,
            people: Vec::new(),
            // ... every other field unchanged
        }
    }
```

Remove `ComparisonMode` from the `use super::types::{...}` line. Add below `empty`'s `impl` block:

```rust
/// Reads a format 1 payload (saved before the One person mode was removed) as format 2: the mode
/// and its person go, as do the age-group choices and typed totals that belonged to one person.
pub fn upgrade_v1_payload(payload: &str) -> serde_json::Result<String> {
    use serde_json::Value;
    let mut v: Value = serde_json::from_str(payload)?;
    if let Some(o) = v.as_object_mut() {
        o.insert("formatVersion".into(), Value::from(SETUP_FORMAT_VERSION));
        o.remove("mode");
        o.remove("individualPerson");
        if let Some(Value::Array(choices)) = o.get_mut("cohortChoices") {
            choices.retain(|c| c.get("mode").and_then(Value::as_str) != Some("individual"));
            for c in choices.iter_mut().filter_map(Value::as_object_mut) {
                c.remove("mode");
            }
        }
        if let Some(Value::Array(overrides)) = o.get_mut("manualOverrides") {
            overrides.retain(|m| m.get("subject").is_none_or(Value::is_null));
            for m in overrides.iter_mut().filter_map(Value::as_object_mut) {
                m.remove("subject");
            }
        }
    }
    serde_json::to_string(&v)
}
```

- [ ] **Step 4: Upgrade on load**

In `core/src/store/comparison_setup.rs`, import `upgrade_v1_payload` alongside `SETUP_FORMAT_VERSION`, and replace the version check in `get_comparison_setup` with:

```rust
        let corrupt = |e: serde_json::Error| {
            ComparisonSetupError::Corrupt(format!("{:?} error at line {} column {}", e.classify(), e.line(), e.column()))
        };
        let payload = match format_version {
            SETUP_FORMAT_VERSION => payload,
            1 => upgrade_v1_payload(&payload).map_err(corrupt)?,
            found => return Err(ComparisonSetupError::Unsupported { found }),
        };
        let setup: ComparisonSetup = serde_json::from_str(&payload).map_err(corrupt)?;
```

- [ ] **Step 5: Validation without the mode**

In `core/src/comparisons/validation.rs`:
- Delete the `individual_person` block (`if let Some(r) = &setup.individual_person && !listed(r) { ... }`).
- Manual overrides loop becomes:

```rust
    let mut seen = BTreeSet::new();
    for (i, o) in setup.manual_overrides.iter().enumerate() {
        let field = format!("manualOverrides[{i}]");
        out.unique(&field, &mut seen, o.metric, "This comparison already has a manual total.");
        out.amount(&format!("{field}.amount"), &o.amount, o.metric, ctx);
    }
```

- Cohort choices loop: `out.unique(&field, &mut seen, c.metric, "A cohort is chosen twice for this comparison.");` and `if !pkg.references(c.metric, ComparisonMode::Household).any(|r| r.id == c.reference_id) {` (import `ComparisonMode` from `super::types` if not already imported).
- In `find_repairs`, delete the `individual_person` block and the `manualOverrides[{i}].subject` loop.

- [ ] **Step 6: Metrics without the mode**

In `core/src/comparisons/metrics.rs`:

`Share` and `share_of` become:

```rust
struct Share {
    counted_bp: u32,
    unallocated_bp: u32,
}

/// How much of one source counts for the household, from the person's confirmed allocations. With no
/// allocation the household owns it outright; a share given to someone outside the household (a
/// roommate) is left out, and a share nobody was given is reported, never guessed.
fn share_of(setup: &ComparisonSetup, source: &SourceRef) -> Share {
    let allocs: Vec<_> = setup.allocations.iter().filter(|a| &a.source == source).collect();
    if allocs.is_empty() {
        return Share { counted_bp: BASIS_POINTS, unallocated_bp: 0 };
    }
    let in_household: BTreeSet<&PersonRef> = setup.people.iter().filter(|p| p.in_household).map(|p| &p.person).collect();
    let total: u32 = allocs.iter().map(|a| a.basis_points).sum();
    let counted_bp = allocs.iter().filter(|a| in_household.contains(&a.person)).map(|a| a.basis_points).sum();
    Share { counted_bp, unallocated_bp: BASIS_POINTS.saturating_sub(total) }
}
```

Delete `let _ = share.nobody_allocated;` in `count_source`. Delete `fn subject(...)`. In `income`, replace the outer `match setup.mode { ComparisonMode::Household => match setup.income.household_method { ... }, ComparisonMode::Individual => {...} }` with just the inner `match setup.income.household_method { ... }`. In `spending`, delete the `if setup.mode == ComparisonMode::Individual { ... return out; }` block. In `compute_metric`:

```rust
    let typed: Option<&ManualAmount> = setup
        .manual_overrides
        .iter()
        .find(|o| o.metric == metric)
        .map(|o| &o.amount)
        .or(if metric == MetricId::Spending { setup.spending.manual_annual.as_ref() } else { None });
```

(delete `let who = subject(setup);`). Remove `ComparisonMode` from the `use super::types::{...}` line.

- [ ] **Step 7: Report always compares the household**

In `core/src/comparisons/report.rs`:

```rust
/// The published definition each headline card compares against. A definition the current package
/// no longer carries keeps its card visible as "no longer available".
fn definition_for(metric: MetricId) -> Option<&'static str> {
    match metric {
        MetricId::Income => Some("cps_hinc02_money_income_median"),
        MetricId::Savings => Some("sipp_financial_institution_assets_median"),
        MetricId::Investments => Some("sipp_retirement_accounts_median"),
        MetricId::Debt => Some("sipp_total_debt_median"),
        // Spending has no single definition: the engine uses every household spending reference.
        MetricId::Spending => None,
    }
}
```

- `ComparisonsReport`: delete `pub mode: ComparisonMode,`; the constructor at the end of `build_report` becomes `ComparisonsReport { package_version: pkg.package_version().to_string(), cards }`.
- `subject_age`: `let who = setup.household_reference_person.as_ref()?;` then the existing lookup.
- `cohort_choice`: `.find(|c| c.metric == metric)`.
- `universe_options(pkg, metric, definition)`: drop the `mode` parameter and use `ComparisonMode::Household` inside. Update its call.
- `cohort_options`: both `pkg.references(metric, setup.mode)` become `pkg.references(metric, ComparisonMode::Household)`.
- In `build_report`: `let definition = definition_for(id);`, `mode: ComparisonMode::Household,` in the `CardQuery`, and the secondary-loop guard becomes `if total.is_zero() { continue; }`.

- [ ] **Step 8: Bring the existing tests up to date**

- `setup_tests.rs`: `base_setup` uses `ComparisonSetup::empty()`. Rename `empty_and_base_setups_are_valid_in_both_modes` to `empty_and_base_setups_are_valid` and keep only `assert!(f.problems(&ComparisonSetup::empty()).is_empty());` plus its base-setup assertion. Delete `the_individual_person_must_be_listed`. Rewrite the cohort test:

```rust
#[test]
fn cohort_choices_must_name_a_published_household_cohort_for_that_metric() {
    let f = Fixture::new();
    let choice = |metric, id: &str| CohortChoice { metric, reference_id: id.into() };
    let mut ok = base_setup();
    ok.cohort_choices = vec![choice(MetricId::Income, "h25")];
    assert!(f.problems(&ok).is_empty());
    for bad in [choice(MetricId::Income, "gone"), choice(MetricId::Income, "i25"), choice(MetricId::Debt, "h25")] {
        let mut s = base_setup();
        s.cohort_choices = vec![bad];
        f.assert_rejected(&s, "cohortChoices[0]");
    }
    let mut dup = base_setup();
    dup.cohort_choices = vec![choice(MetricId::Income, "h25"), choice(MetricId::Income, "h25")];
    f.assert_rejected(&dup, "cohortChoices");
}
```

  Manual-override test: `let ov = |metric, v: &str| ManualOverride { metric, amount: amount(v) };`, drop the `subject` argument from every call (the `Some(PersonRef::Owner)` savings entry becomes `ov(MetricId::Savings, "-20")`), and delete the `ghost` block at the end. Line ~406: `CohortChoice { metric: MetricId::Income, reference_id: "h25".into() }`. Remove `ComparisonMode` from the imports if unused.
- `metrics_tests.rs`: `solo_setup` uses `ComparisonSetup::empty()`. Delete these tests: `a_joint_account_is_split_by_confirmed_shares_in_individual_mode`, `in_individual_mode_an_account_nobody_allocated_is_not_assumed_to_be_yours`, `an_account_allocated_wholly_to_someone_else_is_excluded_without_blocking_completeness`, `debt_is_split_by_allocation_in_individual_mode`, `individual_income_is_the_selected_persons_own_confirmed_figure`, `individual_spending_is_not_derived_from_household_transactions`, `an_override_belongs_to_the_selected_individual`. In `a_person_living_alone_owns_unallocated_accounts_outright`, delete the two `setup.mode`/`setup.individual_person` lines (it stays a valid household test). Every `ManualOverride { metric, subject: None, amount }` loses `subject: None,`. Add one roommate test so the household allocation rule stays pinned:

```rust
#[test]
fn a_share_given_to_a_roommate_is_left_out_of_the_household() {
    let snap = snapshot(vec![account(1, "Shared", AccountType::Checking, "1000")]);
    let mut setup = confirmed(couple_setup(), &[MetricId::Savings]);
    setup.allocations = vec![share(acct(1), PersonRef::Owner, 6000), share(acct(1), person(8), 4000)];
    let m = metric(&snap, &setup, MetricId::Savings);
    assert_eq!(m.value, Some(dec("600")));
}
```

- `report_tests.rs`: in `cards_missing_user_input_are_hidden_but_benchmark_gaps_stay_visible` delete the `let mut individual = ...` block through its three asserts. Delete `individual_mode_has_income_and_documents_the_rest_as_unavailable`. Rewrite the cohort test for household income (HINC-02 groups are five years wide, so 40–49 spans 40–44 and 45–49):

```rust
#[test]
fn an_age_band_spanning_published_cohorts_asks_for_a_choice_and_remembers_it() {
    let mut setup = setup_42();
    age(&mut setup, PersonRef::Owner, AgeInput::Band { min: 40, max: Some(49) });
    setup.income.household_total = Some(amount("100000"));
    let c = card(&build_report(bundled(), &setup, &empty_snapshot()), MetricId::Income).clone();
    assert_eq!(c.result.status, CardStatus::CohortChoiceRequired);
    assert_eq!((c.cohort_options[0].age_min, c.cohort_options[1].age_min), (40, 45));

    setup.cohort_choices = vec![CohortChoice { metric: MetricId::Income, reference_id: "cps_hinc02_money_income_median:45-49".into() }];
    let chosen = card(&build_report(bundled(), &setup, &empty_snapshot()), MetricId::Income).clone();
    assert_eq!(chosen.result.status, CardStatus::Comparable);
    assert_eq!(chosen.result.reference.unwrap().reference.age_min, 45);
    assert_eq!(chosen.cohort_options.len(), 2, "the choice can be changed later");
}
```

  Any other report test that sets `setup.mode`/`individual_person` (check with `grep -n "mode\|individual" core/tests/comparisons/report_tests.rs`) is deleted if it only exercised individual mode.
- `store_tests.rs`: in `a_stale_revision_is_a_conflict_and_changes_nothing`, replace `changed.mode = ComparisonMode::Individual;` with `changed.household_reference_person = None;`. In `cohort_choices_are_checked_against_the_bundled_package`, use `CohortChoice { metric: MetricId::Income, reference_id: "cps_hinc02_money_income_median:25-29".into() }`.
- `snapshot_tests.rs`: `ComparisonSetup::empty()` (two places).
- Remove now-unused `ComparisonMode` imports in the test files (the compiler warns).

- [ ] **Step 9: Run the core suite**

Run: `cargo test -p budget_core --test comparisons`
Expected: PASS, including the new store test. Then `cargo test --workspace` — `src-tauri` must still compile (`grep -n "ComparisonSetup::empty\|\.mode" src-tauri/src/*.rs` should show nothing to fix; fix anything that does).

- [ ] **Step 10: Commit**

```bash
git add core/ src-tauri/
git commit -m "Store comparisons as one household setup (format 2), reading older One person setups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(The frontend still sends format 1 until Task 3; do not run the app between these commits.)

---

### Task 2: Personal income lines and the per-person hint in the report

**Files:**
- Modify: `core/src/comparisons/report.rs` (`SecondaryCard`, `CardView`, new `personal_income_lines`, `build_report`)
- Test: `core/tests/comparisons/report_tests.rs`

**Interfaces:**
- Consumes: Task 1's `ComparisonSetup` (no mode), `definition_for(metric)`.
- Produces (serialized camelCase for the frontend): `SecondaryCard { label: String, definition_id: String, person: Option<PersonRef>, result: ComparisonCardResult }`; `CardView.personal_income_hint: bool`.

- [ ] **Step 1: Write the failing report tests**

Add to `core/tests/comparisons/report_tests.rs`:

```rust
const PERSONAL: &str = "cps_pinc01_money_income_median";

fn by_person(setup: &mut ComparisonSetup, incomes: &[(PersonRef, &str)]) {
    setup.income.household_method = HouseholdIncomeMethod::ByPerson;
    setup.income.per_person = incomes.iter().map(|(p, v)| PersonIncome { person: p.clone(), gross_annual: amount(v) }).collect();
}

fn personal_lines(report: &ComparisonsReport) -> Vec<&SecondaryCard> {
    card(report, MetricId::Income).secondary.iter().filter(|s| s.definition_id == PERSONAL).collect()
}

#[test]
fn each_household_member_with_an_income_and_an_age_gets_a_personal_line() {
    let mut setup = setup_42();
    age(&mut setup, person(7), AgeInput::Exact { age: 31 });
    by_person(&mut setup, &[(PersonRef::Owner, "78000"), (person(7), "64000")]);
    let report = build_report(bundled(), &setup, &empty_snapshot());
    let lines = personal_lines(&report);
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].person, Some(PersonRef::Owner));
    let owner = lines[0].result.reference.as_ref().unwrap();
    assert_eq!((owner.reference.age_min, owner.reference.age_max), (40, Some(44)));
    assert_eq!(lines[0].result.local_value, Some(dec("78000")));
    assert_eq!(lines[0].result.status, CardStatus::Comparable);
    assert_eq!(lines[1].person, Some(person(7)));
    assert_eq!(lines[1].result.reference.as_ref().unwrap().reference.id, format!("{PERSONAL}:30-34"));
    assert!(!card(&report, MetricId::Income).personal_income_hint);
}

#[test]
fn a_member_without_an_age_or_an_income_gets_no_line_and_a_roommate_never_does() {
    let mut setup = setup_42();
    age(&mut setup, person(8), AgeInput::Exact { age: 29 });
    // 7 shares the finances but has no age; 8 is a roommate with an age and an old income entry.
    by_person(&mut setup, &[(PersonRef::Owner, "78000"), (person(7), "64000"), (person(8), "40000")]);
    let report = build_report(bundled(), &setup, &empty_snapshot());
    let people: Vec<_> = personal_lines(&report).iter().map(|s| s.person.clone()).collect();
    assert_eq!(people, vec![Some(PersonRef::Owner)]);
}

#[test]
fn an_age_range_spanning_two_personal_age_groups_asks_for_an_exact_age_instead_of_guessing() {
    let mut setup = setup_42();
    age(&mut setup, PersonRef::Owner, AgeInput::Band { min: 40, max: Some(49) });
    by_person(&mut setup, &[(PersonRef::Owner, "78000")]);
    let report = build_report(bundled(), &setup, &empty_snapshot());
    let line = personal_lines(&report)[0];
    assert_eq!(line.result.status, CardStatus::CohortChoiceRequired);
    assert!(line.result.dollar_difference.is_none());
}

#[test]
fn a_zero_or_negative_personal_income_is_not_compared_with_people_who_have_income() {
    let mut setup = setup_42();
    by_person(&mut setup, &[(PersonRef::Owner, "-500")]);
    let report = build_report(bundled(), &setup, &empty_snapshot());
    let line = personal_lines(&report)[0];
    assert_eq!(line.result.status, CardStatus::NotComparable);
    assert!(line.result.percent_difference.is_none());
}

#[test]
fn a_household_total_shows_the_hint_and_no_personal_lines_even_with_old_per_person_entries() {
    let mut setup = setup_42();
    by_person(&mut setup, &[(PersonRef::Owner, "78000")]);
    setup.income.household_method = HouseholdIncomeMethod::Total;
    setup.income.household_total = Some(amount("120000"));
    let report = build_report(bundled(), &setup, &empty_snapshot());
    assert!(personal_lines(&report).is_empty());
    assert!(card(&report, MetricId::Income).personal_income_hint);
    assert!(!card(&report, MetricId::Savings).personal_income_hint, "the hint belongs to the Income card only");
}
```

The `-500` case relies on PINC-01 being a holders-only figure (every bundled `cps_pinc01` record has `universe: holders`), so the engine's step 3 returns `NotComparable` for a zero or negative local value with `holds_item` false. `personal_income_lines` sets `holds_item` to `value > 0` for exactly this reason.

Add `SecondaryCard` to the `use budget_core::comparisons::report::{...}` import.

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test -p budget_core --test comparisons personal -- --nocapture`
Expected: FAIL to compile (`person` / `personal_income_hint` do not exist).

- [ ] **Step 3: Implement**

In `core/src/comparisons/report.rs`, add `person` to `SecondaryCard`:

```rust
pub struct SecondaryCard {
    pub label: String,
    pub definition_id: String,
    /// The household member a personal line is about; `None` for a breakdown of the household's own figure.
    pub person: Option<PersonRef>,
    pub result: ComparisonCardResult,
}
```

Add to `CardView` (after `stale`):

```rust
    /// Income card only: income is entered as one household total, so no one's own pay can be compared.
    pub personal_income_hint: bool,
```

Add the builder (imports: `HouseholdIncomeMethod, PersonRef` from `super::setup`, `Unit` from `super::types`):

```rust
const PERSONAL_INCOME: &str = "cps_pinc01_money_income_median";

/// Each household member's own yearly income against the median for people their age, when income
/// is entered per person. A member with no income entry or no age gets no line; a roommate never does.
fn personal_income_lines(pkg: &Package, setup: &ComparisonSetup) -> Vec<SecondaryCard> {
    if setup.income.household_method != HouseholdIncomeMethod::ByPerson {
        return Vec::new();
    }
    setup
        .people
        .iter()
        .filter(|p| p.in_household)
        .filter_map(|p| {
            let age = p.age.as_ref()?.age;
            let income = &setup.income.per_person.iter().find(|e| e.person == p.person)?.gross_annual;
            let query = CardQuery {
                metric: MetricId::Income,
                mode: ComparisonMode::Individual,
                definition_id: Some(PERSONAL_INCOME),
                age: Some(age),
                selected_cohort: None,
                universe_preference: None,
                local: LocalMeasure {
                    value: Some(income.value),
                    unit: Unit::UsdPerYear,
                    holds_item: income.value > Decimal::ZERO,
                    completeness: Completeness::Confirmed,
                },
            };
            Some(SecondaryCard {
                label: "Personal income".into(),
                definition_id: PERSONAL_INCOME.into(),
                person: Some(p.person.clone()),
                result: compare(pkg, &query),
            })
        })
        .collect()
}
```

(`rust_decimal::Decimal` import if `report.rs` does not have it.) In `build_report`, set `person: None` on the existing `SecondaryCard { ... }` in the class loop, and after that loop:

```rust
            if id == MetricId::Income {
                secondary.extend(personal_income_lines(pkg, setup));
            }
```

and in the `CardView { ... }` literal:

```rust
                personal_income_hint: id == MetricId::Income && setup.income.household_method == HouseholdIncomeMethod::Total,
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p budget_core --test comparisons`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/
git commit -m "Compare each household member's own income with people their age in the Income details

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend — remove the mode from the setup, setup dialog, details panel and page

**Files:**
- Modify: `src/comparisons/types.ts:44-60, 178-193`
- Modify: `src/comparisons/setupDraft.ts:1-60, 156-168`
- Modify: `src/comparisons/ComparisonSetupDialog.tsx`
- Modify: `src/comparisons/ComparisonDetailsPanel.tsx`
- Modify: `src/comparisons/ComparisonsView.tsx:85-95, 150-185`
- Modify: `src/comparisons/ComparisonCard.tsx:40-55, 158`
- Modify: `src/comparisons/fieldTips.ts`
- Modify: `src/comparisons/testFixtures.ts`
- Test: `src/comparisons/setupDraft.test.ts`, `ComparisonSetupDialog.test.tsx`, `ComparisonDetailsPanel.test.tsx`, `ComparisonsView.test.tsx`, `ComparisonCard.test.tsx`

**Interfaces:**
- Consumes: Task 1/2 JSON shapes.
- Produces: `emptySetup(): ComparisonSetup`; `setCohortChoice(setup, metric, referenceId | null)`; `setManualOverride(setup, metric, amount | null)`; `setReferencePerson(setup, person)` sets `householdReferencePerson`; `CardView.secondary[]` has `person: PersonRef | null`; `CardView.personalIncomeHint: boolean`; `ComparisonsReport` has no `mode`. `setMode` is deleted.

- [ ] **Step 1: Write the failing tests**

`src/comparisons/setupDraft.test.ts` — replace the mode-related cases and the manual-total case (`it("sets, replaces and removes a manual total per metric and subject", ...)`) with:

```ts
it("starts empty as a household setup in format 2", () => {
  const s = emptySetup();
  expect(s.formatVersion).toBe(2);
  expect("mode" in s).toBe(false);
  expect("individualPerson" in s).toBe(false);
});

it("sets, replaces and removes a manual total per metric", () => {
  const a = { value: "100", measuredOn: "2026-09-01", explanation: "" };
  let s = setManualOverride(emptySetup(), "savings", a);
  s = setManualOverride(s, "savings", { ...a, value: "200" });
  expect(s.manualOverrides).toEqual([{ metric: "savings", amount: { ...a, value: "200" } }]);
  expect(setManualOverride(s, "savings", null).manualOverrides).toEqual([]);
});

it("remembers one age-group choice per metric", () => {
  let s = setCohortChoice(emptySetup(), "income", "cps_hinc02_money_income_median:40-44");
  s = setCohortChoice(s, "income", "cps_hinc02_money_income_median:45-49");
  expect(s.cohortChoices).toEqual([{ metric: "income", referenceId: "cps_hinc02_money_income_median:45-49" }]);
});
```

Fix every other `emptySetup("household")` call in this file to `emptySetup()`; delete tests that call `setMode` or read `individualPerson`.

`ComparisonSetupDialog.test.tsx` — add:

```ts
it("has no household / one person choice", async () => {
  await mount();
  expect(document.querySelector("button[aria-label^='Compare']")).toBeNull();
  expect(document.body.textContent).not.toContain("One person");
});
```

(use the file's existing mount helper's name). Delete any test that switches to "individual".

`ComparisonDetailsPanel.test.tsx` — add:

```ts
it("has no comparison mode or person-compared controls", async () => {
  api.getComparisonSetup.mockResolvedValue(response(stored()));
  await mount();
  expect(container.querySelector("button[aria-label^='Comparison mode']")).toBeNull();
  expect(container.querySelector("button[aria-label^='Person compared']")).toBeNull();
  expect(container.querySelector("button[aria-label^='Household reference person']")).not.toBeNull();
});
```

In the household tip list test, remove `"Compare"` from the expected labels and the `expect(tipText("Compare"))...` line. Delete `it("explains the person compared when comparing one person", ...)`. Make `stored()` (and any setup literal in this file) drop `mode`/`individualPerson`, use `formatVersion: 2`, and drop `subject` from manual overrides.

`ComparisonsView.test.tsx` / `ComparisonCard.test.tsx` — delete tests about the person bar (`data-cmp-person-bar`) or an "Individual" source label; drop the `mode` prop from every `<ComparisonCard ... />` render.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/comparisons`
Expected: FAIL (type errors / `formatVersion` 1 / controls still present).

- [ ] **Step 3: Types and draft helpers**

`src/comparisons/types.ts` — `ComparisonSetup` loses `mode` and `individualPerson`; `manualOverrides: { metric: MetricId; amount: ManualAmount }[];`; `cohortChoices: { metric: MetricId; referenceId: string }[];`. `CardView`:

```ts
  secondary: { label: string; definitionId: string; person: PersonRef | null; result: ComparisonCardResult }[];
  // ...existing fields...
  stale: boolean;
  /** Income card only: income is one household total, so no one's own pay is compared. */
  personalIncomeHint: boolean;
```

`ComparisonsReport` loses `mode`. Keep the `ComparisonMode` type (used by `Reference.mode`).

`src/comparisons/setupDraft.ts`:

```ts
export const SETUP_FORMAT_VERSION = 2;

export function emptySetup(): ComparisonSetup {
  return {
    formatVersion: SETUP_FORMAT_VERSION,
    householdReferencePerson: null,
    people: [],
    // ...rest unchanged
  };
}

export const setReferencePerson = (setup: ComparisonSetup, person: PersonRef | null): ComparisonSetup => ({ ...setup, householdReferencePerson: person });

export function setManualOverride(setup: ComparisonSetup, metric: MetricId, amount: ManualAmount | null): ComparisonSetup {
  const kept = setup.manualOverrides.filter((o) => o.metric !== metric);
  return { ...setup, manualOverrides: amount ? [...kept, { metric, amount }] : kept };
}

export function setCohortChoice(setup: ComparisonSetup, metric: MetricId, referenceId: string | null): ComparisonSetup {
  const kept = setup.cohortChoices.filter((c) => c.metric !== metric);
  return { ...setup, cohortChoices: referenceId ? [...kept, { metric, referenceId }] : kept };
}
```

Delete `setMode` and the `ComparisonMode` import. Check `samePerson` is still used (`grep -n samePerson src/comparisons`); delete it if not.

`src/comparisons/testFixtures.ts`: `secondary` entries need `person: null`; add `personalIncomeHint: false` to `comparableIncome`, `unavailable` and `hidden`; `response()` report becomes `{ packageVersion: "2026.09.1", cards }`.

- [ ] **Step 4: Setup dialog**

`src/comparisons/ComparisonSetupDialog.tsx`:
- Delete the `mode` state, the whole "Compare" `<div className="modal-field">…</div>` block, and the `ComparisonMode`/`setMode` imports.
- `const choices = inHousehold;` and the draft line becomes `let draft = syncPeople(emptySetup(), members);`.
- "Who shares your finances?" renders when `members.length > 0` (drop `mode === "household" &&`).
- The person picker: label and InfoTip label `"Whose age should we use?"`, `text={FIELD_TIPS.subjectHousehold}`, `ariaLabel="Reference person"`.
- Update the component doc comment: `/** The light first-use setup: whose age to use, and who shares the finances. ... */` (keep the rest of the existing sentence).

- [ ] **Step 5: Details panel**

`src/comparisons/ComparisonDetailsPanel.tsx`:
- Delete the "Compare" `cmp-settings-row` (the `MenuSelect` with `ariaLabel="Comparison mode"`).
- Replace the subject variables with `const subject = draft.householdReferencePerson;` and use `inHousehold` for the options; the row label and InfoTip label become `"Age used for the household"`, `text={FIELD_TIPS.subjectHousehold}`, `ariaLabel="Household reference person"`. Delete `subjectChoices` and `subjectForOverrides`.
- Income section: keep only the former household branch (the `<>…</>` with the method picker and the total/by-person editors); delete the `: (draft.individualPerson && …)` branch.
- Spending section: `{draft.mode === "household" && (` becomes unconditional (render the section always).
- Manual totals: drop `.filter((m) => m !== "spending" || draft.mode === "household")`; each editor:

```tsx
            <AmountEditor
              key={m}
              label={`${metricTitle(m)}: your own total`}
              value={draft.manualOverrides.find((o) => o.metric === m)?.amount ?? null}
              onChange={(a) => edit((s) => setManualOverride(s, m, a))}
              hint={MANUAL_HINT[m]}
              tip={FIELD_TIPS.manualTotal[m]}
            />
```

- `emptySetup("household")` → `emptySetup()`. Remove `setMode`, `ComparisonMode` and (if now unused) `PersonRef` imports. Update the component doc comment (line ~82) to drop "household or individual mode".

`src/comparisons/fieldTips.ts`: delete `compare` and `subjectIndividual`. `subjectHousehold` stays as is (it does not mention the mode).

- [ ] **Step 6: Page and card**

`src/comparisons/ComparisonsView.tsx`: delete `const mode = ...`, the whole `{report && setup && mode === "individual" && (<div className="cmp-person-bar" …>…</div>)}` block, the `mode={mode}` prop, and change the cohort callback to `onChooseCohort={(id) => void patchSetup((s) => setCohortChoice(s, view.result.metric, id))}`. Remove imports that become unused (`setReferencePerson`, `MenuSelect`, `personKey`, `personLabel` — check each with the compiler). Update the doc comment at line ~24 to drop "mode,".

`src/comparisons/ComparisonCard.tsx`: delete the `mode` prop from the signature and type; line ~158 becomes `<span className="cmp-source">{adjusted ? sourceLabel(adjusted.reference.sourceId) : "Household"}</span>`. Drop the `ComparisonMode` import.

Delete the now-unused `.cmp-person-bar` / `.cmp-person-label` rules in `src/comparisons/Comparisons.css` (`grep -n "cmp-person-bar\|cmp-person-label" src -r` must show only CSS before deleting).

- [ ] **Step 7: Run the tests and the type check**

Run: `npx vitest run src/comparisons && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/
git commit -m "Remove the household / one person choice from the comparison screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — personal income lines and the hint in the Income details

**Files:**
- Modify: `src/comparisons/ComparisonDetailsDialog.tsx:38-60, 130-152`
- Modify: `src/comparisons/ComparisonsView.tsx:232` (pass `members`)
- Test: `src/comparisons/ComparisonDetailsDialog.test.tsx`

**Interfaces:**
- Consumes: `CardView.secondary[].person`, `CardView.personalIncomeHint` (Task 3 types), `personLabel(person, members)` and `ageGroupLabel(min, max)` from `./format`.
- Produces: `ComparisonDetailsDialog({ view, members, onClose })` with `members: { id: number; name: string }[]`.

- [ ] **Step 1: Write the failing tests**

In `ComparisonDetailsDialog.test.tsx`, change `show` to pass members and add the cases:

```tsx
const MEMBERS = [{ id: 7, name: "Jordan" }];
const show = (view: CardView) =>
  act(() => root.render(<ComparisonDetailsDialog view={view} members={MEMBERS} onClose={() => {}} />));

const personal = (person: CardView["secondary"][number]["person"], over: Partial<ComparisonCardResult>) => ({
  label: "Personal income",
  definitionId: "cps_pinc01_money_income_median",
  person,
  result: { ...comparableIncome().result, ...over },
});

it("lists each person's own income against people their age", () => {
  show({
    ...comparableIncome(),
    secondary: [
      personal({ kind: "owner" }, { localValue: "78000", reference: adjusted({ id: "cps_pinc01_money_income_median:40-44", ageMin: 40, ageMax: 44 }, "66000") }),
      personal({ kind: "member", id: 7 }, { localValue: "64000", reference: adjusted({ id: "cps_pinc01_money_income_median:30-34", ageMin: 30, ageMax: 34 }, "58000") }),
    ],
  });
  const t = text();
  expect(t).toContain("Each person's income");
  expect(t).toContain("Me, compared with ages 40–44");
  expect(t).toContain("$78,000 vs $66,000");
  expect(t).toContain("Jordan, compared with ages 30–34");
  expect(t).toContain("$64,000 vs $58,000");
  expect(document.querySelectorAll("[data-cmp-personal]").length).toBe(2);
});

it("asks for an exact age when a person's range spans two age groups", () => {
  show({
    ...comparableIncome(),
    secondary: [personal({ kind: "member", id: 7 }, { status: "cohort_choice_required", localValue: null, reference: null, dollarDifference: null, percentDifference: null })],
  });
  expect(text()).toContain("Enter an exact age, or a range inside one age group, to compare Jordan's income.");
});

it("suggests entering income per person when it is one household total", () => {
  show({ ...comparableIncome(), personalIncomeHint: true });
  expect(text()).toContain("Enter income for each person to also see how each person's pay compares with people their age.");
});
```

Import `ComparisonCardResult` from `./types`. Every other existing `render(<ComparisonDetailsDialog …/>)` in the file goes through `show`, so it picks up `members`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/comparisons/ComparisonDetailsDialog.test.tsx`
Expected: FAIL (text not found / `members` prop unknown).

- [ ] **Step 3: Implement**

`ComparisonDetailsDialog.tsx`: accept `members` and split the secondary lines:

```tsx
export function ComparisonDetailsDialog({
  view,
  members,
  onClose,
}: {
  view: CardView;
  members: { id: number; name: string }[];
  onClose: () => void;
}) {
  // ...existing locals...
  const breakdown = view.secondary.filter((s) => s.person === null);
  const personal = view.secondary.filter((s) => s.person !== null);
```

The existing "Also compared" section maps `breakdown` instead of `view.secondary` (and its condition becomes `breakdown.length > 0`). Add, right after it:

```tsx
        {(personal.length > 0 || view.personalIncomeHint) && (
          <section>
            <h3 className="cmp-details-heading">Each person&apos;s income</h3>
            {view.personalIncomeHint && (
              <p className="modal-message-secondary" data-cmp-personal-hint>
                Enter income for each person to also see how each person&apos;s pay compares with people their age.
              </p>
            )}
            {personal.map((s) => {
              const name = personLabel(s.person!, members);
              const ref = s.result.reference;
              if (s.result.status === "cohort_choice_required") {
                return (
                  <p key={personKey(s.person!)} className="modal-message-secondary" data-cmp-personal={personKey(s.person!)}>
                    Enter an exact age, or a range inside one age group, to compare {name}&apos;s income.
                  </p>
                );
              }
              const n = cardNotice(s.result);
              return (
                <div key={personKey(s.person!)} className="cmp-breakdown" data-cmp-personal={personKey(s.person!)}>
                  <span>
                    {ref ? `${name}, compared with ages ${ageGroupLabel(ref.reference.ageMin, ref.reference.ageMax)}` : name}
                    {n && <span className="cmp-share"> · {n.title}</span>}
                  </span>
                  <b>
                    {s.result.dollarDifference !== null && ref
                      ? `${formatWhole(s.result.localValue ?? "0")} vs ${formatWhole(ref.adjustedValue)}`
                      : s.result.localValue !== null
                        ? formatWhole(s.result.localValue)
                        : "—"}
                  </b>
                </div>
              );
            })}
          </section>
        )}
```

Imports: add `personLabel` to the `./format` import and `import { personKey } from "./setupDraft";`. If `cardNotice` on a `not_comparable` result gives a title, it appears after the name, as it already does for breakdown lines.

`ComparisonsView.tsx:232`: `<ComparisonDetailsDialog view={exploringCard} members={members} onClose={() => setExploring(null)} />` (`members` is already defined in that component — confirm with `grep -n "const members" src/comparisons/ComparisonsView.tsx`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/comparisons && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "Show each person's income against people their age in the Income details

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Help text, e2e specs and full verification

**Files:**
- Modify: `src/HelpView.tsx:822-860` (Comparisons FAQ)
- Modify: `e2e/lib/comparisons.mjs:68-100`
- Rename + rewrite: `e2e/feature149_comparisons_individual_mode.mjs` → `e2e/feature149_comparisons_personal_income.mjs`
- Modify: `e2e/feature148_comparisons_totals_and_staleness.mjs:27`
- Check: `e2e/feature144_comparisons_navigation.mjs`, `feature145_comparisons_metrics.mjs`, `feature151_comparisons_info_tips.mjs` (any "Compare" tip or mode control), `e2e/.e2e-durations.json` (old spec name — leave it; it rebuilds itself)

- [ ] **Step 1: Help text**

In `src/HelpView.tsx`, in the Comparisons FAQ:
- Replace `, where you also switch between your household and one person.` with `.`.
- Replace the parenthetical `(savings, investments, debt and spending are published for households, not for one person)` with nothing (keep the sentence: "When the reference data has no figure for a comparison, its card says so and nothing is substituted.").
- Add a paragraph after the "Income is before tax" paragraph:

```tsx
        <p>
          <strong>Each person&apos;s income.</strong> Everything is compared for your household as a whole. If you enter
          income separately for each person, the Income card&apos;s Explore view also shows each person&apos;s own pay next
          to the typical pay of people their age.
        </p>
```

Run `npx vitest run src/HelpView` (and `src/paletteSearch.test.ts` if it indexes Help text); fix any test that searched for "one person".

- [ ] **Step 2: E2E fixtures write format 2**

`e2e/lib/comparisons.mjs`: in `setupSnippet`, the SQL `VALUES (1, 1, 1, ?, …)` becomes `VALUES (1, 2, 1, ?, …)`. In `baseSetup`: `formatVersion: 2`, delete `mode` and `individualPerson`. In `e2e/feature148_comparisons_totals_and_staleness.mjs:27`, drop `subject: null, ` from the manual override. Search for any other literal setups: `grep -rn "individualPerson\|mode: \"household\"\|subject:" e2e/*.mjs e2e/lib/*.mjs` and fix each the same way.

- [ ] **Step 3: Rewrite feature149 as the personal income spec**

`git mv e2e/feature149_comparisons_individual_mode.mjs e2e/feature149_comparisons_personal_income.mjs`, then replace its body after the imports with:

```js
// Reports > Comparisons, personal income, in the real compiled app:
//   - there is no household / one person choice anywhere in Your details;
//   - with income entered for each person, the Income card's Explore view lists each household member's own
//     pay against the median for people their age (Census PINC-01), with the right age group;
//   - with one household total, it suggests entering income per person instead;
//   - the lines survive a restart.
//
// Run with: node e2e/feature149_comparisons_personal_income.mjs
import assert from "node:assert/strict";
import { chooseMenuOption, launchApp } from "./harness.mjs";
import { adjusted, metric, openComparisonDetails, openReportsTab, saveSettings, seedComparisonHousehold, setInput, waitForCards, whole } from "./lib/comparisons.mjs";

const dbDir = await seedComparisonHousehold(); // Me (42) and Partner (67), one household total of $100,000

async function openIncomeDetails(browser) {
  await (await (await metric(browser, "income")).$(".cmp-explore")).click();
  await browser.$("[data-cmp-details='income']").waitForDisplayed({ timeout: 15000 });
}
async function closeDetails(browser) {
  await (await browser.$(".modal-panel .modal-secondary")).click();
}

let app = await launchApp({ dbDir });
try {
  let { browser } = app;
  await browser.setWindowSize(1440, 1600);
  await openReportsTab(browser, "comparisons");
  await waitForCards(browser, { count: 5 });

  // One household total: a hint, no personal lines.
  await openIncomeDetails(browser);
  assert.ok(await (await browser.$("[data-cmp-personal-hint]")).isExisting(), "a household total suggests entering income per person");
  assert.equal((await browser.$$("[data-cmp-personal]")).length, 0);
  await closeDetails(browser);

  // No mode control anywhere.
  await openComparisonDetails(browser);
  assert.equal((await browser.$$("button[aria-label^='Comparison mode']")).length, 0, "no household / one person choice");
  assert.ok(!(await (await browser.$("[data-cmp-settings]")).getText()).includes("One person"));

  // Income per person.
  await chooseMenuOption(await browser.$("button[aria-label^='Household income method']"), { value: "by_person" });
  await setInput(browser, "input[aria-label='Me: income per year']", "78000");
  await setInput(browser, "[data-cmp-amount='Me: income per year'] input[placeholder^='Where this came from']", "Pay stub");
  await setInput(browser, "input[aria-label='Partner: income per year']", "40000");
  await setInput(browser, "[data-cmp-amount='Partner: income per year'] input[placeholder^='Where this came from']", "Pension letter");
  await saveSettings(browser);

  const check = async () => {
    await openIncomeDetails(browser);
    const me = await browser.$("[data-cmp-personal='owner']");
    await me.waitForExist({ timeout: 20000, timeoutMsg: "Me should get a personal income line" });
    const meText = await me.getText();
    assert.ok(meText.includes("ages 40–44"), `Me (42) is compared with ages 40–44, got: ${meText}`);
    assert.ok(meText.includes(`${whole(78000)} vs ${whole(adjusted("cps_pinc01_money_income_median:40-44").adjusted)}`), meText);
    const partner = await (await browser.$("[data-cmp-personal='member:1']")).getText();
    assert.ok(partner.includes("ages 65–69"), `Partner (67) is compared with ages 65–69, got: ${partner}`);
    assert.ok(partner.includes(`${whole(40000)} vs ${whole(adjusted("cps_pinc01_money_income_median:65-69").adjusted)}`), partner);
    assert.equal((await browser.$$("[data-cmp-personal-hint]")).length, 0);
    await closeDetails(browser);
  };
  await check();

  // Still there after a restart.
  await app.close();
  app = await launchApp({ dbDir });
  browser = app.browser;
  await browser.setWindowSize(1440, 1600);
  await openReportsTab(browser, "comparisons");
  await waitForCards(browser, { count: 5 });
  await check();

  console.log("FEATURE 149 E2E TEST PASSED");
} finally {
  await app.close();
}
```

`whole` and `adjusted` are both exported from `e2e/lib/comparisons.mjs` already. Confirm the income-method `MenuSelect`'s aria label (`ariaLabel="Household income method"` in `ComparisonDetailsPanel.tsx`) and the per-person label format (`` `${personLabel(...)}: income per year` ``; the fixture's member is named "Partner").

- [ ] **Step 4: Check the other comparison specs**

Run: `grep -n "Comparison mode\|Person compared\|individual\|data-cmp-person-bar\|\"Compare\"" e2e/feature14*.mjs e2e/feature15*.mjs`
Fix every hit: remove assertions about the mode control; feature151's tip list loses `"Compare"`.

- [ ] **Step 5: Build and run everything**

```bash
npm test
cargo test --workspace
npx tsc --noEmit
npx tauri build --debug --no-bundle
npm run e2e:smoke
npm run e2e
```

Expected: all pass. `npm run e2e` is the full parallel suite (release work); report its summary line. If a spec fails, use superpowers:systematic-debugging before changing anything.

- [ ] **Step 6: Commit**

```bash
git add src/HelpView.tsx e2e/
git commit -m "Update Help and the e2e specs for household-only comparisons with personal income lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
