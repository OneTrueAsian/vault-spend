// E2E test for Phase 2 item 3 (import review inbox):
//   - Transactions shows "Review inbox (N)" while anything needs a look —
//     uncategorized rows (with a suggested category drawn from the merchant's
//     history), shaky auto-categorizations, possible duplicates, and unusually
//     large charges;
//   - the inbox is keyboard-driven: Enter accepts, X deletes a duplicate;
//   - "Looks right" dismisses a large/duplicate flag for good, so the count
//     reaches zero and the button disappears.
// (The native file picker can't be driven, so this opens the inbox from its
// button rather than straight after an import; both paths share the dialog.)
//
// Run with: node e2e/feature76_import_inbox.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
def ago(days):
    return (today - datetime.timedelta(days=days)).isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid

def tx(days, desc, amount, category=None, source=None, confidence=None):
    d = ago(days)
    fp = f"{acct}|{d}|{desc.lower()}|{amount}"
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, confidence, fingerprint) VALUES (?,?,?,?,?,?,?,?)",
                (acct, d, desc, amount, category, source, confidence, fp))

# History the suggestions and the "large" baseline come from.
for days in (40, 30, 20):
    tx(days, "Starbucks Store 55", "-6.50", "Dining Out", "user")
tx(25, "Kroger 445", "-80.00", "Groceries", "user")
tx(15, "Kroger 445", "-70.00", "Groceries", "user")

tx(8, "Mystery Vendor", "-40.00")                                # uncategorized, no history
tx(1, "STARBUCKS #77 SEATTLE", "-7.25")                          # uncategorized, suggestion: Dining Out
tx(2, "Local Bakery", "-12.00", "Dining Out", "classifier", 0.5) # shaky guess
tx(3, "Ferry Banquet", "-150.00", "Dining Out", "user")          # unusually large for Dining Out
tx(5, "Netflix", "-15.49", "Subscriptions", "user")              # a possible duplicate pair
tx(4, "Netflix", "-15.49", "Subscriptions", "user")
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
const row = (description) => browser.$(`//div[@data-inbox-row][.//span[contains(@class,'inbox-desc')][normalize-space()='${description}']]`);
async function stateOf(description) {
  return (await row(description)).getAttribute("data-inbox-state");
}
// Make a row the active one without touching any of its buttons or its dropdown, and put keyboard focus on the list.
async function activate(description) {
  const target = (await row(description)).$(".inbox-main");
  await (await target).click();
  await browser.execute(() => document.querySelector("[data-inbox-list]").focus());
}
async function focusList() {
  await browser.execute(() => document.querySelector("[data-inbox-list]").focus());
}
async function activeDescription() {
  const active = await browser.$("[data-inbox-active='true']");
  return (await (await active.$(".inbox-desc")).getText()).trim();
}

