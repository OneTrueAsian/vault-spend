# Repository instructions for coding assistants

## Testing workflow

- Use the validation scope rules below when interpreting these commands. A requirement for a final regression is not a requirement to repeat it after every edit.
- Read `e2e/README.md` before changing or running end to end tests. The E2E suite drives a compiled Tauri app and requires a current `npx tauri build --debug --no-bundle` after app changes.
- For focused changes, run `npm test` and `npm run lint` first. Then run `npm run e2e:smoke` and the affected E2E specs with `npm run e2e -- --spec=<feature numbers or filename fragments>`. Use `npm run e2e -- --list` to find specs. Add or update focused tests for the behavior changed.
- Run the full `npm run e2e` for release work or changes to shared UI infrastructure, persistence, or the E2E harness. Do not describe a targeted run as full regression coverage.
- Build with `npm run build:app` (same debug Tauri build, but under exclusive access and reused when every input matches) so builds and desktop runs do not collide. Run Cargo commands that use the shared `target\` folder through `npm run access -- <name> -- <command>` when another agent may be building or running desktop specs. See "Building and running without stepping on each other" in `e2e/README.md`.
- `npm run select:specs` lists the desktop specs a change can affect (unknown or shared files select everything); `npm run verify:fast` runs the full unit suite, tsc and lint plus only the native checks and desktop specs the change reaches; `npm run verify:full` runs everything. Neither is milestone or release acceptance, and a fast or targeted run must never be described as full regression coverage.
- If a required test cannot run, report the command, the blocker, and which checks did run. Do not claim tests passed without running them.

## Validation scope and avoiding unnecessary reruns

Authority: the owner's 20 October 2026 instruction to record these rules in repository guidance and verification tooling. These rules qualify earlier references to the "final tree"; they do not waive required acceptance checks.

| Change or checkpoint | Required approach |
| --- | --- |
| Individual fix during development | Run targeted RED/GREEN behavior tests. Batch related fixes before expensive final validation. |
| Unit-test-only change | Run the affected tests, the full inexpensive unit suite, and applicable lint/type checks. Do not automatically rebuild the app or repeat desktop regression. |
| Documentation-only change | Run relevant documentation checks; no automatic application build, desktop suite or benchmark. Embedded documents used by the app are application inputs, not documentation-only changes. |
| Stable batch affecting shared UI infrastructure, persistence, the runner or harness | Run one final full regression for the stable batch, plus the applicable required gates. Do not run it once per fix. |
| Performance comparison | Use the agreed repetitions only after correctness is stable. Three-run benchmark groups are not three regressions required per change. |

- Before an expensive run, state what changed since the last valid run, the exact requirement making this run necessary, why existing evidence cannot cover the change, and the estimated duration. Cite the requirement by file and line, or by the owner's explicit instruction. Record this brief with the run evidence.
- After a passing final regression, repeat it only with a specific explanation of the affected application behavior, shared infrastructure or invalidated evidence. A changed fingerprint alone is not sufficient justification. A test-only edit may require rerunning that test; it does not automatically invalidate unrelated compiled-app checks.
- Track application build inputs, test/harness/fixture inputs and documentation separately. A test or documentation edit must not silently be treated as an application change. If a purported test/document is actually embedded or imported by production code, it remains an application input.
- Preserve valid prior evidence and describe its boundaries. Do not call reused evidence a fresh run, waive failing checks, or automatically cache passing results. "Final tree" means the evidence must cover the final behavior; it does not require every expensive check again after every file edit.
- Additional benchmark repetitions beyond the agreed measurement plan require explicit owner approval. Record all failures and retries; approval is not inferred from silence or an available time budget.
- Coordinate measurement windows: do not run unit tests, lint, compilation, other desktop sessions or profiling alongside another agent's performance measurements. Do not stop another agent's processes to obtain access.
- The verification tooling must expose its plan before execution and must not silently turn a routine fix into full regression or benchmarking. Existing selection/cache limitations must be disclosed rather than used as a reason to repeat unaffected validation.
