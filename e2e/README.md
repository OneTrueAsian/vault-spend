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

`launchApp()` sets the window to 1280x800 (`DEFAULT_WINDOW_SIZE` in
`harness.mjs`) before the spec starts. The window opens at 800x600, and below
1000px wide the sidebar shows icons only (its names stay in the page, as each
tab's `aria-label` and visually hidden text, so `button*=Settings` still
finds a tab). A spec that needs the narrow layout calls
`browser.setWindowSize(800, 600)` itself; `launchApp({ windowSize: null })`
keeps the size the window opened at. The launch prints the size the window
ended at (`[harness] window 1280x800`) and fails at once if it isn't the size
asked for, rather than letting the spec fail later in the narrow layout.

To switch visual style the way a person does, use `chooseStyle(browser,
"Retro", "retro")` from `harness.mjs`: it opens Settings, waits for that
style's row, chooses it and waits until it applies.

## Running the full suite

```
node e2e/run-all.mjs                 # smoke.mjs + every feature*.mjs, concurrency 6
node e2e/run-all.mjs --concurrency=8  # tune for a faster machine
node e2e/run-all.mjs --concurrency=1  # one at a time, for debugging a flaky-looking failure in isolation
```

Specs run concurrently by default because they're already fully isolated
from each other: each `launchApp()` call gets its own throwaway SQLite file
(see "Data safety" above) *and*, since `harness.mjs` asks the OS for a free
port per call instead of using a hardcoded one, its own `tauri-driver`
instance — no two specs share any state, so there's nothing for
parallel runs to race on. An earlier 52-spec benchmark measured 304.5s
sequential, 86.7s at concurrency 4, and 50.9s at concurrency 8. The suite
has grown since then; the default is 6 because later measurements found
little additional gain at 8 and signs of resource contention. On 2026-10-01
(149 specs, 16 threads) six full runs at 6 and at 3 were equally clean once
`reclaimWindowFocus` stopped shrinking windows to 800x600 (see below), so 6
stays. A covered window was measured to keep full timer speed and stay
`visible`: background throttling is not a cause here.

## Faster feedback during development

The full suite remains the release or broad-regression check. For a focused
change, run the unit tests first, then smoke and the affected E2E specs against
the current compiled app:

```
npm test
npm run e2e:smoke
npm run e2e -- --spec=75,77
npm run e2e -- --spec=budget_rollover,month_review
npm run e2e -- --list
```

`--spec` accepts comma-separated feature numbers, case-insensitive filename
fragments, or `smoke`. Every selector must match at least one spec; a typo
fails immediately instead of silently skipping coverage. `--list` previews
the selection without starting any drivers. The runner prints the five
slowest specs after each run and records successful durations to schedule
longer specs first on later runs.

Rebuild with `npx tauri build --debug --no-bundle` after an app change before
running E2E. Run the full `npm run e2e` before a release and after changes to
shared UI infrastructure, persistence, or the E2E harness. This keeps routine
feedback short without treating a targeted run as full regression coverage.

If a spec ever *does* fail only when run concurrently (never in isolation),
that's worth fixing properly, not a race to paper over — re-run it alone (or
at `--concurrency=1`) first to confirm it's not simply a flaky assertion,
then look for accidental shared state (a hardcoded port, a fixed temp path,
anything read from the real AppData folder instead of `VAULTSPEND_DB_DIR`).
Shared state has not been the cause so far; the causes below have been.

## Failures that only happen in parallel runs

Every one of these passed alone and failed only under load. Each was
reproduced on demand and fixed at its cause, not retried away.

