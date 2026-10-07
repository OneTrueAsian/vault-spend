// Minimal Tauri WebDriver E2E harness (no @wdio/cli project, just the
// `webdriverio` standalone client talking to `tauri-driver`, which in turn
// drives the real compiled app through the WebView2 native driver). Used to
// click-test UI that no automated frontend test suite otherwise covers.
//
// Prerequisites installed once for this machine (documented in
// e2e/README.md): `cargo install tauri-driver`, and a msedgedriver.exe
// matching the installed WebView2 Runtime version, both under
// C:\Users\<you>\.cargo\bin.
//
// Before running a spec: `npx tauri build --debug --no-bundle` so the binary
// under target/debug embeds the current frontend (tauri-driver launches the
// compiled .exe directly, not the vite dev server). Not a bare `cargo build`
// or `cargo build --workspace` — either produces a binary that can't find
// its own embedded frontend (it renders "asset not found: index.html" and
// any WebDriver session against it times out waiting for `.brand-word` to
// exist); only going through the Tauri CLI actually embeds the frontend.

import { execFileSync, spawn } from "node:child_process";
import net, { Socket } from "node:net";
import { homedir } from "node:os";
import { remote } from "webdriverio";
import path from "node:path";
import { isolatedTempEnv, makeTempDir, releaseTempDir } from "./lib/tempDir.mjs";

export function cargoBin(env = process.env, home = homedir()) {
  return path.join(env.CARGO_HOME || path.join(home, ".cargo"), "bin");
}
const CARGO_BIN = cargoBin();
const TAURI_DRIVER = path.join(CARGO_BIN, "tauri-driver.exe");
const MSEDGEDRIVER = path.join(CARGO_BIN, "msedgedriver.exe");
// VAULTSPEND_EXE points the suite at a build in another target directory (a running copy locks the default one).
const APP_EXE = path.resolve(process.env.VAULTSPEND_EXE ?? "target/debug/vaultspend.exe");

// Asks the OS for a free ephemeral port (bind to :0, read what it picked,
// release it) rather than a hardcoded one — lets multiple specs run
// concurrently (see run-all.mjs) each with their own tauri-driver instance
// instead of fighting over one fixed port. The tiny window between
// releasing the probe socket and tauri-driver binding it is the same
// accepted tradeoff the `get-port` npm package makes; fine for local test
// parallelism at the concurrency levels this suite runs at.
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// How long launchApp waits for the app to be driveable before giving up with a report of how far it got.
// Comfortably under run-all.mjs's 60 s per-spec cap, which would otherwise kill a stuck launch silently.
const LAUNCH_DEADLINE_MS = 40_000;
// How long the drivers get to produce a loaded page. A healthy launch takes about 4 s even under heavy load.
const PAGE_REACHED_DEADLINE_MS = 15_000;
// A launch that stalls before the page loads is tried once more, with a fresh driver and app.
const LAUNCH_ATTEMPTS = 2;

/** Every WebDriver command gets 25 s to be answered and is never sent twice. WebdriverIO's defaults (120 s,
 * then three more tries) meant a command the driver never answered left the spec silent until run-all.mjs
 * killed it at 60 s, with nothing saying which command it was (feature163 and feature106 in Task 16's
 * full runs). Now it fails with "Request timed out ... when running <command>" and the spec's own stack.
 * No healthy command takes anywhere near 25 s; a spec's longer waits poll with short commands. */
export const DRIVER_REQUEST_OPTIONS = Object.freeze({ connectionRetryTimeout: 25_000, connectionRetryCount: 0 });

/** Whether an error is a WebDriver command that got no answer in time (see DRIVER_REQUEST_OPTIONS), as
 * opposed to a command that failed or a waitUntil that ran out. */
export function isCommandTimeout(error) {
  return Boolean(error) && /Request timed out/.test(String(error.message ?? ""));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForPort(port, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = async () => {
      const socket = new Socket();
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", async () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`tauri-driver never opened port ${port}`));
        else { await sleep(1000); tryConnect(); }
      });
      socket.connect(port, "127.0.0.1");
    };
    tryConnect();
  });
}

