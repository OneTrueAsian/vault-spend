// E2E test for opt-in automatic transfer linking and its review report:
//   - Settings > Feature toggles has "Link matching transfers automatically",
//     OFF by default; while it's off nothing is linked for you;
//   - turning it on links the clear-cut pairs already in the ledger (a pair
//     where either side has more than one possible match is left for a
//     person), and says how many;
//   - Transactions then shows "N auto-linked — review": a list of each pair
//     with Unlink and "Looks right" ("Looks right" clears it from the list and
//     keeps the link);
//   - a transaction you add that completes a transfer is linked at once, and
//     the toast says so;
//   - unlinking an auto-link puts the pair back into "possible transfers" and
//     it is NOT auto-linked again by the next transaction that arrives.
//
// Run with: node e2e/feature91_auto_link_transfers.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
def day(back):
    return (today - datetime.timedelta(days=back)).isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '5000.00')")
checking = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('High-Yield Savings', 'savings', '1000.00')")
savings = cur.lastrowid

def tx(acct, back, desc, amount):
    d = day(back)
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, amount, "Savings Goal", "user", f"{acct}|{d}|{desc.lower()}|{amount}"))

# A: one clear-cut pair.
tx(checking, 5, "Move A out", "-500.00")
tx(savings, 5, "Move A in", "500.00")
# B: one outgoing leg, TWO equal deposits in range -> ambiguous, never auto-linked.
tx(checking, 4, "Move B out", "-200.00")
tx(savings, 4, "Deposit B1", "200.00")
tx(savings, 3, "Deposit B2", "200.00")
# C: an outgoing leg whose deposit is added by hand later in the test.
tx(checking, 1, "Move C out", "-75.00")
`);

const app = await launchApp({ dbDir });
const { browser } = app;

async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) {
      await b.click();
      await browser.pause(500);
      return;
    }
  }
  throw new Error(`no nav button "${label}"`);
}
const toastText = async () => (await browser.execute(() => Array.from(document.querySelectorAll(".toast-stack .status")).map((n) => n.textContent).join(" | "))) ?? "";
async function waitForToast(fragment) {
  await browser.waitUntil(async () => (await toastText()).includes(fragment), {
    timeout: 8000,
    timeoutMsg: `expected a toast containing "${fragment}", saw "${await toastText()}"`,
  });
}
/** The text of the button on Transactions whose label contains `fragment`, or null. */
async function ledgerButton(fragment) {
  return browser.execute(
    (frag) => {
      const b = Array.from(document.querySelectorAll("button")).find((el) => el.textContent.includes(frag));
      return b ? b.textContent.replace(/\s+/g, " ").trim() : null;
    },
    fragment,
  );
}
async function clickLedgerButton(fragment) {
  await browser.execute((frag) => Array.from(document.querySelectorAll("button")).find((el) => el.textContent.includes(frag)).click(), fragment);
  await browser.pause(400);
}
async function toggleRow() {
  return browser.execute(() => {
    const row = Array.from(document.querySelectorAll(".feature-toggle-row")).find((r) => r.textContent.includes("Link matching transfers automatically"));
    return row ? { checked: row.querySelector("input").checked, text: row.textContent.replace(/\s+/g, " ").trim() } : null;
  });
}
async function clickToggle() {
  await browser.execute(() => {
    const row = Array.from(document.querySelectorAll(".feature-toggle-row")).find((r) => r.textContent.includes("Link matching transfers automatically"));
    row.querySelector("input").click();
  });
}
async function addTransaction({ account, description, amount, backDays }) {
  await (await browser.$("button*=Add transaction")).click();
  const panel = await browser.$(".modal-panel");
  await panel.waitForExist({ timeout: 8000 });
  for (const sel of await panel.$$("select")) {
    if ((await sel.getText()).includes(account)) await sel.selectByVisibleText(account);
  }
  const d = new Date();
  d.setDate(d.getDate() - backDays);
  const mmddyyyy = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${d.getFullYear()}`;
  await (await panel.$("input[type='date']")).setValue(mmddyyyy);
  await (await panel.$("input[placeholder='e.g. \"Coffee shop\"']")).setValue(description);
  await (await panel.$("input[placeholder='Negative = money out']")).setValue(amount);
  await (await panel.$("button=Add transaction")).click();
  await panel.waitForExist({ timeout: 8000, reverse: true });
}

