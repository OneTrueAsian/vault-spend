// E2E test: the Transactions table's cells read cleanly (2026-10-02 QA, M3).
//
// - Every date fits its cell, in Default and in Futuristic (whose wider digits used to run under the
//   description and its icon).
// - "Apply to a debt" appears only on money going out, never on income or transfers in.
// - The "Sorted by" column says how a category was set in words, not the stored code ("rule").
//
// Run with: node e2e/feature159_ledger_cells.mjs

import assert from "node:assert/strict";
import { dismissStatusMessages, launchApp } from "./harness.mjs";
import { seedDemoDatabase } from "./lib/demo-seed.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";

const dbDir = freshTestDbDir();
await seedDemoDatabase(dbDir);
const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  await browser.setWindowSize(1280, 800);
  for (const style of ["transparent", "futuristic"]) {
    await browser.execute((s) => {
      localStorage.setItem("meadow-theme-style", s);
      location.reload();
    }, style);
    await (await browser.$(".nav-item")).waitForExist({ timeout: 20000 });
    await dismissStatusMessages(browser);
    await browser.execute(() => [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === "Transactions").click());
    await browser.waitUntil(() => browser.execute(() => document.querySelectorAll("table.ledger tbody tr td.date-col").length > 5), { timeout: 15000 });
    await browser.pause(300);

    const cells = await browser.execute(() => {
      const rows = [...document.querySelectorAll("table.ledger tbody tr")].filter((r) => r.querySelector("td.date-col"));
      return rows.map((r) => {
        const date = r.querySelector("td.date-col");
        const span = date.querySelector(".date-cell") ?? date;
        const amountText = r.querySelector(".amount-col, td:nth-child(4)")?.textContent ?? "";
        return {
          date: span.textContent.trim(),
          spills: span.getBoundingClientRect().right > date.getBoundingClientRect().right + 0.5,
          incoming: !/[-−]\$/.test(amountText) && /\$/.test(amountText),
          hasDebtButton: Boolean(r.querySelector(".debt-apply-trigger")),
          source: r.querySelector("td.source-col")?.textContent.trim() ?? "",
        };
      });
    });
    assert.ok(cells.length > 5, `${style}: expected ledger rows`);
    // No column header runs into the next one ("Sorted by" once ran into "Debt").
    const crowdedHeaders = await browser.execute(() =>
      [...document.querySelectorAll("table.ledger thead th")]
        .filter((th) => th.scrollWidth > th.clientWidth + 1)
        .map((th) => th.textContent.trim()),
    );
    assert.deepEqual(crowdedHeaders, [], `${style}: column headers overflow their column`);
    const spilling = cells.filter((c) => c.spills).map((c) => c.date);
    assert.deepEqual(spilling, [], `${style}: dates spill out of their cell`);
    assert.ok(cells.some((c) => c.incoming), `${style}: the demo data has money coming in to check against`);
    const debtOnIncoming = cells.filter((c) => c.incoming && c.hasDebtButton);
    assert.deepEqual(debtOnIncoming, [], `${style}: "Apply to a debt" shows on money coming in`);
    assert.ok(cells.some((c) => c.hasDebtButton), `${style}: still offered on money going out`);
    const codes = cells.map((c) => c.source.replace(/\d+%$/, "").trim()).filter((s) => ["rule", "user", "classifier"].includes(s));
    assert.deepEqual(codes, [], `${style}: the Sorted by column shows stored codes`);
    assert.ok(cells.some((c) => c.source.startsWith("Your rule")), `${style}: rule-sorted rows say "Your rule"`);
  }
  console.log("FEATURE 159 E2E TEST PASSED");
} finally {
  await app.close();
}
