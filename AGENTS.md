# Repository instructions for coding assistants

## Testing workflow

- Read `e2e/README.md` before changing or running end to end tests. The E2E suite drives a compiled Tauri app and requires a current `npx tauri build --debug --no-bundle` after app changes.
- For focused changes, run `npm test` first. Then run `npm run e2e:smoke` and the affected E2E specs with `npm run e2e -- --spec=<feature numbers or filename fragments>`. Use `npm run e2e -- --list` to find specs. Add or update focused tests for the behavior changed.
- Run the full `npm run e2e` for release work or changes to shared UI infrastructure, persistence, or the E2E harness. Do not describe a targeted run as full regression coverage.
- If a required test cannot run, report the command, the blocker, and which checks did run. Do not claim tests passed without running them.
