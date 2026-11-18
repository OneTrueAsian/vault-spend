// VS-31 step 3: four Dashboard links open the page on the tab that holds what the card was about, and the
// sidebar still opens each page on its first tab afterwards.
//   View Cash Flow → (Top merchants)        -> Cash Flow, "Look at one month"
//   Open payoff planner → (Debt payoff)      -> Cash Flow, "Debt payoff"
//   View Investments → (Allocation)          -> Investments, "Mix and targets"
//   View Reports → (Net worth by member)     -> Reports, "Tags and people"
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
day = datetime.date.today().replace(day=1).isoformat()
cur.execute("INSERT INTO family_members(id,name) VALUES (1,'Sam')")
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('L Checking','checking','5000.00')")
checking = cur.lastrowid
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('L Student loan','loan','4000.00')")
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('L Brokerage','investment','0')")
brokerage = cur.lastrowid
cur.execute("INSERT INTO holdings(account_id,symbol,name,shares,price,cost_basis,asset_class) VALUES (?,'VTI','Total market',10,250.00,2000.00,'US Stocks')", (brokerage,))
for i, (description, amount, category) in enumerate([('L Grocer', '-120.00', 'Groceries'), ('L Cafe', '-30.00', 'Dining Out')]):
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,'user',?)", (checking, day, description, amount, category, f"l-{i}"))
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const invoke = (command, args = {}) => b.executeAsync((command, args, done) => {
  window.__TAURI_INTERNALS__.invoke(command, args).then(value => done({ ok: value }), e => done({ error: String(e) }));
}, command, args);
const nav = async label => { await (await b.$(`.nav-item[aria-label="${label}"]`)).click(); };
const selected = id => b.execute(i => document.getElementById(i)?.getAttribute("aria-selected") === "true", id);
const link = text => b.$(`//*[contains(@class,'clickable-row')][.//*[contains(normalize-space(.),'${text}')]]`);
try {
  await b.setWindowSize(1440, 1200);
  // Pin the four cards the links live on. The layout is saved per profile, so write it and reload.
  const generation = (await invoke("get_current_generation")).ok;
  const wrote = await invoke("set_profile_ui_state", { key: "dashboard_layout", value: JSON.stringify(["stat_net_worth", "top_merchants", "debt_payoff", "allocation", "net_worth_by_member"]), expectedGeneration: generation });
  assert.equal(wrote.error, undefined, "the test layout saves: " + JSON.stringify(wrote));
  await b.refresh();
  await (await b.$('[data-widget-id="top_merchants"]')).waitForExist({ timeout: 20000 });

  const cases = [
    ["View Cash Flow", "cashflow-tab-one-month", "Cash Flow", "cashflow-tab-forecast"],
    ["Open payoff planner", "cashflow-tab-debt", "Cash Flow", "cashflow-tab-forecast"],
    ["View Investments", "investments-tab-mix", "Investments", "investments-tab-holdings"],
    ["View Reports", "reports-tab-people", "Reports", "reports-tab-income"],
  ];
  for (const [label, tabId, page, firstTabId] of cases) {
    await nav("Dashboard");
    const row = await link(label);
    await row.waitForExist({ timeout: 20000, timeoutMsg: `Dashboard shows "${label}"` });
    await row.scrollIntoView({ block: "center" });
    await row.click();
    await waitUntilOrDiagnose(b, () => selected(tabId), { timeout: 20000, timeoutMsg: `"${label}" opens ${page} on tab ${tabId}` });
    // Leaving and coming back through the sidebar starts on the first tab again.
    await nav("Dashboard");
    await nav(page);
    await waitUntilOrDiagnose(b, () => selected(firstTabId), { timeout: 20000, timeoutMsg: `the sidebar opens ${page} on ${firstTabId} after the link` });
    assert.equal(await selected(tabId), false, `${page} forgot the link's tab`);
  }
  console.log("FEATURE 412 PASSED: the four Dashboard links land on Look at one month, Debt payoff, Mix and targets and Tags and people; the sidebar still opens each page on its first tab.");
} finally { await app.close(); }
