// E2E test for Phase 2 item 16 (privacy mode):
//   - the header's "Hide amounts" button covers every dollar figure with ••••
//     on the page you're on AND on pages you open afterwards;
//   - turning it off brings the figures back;
//   - Settings' "also hide when this window isn't in front" hides on blur
//     and restores on focus.
//
// Run with: node e2e/feature72_privacy_mode.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid
for i, (desc, amt) in enumerate((("Kroger", "-84.20"), ("Paycheck", "2400.00"), ("Chipotle", "-13.75"))):
    d = (today - datetime.timedelta(days=i + 1)).isoformat()
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, amt, None, None, f"{acct}|{d}|{desc.lower()}|{amt}"))
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
const pageText = () => browser.execute(() => document.querySelector(".main")?.innerText ?? "");
const hasAmount = (text) => /\$\s?\d/.test(text);

try {
  await browser.setWindowSize(1440, 1000);
  await nav("Accounts");
  await browser.waitUntil(async () => hasAmount(await pageText()), { timeout: 10000, timeoutMsg: "the Accounts page should show a dollar amount" });

  // --- header toggle ----------------------------------------------------
  const toggle = await browser.$("[data-privacy-toggle]");
  await toggle.click();
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.getAttribute("data-privacy"))) === "on", {
    timeout: 5000,
    timeoutMsg: "privacy mode should mark the page",
  });
  await browser.waitUntil(async () => !hasAmount(await pageText()), { timeout: 5000, timeoutMsg: "no dollar amount should remain on the Accounts page" });
  const masked = await pageText();
  if (!masked.includes("••••")) throw new Error(`expected the •••• mask on the page, got:\n${masked}`);
  if ((await toggle.getText()).trim() !== "Show amounts") throw new Error("the button should now offer to show amounts");

  // A page opened while hiding is hidden too.
  await nav("Transactions");
  await browser.$("//td[contains(., 'Kroger')] | //*[contains(text(), 'Kroger')]").waitForExist({ timeout: 10000 });
  await browser.pause(400);
  const ledger = await pageText();
  console.log("Transactions while hidden:", ledger.replace(/\s+/g, " ").slice(0, 200));
  if (hasAmount(ledger)) throw new Error(`Transactions leaks an amount while hidden:\n${ledger}`);

  // Off again: amounts return.
  await toggle.click();
  await browser.waitUntil(async () => hasAmount(await pageText()), { timeout: 5000, timeoutMsg: "amounts should come back when privacy mode is turned off" });
  if ((await browser.execute(() => document.documentElement.getAttribute("data-privacy"))) !== null) throw new Error("the page should no longer be marked");
  if ((await pageText()).includes("••••")) throw new Error("the mask should be gone");

  // --- auto-hide on blur --------------------------------------------------
  await nav("Settings");
  const auto = await browser.$("[data-privacy-autohide]");
  await auto.waitForExist({ timeout: 10000 });
  await auto.click();
  await browser.execute(() => window.dispatchEvent(new Event("focus")));
  await browser.pause(300);
  await nav("Accounts");
  await browser.waitUntil(async () => hasAmount(await pageText()), { timeout: 5000, timeoutMsg: "with the window in front, amounts show" });
  await browser.execute(() => window.dispatchEvent(new Event("blur")));
  await browser.waitUntil(async () => !hasAmount(await pageText()), { timeout: 5000, timeoutMsg: "losing focus should hide amounts" });
  await browser.execute(() => window.dispatchEvent(new Event("focus")));
  await browser.waitUntil(async () => hasAmount(await pageText()), { timeout: 5000, timeoutMsg: "regaining focus should show amounts again" });

  console.log("FEATURE 72 E2E TEST PASSED");
} finally {
  await app.close();
}
