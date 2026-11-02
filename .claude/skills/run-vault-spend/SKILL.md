---
name: run-vault-spend
description: Build, run, test, and drive Vault Spend (the Tauri v2 + React budgeting desktop app). Use when asked to start Vault Spend, build it, run its tests, take a screenshot of its UI, or click/inspect the running app.
---

Vault Spend is a Tauri v2 desktop app (Rust backend in `src-tauri/` + `core/`,
React/Vite frontend in `src/`) for Windows. Drive it via the real compiled
`.exe` over Tauri's WebDriver support — `.claude/skills/run-vault-spend/explore.mjs`
for one-off exploration, or the existing `e2e/*.mjs` specs (same underlying
harness) for anything scripted. All paths below are relative to the repo
root.

## Prerequisites

One-time, per machine (already done on this one — `~/.cargo/bin` on this
machine has both):

```bash
cargo install tauri-driver
```

Microsoft Edge WebDriver matching the installed WebView2 Runtime's first three
version components (check `C:\Program Files (x86)\Microsoft\EdgeWebView\Application`),
downloaded from `https://msedgedriver.microsoft.com/<version>/edgedriver_win64.zip`
and dropped in as `msedgedriver.exe` next to `tauri-driver.exe` in
`~/.cargo/bin`. Node deps (`webdriverio` etc.) are already in `package.json`.

## Setup

```bash
npm install
```

## Build

The binary **must** go through the Tauri CLI, not a bare `cargo build` — see
Gotchas. This is also the build the driver launches:

```bash
npm run build:app
```

Produces `target/debug/vaultspend.exe` with the frontend embedded. Re-run
after any `src/` or `src-tauri/`/`core/` change before driving the app.

## Run (agent path)

Drive the compiled app via `explore.mjs` (wraps `e2e/harness.mjs`, the same
launcher every `e2e/feature*.mjs` spec uses — WebDriver session over
`tauri-driver` + `msedgedriver`, talking to the real `.exe`, IPC included).
Each invocation launches its own app process against a throwaway SQLite DB
and closes it when done; pass `--db <dir>` to reuse one database (e.g. one
seeded via `e2e/lib/seed.mjs`) across multiple invocations.

```bash
node .claude/skills/run-vault-spend/explore.mjs nav Budget screenshot out.png
```

Commands are given as sequential argv tokens, each consuming the args it needs:

| command | args | what it does |
|---|---|---|
| `nav` | `<label>` | click the sidebar nav button with this exact text |
| `click` | `<css>` | click the first element matching a CSS selector |
| `fill` | `<css> <value>` | `setValue` on the first match |
| `text` | `<css>` | print that element's trimmed text |
| `html` | `<css>` | print that element's outerHTML (first 2000 chars) |
| `eval` | `<js>` | run `js` in the webview, print the JSON result |
| `wait` | `<ms>` | pause |
| `screenshot` | `<path>` | save a PNG to `path` |

Chain as many as you like in one call, e.g.
`node .claude/skills/run-vault-spend/explore.mjs nav Ledger eval "document.querySelectorAll('tbody tr').length" screenshot ledger.png`.

To look at a populated app, seed and drive it in the same process. The fixture
helper's temporary directory is deleted when that process exits, so printing
its path from one process and reusing it from another does not preserve the fixture:

```js
import { seedDebtPaymentFixture } from "./e2e/lib/seed.mjs";
import { launchApp } from "./e2e/harness.mjs";
const dbDir = await seedDebtPaymentFixture();
const app = await launchApp({ dbDir });
try {
  console.log(await app.browser.$(".brand-word").getText());
} finally {
  await app.close();
}
```

Use `--db` only for a known disposable fixture directory that still exists.
Never pass a real profile directory. Filled values are not echoed by the
exploration tool; `text`, `html` and `eval` can still print selected page data,
so use synthetic data for exploration.

For anything beyond quick exploration (assertions, multi-step flows), write
a spec the same way the existing files under `e2e/` do: `import { launchApp }
from "./harness.mjs"`, then use `app.browser` (a `webdriverio` remote
client) directly. Read any `e2e/feature*.mjs` for the pattern.

## Run (human path)

```bash
npm run tauri dev   # opens a real window against the Vite dev server; Ctrl-C to stop
```

## Test

```bash
npm test
npm run lint
npx tsc --noEmit
npm run access -- cargo-test -- cargo test --workspace -- --test-threads=1
npm run build:app
npm run e2e:smoke
npm run e2e -- --spec=2   # example affected feature selection
```

Follow `AGENTS.md` and `e2e/README.md` for validation scope. Use `npm run e2e`
for the full desktop suite; a selected feature run is focused coverage only.
Build and desktop commands use exclusive access, and the runner checks the
compiled artifact's identity before starting. Never bypass that guard for acceptance.

---

## Gotchas

- **A bare `cargo build`/`cargo run`/`cargo test` produces a broken binary.**
  Any of these rebuilds `target/debug/vaultspend.exe` through cargo's own
  build graph, which can't find its own embedded frontend — launching it
  renders `asset not found: index.html` instead of the app, and any
  WebDriver session against it times out waiting for `.brand-word` to
  exist. `cargo test --workspace` is an easy trap here: it looks read-only
  but still builds the `vaultspend` bin target as part of the workspace, so
  running it *after* a working `tauri build` silently clobbers the binary
  for driving purposes — the tests themselves still pass, and you won't
  notice until the next e2e run or manual drive fails to launch. Always
  rebuild via `npm run build:app` as the last step before
  driving the app, even if you only ran `cargo test` since the last build.
- **WebdriverIO's `tag*=text` / `tag=text` shorthand only matches a *bare*
  `"tag*=text"` pattern.** Combine it with a descendant combinator like
  `"nav button*=Budget"` and it silently falls through to being sent to
  `tauri-driver` as literal (invalid) CSS, erroring `invalid selector`.
  `explore.mjs`'s `nav` command works around this by listing `nav button`s
  and filtering by exact text instead — do the same for any other
  text-matched click.
- **If the build step fails to overwrite `target/debug/vaultspend.exe`**
  (permission/linker error), a previous instance built from that exact path
  is still running — Windows locks running executables. Check
  `tasklist //FI "IMAGENAME eq vaultspend.exe"` and close it (a stray
  `npm run tauri dev` session or a manually launched debug build) before
  rebuilding. A separately-installed copy (Program Files) or a
  `target/release` build won't conflict.
- **Driver paths use `CARGO_HOME/bin`, or `~/.cargo/bin` when unset.**
  Keep the Tauri driver matched to WebView2. Standalone browser tests can
  require a separate Edge-browser-matched driver via `MSEDGEDRIVER`.
- **Every fresh (unseeded) launch hits two blocking dialogs** — "Welcome"
  then "What's new" — before the app is interactive. `launchApp()` in
  `e2e/harness.mjs` (and therefore `explore.mjs`) already dismisses both;
  you don't need to handle them yourself.
