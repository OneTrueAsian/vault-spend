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

import { spawn } from "node:child_process";
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

export async function launchApp({ dbDir, ready = ".brand-word", beforeReady } = {}) {
  const ownDbDir = dbDir === undefined;
  const testDbDir = dbDir ?? freshTestDbDir();
  const PORT = await getFreePort();
  const NATIVE_PORT = await getFreePort();

  const driverProcess = spawn(
    TAURI_DRIVER,
    ["--port", String(PORT), "--native-port", String(NATIVE_PORT), "--native-driver", MSEDGEDRIVER],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, VAULTSPEND_DB_DIR: testDbDir } },
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

  await waitForPort(PORT);

  let browser;
  try {
    browser = await connectWithRetries({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/",
      capabilities: {
        browserName: "wry",
        "tauri:options": { application: APP_EXE },
      },
      logLevel: "silent",
    });
    // WebView2 automation sessions start blank by design (like a browser
    // session starting at about:blank) — Tauri does not auto-navigate under
    // TAURI_WEBVIEW_AUTOMATION, so every test must do this once up front.
    await browser.url("http://tauri.localhost/index.html");
    // A narrow window to run something (e.g. seeding localStorage) after the page has navigated —
    // so it's on the app's own origin — but as early as possible relative to the app's own mount
    // effects, for a test that needs to be present before the app's very first read of it.
    if (beforeReady) await beforeReady(browser);
    try {
      await browser.$(ready).waitForExist({ timeout: 15000 });
    } catch (waitErr) {
      const src = await browser.getPageSource().catch(() => "<getPageSource failed>");
      throw new Error(`App loaded but never rendered ${ready}. Page source:\n${src}\n\n${waitErr.stack || waitErr}`);
    }
    // The welcome and "What's new" dialogs exist only inside the app itself. A spec that waits for
    // something else (the launch error screen, the profile selector) never sees them at this point
    // — call dismissFirstLaunchDialogs once the app itself is actually showing, e.g. after a
    // selector/lock-screen detour reaches it, if it needs to interact with anything past them.
    if (ready === ".brand-word") {
      await dismissFirstLaunchDialogs(browser);
    }
  } catch (e) {
    driverProcess.kill();
    throw new Error(`Failed to start session (tauri-driver log below):\n${driverLog}\n\n${e.stack || e}`);
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
