// E2E test: Reports "Save as PDF" (QA UAT-124 / OBS-DL-001). The system print window's own "Save as PDF" failed
// with a network error when the person replaced a file that already existed. The app now saves the PDF itself:
// its Save window asks about replacing, then the save_report_pdf command writes the file. The Save window is an
// operating-system dialog this driver cannot press, so the command is called directly with the path the window
// would have returned: the part that failed is writing over an existing file.
//
// Run with: node e2e/feature364_report_pdf_save.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const day = dateInMonth(0, 1);
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
a = cur.lastrowid
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, 'Market Basket', '-42.17', 'Groceries', ?)", (a, "${day}", f"{a}|${day}|market basket|-42.17"))
`);
const outDir = makeTempDir("vaultspend-e2e-pdf-");
const target = path.join(outDir, "report.pdf");

const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  await (await browser.$('.nav-item[data-tab="reports"]')).click();
  const labels = async () => (await browser.$$(".page-actions button")).map((b) => b.getText());
  await browser.waitUntil(async () => (await Promise.all(await labels())).includes("Save as PDF"), { timeout: 15000, timeoutMsg: "Reports should offer Save as PDF" });
  assert.deepEqual(await Promise.all(await labels()), ["Export CSV", "Print", "Save as PDF"]);

  const save = (file) =>
    browser.executeAsync((p, done) => {
      window.__TAURI_INTERNALS__.invoke("save_report_pdf", { path: p }).then(() => done({ ok: true }), (e) => done({ error: String(e) }));
    }, file);
  const pages = (file) => (fs.readFileSync(file).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  // A file is already there (the person answered "Replace"): it is overwritten with the whole report.
  fs.writeFileSync(target, "old contents");
  assert.deepEqual(await save(target), { ok: true });
  assert.equal(fs.readFileSync(target).subarray(0, 5).toString(), "%PDF-", "the old file should have been replaced by a PDF");
  assert.ok(pages(target) >= 2, `the whole report should print across its sheets, not stop at the first (got ${pages(target)} page)`);

  // And again over the PDF just written.
  const firstSize = fs.statSync(target).size;
  assert.deepEqual(await save(target), { ok: true });
  assert.ok(fs.statSync(target).size > 1000 && Math.abs(fs.statSync(target).size - firstSize) < firstSize, "a second save should also succeed");

  // Refusals say what is wrong and write nothing.
  const notPdf = path.join(outDir, "report.txt");
  const refused = await save(notPdf);
  assert.match(refused.error ?? "", /\.pdf/);
  assert.equal(fs.existsSync(notPdf), false);
  const noFolder = path.join(outDir, "missing-folder", "report.pdf");
  assert.match((await save(noFolder)).error ?? "", /folder/);
  console.log("FEATURE 364 E2E TEST PASSED");
} finally {
  await app.close();
}
