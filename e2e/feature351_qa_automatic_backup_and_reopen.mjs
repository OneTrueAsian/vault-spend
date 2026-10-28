// UAT-195 the automatic daily backup (src-tauri/src/backups.rs create_backup_if_due: at launch, a backup is made only when none exists or the newest is more than 24 hours old,
// and the folder is trimmed to the newest 15) and UAT-199 a restore survives closing and reopening the app (feature17 restores inside one session and, by design, does not relaunch).
// Backups are plain copies named vaultspend-YYYYMMDD-HHMMSS.db; old ones are planted by copying the profile's own database under an older name.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";

const pad = n => String(n).padStart(2, "0");
const stamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const hoursAgo = h => new Date(Date.now() - h * 3600 * 1000);
const seed = () => seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
a = cur.lastrowid
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)", (a, "${dateInMonth(-2, 1)}", "Original", "-10.00", None, None, f"{a}|${dateInMonth(-2, 1)}|original|-10.00"))
`);
const backupsOf = dir => fs.existsSync(path.join(dir, "backups")) ? fs.readdirSync(path.join(dir, "backups")).filter(f => /^vaultspend-\d{8}-\d{6}.*\.db$/.test(f)).sort() : [];
const plant = (dir, when) => {
  fs.mkdirSync(path.join(dir, "backups"), { recursive: true });
  const name = `vaultspend-${stamp(when)}.db`;
  fs.copyFileSync(path.join(dir, "vaultspend.db"), path.join(dir, "backups", name));
  return name;
};
/** Launches the app on `dir`, waits for it to settle, closes it, and returns the backups now on disk. */
async function launchAndClose(dir) {
  const app = await launchApp({ dbDir: dir });
  try {
    await (await app.browser.$(".nav-item[data-tab=dashboard]")).waitForExist({ timeout: 15000 });
    await app.browser.pause(1500); // the launch-time check runs in the background
  } finally { await app.close(); }
  return backupsOf(dir);
}

// --- no backups at all: the first launch makes one; the next launch, minutes later, does not -------------------------------------------------------------------------
const fresh = await seed();
assert.deepEqual(backupsOf(fresh), []);
const afterFirst = await launchAndClose(fresh);
assert.equal(afterFirst.length, 1, "a profile with no backup gets one at launch: " + JSON.stringify(afterFirst));
const afterSecond = await launchAndClose(fresh);
assert.deepEqual(afterSecond, afterFirst, "a second launch the same day adds nothing");

// --- the 24-hour edge --------------------------------------------------------------------------------------------------------------------------------------------------
const recent = await seed();
const recentName = plant(recent, hoursAgo(23));
assert.deepEqual(await launchAndClose(recent), [recentName], "newest backup 23 hours old: not due, nothing added");
const stale = await seed();
const staleName = plant(stale, hoursAgo(25));
const afterStale = await launchAndClose(stale);
assert.equal(afterStale.length, 2, "newest backup 25 hours old: due, one added: " + JSON.stringify(afterStale));
assert.ok(afterStale.includes(staleName), "the old one is kept");

// --- retention: only the newest 15 are kept ----------------------------------------------------------------------------------------------------------------------
const many = await seed();
const planted = Array.from({ length: 15 }, (_, i) => plant(many, hoursAgo(48 + (15 - i) * 24)));
const afterMany = await launchAndClose(many);
assert.equal(afterMany.length, 15, "15 old backups plus the new one are trimmed back to 15: " + afterMany.length);
assert.ok(!afterMany.includes(planted[0]), "the oldest one was the one removed");
assert.ok(afterMany.includes(planted[14]), "the newest old one stays");

// --- UAT-199: restore, close, reopen ---------------------------------------------------------------------------------------------------------------------------------
const dir = await seed();
const dbPath = path.join(dir, "vaultspend.db");
const sql = code => JSON.parse(execFileSync("python", ["-c", `import sqlite3,json\nc=sqlite3.connect(r"${dbPath}",timeout=20)\n${code}`]).toString());
let app = await launchApp({ dbDir: dir });
let b = app.browser;
const names = () => b.executeAsync(done => window.__TAURI_INTERNALS__.invoke("list_transactions").then(t => done(t.map(x => x.description).sort()), () => done(null)));
try {
  for (const x of await b.$$("nav button")) if ((await x.getText()).trim() === "Settings") { await x.click(); break; }
  await (await b.$("button*=Back up now")).click();
  await waitUntilOrDiagnose(b, async () => (await b.execute(() => document.body.innerText)).includes("Backup created."), { timeout: 20000, timeoutMsg: "the manual backup is confirmed" });
  assert.deepEqual(await names(), ["Original"]);
} finally { await app.close(); }
// Something done later, outside the app's backup: a new transaction.
sql(`c.execute("insert into transactions (account_id, date, description, amount, fingerprint) values ((select id from accounts limit 1), '${dateInMonth(-1, 5)}', 'Later', '-5.00', 'later')");c.commit();print('[]')`);
app = await launchApp({ dbDir: dir }); b = app.browser;
try {
  assert.deepEqual(await names(), ["Later", "Original"], "the later transaction is in the live data before the restore");
  for (const x of await b.$$("nav button")) if ((await x.getText()).trim() === "Settings") { await x.click(); break; }
  // Restore the manual backup (the oldest listed: the launch made one earlier in the same second may exist, so take the row for the backup made before 'Later').
  const restoreButtons = await b.$$("//button[normalize-space()='Restore']");
  assert.ok(restoreButtons.length >= 1, "the backups are listed with Restore");
  await restoreButtons[restoreButtons.length - 1].click();
  await (await b.$("//button[normalize-space()='Restore'][preceding-sibling::button[normalize-space()='Cancel']]")).click().catch(async () => { throw new Error("the inline confirmation did not appear: " + (await b.execute(() => document.body.innerText)).slice(0, 400)); });
  await waitUntilOrDiagnose(b, async () => JSON.stringify(await names()) === JSON.stringify(["Original"]), { timeout: 20000, timeoutMsg: "the restore brings back the data as backed up", extra: () => names() });
} finally { await app.close(); }
// Reopen: the restored data is what the profile now holds.
app = await launchApp({ dbDir: dir }); b = app.browser;
try {
  assert.deepEqual(await names(), ["Original"], "after closing and reopening, the restored data is still what the profile holds");
  console.log("FEATURE 351 PASSED: the launch-time backup is made when none exists or the newest is over 24 hours old, trimmed to 15, and a restore survives a reopen.");
} finally { await app.close(); }
