# Project instructions

## Windows Shell Conventions

- For multi-line git commit messages, write the message to a temp file and run `git commit -F <file>`. Do not use PowerShell here-strings, because quotes inside them break the command.
- When editing files from PowerShell, use real newlines (`[Environment]::NewLine` or a Write/Edit tool). Never put a literal `r`n in a single-quoted string.
- Prefer the Edit/Write tools over sed or PowerShell string replacement for file edits.
- Always pass `--source winget` to `winget install`.

## Environment & Elevation

- Before any task that needs admin rights (DISM, driver installs, takeown/icacls, UAC-gated installers), check whether the shell is elevated. If it is not, tell the user up front instead of attempting the step.
- Do not run Playwright/WebView2 automation from an elevated shell, because elevation blocks it. Check elevation first before trying driver-version theories.
- Use 64-bit Python from python.org, not the Windows Store stub. Use the project's pinned Node version, not Node 26.
- If rustc crashes or PDBs look corrupt (often after a machine crash), delete `target/debug` before retrying. Do not keep retrying builds.

## Working Agreements

- When the user says they are about to reboot, or says 'stop' or 'end goal', stop immediately. Write a short handoff and do not start or restart tests.
- Never claim a review, screenshot check or verification you did not actually perform. List exactly what was checked.
- When finishing a planning task, say explicitly: 'The plan is complete. Nothing has been implemented yet.' Also give the file path.
- In Jira/Atlassian contexts, ask whether 'goal' means an Atlassian Goal or an Epic before creating anything.
- When committing, stage only the files you changed if the checkout contains unrelated changes.

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
- Fix and report issues that affect the requested behavior or the checks that verify it, including minor issues within that scope. Report unrelated findings separately, even when they appear in a file you touched.

## Durable owner decisions and working rules

### Testing and specs

- TDD and spec traceability: map each requirement to implementation, test and status. Write failing regressions first and review the source against the written rules. Stop and ask when a spec is ambiguous.
- Follow the validation scope in `AGENTS.md`. Use focused checks for routine changes and get owner approval before any full or long run. Report the coverage that actually ran. Read `e2e/README.md` before working on the desktop suite and use the managed E2E runner.
- Production code goes in the repo; essential coverage must live in routine test discovery.

### Git and release

- Commit, push, merge, tag and release only when told. Stage explicit paths and merge to `main` only when asked. Split release notes into New features, Enhancements and Bug fixes.
- "Push out the new build" authorizes the release workflow. Present the validation scope and estimated duration required by `AGENTS.md` before starting a full or long run. If the owner explicitly approves that presented scope in the release request, use that approval. Keep any separate release-signing approval in place.
- Preserve unrelated and concurrent work; do not discard branches or stashes. Two sessions may share the checkout, so recheck status and log if HEAD moves; use an isolated worktree for concurrent release work. Do not kill the owner's installed app to unlock a build.
- Release infra: public repo, unsigned Authenticode builds, macOS built by CI (no Mac available), signed update manifests. The updater downloads a release, verifies it against the signed manifest and starts the installer only after the user chooses to install (not notify-only).

### UI copy and UAT

- UI copy is plain language for non-financial users. Match shared ModalShell / MenuSelect / DateField and theme tokens.
- UAT plans are published pages with screenshots, Do→Expect checks, Pass/Fail marks and sign-off (template in `Implementations/uat-template/`). Screenshot new screens and review them as below; jsdom does not prove geometry or contrast.
- Screenshot review saves image tokens: run the specs with `--keep-screens` (or use the UAT shots folder), then `npm run e2e:review -- [folder]`, read its `summary.md`, and open only the flagged screenshots plus at least two passed ones per spec. The review starts Ollama itself if it is not running; if it still cannot run (exit 3), open the screenshots directly. A local pass is a hint, never acceptance or sign-off, and it does not notice missing content (spec DOM checks cover that).
- Research and spike plans and reports go to `E:/misc/Programming/Agents/Implementations`, never into the repo.

### Long-running and remote work

- Never end a turn saying "I'll check / watch / report back" unless the mechanism that wakes me is already running. I do nothing between turns. Dispatching a hosted run, a build, a release or any other wait means starting a background watch (for example `gh run watch <id> --exit-status` with `run_in_background`) in the same turn as the dispatch, before the hand-off message.
- If the watch can end before the work does (a time limit, a crash), say so, and re-arm it when it returns. If no wake-up mechanism is available, tell the owner plainly that they must ping me; do not imply I will follow up.
- When the watched work finishes, read the result and report it without being asked: what passed, what failed, the cause if known, and the options. Never make the owner say a run failed.

### Safety

- No messages to other people or services without explicit authorization.
- Keep personal statements, financial data, passwords, private keys and signing passphrases out of chat, logs and git.
- No real profile modification or host installer run as a test fallback.

## Verification workflow and environment

- Preview ticket validation with `npm run verify:targeted -- --since=<validated-ref> --plan`. Use the last validated commit to include changes already committed. Use `--since=HEAD` for uncommitted changes only. Review the selection before execution and record the baseline and executed checks in the handoff.
- For a checkout that predates VS-104, follow the instructions in `AGENTS.md` to bring in the targeted tooling while preserving in-progress work. When desktop checks are needed, use `npm run build:app` before running them. It verifies and reuses a current Tauri executable under exclusive access.
- Desktop E2E uses tauri-driver and Edge WebDriver with disposable `VAULTSPEND_DB_DIR` data. The runner supports `--spec` and `--list`. Focus-sensitive specs need an unlocked, awake desktop and exclusive access. Use the classified schedule for mixed local runs so these specs run alone. Use `--concurrency=1` for isolated reruns and where the hosted gate requires it. Keep other desktop runs off the same machine during the session.
- Node >= 22.19 required. On Windows, Git Bash PATH edits do not put Node 22 first; use a command-local Node 22 path or a PowerShell `$env:Path` prefix. Quoted multiline shell arguments are unreliable here; use a small Node runner. Use Windows-native builds rather than Git Bash's Perl/OpenSSL toolchain.
- Preserve CRLF conventions and scoped diffs. JSX tests use react-dom/client `createRoot` + `act` (no Testing Library).
- The e2e suite is timing-sensitive under parallel load; a single random spec timing out (passing solo) has happened in roughly 1 of 5 full runs, and the hosted gate now retries a failed spec once alone and reports it as flaky.
