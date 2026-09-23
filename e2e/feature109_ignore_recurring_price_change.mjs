import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today().isoformat()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000')")
acct = cur.lastrowid
for merchant, old, new in [('Stream Service', '-15', '-20'), ('Venmo', '-175', '-10')]:
    cur.execute("INSERT INTO recurring (merchant, amount, cadence, anchor_date, account_id) VALUES (?, ?, 'monthly', ?, ?)", (merchant, old, today, acct))
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, fingerprint) VALUES (?, ?, ?, ?, ?)", (acct, today, merchant, new, merchant))
`);

async function storedItems(browser) {
  return browser.executeAsync((done) => {
    window.__TAURI_INTERNALS__.invoke("list_recurring").then(done, (e) => done({ error: String(e) }));
  });
}

async function checkAmounts(browser) {
  const items = await storedItems(browser);
  assert.equal(Number(items.find((r) => r.merchant === "Stream Service").amount), -15);
  assert.equal(Number(items.find((r) => r.merchant === "Venmo").amount), -175);
}

const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  await (await browser.$("button*=Recurring")).click();
  await browser.$("[data-price-alert='Stream Service']").waitForExist({ timeout: 10000 });
  await browser.$("[data-price-alert='Venmo']").waitForExist({ timeout: 10000 });
  await browser.saveScreenshot(path.join(os.tmpdir(), "vault-recurring-ignore.png"));
  await (await browser.$("[data-price-alert='Stream Service']").$("button=Ignore")).click();
  await browser.$("[data-price-alert='Stream Service']").waitForExist({ reverse: true, timeout: 10000 });
  assert.ok(await browser.$("[data-price-alert='Venmo']").isExisting(), "ignoring one alert must leave the other visible");
  await (await browser.$("[data-price-alert='Venmo']").$("button=Ignore")).click();
  await browser.$("[data-price-alerts]").waitForExist({ reverse: true, timeout: 10000 });
  await checkAmounts(browser);
  await (await browser.$("button*=Dashboard")).click();
  await browser.waitUntil(async () => !(await browser.$(".page").getText()).includes("changed price"), { timeout: 10000 });
  await (await browser.$("button*=Recurring")).click();
  assert.equal(await browser.$("[data-price-alerts]").isExisting(), false);
} finally {
  await app.close();
}

// A real process restart proves the dismissal belongs to the profile, not component state.
const reopened = await launchApp({ dbDir });
try {
  const { browser } = reopened;
  await (await browser.$("button*=Recurring")).click();
  await browser.$("[data-match-state='paid']").waitForExist({ timeout: 10000 });
  assert.equal(await browser.$("[data-price-alerts]").isExisting(), false);
  await checkAmounts(browser);
} finally {
  await reopened.close();
}
console.log("FEATURE 109 E2E TEST PASSED");
