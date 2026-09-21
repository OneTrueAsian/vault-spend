// E2E test for 1.2.8 — an import no longer adds categories on its own.
//
// A bank CSV's own "Category" column ("Merchandise", "Gas/Automotive", ...) used to be
// adopted wholesale: every name in the file became a new category in the person's list. Now:
//   - a file category that matches one of theirs (any casing) uses their spelling;
//   - one they don't have is NOT added — the preview reports it, and the review screen
//     sends back a choice per name: use one of their own ("map_to"), add it ("create"),
//     or don't use it ("skip", also what an unreviewed import does);
//   - the auto-categorizer only files a row under a category the person already has, even
//     when a rule points at one they don't.
//
// The review screen itself sits behind a native file dialog a WebDriver session can't drive, so
// this calls the same commands the screen does (preview_import / commit_import) against a real
// CSV in the real app, and checks the database through the app's own list commands.
//
// Run with: node e2e/feature97_import_categories.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
# A rule pointing at a category the person does not have (e.g. left behind by an older version).
# The app must not invent that category to satisfy it.
cur.execute("INSERT INTO rules (pattern, category) VALUES ('zqx plain', 'Zebra Care')")
`);

const csvDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-import-cats-"));
const csvPath = path.join(csvDir, "bank.csv");
fs.writeFileSync(
  csvPath,
  [
    "date,description,amount,category",
    "2026-09-01,ZQX HARDWARE 1,-25.00,Merchandise",
    "2026-09-02,ZQX HARDWARE 2,-30.00,merchandise",
    "2026-09-03,ZQX FUEL 1,-40.00,Gas/Automotive",
    "2026-09-04,ZQX BISTRO 1,-18.00,Dining",
    "2026-09-05,ZQX MART 1,-60.00,GROCERIES",
    "2026-09-06,ZQX PLAIN 1,-5.00,",
    "",
  ].join("\n"),
);

const app = await launchApp({ dbDir });
const { browser } = app;

async function call(command, args = {}) {
  const result = await browser.executeAsync(
    (cmd, a, done) => {
      window.__TAURI_INTERNALS__.invoke(cmd, a).then(
        (value) => done({ ok: value }),
        (e) => done({ error: String(e) }),
      );
    },
    command,
    args,
  );
  return result;
}
async function ok(command, args) {
  const r = await call(command, args);
  if (r.error !== undefined) throw new Error(`${command} failed: ${r.error}`);
  return r.ok;
}
const categoryOf = (txns, description) => txns.find((t) => t.description === description)?.category ?? null;
const allIndices = [0, 1, 2, 3, 4, 5];

try {
  await browser.setWindowSize(1440, 1000);
  await browser.$("nav").waitForExist({ timeout: 15000 });

  const before = await ok("list_categories");
  for (const name of ["Merchandise", "Gas/Automotive", "Dining", "Zebra Care"]) {
    if (before.some((c) => c.toLowerCase() === name.toLowerCase())) throw new Error(`the fixture should not start with "${name}"`);
  }
  const accounts = await ok("list_accounts");
  const accountId = accounts.find((a) => a.name === "Checking").id;

  // 1. The preview names what the file uses that the person doesn't have, and adds nothing.
  const preview = await ok("preview_import", { path: csvPath, invertAmounts: false, accountId });
  const unmatched = preview.unmatched_categories.map((u) => `${u.name}:${u.count}`);
  console.log("unmatched:", unmatched.join(", "));
  if (unmatched.join("|") !== "Merchandise:2|Dining:1|Gas/Automotive:1") {
    throw new Error(`expected Merchandise (2), Dining, Gas/Automotive as the unfamiliar names, biggest first — got ${unmatched.join(", ")}`);
  }
  if (preview.rows[0].category !== "Merchandise") throw new Error("each row should carry the file's own category");
  if (JSON.stringify(await ok("list_categories")) !== JSON.stringify(before)) throw new Error("previewing must not add a category");

  // 2. Importing with no choices (an unreviewed import) adds nothing.
  await ok("commit_import", { path: csvPath, invertAmounts: false, defaultAccountId: accountId, includedIndices: allIndices, accountOverrides: {} });
  let categories = await ok("list_categories");
  if (JSON.stringify(categories) !== JSON.stringify(before)) {
    throw new Error(`an import that wasn't reviewed added categories: ${categories.filter((c) => !before.includes(c)).join(", ")}`);
  }
  let txns = await ok("list_transactions");
  if (categoryOf(txns, "ZQX MART 1") !== "Groceries") throw new Error("a file category matching one of theirs should use their spelling (Groceries)");
  for (const d of ["ZQX HARDWARE 1", "ZQX HARDWARE 2", "ZQX FUEL 1", "ZQX BISTRO 1"]) {
    if (categoryOf(txns, d) !== null) throw new Error(`${d} should have come in without a category, got ${categoryOf(txns, d)}`);
  }
  if (categoryOf(txns, "ZQX PLAIN 1") !== null) {
    throw new Error("a rule pointing at a category the person doesn't have must not create it or file the row under it");
  }
  if ((await ok("list_categories")).includes("Zebra Care")) throw new Error("the auto-categorizer invented a category");

  // 3. A mapping to a category that doesn't exist is refused, and nothing is imported.
  const countBefore = txns.length;
  const refused = await call("commit_import", {
    path: csvPath,
    invertAmounts: false,
    defaultAccountId: accountId,
    includedIndices: allIndices,
    accountOverrides: {},
    categoryChoices: { Dining: { action: "map_to", category: "Nope" } },
  });
  if (refused.error === undefined) throw new Error("mapping to a category that doesn't exist should be refused");
  if ((await ok("list_transactions")).length !== countBefore) throw new Error("a refused import must not insert anything");

  // 4. Choices are honoured: map one, create one, skip one.
  await ok("commit_import", {
    path: csvPath,
    invertAmounts: false,
    defaultAccountId: accountId,
    includedIndices: allIndices,
    accountOverrides: {},
    categoryChoices: {
      Merchandise: { action: "create" },
      Dining: { action: "map_to", category: "Dining Out" },
      "Gas/Automotive": { action: "skip" },
    },
  });
  categories = await ok("list_categories");
  const added = categories.filter((c) => !before.includes(c));
  if (added.join("|") !== "Merchandise") throw new Error(`only the category they chose to add should be new, got: ${added.join(", ") || "(none)"}`);
  txns = await ok("list_transactions");
  const byDescription = (d) => txns.filter((t) => t.description === d).map((t) => t.category);
  // (The first, unreviewed import left an uncategorized copy of each row; the reviewed one adds another.)
  if (!byDescription("ZQX BISTRO 1").includes("Dining Out")) {
    throw new Error(`the mapped rows should be filed under Dining Out, got ${JSON.stringify(byDescription("ZQX BISTRO 1"))}`);
  }
  if (!byDescription("ZQX HARDWARE 1").includes("Merchandise") || !byDescription("ZQX HARDWARE 2").includes("Merchandise")) {
    throw new Error("both casings of the created category should land on the one new category");
  }
  if (byDescription("ZQX FUEL 1").some((c) => c === "Gas/Automotive")) throw new Error("a skipped category must not be used");
  if (categories.filter((c) => c.toLowerCase() === "merchandise").length !== 1) throw new Error("Merchandise should exist exactly once");

  // 5. The Transactions tab still shows the imported rows.
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === "Transactions") {
      await b.click();
      break;
    }
  }
  await browser.$("table.ledger").waitForExist({ timeout: 10000 });

  console.log("FEATURE 97 E2E TEST PASSED");
} finally {
  await app.close();
}