try {
  await browser.setWindowSize(1440, 1200);
  await browser.pause(1000);

  // --- Off by default: suggestions only ---
  await nav("Settings");
  const before = await toggleRow();
  if (!before) throw new Error("Settings should have a 'Link matching transfers automatically' switch");
  if (before.checked) throw new Error("the switch must be OFF by default");
  await nav("Transactions");
  await browser.waitUntil(async () => (await ledgerButton("possible transfer")) !== null, { timeout: 10000, timeoutMsg: "with the switch off, transfers are only suggested" });
  if ((await ledgerButton("possible transfer")) !== "⇄ 2 possible transfers — review") throw new Error(`expected 2 suggestions (A and B), got "${await ledgerButton("possible transfer")}"`);
  if ((await ledgerButton("auto-linked")) !== null) throw new Error("nothing is auto-linked while the switch is off");

  // --- Turning it on links the clear-cut pair only ---
  await nav("Settings");
  await clickToggle();
  await waitForToast("Linked 1 transfer that was already there");
  if (!(await toggleRow()).checked) throw new Error("the switch should now be on");
  await nav("Transactions");
  await browser.waitUntil(async () => (await ledgerButton("auto-linked")) === "⇄ 1 auto-linked — review", {
    timeout: 10000,
    timeoutMsg: `expected "⇄ 1 auto-linked — review", got "${await ledgerButton("auto-linked")}"`,
  });
  // B is ambiguous (two deposits in range): still only a suggestion.
  if ((await ledgerButton("possible transfer")) !== "⇄ 1 possible transfer — review") {
    throw new Error(`the ambiguous pair should stay a suggestion, got "${await ledgerButton("possible transfer")}"`);
  }

  // --- The review list ---
  await clickLedgerButton("auto-linked");
  const dialog = await browser.$(".modal-panel");
  await dialog.waitForExist({ timeout: 5000 });
  const rows = await browser.execute(() => Array.from(document.querySelectorAll("[data-autolink-row]")).map((r) => r.textContent.replace(/\s+/g, " ").trim()));
  if (rows.length !== 1) throw new Error(`the review list should hold 1 pair, has ${rows.length}`);
  if (!rows[0].includes("Everyday Checking → High-Yield Savings") || !rows[0].includes("$500.00")) throw new Error(`unexpected review row: ${rows[0]}`);

  // "Looks right" clears it from the list and keeps the link.
  await (await browser.$("[data-autolink-ok]")).click();
  await (await browser.$("[data-autolink-empty]")).waitForExist({ timeout: 5000 });
  await (await dialog.$("button=Close")).click();
  await dialog.waitForExist({ timeout: 5000, reverse: true });
  await browser.waitUntil(async () => (await ledgerButton("auto-linked")) === null, { timeout: 5000, timeoutMsg: "a reviewed pair should leave the list (and the button)" });
  // A linked pair shows as ONE row reading "Everyday Checking → High-Yield Savings".
  const linkedRows = await browser.execute(() => Array.from(document.querySelectorAll(".page tr")).filter((r) => r.textContent.includes("Everyday Checking → High-Yield Savings")).length);
  if (linkedRows !== 1) throw new Error(`"Looks right" must keep the link: expected 1 linked row, found ${linkedRows}`);

  // --- A transaction you add that completes a transfer is linked at once ---
  await addTransaction({ account: "High-Yield Savings", description: "Move C in", amount: "75", backDays: 1 });
  await waitForToast("linked it as a transfer automatically");
  await browser.waitUntil(async () => (await ledgerButton("auto-linked")) === "⇄ 1 auto-linked — review", { timeout: 8000, timeoutMsg: "the new automatic link should be listed for review" });

  // --- Unlink: back to a suggestion, and never auto-linked again ---
  await clickLedgerButton("auto-linked");
  await (await browser.$(".modal-panel")).waitForExist({ timeout: 5000 });
  await (await browser.$("[data-autolink-unlink]")).click();
  await (await browser.$("[data-autolink-empty]")).waitForExist({ timeout: 8000 });
  await (await (await browser.$(".modal-panel")).$("button=Close")).click();
  await browser.waitUntil(async () => (await ledgerButton("possible transfer")) === "⇄ 2 possible transfers — review", {
    timeout: 8000,
    timeoutMsg: `the unlinked pair should be suggested again, got "${await ledgerButton("possible transfer")}"`,
  });
  // The next transaction to arrive triggers another automatic pass — it must leave that pair alone.
  await addTransaction({ account: "Everyday Checking", description: "Coffee", amount: "-4.50", backDays: 0 });
  await browser.pause(800);
  if ((await ledgerButton("auto-linked")) !== null) throw new Error("an unlinked pair must not be auto-linked again by the next transaction");
  if ((await ledgerButton("possible transfer")) !== "⇄ 2 possible transfers — review") throw new Error("the unlinked pair should still be suggested for a manual link");

  // --- Switching it off ---
  await nav("Settings");
  await clickToggle();
  await waitForToast("Automatic transfer linking is off");
  if ((await toggleRow()).checked) throw new Error("the switch should be off again");

  console.log("FEATURE 91 E2E TEST PASSED");
} finally {
  await app.close?.();
}
