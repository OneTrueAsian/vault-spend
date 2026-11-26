# Repository instructions for coding assistants

## Implementation plans

- Store implementation plans and their supporting move maps, progress notes, and validation evidence in `E:\misc\Programming\Agents\Implementations`, unless the owner explicitly requests another location. Do not create new implementation plans in this repository.

## Testing workflow

- Before validating a ticket, use the targeted verification workflow from VS-104. Run `npm run verify:targeted -- --since=<validated-ref> --plan` from the ticket's checkout. Use the last validated commit that precedes the changes under review so the plan includes committed work. Use `--since=HEAD` for uncommitted changes only.
- If an active branch predates VS-104, fetch and inspect the approved base for commit `27834c5` or an equivalent backport. Integrate the tooling only when the owner has authorized the needed Git action, and preserve in-progress work. If integration is pending or the tooling is unavailable, use the focused checks below and report the limitation.
- Review the preview against the ticket's actual impact. Remove `--plan` when the selection matches the work. If the selection is broad, review which checks are needed and get owner approval before starting any full or long run. Use `--allow-long` only for the approved scope. Include the baseline and checks executed in the ticket handoff.
- Choose validation based on what the change can affect. Small changes that do not materially alter app functionality use targeted checks only. This includes formatting, spacing, alignment, and other presentation fixes in shared components, including on a release branch.
- Read `e2e/README.md` before changing or running end-to-end tests. Use `npm run build:app` to verify or build the current Tauri executable before local desktop E2E.
- For small changes, run the smallest set of checks that verifies the change. Run specific unit tests with `npm test -- <test path>`, or use `npm run e2e -- --spec=<feature numbers or filename fragments>` when the change needs verification in the compiled app. Use `npm run e2e -- --list` to find specs. Add or update a focused test when needed to catch the regression.
- To review E2E or UAT screenshots, run the specs with `--keep-screens` (or use the UAT shots folder), then `npm run e2e:review -- [folder]`, read its `summary.md`, and open only the flagged screenshots plus at least two passed ones per spec. The review starts Ollama itself if it is not running; if it still cannot run (exit 3), open the screenshots directly. A local pass is a hint, never acceptance or sign-off, and it does not notice missing content (spec DOM checks cover that).
- Do not run the full unit suite, full desktop suite, or combined verification commands that include them for a small change. A release branch or a shared file does not by itself justify full testing. A separate release acceptance gate can be scheduled with the owner.
- Build with `npm run build:app` (same debug Tauri build, but under exclusive access and reused when every input matches) so builds and desktop runs do not collide. Run Cargo commands that use the shared `target\` folder through `npm run access -- <name> -- <command>` when another agent may be building or running desktop specs. See "Building and running without stepping on each other" in `e2e/README.md`.
- `npm run select:specs` lists potentially affected desktop specs. If it selects everything for an unknown or shared file, narrow the checks by reviewing the behavior that changed. `npm run verify:fast` includes the full unit suite, and `npm run verify:full` runs everything. Use either only with owner approval. Report targeted runs as targeted coverage.
- If a required test cannot run, report the command, the blocker, and which checks did run. Do not claim tests passed without running them.
- Demos, UAT walk-throughs and hands-on looks at the app use the shared practice data (`e2e/lib/practice-data/`, opened with `npm run demo`) instead of rows made up for the occasion. A new feature adds the data it needs there, with a row in `e2e/lib/practice-data/COVERAGE.md` and a check in `practiceData.test.mjs`. Automated E2E specs keep their own small fixtures.

## Validation scope and avoiding unnecessary reruns

The owner's 18 November 2026 instructions on targeted checks and approval before full or long-running validation govern when suites are started. Release acceptance requirements still apply when the owner schedules the release gate.

| Change or checkpoint | Required approach |
| --- | --- |
| Individual fix during development | Run targeted RED/GREEN behavior tests. Batch related fixes before expensive final validation. |
| Unit-test-only change | Run the affected tests and any directly applicable lint or type checks. |
| Documentation-only change | Run relevant documentation checks; no automatic application build, desktop suite or benchmark. Embedded documents used by the app are application inputs, not documentation-only changes. |
| Stable batch with material changes to core behavior, shared infrastructure, persistence, or the E2E harness | Recommend the applicable regression coverage and get owner approval before starting a full suite or any other long run. Batch related changes so one run can cover them. |
| Performance comparison | Use the agreed repetitions only after correctness is stable. Three-run benchmark groups are not three regressions required per change. |

- Before starting any full suite or other long validation run, show the owner what the focused checks proved, what has changed since the last valid run, what additional coverage is needed, and the estimated duration. Cite any applicable requirement and wait for explicit approval. Record the agreed scope with the run evidence.
- After a passing regression, repeat it only if there is a specific gap in the evidence for changed behavior and the owner approves the rerun. A changed build fingerprint, version metadata, or test-only edit does not by itself justify repeating a full suite.
- Track application build inputs, test/harness/fixture inputs and documentation separately. A test or documentation edit must not silently be treated as an application change. If a purported test/document is actually embedded or imported by production code, it remains an application input.
- Preserve valid prior evidence and describe its boundaries. Do not call reused evidence a fresh run, waive failing checks, or automatically cache passing results. "Final tree" means the evidence must cover the final behavior; it does not require every expensive check again after every file edit.
- Additional benchmark repetitions beyond the agreed measurement plan require explicit owner approval. Record all failures and retries; approval is not inferred from silence or an available time budget.
- Coordinate measurement windows: do not run unit tests, lint, compilation, other desktop sessions or profiling alongside another agent's performance measurements. Do not stop another agent's processes to obtain access.
- The verification tooling must expose its plan before execution and must not silently turn a routine fix into full regression or benchmarking. Existing selection/cache limitations must be disclosed rather than used as a reason to repeat unaffected validation.

## Waiting on long-running or remote work

An assistant does nothing between turns. Never close a turn with "I'll check later" unless the wake-up is already running: start a background watch (for example `gh run watch <id> --exit-status` with `run_in_background`) in the same turn as the dispatch, before the hand-off message. If the watch can end early, say so and re-arm it when it returns; if nothing can wake the assistant, tell the owner to ping it. When the work finishes, read and report the result unprompted (passed, failed, cause, options). Never rely on the owner to announce a failure.
