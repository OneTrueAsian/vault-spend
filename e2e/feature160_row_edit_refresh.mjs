// E2E test: editing a row re-reads only that row, not the whole ledger (2026-10-02 QA, M1: every edit
// re-read every transaction, ~2 s at 50,000 rows).
//
// - Fixing a description in the Transactions table shows the new text in that row, and the other
//   rows are still there.
// - The edit is followed by one targeted coherent snapshot, and no full ledger read.
//
// Run with: node e2e/feature160_row_edit_refresh.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedDemoDatabase } from "./lib/demo-seed.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";

const log = path.join(os.tmpdir(), `vaultspend-feature160-${process.pid}.jsonl`);
fs.rmSync(log, { force: true });
process.env.VAULTSPEND_PERF_LOG = log;

const dbDir = freshTestDbDir();
await seedDemoDatabase(dbDir);
const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  await browser.setWindowSize(1280, 800);
  await browser.execute(() => [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === "Transactions").click());
  await browser.waitUntil(() => browser.execute(() => document.querySelectorAll("table.ledger tbody tr").length > 10), { timeout: 15000 });
  const rowsBefore = await browser.execute(() => document.querySelectorAll("table.ledger tbody tr").length);

  const linesBefore = fs.readFileSync(log, "utf8").trim().split("\n").length;
  // Open the row's description editor, type, and press Enter, from inside the page (a WebDriver
  // click can land as the editor re-renders and blur it shut before the typing arrives).
  const oldText = await browser.executeAsync((done) => {
    const firstSpan = () => document.querySelector("table.ledger tbody span.amount-editable[title='Click to fix the description']");
    const text = firstSpan().textContent.trim();
    const started = performance.now();
    let lastClick = 0;
    const waitForInput = () => {
      const input = document.querySelector("table.ledger .row-edit-input");
      if (!input) {
        // a re-render can replace the description just as it is clicked; click again until the editor opens
        if (performance.now() - lastClick > 300) {
          firstSpan()?.click();
          lastClick = performance.now();
        }
        if (performance.now() - started > 15000) return done(null);
        return requestAnimationFrame(waitForInput);
      }
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Corner Bakery (fixed)");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      requestAnimationFrame(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        done(text);
      });
    };
    waitForInput();
  });
  assert.ok(oldText !== null, "the description editor never opened");
  await browser.waitUntil(
    () => browser.execute(() => [...document.querySelectorAll("table.ledger tbody span.amount-editable")].some((s) => s.textContent.trim() === "Corner Bakery (fixed)")),
    { timeout: 10000, timeoutMsg: `the row never showed its new description (was "${oldText}")` },
  );
  await browser.pause(500);
  assert.equal(await browser.execute(() => document.querySelectorAll("table.ledger tbody tr").length), rowsBefore, "the other rows are all still there");

  const entries = fs.readFileSync(log, "utf8").trim().split("\n").slice(linesBefore).map((l) => JSON.parse(l));
  const after = entries.map(l => l.cmd);
  assert.ok(after.includes("update_transaction_description"), `the edit was saved: ${after.join(", ")}`);
  assert.ok(after.includes("get_transaction_snapshot"), `the coherent row model was re-read: ${after.join(", ")}`);
  const requests = entries.filter(l => l.cmd === "get_transaction_snapshot");
  assert.equal(requests.length, 1, "one snapshot follows the row edit");
  assert.equal(requests[0].requested_rows, 1, "the snapshot requests exactly the edited row");
  assert.ok(!after.includes("list_transactions"), `the whole ledger was not re-read: ${after.join(", ")}`);

  console.log("FEATURE 160 E2E TEST PASSED");
} finally {
  await app.close();
  fs.rmSync(log, { force: true });
}
