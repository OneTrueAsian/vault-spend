// Transaction imports route to existing accounts only, including a Plaid-style unfamiliar Account.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chooseMenuOption, launchApp, menuSelectValue, stubFilePicker, waitUntilOrDiagnose } from "./harness.mjs";
import { startImportInto } from "./lib/importAccount.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Amex Blue', 'credit', '10000.00')")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Other Card', 'credit', '5000.00')")
`);
const dir = makeTempDir("vaultspend-import-existing-accounts-");
const file = path.join(dir, "plaid-transactions.csv");
fs.writeFileSync(file, [
  "date,description,amount,account,category",
  `${dateInMonth(-1, 3)},QQXZ APPLE CHARGE,-2.99,Blue Cash Everyday,Groceries`,
  `${dateInMonth(-1, 4)},QQXZ OTHER CARD,-4.00,other card,Groceries`,
  `${dateInMonth(-1, 5)},QQXZ CHOOSE AMEX,-5.00,Other Card,Groceries`,
  `${dateInMonth(-1, 6)},QQXZ LEFT OUT,-6.00,Another Unknown Account,Groceries`,
  "",
].join("\n"));
const app = await launchApp({ dbDir });
const { browser: b } = app;
async function invoke(command, args = {}) {
  const result = await b.executeAsync((cmd, args, done) => {
    window.__TAURI_INTERNALS__.invoke(cmd, args).then((ok) => done({ ok }), (error) => done({ error: String(error) }));
  }, command, args);
  if (result.error) throw new Error(`${command}: ${result.error}`);
  return result.ok;
}
const accountIdentity = async () => (await invoke("list_accounts")).map(({ id, name, account_type }) => ({ id, name, account_type }));
const row = (description) => b.$(`//table[contains(@class,'dup-review-table')]//tr[td[normalize-space()='${description}']]`);
const accountMenu = async (description) => (await row(description)).$(".menu-select-toggle");
async function openReview() {
  await b.execute((file) => window.__pickedFiles.unshift(file), file);
  await startImportInto(b, "Amex Blue");
  await waitUntilOrDiagnose(b, async () => {
    const keep = await b.$("button=Keep as-is");
    if (await keep.isDisplayed().catch(() => false)) await keep.click();
    return b.execute(() => !!document.querySelector("button[data-import-confirm]"));
  }, { timeoutMsg: "the transaction review should open" });
}
try {
  await (await b.$("nav button[aria-label='Transactions']")).click();
  await b.$(".ledger").waitForExist({ timeout: 10000 });
  await stubFilePicker(b, []);
  const before = await accountIdentity();
  const amex = before.find((a) => a.name === "Amex Blue").id;
  const other = before.find((a) => a.name === "Other Card").id;
  await openReview();
  assert.deepEqual(await accountIdentity(), before, "preview must not create accounts");
  assert.equal(await menuSelectValue(await accountMenu("QQXZ APPLE CHARGE")), String(amex));
  assert.equal(await menuSelectValue(await accountMenu("QQXZ OTHER CARD")), String(other));
  const text = await b.execute(() => document.querySelector(".import-review-dialog").textContent);
  assert.ok(text.includes("CSV: Blue Cash Everyday") && !text.includes("(new)"), "file account is metadata, not a promise to create one");
  await (await b.$("//div[@role='dialog']//button[normalize-space()='Cancel']")).click();
  await b.$("[data-import-confirm]").waitForExist({ reverse: true, timeout: 5000 });
  assert.deepEqual(await accountIdentity(), before, "cancel must not create accounts");
  assert.equal((await invoke("list_transactions")).length, 0);

  await openReview();
  // This row starts on Other Card; choosing the original default must remain an explicit override.
  await chooseMenuOption(await accountMenu("QQXZ CHOOSE AMEX"), { label: "Amex Blue" });
  await (await row("QQXZ LEFT OUT")).$("input[type='checkbox']").click();
  if (process.env.VS_SCREENS_DIR) {
    fs.mkdirSync(process.env.VS_SCREENS_DIR, { recursive: true });
    await b.saveScreenshot(path.join(process.env.VS_SCREENS_DIR, "transaction-import-existing-accounts.png"));
  }
  await (await b.$("[data-import-confirm]")).click();
  await b.$("[data-import-confirm]").waitForExist({ reverse: true, timeout: 10000 });
  assert.deepEqual(await accountIdentity(), before, "import must not create or change account identities");
  const imported = await invoke("list_transactions");
  assert.equal(imported.length, 3);
  assert.equal(imported.find((t) => t.description === "QQXZ APPLE CHARGE").account_id, amex);
  assert.equal(imported.find((t) => t.description === "QQXZ OTHER CARD").account_id, other);
  assert.equal(imported.find((t) => t.description === "QQXZ CHOOSE AMEX").account_id, amex);
  const close = await b.$("[data-inbox-close]");
  if (await close.isExisting()) await close.click();

  await openReview();
  assert.equal(await (await row("QQXZ APPLE CHARGE")).$("input[type='checkbox']").isSelected(), false, "reimport detects the duplicate in Amex Blue");
  await waitUntilOrDiagnose(b, async () => (await (await row("QQXZ APPLE CHARGE")).getText()).replace(/\s+/g, " ").includes("Already added"), {
    timeoutMsg: "the reimported row should visibly say Already added",
  });
  await (await b.$("//div[@role='dialog']//button[normalize-space()='Cancel']")).click();
  assert.deepEqual(await accountIdentity(), before);
  console.log("PASS feature384: existing accounts only, explicit overrides, cancel and duplicate detection");
} finally {
  await app.close();
}
