// UAT-203 Settings > Feature toggles: each toggle's documented effect appears and disappears (SettingsView.tsx descriptions):
//   Apply to Debt -> "Apply to a debt" in a transaction's menu; Split purchases -> "Split"; Envelope Caps -> "Warn at 90%" in a budget line's menu; Rollover unspent -> "Roll over unspent" in a budget line's menu.
//   (Link matching transfers is feature91, Safe to spend is feature143, Rollover's saved choice is feature86.) Turning one off and on again keeps the setting.
// UAT-204 sidebar below 1000px: icons only with the name in the accessible label and a hover/focus title, and "Show names" opens the full sidebar over the page and "Hide names" puts it back.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose, openSettingsGroup } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth, monthFromNow } from "./lib/dates.mjs";
import { budgetRowMenuItems, budgetRowXpath } from "./lib/budgetRows.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('QQ Checking', 'checking', '1000.00')")
a = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('QQ Card', 'credit', '300.00')")
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)", (a, "${dateInMonth(0, 1)}", "QQ Shop", "-12.00", "Groceries", "user", f"{a}|qqshop"))
cur.execute("INSERT INTO budgets (category,period,monthly_amount,budget_group) VALUES ('Groceries',?,'400.00','flexible')", ("${monthFromNow(0)}",))
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", ("${monthFromNow(0)}",))
`);
const app = await launchApp({ dbDir });
const { browser: b } = app;
const nav = async label => { await (await b.$(`.nav-item[aria-label="${label}"]`)).click(); };
const toggle = key => b.$(`[data-feature-toggle='${key}'] input`);
const setToggle = async (key, on) => {
  await nav("Settings");
  await openSettingsGroup(b, "features");
  const box = await toggle(key); await box.waitForExist({ timeout: 10000 });
  if ((await box.isSelected()) !== on) await box.click();
  await waitUntilOrDiagnose(b, async () => (await (await toggle(key)).isSelected()) === on, { timeout: 5000, timeoutMsg: `${key} reads ${on ? "on" : "off"}` });
};
const txMenuItems = async () => {
  await nav("Transactions");
  const row = await b.$('//tr[@data-payment-row][contains(.,"QQ Shop")]'); await row.waitForExist({ timeout: 10000 });
  await (await row.$("[data-row-menu]")).click();
  const items = await b.execute(() => [...document.querySelectorAll(".row-menu-panel [role=menuitem]")].map(x => x.textContent.trim()));
  await b.keys("Escape");
  return items;
};
const budgetItems = async () => {
  await nav("Budget");
  await (await b.$(budgetRowXpath("Groceries"))).waitForExist({ timeout: 10000 });
  return (await budgetRowMenuItems(b, "Groceries")).map(x => x.label);
};
try {
  await b.setWindowSize(1280, 1000);
  // --- UAT-203 --------------------------------------------------------------------------------------------------------------------------------------------------------------
  await setToggle("apply_to_debt_enabled", true); await setToggle("split_purchases_enabled", true);
  let items = await txMenuItems();
  assert.ok(items.includes("Apply to a debt") && items.includes("Split"), "both on: " + items);
  await setToggle("apply_to_debt_enabled", false);
  items = await txMenuItems();
  assert.ok(!items.includes("Apply to a debt") && items.includes("Split"), "Apply to Debt off hides only its item: " + items);
  await setToggle("split_purchases_enabled", false);
  items = await txMenuItems();
  assert.ok(!items.includes("Split") && !items.includes("Apply to a debt"), "Split off hides Split: " + items);
  await setToggle("apply_to_debt_enabled", true); await setToggle("split_purchases_enabled", true);
  items = await txMenuItems();
  assert.ok(items.includes("Apply to a debt") && items.includes("Split"), "turning them back on restores both: " + items);

  await setToggle("envelope_caps_enabled", true); await setToggle("rollover_enabled", true);
  let bItems = await budgetItems();
  assert.ok(bItems.some(x => /Warn at 90%/.test(x)) && bItems.some(x => /Roll over unspent|Rolls over/.test(x)), "both on: " + JSON.stringify(bItems));
  await setToggle("envelope_caps_enabled", false);
  bItems = await budgetItems();
  assert.ok(!bItems.some(x => /Warn at 90%/.test(x)) && bItems.some(x => /Roll over unspent|Rolls over/.test(x)), "Envelope Caps off hides only its item: " + JSON.stringify(bItems));
  await setToggle("rollover_enabled", false);
  bItems = await budgetItems();
  assert.ok(!bItems.some(x => /Roll over unspent|Rolls over/.test(x)), "Rollover off hides its item: " + JSON.stringify(bItems));
  await setToggle("envelope_caps_enabled", true); await setToggle("rollover_enabled", true);
  bItems = await budgetItems();
  assert.ok(bItems.some(x => /Warn at 90%/.test(x)) && bItems.some(x => /Roll over unspent|Rolls over/.test(x)), "turning them back on restores both: " + JSON.stringify(bItems));

  // --- UAT-204 --------------------------------------------------------------------------------------------------------------------------------------------------------------
  await b.setWindowSize(900, 1000);
  await waitUntilOrDiagnose(b, async () => (await b.execute(() => Math.round(document.querySelector('.nav-item[aria-label="Settings"]').getBoundingClientRect().width))) <= 60, { timeout: 10000, timeoutMsg: "below 1000px the sidebar becomes an icon rail", extra: () => b.execute(() => [window.innerWidth, Math.round(document.querySelector('.nav-item[aria-label="Settings"]').getBoundingClientRect().width)]) });
  const rail = await b.execute(() => [...document.querySelectorAll(".nav-item")].map(x => ({ label: x.getAttribute("aria-label"), title: x.getAttribute("title"), text: [...x.querySelectorAll("*")].filter(el => el.children.length === 0 && el.textContent.trim() && el.getBoundingClientRect().width > 2 && el.getBoundingClientRect().height > 2 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).opacity !== "0").map(el => el.textContent.trim()).join(""), w: Math.round(x.getBoundingClientRect().width) })));
  assert.ok(rail.length >= 8, "every page has a button: " + rail.length);
  for (const r of rail) { assert.ok(r.label, "each icon button has its name as the accessible label"); assert.equal(r.text, "", `no visible text on ${r.label} in the icon rail`); assert.ok(r.w <= 60, `${r.label} is an icon-sized button (${r.w}px)`); }
  assert.ok(rail.every(r => r.title === r.label || r.title === null || r.title === ""), "any hover title matches the name: " + JSON.stringify(rail.slice(0, 3)));
  const showNames = () => b.$('button[aria-label="Show names"]');
  await (await showNames()).click();
  await waitUntilOrDiagnose(b, async () => (await b.execute(() => [...document.querySelectorAll(".nav-item")].some(x => [...x.querySelectorAll("*")].some(el => el.children.length === 0 && el.textContent.trim() && el.getBoundingClientRect().width > 2 && getComputedStyle(el).visibility !== "hidden")))), { timeout: 5000, timeoutMsg: "Show names reveals the page names" });
  const expanded = await b.execute(() => ({ names: [...document.querySelectorAll(".nav-item")].map(x => [...x.querySelectorAll("*")].filter(el => el.children.length === 0 && el.textContent.trim() && el.getBoundingClientRect().width > 2).map(el => el.textContent.trim()).join("")), scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  assert.ok(expanded.names.includes("Settings") && expanded.names.includes("Transactions"), JSON.stringify(expanded.names));
  assert.ok(expanded.scroll <= 1, "the full sidebar opens over the page without sideways scroll: " + expanded.scroll);
  await (await b.$('button[aria-label="Hide names"]')).click();
  await waitUntilOrDiagnose(b, async () => !(await b.execute(() => [...document.querySelectorAll(".nav-item")].some(x => [...x.querySelectorAll("*")].some(el => el.children.length === 0 && el.textContent.trim() && el.getBoundingClientRect().width > 2 && getComputedStyle(el).visibility !== "hidden")))), { timeout: 5000, timeoutMsg: "Hide names puts the icon rail back" });
  // Names by keyboard: the rail's buttons take focus and are named for a screen reader.
  await (await b.$('.nav-item[aria-label="Budget"]')).click();
  assert.equal(await b.execute(() => document.activeElement?.getAttribute("aria-label") ?? null), "Budget", "a focused icon button is named");
  console.log("FEATURE 360 PASSED: Apply to Debt, Split purchases, Envelope Caps and Rollover unspent show and hide their menu items; the narrow sidebar is icon-only with names in labels and Show/Hide names works.");
} finally { await app.close(); }
