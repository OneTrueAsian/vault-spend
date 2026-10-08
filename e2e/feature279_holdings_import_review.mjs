// Real UI + IPC + SQLite: current holdings, immutable preview, add-only duplicates and profile boundaries.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseMenuOption } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Brokerage', 'investment', '500')")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Retirement', 'investment', '0')")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '0')")
cur.execute("INSERT INTO holdings (account_id,symbol,name,shares,price,cost_basis) VALUES (1,'OLD','Existing holding','1','10','8')")
`);
const folder = makeTempDir("holdings-import-");
const csvPath = path.join(folder, "positions.csv");
const csv = "Symbol,Name,Shares,Price,Cost Basis,Asset Class\nNEW,Fractional holding,0.125,100.10,10,Stocks\nOLD,Already owned,2,20,15,Stocks\nBAD,Missing cost,1,30,,Stocks\nDUP,First repeated row,1,10,5,Stocks\ndup,Second repeated row,2,10,10,Stocks\n";
fs.writeFileSync(csvPath, csv);
fs.writeFileSync(path.join(folder, "ignore.txt"), "not a CSV");
const app = await launchApp({ dbDir });
const b = app.browser;
async function ipc(command, args = {}) {
  const result = await b.executeAsync((command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then(value => done({ value }), error => done({ error: String(error) })), command, args);
  if (result.error) throw new Error(result.error); return result.value;
}
async function button(text) { return (await b.$("[role='dialog']")).$(`button=${text}`); }
async function open(account = "1") {
  await (await b.$("button*=Import holdings")).click();
  await b.$("[data-holding-import]").waitForExist({ timeout: 5000 });
  await chooseMenuOption(await b.$("[aria-label^='Import account']"), { value: account });
}
async function readPasted(text) {
  await (await button("Paste rows")).click();
  if (text.includes("\t")) {
    // WebDriver's key entry interprets tabs as focus navigation. Emulate the
    // input event produced when spreadsheet text is pasted into the textarea.
    await b.execute(text => {
      const field = document.querySelector('[data-holding-import] textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, text);
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    }, text);
  } else await (await b.$("[data-holding-import] textarea")).setValue(text);
  assert.equal(await b.$("[data-holding-import] textarea").getValue(), text);
  await (await button("Match columns")).click();
  await (await button("Review holdings")).waitForEnabled({ timeout: 5000 });
  await (await button("Review holdings")).click();
  await b.$("[data-holding-import-row]").waitForExist({ timeout: 5000 });
}
try {
  await (await b.$("button*=Investments")).click();
  await (await b.$("button*=Import holdings")).waitForExist({ timeout: 10000 });
  await open();
  assert.equal(await b.$("[data-holding-import] select, [data-holding-import] input[type=file]").isExisting(), false);
  await (await button("Browse files…")).click();
  const folderInput = await b.$("[data-holding-file-browser] input");
  await folderInput.waitForExist({ timeout: 5000 }); await folderInput.setValue(folder);
  await (await button("Open folder")).click();
  await (await b.$("//div[@data-holding-file-browser]//button[contains(.,'positions.csv')]")).waitForExist({ timeout: 5000 });
  assert.equal(await b.$("//div[@data-holding-file-browser]//button[contains(.,'ignore.txt')]").isExisting(), false);
  await (await b.$("//div[@data-holding-file-browser]//button[contains(.,'positions.csv')]")).click();
  await (await button("Match columns")).click();
  await (await button("Review holdings")).waitForEnabled({ timeout: 5000 });
  // A preview is a snapshot, so changing the source on disk cannot alter what is committed.
  fs.writeFileSync(csvPath, csv.replace("100.10", "9999"));
  await (await button("Review holdings")).click();
  await b.$("[data-holding-import-row='2']").waitForExist({ timeout: 5000 });
  assert.equal(await b.$("[aria-label='Include row 2']").isSelected(), true);
  assert.equal(await b.$("[aria-label='Include row 3']").isEnabled(), false);
  assert.equal(await b.$("[aria-label='Include row 4']").isEnabled(), false);
  assert.equal(await b.$("[aria-label='Include row 5']").isSelected(), false);
  await b.$("[aria-label='Include row 5']").click();
  assert.equal(await b.$("[aria-label='Include row 6']").isEnabled(), false);
  await b.$("[data-add-imported-holdings]").click();
  await (await button("Done")).waitForExist({ timeout: 5000 }); await (await button("Done")).click();
  const holdings = await ipc("list_holdings");
  assert.equal(holdings.length, 3);
  assert.equal(holdings.find(h => h.symbol === "NEW").price, "100.10");
  assert.equal(holdings.find(h => h.symbol === "NEW").value, "12.51250");
  assert.equal(holdings.find(h => h.symbol === "OLD").shares, "1");
  assert.equal((await ipc("list_accounts")).find(a => a.id === 1).current_balance, "32.51250");
  await b.waitUntil(async () => (await b.$(".page").getText()).includes("NEW"), { timeout: 5000 });

  await open(); await readPasted("Symbol,Shares,Price,Cost Basis\nNEW,1,100,80\n");
  assert.equal(await b.$("[data-add-imported-holdings]").isEnabled(), false);
  await (await button("Cancel")).click();
  assert.equal((await ipc("list_holdings")).length, 3);

  await open("2"); await readPasted("Symbol\tShares\tPrice\tCost Basis\nNEW\t0.5\t20\t8\n");
  assert.ok((await b.$("[data-holding-import]").getText()).includes("Include all current positions"));
  await b.$("[data-add-imported-holdings]").click();
  await (await button("Done")).waitForExist({ timeout: 5000 }); await (await button("Done")).click();
  assert.equal((await ipc("list_holdings")).filter(h => h.symbol === "NEW").length, 2);
  assert.equal((await ipc("list_accounts")).find(a => a.id === 2).current_balance, "10.0");

  const generation = await ipc("get_current_generation");
  const source = await ipc("load_holding_import", { content: "S,Q,P,C\nPRIVATE,1,10,5\n", path: null, format: "csv", generation });
  await ipc("preview_holding_import", { id: source.id, accountId: 1, mapping: { symbol: 0, shares: 1, price: 2, cost_basis: 3, name: null, asset_class: null }, generation });
  await assert.rejects(ipc("commit_holding_import", { id: source.id, selectedRows: [2,2], generation }), /only once/);
  await ipc("create_holding", { accountId: 1, symbol: "PRIVATE", name: "Concurrent holding", shares: "1", price: "10", costBasis: "5", assetClass: null });
  await assert.rejects(ipc("commit_holding_import", { id: source.id, selectedRows: [2], generation }), /already exists/);
  await ipc("create_profile", { name: "Isolated import test" });
  await assert.rejects(ipc("commit_holding_import", { id: source.id, selectedRows: [2], generation }), /profile changed/);
  assert.equal((await ipc("list_holdings")).length, 0);
  await assert.rejects(ipc("commit_holding_import", { id: source.id, selectedRows: [2], generation: await ipc("get_current_generation") }), /expired/);
  console.log("PASS holdings CSV browser/paste/TSV, exact values, immutable source, duplicates, account totals, cancellation and stale-profile protection");
} catch (error) {
  console.error("Import dialog at failure:", await b.$("body").getText());
  throw error;
} finally { await app.close(); }
