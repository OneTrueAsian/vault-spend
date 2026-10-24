import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { seedHouseholdDatabase } from "./household-demo.mjs";
import { freshTestDbDir, seedFixture } from "./lib/seed.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";
import { invoke } from "./lib/change-password.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { runAskLayoutChecks } from "./lib/askLayoutChecks.mjs";

// Ask the Vault must leave nothing behind when the profile locks: not the question, not the answer,
// not the purchases dialog. A late reply from the native side must not reappear after unlocking either.
const QUESTION = "how much did I spend on groceries last month";
const PASSWORD = "ask the vault lock password";

const dbDir = freshTestDbDir();
await seedHouseholdDatabase(dbDir);
const app = await launchApp({ dbDir });
const b = app.browser;
try {
  await b.$("button*=Settings").click();
  await enableProtectionThroughUI(b, PASSWORD);
  await b.waitUntil(async () => (await b.$(".page").getText()).includes("Password protection: On"), { timeout: 10000 });

  const openDashboard = async () => {
    await (await b.$(".nav-item[data-tab=dashboard]")).click();
    await (await b.$(".ledger-qa-card input")).waitForExist({ timeout: 10000 });
  };
  await openDashboard();

  // M6 task-4 final review (VP-11, EX-05/06): characterization of the real
  // keyboard, controlled region and fill announcement; no injected component state.
  const tips = await (await b.$('.ledger-qa-card')).$('button=Tips & examples');
  assert.equal(await tips.getAttribute('aria-expanded'), 'false');
  await tips.click();
  await b.waitUntil(async () => await tips.getAttribute('aria-expanded') === 'true', { timeout: 3000 });
  const controlled = await tips.getAttribute('aria-controls');
  assert.ok(controlled, 'Tips must identify its controlled region');
  assert.equal(await b.$(`[id="${controlled}"]`).isDisplayed(), true);
  await b.keys('Enter');
  await b.waitUntil(async () => await tips.getAttribute('aria-expanded') === 'false', { timeout: 3000 });
  await b.keys('Enter');
  await b.waitUntil(async () => await tips.getAttribute('aria-expanded') === 'true', { timeout: 3000 });
  const example = await b.$('.ledger-qa-tips .ledger-qa-examples button');
  const exampleText = await example.getText();
  await b.keys('Tab');
  assert.equal(await b.execute(() => document.activeElement?.textContent?.trim()), exampleText);
  await b.keys('Enter');
  assert.equal(await b.$('.ledger-qa-card input').getValue(), exampleText);
  assert.equal(await b.execute(() => document.activeElement?.getAttribute('aria-label')), 'Your question');
  assert.equal(await b.execute(() => document.querySelector('[data-example-status]')?.textContent), 'Example filled in. Press Ask to run it.');
  assert.equal(await b.$('.ledger-qa-answer').isExisting(), false, 'filling an example is not asking it');
  await b.$('.ledger-qa-card input').addValue('?');
  assert.equal(await b.execute(() => document.querySelector('[data-example-status]')?.textContent), '', 'editing clears the fill notice');
  await b.keys(['Control', 'a']); await b.keys('Backspace');
  await tips.click();
  await b.$('.nav-item[data-tab=help]').click();
  await b.$('.help-search').waitForExist({ timeout: 5000 });
  await b.$('.help-search').setValue('plain English');
  await b.waitUntil(async () => (await b.$('.page').getText()).includes('I can correct small typing mistakes'), { timeout: 5000 });
  const helpText = (await b.$('.page').getText()).replace(/\s+/g, ' ');
  assert.ok(helpText.includes('I can correct small typing mistakes and show how I read them. If a name is unclear, I’ll ask you to choose.'));
  assert.ok(!helpText.includes('or a word looks misspelled, it asks you to choose instead of guessing'));
  await openDashboard();
  console.log('M6 COMPILED TIPS KEYBOARD / FILL / EDIT / HELP WORDING PASSED');

  // M4's bounded native baseline read is coherent/read-only, and cannot cross lock or session retirement.
  const baselineOrigin = (await invoke(b, "get_transaction_context")).ok;
  const batchArgs = { request: { contractVersion: 1, categories: ["Groceries"], expectedRevision: null }, expectedGeneration: baselineOrigin.generation, expectedSessionRevision: baselineOrigin.sessionRevision };
  const batch = await invoke(b, "get_ask_vault_baselines", batchArgs);
  assert.ok(batch.ok, `M4 batch must be available: ${batch.error}`);
  assert.equal(batch.ok.baselines.length, 1);
  assert.equal(batch.ok.baselines[0].snapshot.periods[0].months.length, 3);
  const batchAgain = await invoke(b, "get_ask_vault_baselines", { ...batchArgs, request: { ...batchArgs.request, expectedRevision: batch.ok.revision } });
  assert.deepEqual(batchAgain.ok, batch.ok, "baseline reads are exact, repeatable and do not change revisions");
  assert.ok((await invoke(b, "get_ask_vault_baselines", { ...batchArgs, request: { ...batchArgs.request, categories: ["Groceries", "Groceries"] } })).error);

  const input = await b.$(".ledger-qa-card input");
  await input.click();
  await input.addValue(QUESTION);
  await (await (await b.$(".ledger-qa-card")).$("button=Ask")).click();
  const answer = await b.$(".ledger-qa-answer");
  await answer.waitForExist({ timeout: 8000 });
  const answerText = await answer.getText();
  assert.ok(/You spent \$[\d,]+\.\d\d on Groceries/.test(answerText), `expected a groceries answer, got "${answerText}"`);
  const amount = answerText.match(/\$[\d,]+\.\d\d/)[0];

  // Nothing about the question or its answer is written to the browser's own storage, the address or the title.
  const leaked = await b.execute(async (question, amount) => {
    const found = [];
    const look = (where, text) => { if (text && (text.includes(question) || text.includes(amount))) found.push(where); };
    for (const store of [localStorage, sessionStorage]) for (let i = 0; i < store.length; i++) look(store === localStorage ? "localStorage" : "sessionStorage", store.key(i) + "=" + store.getItem(store.key(i)));
    look("address", location.href);
    look("title", document.title);
    if (indexedDB.databases) for (const d of await indexedDB.databases()) look("indexedDB name", d.name ?? "");
    return found;
  }, QUESTION, amount);
  assert.deepEqual(leaked, [], "the question and answer must not be stored anywhere in the browser");

  // Names for assistive technology, and the keyboard returns to where it was after the dialog closes.
  const access = await b.execute(() => {
    const card = document.querySelector(".ledger-qa-card");
    const input = card.querySelector("input");
    return {
      inputName: input.getAttribute("aria-label") || input.labels?.[0]?.textContent || "",
      announces: !!card.querySelector("[aria-live='polite']"),
      unnamed: [...card.querySelectorAll("button")].filter((x) => !(x.getAttribute("aria-label") || x.textContent).trim()).length,
    };
  });
  assert.ok(access.inputName.trim().length > 0, "the question box needs a name");
  assert.equal(access.announces, true, "answers must be announced politely");
  assert.equal(access.unnamed, 0, "every button needs a name");
  await (await b.$("button*=View ")).click();
  await (await b.$("[role='dialog']")).waitForExist({ timeout: 5000 });
  await b.keys("Escape");
  await b.waitUntil(async () => !(await (await b.$("[role='dialog']")).isExisting()), { timeout: 5000, timeoutMsg: "Escape should close the purchases dialog" });
  const focused = await b.execute(() => document.activeElement?.textContent?.trim() ?? "");
  assert.ok(focused.startsWith("View"), `focus should return to the View button, was "${focused}"`);

  // Leave the purchases dialog open, then lock the way the workstation does.
  await (await b.$("button*=View ")).click();
  await (await b.$("[role='dialog']")).waitForExist({ timeout: 5000 });
  assert.equal((await invoke(b, "debug_apply_system_session_event", { event: "locked" })).ok, true);
  await b.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  assert.ok((await invoke(b, "get_ask_vault_baselines", batchArgs)).error, "batch cannot read a locked profile");
  const lockedText = await b.execute(() => document.body.innerText);
  assert.ok(!lockedText.includes(amount), "the locked screen must not show the answer");
  assert.ok(!lockedText.includes("groceries"), "the locked screen must not show the question");
  assert.equal(await b.$(".ledger-qa-card").isExisting(), false, "the card must be gone while locked");
  assert.equal(await b.$("[role='dialog']").isExisting(), false, "the purchases dialog must be gone while locked");

  await b.$("#password-form-field").setValue(PASSWORD);
  await b.$("button=Unlock").click();
  await b.$(".brand-word").waitForExist({ timeout: 10000 });
  await openDashboard();
  assert.equal(await (await b.$(".ledger-qa-card input")).getValue(), "", "the question box must start empty after unlocking");
  assert.ok((await invoke(b, "get_ask_vault_baselines", batchArgs)).error, "a retired pre-lock batch origin cannot read after unlock");
  assert.equal(await b.$(".ledger-qa-answer").isExisting(), false, "no answer may reappear after unlocking");
  assert.equal(await b.$("[role='dialog']").isExisting(), false, "no dialog may reappear after unlocking");
  // M3 review contains financial evidence too; it must disappear on lock and stay gone on unlock.
  const scenarioQuestion = `Cut Groceries by $1 once on ${dateInMonth(1, 15)}`;
  await b.$(".ledger-qa-card input").addValue(scenarioQuestion);
  await (await b.$(".ledger-qa-card")).$("button=Ask").click();
  await b.waitUntil(async () => {
    const dialog = await b.$("[role='dialog']");
    return await dialog.isExisting() && /Check these details|I cannot tell what a usual month is/.test(await dialog.getText());
  }, { timeout: 8000 });
  assert.equal((await invoke(b, "debug_apply_system_session_event", { event: "locked" })).ok, true);
  await b.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  assert.equal(await b.$("[role='dialog']").isExisting(), false, "scenario review must disappear on lock");
  assert.ok(!(await b.execute(() => document.body.innerText)).includes(scenarioQuestion));
  await b.$("#password-form-field").setValue(PASSWORD);
  await b.$("button=Unlock").click();
  await b.$(".brand-word").waitForExist({ timeout: 10000 });
  await openDashboard();
  assert.equal(await b.$("[role='dialog']").isExisting(), false, "scenario confirmation must not survive unlock");
  assert.equal(await b.$(".ledger-qa-card input").getValue(), "");
  // M4 result and its reviewed constraints must be retired by a real profile lock.
  const targetQuestion = `Save $1 monthly across Groceries with Groceries floor $0 and maximum cut 100% from ${dateInMonth(1, 1)} through ${dateInMonth(1, 28)}`;
  await b.$('.ledger-qa-card input').addValue(targetQuestion);
  await (await b.$('.ledger-qa-card')).$('button=Ask').click();
  await b.$('button=Review the details').waitForExist({ timeout: 5000 });
  const prorate = await b.$('label*=Count the part month by the day');
  if (await prorate.isExisting()) await (await prorate.$('input')).click();
  await b.$('button=Review the details').click();
  await b.$('button=Show the preview').waitForExist({ timeout: 8000 });
  const ownMonth = await b.$('input[aria-label="Groceries usual month"]');
  if (await ownMonth.isExisting()) await ownMonth.setValue('100');
  else {
    const short = await b.$('label*=recorded months for Groceries');
    const one = await b.$('label*=Use 1 recorded month for Groceries');
    if (await short.isExisting()) await (await short.$('input')).click();
    else if (await one.isExisting()) await (await one.$('input')).click();
  }
  await b.$('button=Show the preview').click();
  await b.$('.cut-preview-results').waitForExist({ timeout: 8000 });
  const targetLeak = await b.execute(q => {
    const found=[];
    for(const s of [localStorage,sessionStorage])for(let i=0;i<s.length;i++)if((s.key(i)+'='+s.getItem(s.key(i))).includes(q))found.push('storage');
    if(location.href.includes(q)||document.title.includes(q))found.push('address/title');return found;
  },targetQuestion);
  assert.deepEqual(targetLeak,[]);
  assert.equal((await invoke(b, 'debug_apply_system_session_event', { event:'locked' })).ok,true);
  await b.$('[data-profile-lock-screen]').waitForExist({ timeout:10000 });
  assert.equal(await b.$('.cut-preview-results').isExisting(),false);
  assert.equal(await b.$('[role="dialog"]').isExisting(),false);
  assert.ok(!(await b.execute(()=>document.body.innerText)).includes(targetQuestion));
  await b.$('#password-form-field').setValue(PASSWORD);await b.$('button=Unlock').click();await b.$('.brand-word').waitForExist({timeout:10000});await openDashboard();
  assert.equal(await b.$('.ledger-qa-card input').getValue(),'');assert.equal(await b.$('[role="dialog"]').isExisting(),false);
  console.log("FEATURE 296 E2E TEST PASSED");
} finally {
  await app.close();
}

