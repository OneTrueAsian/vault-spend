// E2E test: an import only uses the person's own categories, every row is settled before
// anything is saved, and a file category they map is remembered (1.2.8, extended 2026-10-04).
//
// A bank CSV's own "Category" column ("Merchandise", "Gas/Automotive", ...) used to be
// adopted wholesale: every name in the file became a new category in the person's list. Now:
//   - a file category that matches one of theirs (any casing) uses their spelling;
//   - one they don't have is NOT added — the preview reports it, and the review screen
//     sends back a choice per name: use one of their own ("map_to"), add it ("create"),
//     or let the app guess ("skip");
//   - a row the app can't place with at least 50% confidence needs the person's own choice
//     (a category, or null for "Leave uncategorized"), or the whole import is refused;
//   - a guess only ever files a row under a category the person already has, even when a
//     rule points at one they don't;
//   - a "map_to" choice is remembered and offered on the next import.
//
// The review screen itself is covered by feature162; this calls the same commands it does
// (preview_import / commit_import) against a real CSV in the real app, and checks the database
// through the app's own list commands.
//
// Run with: node e2e/run-all.mjs --spec=97

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
# A rule pointing at a category the person does not have (e.g. left behind by an older version).
# The app must not invent that category to satisfy it.
cur.execute("INSERT INTO rules (pattern, category) VALUES ('zqx plain', 'Zebra Care')")
`);

const csvDir = makeTempDir("vaultspend-import-cats-");
const csvPath = path.join(csvDir, "bank.csv");
const rows = [
  "date,description,amount,category",
  `${dateInMonth(-1, 1)},ZQX HARDWARE 1,-25.00,Merchandise`,
  `${dateInMonth(-1, 2)},ZQX HARDWARE 2,-30.00,merchandise`,
  `${dateInMonth(-1, 3)},ZQX FUEL 1,-40.00,Gas/Automotive`,
  `${dateInMonth(-1, 4)},ZQX BISTRO 1,-18.00,Dining`,
  `${dateInMonth(-1, 5)},ZQX MART 1,-60.00,GROCERIES`,
  `${dateInMonth(-1, 6)},ZQX PLAIN 1,-5.00,`,
  "",
];
fs.writeFileSync(csvPath, rows.join("\n"));

const app = await launchApp({ dbDir });
const { browser } = app;

async function call(command, args = {}) {
  return browser.executeAsync(
    (cmd, a, done) => {
      window.__TAURI_INTERNALS__.invoke(cmd, a).then(
        (value) => done({ ok: value }),
        (e) => done({ error: String(e) }),
      );
    },
    command,
    args,
  );
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
  const base = { path: csvPath, invertAmounts: false, defaultAccountId: accountId, includedIndices: allIndices, accountOverrides: {} };

  // 1. The preview names what the file uses that the person doesn't have, says what it can place
  //    itself, and adds nothing.
  const preview = await ok("preview_import", { path: csvPath, invertAmounts: false, accountId });
  const unmatched = preview.unmatched_categories.map((u) => `${u.name}:${u.count}`);
  console.log("unmatched:", unmatched.join(", "));
  if (unmatched.join("|") !== "Merchandise:2|Dining:1|Gas/Automotive:1") {
    throw new Error(`expected Merchandise (2), Dining, Gas/Automotive as the unfamiliar names, biggest first — got ${unmatched.join(", ")}`);
  }
  if (preview.unmatched_categories.some((u) => u.remembered_category)) throw new Error("nothing has been remembered yet");
  if (preview.rows[0].category !== "Merchandise") throw new Error("each row should carry the file's own category");
  if (preview.rows[4].matched_category !== "Groceries") throw new Error("GROCERIES should match the person's Groceries");
  if (preview.rows[5].suggestion !== null) {
    throw new Error(`a rule naming a category the person doesn't have must not be suggested, got ${JSON.stringify(preview.rows[5].suggestion)}`);
  }
  if (preview.choice_below !== 0.5) throw new Error(`the cutoff should be 0.5, got ${preview.choice_below}`);
  if (!/^[0-9a-f]{64}$/.test(preview.review_token)) throw new Error("the preview should carry a review token");
  if (JSON.stringify(await ok("list_categories")) !== JSON.stringify(before)) throw new Error("previewing must not add a category");

  // 2. Importing while rows still need a choice is refused, and nothing is imported.
  const unsettled = await call("commit_import", { ...base, reviewToken: preview.review_token, rowChoices: {} });
  if (!/Choose a category for 5 more rows/.test(unsettled.error ?? "")) {
    throw new Error(`an import with rows still needing a choice should be refused, got ${JSON.stringify(unsettled)}`);
  }
  if ((await ok("list_transactions")).length !== 0) throw new Error("a refused import must not insert anything");

  // 3. A mapping to a category that doesn't exist is refused, and so is a file that changed.
  const settled = { 0: null, 1: null, 2: null, 3: null, 5: null };
  const badMap = await call("commit_import", {
    ...base,
    reviewToken: preview.review_token,
    categoryChoices: { Dining: { action: "map_to", category: "Nope" } },
    rowChoices: { 0: null, 1: null, 2: null, 5: null },
  });
  if (badMap.error === undefined) throw new Error("mapping to a category that doesn't exist should be refused");
  fs.writeFileSync(csvPath, rows.join("\n").replace("ZQX MART 1", "ZQX MART ONE"));
  const changed = await call("commit_import", { ...base, reviewToken: preview.review_token, rowChoices: settled });
  if (changed.error !== "This file changed. Review it again before importing.") {
    throw new Error(`a file changed after review should be refused, got ${JSON.stringify(changed)}`);
  }
  fs.writeFileSync(csvPath, rows.join("\n"));
  if ((await ok("list_transactions")).length !== 0) throw new Error("a refused import must not insert anything");

  // 4. Choices are honoured: map one, add one, let the app guess for one (whose row the person
  //    then leaves uncategorized), and leave the rule-pointed row uncategorized.
  const summary = await ok("commit_import", {
    ...base,
    reviewToken: preview.review_token,
    categoryChoices: {
      Merchandise: { action: "create" },
      Dining: { action: "map_to", category: "Dining Out" },
      "Gas/Automotive": { action: "skip" },
    },
    rowChoices: { 2: null, 5: null },
  });
  if (summary.inserted !== 6) throw new Error(`all six rows should be imported, got ${JSON.stringify(summary)}`);
  const categories = await ok("list_categories");
  const added = categories.filter((c) => !before.includes(c));
  if (added.join("|") !== "Merchandise") throw new Error(`only the category they chose to add should be new, got: ${added.join(", ") || "(none)"}`);
  const txns = await ok("list_transactions");
  const expected = {
    "ZQX HARDWARE 1": "Merchandise",
    "ZQX HARDWARE 2": "Merchandise",
    "ZQX FUEL 1": null,
    "ZQX BISTRO 1": "Dining Out",
    "ZQX MART 1": "Groceries",
    "ZQX PLAIN 1": null,
  };
  for (const [description, category] of Object.entries(expected)) {
    if (categoryOf(txns, description) !== category) {
      throw new Error(`${description} should be filed under ${category}, got ${categoryOf(txns, description)}`);
    }
  }
  if (categories.includes("Zebra Care")) throw new Error("the auto-categorizer invented a category");

  // 5. The next preview fills in the mapping it remembered, and the added category now matches.
  const again = await ok("preview_import", { path: csvPath, invertAmounts: false, accountId });
  const dining = again.unmatched_categories.find((u) => u.name === "Dining");
  if (dining?.remembered_category !== "Dining Out") throw new Error(`Dining should be remembered as Dining Out, got ${JSON.stringify(dining)}`);
  if (again.unmatched_categories.some((u) => u.name.toLowerCase() === "merchandise")) throw new Error("Merchandise is one of theirs now");
  if (again.rows[0].matched_category !== "Merchandise") throw new Error("the added category should match on the next import");

  // 6. The Transactions tab still shows the imported rows.
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
  fs.rmSync(csvDir, { recursive: true, force: true });
}
