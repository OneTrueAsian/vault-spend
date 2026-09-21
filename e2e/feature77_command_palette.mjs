// E2E test for Phase 2 item 13 (command palette + shortcuts):
//   - Ctrl+K opens the palette; typing narrows it; Enter jumps to a screen;
//   - it also finds transactions, accounts and actions ("Hide amounts");
//   - N opens Add transaction, / jumps to the Transactions search box,
//     ? lists the shortcuts — and none of them fire while typing in a field.
//
// Run with: node e2e/feature77_command_palette.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '5000.00')")
checking = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('High-Yield Savings', 'savings', '9000.00')")
for i, (desc, amt, cat) in enumerate((("Kroger Grocery", "-84.20", "Groceries"), ("Chipotle", "-13.75", "Dining Out"))):
    d = (today - datetime.timedelta(days=i + 1)).isoformat()
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (checking, d, desc, amt, cat, "user", f"{checking}|{d}|{desc.lower()}|{amt}"))
cur.execute("INSERT INTO buckets (name, target_amount) VALUES ('Trip Fund', '2000.00')")
`);

const app = await launchApp({ dbDir });
const { browser } = app;
const dialogOpen = () => browser.$("div[role='dialog']").isExisting();
async function pressBody(keys) {
  // Keys go to whatever has focus; make sure that's the page, not a field.
  await browser.execute(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await browser.keys(keys);
}
async function openPalette() {
  await pressBody(["Control", "k"]);
  await browser.$("[data-palette-input]").waitForExist({ timeout: 5000, timeoutMsg: "Ctrl+K should open the palette" });
}
async function typeInPalette(text) {
  const input = await browser.$("[data-palette-input]");
  await input.setValue(text);
  await browser.pause(150);
}
async function firstOption() {
  const option = await browser.$("[data-palette-option][aria-selected='true']");
  await option.waitForExist({ timeout: 5000 });
  return option;
}
async function h1() {
  return (await (await browser.$("h1.view-title")).getText()).trim();
}

try {
  await browser.setWindowSize(1440, 1100);
  await (await browser.$(".brand-word")).waitForExist({ timeout: 10000 });

  // --- open, browse, jump to a screen ----------------------------------------
  await openPalette();
  await browser.waitUntil(async () => (await browser.$$("[data-palette-option]")).length > 5, { timeout: 5000, timeoutMsg: "with no query the palette offers screens and actions" });
  if (await browser.$("[data-palette-option^='txn:']").isExisting()) throw new Error("individual transactions stay out of the empty palette");
  await typeInPalette("budg");
  const first = await firstOption();
  if ((await first.getAttribute("data-palette-option")) !== "tab:budget") throw new Error(`Budget should rank first for "budg", got ${await first.getAttribute("data-palette-option")}`);
  await browser.keys("Enter");
  await browser.waitUntil(async () => !(await dialogOpen()), { timeout: 5000 });
  await browser.waitUntil(async () => (await h1()) === "Budget", { timeout: 10000, timeoutMsg: "Enter should open the Budget screen" });

  // --- N, ? -------------------------------------------------------------------
  await pressBody("n");
  await browser.$("//div[@role='dialog']//h2[normalize-space()='Add transaction']").waitForExist({ timeout: 5000, timeoutMsg: "N should open Add transaction" });
  await browser.keys("Escape");
  await browser.waitUntil(async () => !(await dialogOpen()), { timeout: 5000 });
  await pressBody("?");
  await browser.$("[data-shortcuts]").waitForExist({ timeout: 5000, timeoutMsg: "? should list the shortcuts" });
  await browser.keys("Escape");
  await browser.waitUntil(async () => !(await dialogOpen()), { timeout: 5000 });

  // --- find a transaction -------------------------------------------------------
  await openPalette();
  await typeInPalette("kroger");
  const txnOption = await browser.$("[data-palette-option^='txn:']");
  await txnOption.waitForExist({ timeout: 5000, timeoutMsg: "the palette should find the Kroger transaction" });
  if (!(await txnOption.getText()).includes("Kroger Grocery")) throw new Error("the result should name the transaction");
  // getText() reads the full string even when CSS has ellipsized it down to a
  // letter or two, so also check the name actually fits in its column.
  const clipped = await browser.execute((el) => {
    const label = el.querySelector(".palette-label");
    return label.scrollWidth > label.clientWidth + 1;
  }, txnOption);
  if (clipped) throw new Error("the transaction's name is cut off in the palette result");
  await browser.keys("Enter");
  await browser.waitUntil(async () => (await h1()) === "Transactions", { timeout: 10000 });
  const search = await browser.$("input[aria-label='Search description']");
  if ((await search.getValue()) !== "Kroger Grocery") throw new Error(`the search box should hold the description, has "${await search.getValue()}"`);
  const ledger = await browser.$(".ledger").getText();
  if (!ledger.includes("Kroger Grocery") || ledger.includes("Chipotle")) throw new Error(`only the Kroger row should show:\n${ledger}`);

  // --- typing in a field never triggers a shortcut ------------------------------
  await search.click();
  await browser.keys("n");
  await browser.pause(300);
  if (await dialogOpen()) throw new Error("typing N into the search box must not open Add transaction");

  // --- / from another screen ----------------------------------------------------
  await openPalette();
  await typeInPalette("dash");
  await browser.keys("Enter");
  await browser.waitUntil(async () => (await h1()) === "Vault Spend" || (await h1()) === "Dashboard", { timeout: 10000 }).catch(() => {});
  await pressBody("/");
  await browser.waitUntil(async () => (await h1()) === "Transactions", { timeout: 10000, timeoutMsg: "/ should jump to Transactions" });
  await browser.waitUntil(async () => (await browser.execute(() => document.activeElement?.getAttribute("aria-label"))) === "Search description", {
    timeout: 5000,
    timeoutMsg: "/ should put the cursor in the search box",
  });

  // --- accounts and goals -------------------------------------------------------
  await openPalette();
  await typeInPalette("savings");
  if (!(await (await firstOption()).getAttribute("data-palette-option")).startsWith("account:")) throw new Error("the savings account should be found");
  await browser.keys("Enter");
  await browser.$("[data-account-detail]").waitForExist({ timeout: 10000, timeoutMsg: "an account result should open that account's page" });
  await openPalette();
  await typeInPalette("trip");
  if (!(await (await firstOption()).getAttribute("data-palette-option")).startsWith("goal:")) throw new Error("the Trip Fund goal should be found");
  await browser.keys("Enter");
  await browser.waitUntil(async () => (await h1()) === "Goals", { timeout: 10000 });

  // --- an action -----------------------------------------------------------------
  await openPalette();
  await typeInPalette("hide amounts");
  if ((await (await firstOption()).getAttribute("data-palette-option")) !== "action:privacy") throw new Error("Hide amounts should be found");
  await browser.keys("Enter");
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.getAttribute("data-privacy"))) === "on", {
    timeout: 5000,
    timeoutMsg: "the action should switch privacy mode on",
  });

  // --- nothing matches -----------------------------------------------------------
  await openPalette();
  await typeInPalette("zzzzqq");
  await browser.$("[data-palette-empty]").waitForExist({ timeout: 5000, timeoutMsg: "a query with no match should say so" });

  console.log("FEATURE 77 E2E TEST PASSED");
} finally {
  await app.close();
}
