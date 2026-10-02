// Fixtures and helpers for Task 9's per-profile-password-protection e2e coverage: seeding a
// multi-profile registry directly (skip the UI, same "fixture speed" reasoning as seed.mjs's own
// helpers), seeding a populated profile worth converting, and killing the app at an exact,
// repeatable instant via the marker-file failpoint mechanism (protection_transition.rs's
// `debug_failpoint`).

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedFixtureInto } from "./seed.mjs";
import { dateInMonth } from "./dates.mjs";
import { dismissStatusMessages } from "../harness.mjs";

const INIT_DB_EXE = path.resolve("target/debug/init_db.exe");

function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.on("exit", () => {
    if ((process.exitCode ?? 0) === 0) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort — never fail the run over cleanup */
      }
    }
  });
  return dir;
}

function sanitize(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "-") || "profile";
}

/**
 * Writes a `profiles.json` registry (one real, unprotected `vaultspend.db` per entry, laid out the
 * same way `profiles.rs`'s own `profiles/<id>/vaultspend.db` convention does) into a fresh test dir
 * — and, if `opts.lastUsed` names one, a matching `device-settings.json`. Returns the dir; pass it
 * to `launchApp({ dbDir })` yourself. `entries` is empty for the "registry exists but lists no
 * profiles" state. Only unprotected entries: none of this task's selector-rendering scenarios need
 * a real encrypted profile, and fabricating one from JS (matching budget_core's actual Argon2id/
 * XChaCha20 key file format) is out of scope for a fixture helper.
 */
export async function seedProfiles(entries, opts = {}) {
  const dbDir = freshDir("vaultspend-e2e-selector-");
  const profiles = entries.map((entry, i) => {
    const id = `${sanitize(entry.name)}-${i}`;
    const profileDir = path.join(dbDir, "profiles", id);
    fs.mkdirSync(profileDir, { recursive: true });
    execFileSync(INIT_DB_EXE, [profileDir], { stdio: "ignore" });
    return { id, name: entry.name, db_path: path.join(profileDir, "vaultspend.db"), icon_key: null };
  });
  fs.writeFileSync(path.join(dbDir, "profiles.json"), JSON.stringify({ profiles }));
  if (opts.lastUsed) {
    const match = profiles.find((p) => p.name === opts.lastUsed);
    fs.writeFileSync(path.join(dbDir, "device-settings.json"), JSON.stringify({ last_used_profile_id: match?.id ?? null }));
  }
  return dbDir;
}

/**
 * Seeds the db a plain `launchApp({ dbDir: testDbDir })` opens (`testDbDir/vaultspend.db`) with an
 * account, a transaction and two historical plaintext backups — the JS equivalent of
 * `protection_transition.rs`'s own `populated_profile` test fixture, so a real `enable_profile_
 * protection` run through the UI has real rows to convert and real backups to clean up after a
 * kill. Call this BEFORE `launchApp`, on a dir nothing has opened yet (same ordering every other
 * seed.mjs-based fixture already uses).
 */