// Every E2E run gets its own throwaway SQLite file — never the user's real
// AppData database. Read by src-tauri/src/lib.rs via VAULTSPEND_DB_DIR.
// Deleted on exit, passed or failed (lib/tempDir.mjs; VAULTSPEND_KEEP_E2E_TEMP=1 keeps it).
function freshTestDbDir() {
  return makeTempDir("vaultspend-e2e-");
}

// The TCP port opening (waitForPort) doesn't guarantee tauri-driver's
// WebDriver HTTP endpoint is ready to accept a session request the very
// next instant — there used to be a flat sleep(500) here as a defensive
// buffer, paid on every single launch regardless of whether it was needed.
// Retrying the actual connection is strictly more precise: it waits only
// as long as reality requires (almost always the first or second attempt)
// instead of a fixed guess, while still capping the worst case.
async function connectWithRetries(options, { attempts = 20, delayMs = 100 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await remote(options);
    } catch (e) {
      lastErr = e;
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

// Closes any status message with its Dismiss button, as a person would. A success message stays up
// for 10 seconds and, at the 800x600 test window, can sit over the control a spec clicks next: the
// driver then refuses the click ("element click intercepted") and WebdriverIO retries it until the
// message goes, which cost about 10 seconds a click (most of feature103's run time).
export async function dismissStatusMessages(browser) {
  for (const button of await browser.$$(".status-dismiss")) {
    await button.click().catch(() => {}); // it may have closed on its own meanwhile
  }
}

// Every fresh test DB (localStorage is per-webview-origin, not shared with a real install) hits
// the first-launch welcome dialog, which blocks clicks on everything behind its overlay — dismiss
// it here once so no individual spec needs to know about it. `launchApp` already calls this itself
// when `ready` is left at its default (`.brand-word`); a spec that waits for something ELSE first
// (a launch error screen, the profile selector, a lock screen) and only reaches the open app
// afterward — e.g. by unlocking a profile mid-test — must call this itself once `.brand-word`
// actually exists, before clicking anything else, or the very first click lands on this overlay.
// Views wait for the profile's data before they render (a loading placeholder, `[data-data-loading]`,
// stands in until then; QA H3), so the sidebar showing is not the same as the app being usable — on
// a busy machine the first read can take seconds. `launchApp` waits for this by default; pass
// `waitForData: false` to watch the loading state itself (feature157), and call this after reaching
// the app some other way (the profile selector, an unlock).
export async function waitForDataLoaded(browser, timeout = 60000) {
  await browser.waitUntil(() => browser.execute(() => !document.querySelector("[data-data-loading]")), {
    timeout,
    interval: 50,
    timeoutMsg: "the profile's data never finished loading",
  });
}

export async function dismissFirstLaunchDialogs(browser) {
  const getStarted = await browser.$("button*=Just get started");
  if (await getStarted.isExisting()) {
    try {
      await getStarted.click();
    } catch (e) {
      // It can go between the check and the click — e.g. feature121's focus-loss lock replaces the whole
      // app with the lock screen. Gone is what this wanted; anything else is a real failure.
      if (await getStarted.isExisting()) throw e;
    }
  }
  // Immediately after Welcome, a fresh launch also always hits the "What's new" dialog — a fresh
  // profile means no version has ever been "seen" yet, exactly like a true first install. Same
  // blocking-overlay problem, same fix. Its version check is an async Tauri call (and only renders
  // once Welcome is gone), so give it a moment rather than checking once immediately.
  try {
    const gotIt = await browser.$("button=Got it");
    await gotIt.waitForExist({ timeout: 3000 });
    await gotIt.click();
  } catch {
    // didn't show this run (e.g. no CHANGELOG entry for this version) — nothing to dismiss
  }
}

// Every spec starts at this window size (launchApp's `windowSize`), wide enough for the sidebar to show
// its names: below 1000px it shows icons only. A spec that needs the narrow layout sets it itself.
export const DEFAULT_WINDOW_SIZE = Object.freeze({ width: 1280, height: 800 });

const requestedSizes = new WeakMap();

/** The window size last asked for through `browser.setWindowSize` (see trackWindowSize), if any. */
export function requestedWindowSize(browser) {
  return requestedSizes.get(browser);
}

/** Makes `browser.setWindowSize` remember each size asked for, so reclaimWindowFocus can put it back. */
export function trackWindowSize(browser) {
  const record = (width, height) => requestedSizes.set(browser, { width, height });
  if (typeof browser.overwriteCommand === "function") {
    browser.overwriteCommand("setWindowSize", async (original, width, height) => {
      record(width, height);
      return original(width, height);
    });
  } else {
    const original = browser.setWindowSize.bind(browser);
    browser.setWindowSize = async (width, height) => {
      record(width, height);
      return original(width, height);
    };
  }
}

/** Sets the window size, asking again (up to 3 times in all) until it holds, and returns the size the
 * window ended at. A size it cannot take (narrower than the app's minimum, say) is left as it ends. */
export async function applyWindowSize(browser, { width, height }) {
  let now;
  for (let attempt = 0; attempt < 3; attempt++) {
    await browser.setWindowSize(width, height);
    now = await browser.getWindowSize();
    if (now.width === width && now.height === height) break;
  }
  return now;
}

/** The size every spec starts at (launchApp's `windowSize`). Logs the size the window ended at, and
 * throws, naming both sizes, if it isn't the one asked for: a spec run at the wrong size would fail
 * later in a confusing place (the narrow layout hides names and columns), so it fails here instead. */
export async function applyLaunchWindowSize(browser, size) {
  const ended = await applyWindowSize(browser, size);
  console.log(`[harness] window ${ended.width}x${ended.height}`);
  if (ended.width !== size.width || ended.height !== size.height) {
    throw new Error(`launchApp should start the window at ${size.width}x${size.height}, but it stayed at ${ended.width}x${ended.height} after 3 attempts`);
  }
  return ended;
}

// Under the parallel runner, every other spec's app window that launches takes OS foreground from
// this one: `document.hasFocus()` flips to false while `document.activeElement` is untouched, so
// `:focus`/`:focus-visible` stop matching and any focus-dismissed UI (a dropdown menu) closes. That
// is the environment, not the app — reproduced deterministically by launching a second window, and
// it is what made feature108's focus assertion and feature112's menu measurement flaky only in full
// runs. `window.focus()` and `switchToWindow` do NOT bring it back; maximizing does, so maximize and
// put the size back (layout-neutral in the end). Call it right before a focus-sensitive check; it
// does nothing when the window already has focus, so it can't hide a genuine focus bug — a field
// that is focused but still not `:focus-visible` after this is a real failure.
export async function reclaimWindowFocus(browser) {
  if (await browser.execute(() => document.hasFocus())) return;
  // The size last asked for (see trackWindowSize), not the size the window reports: a window that an
  // earlier attempt could not put back would otherwise keep the wrong size from then on.
  const size = requestedWindowSize(browser) ?? (await browser.getWindowSize());
  await browser.maximizeWindow();
  // Resizing a maximized window only un-maximizes it, back to the size it was created at (800x600), and
  // ignores the size asked for — so a spec that had set 1440x1000 silently dropped to the narrow layout
  // after every reclaim. Ask again until the size really is back.
  await applyWindowSize(browser, size);
  await browser.waitUntil(() => browser.execute(() => document.hasFocus()), {
    timeout: 5000,
    timeoutMsg: "the app window never regained focus (another window is holding OS foreground)",
  });
}

// Runs `step` (a focus-sensitive interaction: open a menu and pick from it, hover for a readout, focus a
// chart and press keys) with the window's focus reclaimed first. If the step fails and the window lost OS
// focus at any point while it ran — another spec's window launching closes blur-dismissed menus and drops
// key/hover events — it is run again, up to `attempts` times. A window `blur` listener records the loss,
// because focus often comes back before the failure is noticed, so `hasFocus()` alone misses it. A failure
// in a window that kept its focus is a real one and is thrown at once.
export async function withFocusRetry(browser, step, { attempts = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    await reclaimWindowFocus(browser);
    await browser.execute(() => {
      window.__e2eLostFocus = false;
      if (!window.__e2eBlurWatch) {
        window.__e2eBlurWatch = true;
        window.addEventListener("blur", () => (window.__e2eLostFocus = true));
      }
    });
    try {
      return await step();
    } catch (e) {
      const lostFocus = await browser.execute(() => window.__e2eLostFocus || !document.hasFocus()).catch(() => false);
      if (!lostFocus || attempt >= attempts) {
        e.message += ` [withFocusRetry: ${attempt} attempt(s); window lost focus on the last: ${lostFocus}]`;
        throw e;
      }
    }
  }
}

// Opens a blur-dismissed dropdown (not a MenuSelect, which chooseMenuOption covers) and clicks one of its
// options, through withFocusRetry: another spec's window taking focus between the two clicks closes the
// menu. `trigger` and `option` are each a selector or an async function returning the element (a row's own
// trigger is found inside its row).
export async function pickFromMenu(browser, trigger, option) {
  const find = async (target) => (typeof target === "function" ? target() : browser.$(target));
  const label = (target) => (typeof target === "function" ? "the option" : target);
  await withFocusRetry(browser, async () => {
    await (await find(trigger)).click();
    const element = await find(option);
    await element.waitForDisplayed({ timeout: 3000, timeoutMsg: `${label(option)} should show after clicking ${label(trigger)}` });
    await element.click();
  });
}

/** Answers the native file picker (`plugin:dialog|open`) with `files`, one path per pick, in order (null
 * once they run out, which is "cancelled"), by wrapping `window.fetch`: Tauri sends each command as a
 * fetch to ipc.localhost, and `__TAURI_INTERNALS__.invoke`, `window.__TAURI_INTERNALS__` and `window.ipc`
 * are all read-only, so fetch is the one place a command can be answered.
 *
 * The catch (tauri's scripts/ipc-protocol.js): the first IPC fetch that fails, a request dropped while
 * the machine is busy, switches the page to `window.ipc.postMessage` for good. From then on no command
 * passes through fetch, so the pick goes to the real, modal file picker, which nobody answers: the spec
 * hangs with no error until the runner kills it (feature162, once in a full run). So the wrapper also
 * retries a failed IPC fetch before Tauri sees the failure (Tauri itself would resend the same message
 * over postMessage, so this repeats nothing Tauri wouldn't), and the stub checks that commands still go
 * through fetch, failing at once with the reason if the page had already switched. */
export async function stubFilePicker(browser, files) {
  const result = await browser.executeAsync((paths, done) => {
    window.__pickedFiles = paths;
    if (!window.__filePickerStubbed) {
      window.__filePickerStubbed = true;
      window.__ipcFetches = 0;
      const answer = () => (window.__pickedFiles.length ? window.__pickedFiles.shift() : null);
      const originalFetch = window.fetch;
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      window.fetch = function (input) {
        const url = decodeURIComponent(String(typeof input === "string" ? input : input.url));
        if (!url.includes("ipc.localhost")) return originalFetch.apply(window, arguments);
        window.__ipcFetches++;
        if (url.endsWith("plugin:dialog|open")) {
          return Promise.resolve(new Response(JSON.stringify(answer()), { status: 200, headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }));
        }
        const args = arguments;
        const attempt = (left) => originalFetch.apply(window, args).catch((e) => (left > 0 ? pause(150).then(() => attempt(left - 1)) : Promise.reject(e)));
        return attempt(5);
      };
    }
    const before = window.__ipcFetches;
    window.__TAURI_INTERNALS__.invoke("list_accounts").then(
      () => done({ throughFetch: window.__ipcFetches > before }),
      (e) => done({ error: String(e) }),
    );
  }, files);
  if (result.error) throw new Error(`stubFilePicker: a test command failed: ${result.error}`);
  if (!result.throughFetch) {
    throw new Error("stubFilePicker: this window already sends Tauri commands over postMessage (an IPC fetch failed before the stub was installed), so the file picker can't be answered and would open for real");
  }
}

/** Opens a row's ⋯ menu (RowMenu) and clicks the item with this exact label, through withFocusRetry
 * (another window taking focus closes the menu between the two clicks). */
export async function chooseRowAction(browser, trigger, label) {
  try {
    await pickFromMenu(browser, trigger, async () => {
      // The panel renders after the click lands; on a busy machine that can be after this first
      // look, so keep looking briefly rather than judging the menu on one read.
      let found = null;
      await browser
        .waitUntil(
          async () => {
            for (const item of await browser.$$(".row-menu-panel [role^='menuitem']")) {
              if ((await item.getText()).trim() === label) {
                found = item;
                return true;
              }
            }
            return false;
          },
          { timeout: 3000, interval: 100 },
        )
        .catch(() => undefined);
      // Not found: hand back a fixed, never-matching selector so the wait fails.
      return found ?? browser.$(".row-menu-panel [data-row-action-missing]");
    });
  } catch (e) {
    e.message += ` [chooseRowAction: looking for the menu item "${label}"]`;
    throw e;
  }
}

// A snapshot of what the app window looks like right now, for failure messages: whether it has OS
// focus (see reclaimWindowFocus), where keyboard focus is, any dialog, alert or status text, and the
// start of the visible page. Never throws — a dead window reports why instead.
export async function diagnose(browser) {
  try {
    return await browser.execute(() => {
      const label = (el) => (el ? `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.split(" ")[0] : ""}` : null);
      const clip = (el, n) => el.innerText.replace(/\s+/g, " ").trim().slice(0, n);
      return {
        hasFocus: document.hasFocus(),
        visibility: document.visibilityState,
        active: label(document.activeElement),
        dialogs: [...document.querySelectorAll(".modal-panel")].map((n) => clip(n, 120)),
        alerts: [...document.querySelectorAll("[role='alert'], .status")].map((n) => clip(n, 160)),
        page: (() => {
          const page = document.querySelector(".page");
          return page ? clip(page, 200) : null;
        })(),
      };
    });
  } catch (e) {
    return { diagnoseFailed: String(e).slice(0, 200) };
  }
}

// browser.waitUntil, but a timeout says what the window looked like (and anything `extra` reports),
// so a failure seen once in a full parallel run explains itself instead of needing a re-run.
export async function waitUntilOrDiagnose(browser, condition, { timeout = 10000, timeoutMsg, extra } = {}) {
  try {
    await browser.waitUntil(condition, { timeout });
  } catch (e) {
    let more = "";
    try {
      more = extra ? ` extra=${JSON.stringify(await extra())}` : "";
    } catch (extraError) {
      more = ` extra failed: ${String(extraError).slice(0, 120)}`;
    }
    throw new Error(`${timeoutMsg ?? "condition not met"} (after ${timeout}ms) window=${JSON.stringify(await diagnose(browser))}${more}\n${e.message}`);
  }
}

/** Picks a visual style on Settings > Appearance the way a person does: opens Settings, waits for that
 * style's row (the click needs the row itself, not just its group), clicks its radio and waits until
 * the style (`palette`, the value of `<html data-palette>`) is applied. */
export async function chooseStyle(browser, label, palette) {
  await (await browser.$(".nav-item[data-tab=settings]")).click();
  const styleRows = (text) =>
    [...document.querySelectorAll('[role="radiogroup"][aria-label="Style"] .style-preview-tile')].filter(
      (r) => r.querySelector(".style-preview-name")?.textContent === text,
    ).length;
  await waitUntilOrDiagnose(browser, async () => (await browser.execute(styleRows, label)) > 0, {
    timeoutMsg: `Settings > Appearance should offer ${label}`,
  });
  await browser.execute((text) => {
    const row = [...document.querySelectorAll('[role="radiogroup"][aria-label="Style"] .style-preview-tile')].find(
      (r) => r.querySelector(".style-preview-name")?.textContent === text,
    );
    row.querySelector("input").click();
  }, label);
  await waitUntilOrDiagnose(browser, () => browser.execute((p) => document.documentElement.dataset.palette === p, palette), {
    timeoutMsg: `choosing ${label} should apply it`,
  });
}

// Kills a process and everything it started. tauri-driver starts msedgedriver, which starts the app, so a
// plain child.kill() would leave both running.
function killTree(pid) {
  try {
    execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
  } catch {
    /* already gone */
  }
}

// One launch attempt. See launchApp below for the retry around it.
async function launchAppOnce({ dbDir, ready = ".brand-word", beforeReady, showLegalNotice = false, waitForData = true, windowSize = DEFAULT_WINDOW_SIZE } = {}) {
  // A caller's own dbDir (e.g. explore.mjs chaining several launches against one seeded fixture) is
  // theirs to clean up; one made here is deleted on exit.
  const testDbDir = dbDir ?? freshTestDbDir();
  // msedgedriver makes a fresh WebView2 profile (scoped_dir*\EBWebView, tens of MB) in the temp folder for
  // every session, and only deletes it on a clean shutdown it rarely gets here. Point the driver's temp
  // folder at a folder of this launch's own, and delete that folder in close() and on exit.
  const launchTempDir = makeTempDir("vaultspend-webview-");
  const PORT = await getFreePort();
  const NATIVE_PORT = await getFreePort();

  const driverProcess = spawn(
    TAURI_DRIVER,
    ["--port", String(PORT), "--native-port", String(NATIVE_PORT), "--native-driver", MSEDGEDRIVER],
    {
      stdio: ["ignore", "pipe", "pipe"],
      // The legal notice would stop every spec at its screen. The app honours the skip only alongside
      // VAULTSPEND_DB_DIR, so a real install cannot be affected. feature139 passes showLegalNotice.
      env: {
        ...process.env,
        ...isolatedTempEnv(launchTempDir),
        VAULTSPEND_DB_DIR: testDbDir,
        VAULTSPEND_SKIP_LEGAL_NOTICE: showLegalNotice ? "0" : "1",
      },
    },
  );
  let driverLog = "";
  driverProcess.stdout.on("data", (d) => (driverLog += d.toString()));
  driverProcess.stderr.on("data", (d) => (driverLog += d.toString()));

  // Every step below can wait on a process outside this one (tauri-driver, msedgedriver, the app, the
  // webview), and a few have no timeout of their own, so a stuck launch used to sit silently until
  // run-all.mjs killed the whole spec at 60 s with no output at all. Record how far the launch got and
  // give up first, so a failure says where it was stuck and what the driver had printed.
  const launchStartedAt = Date.now();
  const phases = ["+0.0s driver spawned"];
  const mark = (phase) => phases.push(`+${((Date.now() - launchStartedAt) / 1000).toFixed(1)}s ${phase}`);
  let deadlineTimer;
  const deadline = new Promise((_, reject) => {
    deadlineTimer = setTimeout(() => reject(new Error(`launchApp gave up after ${LAUNCH_DEADLINE_MS / 1000}s; the last phase reached was "${phases.at(-1)}"`)), LAUNCH_DEADLINE_MS);
  });

  // Everything up to the first page load talks only to the drivers and the webview, never to the app's own
  // code. In roughly 1 launch in 100 under load it goes wrong for good, in one of two ways: the session is
  // created and the first navigation never returns, or the session is reported invalid as soon as the
  // navigation starts (the app was fine when started directly, 0 exits in 180 launches). Either way nothing
  // of the spec has run yet — see launchApp, which retries a launch that fails here.
  async function reachPage() {
    await waitForPort(PORT);
    mark("driver port open");
    const session = await connectWithRetries({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/",
      capabilities: {
        browserName: "wry",
        "tauri:options": { application: APP_EXE },
      },
      logLevel: "silent",
      ...DRIVER_REQUEST_OPTIONS,
      // WebdriverIO times each BiDi command out after 180 s by default, with a timer that keeps this process
      // alive until it fires. A launch abandoned by the retry in launchApp leaves its stuck navigation command
      // pending against a driver that has been killed, so that timer outlived a spec that had already
      // finished and passed — long enough for run-all.mjs to kill the process as timed out (measured: the
      // process exited 165 s after the script body finished). No healthy command takes anywhere near 30 s.
      bidiResponseTimeout: 30_000,
    });
    mark("session created");
    // WebView2 automation sessions start blank by design (like a browser
    // session starting at about:blank) — Tauri does not auto-navigate under
    // TAURI_WEBVIEW_AUTOMATION, so every test must do this once up front.
    await session.url("http://tauri.localhost/index.html");
    mark("page navigated");
    return session;
  }

  async function startSession() {
    let stuckTimer;
    const stuck = new Promise((_, reject) => {
      stuckTimer = setTimeout(() => {
        reject(Object.assign(new Error(`no driveable page after ${PAGE_REACHED_DEADLINE_MS / 1000}s; the last phase reached was "${phases.at(-1)}"`), { launchStalled: true }));
      }, PAGE_REACHED_DEADLINE_MS);
    });
    const session = await Promise.race([
      reachPage().catch((e) => {
        throw Object.assign(e, { launchStalled: true });
      }),
      stuck,
    ]).finally(() => clearTimeout(stuckTimer));
    // A narrow window to run something (e.g. seeding localStorage) after the page has navigated —
    // so it's on the app's own origin — but as early as possible relative to the app's own mount
    // effects, for a test that needs to be present before the app's very first read of it.
    if (beforeReady) await beforeReady(session);
    // The window opens at 800x600, where the sidebar shows icons only. Start every spec at a size where it
    // shows its names (DEFAULT_WINDOW_SIZE); `windowSize: null` keeps the size the window opened at.
    trackWindowSize(session);
    if (windowSize) {
      const ended = await applyLaunchWindowSize(session, windowSize);
      mark(`window set to ${ended.width}x${ended.height}`);
    }
    try {
      await session.$(ready).waitForExist({ timeout: 15000 });
      mark(`${ready} rendered`);
    } catch (waitErr) {
      const src = await session.getPageSource().catch(() => "<getPageSource failed>");
      throw new Error(`App loaded but never rendered ${ready}. Page source:\n${src}\n\n${waitErr.stack || waitErr}`);
    }
    // The welcome and "What's new" dialogs exist only inside the app itself. A spec that waits for
    // something else (the launch error screen, the profile selector) never sees them at this point
    // — call dismissFirstLaunchDialogs once the app itself is actually showing, e.g. after a
    // selector/lock-screen detour reaches it, if it needs to interact with anything past them.
    if (ready === ".brand-word") {
      try {
        await dismissFirstLaunchDialogs(session);
        mark("first-launch dialogs dismissed");
        if (waitForData) {
          await waitForDataLoaded(session);
          mark("profile data loaded");
        }
      } catch (e) {
        // A command the driver never answered, before any step of the spec has run, is the same driver
        // failure as a launch that never reaches its page (feature106 once hung here for 38 s in a full
        // run): launchApp retries it, and run-all.mjs counts the retry.
        if (isCommandTimeout(e)) throw Object.assign(e, { launchStalled: true });
        throw e;
      }
    }
    return session;
  }

  let browser;
  try {
    browser = await Promise.race([startSession(), deadline]);
  } catch (e) {
    killTree(driverProcess.pid);
    // Let go of the driver's pipes too: a process the tree kill missed could otherwise hold them open, and
    // Node would wait on them after the spec is done.
    driverProcess.stdout.destroy();
    driverProcess.stderr.destroy();
    driverProcess.unref();
    releaseTempDir(launchTempDir);
    throw Object.assign(new Error(`Failed to start session (phases: ${phases.join(" | ")}) (tauri-driver log below):\n${driverLog}\n\n${e.stack || e}`), {
      launchStalled: e.launchStalled === true,
    });
  } finally {
    clearTimeout(deadlineTimer);
  }

  return {
    browser,
    testDbDir,
    async close() {
      // Bounded: an app that died on its own (a spec's own process-kill test, or a genuine crash)
      // can leave tauri-driver waiting on a response that will never come — an unbounded await here
      // would hang this call (and so the whole spec) indefinitely instead of just leaking a little
      // slower. A real bug found running Task 9's own kill scenarios: they cost 90+s each before
      // this bound existed, and left tauri-driver/msedgedriver processes running afterward too,
      // since driverProcess.kill() below was never reached until the hung await gave up on its own.
      await Promise.race([
        browser.deleteSession().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      // The whole tree, not just tauri-driver: driverProcess.kill() left msedgedriver (and so the
      // WebView2 profile it holds open) running on its own.
      const exited = driverProcess.exitCode !== null ? Promise.resolve() : new Promise((resolve) => driverProcess.once("exit", resolve));
      killTree(driverProcess.pid);
      // Wait for the actual exit rather than firing the kill and moving on —
      // bounded so a driver that won't die can't hang the caller, but this
      // still stops a lingering tauri-driver/msedgedriver from outliving
      // the spec that started it.
      let timer;
      await Promise.race([exited, new Promise((resolve) => (timer = setTimeout(resolve, 3000)))]);
      clearTimeout(timer);
      releaseTempDir(launchTempDir);
    },
  };
}

// Launches the app and returns a driven session. A launch that stalls before the page loads (see
// launchAppOnce) is retried once with a fresh driver and app. The retry is reported on stderr, and
// run-all.mjs counts those reports, so a run that leaned on retries says so instead of hiding it.
export async function launchApp(options = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await launchAppOnce(options);
    } catch (e) {
      if (!e.launchStalled || attempt >= LAUNCH_ATTEMPTS) throw e;
      console.error(`[harness] launch retry ${attempt}/${LAUNCH_ATTEMPTS - 1}: ${e.message.split("\n")[0]}`);
    }
  }
}

// ---- MenuSelect helpers -------------------------------------------------------------------------
// Every single-select in the app is a MenuSelect (a trigger button plus a popover menu), not a native
// <select>, so WebdriverIO's selectByVisibleText / selectByAttribute / getValue do not apply. The trigger
// carries `data-value`; the open menu's items carry `data-value` and their label text.

/** The current value of a MenuSelect, given its trigger (what `select.getValue()` was). */
export async function menuSelectValue(trigger) {
  return trigger.getAttribute("data-value");
}

// The browser an element belongs to: `.parent` is whatever the element was queried from, which can be
// another element.
function browserOf(element) {
  let node = element;
  while (node.parent && typeof node.getWindowSize !== "function") node = node.parent;
  return node;
}

async function openMenu(trigger) {
  const root = await trigger.parentElement();
  // A menu closes when the window loses focus, and another spec's window launching in parallel takes OS
  // foreground, so reclaim it first (a no-op when focus is already fine).
  await reclaimWindowFocus(browserOf(trigger));
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  const menu = await root.$("[role='menu']");
  await menu.waitForDisplayed({ timeout: 5000, timeoutMsg: "the menu should open" });
  return menu;
}

// Each open menu's items, read in ONE call: [{ value, label }]. Reading item by item took a WebDriver round
// trip per option, a wide window for another spec's window to take OS focus — which blurs the menu and
// closes it (MenuSelect closes on a blur that leaves it), so the next read found no menu at all.
async function readMenuItems(menu) {
  return browserOf(menu).execute(
    (el) =>
      [...el.querySelectorAll("[role='menuitemradio']")].map((item) => ({
        value: item.getAttribute("data-value"),
        label: item.innerText.replace(/\s*✓\s*$/, "").trim(),
      })),
    menu,
  );
}

// Runs `use(menu)` against the opened menu. If the menu closed under it (focus taken by another window —
// see readMenuItems), focus is reclaimed and the menu reopened, up to three tries. A failure while the menu
// is still open is a real one and is thrown at once.
async function withOpenMenu(trigger, use) {
  for (let attempt = 1; ; attempt++) {
    let menu;
    try {
      // Opening is inside the retry too: focus taken right after the click closes the menu before it shows.
      menu = await openMenu(trigger);
      return await use(menu);
    } catch (e) {
      if (e.realMenuFailure || attempt >= 3 || (menu && (await menu.isDisplayed().catch(() => false)))) throw e;
    }
  }
}

/** Opens a MenuSelect and chooses the option with this `value` or this visible `label`. */
export async function chooseMenuOption(trigger, { value, label }) {
  await withOpenMenu(trigger, async (menu) => {
    const items = await readMenuItems(menu);
    const index = items.findIndex((item) => (value !== undefined ? item.value === value : item.label === label));
    if (index < 0) {
      throw Object.assign(new Error(`no menu option ${value !== undefined ? `with value "${value}"` : `labelled "${label}"`} (options: ${items.map((i) => i.label).join(", ")})`), { realMenuFailure: true });
    }
    await (await menu.$$("[role='menuitemradio']"))[index].click();
  });
}

/** The visible labels of a MenuSelect's options, in order (opens the menu, reads it, closes it). */
export async function menuOptionLabels(trigger) {
  const labels = await withOpenMenu(trigger, async (menu) => (await readMenuItems(menu)).map((item) => item.label));
  if ((await trigger.getAttribute("aria-expanded")) === "true") await trigger.click();
  return labels;
}