// Fresh M4 inclusion fixture: hand-derived12.34/33.45/34.56; excluded rows carry negative splits,
// so sign or split-parent handling alone cannot accidentally make this pass.
const inclusionDir = await seedFixture(String.raw`
import datetime
today=datetime.date.today();month=today.replace(day=1);months=[]
for i in range(4):month=(month-datetime.timedelta(days=1)).replace(day=1);months.append(month)
months.reverse()
for c in ['M4 Fixture','M4 Other']:cur.execute('INSERT OR IGNORE INTO categories(name) VALUES (?)',(c,))
accounts=[]
for name,kind in [('M4 checking','checking'),('M4 savings','savings'),('M4 loan','loan')]:
    cur.execute('INSERT INTO accounts(name,account_type,starting_balance) VALUES (?, ?,\'0\')',(name,kind));accounts.append(cur.lastrowid)
def add(account,date,amount,cat,tag):
    cur.execute('INSERT INTO transactions(account_id,date,description,amount,category,fingerprint) VALUES (?,?,?,?,?,?)',(account,date.isoformat(),tag,amount,cat,tag));return cur.lastrowid
add(accounts[0],months[0],'0','M4 Fixture','start')
for date,amount in zip(months[1:],['-12.34','-23.45','-34.56']):add(accounts[0],date.replace(day=10),amount,'M4 Fixture','ordinary-'+date.isoformat())
add(accounts[0],today,'0','M4 Fixture','end')
out=add(accounts[0],months[2].replace(day=12),'-30.00','M4 Fixture','linked-out');incoming=add(accounts[1],months[2].replace(day=12),'30.00','M4 Other','linked-in')
cur.execute('INSERT INTO transfer_links(out_transaction_id,in_transaction_id) VALUES (?,?)',(out,incoming))
cur.execute('INSERT INTO transaction_splits(transaction_id,category,amount) VALUES (?,\'M4 Fixture\',\'-30.00\')',(out,))
add(accounts[0],months[2].replace(day=13),'-40.00','Transfer','transfer-category')
source=add(accounts[0],months[2].replace(day=14),'-10.00','M4 Fixture','source-payment')
generated=add(accounts[2],months[2].replace(day=14),'-999.00','M4 Fixture','generated-leg')
cur.execute('INSERT INTO debt_payments(source_transaction_id,debt_account_id,generated_transaction_id,amount,date) VALUES (?,?,?,?,?)',(source,accounts[2],generated,'10.00',months[2].replace(day=14).isoformat()))
cur.execute('INSERT INTO transaction_splits(transaction_id,category,amount) VALUES (?,\'M4 Fixture\',\'-999.00\')',(generated,))
`);
const inclusionApp = await launchApp({ dbDir: inclusionDir });
try {
  const browser = inclusionApp.browser, origin = (await invoke(browser, "get_transaction_context")).ok;
  const args = { expectedGeneration: origin.generation, expectedSessionRevision: origin.sessionRevision, request: { contractVersion: 1, categories: ["M4 Fixture", "M4 Other"], expectedRevision: null } };
  const result = await invoke(browser, "get_ask_vault_baselines", args); assert.ok(result.ok, result.error);
  const decimalCents = value => { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")); };
  const own = result.ok.baselines[0].snapshot.periods[0];
  assert.deepEqual(own.months.map(row => decimalCents(row.total)), [1234n, 3345n, 3456n]);
  assert.equal(decimalCents(own.total), 8035n); assert.equal(decimalCents(result.ok.baselines[1].snapshot.periods[0].total), 0n);
  const legacy = await invoke(browser, "get_ask_vault_snapshot", { ...args, request: { contractVersion: 2, kind: "total", periods: [{ from: own.from, to: own.to }], accountIds: [], categories: ["M4 Fixture"], minimumPurchase: null, vendors: [], excludeVendors: [], excludeCategories: [], limit: 1, members: { ids: [], unassigned: false }, groupBy: "month", average: "per-month", alignment: "as-requested", expectedRevision: result.ok.revision } });
  assert.ok(legacy.ok, legacy.error); assert.deepEqual(legacy.ok.periods[0].months, own.months); assert.deepEqual(legacy.ok.revision, result.ok.revision);
  console.log("M4 FRESH NATIVE TRANSFER / GENERATED PAYMENT / SOURCE PAYMENT PARITY PASSED");
} finally { await inclusionApp.close(); }

// M6 (D-S4-03): narrow widths, long names and the M4 states no other compiled check reaches (the ordinary card and M3 sections run in feature41).
await runAskLayoutChecks({ month: "", sections: ["m4"] });
