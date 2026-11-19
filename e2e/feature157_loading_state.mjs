// E2E test: while a large profile's data is still loading, no screen claims there is no data
// (2026-10-02 QA, H3: Transactions said "0 transactions across 0 accounts", "No transactions yet"
// and "No accounts yet" for several seconds on a 50,000-row profile; 50,000 rows here).
//
// - From launch until the ledger shows its rows, the page never shows those empty-state messages.
// - The loading placeholder shows instead, and Import transactions can't be used (it is missing
//   or disabled) until the data is there. Since 1.3.0 it sits beside the page title, which the
//   placeholder replaces, while Hide amounts and Light / Dark / System stay usable in the sidebar.
//
// The watcher must be running before the load starts, or a fast runner can finish loading before it
// looks (VS-10). So the profile is registered, the app starts on the profile list, and the spec opens the
// profile itself from inside the page after the watcher is in place. A MutationObserver sees every change
// to the page, so the placeholder can't appear and vanish between two looks.
//
// Run with: node e2e/feature157_loading_state.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

// The 50,000-row size the original QA report described.
const ROWS = 50000;
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000')")
account_id = cur.lastrowid
cur.executemany(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    ((account_id, '2026-' + str(i % 9 + 1).zfill(2) + '-' + str(i % 28 + 1).zfill(2), 'Store ' + str(i) + ' ref', '-12.34', 'Groceries', 'f157-' + str(i)) for i in range(${ROWS}))
)
`);

// A registry file makes the app start on the profile list, before any data is loaded.
fs.writeFileSync(
  path.join(dbDir, "profiles.json"),
  JSON.stringify({ profiles: [{ id: "default", name: "Default", db_path: path.join(dbDir, "vaultspend.db"), icon_key: null }] }),
);

const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
try {
  const { browser } = app;
  // Start watching, then open the profile: the load cannot begin before the watcher does.
  const seen = await browser.executeAsync((done) => {
    const out = { emptyClaims: [], placeholder: false, importUsableWhileLoading: false, sidebarControlsWhileLoading: null };
    const started = performance.now();
    let navigated = false;
    let finished = false;
    let observer;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      done(result);
    };
    const look = () => {
      if (finished) return;
      // Transactions is the page under test; go there as soon as the app's navigation exists.
      const nav = [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === "Transactions");
      if (nav && !navigated) {
        navigated = true;
        nav.click();
      }
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
      if (document.querySelectorAll("table.ledger tbody tr").length > 0) return finish({ ...out, emptyClaims: [...new Set(out.emptyClaims)], ms: Math.round(performance.now() - started) });
      if (performance.now() - started > 60000) return finish({ ...out, timedOut: true });
    };
    observer = new MutationObserver(look);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    const frame = () => {
      look();
      if (!finished) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    document.querySelector("[data-profile-option]").click();
  });
  console.log(JSON.stringify(seen));
  assert.equal(seen.timedOut, undefined, "the ledger never showed its rows");
  assert.deepEqual(seen.emptyClaims, [], "no empty-state message while the data was loading");
  assert.equal(seen.placeholder, true, "the loading placeholder showed while the data loaded");
  // Only meaningful because the placeholder was seen (asserted just above): Import was looked for
  // on every change and frame while it showed.
  assert.ok(seen.placeholder && seen.importUsableWhileLoading === false, "Import transactions can't be used until the accounts are there");
  assert.equal(seen.sidebarControlsWhileLoading, true, "Hide amounts and Light / Dark / System are in the sidebar while the data loads");
  assert.equal(await (await browser.$("button*=Import transactions")).isEnabled(), true, "and enabled once they are");
  console.log("FEATURE 157 E2E TEST PASSED");
} finally {
  await app.close();
}
