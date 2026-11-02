// UAT-049: a statement the app must refuse is refused with a plain message, no review opens, nothing is written, and a good statement still works afterwards.
// docs/STATEMENT-RECONCILE.md "The reader": limits 20 MiB and 200 pages; text that is not a PDF can't be opened. (The picture-only PDF refusal is feature301.)
// Messages are the ones in core/src/statement/pdf_text.rs:24-32.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";
import { buildPdf, checkingStatement } from "./lib/statementPdf.mjs";
import { finishReview, openAccountPage, setStatementDates, uploadStatement, waitForBalanced, waitForNotice, waitForReview, writeStatement } from "./lib/statementUi.mjs";

const start = dateInMonth(-2, 1), end = dateInMonth(-2, 28);
const day = dateInMonth(-2, 5);
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '1000.00')")
a = cur.lastrowid
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)", (a, "${day}", "Coffee Shop", "-50.00", None, None, f"{a}|${day}|coffee shop|-50.00"))
`);
const dir = makeTempDir("vaultspend-refusals-");
const notPdf = path.join(dir, "not-a-statement.pdf");
fs.writeFileSync(notPdf, "This is plain text that was renamed to .pdf\n");
const huge = path.join(dir, "too-big.pdf");
const bytes = Buffer.alloc(20 * 1024 * 1024 + 1, 0x20); // one byte past the 20 MiB limit
bytes.write("%PDF-1.4\n");
fs.writeFileSync(huge, bytes);
const manyPages = writeStatement("too-many-pages.pdf", buildPdf(Array.from({ length: 201 }, (_, i) => [`Statement page ${i + 1}`])));
const good = checkingStatement({ start, end, opening: 1000, rows: [{ date: day, description: "Coffee Shop", amount: -50 }] });
const goodFile = writeStatement("good.pdf", good.pdf);
const app = await launchApp({ dbDir });
const { browser } = app;
const alerts = () => browser.execute(() => [...document.querySelectorAll('.status .status-text, [role="alert"], .statement-error')].map(n => n.textContent.trim()).filter(Boolean));
const reviewOpen = () => browser.$("[data-statement-review]").isExisting();
const lastReconciled = () => browser.execute(() => document.querySelector("[data-last-reconciled]")?.textContent.replace(/\s+/g, " ").trim() ?? null);
try {
  await browser.setWindowSize(1440, 1400);
  await openAccountPage(browser, "Everyday Checking");
  await setStatementDates(browser, start, end);
  const baseline = await lastReconciled();
  const cases = [
    ["text renamed to .pdf", notPdf, "This PDF can't be opened."],
    ["one byte over 20 MiB", huge, "This file is too large to be a monthly statement."],
    ["201 pages", manyPages, "This file is too large to be a monthly statement."],
  ];
  for (const [name, file, message] of cases) {
    await uploadStatement(browser, file);
    let seen = [];
    await waitUntilOrDiagnose(browser, async () => { seen = await alerts(); return seen.some(t => t.includes(message)); }, { timeout: 30000, timeoutMsg: `${name}: the plain message "${message}" shows`, extra: () => seen });
    assert.equal(await reviewOpen(), false, `${name}: no review opens`);
    const shown = seen.find(t => t.includes(message));
    assert.ok(!/stack|panic|pdf_oxide|object|0x[0-9a-f]+|\.rs:/i.test(shown), `${name}: no technical detail in "${shown}"`);
    assert.equal(await lastReconciled(), baseline, `${name}: nothing was recorded`);
  }
  // A refusal leaves the account usable: a good statement now reads, balances and finishes.
  await uploadStatement(browser, goodFile);
  await waitForReview(browser);
  await waitForBalanced(browser);
  await finishReview(browser);
  await waitForNotice(browser, "Reconciled Everyday Checking");
  console.log("FEATURE 342 PASSED: a non-PDF, a file over 20 MiB and a 201-page PDF are refused with plain messages and record nothing; a good statement then finishes.");
} finally { await app.close(); }
