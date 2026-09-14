# E2E testing (WebDriver, real compiled app)

Real UI automation for Vault Spend, driven through Tauri's official WebDriver
support (`tauri-driver` + Microsoft Edge WebDriver, since the app uses
WebView2 on Windows). No headless-browser stand-in — this drives the actual
compiled `.exe`, IPC included.

## One-time machine setup (already done on this machine)

- `cargo install tauri-driver` — installed to `~/.cargo/bin/tauri-driver.exe`.
- Microsoft Edge WebDriver matching the installed WebView2 Runtime version
  (check installed version via the `EdgeWebView\Application` folder under
  `C:\Program Files (x86)\Microsoft\`). Download from
  `https://msedgedriver.microsoft.com/<version>/edgedriver_win64.zip` (the
  older `msedgedriver.azureedge.net` CDN is dead — use this host) and drop
  `msedgedriver.exe` into `~/.cargo/bin` too. If WebView2 auto-updates past
  this driver's version, re-download matching the new version.
- `npm install --save-dev webdriverio` (already in `package.json`).

## Before running any spec

Tauri automation sessions start at `about:blank` (like a browser session) —
`launchApp()` in `harness.mjs` handles navigating to the app and waiting for
it to render, so specs don't need to.

**The binary must be built via the Tauri CLI, not a bare `cargo build`.** A
plain `cargo build`/`cargo run` produces a binary that fails to find its own
embedded frontend assets ("asset not found: index.html") — only going
through the CLI's build pipeline embeds them correctly:

```
npx tauri build --debug --no-bundle
```

Re-run this after any frontend or backend change before running a spec.

## Data safety

Every `launchApp()` call generates a fresh, throwaway SQLite database in a
temp directory (via `VAULTSPEND_DB_DIR`, read in `src-tauri/src/lib.rs`'s
`setup()`) — **tests never touch the user's real AppData database.** This
is a one-line env-var escape hatch with zero effect on normal launches
(unset in every real use of the app).

## Running a spec

```
node e2e/smoke.mjs
```

Each `.mjs` file under `e2e/` is a small standalone script (no `@wdio/cli`
config/runner) — `import { launchApp } from "./harness.mjs"`, do things with
`app.browser` (a `webdriverio` remote client), then `await app.close()`.
`app.browser.$(selector)` / `$$(selector)` are plain CSS selectors against
the real rendered DOM.

## Running the full suite

```
node e2e/run-all.mjs                 # smoke.mjs + every feature*.mjs, concurrency 4
node e2e/run-all.mjs --concurrency=8  # verified stable on this machine, ~6x faster than sequential
node e2e/run-all.mjs --concurrency=1  # one at a time, for debugging a flaky-looking failure in isolation
```

Specs run concurrently by default because they're already fully isolated
from each other: each `launchApp()` call gets its own throwaway SQLite file
(see "Data safety" above) *and*, since `harness.mjs` asks the OS for a free
port per call instead of using a hardcoded one, its own `tauri-driver`
instance — no two specs share any state, so there's nothing for
parallel runs to race on. Measured on this machine across all 52 specs:
304.5s sequential -> 86.7s at concurrency 4 -> 50.9s at concurrency 8, all
52/52 passing at every level.

If a spec ever *does* fail only when run concurrently (never in isolation),
that's a real isolation bug worth fixing, not a race to paper over —
re-run it alone (or at `--concurrency=1`) first to confirm it's not simply
a flaky assertion, then look for accidental shared state (a hardcoded port,
a fixed temp path, anything read from the real AppData folder instead of
`VAULTSPEND_DB_DIR`).
