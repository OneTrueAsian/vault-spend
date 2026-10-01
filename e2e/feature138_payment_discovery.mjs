// Applied payments: source category, either-account discovery, and exact-ID navigation.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (id,name,account_type,starting_balance) VALUES (101,'Fixture Checking','checking','1000'),(102,'Fixture Card','credit','1000'),(103,'Other Savings','savings','0')")
cur.execute("INSERT INTO categories (name) VALUES ('No Category')")
cur.execute("INSERT INTO transactions (id,account_id,date,description,amount,category,fingerprint) VALUES (201,101,'2026-09-01','Card payment','-100.00','No Category','payment138')")
for n in range(60):
    cur.execute("INSERT INTO transactions (account_id,date,description,amount,category,fingerprint) VALUES (101,'2026-09-20',?,?,'No Category',?)", ('Card payment' if n == 0 else f'Ordinary purchase {n}', f'-{n + 1}.01', f'purchase138-{n}'))
`);
const app = await launchApp({ dbDir });
const { browser } = app;
const shots = path.join(os.tmpdir(), "vault-payment-discovery-shots");
fs.mkdirSync(shots, { recursive: true });
async function invoke(command, args = {}) {
  const result = await browser.executeAsync((cmd, a, done) => {
    window.__TAURI_INTERNALS__.invoke(cmd, a).then(value => done({ value }), error => done({ error: String(error) }));
  }, command, args);
  if (result.error !== undefined) throw new Error(`${command}: ${result.error}`);
  return result.value;
}
async function nav(label) {
  await browser.waitUntil(async () => (await browser.$$("nav button")).length > 0, { timeout: 10000 });
  for (const button of await browser.$$("nav button")) {
    if ((await button.getText()).trim() === label) { await button.click(); return; }
  }
  throw new Error(`Missing nav ${label}: ${await (await browser.$("body")).getText()}`);
}
async function accountFilter(names) {
  await (await browser.$(".payment-account-filter .account-filter-toggle")).click();
  await (await (await browser.$(".payment-account-filter")).$("button=Clear all")).click();
  for (const name of names) await (await (await browser.$(".payment-account-filter")).$(`label=${name}`)).click();
  await (await browser.$(".payment-account-filter .account-filter-toggle")).click();
}
async function categoryFilter(name) {
  await (await browser.$(".category-filter-toggle")).click();
  await (await (await browser.$(".category-filter-panel")).$(`button=${name}`)).click();
}
async function openCard() {
  await nav("Accounts");
  if (!(await (await browser.$('[data-account-detail="102"]')).isExisting())) {
    const details = await browser.$('[data-account-details="102"]');
    await details.waitForExist({ timeout: 10000 });
    await details.click();
  }
  await (await browser.$(".view-payment")).waitForExist({ timeout: 10000 });
}
async function waitForPayment() {
  const row = await browser.$('[data-payment-row="201"]');
  await row.waitForExist({ timeout: 10000 });
  return row;
}
try {
  await browser.setWindowSize(1440, 1000);
  await invoke("apply_debt_payment", { sourceTransactionId: 201, debtAccountId: 102, amount: "55.35", date: "2026-09-02" });
  await invoke("correct_category", { id: 201, category: "Payment/Credit" });
  await invoke("set_apply_to_debt_enabled", { enabled: false });
  const balanceBefore = (await invoke("list_accounts")).map(a => [a.id, a.current_balance]);
  assert.equal((await invoke("list_transactions")).length, 61);
  await browser.refresh();
  await openCard();
  const recent = await browser.$("[data-account-detail] table.ledger");
  await browser.waitUntil(async () => (await recent.getText()).includes("Payment/Credit"), { timeout: 10000 });
  assert.ok(!(await recent.getText()).includes("No Category"));
  await browser.saveScreenshot(path.join(shots, "account.png"));

  await nav("Transactions");
  await accountFilter(["Fixture Card"]);
  await categoryFilter("Payment/Credit");
  let row = await waitForPayment();
  assert.equal((await browser.$$("[data-payment-row]")).length, 1);
  assert.match(await row.getText(), /Fixture Checking.*Fixture Card/s);
  assert.match(await row.getText(), /Applied.*55\.35.*2026-09-02/s);
  assert.match(await row.getText(), /-\$100\.00/);
  await accountFilter(["Fixture Checking", "Fixture Card"]);
  assert.equal((await browser.$$("[data-payment-row]")).length, 1);
  await accountFilter(["Fixture Checking"]);
  await waitForPayment();
  await accountFilter(["Fixture Card"]);
  await categoryFilter("No Category");
  await browser.waitUntil(async () => (await browser.$$("[data-payment-row]")).length === 0, { timeout: 5000 });

  // Leave conflicting category, account, description, and hidden date filters in place.
  await (await browser.$('[aria-label="Search description"]')).setValue("unrelated");
  await (await browser.$("button=More filters")).click();
  await browser.execute(() => {
    const input = document.querySelector('.ledger-filters input[type="date"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "2026-09-20");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await (await (await browser.$(".ledger-filters")).$("button*=filter active")).click();
  await openCard();
  // Activate through the keyboard, then verify actual focus on the original ID.
  await browser.execute(() => document.querySelector(".view-payment").focus());
  await browser.keys("Enter");
  row = await waitForPayment();
  await browser.waitUntil(async () => await browser.execute(() => document.activeElement?.getAttribute("data-payment-row") === "201"), { timeout: 5000 });
  assert.match(await (await browser.$(".ledger-pagination")).getText(), /Page 2 of 2/);
  assert.equal(await (await browser.$('[aria-label="Search description"]')).getValue(), "");
  assert.ok(await (await browser.$("button=More filters")).isExisting());
  assert.match(await (await browser.$(".category-filter-toggle")).getText(), /All categories/);
  assert.deepEqual((await invoke("list_accounts")).map(a => [a.id, a.current_balance]), balanceBefore);
  assert.equal((await invoke("list_transactions")).length, 61);

  // Readable at wide and narrow widths in real light/dark modes. The row
  // density selector is hidden; its saved preference is covered by feature65.
  for (const mode of ["Light", "Dark"]) {
    await (await browser.$(`button=${mode}`)).click();
    for (const width of [1440, 800]) {
      await browser.setWindowSize(width, 1000);
      await browser.waitUntil(async () => (await (await browser.$('[data-payment-row="201"] .applied-payment-details')).isDisplayed()), { timeout: 5000 });
      await (await browser.$('[data-payment-row="201"]')).scrollIntoView({ block: "center" });
      const geometry = await browser.execute(() => {
        const el = document.querySelector('[data-payment-row="201"] .applied-payment-details');
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: window.innerWidth, height: window.innerHeight, overflow: el.scrollWidth > el.clientWidth + 1 };
      });
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.top >= 0 && geometry.bottom <= geometry.height && !geometry.overflow, JSON.stringify(geometry));
      await browser.saveScreenshot(path.join(shots, `${mode}-${width}.png`));
    }
  }
  // Bulk category changes reach the account read model without a category rewrite.
  await invoke("bulk_correct_category", { ids: [201], category: "Updated payment" });
  assert.equal((await invoke("list_account_transactions", { accountId: 102, limit: 200 }))[0].category, "Updated payment");
  await invoke("delete_transaction", { id: 201 });
  assert.equal((await invoke("list_account_transactions", { accountId: 102, limit: 200 })).length, 0);
  await invoke("restore_transactions", { ids: [201] });
  assert.equal((await invoke("list_account_transactions", { accountId: 102, limit: 200 }))[0].payment_source_id, 201);
  await openCard();
  await invoke("unapply_debt_payment", { sourceTransactionId: 201 });
  await (await browser.$(".view-payment")).click();
  await browser.waitUntil(async () => (await (await browser.$("body")).getText()).includes("Payment is no longer available."), { timeout: 5000 });
  assert.equal((await invoke("list_account_transactions", { accountId: 102, limit: 200 })).length, 0);
  console.log(`FEATURE 138 E2E TEST PASSED; screenshots: ${shots}`);
} catch (error) {
  await browser.saveScreenshot(path.join(shots, "failure.png")).catch(() => {});
  console.error("Page at failure:", await (await browser.$("body")).getText().catch(() => "unavailable"));
  throw error;
} finally {
  await app.close();
}
