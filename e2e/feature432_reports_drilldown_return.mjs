// VS-98: Reports -> Transactions and back. A Categories by month row opens its transactions for the report's exact
// range; "Back to Reports" (pressed with the keyboard) restores the tab and range and puts focus on the row; opening
// Reports from the sidebar still starts fresh (first tab, Last 6 months); the Uncategorized row lists the uncategorized rows.
// Fixture: Groceries 2 and 8 months back (in Last 12 months) and 14 months back (out of it), plus one uncategorized row.
// Run with: node e2e/feature432_reports_drilldown_return.mjs [--keep-screens]
import assert from "node:assert/strict";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose, withFocusRetry } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";
import { displayDate, isoDaysFromNow } from "./lib/dates.mjs";
import { readDateValue } from "./lib/dateFields.mjs";

const dbDir = await seedFixture(`
import datetime
today=datetime.date.today()
def first(back):
    y,m=today.year,today.month-back
    while m<=0:
        m+=12; y-=1
    return datetime.date(y,m,1)
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Checking','checking','1000.00')")
acct=cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories(name) VALUES('Groceries')")
for back,desc in [(2,'Grocery Two'),(8,'Grocery Eight'),(14,'Grocery Old')]:
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,'-50.00','Groceries','user',?)",(acct,first(back).isoformat(),desc,f'g{back}'))
cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,'Mystery Spend','-20.00',NULL,'user','mystery')",(acct,first(1).isoformat()))
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const shots = makeTempDir("vaultspend-vs98-shots-");

const now = new Date();
const first = new Date(now.getFullYear(), now.getMonth() - 11, 1);
const FROM = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-01`;
const TO = isoDaysFromNow(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate());
const RANGE_KEY = `${FROM.slice(0, 7)}..${TO.slice(0, 7)}`;

const nav = label => b.execute(l => document.querySelector(`.nav-item[aria-label="${l}"]`).click(), label);
const ledgerRows = () => b.execute(() => [...document.querySelectorAll(".ledger-table-scroll tbody tr")].map(tr => tr.textContent));
const reportState = () => b.execute(() => ({
  range: document.querySelector("[data-reports-hub]")?.getAttribute("data-report-range") ?? null,
  active: document.querySelector("[data-range-preset].view-toggle-active")?.getAttribute("data-range-preset") ?? null,
  tab: document.querySelector("[data-reports-tab][aria-selected='true']")?.getAttribute("data-reports-tab") ?? null,
  focus: document.activeElement?.getAttribute("data-report-category-open") ?? null,
}));
const openCategoriesTab = async () => {
  await (await b.$("[data-reports-tab='categories']")).click();
  await (await b.$("[data-report-table]")).waitForDisplayed({ timeout: 10000 });
};

try {
  await b.setWindowSize(1280, 900);
  await nav("Reports");
  await (await b.$("[data-range-preset='last_12']")).click();
  await waitUntilOrDiagnose(b, async () => (await reportState()).range === RANGE_KEY, { timeoutMsg: `Reports shows the Last 12 months range ${RANGE_KEY}` });
  await openCategoriesTab();

  // Groceries row -> its transactions for the exact range.
  await (await b.$("[data-report-category-open='Groceries']")).click();
  await waitUntilOrDiagnose(b, async () => (await b.$("[data-report-return]")).isDisplayed(), { timeoutMsg: "Transactions shows the opened-from-Reports banner" });
  const bannerText = await (await b.$("[data-report-return]")).getText();
  assert.ok(bannerText.includes(displayDate(FROM)) && bannerText.includes(displayDate(TO)) && bannerText.includes("Groceries"), `the banner names the category and both dates: ${bannerText}`);
  await (await b.$("button*=More filters")).click();
  await (await b.$('input[aria-label="From date"]')).waitForExist({ timeout: 5000 });
  assert.equal(await readDateValue(b, 'input[aria-label="From date"]'), FROM, "the From date is the range's first day");
  assert.equal(await readDateValue(b, 'input[aria-label="To date"]'), TO, "the To date is the range's last day");
  await waitUntilOrDiagnose(b, async () => {
    const rows = await ledgerRows();
    return rows.length === 2 && rows.some(r => r.includes("Grocery Two")) && rows.some(r => r.includes("Grocery Eight")) && !rows.some(r => r.includes("Grocery Old"));
  }, { timeoutMsg: "the ledger lists the two Groceries rows inside the range and not the old one", extra: async () => JSON.stringify(await ledgerRows()) });
  await b.keys("Escape");
  await b.saveScreenshot(path.join(shots, "ledger-banner.png"));

  // Changing a filter drops the sentence (it would no longer be true) but keeps the Back button.
  await (await b.$('input[aria-label="Search description"]')).setValue("Two");
  await waitUntilOrDiagnose(b, async () => !(await (await b.$("[data-report-return]")).getText()).includes("Showing"), { timeoutMsg: "the banner stops saying what is shown once the search changes" });
  assert.equal(await (await b.$("[data-report-return-back]")).isDisplayed(), true, "the Back button stays");
  await (await b.$('input[aria-label="Search description"]')).setValue("");

  // Back with the keyboard.
  await withFocusRetry(b, async () => {
    await b.execute(() => document.querySelector("[data-report-return-back]").focus());
    await b.keys("Enter");
    await waitUntilOrDiagnose(b, async () => (await reportState()).range !== null, { timeoutMsg: "Back to Reports opens Reports" });
  });
  await waitUntilOrDiagnose(b, async () => {
    const s = await reportState();
    return s.range === RANGE_KEY && s.active === "last_12" && s.tab === "categories" && s.focus === "Groceries";
  }, { timeoutMsg: "Back restores Last 12 months, Categories by month and focus on Groceries", extra: async () => JSON.stringify(await reportState()) });
  await b.saveScreenshot(path.join(shots, "reports-restored.png"));

  // The sidebar still starts fresh.
  await nav("Dashboard");
  await nav("Reports");
  await waitUntilOrDiagnose(b, async () => { const s = await reportState(); return s.active === "last_6" && s.tab === "income"; }, { timeoutMsg: "Reports opened from the sidebar starts on the first tab and Last 6 months", extra: async () => JSON.stringify(await reportState()) });

  // Uncategorized row -> the uncategorized transaction.
  await (await b.$("[data-range-preset='last_12']")).click();
  await openCategoriesTab();
  await (await b.$("[data-report-category-open='Uncategorized']")).click();
  await waitUntilOrDiagnose(b, async () => { const rows = await ledgerRows(); return rows.length === 1 && rows[0].includes("Mystery Spend"); }, { timeoutMsg: "the ledger lists the uncategorized row", extra: async () => JSON.stringify(await ledgerRows()) });
  console.log(`FEATURE 432 PASSED: a Categories by month row opens its transactions for the report's range, Back restores tab, range and focus, the sidebar starts fresh. Screenshots: ${shots}`);
} finally { await app.close(); }
