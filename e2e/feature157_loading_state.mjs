// E2E test: while a large profile's data is still loading, no screen claims there is no data
// (2026-10-02 QA, H3: Transactions said "0 transactions across 0 accounts", "No transactions yet"
// and "No accounts yet" for several seconds on a 50,000-row profile; 20,000 rows here).
//
// - From launch until the ledger shows its rows, the page never shows those empty-state messages.
// - The loading placeholder shows instead, and Import transactions… can't be used (it is missing
//   or disabled) until the data is there. Since 1.3.0 it sits beside the page title, which the
//   placeholder replaces, while Hide amounts and Light / Dark / System stay usable in the sidebar.
//
// Run with: node e2e/feature157_loading_state.mjs

import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

// Large enough that the first load takes visibly long, small enough not to slow the other specs
// running beside it in the full suite.
const ROWS = 20000;
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000')")
account_id = cur.lastrowid
cur.executemany(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    ((account_id, '2026-' + str(i % 9 + 1).zfill(2) + '-' + str(i % 28 + 1).zfill(2), 'Store ' + str(i) + ' ref', '-12.34', 'Groceries', 'f157-' + str(i)) for i in range(${ROWS}))
)
`);

const app = await launchApp({ dbDir, waitForData: false }); // this spec watches the loading itself
try {
  const { browser } = app;
  // Watch the page from inside it, every animation frame, until the ledger has rows.
  const seen = await browser.executeAsync((done) => {
    const nav = [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === "Transactions");
    nav.click();
    const out = { emptyClaims: [], placeholder: false, importUsableWhileLoading: false, sidebarControlsWhileLoading: null };
    const started = performance.now();
    const look = () => {
      const page = document.querySelector(".page")?.innerText ?? "";
      for (const claim of ["No transactions yet", "0 transactions across 0 accounts", "No accounts yet"]) {
        if (page.includes(claim)) out.emptyClaims.push(claim);
      }
      if (document.querySelector("[data-data-loading]")) {
        out.placeholder = true;
        const importButton = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Import transactions"));
        if (importButton && !importButton.disabled) out.importUsableWhileLoading = true;
        if (out.sidebarControlsWhileLoading === null) {
          out.sidebarControlsWhileLoading = !!document.querySelector(".sidebar-foot .sidebar-controls [data-privacy-toggle]") &&
            !!document.querySelector(".sidebar-foot .sidebar-controls .theme-toggle");
        }
      }
      if (document.querySelectorAll("table.ledger tbody tr").length > 0) return done({ ...out, emptyClaims: [...new Set(out.emptyClaims)], ms: Math.round(performance.now() - started) });
      if (performance.now() - started > 60000) return done({ ...out, timedOut: true });
      requestAnimationFrame(look);
    };
    look();
  });
  console.log(JSON.stringify(seen));
  assert.equal(seen.timedOut, undefined, "the ledger never showed its rows");
  assert.deepEqual(seen.emptyClaims, [], "no empty-state message while the data was loading");
  assert.equal(seen.placeholder, true, "the loading placeholder showed while the data loaded");
  // Only meaningful because the placeholder was seen (asserted just above): Import was looked for
  // on every frame it showed.
  assert.ok(seen.placeholder && seen.importUsableWhileLoading === false, "Import transactions… can't be used until the accounts are there");
  assert.equal(seen.sidebarControlsWhileLoading, true, "Hide amounts and Light / Dark / System are in the sidebar while the data loads");
  assert.equal(await (await browser.$("button*=Import transactions")).isEnabled(), true, "and enabled once they are");
  console.log("FEATURE 157 E2E TEST PASSED");
} finally {
  await app.close();
}