export async function seedPopulatedProfile(testDbDir) {
  await seedFixtureInto(
    testDbDir,
    `
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "${dateInMonth(-2, 20)}", "Market Basket", "-42.17", "Groceries", f"{checking_id}|${dateInMonth(-2, 20)}|market basket|-42.17"),
)
`,
  );
  const dbFile = path.join(testDbDir, "vaultspend.db");
  const backupsDir = path.join(testDbDir, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.copyFileSync(dbFile, path.join(backupsDir, "vaultspend-20260918-090000.db"));
  fs.copyFileSync(dbFile, path.join(backupsDir, "vaultspend-20260919-090000.db"));
}

/**
 * Drives the real Settings > "Turn on password protection…" wizard to completion for the CURRENTLY
 * ACTIVE, unprotected profile (Settings must already be the visible tab): fills the password step,
 * reads the shown recovery code and the two challenged group numbers straight off the page (never
 * hard-coded — the backend picks them at random), answers the challenge, and clicks Finish. Returns
 * the recovery code as shown. Doesn't wait for anything AFTER the Finish click resolves beyond the
 * click itself — exactly what both a normal completion (feature102/105) and a `killAtFailpoint`
 * `action` (feature103, which needs the operation merely STARTED, not finished) need.
 */
export async function enableProtectionThroughUI(browser, password) {
  const turnOnBtn = await browser.$("button=Turn on password protection…");
  await turnOnBtn.waitForExist({ timeout: 10000 });
  await dismissStatusMessages(browser); // the profile's opening message can cover the button
  await turnOnBtn.click();
  const passwordField = await browser.$("#protection-setup-password");
  await passwordField.waitForExist({ timeout: 5000 });
  await passwordField.setValue(password);
  await (await browser.$("#protection-setup-confirm")).setValue(password);
  await (await browser.$("button=Continue")).click();
  const recoveryEl = await browser.$(".modal-panel .path-box");
  await recoveryEl.waitForExist({ timeout: 10000 });
  const recoveryDisplay = (await recoveryEl.getText()).trim();
  await (await browser.$("button=I've saved it")).click();
  const label0 = await browser.$("label[for='protection-setup-answer-0']");
  await label0.waitForExist({ timeout: 5000 });
  const label1 = await browser.$("label[for='protection-setup-answer-1']");
  // getText() reads "" while the step is still fading in, so wait for both group numbers to be there.
  let texts = [];
  await browser.waitUntil(async () => (texts = [await label0.getText(), await label1.getText()]).every((t) => /\d/.test(t)), {
    timeout: 5000,
    timeoutMsg: "the recovery-code challenge should name two group numbers",
  });
  const group0 = Number(texts[0].match(/\d+/)[0]) - 1;
  const group1 = Number(texts[1].match(/\d+/)[0]) - 1;
  const groups = recoveryDisplay.split("-");
  await (await browser.$("#protection-setup-answer-0")).setValue(groups[group0]);
  await (await browser.$("#protection-setup-answer-1")).setValue(groups[group1]);
  await (await browser.$("button=Finish")).click();
  return recoveryDisplay;
}

function isProcessAlive(pid) {
  try {
    return execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`).toString().includes(`"${pid}"`);
  } catch {
    return false;
  }
}

/**
 * Sets things up to catch `protection_transition::debug_failpoint(failpointName)`, runs `action`
 * (the UI gesture that starts the operation expected to reach it — e.g. clicking "Finish" on the
 * setup dialog; `action` only needs to dispatch the gesture, not wait for whatever it triggers to
 * finish, since that's exactly what blocks at the failpoint), waits for the marker file the
 * failpoint writes into `testDbDir` the instant it's reached, then hard-kills that exact PID
 * (`taskkill /PID`, never by process name — this must never be able to touch the owner's own
 * installed copy) and waits for it to actually be gone. Requires `VAULTSPEND_FAILPOINT` to already
 * be set to `failpointName` in `process.env` before calling this (the harness passes `process.env`
 * through to the spawned app) — set it, call this, then unset it, same pattern every caller uses.
 */
export async function killAtFailpoint(testDbDir, failpointName, pid, action) {
  const markerPath = path.join(testDbDir, "failpoint-reached.txt");
  fs.rmSync(markerPath, { force: true });
  await action();
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(markerPath) || fs.readFileSync(markerPath, "utf8").trim() !== failpointName) {
    if (Date.now() > deadline) throw new Error(`Never saw the ${failpointName} failpoint marker within 5s`);
    await new Promise((r) => setTimeout(r, 20));
  }
  execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
  const goneBy = Date.now() + 5000;
  while (isProcessAlive(pid)) {
    if (Date.now() > goneBy) throw new Error(`Process ${pid} did not exit after taskkill`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