- **Another spec's window takes OS focus.** A launching window takes
  foreground, so `document.hasFocus()` flips to false in the others. Call
  `reclaimWindowFocus(browser)` before keyboard input or a focus-sensitive
  check. Also do not let a spec's own outcome depend on the window keeping
  focus: `feature121` turns on "Lock when the window loses focus", so the app
  correctly locks the profile when another window steals focus, and the spec
  unlocks and retries when (and only when) the lock screen is what stopped it.
  Focus can also go and come back in the middle of a step, which closes any
  open menu (they close on blur) and drops hover and key events. Use the
  harness helpers rather than clicking a trigger and then its option:
  `chooseMenuOption` / `menuOptionLabels` for a MenuSelect, `pickFromMenu`
  for any other dropdown, and `withFocusRetry` around anything else
  focus-sensitive (a hover readout, keys on a focused chart). They retry only
  when the window really lost focus during the step.
- **Reclaiming focus shrank the window.** `reclaimWindowFocus` maximizes and
  then restores the size, but resizing a maximized window only un-maximizes
  it, back to the app's 800x600 default. Every spec that had set a larger
  window and then reclaimed focus silently switched to the narrow layout
  (missing columns, moved controls), which failed whichever check came next.
  It now sets the size again until it holds (`e2e/harness.test.mjs`), and it
  restores the size the spec last asked for (the harness records every
  `setWindowSize`), not whatever size the window reports.
- **Counting IPC as loads.** Tauri sends every command as a fetch to
  `ipc.localhost`, so `performance.getEntriesByType("resource")` grows
  whenever a background command runs; leave those out when checking that
  something loaded nothing (`feature128`).
- **Reading once.** The app loads its data after its shell appears. A spec
  that clicks and then reads the page once sees the empty state when the
  machine is busy. Wait for the state you assert on and give the wait a
  message that reports what the window looked like: `waitUntilOrDiagnose` in
  `harness.mjs` (features 24, 42, 95, 121, 101 use it). Never assert on a
  single read.
- **Views wait for the first load.** Until the profile's data has arrived, a
  view shows a loading placeholder (`[data-data-loading]`) instead of its
  content, so the sidebar can be up while the Dashboard's stat cards do not
  exist yet. `launchApp` waits for that load before it returns; pass
  `waitForData: false` only to watch the loading itself (feature157), and call
  `waitForDataLoaded(browser)` after reaching the app through the profile
  selector or an unlock.
- **Fixtures the app is right to change.** `feature127` pinned a dashboard
  widget for an investment account that did not exist, and the app is meant
  to drop such pins once its data loads, so the layout it read back depended
  on timing. A fixture must describe a state the app keeps.
- **A dropped IPC request switches Tauri to postMessage.** Tauri sends each command as a fetch to
  ipc.localhost, and the first one that fails switches the page to `window.ipc.postMessage` for
  good (tauri's `scripts/ipc-protocol.js`). Specs answer the native file picker by wrapping
  `window.fetch` (`invoke`, `__TAURI_INTERNALS__` and `window.ipc` are all read-only), so after the
  switch the real picker opened, nobody answered it, and `feature162` hung silently until the
  runner killed it at 60 s. Use `stubFilePicker(browser, files)` from `harness.mjs`: it retries a
  failed IPC fetch before Tauri sees the failure, and fails at once if the page had already
  switched. `feature119`'s save-dialog stub retries the same way.
- **Launch failures before any page loads.** In roughly 1 launch in 100 under
  load the driver layer either creates a session whose first navigation never
  returns, or reports "invalid session id" as soon as it starts. Nothing of the
  spec has run at that point, and the app started directly is fine (180
  launches, no exits). `launchApp` gives the launch 15 seconds to load a
  page, kills that attempt's process tree, and tries once more. A retry
  prints `[harness] launch retry` and `run-all.mjs` totals them, so a run that
  needed one says so.

To reproduce a load-dependent failure and to show a fix works, use
`e2e/stress.mjs`:

```
node e2e/stress.mjs e2e/feature121_auto_lock_settings.mjs 8 6 12   # 8 rounds, 6 copies at once, 12 CPU hogs
```

It reports the pass rate and each distinct failure, and saves the full output
of failing runs (`STRESS_OUT`, default the temp folder). A fix should turn a
measured failure rate into zero, not just pass once.