try {
  await browser.setWindowSize(1440, 1200);
  await nav("Transactions");
  const open = await browser.$("[data-inbox-open]");
  await open.waitForExist({ timeout: 10000, timeoutMsg: "the Review inbox button should show while things need a look" });
  console.log("button:", await open.getText());
  if (!(await open.getText()).includes("(6)")) throw new Error(`expected 6 items (2 uncategorized, 1 shaky, 2 duplicates, 1 large), got: ${await open.getText()}`);
  await open.click();

  const list = await browser.$("[data-inbox-list]");
  await list.waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => (await list.getText()).trim() !== "", { timeout: 5000 });
  if ((await browser.$$("[data-inbox-row]")).length !== 6) throw new Error("the inbox should list 6 rows");

  // Suggestion from the merchant's history.
  const starbucks = await row("STARBUCKS #77 SEATTLE");
  const suggestionEl = await starbucks.$("[data-inbox-suggestion]");
  // The dialog animates in, so text reads as empty for the first frames.
  await browser.waitUntil(async () => (await suggestionEl.getText()).trim() !== "", { timeout: 5000, timeoutMsg: "the suggestion never showed text" });
  const suggestion = await suggestionEl.getText();
  console.log("suggestion:", suggestion);
  if (!suggestion.includes("Dining Out") || !suggestion.includes("3 similar")) throw new Error(`unexpected suggestion: ${suggestion}`);
  const mystery = await row("Mystery Vendor");
  if (await mystery.$("[data-inbox-suggestion]").isExisting()) throw new Error("a merchant with no history gets no suggestion");

  // Uncategorized rows come first; the newest (Starbucks) is active. Enter accepts its suggestion.
  if ((await activeDescription()) !== "STARBUCKS #77 SEATTLE") throw new Error(`the first row should be active, got ${await activeDescription()}`);
  await focusList();
  await browser.keys("Enter");
  await browser.waitUntil(async () => (await stateOf("STARBUCKS #77 SEATTLE")) === "done", { timeout: 10000, timeoutMsg: "Enter should accept the suggested category" });
  if (!(await (await (await row("STARBUCKS #77 SEATTLE")).$("[data-inbox-done]")).getText()).includes("Set to Dining Out")) throw new Error("the row should say what it was set to");

  // Focus moved on to Mystery Vendor. Pick a category by hand, then accept.
  if ((await activeDescription()) !== "Mystery Vendor") throw new Error(`focus should move on to Mystery Vendor, got ${await activeDescription()}`);
  await (await (await row("Mystery Vendor")).$("select")).selectByVisibleText("Groceries");
  await (await (await row("Mystery Vendor")).$("[data-inbox-accept]")).click();
  await browser.waitUntil(async () => (await stateOf("Mystery Vendor")) === "done", { timeout: 10000 });

  // The shaky guess: Enter confirms the category it already has.
  await activate("Local Bakery");
  await browser.keys("Enter");
  await browser.waitUntil(async () => (await stateOf("Local Bakery")) === "done", { timeout: 10000, timeoutMsg: "Enter should confirm the guessed category" });

  // Duplicates: the first Netflix row gets deleted with X, the second is kept.
  const netflixRows = await browser.$$("//div[@data-inbox-row][.//span[contains(@class,'inbox-desc')][normalize-space()='Netflix']]");
  if (netflixRows.length !== 2) throw new Error(`both halves of the duplicate pair should be listed, got ${netflixRows.length}`);
  await (await netflixRows[0].$(".inbox-main")).click();
  await focusList();
  await browser.keys("x");
  await browser.waitUntil(async () => (await netflixRows[0].getAttribute("data-inbox-state")) === "done", { timeout: 10000, timeoutMsg: "X should delete the duplicate" });
  if (!(await (await netflixRows[0].$("[data-inbox-done]")).getText()).includes("Deleted")) throw new Error("the first Netflix row should say Deleted");
  await (await netflixRows[1].$(".inbox-main")).click();
  await focusList();
  await browser.keys("Enter");
  await browser.waitUntil(async () => (await netflixRows[1].getAttribute("data-inbox-state")) === "done", { timeout: 10000 });

  // The large charge: Looks right.
  await (await (await row("Ferry Banquet")).$("[data-inbox-keep]")).click();
  await browser.waitUntil(async () => (await stateOf("Ferry Banquet")) === "done", { timeout: 10000 });

  const summary = await (await browser.$("[data-inbox-summary]")).getText();
  if (!summary.includes("All 6 reviewed")) throw new Error(`the summary should say everything is reviewed, got: ${summary}`);
  await (await browser.$("[data-inbox-close]")).click();
  await browser.waitUntil(async () => !(await browser.$("div[role='dialog']").isExisting()), { timeout: 10000 });

  // Persisted: the fixes stuck, the duplicate is gone, and nothing is left to review.
  await browser.waitUntil(async () => !(await browser.$("[data-inbox-open]").isExisting()), {
    timeout: 10000,
    timeoutMsg: "with everything handled (and the flags dismissed) the Review inbox button should disappear",
  });
  const ledger = await browser.$(".ledger").getText();
  const netflixCount = (ledger.match(/Netflix/g) ?? []).length;
  if (netflixCount !== 1) throw new Error(`exactly one Netflix row should remain, found ${netflixCount}`);

  console.log("FEATURE 76 E2E TEST PASSED");
} finally {
  await app.close();
}
