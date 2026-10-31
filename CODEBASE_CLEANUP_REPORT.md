# Codebase Cleanup Report

**Status: INCOMPLETE.** Full repository review coverage has not been achieved.

Scope: all tracked maintained text sources, tests, scripts, configuration, documentation, SVGs and maintained data/fixtures. No file is marked reviewed merely because it was enumerated, searched, linted or tested. SVG entries specify complete structural evaluation of the XML documents; this does not claim visual inspection. Generated lockfiles/types, binary assets/fixtures and third-party vendor implementation are explicitly excluded below. The vendor patch description remains in scope. Ignored/untracked build output, node_modules, target, temporary databases and local evidence are outside the tracked inventory.

Base commit: `d022f21`. The six pre-existing cleanup changes were preserved. This report was explicitly requested in the repository root. Supporting review state and the generator are archived under `E:/misc/Programming/Claude/codebase-cleanup-continuation-2026-10-30`; active copies are in the OS temporary folder. SHA-bound reviewed entries can be resumed without repeating inventory-only work.

Backlog handoff, 2026-10-30: at the owner's request, the remaining review and deferred fixes are recorded in the Open item "Complete the repository-wide code cleanup and deferred fixes" in `E:/misc/Programming/Agents/backlog.md`. That shared backlog is outside this Git repository. This report preserves the complete file checklist and finding details in the cleanup commit; the backlog records priorities, resumption evidence and acceptance criteria. The inventory below is a snapshot of the original 1,767 tracked inputs, with this report recorded separately as a new deliverable.

## Repository inventory

- Tracked input files: 1767.
- Relevant files: 1577.
- Reviewed files with current content hashes: 389.
- Modified tracked input files: 38 (includes the six starting changes).
- Unchanged tracked input files: 1729.
- Reviewed files unchanged: 351.
- Excluded tracked files: 190.
- Files requiring additional review: 1188.
- This report is an additional maintained deliverable, self-checked for inventory arithmetic and required sections; it is recorded separately from the original tracked input denominator.

## Coverage by directory

| Directory | Relevant | Reviewed | Modified | Excluded | Resolved / deferred findings | Review status |
| --- | ---: | ---: | --- | ---: | --- | --- |
| `.` | 17 | 17 | Architecture.md | 2 | ROOT-01, ROOT-02, DEPS01 | SOURCE REVIEWED |
| `.claude` | 1 | 1 | None | 0 | None identified in evaluated files | SOURCE REVIEWED |
| `.claude/skills/run-vault-spend` | 2 | 2 | SKILL.md, explore.mjs | 0 | GUIDE-01 | SOURCE REVIEWED |
| `.github/workflows` | 4 | 4 | None | 0 | CI-01, CI-02, CI-03, CI-04 | SOURCE REVIEWED |
| `.vscode` | 1 | 1 | None | 0 | None identified in evaluated files | SOURCE REVIEWED |
| `core` | 1 | 1 | None | 0 | None identified in evaluated files | SOURCE REVIEWED |
| `core/data/benchmarks` | 0 | 0 | None | 3 | Not evaluated yet | EXCLUDED |
| `core/data/statement_layouts` | 8 | 8 | None | 0 | None identified in evaluated files | SOURCE REVIEWED |
| `core/examples` | 2 | 2 | categorizer_eval.rs, real_statement_check.rs | 0 | EXAMPLE-01, EXAMPLE-02 | SOURCE REVIEWED |
| `core/src` | 17 | 16 | csv_loader.rs, qif_loader.rs | 2 | IMPORT01, IMPORT02, FSUTIL01, IMPORT03, IMPORT04, IMPORT05 | PENDING / PARTIAL |
| `core/src/bin` | 1 | 1 | None | 0 | None identified in evaluated files | SOURCE REVIEWED |
| `core/src/comparisons` | 10 | 10 | None | 0 | COMPARE01, COMPARE02, COMPARE03, COMPARE04 | SOURCE REVIEWED |
| `core/src/protection` | 6 | 6 | kdf.rs, keyfile.rs | 0 | PROTECT-02, PROTECT-03, PROTECT-01 | SOURCE REVIEWED |
| `core/src/statement` | 14 | 14 | None | 0 | STATEMENT01, STATEMENT02, STATEMENT03 | SOURCE REVIEWED |
| `core/src/store` | 33 | 11 | categories.rs | 0 | STORE01, STORE02, STORE03 | PENDING / PARTIAL |
| `core/src/store/mobile_snapshot` | 5 | 5 | None | 0 | MOBILESTORE01 | SOURCE REVIEWED |
| `core/src/store/tests` | 30 | 6 | None | 0 | None identified in evaluated files | PENDING / PARTIAL |
| `core/tests` | 4 | 4 | None | 0 | None identified in evaluated files | SOURCE REVIEWED |
| `core/tests/comparisons` | 11 | 11 | None | 0 | COMPARE01, COMPARE02, COMPARE03, COMPARE04 | SOURCE REVIEWED |
| `core/tests/fixtures` | 8 | 8 | None | 0 | None identified in evaluated files | SOURCE REVIEWED |
| `core/vendor/office_oxide` | 2 | 2 | None | 5 | VENDOR01, VENDOR02 | SOURCE REVIEWED |
| `core/vendor/office_oxide/src` | 0 | 0 | None | 17 | Not evaluated yet | EXCLUDED |
| `core/vendor/office_oxide/src/cfb` | 0 | 0 | None | 6 | Not evaluated yet | EXCLUDED |
| `core/vendor/office_oxide/src/core` | 1 | 1 | None | 13 | VENDOR01, VENDOR02 | SOURCE REVIEWED |
| `core/vendor/office_oxide/src/doc` | 0 | 0 | None | 8 | Not evaluated yet | EXCLUDED |
| `core/vendor/office_oxide/src/docx` | 0 | 0 | None | 14 | Not evaluated yet | EXCLUDED |
| `core/vendor/office_oxide/src/ppt` | 0 | 0 | None | 7 | Not evaluated yet | EXCLUDED |
| `core/vendor/office_oxide/src/pptx` | 0 | 0 | None | 8 | Not evaluated yet | EXCLUDED |
| `core/vendor/office_oxide/src/xls` | 0 | 0 | None | 7 | Not evaluated yet | EXCLUDED |
| `core/vendor/office_oxide/src/xlsx` | 1 | 1 | None | 11 | VENDOR01, VENDOR02 | SOURCE REVIEWED |
| `data/incoming` | 5 | 5 | None | 0 | None identified in evaluated files | SOURCE REVIEWED |
| `docs` | 21 | 21 | ARCHITECTURE.md, BUILDING.md, DEPENDENCY-ADVISORIES.md, NATIVE-CONTROLS.md, PROFILE-IPC-CONTRACT.md, READ BEFORE INSTALLING.txt, UPDATE-TRUST.md | 0 | DOCS-03, DOCS-01, DOCS-02, DOCS-04 | SOURCE REVIEWED |
| `docs/superpowers/plans` | 7 | 0 | None | 0 | Not evaluated yet | PENDING / PARTIAL |
| `docs/superpowers/specs` | 6 | 0 | None | 0 | Not evaluated yet | PENDING / PARTIAL |
| `e2e` | 350 | 3 | feature345_qa_csv_mapping_and_bad_files.mjs, run-all.mjs | 0 | HARNESS01, HARNESS02, HARNESS03, HARNESS04 | PENDING / PARTIAL |
| `e2e/lib` | 96 | 40 | isolatedRetry.mjs | 0 | HARNESS01, HARNESS02, HARNESS03, HARNESS04 | PENDING / PARTIAL |
| `mobile` | 4 | 4 | None | 0 | None identified in evaluated files | SOURCE REVIEWED |
| `public` | 0 | 0 | None | 1 | Not evaluated yet | EXCLUDED |
| `src` | 477 | 13 | mobileCharts.test.ts, mobileCharts.ts, transactionQa.ts, transactionQuery.test.ts, transactionQuery.ts | 1 | MONEY01 | PENDING / PARTIAL |
| `src-tauri` | 5 | 5 | None | 0 | None identified in evaluated files | SOURCE REVIEWED |
| `src-tauri/capabilities` | 1 | 1 | None | 0 | None identified in evaluated files | SOURCE REVIEWED |
| `src-tauri/icons` | 0 | 0 | None | 17 | Not evaluated yet | EXCLUDED |
| `src-tauri/src` | 46 | 17 | config.rs | 0 | WINDOW01 | PENDING / PARTIAL |
| `src-tauri/src/commands` | 19 | 3 | None | 0 | STORE01, STORE02, STORE03 | PENDING / PARTIAL |
| `src-tauri/src/commands/accounts` | 1 | 0 | None | 0 | Not evaluated yet | PENDING / PARTIAL |
| `src-tauri/src/commands/files` | 1 | 0 | None | 0 | Not evaluated yet | PENDING / PARTIAL |
| `src-tauri/src/commands/import` | 1 | 0 | None | 0 | Not evaluated yet | PENDING / PARTIAL |
| `src-tauri/src/commands/statements` | 1 | 0 | None | 0 | Not evaluated yet | PENDING / PARTIAL |
| `src-tauri/src/commands/transaction_snapshot` | 1 | 0 | None | 0 | Not evaluated yet | PENDING / PARTIAL |
| `src-tauri/src/mobile_setup` | 3 | 3 | None | 0 | None identified in evaluated files | SOURCE REVIEWED |
| `src-tauri/src/updater` | 4 | 4 | None | 0 | UPDATER-01 | SOURCE REVIEWED |
| `src/askVault` | 123 | 0 | None | 0 | Not evaluated yet | PENDING / PARTIAL |
| `src/assets` | 2 | 1 | None | 1 | ICON01, ICON02 | PENDING / PARTIAL |
| `src/assets/icons` | 44 | 44 | None | 61 | ICON01, ICON02 | SOURCE REVIEWED |
| `src/assets/style-previews` | 0 | 0 | None | 6 | Not evaluated yet | EXCLUDED |
| `src/calendar` | 18 | 18 | DateCalendar.tsx, useCalendarField.ts | 0 | CALENDAR-01, CALENDAR-02 | SOURCE REVIEWED |
| `src/comparisons` | 21 | 21 | Comparisons.css, types.ts | 0 | CMPUI01, CMPUI02, CMPUI03, CMPUI04 | SOURCE REVIEWED |
| `src/icons` | 14 | 14 | None | 0 | ICON01, ICON02 | SOURCE REVIEWED |
| `src/testSupport` | 2 | 2 | None | 0 | None identified in evaluated files | SOURCE REVIEWED |
| `src/testSupport/askVaultM6` | 81 | 0 | None | 0 | Not evaluated yet | PENDING / PARTIAL |
| `src/testSupport/askVaultM6/nativeProofs` | 3 | 0 | None | 0 | Not evaluated yet | PENDING / PARTIAL |
| `src/themes` | 3 | 0 | None | 0 | Not evaluated yet | PENDING / PARTIAL |
| `tools` | 31 | 31 | capture-style-previews.mjs, mobile_test_firefox_ca.py, startup-perf.mjs, test_mobile_cross_browser.mjs, test_mobile_offline.mjs, test_mobile_trusted_firefox.mjs, test_release_workflow.py | 0 | CI-04, TOOLS01, TOOLS02, TOOLS03, TOOLS04, TOOLS05, TOOLS06 | SOURCE REVIEWED |
| `tools/benchmarks` | 7 | 7 | README.md | 0 | REFERENCE-01, REFERENCE-02, REFERENCE-03 | SOURCE REVIEWED |

Directory status refers to source evaluation only. Resolved/deferred findings and validation boundaries are listed below; a reviewed file does not imply runtime acceptance. Parent directory counts are direct files, not recursive totals, so the rows sum to the inventory.

## Changes made

Starting changes (reviewed individually only when checked in the checklist): transaction aggregation/date-bound conversion; mobile exact-decimal sort parsing; removal of METRIC_ORDER, inRange and the match identity helper; deterministic transaction fixtures and boundary/large-history/decimal-order tests. No additional feature, UI, schema, storage format or dependency version changes are authorized by this cleanup.

## Findings, resolved issues and deferred improvements

Current continuation changes: guard KDF lane arithmetic and test extreme values in both key slots; remove two unused calendar refs and unused browser-tool imports; stop echoing filled values in the exploration CLI; correct obsolete build/security/native-calendar/updater and runner documentation; fence the existing Mermaid graph; update one stale offline hosted-runner test expectation; remove an unreachable certificate check; mask Unicode numbers in the statement example; reuse categorizer results and remove an identity wrapper; consolidate identical remembered-CSV-column lookup logic; remove fully overridden comparison CSS; remove an unrelated account doc comment from category statistics; correct stale relocation comments; prevent a malformed Unicode QIF field from panicking, with RED/GREEN regression coverage. See the per-file checklist and scoped Git diff. No tracked files removed; this report is the only new repository file.

Priority ranks follow-up work in the reviewed scope; source findings are not claims of verified exploitation. Change risk estimates the validation needed to implement the recommendation.

| Finding | Priority | Impact | Change risk | Disposition and evidence |
| --- | --- | --- | --- | --- |
| **ROOT-01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, low impact: tsconfig.node.json includes vite.config.ts but omits the mobile configuration and its build plugins. Review the tool type environment before broadening this check; application tsc alone does not establish build-tool type coverage. |
| **PROTECT-02** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, memory hygiene: recovery.rs uses ordinary temporary vectors before Zeroizing storage, and wrap.rs copies decrypted key bytes. A dedicated lifetime review should identify which buffers require erasure. This inspection does not establish an exploitable secret disclosure. |
| **PROTECT-03** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, resource limits: keyfile.rs allocates untrusted JSON and base64 fields before checking their lengths. Add compatible parser limits with import fixtures; KDF resource bounds do not bound parser allocation. |
| **PROTECT-01** | High | Data integrity / input rejection | Low; targeted checks recorded | Resolved, medium severity, low change risk: core/src/protection/kdf.rs multiplied the untrusted lane count before checking its upper bound. Extreme lane tests and parsing either key slot reproduced the overflow. Bounding lanes first preserves valid settings and serialized formats; all 40 protection tests passed. |
| **CALENDAR-01** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, low risk: removed a write-only pending ref and an unused jump-button ref. The same 91 calendar tests passed before and after; the compiled full desktop regression passed. |
| **CALENDAR-02** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, performance hypothesis: DateCalendar creates formatters per cell and recomputes weekday labels on renders. Profile a synthetic calendar interaction before caching; preserve locale changes and full accessible labels. No profiling or benchmark was performed. |
| **GUIDE-01** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, low risk: the exploration CLI no longer logs filled values. Its guide now uses managed validation/build commands, current driver resolution and a fixture within one process. Explicit text/html/eval inspection remains intentional for synthetic data. |
| **DOCS-03** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Pending documentation review: the transactions ownership map predates the account-move controller and 10,000-row move-only selection. Review those owners and history policy before updating it; ordinary edits still have a separate limit. |
| **DOCS-01** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, documentation: corrected managed build/access commands in BUILDING.md, themed calendar descriptions in NATIVE-CONTROLS.md and the historical advisory discussion in DEPENDENCY-ADVISORIES.md. |
| **DOCS-02** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, documentation: PROFILE-IPC-CONTRACT.md distinguishes structured CRUD errors from legacy UI-state errors. UPDATE-TRUST.md and ARCHITECTURE.md reflect the embedded key and integrated updater without asserting release acceptance or private-key custody. |
| **DOCS-04** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, product/legal copy decision: LEGAL-NOTICE.md discusses possible remote Google Fonts and future bundling, while current fonts are local. It is embedded, versioned, user-facing content. Correct it with an explicit copy/version and acknowledgement review; do not silently treat it as a documentation-only edit. |
| **ROOT-02** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, low risk: wrapped the existing Architecture.md graph in a Mermaid fence. Validation confirms the graph body is unchanged. |
| **CI-01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, medium release risk: build-macos.yml can package/publish before the downstream signer validates the stable tag, and its publishing build lacks frontend unit, lint and Rust-test steps. Add prepublication source/tag/version and correctness gates in a nonpublishing CI change; Windows and preparation gates are not evidence for this job. |
| **CI-02** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, maintainability with high change risk: release-windows.yml and prepare-signed-installers.yml duplicate hosted runtime, driver, medium-integrity and validation blocks. Extract only with diagnostic CI coverage of permissions, source selection and failure propagation. |
| **CI-03** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, supply-chain policy: action tags, runner images and some tool installations float. Adopt reviewed pins and an update policy in a separate change; no dependency or action upgrades were made here. |
| **CI-04** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, test-only: the existing offline hosted-runner test expected argv without the documented serial retry flag. It failed before the edit. The corrected expectation preserves nonzero exit checks; all 19 tests passed. The runtime helper is unchanged. |
| **UPDATER-01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, performance hypothesis: updater/staging.rs performs synchronous writes, sync_all and hashing of files up to 128 MiB inside async paths. Measure contention before moving work to a blocking pool, preserving cancellation, RAII ownership and the one-use handoff. No exploit or timing result is claimed. |
| **EXAMPLE-01** | Medium | Reliability, security boundary or performance; see evidence | Low; targeted checks recorded | Resolved, low risk: categorizer_eval.rs reuses the already computed arrival result instead of repeating a pure categorization call, and calls Tally.pct directly instead of an identity wrapper. Both examples compile. No real database was opened. |
| **EXAMPLE-02** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, medium diagnostic privacy issue: real_statement_check.rs masked ASCII digits only. A synthetic failing test showed full-width, Arabic, superscript and fraction characters surviving. Rust Unicode numeric masking now passes both Unicode and unchanged-ASCII tests. No owner statement was read. |
| **REFERENCE-01** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, documentation: the benchmark README now describes package 2026.10.2, household BLS mean spending and per-file atomic publication. Reference values and generated package bytes are unchanged. |
| **REFERENCE-02** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, maintainer-tool robustness: validate.py assumes nested object types and comparable age bounds. Malformed shapes can raise exceptions instead of returning a list of errors. Add malformed-shape tests and guards without weakening the production Rust loader. |
| **REFERENCE-03** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, publication design: build.py replaces the three staged package files individually, so an I/O error between replacements could leave a mixed package. A directory transaction or rollback needs filesystem compatibility tests. The README now states the actual guarantee. |
| **COMPARE01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, medium validation concern: comparisons/package.rs does not enforce every maintainer-validator rule, including positive CPI and complete provenance, despite the module comment. The current bundled package passed its offline validator. Align acceptance rules only with malformed-package fixtures and compatibility review. |
| **COMPARE02** | High | Data integrity / input rejection | Medium to high; behavior / failure-path tests needed | Pending, medium input-hardening fix: comparisons/validation.rs adds rejected u32 allocation values before returning problems, so extreme values can overflow. Add a synthetic rejection regression and checked or wider aggregation while preserving field errors. Not corrected in this batch. |
| **COMPARE03** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, performance hypothesis: comparisons/metrics.rs repeats linear setup lookups and scans spending for each account. Measure large synthetic snapshots before adding indexes, preserving contributor order and Decimal rounding. |
| **COMPARE04** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, low test-maintenance risk: comparison integration helpers use PID-based temporary directories without reliable RAII cleanup. Adopt the existing tempfile dev dependency after checking connection and reopen lifetimes. All inspected paths are synthetic temporary profiles. |
| **TOOLS01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, medium deletion-scope concern: trim-incremental.ps1 checks only the final folder name before recursive deletion and uses a process check with a race. Limit it to reviewed Cargo targets and managed exclusive access, with dry-run tests and a decision on custom -Path support. This tool was not executed. |
| **TOOLS02** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Preserved intentionally: preparation and recovery tools bind release-1.3.1 and its original 202-spec evidence. These are historical trust restrictions, not arbitrary stale constants to generalize. Retire or replace this recovery workflow through a release-specific decision. |
| **TOOLS03** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, low risk: capture-style-previews.mjs had an unused os import and an obsolete build command in its comment. Removed the import and used npm run build:app. node --check passed; no capture session was run. |
| **TOOLS04** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, low risk: removed unused mkdtemp/readFile imports from two mobile browser tools and an unreachable second null check from mobile_test_firefox_ca.py. JavaScript syntax and Python compilation checks passed; no certificate trust was changed. |
| **TOOLS05** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, low risk: removed the unused mkdtemp import from test_mobile_offline.mjs and corrected startup-perf.mjs documentation to require managed build and an exclusive measurement window. Syntax checks passed. No benchmark was run. |
| **TOOLS06** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, medium test-tool reliability: browser tools duplicate driver/server/CDP setup and differ in cleanup on startup failure before try/finally. Consolidate only with failure-injection tests for process, server and disposable-profile lifetimes. |
| **HARNESS01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, low risk: run-all.mjs and specAudit.mjs duplicate dynamic spec discovery with different tie sorting. Consolidate with order and exactly-once tests. Runner-discovered specs must not be deleted because they lack imports. |
| **HARNESS02** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, comments only: removed obsolete current-count and duration claims and labelled old pool measurements historical. Both syntax checks passed. Runner code and test behavior are unchanged after the valid 330-spec regression. |
| **IMPORT01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, medium memory concern: csv_loader.rs retains all raw StringRecords while building parsed output. Streaming should preserve file-level structural-error precedence, header detection and aligned metadata vectors. Measure large synthetic imports before refactoring. |
| **IMPORT02** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, low risk: consolidated the identical remembered-header finder used by ColumnNames.partial_guess and resolve. Trimming, blank-name rejection, ASCII case-insensitive first-match lookup and result shapes are unchanged. All 46 focused CSV tests passed. |
| **VENDOR01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred-medium-office_oxide-OPC-duplicate-check-skips-ZIP64-and-uses-last-EOCD-signature-without-validating-comment-length;-XLSX-fast-path-bypasses-that-check.-Consider-consistent-duplicate-name-policy-with-crafted-synthetic-archives-and-upstream-coordination.-No-exploit-or-external-advisory-status-asserted |
| **VENDOR02** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred-medium-OPC-MAX_PART_SIZE512MiB-is-per-part-and-XLSX-collects-multiple-worksheet/media-buffers.-A-total-import-budget-would-limit-memory-but-needs-real-supported-size-requirements-and-synthetic-bomb-tests-before-changing-import-acceptance |
| **DEPS01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Current Windows x86_64 dependency audit passed: zero npm production and all-dependency findings. The Rust policy accepted one glib 0.18.5 unsoundness notice because it is absent from this target tree. Ten maintenance notices remain in the audit output. No versions or lockfiles changed; other target trees were not audited this turn. |
| **CMPUI01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, medium behavior concern from source inspection: AgeField, AmountEditor and ShareInput retain the last valid draft when text becomes invalid, while Save tracks only date validity. Existing rejection tests use clean forms. Add valid-then-invalid plus another edit regressions before deciding the save-rejection interaction. |
| **CMPUI02** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, medium behavior concern from source inspection: editor text initializes from props without resynchronizing. Discard or external reload can reset the draft while visible text stays stale. Test visible values and introduce explicit reset boundaries without overwriting in-progress input. |
| **CMPUI03** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, low error-handling concern: useGeneration swallows every generation-fetch failure; the view stringifies structured errors and source-open failures have no feedback. Add tested retry and profile-unmount behavior before changing UI messages. |
| **CMPUI04** | Low | Maintainability / documentation | Low; targeted checks recorded | Resolved, low risk: removed an earlier .cmp-details CSS block entirely overridden by the later block. Final display, direction, 10px gap and 8px top margin are unchanged. Comparison unit tests passed; compiled checks are recorded below. |
| **ICON01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Pending, medium hardening: icon guards use in on ordinary objects, so inherited names such as constructor and toString can resolve non-icon values. Add inherited-key and unknown-type fallback tests, then own-property lookups in a stable shared UI batch with the required regression. Not corrected in this batch. |
| **ICON02** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred, asset provenance decision: flatIcons.ts records selected SVGs without per-file source/license evidence. Preserve assets and do not invent credits. Recover original provenance before changing attribution; this review makes no license-compliance conclusion. |
| **STATEMENT01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Pending-medium-pdf_text.rs-worker-state-and-ABANDONED-accounting-update-after-extract_lines-only;-panic-after-timeout-can-skip-decrement-and-permanently-exhaust-reader-capacity.-Add-panic-and-timeout-race-regressions-then-catch-unwind-or-RAII-worker-completion.-Current-cleanup-has-not-changed-parser-runtime |
| **STATEMENT02** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred-resource-limits-PDF-input20MiB-and-pages200-do-not-bound-decoded-glyph/memory-expansion;-ABANDONED-is-not-an-atomic-limit-on-all-concurrent-workers.-Check-command-concurrency-and-add-synthetic-stress/cancellation-tests-before-introducing-total-work-limits |
| **STATEMENT03** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Pending-medium-layout.rs-is_safe_phrase-counts-only-ASCII-digits-so-Unicode-account-or-phone-numbers-can-pass-the-personal-phrase-heuristic.-Add-synthetic-Unicode-regressions-and-reviewed-compatible-character-policy.-Heuristic-is-not-a-general-PII-detector |
| **STORE01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred: delete_family_member clears attribution in five tables before deleting the member, without one transaction. An error can leave partial attribution changes. Add trigger-injected failure tests before transactional hardening; preserve delete policy and nested transaction callers. |
| **MOBILESTORE01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Performance candidate: mobile projection repeats list_accounts/list_family_members and calculates net worth for each history month before final output-size validation. Profile synthetic long histories before reusing reads or adding early work budgets. Preserve coherent complete-history output and fail-closed publication. |
| **STORE02** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred: category rename/delete, rule rename, and command-level rule save/apply use several writes without one atomic boundary. Failure can leave partial data or stale in-memory rules. Add failure-injection and nested import transaction tests before introducing a savepoint or command transaction. |
| **STORE03** | High | Data integrity / input rejection | Medium to high; behavior / failure-path tests needed | High-priority correctness finding: Modal.tsx:741-745 blocks identical text but permits case-only renames, which reach App.tsx:2720 and rename_category. Its NOCASE-matched deletion can remove budget lines and category registration. Static reachability was traced; runtime reproduction has not been performed. Add exact-name/case-only core regressions and compiled dialog coverage before a separate behavior fix. |
| **WINDOW01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Performance candidate: window-state persistence writes synchronously for every move/resize event and ignores I/O errors. Measure event volume before debounce/atomic-write changes, with compiled resize, killed-process and restart tests to preserve persistence timing. |
| **FSUTIL01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred hardening: write_atomic uses a predictable process-id temporary filename and File::create, so concurrent same-destination writes can truncate each other and pre-existing links are followed. Audit caller serialization, then test unique create_new temporary files. POSIX parent-directory fsync is absent, so the power-loss durability comment is stronger than the implementation establishes. |
| **IMPORT03** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Performance/input-bounds candidate: OFX reads the whole file and materializes all tags; malformed long angle-bracket prefixes can be rescanned. QIF and setup imports also read whole files without local byte limits. Check command limits and profile synthetic malformed input before changing streaming or rejection policy. |
| **IMPORT04** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred: setup import duplicates five error-handling branches and reports logical record offsets after quoted multiline cells, which can differ from physical line numbers. Physical-line section detection also examines text inside quotes. Add separator-like multiline fixture regressions before refactoring; preserve Excel padding support. |
| **IMPORT05** | Medium | Reliability, security boundary or performance; see evidence | Low; targeted checks recorded | Resolved: QIF split a field code at byte 1, panicking on non-ASCII leading characters. Splitting after the first UTF-8 character preserves valid ASCII fields and unknown-field policy. Regression verifies two valid records survive and the invalid record becomes a normal row error. RED reproduced panic; the first GREEN exposed an incorrect test line number; corrected GREEN passed all 7 tests and extension dispatch passed. |
| **MONEY01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred precision contract: sumMoney rounds binary floating values per row and returns Number, so half-cent inputs, negative ties and totals exceeding safe integer cents are not exact. isValidDecimalString checks syntax without Rust Decimal range limits. Agree input precision, rounding and range behavior before changing financial results; existing cent fixtures remain unchanged. |
| **HARNESS03** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred harness hardening: releaseTempDir removes the supplied path without verifying tracked ownership; stale cleanup uses directory mtime rather than a live process lease. Audit callers and concurrency guards before enforcing owned-root/liveness checks. Preserve KEEP_E2E_TEMP behavior. No cleanup command was run against unrelated folders. |
| **PROFILE01** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred-profile-publication-hardening:-add_existing_profile-protected-package-branch-cleans-preparation-and-registration-errors-but-not-generation-rejection-or-runtime-lock-failure-after-creating-imported-directory.-Config-write-failure-after-registration-can-also-leave-registry/config-out-of-sync.-Add-injected-failure-and-session-race-tests-before-RAII-publication-cleanup;-never-delete-the-owner-selected-source-folder. |
| **HARNESS04** | Medium | Reliability, security boundary or performance; see evidence | Medium to high; behavior / failure-path tests needed | Deferred-low-impact-diagnostic-fix:-askLayoutChecks.mjs-ordinary-stale-banner-timeout-text-uses-replace-/s+/-instead-of-whitespace-/backslash-s+/.-It-alters-diagnostic-text-not-assertions.-Correct-with-a-focused-diagnostic-regression-in-next-harness-batch;-no-harness-behavior-change-made-during-current-desktop-validation. |

