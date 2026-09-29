// Shared helpers for the interrupted-backup specs (feature129-131, Phase F Task 1): launch the app
// with a `VAULTSPEND_FAILPOINT`, click "Back up now", hard-kill the exact process at the checkpoint
// named in backups.rs, and inspect what that left on disk. Debug builds only — the failpoints are
// compiled out of release builds.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dismissFirstLaunchDialogs, launchApp } from "../harness.mjs";
import { killAtFailpoint } from "./protection.mjs";

export const PASSWORD = "correct horse battery staple";

const FINAL_DB = /^vaultspend-\d{8}-\d{6}(_\d+)?\.db$/;
const ORPHAN_KEY_OR_DB_KEY = /^vaultspend-\d{8}-\d{6}(_\d+)?\.db\.key$/;
const STAGING = /^\.vaultspend-backup-.*\.partial(-journal|-wal|-shm|\.key)?$/;

export async function invoke(browser, command, args = {}) {
  return browser.executeAsync(
    (command, args, done) => {
      window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (error) => done({ error: String(error) }));
    },
    command,
    args,
  );
}

/** Complete published backups in `dir` (a recognized `.db` name), sorted. */
export function finals(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => FINAL_DB.test(f)).sort() : [];
}

/** Key files sitting in `dir` for a given database name, whether or not the database exists. */
export function keyFiles(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => ORPHAN_KEY_OR_DB_KEY.test(f)).sort() : [];
}

/** Staging debris in `dir` (what an interrupted copy leaves behind, never listed as a backup). */
export function stagingFiles(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => STAGING.test(f)).sort() : [];
}

/** Adds a plaintext copy of the live db named for "a few minutes ago" so no automatic backup is due at launch. */
export function seedRecentBackup(dbDir) {
  const stamp = new Date(Date.now() - 5 * 60 * 1000);
  const p2 = (n) => String(n).padStart(2, "0");
  const name = `vaultspend-${stamp.getFullYear()}${p2(stamp.getMonth() + 1)}${p2(stamp.getDate())}-${p2(stamp.getHours())}${p2(stamp.getMinutes())}${p2(stamp.getSeconds())}.db`;
  fs.copyFileSync(path.join(dbDir, "vaultspend.db"), path.join(dbDir, "backups", name));
  return name;
}

/** True when `file` is a plaintext SQLite database that passes its integrity check and still holds the seeded data. */
export function plaintextBackupIsSound(file) {
  const script = [
    "import sqlite3, sys",
    "c = sqlite3.connect(sys.argv[1])",
    "assert c.execute('pragma integrity_check').fetchone()[0] == 'ok', 'integrity'",
    "assert c.execute('select count(*) from transactions').fetchone()[0] >= 1, 'no data'",
  ].join("\n");
  try {
    execFileSync("python", ["-c", script, file], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function launchWithFailpoint(dbDir, failpoint, options = {}) {
  if (failpoint) process.env.VAULTSPEND_FAILPOINT = failpoint;
  try {
    return await launchApp({ dbDir, ...options });
  } finally {
    delete process.env.VAULTSPEND_FAILPOINT;
  }
}

export async function unlockOnlyProfile(browser, password = PASSWORD) {
  await (await browser.$("[data-profile-option]")).click();
  await (await browser.$("#password-form-field")).setValue(password);
  await (await browser.$("button=Unlock")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 15000, timeoutMsg: "the profile should unlock" });
  await dismissFirstLaunchDialogs(browser);
}

/** Launches `dbDir` (protected profiles land on the selector and are unlocked), returns the running app. */
export async function openApp(dbDir, { failpoint, isProtected }) {
  const app = await launchWithFailpoint(dbDir, failpoint, isProtected ? { ready: "[data-profile-selector]" } : {});
  if (isProtected) await unlockOnlyProfile(app.browser);
  else await dismissFirstLaunchDialogs(app.browser);
  return app;
}

/** Clicks "Back up now" and hard-kills the app the instant it reaches `failpoint`. */
export async function killDuringBackupNow(app, dbDir, failpoint) {
  const { browser } = app;
  await (await browser.$("button*=Settings")).click();
  await (await browser.$("[data-backups]")).waitForExist({ timeout: 10000 });
  const pid = (await invoke(browser, "debug_process_id")).ok;
  await killAtFailpoint(dbDir, failpoint, pid, () =>
    browser.execute(() => [...document.querySelectorAll("button")].find((button) => button.textContent === "Back up now").click()),
  );
  await app.close();
}

/** What the app itself lists as restorable backups, sorted. */
export async function listedBackups(browser) {
  const listed = (await invoke(browser, "list_backups")).ok;
  assert.ok(Array.isArray(listed), "list_backups should answer");
  return listed.map((b) => b.filename).sort();
}
