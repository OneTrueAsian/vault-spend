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
import { remote } from "webdriverio";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const CARGO_BIN = "C:\\Users\\joeyf\\.cargo\\bin";
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
function freshTestDbDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-e2e-"));
  return dir;
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

// Every fresh test DB (localStorage is per-webview-origin, not shared with a real install) hits
// the first-launch welcome dialog, which blocks clicks on everything behind its overlay — dismiss
// it here once so no individual spec needs to know about it. `launchApp` already calls this itself
// when `ready` is left at its default (`.brand-word`); a spec that waits for something ELSE first
// (a launch error screen, the profile selector, a lock screen) and only reaches the open app
// afterward — e.g. by unlocking a profile mid-test — must call this itself once `.brand-word`
// actually exists, before clicking anything else, or the very first click lands on this overlay.
export async function dismissFirstLaunchDialogs(browser) {
  const getStarted = await browser.$("button*=Just get started");
  if (await getStarted.isExisting()) {
    await getStarted.click();
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
  const { width, height } = await browser.getWindowSize();
  await browser.maximizeWindow();
  await browser.setWindowSize(width, height);
  await browser.waitUntil(() => browser.execute(() => document.hasFocus()), {
    timeout: 5000,
    timeoutMsg: "the app window never regained focus (another window is holding OS foreground)",
  });
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
async function launchAppOnce({ dbDir, ready = ".brand-word", beforeReady, showLegalNotice = false } = {}) {
  const ownDbDir = dbDir === undefined;
  const testDbDir = dbDir ?? freshTestDbDir();
  const PORT = await getFreePort();
  const NATIVE_PORT = await getFreePort();

  const driverProcess = spawn(
    TAURI_DRIVER,
    ["--port", String(PORT), "--native-port", String(NATIVE_PORT), "--native-driver", MSEDGEDRIVER],
    {
      stdio: ["ignore", "pipe", "pipe"],
      // The legal notice would stop every spec at its screen. The app honours the skip only alongside
      // VAULTSPEND_DB_DIR, so a real install cannot be affected. feature139 passes showLegalNotice.
      env: { ...process.env, VAULTSPEND_DB_DIR: testDbDir, VAULTSPEND_SKIP_LEGAL_NOTICE: showLegalNotice ? "0" : "1" },
    },
  );
  let driverLog = "";
  driverProcess.stdout.on("data", (d) => (driverLog += d.toString()));
  driverProcess.stderr.on("data", (d) => (driverLog += d.toString()));

  // Only clean up a throwaway dir this call created itself — never one the
  // caller passed in (e.g. explore.mjs chaining several launches against
  // one seeded fixture), and only after a genuinely clean process exit, so
  // a failed spec's database is still there to debug afterward.
  if (ownDbDir) {
    process.on("exit", () => {
      if ((process.exitCode ?? 0) === 0) {
        try {
          fs.rmSync(testDbDir, { recursive: true, force: true });
        } catch {
          /* best effort — never fail the run over cleanup */
        }
      }
    });
  }

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
      await dismissFirstLaunchDialogs(session);
      mark("first-launch dialogs dismissed");
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
      driverProcess.kill();
      // Wait for the actual exit rather than firing kill() and moving on —
      // bounded so a driver that won't die can't hang the caller, but this
      // still stops a lingering tauri-driver/msedgedriver from outliving
      // the spec that started it.
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        driverProcess.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
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

async function openMenu(trigger) {
  const root = await trigger.parentElement();
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  const menu = await root.$("[role='menu']");
  await menu.waitForDisplayed({ timeout: 5000, timeoutMsg: "the menu should open" });
  return menu;
}

const itemLabel = async (item) => (await item.getText()).replace(/\s*✓\s*$/, "").trim();

/** Opens a MenuSelect and chooses the option with this `value` or this visible `label`. */
export async function chooseMenuOption(trigger, { value, label }) {
  const menu = await openMenu(trigger);
  for (const item of await menu.$$("[role='menuitemradio']")) {
    const matches = value !== undefined ? (await item.getAttribute("data-value")) === value : (await itemLabel(item)) === label;
    if (matches) {
      await item.click();
      return;
    }
  }
  throw new Error(`no menu option ${value !== undefined ? `with value "${value}"` : `labelled "${label}"`}`);
}

/** The visible labels of a MenuSelect's options, in order (opens the menu, reads it, closes it). */
export async function menuOptionLabels(trigger) {
  const menu = await openMenu(trigger);
  const labels = [];
  for (const item of await menu.$$("[role='menuitemradio']")) labels.push(await itemLabel(item));
  await trigger.click();
  return labels;
}