## Validation

Prior evidence is not a fresh run. The earlier six-file cleanup reported 350 unit files / 7,131 tests, 109 final focused tests, lint with four warnings, tsc, a fresh Tauri build, smoke, seven affected desktop specs and 61 synthetic mobile browser checks. Logs are under `E:/misc/Programming/Claude/codebase-cleanup-2026-10-30`. That earlier run did not establish a full desktop regression. This continuation separately completed a 330/330 full desktop regression; later CSV lookup and comparison CSS cleanup receive focused validation against a fresh build. Comment-only edits do not invalidate runtime evidence. Reuse requires the reached behavior and test inputs to remain unchanged.

- RED:-npm-run-access--cleanup-kdf-red--cargo-test--p-budget_core-protection::--lib-exit101;-38-pass-2-fail-at-kdf.rs:34-attempt-to-multiply-with-overflow.-Linker-also-reports-missing-OpenSSL-debug-PDBs-not-link-failure.
- node--check-.claude/skills/run-vault-spend/explore.mjs-passed;-documentation-commands-matched-current-package-scripts-and-CARGO_HOME-resolver.
- PLAN:-application-changes-since-prior-evidence:-KDF-validation-order-and-removal-of-two-calendar-refs;-tests:-extreme-lanes-and-both-slots;-tool/docs:-fill-log-redaction-and-run-guide.-AGENTS.md:7-9-requires-unit/lint-current-build-and-full-desktop-for-shared-UI.-Prior-compiled-evidence-predates-changes.-Estimate-native/unit/build4-8min-desktop30-45min.-No-benchmarks.
- python-tools/test_release_workflow.py-first-hit13-sandbox-permission-errors;-outside-sandbox18-of19-passed-and-one-stale-argv-assertion-failed.-Corrected-test-only-expectation;-green-run-recorded-in-release-check-green.log.
- Fresh-frontend-full-suite-passed350-files7132-tests;-fresh-core-Rust-command-passed1281-unit-and193-integration-tests1474-total;-lint-exit0-with4-existing-warnings;-tsc-exit0;-calendar91-tests-before-and-after;-protection40-green.-See-current-command-log-table.
- Reference-data-tool-tests-initially-could-not-import-openpyxl;-installed-only-existing-pinned-openpyxl3.1.5-and-et_xmlfile2.0.0-in-disposable-venv.-Package-validator-passed-without-regenerating-data.-These-are-data-correctness-tests-not-performance-benchmarks.
- Fresh-full-desktop-regression-npm-run-e2e-exit0-330of330passed-in2529.7seconds;-classified-all330exclusive;-no-spec-failures-or-launch-retries-reported;-valid-fresh-artifactSHA4D31876EC9A467C6A7B071004480194F3F4EE57B10DBCCD53BCC88C8C3AAEF50-buildkeycb465f2e5e0ab5cb-testkey09ea71c899339ae1.-Manifest-archived-before-subsequent-example-edits-and-comment-only-harness-cleanup
- FINAL-BATCH-PLAN:-since-valid330spec-run-only-app-edits-are-identical-CSV-header-lookup-consolidation-and-removal-of-overridden-comparison-CSS;-examples-changed-for-Unicode-redaction-and-categorizer-reuse;-harness-comments-only.-AGENTS.md7-9-requires-focused-unit/lint-managed-build-smoke-and-affected-specs;-25-28-preserve-unaffected-full-evidence.-Run-native-CSV-tests-comparison-units-build-and-smoke97/144-149/151/345;-estimate3-6min.-No-shared-UI-runtime-persistence-or-runner-code-changed-so-no-second-full-regression-or-benchmark
- Focused-final-desktop:-10/10-spec-assertions-passed-in-108.8s-on-fresh-A1DC2EF6-build;-COMMAND-EXIT-3-INVALID-EVIDENCE-because-only-three-doc-comment-lines-in-core/src/store/categories.rs-were-deleted-during-run.-git-diff-confirms-no-executable-behavior-change;-preserve-assertion-evidence-with-this-limit-and-do-not-call-command-passed-or-repeat-regression-on-fingerprint-alone-per-AGENTS.md:25-28.
- QIF-batch-run-brief:-Only-application-behavior-change-since-A1DC2EF6-build-is-malformed-Unicode-QIF-field-handling;-config-and-category-edits-are-comments.-AGENTS.md:7-9-requires-current-managed-build-and-focused-smoke-import-checks;-prior-full-330-run-retained-for-unaffected-behavior;-estimate-3-6-minutes;-no-full-repeat-or-benchmarks.-Full-7132-JS-unit-tests-lint-tsc-remain-reused-evidence-for-unchanged-JS-TS-inputs.
- QIF-native-validation:-RED-exit101-six-pass-one-UTF8-boundary-panic;-first-GREEN-exit101-only-new-fixture-line-number-assertion-wrong;-corrected-GREEN-exit0-seven-tests-pass;-import-extension-dispatch-exit0-one-pass.-rustfmt-initial-default-edition-check-failed-on-2024-syntax-and-style;-correct-command-rustfmt---edition-2024---check-on-four-changed-Rust-files-passed.
- Structural review evaluated all 44 SVG documents, including complete XML element/attribute trees, styles, local references and standard SVG 1.1 DOCTYPE declarations. No geometry or assets changed. This does not constitute visual inspection. The first probe rejected the standard DOCTYPE; after inspecting its contents, the revised exact-allowlist probe passed.
- Comment-only-category-and-config-cleanup-was-reviewed-as-comment-only.-No-additional-runtime-change-was-made-during-the-QIF-build-or-its-following-desktop-run.-Previously-passing-full-regression-is-preserved-with-its-earlier-build-and-explicit-QIF-boundary.
- QIF-integration-brief:-Only-spec345-adds-a-real-import-review-and-save-case-for-Unicode-QIF-unknown-fields;-no-application-or-harness-code-changed-after-valid-C3F28222-build-and-three-passing-desktop-specs.-AGENTS.md:18-28-test-only-validation-reruns-the-affected-test-without-rebuilding-or-repeating-unrelated-regression;-estimate-one-minute.
- Latest-QIF-batch:-managed-build-passed-exit0-executable-C3F282226979309D35B293FD34D59F13223D8BC90A7E3FD57BE8362D9469670E-build-key34cf4d5ea9c462bf;-smoke-plus97-plus345-three-of-three-passed52.2s-exit0-fresh-evidence.-Then-only-spec345-added-real-QIF-review-save-case;-rerun-one-of-one-passed47.4s-exit0-same-executable-test-key440c13d482b2e778.-This-is-targeted-coverage;-earlier-full330-regression-remains-separate.

### Current command logs

| Log | Actual command | Recorded result |
| --- | --- | --- |
| `build-final-batch.log` | `npm run build:app` | Exit 0 |
| `build-qif-batch.log` | `npm run build:app` | Exit 0 |
| `build.log` | `npm run build:app` | Exit 0 |
| `calendar-after.log` | `npm test -- --maxWorkers=4 src/calendar` | Exit 0; Test Files  5 passed (5); Tests  91 passed (91) |
| `calendar-before.log` | `npm test -- --maxWorkers=4 src/calendar` | Exit 0; Test Files  5 passed (5); Tests  91 passed (91) |
| `comparisons-focused.log` | `npm test -- --maxWorkers=4 src/comparisons` | Exit 0; Test Files  7 passed (7); Tests  127 passed (127) |
| `core.log` | `npm run access -- cleanup-core -- cargo test -p budget_core -- --test-threads=1` | Exit 0; test result: ok. 1281 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 234.15s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 180 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.11s; test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s; test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s; test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.92s; test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.38s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s |
| `csv-focused.log` | `npm run access -- cleanup-csv -- cargo test -p budget_core csv_loader:: --lib` | Exit 0; test result: ok. 46 passed; 0 failed; 0 ignored; 0 measured; 1235 filtered out; finished in 0.00s |
| `dependency-audit.log` | `node tools/audit-dependencies.mjs x86_64-pc-windows-msvc` | Exit 0 |
| `desktop-final-batch.log` | `npm run e2e -- --spec=smoke,97,144,145,146,147,148,149,151,345` | Exit 3; 10/10 passed in 108.8s (concurrency 6); INVALID EVIDENCE: artifact provenance is untrusted or validation inputs/executable changed during the run: |
| `desktop-qif-batch.log` | `npm run e2e -- --spec=smoke,97,345` | Exit 0; 3/3 passed in 52.2s (concurrency 6) |
| `desktop-qif-integration.log` | `npm run e2e -- --spec=345` | Exit 0; 1/1 passed in 47.4s (concurrency 6) |
| `example-check.log` | `npm run access -- cleanup-example-check -- cargo check -p budget_core --examples` | Exit 0 |
| `example-green.log` | `npm run access -- cleanup-example-green -- cargo test -p budget_core --example real_statement_check` | Exit 0; test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s |
| `example-red.log` | `npm run access -- cleanup-example-red -- cargo test -p budget_core --example real_statement_check` | Exit 101; test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s |
| `full-desktop.log` | `npm run e2e` | Exit 0; 330/330 passed in 2529.7s (concurrency 6) |
| `lint.log` | `npm run lint` | Exit 0 |
| `protection-green.log` | `npm run access -- cleanup-protection -- cargo test -p budget_core protection:: --lib` | Exit 0; test result: ok. 40 passed; 0 failed; 0 ignored; 0 measured; 1241 filtered out; finished in 0.09s |
| `qif-green-final.log` | `npm run access -- cleanup-qif-green-final -- cargo test -p budget_core qif_loader:: --lib` | Exit 0; test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 1275 filtered out; finished in 0.00s |
| `qif-green.log` | `npm run access -- cleanup-qif-green -- cargo test -p budget_core qif_loader:: --lib` | Exit 101; test result: FAILED. 6 passed; 1 failed; 0 ignored; 0 measured; 1275 filtered out; finished in 0.00s |
| `qif-import-dispatch.log` | `npm run access -- cleanup-qif-dispatch -- cargo test -p budget_core importer:: --lib` | Exit 0; test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 1281 filtered out; finished in 0.02s |
| `qif-red.log` | `npm run access -- cleanup-qif-red -- cargo test -p budget_core qif_loader:: --lib` | Exit 101; test result: FAILED. 6 passed; 1 failed; 0 ignored; 0 measured; 1275 filtered out; finished in 0.00s |
| `reference-tests-green.log` | `C:\Users\joeyf\AppData\Local\Temp\vs-cleanup-reference-3f61d964\Scripts\python.exe -m unittest discover -s tools/benchmarks -p test_*.py` | Exit 0; Ran 51 tests in 0.282s |
| `reference-tests.log` | `python -m unittest discover -s tools/benchmarks -p test_*.py` | Exit 1; ImportError: Failed to import test module: test_build; ModuleNotFoundError: No module named 'openpyxl'; FAILED (errors=1) |
| `reference-validation.log` | `python tools/benchmarks/validate.py core/data/benchmarks` | Exit 0 |
| `release-check-green.log` | `python tools/test_release_workflow.py` | Exit 0; Ran 19 tests in 4.476s |
| `release-check.log` | `python tools/test_release_workflow.py` | Exit 1; AssertionError: Lists differ: ['run', 'e2e', '--', '--concurrency=1', '--retry-failed'] != ['run', 'e2e', '--', '--concurrency=1']; Ran 19 tests in 4.816s; FAILED (failures=1) |
| `setup-reference-tests.log` | `isolated venv plus pip install --no-deps -r tools/benchmarks/requirements.txt` | Exit 0 |
| `smoke.log` | `npm run e2e:smoke` | Exit 0; 1/1 passed in 2.9s (concurrency 6) |
| `split-tool-tests.log` | `python -m unittest discover -s tools -p test_split_rust_items.py` | Exit 0; Ran 21 tests in 0.366s |
| `tool-contracts.log` | `node --test tools/dependency-security-policy.test.mjs tools/update-signing.test.mjs tools/update-signing-workflow.test.mjs tools/prepare-update-artifacts.test.mjs tools/validate-prepared-build.test.mjs tools/browser-download-contract.test.mjs` | Exit 0 |
| `types.log` | `npx tsc --noEmit` | Exit 0 |
| `units.log` | `npm test -- --maxWorkers=4` | Exit 0; Test Files  350 passed (350); Tests  7132 passed (7132) |

## File-by-file coverage checklist

Status includes the evaluated concern/disposition; SHA-256 binds each review to exact current content. Any subsequent content change automatically returns that file to pending on report generation.

