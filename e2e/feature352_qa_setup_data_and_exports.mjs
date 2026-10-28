// UAT-201 setup data (README "Import & export ... bulk setup-data import/export for getting started quickly") and UAT-020/UAT-195 exports, driven with the native Save dialog answered by
// stubSaveDialog (harness.mjs) so the app itself writes the files and the spec reads them back:
//   "Download setup template" -> a CSV with the five sections; "Import setup data" -> review -> Import selected -> accounts, categories, budgets, goals created, bad rows counted;
//   "Export a copy" -> a database copy with the same rows. Descriptions start QQXZ so the checks read only this spec's rows.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchApp, stubFilePicker, stubSaveDialog, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
a = cur.lastrowid
for d, desc, amt in (("${dateInMonth(-1, 3)}", "QQXZ ONE", "-12.50"), ("${dateInMonth(-1, 4)}", "QQXZ TWO", "-40.00")):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)", (a, d, desc, amt, None, None, f"{a}|{d}|{desc.lower()}|{amt}"))
`);
const out = makeTempDir("vaultspend-e2e-exports-");
const templatePath = path.join(out, "template.csv");
const copyPath = path.join(out, "copy.db");
const setupPath = path.join(out, "setup.csv");
fs.writeFileSync(setupPath, [
  "Accounts", "Name,Type,Starting Balance,Institution,Mask",
  "QQXZ Setup Savings,savings,250.00,Harbor Bank,1234", "QQXZ Odd Account,piggybank,10.00,,", "QQXZ No Balance,checking,not-money,,",
  "", "Categories", "Name", "QQXZ Hobbies", "QQXZ Pets",
  "", "Budgets", "Category,Group,Monthly Amount,Period", "QQXZ Hobbies,flexible,75.00,", "QQXZ Pets,someday,20.00,",
  "", "Buckets", "Name,Target Amount,Target Date,Linked Account", `QQXZ Trip,1200.00,${dateInMonth(6, 15)},QQXZ Setup Savings`, "",
].join("\r\n"));

const app = await launchApp({ dbDir });
const { browser: b } = app;
async function invoke(command, args = {}) {
  const r = await b.executeAsync((command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then(ok => done({ ok }), e => done({ error: String(e) })), command, args);
  if (r.error) throw new Error(`${command} failed: ${r.error}`);
  return r.ok;
}
const statusTexts = () => b.execute(() => [...document.querySelectorAll(".status .status-text")].map(n => n.textContent.trim()));
async function waitStatus(fragment) {
  let seen = [];
  await waitUntilOrDiagnose(b, async () => (seen = await statusTexts()).some(t => t.includes(fragment)), { timeout: 20000, timeoutMsg: `a message containing "${fragment}" shows`, extra: () => seen });
  return seen.find(t => t.includes(fragment));
}
const dialogText = () => b.execute(() => document.querySelector("[role='dialog']")?.innerText ?? "");
try {
  await b.setWindowSize(1440, 1200);
  for (const x of await b.$$("nav button")) if ((await x.getText()).trim() === "Settings") { await x.click(); break; }
  await (await b.$("button*=Back up now")).waitForExist({ timeout: 10000 });

  // --- the template -----------------------------------------------------------------------------------------------------------------------------------------
  await stubSaveDialog(b, [templatePath]);
  await (await b.$("button*=Download setup template")).click();
  const saved = await waitStatus("Setup template saved to");
  assert.ok(saved.includes(templatePath) && saved.includes('use "Import setup data"'), saved);
  const template = fs.readFileSync(templatePath, "utf8").replace(/^﻿/, "");
  for (const title of ["Accounts", "Categories", "Budgets", "Buckets", "Holdings"]) assert.ok(new RegExp(`^${title}(,*)\\r?$`, "m").test(template), `the template has a ${title} section: ${template.slice(0, 200)}`);

  // --- importing a filled-in file: good rows in, bad rows counted and never created ----------------------------------------------------------------
  await stubFilePicker(b, [setupPath]);
  await (await b.$("button*=Import setup data")).click();
  await waitUntilOrDiagnose(b, async () => /QQXZ Setup Savings/.test(await dialogText()), { timeout: 15000, timeoutMsg: "the review lists the good rows", extra: dialogText });
  const review = await dialogText();
  for (const name of ["QQXZ Setup Savings", "QQXZ Hobbies", "QQXZ Pets", "QQXZ Trip"]) assert.ok(review.includes(name), `${name} is in the review: ${review}`);
  assert.ok(!review.includes("QQXZ Odd Account") && !review.includes("QQXZ No Balance"), "rows with a bad type or balance are not offered");
  assert.ok(review.includes("3 rows had problems and will be skipped."), "the review counts the rows it skipped: " + review);
  await (await b.$("//div[@role='dialog']//button[normalize-space()='Import selected']")).click();
  await waitUntilOrDiagnose(b, async () => (await invoke("list_accounts")).some(a => a.name === "QQXZ Setup Savings"), { timeout: 15000, timeoutMsg: "Import selected creates the account" });
  const accounts = await invoke("list_accounts");
  const savings = accounts.find(a => a.name === "QQXZ Setup Savings");
  assert.equal(savings.account_type, "savings"); assert.equal(Number(savings.starting_balance), 250);
  assert.ok(!accounts.some(a => a.name === "QQXZ Odd Account" || a.name === "QQXZ No Balance"), "bad rows created nothing");
  const goals = await invoke("list_buckets");
  assert.ok(goals.some(g => g.name === "QQXZ Trip" && Number(g.target_amount) === 1200), "the goal was created: " + JSON.stringify(goals.map(g => g.name)));

  // --- an exported copy has the same data ---------------------------------------------------------------------------------------------------------------------------
  await stubSaveDialog(b, [copyPath]);
  await (await b.$("button*=Export a copy")).click();
  const exported = await waitStatus("Exported a copy to");
  assert.ok(exported.includes(copyPath), exported);
  const rows = JSON.parse(execFileSync("python", ["-c", `import sqlite3,json;c=sqlite3.connect(r"${copyPath}");print(json.dumps([c.execute("select count(*) from transactions where description like 'QQXZ%'").fetchone()[0], c.execute("select count(*) from accounts where name like 'QQXZ%'").fetchone()[0]]))`]).toString());
  assert.deepEqual(rows, [2, 1], "the copy holds this profile's transactions and the imported account: " + JSON.stringify(rows));
  console.log("FEATURE 352 PASSED: template download, setup import with bad rows, and an exported copy through the real Save dialog.");
} finally {
  await app.close();
  fs.rmSync(out, { recursive: true, force: true });
}
