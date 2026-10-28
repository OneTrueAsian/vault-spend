# Project instructions

## Where to look

- Testing and verification: follow `AGENTS.md`.
- End-to-end suite: read `e2e/README.md` before working with it.

## Coding principles

### Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity first

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Surgical changes

Touch only what you must. Clean up only your own mess. The test: every changed line should trace directly to the user's request.

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked; if you notice unrelated dead code, mention it.
- Scope of "fix every issue found" (see below): issues in code your change touches or tests get fixed and reported. Unrelated problems are reported, not changed.

## Durable owner decisions and working rules

### Testing and specs

- TDD and spec traceability: map each requirement to implementation, test and status; write failing regressions first; review the source separately against the written rules. Fix every issue found, including minors, and tell the owner. Stop and ask when a spec is ambiguous.
- Run the full suite, not just new tests, before calling anything done. E2E always through `npm run e2e` / `node e2e/run-all.mjs` (parallel), never a sequential loop. `AGENTS.md` and `e2e/README.md` are authoritative for test scope; read the README before touching the suite. Targeted passes are not full regression coverage.
- Production code goes in the repo; essential coverage must live in routine test discovery.

### Git and release

- Commit, push, merge, tag and release only when told. "Push out the new build" means the full release pipeline start to finish without stopping for confirmation. Stage explicit paths, never `git add -A`. Never merge to `main` without being asked. Release notes are split into New features / Enhancements / Bug fixes.
- Preserve unrelated and concurrent work; do not discard branches or stashes. Two sessions may share the checkout, so recheck status and log if HEAD moves; use an isolated worktree for concurrent release work. Do not kill the owner's installed app to unlock a build.
- Release infra: public repo, unsigned Authenticode builds, macOS built by CI (no Mac available), signed update manifests, notify-only updater by design.

### UI copy and UAT

- UI copy is plain language for non-financial users. Match shared ModalShell / MenuSelect / DateField and theme tokens.
- UAT plans are published pages with screenshots, Do→Expect checks, Pass/Fail marks and sign-off (template in `Implementations/uat-template/`). Screenshot new screens and look at them; jsdom does not prove geometry or contrast.
- Research and spike plans and reports go to `E:/misc/Programming/Agents/Implementations`, never into the repo.

### Safety

- No messages to other people or services without explicit authorization.
- Keep personal statements, financial data, passwords, private keys and signing passphrases out of chat, logs and git.
- No real profile modification or host installer run as a test fallback.

## Verification workflow and environment

- Focused change: `npm test` and `npm run lint`, then a current Tauri build, `npm run e2e:smoke` and affected specs. Shared UI, persistence or harness changes need the full `npm run e2e`.
- Build helper binaries and Rust checks first; build the app LAST with `npx tauri build --debug --no-bundle` before desktop automation. Bare Cargo builds do not embed frontend assets and can overwrite the WebDriver executable. Rebuild after source changes; never test a stale binary.
- Desktop E2E uses tauri-driver and Edge WebDriver with disposable `VAULTSPEND_DB_DIR` data. Runner supports `--spec` and `--list`. Focus and OS-focus specs need an unlocked, awake desktop and `--concurrency=1`; no competing desktop runs.
- Node >= 22.19 required. On Windows, Git Bash PATH edits do not put Node 22 first; use a command-local Node 22 path or a PowerShell `$env:Path` prefix. Quoted multiline shell arguments are unreliable here; use a small Node runner. Use Windows-native builds rather than Git Bash's Perl/OpenSSL toolchain.
- Preserve CRLF conventions and scoped diffs. JSX tests use react-dom/client `createRoot` + `act` (no Testing Library).
- The e2e suite is timing-sensitive under parallel load; a single random spec timing out (passing solo) has happened in roughly 1 of 5 full runs, and the hosted gate now retries a failed spec once alone and reports it as flaky.