| File | Status | Evaluation / reason | SHA-256 when reviewed |
| --- | --- | --- | --- |
| `.claude/settings.json` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | c165612e780631e7bdeaf2f2aeb69dad929b2ebbc761129bd54e60d6d9c34d97 |
| `.claude/skills/run-vault-spend/SKILL.md` | REVIEWED | Reviewed exploration CLI preserve actions stop echoing fill values and correct fixture lifetime documentation | dd03b1556e5fd25ff38da1b90d2807d785f6f2ac7fb7bcc5d97b95373e5260ca |
| `.claude/skills/run-vault-spend/explore.mjs` | REVIEWED | Reviewed exploration CLI preserve actions stop echoing fill values and correct fixture lifetime documentation | 47f4f174732d2952b7960538bc681e246ec4b5d1ed001171c731ea24477a6a3c |
| `.gitattributes` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | f171f8408c3f734493dab0fa21684590f24a8c714f698d4001f75107996bf4ca |
| `.github/workflows/build-macos-check.yml` | REVIEWED | Reviewed entire workflow job conditions permissions input handling packaging and signing boundaries | 22035481a51b1700c6d40b24a7537cbc697fdcce1f12234df7eef43b25311380 |
| `.github/workflows/build-macos.yml` | REVIEWED | Reviewed entire workflow job conditions permissions input handling packaging and signing boundaries | 8c1015a74383094b0003eb789bc2c2eb51969c977e5b367050bb10fd20c46e24 |
| `.github/workflows/prepare-signed-installers.yml` | REVIEWED | Reviewed entire workflow job conditions permissions input handling packaging and signing boundaries | d961f8dec097ff3bebcfc4a203e600835ceed7fad6b947faa69730a0f33f6ecd |
| `.github/workflows/release-windows.yml` | REVIEWED | Reviewed entire workflow job conditions permissions input handling packaging and signing boundaries | c1ced1d90a206effdf33b24d6d8b08f08ecc925e05accdfc7c7ec97727d4763c |
| `.gitignore` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | 7778490a38314974936df85ece19fc7d1cf6488d1ea797a9aaf8e38fb3934194 |
| `.vscode/extensions.json` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | cc7476def213e1bb55aab9a7a5dc38214c8f60ca1b8fd0be22980aa580e91533 |
| `AGENTS.md` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | 967696e20f834fc49831f71032b34d67ac66721a7ae90d4b45d13559d29b4a5a |
| `Architecture.md` | REVIEWED | Reviewed diagram and added Mermaid fence so Markdown can render existing graph | 4b2e3501672f929cb2c67171f94378cd8056705a11a3bc4bd5e084112d2ad54e |
| `CLAUDE.md` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | 61837093deda43c7e9298d98d952874bfd77a632361840b6adda1769518c2379 |
| `Cargo.lock` | EXCLUDED | Generated dependency resolution; manifests and advisory audits reviewed separately; preserve exact lockfile. |  |
| `Cargo.toml` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | 9f6ac16f6a78c3317a3656963c54236617feb06fce8a7403846e025f6de5583f |
| `LICENSE` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | 5641dc58021f8f1868163182ab885fb1561093c31de108019fe6f00f602f279e |
| `README.md` | REVIEWED | Read full document architecture cross references and preservation boundaries | d4f6e84319a8efe3f57ab17968700bdf7a504ba0ddc9e6d55aecfbc4b78097ed |
| `core/Cargo.toml` | REVIEWED | Reviewed manifests build input allowlist CSP capabilities and public trust preserve existing compatibility | 73f848f8af16243fa88c1e759856f198b3495be076bda0e2b208f7847e39f9bc |
| `core/data/benchmarks/cpi.json` | EXCLUDED | Generated public reference package from tools/benchmarks/build.py; generator, pinned source configuration, tests and provenance reviewed instead. Preserved byte-for-byte; not manually edited. |  |
| `core/data/benchmarks/manifest.json` | EXCLUDED | Generated public reference package from tools/benchmarks/build.py; generator, pinned source configuration, tests and provenance reviewed instead. Preserved byte-for-byte; not manually edited. |  |
| `core/data/benchmarks/records.json` | EXCLUDED | Generated public reference package from tools/benchmarks/build.py; generator, pinned source configuration, tests and provenance reviewed instead. Preserved byte-for-byte; not manually edited. |  |
| `core/data/statement_layouts/amex.json` | REVIEWED | Reviewed complete built in layout data fields labels signs and safety shape no data changes | 2aeccded5d2ca10cb01ca59e9c193cfa2289e83982eb14b642acbccdb8317ad5 |
| `core/data/statement_layouts/capital-one.json` | REVIEWED | Reviewed complete built in layout data fields labels signs and safety shape no data changes | 84541538af5754dcd05c0e3d5709b0f088f98454b62281f56a4e3d153a89bc6b |
| `core/data/statement_layouts/chase-card.json` | REVIEWED | Reviewed complete built in layout data fields labels signs and safety shape no data changes | b459e81b482adbd6369612f5e46385227ad8d3b3b0af2d660cd1d616f6847c09 |
| `core/data/statement_layouts/credit-union.json` | REVIEWED | Reviewed complete built in layout data fields labels signs and safety shape no data changes | 78b8374405a440b6b0d0f09501d7c94e8b299039e1d3fe110f0cc34ee5a55bc8 |
| `core/data/statement_layouts/general-investment.json` | REVIEWED | Reviewed complete built in layout data fields labels signs and safety shape no data changes | 0c9d1a8c52aa832f9d04503aca7563bb214862b831a3b243e434c577add5da71 |
| `core/data/statement_layouts/general.json` | REVIEWED | Reviewed complete built in layout data fields labels signs and safety shape no data changes | 55ecb21e3dcad157f09c86f7c63de43a022bde50fe55e493867be148d8208304 |
| `core/data/statement_layouts/lpl.json` | REVIEWED | Reviewed complete built in layout data fields labels signs and safety shape no data changes | da902067298f0d7a351b927a9dfa87af53597b58af179219f3e28fdc55b0e19a |
| `core/data/statement_layouts/mortgage.json` | REVIEWED | Reviewed complete built in layout data fields labels signs and safety shape no data changes | 20ce5f2e00a3772be4a252a8af1bee8a9e3934505300f192730a8e2eaf8099a2 |
| `core/examples/categorizer_eval.rs` | REVIEWED | Reviewed removal of duplicate pure call and wrapper and Unicode diagnostic redaction with synthetic regressions | a195d6468c11aeae5ceeed97127ef2be3625a9c5d1eba596c8354b40d7e58043 |
| `core/examples/real_statement_check.rs` | REVIEWED | Reviewed removal of duplicate pure call and wrapper and Unicode diagnostic redaction with synthetic regressions | 34c7c21323176cba5f5073fe4040eedf7d464f6ae45a1880e71f30783accec2e |
| `core/src/bin/init_db.rs` | REVIEWED | Reviewed minimal entrypoints preserved fixture initializer reference | 94b7f349a9a4abe58f6aef510e8008f40e04a994e0ecebef51ba181c52eec6bf |
| `core/src/categorizer.rs` | REVIEWED | Reviewed classification precedence normalization confidence and tests preserving existing rules | 18debe544d8fcf2f6f31fd5006aaeb1e60b3691929b675597830d83a5af54ef0 |
| `core/src/classifier.rs` | REVIEWED | Reviewed classification precedence normalization confidence and tests preserving existing rules | a59363077fe420b500422dbe12696d52ff1f48e3a9612380545ea6b524d350a4 |
| `core/src/comparisons/cohort.rs` | REVIEWED | Reviewed cohort boundaries Decimal arithmetic private setup validation report composition and package trust | bc10f43ed0298ee052459d2f6640aaab9648908a52c0f94dda8cd00e6e7a9996 |
| `core/src/comparisons/engine.rs` | REVIEWED | Reviewed cohort boundaries Decimal arithmetic private setup validation report composition and package trust | 42c70de6638fb7b65ebf338e9601ff91c33ea0ccac7a094efdc294394fd79e10 |
| `core/src/comparisons/metrics.rs` | REVIEWED | Reviewed cohort boundaries Decimal arithmetic private setup validation report composition and package trust | 9d995ca4b1d764e10af53f5fb829368c9076412dbc9d7b4795de02d8c3512f06 |
| `core/src/comparisons/mod.rs` | REVIEWED | Reviewed cohort boundaries Decimal arithmetic private setup validation report composition and package trust | e144e9453ef33370918c7419940eb8fd83c99ab0492419934e148fa06c7c693e |
| `core/src/comparisons/package.rs` | REVIEWED | Reviewed cohort boundaries Decimal arithmetic private setup validation report composition and package trust | 7616b4535186240285de11f24a5f4d674fe9dd1d94e2b9aab88aca5d976fa9e7 |
| `core/src/comparisons/report.rs` | REVIEWED | Reviewed cohort boundaries Decimal arithmetic private setup validation report composition and package trust | 33690c7938e9db4cc559c6dc6a785cd84c9956018364832d5db5918a4aba67c1 |
| `core/src/comparisons/service.rs` | REVIEWED | Reviewed cohort boundaries Decimal arithmetic private setup validation report composition and package trust | 98e2833f23ae2aae677ef05e3659f634a74de4abbeb5c36f7288a4facb56e0fa |
| `core/src/comparisons/setup.rs` | REVIEWED | Reviewed cohort boundaries Decimal arithmetic private setup validation report composition and package trust | b417df6d86415e885bb2ff7c18a609fb5866f35ab537c6fd9c16dd131b06f982 |
| `core/src/comparisons/types.rs` | REVIEWED | Reviewed cohort boundaries Decimal arithmetic private setup validation report composition and package trust | 3e0e734ceaee631de70d4515611d3d9ee902a66ead62c900853359757f20943f |
| `core/src/comparisons/validation.rs` | REVIEWED | Reviewed cohort boundaries Decimal arithmetic private setup validation report composition and package trust | 9c3bda5256ba3ba761e5fd3b8770c03e99d967f6c71980b2fabee41315bc933c |
| `core/src/csv_loader.rs` | REVIEWED | Reviewed entire CSV loader consolidated remembered header lookup 46focused tests pass | 2e74e6c4b3b27022046536c9d76cfa9c0a80d6d7ab44c1ad6077a6e5f1e6f6cd |
| `core/src/fsutil.rs` | REVIEWED | Reviewed atomic file replacement backup and failure cleanup tests | 454dd1efc8bc43a3a4d367d28137e9d49c2b652a99de6c5dd43d9743f7cfe9b9 |
| `core/src/holding_import.rs` | REVIEWED | Reviewed bounded holding source mapping exact arithmetic and overflow underflow regressions | 411db80426aecffd674c9feb39f7faa03c2632e9f27e1b2cbc4ad66358f553df |
| `core/src/import_resolution.rs` | REVIEWED | Reviewed category decision precedence cached guesses and length delimited review token | c52d5fb00961d17cac67f6afdca37a662296f7419bb4acef95b9998e94369883 |
| `core/src/importer.rs` | REVIEWED | Reviewed extension dispatch and OFX compact tag parsing and malformed record tests | 7b2829abcff3f0d70970b4d7cc3ab4da2bffb9d3edae844bc77707a50a0d61ed |
| `core/src/learner.rs` | REVIEWED | Reviewed classification precedence normalization confidence and tests preserving existing rules | c47750b524dc3632a57ee52a934f61b58cfc4c41fbf298987293b5afc6a1f86a |
| `core/src/lib.rs` | REVIEWED | Reviewed entire file header mapping sign conventions optional columns UTF8 ragged input and embedded tests | 4d686dfd8bac3bf7153965faade5c2aa19b46e4d87919ffdc794ee63cb3a178a |
| `core/src/mobile_snapshot.rs` | REVIEWED | Reviewed signed update key allowlist exact bytes and wire schema date identity reference invariants | fc66dca17a78ab3e54fdb730a686de06fe4159664f66dec3afa358ffd4931cdf |
| `core/src/mobile_snapshot_types.rs` | EXCLUDED | Generated by tools/generate_mobile_snapshot_types.py; maintained schema definitions and generator reviewed instead; preserve wire format. |  |
| `core/src/mobile_snapshot_v1.schema.json` | EXCLUDED | Generated by tools/generate_mobile_snapshot_types.py; maintained schema definitions and generator reviewed instead; preserve wire format. |  |
| `core/src/models.rs` | REVIEWED | Reviewed entire file header mapping sign conventions optional columns UTF8 ragged input and embedded tests | 9f48a14238ba3982a6fabfd2b76a7a9765e5146b832c5501a3bf543ea6f58604 |
| `core/src/ofx_loader.rs` | REVIEWED | Reviewed extension dispatch and OFX compact tag parsing and malformed record tests | a698d32756bac89ddf71953dcbded78eda22ff4bffaf8dbf8c64b5745d802b3c |
| `core/src/protection/kdf.rs` | REVIEWED | Reviewed keyfile validation and regression tests extreme lanes rejected before arithmetic | 4f43ae29963de3d4908ed826678b969f0e082db431b185d1fda21d34fba2fe8c |
| `core/src/protection/keyfile.rs` | REVIEWED | Reviewed keyfile validation and regression tests extreme lanes rejected before arithmetic | fc594457111b824566c26b7e19426f4a6e29769b6cfe72aa77a71d6db78adafd |
| `core/src/protection/mod.rs` | REVIEWED | Reviewed entire protection primitive and tests retain crypto and formats | b4dbac688496e5437466a8dd2f618a5f9ada69b5c6ec73920b2544610c3cf5b9 |
| `core/src/protection/package.rs` | REVIEWED | Reviewed entire protection primitive and tests retain crypto and formats | 86a94c90780261b800f2d741a36b1aeaf777ad0853273d05651aa4dc876da7c1 |
| `core/src/protection/recovery.rs` | REVIEWED | Reviewed entire protection primitive and tests retain crypto and formats | 12ea777e6f48b3131e4fecf7aa41894f5dfd116954c7ab5ba41014b81fd57047 |
| `core/src/protection/wrap.rs` | REVIEWED | Reviewed entire protection primitive and tests retain crypto and formats | 3d2d85a148595b3063fdc651fd3f4e1dabdc38c40e3e42bea5301ea4e61d353b |
| `core/src/qif_loader.rs` | REVIEWED | Reviewed QIF record flush date expansion and fixed Unicode field code boundary with RED GREEN test | 05e12cfbddfa4ac5ed7e340bc5e481c0c7e5c2e18b5b576c9eb82b213617b9c0 |
| `core/src/rules.rs` | REVIEWED | Reviewed classification precedence normalization confidence and tests preserving existing rules | 09cb61d8aba2e31043d408a70fe13790fd2522b9c96d66082aaad375ad0023d9 |
| `core/src/setup_import.rs` | REVIEWED | Reviewed five section setup import row errors and Excel padding multiline fixtures | 81d718f6252f42f8867adb1b0fe50dbee6b6d6f089fe68a2a84bb4761332ec74 |
| `core/src/statement/checks.rs` | REVIEWED | Reviewed period semantics statement model reconciliation Decimal checks Unicode label offsets and tests | 24e5f8c2f4cf173f588dda69ba03774e7906bee9673ece9f4da4d891144eb40d |
| `core/src/statement/fixture_pdf.rs` | REVIEWED | Reviewed statement matching tie resolution and fictional PDF fixtures preserved | aebcd9d4b2dbb735cc41bb1acb24a137c58850a94a64be65d9593d9d2e7d8598 |
| `core/src/statement/holdings.rs` | REVIEWED | Reviewed holdings and row state machines amount selection period dropping wrapped descriptions and synthetic tests | ee963bf0117b014d374d57f3a8b0940a45eb102d77b540f026a73fbbc9c986cc |
| `core/src/statement/layout.rs` | REVIEWED | Reviewed closed layout schema bounds personal phrase heuristics built in loading and synthetic roundtrips | d7c2e39e013e8a4ca3d4fa5b266857b214a7693b1828e76e711dbdced88d41fb |
| `core/src/statement/learn.rs` | REVIEWED | Reviewed teach mark character offsets safe label derivation layout narrowing and robustness tests | 9412e3f7af1f30b867e9a1033a75f5663c33d8263475ce61d0611138d616cdd0 |
| `core/src/statement/matching.rs` | REVIEWED | Reviewed statement matching tie resolution and fictional PDF fixtures preserved | 4e833bb65876ddf79263e20779d4f9b7bbace91ccec4bd7f0147aff0d62c8e6b |
| `core/src/statement/mod.rs` | REVIEWED | Reviewed period semantics statement model reconciliation Decimal checks Unicode label offsets and tests | d237e2b726178e599e32b9509a42b961bd22f370f43bd55a0e5708b3688d396b |
| `core/src/statement/model.rs` | REVIEWED | Reviewed period semantics statement model reconciliation Decimal checks Unicode label offsets and tests | 61a85bd8720e2146390484ac4ab3925ce788bf8df894b78716642d9742241cc3 |
| `core/src/statement/pdf_text.rs` | REVIEWED | Reviewed PDF size page and time limits worker state drawing order layout precedence and tests | da7e002bd70f744f691f0ff3b2bca7348c34f090abf60709b169818157bfbd3f |
| `core/src/statement/rows.rs` | REVIEWED | Reviewed holdings and row state machines amount selection period dropping wrapped descriptions and synthetic tests | eabf614bb4cf26278c1f1add4102196e1d2cbcd52b29e68454433ec1904be64a |
| `core/src/statement/sections.rs` | REVIEWED | Reviewed section boundaries lookahead balances summary totals holdings mode and synthetic fixtures | 827db41b631ffacc6022d3ce975fdf84417c8ec2967a3ca69443407b9a137796 |
| `core/src/statement/select.rs` | REVIEWED | Reviewed PDF size page and time limits worker state drawing order layout precedence and tests | 8a42bc1fc68375540f7cb01b45277d345026567bc450623149790265bbeed688 |
| `core/src/statement/text.rs` | REVIEWED | Reviewed period semantics statement model reconciliation Decimal checks Unicode label offsets and tests | 9cf1681d4eb5b8cffb75efb1f09f41541167abdd2da2ffc9f644aa6929b03130 |
| `core/src/statement/tokens.rs` | REVIEWED | Reviewed date prefix year inference monetary sign mark rules UTF8 offsets and robustness tests | 82f359f5eb55e7ca317ed681030143fa7aa7b95e74e6579ce172028e207122c5 |
| `core/src/store.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/accounts.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/ask_vault.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/ask_vault_retirement.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/assets.rs` | REVIEWED | Reviewed optimistic setup revisions snapshot filtering and parameterized asset family CRUD | 538efb4ed7855863325e5572b819a3f6a0d62945131695fdcae2d27d9e97a338 |
| `core/src/store/buckets.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/budgets.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/categories.rs` | REVIEWED | Reviewed command queue order panic rejection and session metadata and shared IPC parsers | c8bc148816d29fa0c2f545c48e695e4a304c4f1a336fcb62dddb65dba3d0f930 |
| `core/src/store/checkpoints.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/comparison_setup.rs` | REVIEWED | Reviewed optimistic setup revisions snapshot filtering and parameterized asset family CRUD | 7fdac0d54d9db52e08698120f33ff68d78c37499312f3cb8d9738b1db2e51e4c |
| `core/src/store/comparison_snapshot.rs` | REVIEWED | Reviewed optimistic setup revisions snapshot filtering and parameterized asset family CRUD | 398b38c2dacd83ad3a7fdd35f9f9cf38fdf151beaadfdcb2d2945625853f262f |
| `core/src/store/encryption.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/family.rs` | REVIEWED | Reviewed optimistic setup revisions snapshot filtering and parameterized asset family CRUD | e9095deb3950c30c9bf919a14970736350d4fd8c292ace82ec2d8931d920e93b |
| `core/src/store/forecast.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/historical_move.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/import_columns.rs` | REVIEWED | Reviewed layout validation and roundtrip UI key allowlist import atomicity and header regressions | 3c29e592bd968ebbf3f96803b5c0b4d0e3c2695a5281bae8abc5a6ea93185291 |
| `core/src/store/imports.rs` | REVIEWED | Reviewed layout validation and roundtrip UI key allowlist import atomicity and header regressions | 7bd249db58320f60c7c2c16b664e37788cd509c56cddab23a03a4553dbb51319 |
| `core/src/store/insights.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/investments.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/mobile_snapshot.rs` | REVIEWED | Reviewed readonly guard transaction rollback aliasing budgets comparison projection and refresh permit bounds | 860ef157eb72a0a9fa536dcb6c0e2cf923720f41ce05ed2380fa21f98fba8bb2 |
| `core/src/store/mobile_snapshot/budgets.rs` | REVIEWED | Reviewed readonly guard transaction rollback aliasing budgets comparison projection and refresh permit bounds | 896ee7cc3147987f281d5fee699760b2e2ca69c84c5384fd8f96d95775ce64e9 |
| `core/src/store/mobile_snapshot/comparisons.rs` | REVIEWED | Reviewed readonly guard transaction rollback aliasing budgets comparison projection and refresh permit bounds | 1d4b3663aba6a4b747d997acdfcb47f386de89cb0996d9835de0afd740f56b1d |
| `core/src/store/mobile_snapshot/refresh.rs` | REVIEWED | Reviewed readonly guard transaction rollback aliasing budgets comparison projection and refresh permit bounds | ae220f066d4e2ec35f61f945c2380621e0e3a901bd08fea1cbc6098efb8474ed |
| `core/src/store/mobile_snapshot/tests.rs` | REVIEWED | Reviewed mobile projection parity privacy no write coherence and size rejection tests | 89e5d6a2ba09057d0f039b5eb13852ce10ffc602b224f852f882a0c088ab2e4a |
| `core/src/store/mobile_snapshot/transactions.rs` | REVIEWED | Reviewed readonly guard transaction rollback aliasing budgets comparison projection and refresh permit bounds | 37a0fbab7a944358481f069f2b84b1edaf2c6226b3a4396ef484c034061f42d7 |
| `core/src/store/profile_ui_state.rs` | REVIEWED | Reviewed layout validation and roundtrip UI key allowlist import atomicity and header regressions | aa926ff414e4da25b631b1739075b36f51b9196e4add5724fded3dab65ed5ae2 |
| `core/src/store/read_model_tests.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/reconcile.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/recurring.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/reports.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/rules.rs` | REVIEWED | Reviewed rule ownership and category import normalization removed misplaced account doc comment | 14813f4c5359c1de3fab354c9e4eb226fe779596cff6d4872ee792d630fc6c43 |
| `core/src/store/schema.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/settings.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/sign_flip.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/statement_layouts.rs` | REVIEWED | Reviewed layout validation and roundtrip UI key allowlist import atomicity and header regressions | 05ff37b6e4eb770505558bfa7c5fbb9d16ff626ab04f4d24dfbd36aff44d4349 |
| `core/src/store/tests.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/accounts.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/ask_vault_m2.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/ask_vault_m6.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/ask_vault_retirement.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/ask_vault_retirement_fixtures.json` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/assets.rs` | REVIEWED | Reviewed asset attribution layout errors and import order rollback regressions | b4f5f59d4da91ae53ef1857464cf4dcaf2e9aff2c2a16c2d4e1a23fccc4d05f0 |
| `core/src/store/tests/buckets.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/budgets.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/categories.rs` | REVIEWED | Reviewed rule and category normal cases merges persistence and no atomic failure coverage | 195401964b537c4aa9cbac0aea04cb3dc76a9cc8dc0ea258884da319ebf771d1 |
| `core/src/store/tests/cross_view.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/family.rs` | REVIEWED | Reviewed asset attribution layout errors and import order rollback regressions | df1959f5053513f25b29dcc6f2ba2aa3fb4a334ec5a1893198a121e330d58acb |
| `core/src/store/tests/forecast.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/historical_account_moves.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/historical_account_moves_matrix.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/historical_account_moves_model.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/holding_import.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/imports.rs` | REVIEWED | Reviewed asset attribution layout errors and import order rollback regressions | 5315eadef510823be41623246035c8308899855a8f8adc6fffeea0f115fb08c5 |
| `core/src/store/tests/insights.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/investments.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/office_zip_compatibility.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/reconcile.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/recurring.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/reports.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/rules.rs` | REVIEWED | Reviewed rule and category normal cases merges persistence and no atomic failure coverage | 4682ed7e2ed7345207565ce9253204cdfc5ac9addc6a24accb427a302d1a202a |
| `core/src/store/tests/schema.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/settings.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/statement_layouts.rs` | REVIEWED | Reviewed asset attribution layout errors and import order rollback regressions | ff636a7cce514ef6efcabaaa0d69ff260678b3a61a347b527fca532a9fced333 |
| `core/src/store/tests/transaction_account_move.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/transactions.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/tests/transfers.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/transaction_account_move.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/transactions.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/store/transfers.rs` | PENDING | Full content evaluation still required. |  |
| `core/src/update_manifest.rs` | REVIEWED | Reviewed signed update key allowlist exact bytes and wire schema date identity reference invariants | 4bb9dbbb8b1c5b146fb1be97454ef68a642275ee786d4c8ecfa453010d24ac8b |
| `core/tests/comparisons/cohort_tests.rs` | REVIEWED | Reviewed synthetic fixtures edge cases serialization revision conflicts and encrypted roundtrips | d4e4d5eb096021e5c22d7753a307dd73a43cad812c39a2d82c1dcf92fca289be |
| `core/tests/comparisons/common.rs` | REVIEWED | Reviewed synthetic fixtures edge cases serialization revision conflicts and encrypted roundtrips | eb5be40d33b7bb9c86ac711c97425e730143d33dad7b1b1352dd884ce95eb891 |
| `core/tests/comparisons/engine_tests.rs` | REVIEWED | Reviewed synthetic fixtures edge cases serialization revision conflicts and encrypted roundtrips | 2878f8ebd1448b859c78b9c0f6422c53a289977ebb9c364fc30511b40fe2ee0e |
| `core/tests/comparisons/main.rs` | REVIEWED | Reviewed synthetic fixtures edge cases serialization revision conflicts and encrypted roundtrips | b9f235f0da430164c41a58abeff9c0e9d2d31af480dbf0a94990defa49672a6a |
| `core/tests/comparisons/metrics_tests.rs` | REVIEWED | Reviewed synthetic fixtures edge cases serialization revision conflicts and encrypted roundtrips | 1f6249bfefd9336500be0adfe92406f115cd0214aeac3b0e82d3ef531df53895 |
| `core/tests/comparisons/package_tests.rs` | REVIEWED | Reviewed synthetic fixtures edge cases serialization revision conflicts and encrypted roundtrips | eea43e5b98d57259f2059de65bb2b471d32397c0ddf4305e49a10fb805e69c1c |
| `core/tests/comparisons/report_tests.rs` | REVIEWED | Reviewed synthetic fixtures edge cases serialization revision conflicts and encrypted roundtrips | 3f7c45dd64c29f0d5a3961f8067561ac26bdcb8ab2d12771bf05546f163a0200 |
| `core/tests/comparisons/service_tests.rs` | REVIEWED | Reviewed synthetic fixtures edge cases serialization revision conflicts and encrypted roundtrips | f31aba3aeccaa67ccb7e712215c70e049d85c7eb69eef35fad2ede6ed185900b |
| `core/tests/comparisons/setup_tests.rs` | REVIEWED | Reviewed synthetic fixtures edge cases serialization revision conflicts and encrypted roundtrips | 7accfc491c9cc204f3140473769d8c7eaa8d9346c4af485d6f7ff00182e18fa0 |
| `core/tests/comparisons/snapshot_tests.rs` | REVIEWED | Reviewed synthetic fixtures edge cases serialization revision conflicts and encrypted roundtrips | ddca4351c426b7cecded3dce3e7dcf7ec1b09105844fb9ae755a000e89032983 |
| `core/tests/comparisons/store_tests.rs` | REVIEWED | Reviewed synthetic fixtures edge cases serialization revision conflicts and encrypted roundtrips | 2c5891e16a18bc65b7363b7faac4b4483edc5c93d0d1267e80ef080754d05207 |
| `core/tests/fixtures/budget_line.json` | REVIEWED | Reviewed synthetic contract shapes precision edge cases empty sections and comparison provenance preserved fixtures | bfc665fc9bfc74a27df68c216089f2ca793a32f4ded6490a9530ea4d9eb14378 |
| `core/tests/fixtures/compact_transaction.json` | REVIEWED | Reviewed synthetic contract shapes precision edge cases empty sections and comparison provenance preserved fixtures | 2c47147ac5359bf53b4654696727abe5503eb7e2453a08629f87a3a92434039a |
| `core/tests/fixtures/desktop_transaction.json` | REVIEWED | Reviewed synthetic contract shapes precision edge cases empty sections and comparison provenance preserved fixtures | d422f8e4fa833039dbd8017e4ad662df7ce1e844b45440669ed94e48003d18c3 |
| `core/tests/fixtures/mobile_snapshot_cases.json` | REVIEWED | Reviewed synthetic contract shapes precision edge cases empty sections and comparison provenance preserved fixtures | eb289716e530705b35aa31d92f7f49a4b79b9218fdf69dd98ff72d4f1aaab5e5 |
| `core/tests/fixtures/mobile_snapshot_comparisons_v1.json` | REVIEWED | Reviewed synthetic contract shapes precision edge cases empty sections and comparison provenance preserved fixtures | a6851050bf6c291ff9a48eb5152e130e6d2ce4c55a3327d60de52d3df8008621 |
| `core/tests/fixtures/mobile_snapshot_empty_v1.json` | REVIEWED | Reviewed synthetic contract shapes precision edge cases empty sections and comparison provenance preserved fixtures | 65495632ad4f2edcb5614c1c92234da14a10c6c2cb244b03fa8ddd7e31921334 |
| `core/tests/fixtures/mobile_snapshot_v1.json` | REVIEWED | Reviewed synthetic contract shapes precision edge cases empty sections and comparison provenance preserved fixtures | 45ebc7c2ee85f8cdda7585e4dea72eab9a8b797fdd02abb79bc589d943e9fa19 |
| `core/tests/fixtures/profile_ipc.json` | REVIEWED | Reviewed synthetic contract shapes precision edge cases empty sections and comparison provenance preserved fixtures | 2798245913ffa62625915b5a16940551c69df98db4027fe9a89a9a020000ba27 |
| `core/tests/learning_loop.rs` | REVIEWED | Reviewed public API learning contract and native encryption acceptance tests | d835d6e237bb352af3c3187b2fa864bda51cdae7f96dbb5d596d4701e6dd3394 |
| `core/tests/mobile_snapshot_contract.rs` | REVIEWED | Reviewed public API learning contract and native encryption acceptance tests | b3ab4082cd1075856a1a8b6c9d32dac9e0c9734b072b98081b6e7b0e4d96113f |
| `core/tests/protection_roundtrip.rs` | REVIEWED | Reviewed public API learning contract and native encryption acceptance tests | 1c6a94fa39516161a98a689c095b3d9639317a24d25cf660396a3a1daf9ae2aa |
| `core/tests/sqlcipher_platform_check.rs` | REVIEWED | Reviewed public API learning contract and native encryption acceptance tests | cfbe896bac5778beb435dff22b7b0839bcda9f05d7148896af132dc7fd0e7bce |
| `core/vendor/office_oxide/Cargo.toml` | REVIEWED | Reviewed local vendor manifest and patched ZIP name API read caps and XLSX loading paths preserved upstream semantics | e405cc26ec8815ed6fc4df560d9e815acfbde025bf3ebd5d9c4cc0d151a5191b |
| `core/vendor/office_oxide/LICENSE-APACHE` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/LICENSE-MIT` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/NOTICE` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/PATCHES.md` | REVIEWED | Reviewed manifests build input allowlist CSP capabilities and public trust preserve existing compatibility | 218257f1635310e522475f651c40cd407b4fecb1624191d909739630df7a513f |
| `core/vendor/office_oxide/README.md` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/TRADEMARKS.md` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/cfb/blip.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/cfb/directory.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/cfb/error.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/cfb/header.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/cfb/mod.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/cfb/reader.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/convert_doc.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/convert_docx.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/convert_ppt.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/convert_pptx.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/convert_xls.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/convert_xlsx.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/core/content_types.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/core/core_properties.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/core/editable.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/core/embedded_fonts.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/core/error.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/core/mod.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/core/opc.rs` | REVIEWED | Reviewed local vendor manifest and patched ZIP name API read caps and XLSX loading paths preserved upstream semantics | 373965b5857f8641fa947647376f1c671097dd90ddf324037eba023e876d0210 |
| `core/vendor/office_oxide/src/core/parallel.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/core/properties.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/core/relationships.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/core/theme.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/core/traits.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/core/units.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/core/xml.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/create.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/doc/document.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/doc/error.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/doc/fib.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/doc/images.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/doc/mod.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/doc/papx.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/doc/piece_table.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/doc/sprm.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/document.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/edit.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/error.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/formatting.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/headers.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/hyperlink.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/image.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/mod.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/numbering.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/paragraph.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/styles.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/table.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/text.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/docx/write.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/edit.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/error.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/ffi.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/format.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/ir.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/ir_from_markdown.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/ir_render.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/lib.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/ppt/document.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/ppt/error.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/ppt/images.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/ppt/mod.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/ppt/persist.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/ppt/records.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/ppt/text.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/pptx/edit.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/pptx/error.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/pptx/mod.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/pptx/presentation.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/pptx/shape.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/pptx/slide.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/pptx/text.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/pptx/write.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/python.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/wasm.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xls/cell.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xls/error.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xls/images.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xls/mod.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xls/records.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xls/sst.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xls/workbook.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xlsx/cell.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xlsx/date.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xlsx/edit.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xlsx/error.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xlsx/mod.rs` | REVIEWED | Reviewed local vendor manifest and patched ZIP name API read caps and XLSX loading paths preserved upstream semantics | 44edf720b81b418a208ae8b11ef9c20c1448dc03b5b1dc37d5cbd6021995067d |
| `core/vendor/office_oxide/src/xlsx/numfmt.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xlsx/shared_strings.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xlsx/styles.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xlsx/text.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xlsx/workbook.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xlsx/worksheet.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `core/vendor/office_oxide/src/xlsx/write.rs` | EXCLUDED | Vendored third-party implementation; local patch description, manifest and modified source files remain in review scope. |  |
| `data/incoming/.gitkeep` | REVIEWED | Read all synthetic incoming fixtures preserve import discovery and example data | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| `data/incoming/sample.csv` | REVIEWED | Read all synthetic incoming fixtures preserve import discovery and example data | 72d09d0057131ee322fa5eb93347e3274949918ceb56f94e780b42f6e362afc3 |
| `data/incoming/sample.ofx` | REVIEWED | Read all synthetic incoming fixtures preserve import discovery and example data | 1489b945023d11172b7078efeedd1cdda55743b77651eccd855d3c9f3f52aa9d |
| `data/incoming/sample.qif` | REVIEWED | Read all synthetic incoming fixtures preserve import discovery and example data | af3ae0314c08ccb6b7144dfa89ef24dfffaad0b5f31eac360ec478a9036375d6 |
| `data/incoming/sample_month2.csv` | REVIEWED | Read all synthetic incoming fixtures preserve import discovery and example data | 05a003d00c1747ec2a77df5f250d52b31f22e9bd87c6b81caf2b4b2328081ff2 |
| `docs/ARCHITECTURE.md` | REVIEWED | Corrected public key activation status without claiming release or installer acceptance | 886272e64c1f907f81321e2699e3423294aa9da5cf96bb4e326b0c64713e4b0d |
| `docs/BUILDING.md` | REVIEWED | Corrected obsolete build advisory and native calendar guidance | c2ec48fee31e656cd005d238135a26bf8d06e82ee31a83923889404f711398b7 |
| `docs/CREDENTIAL-ATTEMPTS.md` | REVIEWED | Reviewed full contract and coverage documentation no format or behavior change | 055995e063b53d48856c0362e6900b719869da7e99c0f9ddc7fbc90773ca655e |
| `docs/CSV-EXPORT.md` | REVIEWED | Reviewed full contract and coverage documentation no format or behavior change | 6ba632f568baccd2a2ad9f501bb1f15d5800c0e0e1ddbfdfff59c84b36941c97 |
| `docs/DEPENDENCY-ADVISORIES.md` | REVIEWED | Corrected obsolete build advisory and native calendar guidance | 78ee2fafbf5936bcac25f010e7cfdaa2dbacec6cda30878e93268de3c92d6020 |
| `docs/DEPENDENCY-SECURITY.md` | REVIEWED | Reviewed full contract and coverage documentation no format or behavior change | 6ac93ee096678278be7209b0b8b6a245a169451849257c2ad522b065b721c066 |
| `docs/FINANCIAL-READ-CONTRACT.md` | REVIEWED | Reviewed full architecture and snapshot contracts retain owner boundaries | 1db260b97890e7728a447618fbc926c7ac0f713f92434c4eda94468c2fe26ec1 |
| `docs/LEGAL-NOTICE.md` | REVIEWED | Read entire notice preserve embedded legal text and license terms | 59ef16c1ccd2270239b1c1a88b3c10d70ba955ff8f2df89c930ca6b4a21be319 |
| `docs/LIFECYCLE-COVERAGE.md` | REVIEWED | Reviewed full contract and coverage documentation no format or behavior change | 43c37e6a9c4b886bdca96407cdf9c1167e268cca0aad38360f705765b3c25d2f |
| `docs/NATIVE-CONTROLS.md` | REVIEWED | Corrected obsolete build advisory and native calendar guidance | 84606b0fb13a0e4a4df1d612635073310f06ad474a82bd65584ee3d1e3449b0b |
| `docs/PLAINTEXT-CLEANUP.md` | REVIEWED | Reviewed full contract and coverage documentation no format or behavior change | 861d36e962d802314949f572c8871bc93cd5aa6cf4b879c07519033299863aa4 |
| `docs/PROFILE-IPC-CONTRACT.md` | REVIEWED | Resolved contradictory legacy vs migrated profile error description | 3c4b451e7ec03fcb212fcea67b0aabbb7574a39e52b73be0e1db789d65929977 |
| `docs/READ BEFORE INSTALLING.txt` | REVIEWED | Read full install notice corrected single file claim and optional mobile copy boundary | b8c74ff27006faead95a0afd4e462464b236d5cfa1dbeca56ba56d2094ae92b4 |
| `docs/RENDERER-NETWORK-BOUNDARIES.md` | REVIEWED | Reviewed full read model ownership network and statement contracts | da1ac445013424f1e98306a11a855f5e652dfe4c91edc3519530f8df84c50c2d |
| `docs/STATEMENT-RECONCILE.md` | REVIEWED | Reviewed full read model ownership network and statement contracts | 6b3742667839ab2894fc899bff5280d66de8f93b928006315727e3b0a20082de |
| `docs/THIRD-PARTY-FONTS.md` | REVIEWED | Read entire notice preserve embedded legal text and license terms | 76ae342bb10883666b91dc318a1a505cefed4a125cf88d2f3a97abe020f04ce5 |
| `docs/THIRD-PARTY-NOTICES.txt` | REVIEWED | Read entire notice preserve embedded legal text and license terms | 0ff3ab864291991130786600de12c870eae5c52897d80af6a7729f6f9b9e1ac8 |
| `docs/TRANSACTION-DATA-CONTRACT.md` | REVIEWED | Reviewed full read model ownership network and statement contracts | 372398bcdfa74da70eaf67af06f7b9f4dc822fa1eff7af10ab266cc5e8668ec1 |
| `docs/TRANSACTIONS-OWNERSHIP.md` | REVIEWED | Reviewed full read model ownership network and statement contracts | 7e20901b2756eff1f2b4b700e0cd7beaed4b93906c96c4ae415c902e32d7e27c |
| `docs/UPDATE-SIGNING.md` | REVIEWED | Corrected public key activation status without claiming release or installer acceptance | 22bb955711f35927591f36e34fa3169a903915676057bb58eb6d0f8204a54670 |
| `docs/UPDATE-TRUST.md` | REVIEWED | Corrected public key activation status without claiming release or installer acceptance | dd30232d383209662b784cb174fa6bd525cfe7a669157266341dd4d3d6bb3e16 |
| `docs/superpowers/plans/2026-10-01-comparisons-household-only.md` | PENDING | Full content evaluation still required. |  |
| `docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json` | PENDING | Full content evaluation still required. |  |
| `docs/superpowers/plans/2026-10-02-split-store-rs.md` | PENDING | Full content evaluation still required. |  |
| `docs/superpowers/plans/2026-10-04-split-commands-rs-mapping.json` | PENDING | Full content evaluation still required. |  |
| `docs/superpowers/plans/2026-10-04-ui-review-pass.md` | PENDING | Full content evaluation still required. |  |
| `docs/superpowers/plans/2026-10-11-statement-upload-reconcile.md` | PENDING | Full content evaluation still required. |  |
| `docs/superpowers/plans/2026-10-13-csv-column-mapping.md` | PENDING | Full content evaluation still required. |  |
| `docs/superpowers/specs/2026-09-30-terms-and-conditions-design.md` | PENDING | Full content evaluation still required. |  |
| `docs/superpowers/specs/2026-10-01-comparisons-household-only-design.md` | PENDING | Full content evaluation still required. |  |
| `docs/superpowers/specs/2026-10-02-split-store-rs-design.md` | PENDING | Full content evaluation still required. |  |
| `docs/superpowers/specs/2026-10-04-import-category-memory-design.md` | PENDING | Full content evaluation still required. |  |
| `docs/superpowers/specs/2026-10-04-ledger-paging-design.md` | PENDING | Full content evaluation still required. |  |
| `docs/superpowers/specs/2026-10-11-statement-upload-reconcile-design.md` | PENDING | Full content evaluation still required. |  |
| `e2e/README.md` | REVIEWED | Reviewed entire compiled app test guidance and acceptance boundaries | 942b685085a43a4201e7eea26fdca03e955ee311656913a4ced8fd13bc0cdd82 |
| `e2e/affected-map.json` | PENDING | Full content evaluation still required. |  |
| `e2e/askVaultTrafficAudit.d.mts` | PENDING | Full content evaluation still required. |  |
| `e2e/askVaultTrafficAudit.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/build-app.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/classify-specs.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/classify-specs.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/demo.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature100_device_settings.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature101_profile_selector.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature102_profile_unlock_lock.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature103_enable_protection.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature104_create_protected_profile.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature105_protection_leftovers.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature106_protection_crash_recovery.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature107_profile_ui_state.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature108_protection_setup_styling.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature109_ignore_recurring_price_change.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature10_dashboard_insights.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature110_control_consistency.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature111_view_layout_consistency.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature112_inbox_bulk_review.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature113_change_password.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature114_regenerate_recovery.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature115_remove_protection.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature116_recover_via_code.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature117_create_protected_profile_ui.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature118_protected_export_import.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature119_csv_export_warning.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature11_assets.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature120_selector_long_names.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature121_auto_lock_settings.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature122_auto_lock_session.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature123_window_lock_triggers.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature124_system_session_lock.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature125_locked_reminders.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature126_unlock_maintenance.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature127_browser_state_privacy_probe.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature128_release_help_and_notices.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature129_backup_publication.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature12_debt_payoff.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature130_protected_backup_publication.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature131_backup_mirror_publication.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature132_layout_load_race.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature133_generation_rearm_after_swap.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature134_transaction_usability.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature135_transaction_notes.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature136_transactions_layout_widen.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature137_notes_backup_and_protected_profile.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature138_payment_discovery.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature139_legal_notice.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature13_cash_flow_forecast.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature140_contested_rule_flagged.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature141_rule_ignores_store_numbers.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature142_retro_theme.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature143_spending_budget_settings.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature144_comparisons_navigation.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature145_comparisons_metrics.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature146_comparisons_privacy.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature147_comparisons_layout.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature148_comparisons_totals_and_staleness.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature149_comparisons_personal_income.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature150_flip_signs.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature151_comparisons_info_tips.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature152_change_password_backup_restore.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature153_futuristic_refresh.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature154_commands_off_main_thread.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature155_duplicate_account_name.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature156_accessibility_checks.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature157_loading_state.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature158_content_security_policy.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature159_transaction_cells.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature160_row_edit_refresh.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature161_status_click_through.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature162_import_needs_choice.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature163_transactions_load_more_select_all.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature164_import_review_dialogs.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature165_recurring_layout.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature166_mobile_https_assets.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature167_mobile_authorized_reads.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature168_mobile_queued_authorization.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature169_mobile_building_authorization.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature16_relocate_data_file.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature170_mobile_ready_authorization.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature171_mobile_settings.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature172_mobile_refresh.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature173_mobile_guided_setup.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature17_backups.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature18_recurring_edit.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature19_debt_payoff_exclude.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature1_debt_payment.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature20_transactions_sort_and_filter.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature21_add_to_recurring.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature22_version_and_whats_new.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature23_family_members.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature24_profiles.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature25_live_prices.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature266_page_frame.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature267_icon_sidebar.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature268_calm_transactions.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature269_budget_rows.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature26_help_search.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature270_dashboard_order.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature271_colour_meaning.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature272_dates.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature273_chart_width.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature274_account_rows.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature275_goals_empty.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature276_money_in_out.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature277_help_sections.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature278_account_icon_picker_on_top.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature279_holdings_import_review.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature27_live_price_quota.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature280_holdings_import_styling.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature281_holdings_import_protection.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature282_update_trust_boundary.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature283_transaction_snapshot_lifecycle.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature284_editable_suggestions.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature285_shared_credential_attempts.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature286_manual_lock_confirmation.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature287_csv_text_policy.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature288_renderer_network_boundary.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature289_mirror_plaintext_warning.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature28_manual_transaction.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature290_goal_action_alignment.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature291_financial_snapshot_lifecycle.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature292_dashboard_contract_lifecycle.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature293_profile_ipc_contracts.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature294_profile_refusal_codes.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature295_add_transaction_double_submit.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature296_ask_vault_lock.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature29_add_holding.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature2_budget_alerts.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature300_statement_upload.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature301_statement_teach.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature302_statement_investment.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature303_ask_vault_retirement_native.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature304_ask_vault_retirement_flow.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_default_dark_1280.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_default_dark_720.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_default_dark_960.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_default_light_1280.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_default_light_720.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_default_light_960.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_futuristic_dark_1280.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_futuristic_dark_720.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_futuristic_dark_960.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_futuristic_light_1280.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_futuristic_light_720.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_futuristic_light_960.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_keyboard_and_error.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_retro_dark_1280.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_retro_dark_720.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_retro_dark_960.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_retro_light_1280.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_retro_light_720.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature305_screens_retro_light_960.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature306_ask_vault_retirement_lifecycle.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature307_ask_vault_retirement_os_focus.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature308_ask_vault_retirement_boundaries.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature309_ask_vault_retirement_refusal_recovery.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature30_recurring_due_soon.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature310_ask_vault_retirement_refusal_lifecycle.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature311_page_scroll_contained.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature312_retirement_stage_trace.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature313_ask_examples_ledger.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature313_ask_examples_more.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature313_ask_examples_safety.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_default_dark_1280.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_default_dark_720.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_default_dark_960.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_default_light_1280.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_default_light_720.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_default_light_960.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_futuristic_dark_1280.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_futuristic_dark_720.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_futuristic_dark_960.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_futuristic_light_1280.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_futuristic_light_720.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_futuristic_light_960.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_retro_dark_1280.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_retro_dark_720.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_retro_dark_960.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_retro_light_1280.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_retro_light_720.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature314_ask_window_retro_light_960.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature315_csv_column_mapping.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature316_goal_rename_member_filter_household_ofx.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature317_qa_accessibility_remediation.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature318_hidden_accounts_and_short_history_forecast.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature319_qa_recurring_restore_and_empty.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature31_bulk_holdings_import.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature320_large_dashboard_values.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature321_property_current_value.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature322_qa_financial_summaries.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature323_qa_insights_and_balance_history.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature324_qa_cut_preview_twenty_categories.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature325_qa_cut_preview_shortfall.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature326_qa_property_member_assignment.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature327_qa_dashboard_long_zero_negative_accounts.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature328_qa_cash_flow_and_savings_rate_charts.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature329_qa_dashboard_tiles_by_account_kind.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature32_finnhub_provider.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature330_qa_forecast_window_boundaries.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature331_qa_forecast_everyday_baseline.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature332_qa_large_valid_projection.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature333_qa_household_refund_split_transfer_month.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature334_qa_cash_flow_compare_last_year.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature335_qa_dashboard_member_table_long_names.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature336_qa_chart_figures_without_a_mouse.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature337_qa_reports_chart_figures.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature338_qa_pinned_account_tiles.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature339_qa_toast_long_account_name.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature33_twelve_data_provider.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature340_qa_statement_match_variants.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature341_qa_statement_sections_flip_loan.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature342_qa_statement_refusals.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature343_qa_heatmap_keyboard.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature344_qa_statement_finish_rules.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature345_qa_csv_mapping_and_bad_files.mjs` | REVIEWED | Reviewed malformed CSV and Unicode QIF real gesture review and save regressions | bfd4fcd5ba59a2bcc07902391f3fcc26697ef02fb9c0610582d375929fa99876 |
| `e2e/feature346_qa_inbox_bulk_and_empty.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature347_qa_ask_spending_scenario.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature348_qa_ask_savings_target.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature349_qa_ask_investment_extra.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature34_use_existing_data_file.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature350_qa_ask_ordinary_answers.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature351_qa_automatic_backup_and_reopen.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature352_qa_setup_data_and_exports.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature353_qa_protected_export_and_import.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature354_qa_first_run_and_profile_gestures.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature355_qa_recovery_key_wizard.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature356_qa_statement_review_ends_on_lock_and_switch.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature357_qa_mobile_pairing_reject.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature358_qa_mobile_screens_read_only.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature359_qa_transactions_filters_bulk_delete_and_recurring.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature35_stockdata_provider.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature360_qa_feature_toggles_and_sidebar_names.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature361_qa_help_sections_and_page_links.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature362_qa_budget_report_month_boundary.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature363_qa_update_offer_consent.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature364_report_pdf_save.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature365_settings_groups_search_quick_settings.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature366_settings_layout_scrolling.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature367_settings_frame_boundary.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature368_account_transactions_display_limit.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature369_checkbox_size.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature36_debt_trend_color.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature370_calendar_ledger_filters_and_add.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature371_calendar_visual_futuristic.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature371_calendar_visual_retro.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature371_calendar_visual_transparent.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature372_calendar_forms_and_plans.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature373_calendar_contrast_futuristic.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature373_calendar_contrast_futuristic_accents.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature373_calendar_contrast_retro.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature373_calendar_contrast_transparent.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature374_move_transactions_basic.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature375_move_transactions_blockers.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature376_move_transactions_bulk.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature377_move_transactions_visual_futuristic.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature377_move_transactions_visual_retro.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature377_move_transactions_visual_transparent.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature378_move_transactions_protected_session.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature379_move_transactions_confirmed_balances.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature37_bucket_colors.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature380_move_transactions_recorded_balances.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature381_move_transactions_card_balances.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature382_move_transactions_select_all_to_move.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature38_theme_style.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature39_dashboard_customize.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature3_anomaly_flags.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature40_pin_to_dashboard.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature41_transaction_qa.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature42_dashboard_whats_changed.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature43_accounts_whats_changed.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature44_modal_focus_trap.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature45_bulk_tag.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature46_budget_reorder_buttons.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature47_household_month_scoping.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature48_investment_gain_breakdown.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature49_transactions_uncategorized_filter.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature4_split_transactions.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature50_transfer_excluded_from_income.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature51_credit_card_payment_not_income.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature52_income_calculation_qa.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature53_credit_card_balance_propagation.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature54_goal_icon_picker.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature55_dashboard_quick_actions.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature56_save_custom_dashboard_layout.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature57_loan_principal_override.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature58_backdated_transaction_warning.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature59_account_and_category_icon_pickers.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature5_tags.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature60_transfers_not_spending.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature61_layout_fixes.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature62_budget_allocation_and_pace.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature63_dashboard_todo.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature64_rules_manager.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature65_compact_rows_and_account_edit.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature66_linked_transfers.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature67_bill_aware_forecast.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature68_bulk_bar_wraps_at_half_window.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature69_similar_offer_after_bulk_category.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature6_yoy_cashflow.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature70_budget_suggest_from_average.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature71_goal_projection_and_tracking.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature72_privacy_mode.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature73_second_backup_copy.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature74_recurring_matching.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature75_month_end_review.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature76_import_inbox.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature77_command_palette.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature78_budget_rollover.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature79_investments_depth.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature7_export.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature80_reconciliation.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature81_reports_hub.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature82_background_reminders.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature83_overlays_stay_in_view.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature84_tracked_goal_follows_new_transactions.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature85_settings_data_section.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature86_rollover_setting.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature87_month_review_layout.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature88_text_inputs_match.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature89_sankey_and_heatmap.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature8_goal_projection.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature90_toast_legible.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature91_auto_link_transfers.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature92_accumulation_details.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature93_accumulation_plan.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature94_accumulation_summary.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature95_accumulation_layout.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature96_accumulation_help.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature97_import_categories.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature98_rules_list_scroll.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature99_launch_error_screen.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/feature9_recurring_suggestions.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/harness.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/harness.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/household-demo.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/accessPaths.mjs` | REVIEWED | Reviewed exclusive lock lifetimes build vs test inputs provenance dynamic discovery timeouts classification and honest retries | c132762ce4cccf729862d567af7198fc7ecfd27b8f30b6b3f49f89d23b568c29 |
| `e2e/lib/accumulation-fixture.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/accumulation.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/affected.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/affected.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/askDialogWait.mjs` | REVIEWED | Reviewed Ask timeout diagnostics preserve cause and limit | 0e3190de91a4f67d0198e3f25f2e71e1fe576f823e17f88a1de4dabf90164fd7 |
| `e2e/lib/askDialogWait.test.mjs` | REVIEWED | Reviewed Ask timeout diagnostics preserve cause and limit | 61c42b76df19142c21b323ddce524f34cdc1ffd12d521c20b19bd4fd21eab9ec |
| `e2e/lib/askExamples.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/askExamples.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/askExamplesRun.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/askLayoutChecks.mjs` | REVIEWED | Reviewed compiled Ask layout state labels coverage matrix and negative evidence tests | 121b48d87043c9921d227120a16c2373e42ad2a46c74e3796e4633b0eaf8a223 |
| `e2e/lib/askLayoutChecks.test.mjs` | REVIEWED | Reviewed compiled Ask layout state labels coverage matrix and negative evidence tests | 2ae3c89a63b91a430737838dc3abff391b97ba54c8112b3a57402dcd253eb790 |
| `e2e/lib/askPreparedQuestion.mjs` | REVIEWED | Reviewed Ask prepared text integrity remount readiness and keyboard guard regressions | f93b5d118a442902722079eb70af4e24710ebdd79f857c96ea19d2e52e819d8c |
| `e2e/lib/askPreparedQuestion.test.mjs` | REVIEWED | Reviewed Ask prepared text integrity remount readiness and keyboard guard regressions | c7f3dc2e39715b73f682ff9bf97d77869c945c75eb84a3b2f06f6e0658b7b037 |
| `e2e/lib/askReady.mjs` | REVIEWED | Reviewed Ask prepared text integrity remount readiness and keyboard guard regressions | 948a171e89e9b061a6c17440efd9e1921e649f96cb288e37628f6a189afdc66d |
| `e2e/lib/askReady.test.mjs` | REVIEWED | Reviewed Ask prepared text integrity remount readiness and keyboard guard regressions | 0ce8ccd7505d6045ff532b11339bdb3c7fa409264db487ec337467639dfabc11 |
| `e2e/lib/askRetirement.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/askRetirementReady.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/askWindow.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/askWindow.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/axeSession.mjs` | REVIEWED | Reviewed Axe instance provenance and injection error no skipped inspection tests | 665940f63dbb134fdd08ea9f16cdda1abc07f213538147f89ade18d13ab0f83c |
| `e2e/lib/axeSession.test.mjs` | REVIEWED | Reviewed Axe instance provenance and injection error no skipped inspection tests | 908bcb60663432e0f1d14fe9968052c8e450056d33d9125054ea7acd8489a2c9 |
| `e2e/lib/backup_publication.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/budgetRows.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/buildApp.mjs` | REVIEWED | Reviewed exclusive lock lifetimes build vs test inputs provenance dynamic discovery timeouts classification and honest retries | 8a03baa3f6ad6bdf5128c141cc875ec7f1476efc082f78aa222c5c49eaf12a79 |
| `e2e/lib/buildApp.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/buildIdentity.mjs` | REVIEWED | Reviewed local icon PNG generation static only service worker cache synthetic download fixtures and style capture | 3089c60b5815275712be42c97e081d3927bb9ddfc86a1b1f83735d5b38a41769 |
| `e2e/lib/buildIdentity.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/calendarContrast.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/calendarContrast.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/calendarContrastMatrix.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/calendarHits.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/calendarHits.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/calendarVisualMatrix.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/change-password.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/comparisons.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/dateFieldInput.mjs` | REVIEWED | Reviewed owned focus window process cleanup visible date interactions and import account prompt | 490b4069b035f23c5d486edb989c4250208ccc93774eda19c37680b4d3cd3a54 |
| `e2e/lib/dateFields.mjs` | REVIEWED | Reviewed import row choice helper date read resting display and transaction direction entry | d7e945bd636282b371447a3390b50d1f7bf5783a6a5518a6674b51a27c67397d |
| `e2e/lib/dates.mjs` | REVIEWED | Reviewed calendar relative fixture dates and independent BigInt savings month arithmetic | d4e037b90e557eb09f93c03f319ef3b640b8d650b502e3e528a3bb44a6db24ca |
| `e2e/lib/dates.test.mjs` | REVIEWED | Reviewed calendar relative fixture dates and independent BigInt savings month arithmetic | 69dcf6c5dfd88e582b539f40c1446dc56943226febfc62831b0c40ecd23d3301 |
| `e2e/lib/demo-seed.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/demoBuildSafety.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/efficiencyBuildCoverage.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/efficiencyReceipt.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/efficiencyRemaining.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/efficiencyRunIdentity.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/efficiencySafety.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/exclusiveAccess.mjs` | REVIEWED | Reviewed exclusive lock lifetimes build vs test inputs provenance dynamic discovery timeouts classification and honest retries | eb69bfbe871f38cf97f515ad7f19e19b5e9f389c3b7c4d56c843ba16cf38be7e |
| `e2e/lib/exclusiveAccess.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/focusWindow.mjs` | REVIEWED | Reviewed owned focus window process cleanup visible date interactions and import account prompt | d3613a9284b475284920343ef0aef8440b5f0b46023388672a212fe4037b1eb7 |
| `e2e/lib/focusWindow.test.mjs` | REVIEWED | Reviewed owned focus window process cleanup visible date interactions and import account prompt | f1cbd9f6e9dba15eed594f767a8631d522de36324ec7ef673c456d97d5ae0733 |
| `e2e/lib/hostedProvenance.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/importAccount.mjs` | REVIEWED | Reviewed owned focus window process cleanup visible date interactions and import account prompt | 4206650025b857ec43ebdd75d313ef56cd027c7e6483186032bc2b86210c851e |
| `e2e/lib/importReview.mjs` | REVIEWED | Reviewed import row choice helper date read resting display and transaction direction entry | 3b2c2e7bf9c56835596475efc9061be808a122f331db00d8446286cf884977c6 |
| `e2e/lib/importReview.test.mjs` | REVIEWED | Reviewed import row choice helper date read resting display and transaction direction entry | 2c48adbf1aa29b435ca38d20516556b1fe46737a58d7102e8f94cca8ca9d6a6d |
| `e2e/lib/isolatedRetry.mjs` | REVIEWED | Reviewed dynamic discovery provenance and retry policy only obsolete comments changed after full regression | 9fb9fce1954189b2a04429fc1a6d09adf5b2ca97078fd2de4f92d51b5c57b6f5 |
| `e2e/lib/isolatedRetry.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/longTaskObserver.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/longTaskObserver.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/moveTransactions.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/moveVisualMatrix.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/no-hardcoded-dates.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/phaseTiming.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/protection.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/retirementScreenMatrix.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/runAllGuard.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/runGuard.mjs` | REVIEWED | Reviewed exclusive lock lifetimes build vs test inputs provenance dynamic discovery timeouts classification and honest retries | 2444683f3f0e530fd33b89c5dd09b70b695665a332e6a2f6af547b1c1c6aaf82 |
| `e2e/lib/runGuard.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/savingsTargetMonths.mjs` | REVIEWED | Reviewed calendar relative fixture dates and independent BigInt savings month arithmetic | 7b491313b2c7887bbc13e6be1a3cdb1f5988d163fffbaaea33eef723d2a25027 |
| `e2e/lib/savingsTargetMonths.test.mjs` | REVIEWED | Reviewed calendar relative fixture dates and independent BigInt savings month arithmetic | 70f9ce0a2d3250ebc85340288e57ef792df0a398b5411ad80aeb7c114603202d |
| `e2e/lib/scheduler.mjs` | REVIEWED | Reviewed exclusive lock lifetimes build vs test inputs provenance dynamic discovery timeouts classification and honest retries | b69defe23b24a2204dae4d368923180ba85d95dc5fb2b3cd0c51bc9a93df2491 |
| `e2e/lib/scheduler.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/seed.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/settleWithin.mjs` | REVIEWED | Reviewed temp lifecycle optout promise timer cleanup and port retry tests | babafb4d02c1a0fc2ffca616d02d90b85f5f0624cff3b6ca237b856e993b4b04 |
| `e2e/lib/settleWithin.test.mjs` | REVIEWED | Reviewed temp lifecycle optout promise timer cleanup and port retry tests | 96c96b61b24edd68bb59c35eaeb536ead2a1a3c0d3ec8dd780dc83a604e26310 |
| `e2e/lib/specAudit.mjs` | REVIEWED | Reviewed exclusive lock lifetimes build vs test inputs provenance dynamic discovery timeouts classification and honest retries | 9803d0b563c9e16711ca9fff8bad74d81ccb825e78a2cf50ce0b2db06303c31e |
| `e2e/lib/specAudit.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/specSelectors.mjs` | REVIEWED | Reviewed exclusive lock lifetimes build vs test inputs provenance dynamic discovery timeouts classification and honest retries | fb80d5d69a4a0a496a77c8154c3fe325fddd6ed429e780f97c9583f62891f361 |
| `e2e/lib/specTimeout.mjs` | REVIEWED | Reviewed exclusive lock lifetimes build vs test inputs provenance dynamic discovery timeouts classification and honest retries | 39a279f620b2ae878864e175fea901d5ff5ef06e131d673c725c86b1ce5f7b56 |
| `e2e/lib/specTimeout.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/statementPdf.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/statementPdf.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/statementUi.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/tempDir.mjs` | REVIEWED | Reviewed temp lifecycle optout promise timer cleanup and port retry tests | aef000d11edb41fb2784f340790462652b81ba2d368bcc6bcb90b0c040f01c7a |
| `e2e/lib/tempDir.test.mjs` | REVIEWED | Reviewed temp lifecycle optout promise timer cleanup and port retry tests | 0eca8184750eb5ffa43887065cd4aee9d0f379100e29e00bd55eadffcd9ce0d3 |
| `e2e/lib/transactionAmount.mjs` | REVIEWED | Reviewed import row choice helper date read resting display and transaction direction entry | b43cda6aa874b9bd22d0e6d399f6a397e77fb2e715946f2ac86eed03a83c5d77 |
| `e2e/lib/updateUiFixture.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/updateUiFixture.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/verifyPlan.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/verifyPlan.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/visualStability.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/waitForPort.mjs` | REVIEWED | Reviewed temp lifecycle optout promise timer cleanup and port retry tests | 8a64766346ebf66c08890bcddc8dd9dfbaa167d5243bbb81b0907c2c04b8c153 |
| `e2e/lib/waitForPort.test.mjs` | REVIEWED | Reviewed temp lifecycle optout promise timer cleanup and port retry tests | 9d1ac4cb9c530375ce8c418b4deabf713880e9c6857da1ab5ce9aec841fc725e |
| `e2e/lib/withAccess.test.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/lib/yearToDateTop.mjs` | REVIEWED | Reviewed calendar relative fixture dates and independent BigInt savings month arithmetic | 7a9922478dad341509ee2db44d39144ed5606f1a30d8f0bc3b1db49a7227feba |
| `e2e/lib/yearToDateTop.test.mjs` | REVIEWED | Reviewed calendar relative fixture dates and independent BigInt savings month arithmetic | c6e26f815fc80e49a5a6b928f0b5de50cffc83e1187261cea508c341b2315255 |
| `e2e/mobileHttpsHarness.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/mobileRaceHarness.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/run-all.mjs` | REVIEWED | Reviewed dynamic discovery provenance and retry policy only obsolete comments changed after full regression | 64b43abef7a09c8ca64501e9ac4842fed74bdbb7536eae4e5a3e4d88b0d932c9 |
| `e2e/select-specs.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/smoke.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/spec-classification.json` | PENDING | Full content evaluation still required. |  |
| `e2e/statements-demo.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/stress.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/verify.mjs` | PENDING | Full content evaluation still required. |  |
| `e2e/with-access.mjs` | PENDING | Full content evaluation still required. |  |
| `eslint.config.js` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | 75362f410e6a5c27a0f513d244e1e24c5f42f44659e0cb38781c2a99dc49a36d |
| `index.html` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | c0ca9f2ddccce6846a44bc30b3cfc5e8d3e801c0a2c0b2b43be55ac81fc42dbb |
| `mobile/README.md` | REVIEWED | Reviewed mobile entry boundaries and full development security documentation | 0b114fadcda20de247e1bac699e084c5f53ecb2dab3348e814b3ddecf782c0d1 |
| `mobile/index.html` | REVIEWED | Reviewed mobile entry boundaries and full development security documentation | bfadfe45e9abfb873c8d43de56df92e5c264cc7472aa462ab6af4448c33caaef |
| `mobile/preview.html` | REVIEWED | Reviewed mobile entry boundaries and full development security documentation | bc980c65317e88cd612f6cec282564dd639b7a15fe33634e6cec20be8f795b8a |
| `mobile/storage-test.html` | REVIEWED | Reviewed mobile entry boundaries and full development security documentation | 5d07785f206b6be3ddefc446349b1717516eb25d5d0be29b63a6a3ed59752af5 |
| `package-lock.json` | EXCLUDED | Generated dependency resolution; manifests and advisory audits reviewed separately; preserve exact lockfile. |  |
| `package.json` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | 45560165d5055733154a32cfc8eace1e16b29e4ec9bd2623023cc27b477761d0 |
| `public/vault-spend-icon.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `rustfmt.toml` | REVIEWED | Reviewed rustfmt and generated output exclusions | 96a8bd0e3119f2ce2d4eee5dcb532ac01d264d21778c25aeeb6b5cd43527bc06 |
| `src-tauri/.gitignore` | REVIEWED | Reviewed rustfmt and generated output exclusions | e1b11c0407131ad35a1f11d8ec2545c53de147a76f05e264e5b500a14b977332 |
| `src-tauri/Cargo.toml` | REVIEWED | Reviewed manifests build input allowlist CSP capabilities and public trust preserve existing compatibility | 2bd58c33ab10b1942289c90cd6fa76a09c6d3507548340b747af2bde29e787f5 |
| `src-tauri/build.rs` | REVIEWED | Reviewed manifests build input allowlist CSP capabilities and public trust preserve existing compatibility | 579f914788700029086a32d8e718ae6f8f315375cf23472b1aa7172ba2e9d3a0 |
| `src-tauri/capabilities/default.json` | REVIEWED | Reviewed manifests build input allowlist CSP capabilities and public trust preserve existing compatibility | be0d9f7a6de722ef7017e86b35a08948e7de2dd32fb6c7aefbb8b2223d86c621 |
| `src-tauri/icons/128x128.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/128x128@2x.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/32x32.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/64x64.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/Square107x107Logo.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/Square142x142Logo.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/Square150x150Logo.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/Square284x284Logo.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/Square30x30Logo.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/Square310x310Logo.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/Square44x44Logo.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/Square71x71Logo.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/Square89x89Logo.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/StoreLogo.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/icon.icns` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/icon.ico` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/icons/icon.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src-tauri/src/auto_lock.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/background.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/backups.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/command_thread.rs` | REVIEWED | Reviewed command queue order panic rejection and session metadata and shared IPC parsers | 67367c48ea4672230d687416fff2643b6873ca8f03a76ae79ff4d21c0d41f4ad |
| `src-tauri/src/commands.rs` | REVIEWED | Reviewed command queue order panic rejection and session metadata and shared IPC parsers | 11828443b9737bc990215379bf9b21d896e49efc9d3d7b20c8bd6c714c4b526f |
| `src-tauri/src/commands/accounts.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/accounts/tests.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/ask_vault.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/ask_vault_retirement.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/assets.rs` | REVIEWED | Reviewed thin command validation generation guard and thread local unwind restoration | ed105ab46b42d14e547b3df8e00b45ce340422b9b411816b169c575e41529596 |
| `src-tauri/src/commands/budgets.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/categories.rs` | REVIEWED | Reviewed thin command validation generation guard and thread local unwind restoration | daf512c1f2ea82741cf8f33a238c9d11b53ebcbdbf60a7b36ba01c913da174a8 |
| `src-tauri/src/commands/files.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/files/tests.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/financial_snapshot.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/holding_import.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/import.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/import/tests.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/investments.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/profiles.rs` | REVIEWED | Reviewed profile open guard publication order protected package validation and UI state key generation checks | c6b45952783728550e1c6e06c3736b355520107d8a5ab3bdb2ed005bed80163a |
| `src-tauri/src/commands/recurring.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/report_pdf.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/reports.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/statements.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/statements/tests.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/system.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/transaction_snapshot.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/transaction_snapshot/compact.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/commands/transactions.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/comparison_commands.rs` | REVIEWED | Reviewed thin command validation generation guard and thread local unwind restoration | 67e1679de904acd13423a32e01c4210d774447a5dc4e8ef974210fbe60a8454f |
| `src-tauri/src/config.rs` | REVIEWED | Reviewed config fail closed atomic write native session hook ownership and window state restore | f8e739d2d2619ea31e060e4eb6306d0fb0bfa9e38082667fe4a3acae803f1c87 |
| `src-tauri/src/debug_commands.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/device_settings.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/finnhub.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/holding_import.rs` | REVIEWED | Reviewed optin timing fields loopback fixture profile bound selection and discovery cleanup | 2c96617d760ff3c07f2da8cf9db9d4ae17071b013be883015487b831234998ab |
| `src-tauri/src/launch_commands.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/legacy_migration.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/lib.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/live_price_provider.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/live_prices.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/main.rs` | REVIEWED | Reviewed minimal entrypoints preserved fixture initializer reference | 3aa33d138048bdafed1f181a680506db41011d603199a3912c6d03708f893ea6 |
| `src-tauri/src/maintenance.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/mobile_api.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/mobile_bootstrap.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/mobile_certificates.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/mobile_commands.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/mobile_devices.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/mobile_discovery.rs` | REVIEWED | Reviewed optin timing fields loopback fixture profile bound selection and discovery cleanup | 19a0cafe28fdf1de763001600d228624ca54313f0f6bae88ad99a7c39023b61b |
| `src-tauri/src/mobile_race.rs` | REVIEWED | Reviewed debug race barrier disposable path checks and platform secret store fail closed bounds | dd1eddf1c4f48a2c4422dd40103303909a13c4b70bd8fcb159b8a8edc7a3411e |
| `src-tauri/src/mobile_secrets.rs` | REVIEWED | Reviewed debug race barrier disposable path checks and platform secret store fail closed bounds | 11d1549d7e907f7afa98c5fd7ad295b7ad4b843a6c6f37c7ad84c2cc9995fd87 |
| `src-tauri/src/mobile_server.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/mobile_setup/guide.css` | REVIEWED | Reviewed certificate only guide no financial state local fonts appearance allowlists and static step rendering | a4302f3894fae730052ff8b4919f3bf04b3c4603abf32d0631e600c8537fddf6 |
| `src-tauri/src/mobile_setup/guide.js` | REVIEWED | Reviewed certificate only guide no financial state local fonts appearance allowlists and static step rendering | bcbb5095fcf3d1a61702d7e410b0465d90858503376aa01b8c1e0cfd64047958 |
| `src-tauri/src/mobile_setup/index.html` | REVIEWED | Reviewed certificate only guide no financial state local fonts appearance allowlists and static step rendering | 8bdcf7298d2587dceb89a1fa6d1836658b38fd6aa9e1c8632553e1407dd25a34 |
| `src-tauri/src/mobile_transport_tests.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/perf_log.rs` | REVIEWED | Reviewed optin timing fields loopback fixture profile bound selection and discovery cleanup | f59f308e898773a3697ef07712053226e26d54c0f02758c0e291e9f4c93271e9 |
| `src-tauri/src/profiles.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/protection_commands.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/protection_leftovers.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/protection_lifecycle.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/protection_session.rs` | REVIEWED | Reviewed runtime session revision locking and password attempt reservations pending setup lifecycle | 421a6d14fe4bc7d58e038dceca85cd684f5223861627c670afcb7c05ce546e05 |
| `src-tauri/src/protection_transition.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/quote_http_fixture.rs` | REVIEWED | Reviewed optin timing fields loopback fixture profile bound selection and discovery cleanup | 9e0823f5fa20ccf14b2141d2c8c02b69d9cdbee50004129513cc1228bab91f10 |
| `src-tauri/src/request_session.rs` | REVIEWED | Reviewed thin command validation generation guard and thread local unwind restoration | c84bf607b4e0c6ac1be44854e6f7e70f4a33fc138bbef1652a26ce83b59ce0b3 |
| `src-tauri/src/retirement_stage_trace.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/runtime.rs` | REVIEWED | Reviewed runtime session revision locking and password attempt reservations pending setup lifecycle | af44a2bfd5ab69bb3188fcaf86204676c66c3e5aa3101da9ec13b0eb945be1ba |
| `src-tauri/src/startup.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/statement_review.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/stockdata.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/system_session.rs` | REVIEWED | Reviewed config fail closed atomic write native session hook ownership and window state restore | c63702c92853c7045b266910c3b2a1bed29b98923fa2a87f1bd2da6a45480785 |
| `src-tauri/src/twelve_data.rs` | PENDING | Full content evaluation still required. |  |
| `src-tauri/src/updater.rs` | REVIEWED | Read release metadata parser and test mode boundary | 1cf8f1423a2ed3c402c4da2a28c2e05b128a183a5faba581d532e10aae8b7190 |
| `src-tauri/src/updater/service.rs` | REVIEWED | Read complete signed update state transport staging trust and tests preserve one use and fail closed boundaries | 75f0bf1cb289a525737fb2152c179f2c61f93f17c11854ab1df44fb858ebe3c2 |
| `src-tauri/src/updater/staging.rs` | REVIEWED | Read complete signed update state transport staging trust and tests preserve one use and fail closed boundaries | a1bbd215ecaec028f0a7007b9e1e5fe642edc030a88a5274beb2b2936bb72697 |
| `src-tauri/src/updater/transport.rs` | REVIEWED | Read complete signed update state transport staging trust and tests preserve one use and fail closed boundaries | d5b7876be6b4e4c05d11f88e8de1929599037bcd4a9fe7f9f0cdc17b8824d008 |
| `src-tauri/src/updater/trust.rs` | REVIEWED | Read complete signed update state transport staging trust and tests preserve one use and fail closed boundaries | c76883167f923db6a10393799a61a4f5e644ebdedb16063feb1c29dc9738520e |
| `src-tauri/src/window_state.rs` | REVIEWED | Reviewed config fail closed atomic write native session hook ownership and window state restore | 25f0e5909ba8455680f4c2c2464580b4627e31c4ef66eb8bc755653d0aca4781 |
| `src-tauri/tauri.conf.json` | REVIEWED | Reviewed manifests build input allowlist CSP capabilities and public trust preserve existing compatibility | 1134a49ad82dc9c8f59fd25c07c1299fe5431eb592302625193e01c2b71c6e41 |
| `src-tauri/update-keys.json` | REVIEWED | Reviewed manifests build input allowlist CSP capabilities and public trust preserve existing compatibility | 9af96a77361370e47c18f9c60674de8f32353dcbef1aa7dabda433c9f7f131f4 |
| `src/AccountDetailView.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AccountDetailView.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AccountFilterDropdown.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AccountsCards.css` | PENDING | Full content evaluation still required. |  |
| `src/AccountsView.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AccountsView.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AccumulationSection.css` | PENDING | Full content evaluation still required. |  |
| `src/AccumulationSection.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AccumulationSection.tsx` | PENDING | Full content evaluation still required. |  |
| `src/App.css` | PENDING | Full content evaluation still required. |  |
| `src/App.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AppResponsive.css` | PENDING | Full content evaluation still required. |  |
| `src/AppShell.css` | PENDING | Full content evaluation still required. |  |
| `src/AppliedPaymentDetails.css` | PENDING | Full content evaluation still required. |  |
| `src/AppliedPaymentDetails.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AskVaultCard.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AskVaultCard.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AskVaultCardRetirement.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AskVaultCardRouting.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AutoLockSession.css` | PENDING | Full content evaluation still required. |  |
| `src/AutoLockSession.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AutoLockSession.tsx` | PENDING | Full content evaluation still required. |  |
| `src/AutoLockSettings.tsx` | PENDING | Full content evaluation still required. |  |
| `src/BarChart.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/BucketsView.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/BucketsView.tsx` | PENDING | Full content evaluation still required. |  |
| `src/BudgetAndGoals.css` | PENDING | Full content evaluation still required. |  |
| `src/BudgetSuggestDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/BudgetView.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/BudgetView.tsx` | PENDING | Full content evaluation still required. |  |
| `src/CashFlowCharts.css` | PENDING | Full content evaluation still required. |  |
| `src/CashFlowView.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/CashFlowView.tsx` | PENDING | Full content evaluation still required. |  |
| `src/CategoryFilterDropdown.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/CategoryFilterDropdown.tsx` | PENDING | Full content evaluation still required. |  |
| `src/CategorySpendDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ChangePasswordDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ChangePasswordDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ChartWidth.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ColumnMappingDialog.css` | PENDING | Full content evaluation still required. |  |
| `src/ColumnMappingDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ColumnMappingDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/CommandPalette.tsx` | PENDING | Full content evaluation still required. |  |
| `src/CutPreviewDialog.css` | PENDING | Full content evaluation still required. |  |
| `src/CutPreviewDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/DashboardCards.css` | PENDING | Full content evaluation still required. |  |
| `src/DashboardView.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/DashboardView.tsx` | PENDING | Full content evaluation still required. |  |
| `src/DataLoading.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/DataLoading.tsx` | PENDING | Full content evaluation still required. |  |
| `src/DateField.css` | PENDING | Full content evaluation still required. |  |
| `src/DateField.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/DateField.tsx` | PENDING | Full content evaluation still required. |  |
| `src/DonutChart.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/EditableCombobox.css` | PENDING | Full content evaluation still required. |  |
| `src/EditableCombobox.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/EditableCombobox.tsx` | PENDING | Full content evaluation still required. |  |
| `src/EmptyRegistryScreen.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/EmptyRegistryScreen.tsx` | PENDING | Full content evaluation still required. |  |
| `src/FinancialReadState.tsx` | PENDING | Full content evaluation still required. |  |
| `src/FirstRunChecklist.css` | PENDING | Full content evaluation still required. |  |
| `src/HelpLink.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/HelpLink.tsx` | PENDING | Full content evaluation still required. |  |
| `src/HelpView.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/HelpView.tsx` | PENDING | Full content evaluation still required. |  |
| `src/HelpViewSpendingCut.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/HelpViewTypoWording.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/HoldingImportDialog.css` | PENDING | Full content evaluation still required. |  |
| `src/HoldingImportDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/HoldingImportDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/HouseholdView.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/HouseholdView.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ImportCategoryReconcile.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ImportCategoryReconcile.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ImportInboxDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ImportInboxDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ImportNeedsChoice.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ImportNeedsChoice.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ImportReviewDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ImportReviewDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/InboxCategoryDropdown.tsx` | PENDING | Full content evaluation still required. |  |
| `src/InfoTip.css` | PENDING | Full content evaluation still required. |  |
| `src/InfoTip.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/InfoTip.tsx` | PENDING | Full content evaluation still required. |  |
| `src/InvestmentsView.tsx` | PENDING | Full content evaluation still required. |  |
| `src/LaunchErrorScreen.css` | PENDING | Full content evaluation still required. |  |
| `src/LaunchErrorScreen.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/LaunchErrorScreen.tsx` | PENDING | Full content evaluation still required. |  |
| `src/LegalNotice.css` | PENDING | Full content evaluation still required. |  |
| `src/LegalNoticeGate.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/LegalNoticeGate.tsx` | PENDING | Full content evaluation still required. |  |
| `src/LegalNoticeHelp.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/LegalNoticeHelp.tsx` | PENDING | Full content evaluation still required. |  |
| `src/LegalNoticeText.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MemberFilterDropdown.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MemberFilterDropdown.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MenuSelect.css` | PENDING | Full content evaluation still required. |  |
| `src/MenuSelect.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MenuSelect.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MobileControls.css` | PENDING | Full content evaluation still required. |  |
| `src/MobileOfflineApp.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MobilePairingPrompt.css` | PENDING | Full content evaluation still required. |  |
| `src/MobilePairingPrompt.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MobilePairingPrompt.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MobileReports.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MobileSettings.css` | PENDING | Full content evaluation still required. |  |
| `src/MobileSettings.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MobileSettings.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MobileSetupWizard.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MobileSetupWizard.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MobileShared.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MobileShared.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MobileTools.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MobileViewer.css` | PENDING | Full content evaluation still required. |  |
| `src/MobileViewer.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MobileViewer.tsx` | PENDING | Full content evaluation still required. |  |
| `src/Modal.css` | PENDING | Full content evaluation still required. |  |
| `src/Modal.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/Modal.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MonthField.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MonthReviewDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MoreFiltersPopover.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MoreInfo.tsx` | PENDING | Full content evaluation still required. |  |
| `src/MoveTransactionsDialog.css` | PENDING | Full content evaluation still required. |  |
| `src/MoveTransactionsDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/NewTransactionDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/PasswordForm.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/PasswordForm.tsx` | PENDING | Full content evaluation still required. |  |
| `src/PinToDashboardButton.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ProfileAccess.css` | PENDING | Full content evaluation still required. |  |
| `src/ProfileLockScreen.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ProfileLockScreen.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ProfileProtectionSection.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ProfileProtectionSection.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ProfileSelector.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ProfileSelector.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ProfileSwitcher.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ProfileSwitcher.tsx` | PENDING | Full content evaluation still required. |  |
| `src/PropertyAssets.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/PropertyAssets.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ProtectionLeftovers.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ProtectionLeftovers.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ProtectionSetupDialog.css` | PENDING | Full content evaluation still required. |  |
| `src/ProtectionSetupDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ProtectionSetupDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RecategorizedReviewPanel.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RecoverProfileDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RecoverProfileDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RecurringView.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RecurringView.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RegenerateRecoveryDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RegenerateRecoveryDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RemoveProtectionDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RemoveProtectionDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ReportPrintActions.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ReportPrintActions.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ReportsOverview.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ReportsView.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ReportsView.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RetirementScenarioDialog.css` | PENDING | Full content evaluation still required. |  |
| `src/RetirementScenarioDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RetirementScenarioDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RowFieldDropdown.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RowFieldDropdown.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RowMenu.css` | PENDING | Full content evaluation still required. |  |
| `src/RowMenu.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RowMenu.tsx` | PENDING | Full content evaluation still required. |  |
| `src/Rules.css` | PENDING | Full content evaluation still required. |  |
| `src/RulesManager.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/RulesManager.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SafeToSpendCard.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ScrollRegion.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/ScrollRegion.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SeriesChart.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SettingStar.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SettingStar.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SettingsPage.css` | PENDING | Full content evaluation still required. |  |
| `src/SettingsPage.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SettingsPage.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SettingsView.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SettingsView.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SetupImportReviewDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SetupImportReviewDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SharedButtons.css` | PENDING | Full content evaluation still required. |  |
| `src/SharedCards.css` | PENDING | Full content evaluation still required. |  |
| `src/SharedControls.css` | PENDING | Full content evaluation still required. |  |
| `src/SidebarControls.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SidebarControls.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SidebarNav.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SortableTh.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SortableTh.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SpendingScenarioDialog.css` | PENDING | Full content evaluation still required. |  |
| `src/SpendingScenarioDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/SpendingScenarioDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/StartupGate.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/StartupGate.tsx` | PENDING | Full content evaluation still required. |  |
| `src/StatDetailPanel.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/StatDetailPanel.tsx` | PENDING | Full content evaluation still required. |  |
| `src/StatementLayoutsSection.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/StatementLayoutsSection.tsx` | PENDING | Full content evaluation still required. |  |
| `src/StatementReconcile.css` | PENDING | Full content evaluation still required. |  |
| `src/StatementReviewDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/StatementReviewDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/StatementTeachDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/StatementTeachDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/StatusBanner.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionBulkActionsBar.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionBulkActionsBar.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionFilterBar.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionMoveHistory.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionMoveHistory.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionNotesDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionNotesDialog.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionReadState.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionSavedFilters.tsx` | PENDING | Full content evaluation still required. |  |
| `src/Transactions.css` | PENDING | Full content evaluation still required. |  |
| `src/TransactionsNeedsCategory.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionsNeedsCategory.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionsPageActions.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionsPageActions.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionsTable.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransactionsTable.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransferReviewDialog.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransferRow.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/TransferRow.tsx` | PENDING | Full content evaluation still required. |  |
| `src/UpdateBanner.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/UpdateBanner.tsx` | PENDING | Full content evaluation still required. |  |
| `src/accountGroups.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/accountGroups.ts` | PENDING | Full content evaluation still required. |  |
| `src/accumulation.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/accumulation.ts` | PENDING | Full content evaluation still required. |  |
| `src/accumulationExact.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/accumulationExact.ts` | PENDING | Full content evaluation still required. |  |
| `src/allocation.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/allocation.ts` | PENDING | Full content evaluation still required. |  |
| `src/appSecurity.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/appStorage.ts` | PENDING | Full content evaluation still required. |  |
| `src/appTypes.ts` | PENDING | Full content evaluation still required. |  |
| `src/applicationContracts.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/applicationContracts.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/amendmentReferences.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/answer.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/answer.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/calendar.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/calendar.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/changedState.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/changedState.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/choices.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/clarificationExchanges.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/client.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/combinedAcceptance.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/combinedAcceptanceIntegrity.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/combinedCorpusGrader.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/combinedCorpusGraderGaps.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/combinedCorpusGraderMutation.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/combinedReference.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/combinedRouteHarness.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/comparisonThreshold.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/comparisonThresholdBoundary.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/contract.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/contract.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/contractV2.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/contractV2.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/controller.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/controller.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/corpusCounting.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/cutPreviewBaseline.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/cutPreviewBatch.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/cutPreviewContract.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/cutPreviewMath.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/cutPreviewParser.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/dataWriteEvents.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/dataWriteEvents.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/dates.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/dates.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/distance.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/distance.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/exampleEvidence.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/familyResolution.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/familyResolutionRoute.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/insufficientHistoryCorpus.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/ledgerSignature.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/ledgerSignature.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/legacyHandoffRoute.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/m3Scenario.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/m4Scenario.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/m5Model.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/m5RouteElsewhere.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/m5Scenario.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/m6PreparedPackages.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/m6RoutingParsers.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/money.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/money.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/nativeEvidence.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/parser.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/parser.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/parserV2.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/publicRouteParseCount.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/realisticErrors.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/requiredFamilies.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementAnnouncementsParity.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementClient.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementCompiledCorpus.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementCompiledCorpus.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementContextReader.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementContextReader.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementCorpus.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementCorpus.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementCorpusAmendment.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementCorpusGradingHardening.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementIntegratedCorpus.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementNativeContract.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementNativeContract.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementNativeFixtures.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementNativeParity.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementParser.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementParser.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementPerformanceProtocol.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementPerformanceProtocol.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementPrecision.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementScenarioContract.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementScenarioContract.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementScenarioContractExamples.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementScenarioMath.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementScenarioMath.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementScenarioParity.testdata.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementScreenContract.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementScreenContract.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementStageTrace.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/retirementStageTrace.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/routeDisplayCheck.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/savingLead.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/savingLeadParseOnce.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/scenarioNativeData.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/scenarioNativeProof.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/scenarioOrdinaryCheckOrder.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/scenarioPreparation.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/scoringFreeze.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/spendingScenarioAssumption.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/spendingScenarioBaseline.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/spendingScenarioBaseline.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/spendingScenarioContract.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/spendingScenarioFixtures.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/spendingScenarioMath.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/spendingScenarioMath.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/spendingScenarioParser.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/spendingScenarioView.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/spendingScenarioView.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/storeTypoLaterWord.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/trafficAudit.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/types.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/typoDispositions.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/typoRules.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/useAskVault.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/useCutPreview.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/useRetirementScenario.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/askVault/useRetirementScenario.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/useSpendingScenario.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/vendor.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/vendor.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/vendorParser.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/vendorPreparation.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVault/vendorRosterWork.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/askVaultStyles.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/assets/Icons1.html` | REVIEWED | Reviewed static icon provenance gallery preserved despite no code references | 7bf54335abafaf75432f495618a6b210bcf04a01de4418be04ae8af0648562f4 |
| `src/assets/Icons2.html` | PENDING | Full content evaluation still required. |  |
| `src/assets/icons/account-avatar-profile-1.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 46870fcaf501ee419ef54b8509c6d1ec03fc7d353a1f36a7305621c07236c211 |
| `src/assets/icons/account-avatar-profile-10.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | dd5a38c682091b749ffc69fd7b2e9013de7e83528944268bf6bf46c760199ed9 |
| `src/assets/icons/account-avatar-profile-11.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 6898c9c0bf491b7ac718de1a7769df15bdffd7aafa1239ec2a57e89b339523a8 |
| `src/assets/icons/account-avatar-profile-12.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 02b669b68422c465e79317a480e7aeef6d132648ca7d675a35140cf46a3bac92 |
| `src/assets/icons/account-avatar-profile-13.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 2e8e754a16db3465c46a70fa3d1504087d7a4c6a3fc766229c6ba179b21c436d |
| `src/assets/icons/account-avatar-profile-14.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | df04727054f80e35653b44d4dc06f04ef21a59c87b53015da75c8d7f34e77456 |
| `src/assets/icons/account-avatar-profile-15.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | a655f826e89a90b52b06da9f8ffb3168fb1e513880086053ce26110f40aa1dd1 |
| `src/assets/icons/account-avatar-profile-2.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 03c304ff63b25391bf075c19766d1c21131cbf5fc4fd9ae7337a154f8f44043c |
| `src/assets/icons/account-avatar-profile-3.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | baf4b37e7dd0c1434e1f72e81d9d37f3648624f99a8f02bd0ef826a4cbcc8cb2 |
| `src/assets/icons/account-avatar-profile-4.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | f474cfcc05598f513abf59e5402e700cbda94f1458fd72207af100405d3c6048 |
| `src/assets/icons/account-avatar-profile-5.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 4266a5bd51559493db83c98bc3813f646496df913b6ff9851a136211c3d60e0b |
| `src/assets/icons/account-avatar-profile-6.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | ba4390217c2ae1356ba4ac5253186e460968cb537f211e9a94dd54067c5b1ba3 |
| `src/assets/icons/account-avatar-profile-7.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | b5bfbde96db7fc45e698686d41a55495b19f63fbf43fbd3514b6a3e142724db3 |
| `src/assets/icons/account-avatar-profile-9.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | e5b74abdba625e3196727b0dc01b0bdf526bfa58a04a53153290d6d5f764b881 |
| `src/assets/icons/account-avatar-profile-user-8.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | ef8a182c415c1375f58edcaea7a7e9f7a9a68757cf90d3022e69931341c4c108 |
| `src/assets/icons/accounts.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/add-transaction.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/auto-loan.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/backup.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/beauty-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 17b80976c04108981c41b3649118f00128d9c7d5cb641e4affd6b64814316e5b |
| `src/assets/icons/beauty-goals.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 69a19d54f87b3bf32a99a33b26c9b2c2b21d39bac3029d8f44eb929417ecb82c |
| `src/assets/icons/brokerage.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/buckets.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/budget.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/business-account.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/business-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | a6a1e06cb99f3ae0baeeb56a09e06d4fa3b91a5cb602cd18892a7118b4814b74 |
| `src/assets/icons/calendar.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/car-goal.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 95198b374ef79472ea8a60572adbaa58dcf39a1f8fcebf3a32a93041228623f2 |
| `src/assets/icons/car-insurance.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/cash-dash.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | e4d6a36524ac956d3c8b345e7bbe36c3f3f09ada8b6e3bdd8cff624f3367495b |
| `src/assets/icons/cash-flow.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/cash.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/categories.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/checking.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/computer-goals.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | f71e7bd0f49694f0c26e704c52694d15f1be562a2c261431ce9f400cf48170c9 |
| `src/assets/icons/credit-card-acct.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 0b318d8a29e101997ee484a4d835bf5088878a8287b847748016444ede4636bb |
| `src/assets/icons/credit-card.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/crypto.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/dashboard.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/data.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/debt-dash.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 7bc7db80f478575f7b3496ddfdcfd6b475c3cbd92d075e554cccaacae4e723cb |
| `src/assets/icons/dog-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | c42fa2d08ba75a5ebfee79718816b49f962e4173bb0c7167f74488afa5e7013c |
| `src/assets/icons/electric.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/entertainment-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 340a4e280432937aa4d44b2dc751783f2596b5fc9e144d0a0d0b7465fb11c35f |
| `src/assets/icons/export.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/filter.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/fuel.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/gas-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | d33c0a5da6f5002011acfed007dae39acaf52e9b9501c28a34ee11e360b79312 |
| `src/assets/icons/gift-goal.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/gifts-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | e2aef81ff0aa400d099cd6d87e310f7a374ac7af63eac4197bdb75dc651c5ff6 |
| `src/assets/icons/groceries-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 8c5a021c34a8f991afd5ca667fc093a20b270c43fa115bd2ff173ee0922479be |
| `src/assets/icons/groceries.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/health-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 75795ec1c6e2d2aec2f86a1097e66967feca4b0e0a3cb18e7f351f878bebb11a |
| `src/assets/icons/help.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/home-goal.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/house-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 550387e9fd50e899ef69f404b97bbc7503165d145eb8970a56addf562188b437 |
| `src/assets/icons/household.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/income-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | ac4496ff16bdf065dd5bb8f38c589d396d756f61be77dc48871da3fb7dc7c354 |
| `src/assets/icons/internet.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/investment-acct.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | f7905e30d8be125a031b2db74a1df997b4ab3730961c5c5febfd9d047acd42eb |
| `src/assets/icons/investment-property.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/investment.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/investments.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/joint-account.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/laptop-goal.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/ledger.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/liability.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/loan.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/money-checkings-acct.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 02a602e3b09289a87c408d1d7ead272c18a09cceb6adf6de343d1adac4234fb7 |
| `src/assets/icons/mortgage-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 4a799b40f7f9fbe9a2fd08ffcf0395d1819cf6fd92b96166c6e34510b791c72b |
| `src/assets/icons/mortgage.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/music.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/net-worth-dash.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | ea2439ee19ecace9cf6ca2b0e7472dffb8b939dc50e6f73df3e1ebfaca5cf578 |
| `src/assets/icons/other-asset.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/phone.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/profile.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/real-estate-rent-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | e0da96237aea0030deaaa095aa9c23275b10529751488cb52c40bb98871f280c |
| `src/assets/icons/recurring.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/rent.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/reports.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/restaurant.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/restaurants-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 0fa692c56349c8c7fca533104650f865925df209c03fcbb5da46dbaa690a07d2 |
| `src/assets/icons/retirement.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/salary.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/savings-money-acct.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | efc4c1eda0874990e564e435c119811a7e08e55bd9b8c5f470e5e7c4f00016e2 |
| `src/assets/icons/savings.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/search.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/settings.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/shopping-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | de149a20d604ad6816f87cfb261fc2eaec919bf5837e1e104c441015cbb17d79 |
| `src/assets/icons/shopping.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/streaming.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/subscription-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 3aa63eecff09d7be2e61abcee60b47adba6f4bd638aca9b3f3a45c50626aaad0 |
| `src/assets/icons/subscription.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/success.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/transfer-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | be342c4f20f7bbbcbfb6c073fcad4b6683eb21725f969465f7e618fa3aebecd2 |
| `src/assets/icons/transfer.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/transport.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/travel-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | e1c7932a1cf3dc2b768a7b8c8e54e80f655f76c07a281f4de8bdeff5fb5f903c |
| `src/assets/icons/travel-goal.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/trend-up.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/utilities.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/utilty-category.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | f26446a3673c49acfdfb0826327cc92fdb62e1160e1ebaa8ba4f5d1d6fdcaa19 |
| `src/assets/icons/warning-icon.svg` | REVIEWED | Structurally evaluated complete SVG tree attributes text and local references; no active elements event handlers or entities; geometry and appearance preserved; standard SVG 1.1 DOCTYPE where present; individual provenance follow up ICON02 | 6a3516a215b231936c22b9e716fed145650161968668a3b484c36e20994e236a |
| `src/assets/icons/warning.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/icons/water.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/style-previews/futuristic-dark.webp` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/style-previews/futuristic-light.webp` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/style-previews/retro-dark.webp` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/style-previews/retro-light.webp` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/style-previews/transparent-dark.webp` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/style-previews/transparent-light.webp` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/assets/vault-spend-icon-1024.png` | EXCLUDED | Binary asset or fixture; preserved, excluded from textual code review. |  |
| `src/autoLock.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/autoLock.ts` | PENDING | Full content evaluation still required. |  |
| `src/backupRestoreStyles.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/breakdownListStyles.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/budgetAlertBannerStyles.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/budgetAlertText.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/budgetAlertText.ts` | PENDING | Full content evaluation still required. |  |
| `src/budgetNet.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/budgetNet.ts` | PENDING | Full content evaluation still required. |  |
| `src/budgetPlan.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/budgetPlan.ts` | PENDING | Full content evaluation still required. |  |
| `src/budgetSummary.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/budgetSummary.ts` | PENDING | Full content evaluation still required. |  |
| `src/cadence.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/cadence.ts` | PENDING | Full content evaluation still required. |  |
| `src/calendar/CalendarCallers.test.tsx` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | 86297ca6f47d5ff4a407d7560bb87f9dc6ce4eb8d55e92646aaa979956b8b8fa |
| `src/calendar/CalendarField.tsx` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | a6d48bba55ea50e0576471b66aadc28f734325c518a7cca425dc85bd800b1422 |
| `src/calendar/CalendarNesting.test.tsx` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | c03f0ae93c2604dc2479db40feaca0cbc09206046911ad37774003c6621fd9b9 |
| `src/calendar/CalendarPicker.css` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | e60a83602d9765aca4ea3ebac306a6f9f4bfafeb407b3073b0a0239079ca427e |
| `src/calendar/CalendarPopover.tsx` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | 0461276326fbb0772dfb9dd0e7b71f39895cc48e9d7a5cf9b8cb2483d468c565 |
| `src/calendar/CalendarPopup.test.tsx` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | ece48502c65a1113adb93593546c074acd2724f7fee5ddc47de479c83567bc51 |
| `src/calendar/DateCalendar.tsx` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | c6eaeb0ae6614b9fde979f41377354d543307eb5b49e24013837415edc680c3a |
| `src/calendar/MonthCalendar.tsx` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | 7594dfc2ffa031415e66eb42769ffb8c73fa26527b63586003024b942162516c |
| `src/calendar/calendarDate.test.ts` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | 7871dcec6047f11758535b9b2a184fea60657935a887f779544abe03808fcd80 |
| `src/calendar/calendarDate.ts` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | d4515daf64714eb20ff9639626c725636ef2b968dbcc14c137c2b09ebe35e512 |
| `src/calendar/calendarLocale.test.ts` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | e63d11f977be459657dea68a7d6922b0322a7e49fbdac1c7eb044744b93b5e78 |
| `src/calendar/calendarLocale.ts` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | 889998f0cfee1a5001cf6ff64292cd3a8e11ea6e3d8b9976a0499b0dc8356372 |
| `src/calendar/calendarTestUtils.tsx` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | 0a5da0e4f3c78443080718137dae85cbe7c99ccb4c718d7f9cd19392c98ee0c9 |
| `src/calendar/pointerPress.ts` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | b89ace2c6e3472901c35f31635ccee5a9c43cad109ab8202256b2d8c14c3d79a |
| `src/calendar/useCalendarField.ts` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | 28e33c1a8f2bb9a3c9aa4f691a12060335dbeac5eb3fb83991bc9bc867f346a5 |
| `src/calendar/useCalendarPopover.ts` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | a0da0362dd13795cdb42611c9391adb1529600c148993d9ff8a234384c5e5561 |
| `src/calendar/useFieldValidity.ts` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | 02f6edec97205680705ce406ed963955f08a5177ee1991ebf9a9b578ac972c45 |
| `src/calendar/useToday.ts` | REVIEWED | Reviewed calendar state locale keyboard focus layout and test behavior two write only refs removed | f2f2cb642e81d02f00f9457d107593b41c179c50daff8c94279057f19e81857b |
| `src/categoryPalette.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/categoryPalette.ts` | PENDING | Full content evaluation still required. |  |
| `src/changelog.ts` | PENDING | Full content evaluation still required. |  |
| `src/chartAccessibleTable.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/charts.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/charts.tsx` | PENDING | Full content evaluation still required. |  |
| `src/checkboxSize.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/checklistStyles.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/colourStatus.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/colourStatus.ts` | PENDING | Full content evaluation still required. |  |
| `src/columnMapping.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/columnMapping.ts` | PENDING | Full content evaluation still required. |  |
| `src/compactTransactionContracts.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/compactTransactionContracts.ts` | PENDING | Full content evaluation still required. |  |
| `src/comparisons/AgeField.tsx` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 3cd54c244b2f078aaae3481744a3643d1b6b6ff953bd15dee4bebe30114ddcae |
| `src/comparisons/AmountEditor.tsx` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | af8e6fa98ea1768b4f6f88353dd886a8f02c5c041eef389b1447911941bf9fd7 |
| `src/comparisons/ComparisonCard.test.tsx` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 355f69bd1f803a0ec5e50b52f31471db8e7aa5117b8ae460f50fa1fa4eb3218a |
| `src/comparisons/ComparisonCard.tsx` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 3fcad715f21f15e7615e68e5d6d608b7564e01aca585f2fc82d5bc8d276c83ef |
| `src/comparisons/ComparisonDetailsDialog.test.tsx` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | a66d2e5f6fbe2e50f6dfe06ffa193b30845468f2a6768484e2f820351286da42 |
| `src/comparisons/ComparisonDetailsDialog.tsx` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | d88e1e2f3aac1fd5e3fab73c599350d4a60b4ffe8eb93c0b68e2c3654eeb7d06 |
| `src/comparisons/ComparisonDetailsPanel.test.tsx` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 11d0f57b6dbc87fcdc5609c44e414b53e0b8c354d0b23a15ce635613515475f7 |
| `src/comparisons/ComparisonDetailsPanel.tsx` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 42b9f70c641f0d508e0d6181c418371d644235279084445629295ef878d93b2f |
| `src/comparisons/ComparisonSetupDialog.test.tsx` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | a0dad0f5288bf6c7990bc4c8a67ef14b1115346be54ad009ff32180f8f1c361f |
| `src/comparisons/ComparisonSetupDialog.tsx` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 2033562045b8589a7fc31c2a9b3272ca348068c13491f661b7c5e6136d07070c |
| `src/comparisons/Comparisons.css` | REVIEWED | Reviewed comparison styles removed fully overridden rule final computed values unchanged | 2c64c97b12a1e5eb92324ea8dfc4aeb649d4441d6d68aeeb45abf451595e8345 |
| `src/comparisons/ComparisonsView.test.tsx` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | afd3ffe28e1fb7d8fd38103cbae42f4a77f58cb4c6f8833f3885cb27ecfa468d |
| `src/comparisons/ComparisonsView.tsx` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 86adcf7446654eccfc30d18526ad69d2d885cbbcef59e10040bf3cd90fd7ed3b |
| `src/comparisons/api.ts` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 283f02d17b80cba77909ae2ba7ef701daeb51416598a5ac8df457de8acd3e611 |
| `src/comparisons/fieldTips.ts` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 25ab41b24f293d33aff1d2a5ff4c7c7dc51de122cc71914b23b38e11c65ae0b1 |
| `src/comparisons/format.test.ts` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 8c878c05e6ee872ef0e6d8437d34a8734087904a6519696ee28de2d6b6404697 |
| `src/comparisons/format.ts` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 1dd17d23ae55005d4e6f3080fbb15b5cdede0d96f52fcf08789f1a1ffa4d8f54 |
| `src/comparisons/setupDraft.test.ts` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 995bc8f5857167d8bad3cb53a73082da23fd15394b652778d3d3d505c90124d7 |
| `src/comparisons/setupDraft.ts` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 9041e2a5785c4c63de915ee20f6840d47eae1613aa9d96f93da4fe1dfe68cc29 |
| `src/comparisons/testFixtures.ts` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 36737338f0e08165d09a5f92a38a813f7b73710a8fffd01bfb19e28336c627c7 |
| `src/comparisons/types.ts` | REVIEWED | Reviewed all comparison UI files and tests profile generation drafts conflicts privacy source provenance and formatting | 3a085f071ddd8d4f69555d8ce48f21f07acc92c6680765ac9306fdff659c6554 |
| `src/contractChecks.ts` | PENDING | Full content evaluation still required. |  |
| `src/cssTestUtils.ts` | PENDING | Full content evaluation still required. |  |
| `src/csv.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/csv.ts` | PENDING | Full content evaluation still required. |  |
| `src/dangerButtonContrastStyles.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/dashboardContracts.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/dashboardLayout.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/dashboardLayout.ts` | PENDING | Full content evaluation still required. |  |
| `src/dashboardTileContainment.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/dateDisplay.test.ts` | REVIEWED | Reviewed date boundary guard and explicit regex scan limitations and user facing error normalization | c64cac4edfbc78426ac7c4220f26434dee46756b4c98289f0660a9edf9d32871 |
| `src/dateRange.ts` | REVIEWED | Reviewed date boundary guard and explicit regex scan limitations and user facing error normalization | 85d51ae90aa80861b72d955bee00359c44dff1561dc7bf36e426b1e8048badb1 |
| `src/errorMessage.test.ts` | REVIEWED | Reviewed date boundary guard and explicit regex scan limitations and user facing error normalization | 9ebc960de45a9f7163fd6eb18d02e1020a656305eb607fb56e665c2483736ccd |
| `src/errorMessage.ts` | REVIEWED | Reviewed date boundary guard and explicit regex scan limitations and user facing error normalization | d1dbfbaa62e68bb9dfc54035e0ea8a6088dd039c790581f25911757bbe4e8d21 |
| `src/financialContracts.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/financialContracts.ts` | PENDING | Full content evaluation still required. |  |
| `src/financialReads.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/financialReads.ts` | PENDING | Full content evaluation still required. |  |
| `src/forecastChart.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/forecastChart.ts` | PENDING | Full content evaluation still required. |  |
| `src/forecastNotes.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/forecastNotes.ts` | PENDING | Full content evaluation still required. |  |
| `src/format.test.ts` | REVIEWED | Reviewed money cent summing display date parsing and locale regression boundaries | 2755a77a78089d8029763da134dc19fa569fa2712db93cae32c73bc7f38970c8 |
| `src/format.ts` | REVIEWED | Reviewed money cent summing display date parsing and locale regression boundaries | 8e0ff3020b6acb78db6cf33aa3d2f1c314d09fd65b84ff75a325c1aa3d1e2650 |
| `src/frameLayout.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/futuristicProfileCaretStyles.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/goalPlan.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/goalPlan.ts` | PENDING | Full content evaluation still required. |  |
| `src/heatmap.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/heatmap.ts` | PENDING | Full content evaluation still required. |  |
| `src/helpLinkStyles.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/hiddenAccountPickers.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/hiddenAccounts.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/hiddenAccounts.ts` | PENDING | Full content evaluation still required. |  |
| `src/holdingImport.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/holdingImport.ts` | PENDING | Full content evaluation still required. |  |
| `src/icons/accountIcons.test.ts` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | 2f2c238b7269bbe20a484d18dbc5a40a42ebfe9cbe1cb989772191b0f216386e |
| `src/icons/accountIcons.tsx` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | 396f6553007b1089c63f21fe6fa9b4fd071cf9e5dfbe6ee35fec49926a8ece6e |
| `src/icons/bucketIcons.tsx` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | cef54c86d630e96b28220e2ea5af9f77af3902f471d9fe31921e46bcaac95a7e |
| `src/icons/budgetGroupIcons.tsx` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | b73e22000e9e8b0330b8dfbffb22e4a2b4f54bc1f57a245dd05cc26bba333666 |
| `src/icons/categoryIcons.test.ts` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | d5e0f0cc8b0c1a065a4b463ceec2f178ed227bdee0e8d4f4013e25e45ab29e58 |
| `src/icons/categoryIcons.tsx` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | d116d83e67972211042bc07467b61ce2af51f2366ab0c5085c9cde06cefc655c |
| `src/icons/credits.ts` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | 1f2d8cfc2cc97ba3607124116783e9f90628929453496c3e4771817d186f86b7 |
| `src/icons/flatIcons.ts` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | b94ae202f05b238b5ddadb880c78d966c0dc4972a8ce4862e0e851cec6f80167 |
| `src/icons/iconEntry.tsx` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | 8a282226260b5c91d5260fbab3d975f4fb3b63482f51ccd24194cae3599786bb |
| `src/icons/index.ts` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | adf6eca4e802acfafb14214f1627a6c594a919a715edaeace7ae60299904d5d8 |
| `src/icons/navIcons.tsx` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | 51742d88ff1680b62ad403cecbc615ec9676b304b3ba8cfdbe42f122cf99b907 |
| `src/icons/nounIcons.ts` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | e3b7711f73bd0c1ebda13060540b8ddd92515393c32a6db85489a49fd13f718b |
| `src/icons/profileIcons.test.ts` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | 54ac317bb7f32a768e1bfe6546067d9ad7aadfb7f71b21d01c2d0856cd11bdcc |
| `src/icons/profileIcons.tsx` | REVIEWED | Reviewed all icon source and tests stable saved keys keyword precedence fallbacks attribution derived credits and theme paths | 9b1429f161658d39eaa6e5e8a4e10455501b7a45ccb1be51714430ab1f5635e0 |
| `src/importInbox.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/importInbox.ts` | PENDING | Full content evaluation still required. |  |
| `src/importResolution.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/importResolution.ts` | PENDING | Full content evaluation still required. |  |
| `src/importSigns.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/importSigns.ts` | PENDING | Full content evaluation still required. |  |
| `src/legalNotice.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/legalNotice.ts` | PENDING | Full content evaluation still required. |  |
| `src/legalNoticeApi.ts` | PENDING | Full content evaluation still required. |  |
| `src/livePriceStatus.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/livePriceStatus.ts` | PENDING | Full content evaluation still required. |  |
| `src/main.tsx` | PENDING | Full content evaluation still required. |  |
| `src/maintenanceMessages.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/maintenanceMessages.ts` | PENDING | Full content evaluation still required. |  |
| `src/memberBreakdowns.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/memberBreakdowns.ts` | PENDING | Full content evaluation still required. |  |
| `src/menuSelectTestUtils.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileCalculators.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileCalculators.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileCharts.test.ts` | REVIEWED | Re read entire starting cleanup file checked arithmetic filtering grouping format and tests preserved | e88eb7a20df4fa39a9f5f42a780ff15be35ff8514af9f1f3827d062edaa73cf3 |
| `src/mobileCharts.ts` | REVIEWED | Re read entire starting cleanup file checked arithmetic filtering grouping format and tests preserved | 8d9a10be4f7921df6457cb49a451b142bd55062416dd4bb218698e28ba0d359c |
| `src/mobileConnection.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileConnection.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileIndexedDb.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileMain.tsx` | PENDING | Full content evaluation still required. |  |
| `src/mobileOfflineStatus.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileOfflineStatus.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobilePreview.tsx` | PENDING | Full content evaluation still required. |  |
| `src/mobilePreviewFixtures.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileRepository.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileRepository.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileSession.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileSession.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileSnapshot.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileSnapshot.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileSnapshotCoverage.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/mobileSnapshotTypes.ts` | EXCLUDED | Generated by tools/generate_mobile_snapshot_types.py; maintained schema definitions and generator reviewed instead; preserve wire format. |  |
| `src/mobileStorageProbe.tsx` | PENDING | Full content evaluation still required. |  |
| `src/mobileViewModel.ts` | PENDING | Full content evaluation still required. |  |
| `src/modalContrastStyles.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/money.test.ts` | REVIEWED | Reviewed money cent summing display date parsing and locale regression boundaries | 3752d040218bed3a1102f3a29be99afaaf47b45eff4122ef1c272dd07b2f8f36 |
| `src/money.ts` | REVIEWED | Reviewed money cent summing display date parsing and locale regression boundaries | 0a4b44a4f3bba70999639a9361b76700f9e7e369e30f967413aa89f210b540ae |
| `src/monthReview.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/monthReview.ts` | PENDING | Full content evaluation still required. |  |
| `src/mutationFreshness.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/nativeDialog.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/nativeDialog.ts` | PENDING | Full content evaluation still required. |  |
| `src/needsAttention.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/needsAttention.ts` | PENDING | Full content evaluation still required. |  |
| `src/observeRead.ts` | PENDING | Full content evaluation still required. |  |
| `src/pageScroll.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/paletteSearch.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/paletteSearch.ts` | PENDING | Full content evaluation still required. |  |
| `src/paymentDiscovery.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/paymentDiscovery.ts` | PENDING | Full content evaluation still required. |  |
| `src/plainLanguage.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/privacy.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/privacy.ts` | PENDING | Full content evaluation still required. |  |
| `src/profileContracts.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/profileContracts.ts` | PENDING | Full content evaluation still required. |  |
| `src/profileIpc.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/profileIpc.ts` | PENDING | Full content evaluation still required. |  |
| `src/profileUiState.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/profileUiState.ts` | PENDING | Full content evaluation still required. |  |
| `src/projections.ts` | PENDING | Full content evaluation still required. |  |
| `src/protection.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/protection.ts` | PENDING | Full content evaluation still required. |  |
| `src/quickSettings.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/quickSettings.ts` | PENDING | Full content evaluation still required. |  |
| `src/reconcileMath.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/reconcileMath.ts` | PENDING | Full content evaluation still required. |  |
| `src/releaseMetadata.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/reportPdfSave.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/reportPdfSave.ts` | PENDING | Full content evaluation still required. |  |
| `src/reportRange.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/reportRange.ts` | PENDING | Full content evaluation still required. |  |
| `src/reportTablePrint.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/safeToSpend.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/safeToSpend.ts` | PENDING | Full content evaluation still required. |  |
| `src/sankey.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/sankey.ts` | PENDING | Full content evaluation still required. |  |
| `src/settingsGroupPref.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/settingsGroupPref.ts` | PENDING | Full content evaluation still required. |  |
| `src/settingsIndex.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/settingsIndex.ts` | PENDING | Full content evaluation still required. |  |
| `src/settingsLayout.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/setupImportMessage.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/setupImportMessage.ts` | PENDING | Full content evaluation still required. |  |
| `src/setupTemplate.ts` | PENDING | Full content evaluation still required. |  |
| `src/sidebarNames.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/signedUpdates.ts` | PENDING | Full content evaluation still required. |  |
| `src/similarRules.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/similarRules.ts` | PENDING | Full content evaluation still required. |  |
| `src/startup.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/startup.ts` | PENDING | Full content evaluation still required. |  |
| `src/statementContracts.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/statementContracts.ts` | PENDING | Full content evaluation still required. |  |
| `src/statementTestUtils.ts` | PENDING | Full content evaluation still required. |  |
| `src/tauriInvoke.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/tauriInvoke.ts` | PENDING | Full content evaluation still required. |  |
| `src/tauriInvokeRelease.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/amendmentReference.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/amendmentReferences.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/amendments.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/cases.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/clarificationGolds.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/combinedAcceptance.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/combinedAcceptanceRoutes.tsx` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/contexts.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/counting.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/displayCheck.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/exampleMap.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/expectedRequests.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/flaggedDispositions.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/freeze.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/grader.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/helpClaims.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/historyCases.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/historyRoute.tsx` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/legacyHandoff.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/m3Scenario.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/m4RetainedVectors.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/m4Scenario.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/m5Model.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/m5Scenario.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/manifest.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/nativeEvidence.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/nativeEvidenceManifest.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/nativeProofs/native-proof-amendment.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/nativeProofs/native-proof-ordinary.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/nativeProofs/native-proof-scenario-prerequisites.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/preparedPackages.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/provenance.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/realisticErrors.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/referenceCalendar.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/referenceContract.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/referenceOracle.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/referenceResults.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/referenceWorld.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/registry.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/requiredFamilies.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/routeHarness.tsx` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/routeHarnessM3.tsx` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/routeHarnessM4.tsx` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/routeHarnessM5.tsx` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/routingCases.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/routingRoute.tsx` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM3Cases.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM3Contexts.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM3EvidenceManifest.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM3Excluded.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM3References.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM3Requests.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM4Cases.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM4Contexts.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM4EvidenceManifest.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM4References.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM4Requests.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM5Cases.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM5Contexts.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM5EvidenceManifest.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM5References.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioM5Requests.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioNativeFixtures.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioNativeProof.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioNativeReferences.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioNativeRequests.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scenarioPreparation.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v1.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v10.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v11.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v12.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v13.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v14.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v2.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v3.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v4.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v5.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v6.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v7.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v8.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/scoringFreeze.v9.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/typoRules.json` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/askVaultM6/typoRulesOracle.ts` | PENDING | Full content evaluation still required. |  |
| `src/testSupport/csvCorpus.json` | REVIEWED | Reviewed AST network capability guard boundaries and CSV formula injection fixture cases | b2c3757631a29a8192ba9dc1bad60b88e4e26a10f85748355f9af4da8e2625d6 |
| `src/testSupport/rendererNetworkPolicy.ts` | REVIEWED | Reviewed AST network capability guard boundaries and CSV formula injection fixture cases | 2976c9ad0f6a684e95b4677f8e8b5bfacfeb87ab5bebc155ce7d8505ed9424f8 |
| `src/themeBootstrap.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/themeBootstrap.ts` | PENDING | Full content evaluation still required. |  |
| `src/themes/futuristic.css` | PENDING | Full content evaluation still required. |  |
| `src/themes/futuristic.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/themes/retro.css` | PENDING | Full content evaluation still required. |  |
| `src/transactionAccountMove.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionAccountMove.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionAccountMoveFixtures.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionContracts.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionContracts.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionDirection.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionDirection.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionExport.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionExport.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionHelpers.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionMerge.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionMerge.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionPaging.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionPaging.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionPerf.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionQa.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionQa.ts` | REVIEWED | Re read entire starting cleanup file checked arithmetic filtering grouping format and tests preserved | 227ae340f5e5460fd92fcd4eae305d80e2c4f9b41814905b4e610aa9a4eceea5 |
| `src/transactionQuery.test.ts` | REVIEWED | Re read entire starting cleanup file checked arithmetic filtering grouping format and tests preserved | 3e7b7e8c252cf6148d5d764b1959dcf71da6c5f6b052c68e5ff2d83b2626d6a5 |
| `src/transactionQuery.ts` | REVIEWED | Re read entire starting cleanup file checked arithmetic filtering grouping format and tests preserved | f6ce0a01702816ee2b44d3a4ebbc24368879285b3f74f3ff4223f4a3204ec0c9 |
| `src/transactionReads.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionRowActions.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionRowActions.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionSelection.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/transactionSelection.ts` | PENDING | Full content evaluation still required. |  |
| `src/transfers.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/transfers.ts` | PENDING | Full content evaluation still required. |  |
| `src/typeScale.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/types.ts` | PENDING | Full content evaluation still required. |  |
| `src/unsavedInput.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/unsavedInput.ts` | PENDING | Full content evaluation still required. |  |
| `src/updateBannerContrastStyles.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/useApplicationCalls.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/useApplicationCalls.ts` | PENDING | Full content evaluation still required. |  |
| `src/useAutoCancelDelete.ts` | PENDING | Full content evaluation still required. |  |
| `src/useDelayedVisibility.ts` | PENDING | Full content evaluation still required. |  |
| `src/useDismiss.ts` | PENDING | Full content evaluation still required. |  |
| `src/useFinancialRead.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/useFinancialRead.ts` | PENDING | Full content evaluation still required. |  |
| `src/useFixedPanel.ts` | PENDING | Full content evaluation still required. |  |
| `src/useImportReview.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/useImportReview.ts` | PENDING | Full content evaluation still required. |  |
| `src/useManualProfileLock.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/useManualProfileLock.ts` | PENDING | Full content evaluation still required. |  |
| `src/usePaymentSource.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/usePaymentSource.ts` | PENDING | Full content evaluation still required. |  |
| `src/usePopover.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/usePopover.ts` | PENDING | Full content evaluation still required. |  |
| `src/usePopoverFocus.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/useResolvedTheme.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/useResolvedTheme.ts` | PENDING | Full content evaluation still required. |  |
| `src/useSidebarOverlay.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/useSidebarOverlay.ts` | PENDING | Full content evaluation still required. |  |
| `src/useStatementReconcile.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/useStatementReconcile.ts` | PENDING | Full content evaluation still required. |  |
| `src/useTransactionBulkActions.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/useTransactionBulkActions.ts` | PENDING | Full content evaluation still required. |  |
| `src/useTransactionData.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/useTransactionData.ts` | PENDING | Full content evaluation still required. |  |
| `src/useTransactionFilters.ts` | PENDING | Full content evaluation still required. |  |
| `src/useTransactionList.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/useTransactionList.ts` | PENDING | Full content evaluation still required. |  |
| `src/useTransactionMove.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/useTransactionMove.ts` | PENDING | Full content evaluation still required. |  |
| `src/useTransactionRowActions.test.tsx` | PENDING | Full content evaluation still required. |  |
| `src/useTransactionRowActions.ts` | PENDING | Full content evaluation still required. |  |
| `src/useTransactionTransfers.ts` | PENDING | Full content evaluation still required. |  |
| `src/viewLoaders.test.ts` | PENDING | Full content evaluation still required. |  |
| `src/viewLoaders.ts` | PENDING | Full content evaluation still required. |  |
| `src/vite-env.d.ts` | PENDING | Full content evaluation still required. |  |
| `src/whatsNewNotes.test.tsx` | PENDING | Full content evaluation still required. |  |
| `tools/New-UpdateSigningKey.ps1` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | 2bbb3178b328d4225ee598594c43e6d717cf59a7b4630b0548f9bbc22410652b |
| `tools/analyze-bundle.mjs` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | 3994a3357d671695fbe952364510b05acdc51eeec24ec0b5274ec7098ffc94e9 |
| `tools/assert-edge-driver-match.ps1` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | 57b9e4be33d7db77823f795f77cfba73a40eb2dd7568194502734738a65ad318 |
| `tools/audit-dependencies.mjs` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | 788d14236daee0d51dffe99bff7b32d71e74f8c3d09573aa97ad791d9c6a2ed4 |
| `tools/benchmarks/.gitignore` | REVIEWED | Read full ingestion generator validator sources tests and docs do not change reference values | 0cb4bb39d3a7c996766186ad97cdb13e09643f814c094d975726eb0a735db819 |
| `tools/benchmarks/README.md` | REVIEWED | Read full ingestion generator validator sources tests and docs do not change reference values | 55316383a47747e2c5d59c8adf52512343121693cb7431ee926b8f68ace93135 |
| `tools/benchmarks/build.py` | REVIEWED | Read full ingestion generator validator sources tests and docs do not change reference values | d5a1fd0bd8cf7f46869ea38ae0ac99186be786dd56c8c03206f7cfd7322fdd4f |
| `tools/benchmarks/requirements.txt` | REVIEWED | Read full ingestion generator validator sources tests and docs do not change reference values | 7d104815efa1d30bbca0f8a11f545b656de9126737e8197b2dfb83e5d83e8492 |
| `tools/benchmarks/sources.json` | REVIEWED | Read full ingestion generator validator sources tests and docs do not change reference values | 3b2a5be4294ea88b83f6de17c645ec0144271b08e3ee47d18dc91b101d6e9a34 |
| `tools/benchmarks/test_build.py` | REVIEWED | Read full ingestion generator validator sources tests and docs do not change reference values | 5c31d529b5c4b7265fb350792f7225a6d84ffc6d7d7c4d7ffd211409eacc76da |
| `tools/benchmarks/validate.py` | REVIEWED | Read full ingestion generator validator sources tests and docs do not change reference values | 88105ac1be3ba15f66c972ae404b42ccbed1ee024292133404e189966ef43083 |
| `tools/browser-download-contract.test.mjs` | REVIEWED | Reviewed local icon PNG generation static only service worker cache synthetic download fixtures and style capture | 15a10dba16ab1d302d42ba0efd726ce3cb709021e40ef67929f03374d2aa5771 |
| `tools/capture-style-previews.mjs` | REVIEWED | Reviewed local icon PNG generation static only service worker cache synthetic download fixtures and style capture | e53f61cf3939eeb8d18f267651e0350b9517303491b13c6eed4d1857186e9e7b |
| `tools/dependency-security-policy.mjs` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | 30825b3a49558bae1599566ca1fa85769b1ac1db450ff13121bd4bea286213e6 |
| `tools/dependency-security-policy.test.mjs` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | 1d9560c7b8badcb13d22478eb33cfcd0300202cce47d4e3cf0fc7ec3cc4eb185 |
| `tools/gen_split_commands_mapping.py` | REVIEWED | Reviewed canonical wire schema generation and historical command module mapping | 5e97bc23f45f4ded9db0483fe440e8907336231ede2b263d14669b2371b0a981 |
| `tools/generate_mobile_snapshot_types.py` | REVIEWED | Reviewed canonical wire schema generation and historical command module mapping | ab05fea5679338b6d82fc94cb0c9d3635998a0cfcd588c19abba6d76c24ce484 |
| `tools/mobile-icons.ts` | REVIEWED | Reviewed local icon PNG generation static only service worker cache synthetic download fixtures and style capture | 5c5b8d29e6c4368ea2c97b3bfb7d0a2bed3f1bcdf8a921057080b315dced1b0b |
| `tools/mobile-offline-build.ts` | REVIEWED | Reviewed local icon PNG generation static only service worker cache synthetic download fixtures and style capture | 8a770646dc14324b1516d2232876fff7d0643486702996cbd583c676cb5bba79 |
| `tools/mobile_test_firefox_ca.py` | REVIEWED | Reviewed disposable NSS trust synthetic browser storage offline and privacy assertions removed unused imports and unreachable null check | 642ff98c871c591522cc1a29dd51820273184c8940874c25ee0dbad75951ff8a |
| `tools/prepare-update-artifacts.mjs` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | 0e3cbf3b11e649313633e978b00dbd10b9c4d4264eaf64d2573456277ad9f8f2 |
| `tools/prepare-update-artifacts.test.mjs` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | fde83cbdd4ae402f70adc2ad502a2df2a438720e820e4e7dedcfb3a1f87f41e6 |
| `tools/run-hosted-desktop-tests.ps1` | REVIEWED | Reviewed hosted integrity and exit propagation test corrected stale retry argument expectation | 327b90455b5ba13835fd45e01489b9f7953bfb6a315724bc730de17b4431c93c |
| `tools/split_rust_items.py` | REVIEWED | Reviewed local icon PNG generation static only service worker cache synthetic download fixtures and style capture | 8107f9018ebd3c1f0efb2da701312be1914b3b7d6ea4589a303775382c723425 |
| `tools/startup-perf.mjs` | REVIEWED | Reviewed compiled mobile test boundaries native storage faults and synthetic startup probe no benchmark run | 029d5e03955cf9fc35b7336995b07707218d3191f0ad250ad3b37a4011afc279 |
| `tools/test_mobile_cross_browser.mjs` | REVIEWED | Reviewed disposable NSS trust synthetic browser storage offline and privacy assertions removed unused imports and unreachable null check | 2cda5d87c4e7be8811d8a4d1df572eff939721eacc0c56bf007a6445f54e3955 |
| `tools/test_mobile_offline.mjs` | REVIEWED | Reviewed compiled mobile test boundaries native storage faults and synthetic startup probe no benchmark run | 2d0316b0809dbb75c4b9e92b623f744fd428e14b0311499b472839364ba4fc7c |
| `tools/test_mobile_trusted_firefox.mjs` | REVIEWED | Reviewed disposable NSS trust synthetic browser storage offline and privacy assertions removed unused imports and unreachable null check | 211e3b27e76f83be10d1fd340f3b2155fbc962908b3920a7da4d20fcce25122e |
| `tools/test_mobile_viewer.mjs` | REVIEWED | Reviewed compiled mobile test boundaries native storage faults and synthetic startup probe no benchmark run | 8367820def86a55023bb71f412c0b1af342ecf7a34140acb2c3d8db64cb64bdc |
| `tools/test_release_workflow.py` | REVIEWED | Reviewed hosted integrity and exit propagation test corrected stale retry argument expectation | 6cec19d425921a5a333441025368c523751d440ac16454792f2067861f1e6c5f |
| `tools/test_split_rust_items.py` | REVIEWED | Reviewed local icon PNG generation static only service worker cache synthetic download fixtures and style capture | de389d9a1799a0d97478c01331b4bd803ceaeb50dd44e6e2453c1b39a1b3e069 |
| `tools/trim-incremental.ps1` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | 4ce4cd75a0ef59e80b00edc59160357c8962f55c404308d0762da28d7d692b38 |
| `tools/update-build-provenance.mjs` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | 3f1d9a10fd8105d527bf41c1b1ccab444fbe84147e0c08a7b7f7f17fa5e42096 |
| `tools/update-signing-workflow.test.mjs` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | 629c9e0079164a60ef5a2703db92f737825d2b343686e61a47945d76cb10a2d5 |
| `tools/update-signing.mjs` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | e81949e333c777f65c03e8b8f8e5be5e73b1166c6af741f0a05c188f79086417 |
| `tools/update-signing.test.mjs` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | 1028a38876f9650f49569836860b775dd3b8380e337a001713fa088829bf3392 |
| `tools/validate-prepared-build.mjs` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | 573e7ce387eabf10908742577c374bde690286f7fcbfd402c3c0dc88daac545b |
| `tools/validate-prepared-build.test.mjs` | REVIEWED | Reviewed audit fail closed policy signing byte provenance custody paths and contract tests | e7a80e6a5849d56946414069016ef3ae0cc37b6121d4ed4a65db108f3124822b |
| `tsconfig.json` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | cb4dd1777bc7f478cb417906c32099ae5e661865b3181df116ac70790e9a1a7e |
| `tsconfig.node.json` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | 6ec602b8aa146888c76f0b41ca3515f91f95919f6e6417a4670decaba8fcb982 |
| `vite.config.ts` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | 2194b8b7a1f90a9d5eaea62ab9b0f7cefe46f54c3da698ef7e43c8df71c622a7 |
| `vite.mobile.config.ts` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | 27db7a47969d2a43cfdeedfd51934925ec3eeff8df99cc78a3a84479f76c8adc |
| `vitest.config.ts` | REVIEWED | Reviewed root configuration and guidance no runtime change needed | ea6e607ba18d98aa1739f3f129e52999b2385b8ca405c1397e6011044ef0aac1 |

## Completion status

**INCOMPLETE.** All PENDING rows require content review. Directory-level inventory and automated checks do not satisfy those rows. Continue through the remaining areas, implement justified safe fixes, and run validation appropriate to each stable batch. Do not restart completed, hash-current reviews or repeat unrelated expensive validation merely because this report changes.

Completion requires every relevant file reviewed, every identified safe improvement resolved or specifically deferred with rationale, and appropriate validation recorded. The available response context limits how much source can be evaluated in one execution; unresolved files stay explicit rather than being marked complete.
