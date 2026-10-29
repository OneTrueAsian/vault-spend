// An account's own page shows its transactions a step at a time, like the Transactions tab:
//   - the first 50 of 120 show, with "Showing 50 of 120 transactions" and "Show 50 more";
//   - "Show 50 more" then "Show 20 more" reveal the rest, newest first, and the button goes away;
//   - choosing 25 at a time starts over with 25 rows;
//   - the balance at the top never changes while the limit does.
// Screenshots go to VS_SCREENS_DIR (default: a temporary folder that is deleted on exit).
//
// Run with: node e2e/feature368_account_transactions_display_limit.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '1000.00')")
acct = cur.lastrowid
for i in range(1, 121):
    d = (today - datetime.timedelta(days=i)).isoformat()
    desc = f"Purchase {i:03d}"
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, "-1.00", None, None, f"{acct}|{d}|{desc.lower()}|-1.00"))
`);
const shotsDir = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature368-");
fs.mkdirSync(shotsDir, { recursive: true });

const app = await launchApp({ dbDir });
const { browser: b } = app;

const rows = () => b.$$("[data-account-transaction-row]");
const rowCount = async () => (await rows()).length;
const shownText = async () => (await (await b.$("[data-account-ledger-shown]")).getText()).trim();
const moreButton = () => b.$("[data-account-show-more]");
const balanceText = async () => (await (await b.$(".account-detail .stat-value")).getText()).trim();
async function waitForRows(count, label) {
  let seen = -1;
  await waitUntilOrDiagnose(b, async () => (seen = await rowCount()) === count, { timeoutMsg: `${label}: expected ${count} rows`, extra: () => `saw ${seen}` });
}
async function waitForShown(text) {
  let seen = "";
  await waitUntilOrDiagnose(b, async () => (seen = await shownText()) === text, { timeoutMsg: `the count should read "${text}"`, extra: () => seen });
}
async function shot(name) {
  await (await b.$(".account-detail .ledger-pagination")).scrollIntoView({ block: "center" });
  const box = await b.execute(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    const controls = r(".account-detail .ledger-pagination");
    return { top: controls.top, bottom: controls.bottom, cardBottom: r(".account-detail .card:last-child").bottom, mainTop: r(".main").top, mainBottom: r(".main").bottom };
  });
  assert.ok(box.top >= box.mainTop && box.bottom <= box.mainBottom, `${name}: the limit controls should be fully on screen (${JSON.stringify(box)})`);
  assert.ok(box.bottom <= box.cardBottom, `${name}: the limit controls belong inside the transactions card (${JSON.stringify(box)})`);
  await b.saveScreenshot(path.join(shotsDir, `${name}.png`));
}

try {
  await b.setWindowSize(1440, 1000);
  for (const button of await b.$$("nav button")) {
    if ((await button.getText()).trim() === "Accounts") await button.click();
  }
  await (await b.$("[data-account-details]")).click();
  await b.$("[data-account-detail]").waitForExist({ timeout: 10000, timeoutMsg: "Details should open the account's page" });

  // ---- the default: the first 50 of 120, newest first
  await waitForRows(50, "the default limit");
  await waitForShown("Showing 50 of 120 transactions");
  assert.equal((await (await moreButton()).getText()).trim(), "Show 50 more");
  assert.match(await (await rows())[0].getText(), /Purchase 001/, "the newest transaction comes first");
  assert.match(await (await rows())[49].getText(), /Purchase 050/);
  const balance = await balanceText();
  await shot("account-limit-default");

  // ---- Show more, through the partial last batch
  await (await moreButton()).click();
  await waitForRows(100, "after Show 50 more");
  await waitForShown("Showing 100 of 120 transactions");
  assert.equal((await (await moreButton()).getText()).trim(), "Show 20 more");
  await (await moreButton()).click();
  await waitForRows(120, "after Show 20 more");
  await waitForShown("Showing all 120 transactions");
  assert.equal(await (await moreButton()).isExisting(), false, "nothing is left to show");
  assert.match(await (await rows())[119].getText(), /Purchase 120/);
  await shot("account-limit-all-shown");

  // ---- a new limit starts over at that many rows
  await (await b.$(".account-detail .ledger-page-size .menu-select-toggle")).click();
  await (await b.$("[role='menuitemradio'][data-value='25']")).click();
  await waitForRows(25, "after choosing 25 at a time");
  await waitForShown("Showing 25 of 120 transactions");
  assert.equal((await (await moreButton()).getText()).trim(), "Show 25 more");
  await shot("account-limit-25");

  // ---- the balance does not depend on how many rows show
  assert.equal(await balanceText(), balance, "the balance must not change with the display limit");
  console.log(`PASS feature368 (screenshots in ${shotsDir})`);
} finally {
  await app.close();
}
