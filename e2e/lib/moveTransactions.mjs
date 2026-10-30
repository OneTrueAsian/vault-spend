// Shared pieces for the "Move to account" desktop specs (feature374 to feature377): a disposable fixture, reading
// the data back through the app's own commands and the database file, and the dialog's selectors.
//
// Fixture rules that follow from the approved checkpoint restriction: the app rolls every account's balance
// forward once a month, to the end of the previous month, and a row dated on or before that day cannot be moved.
// The fixture therefore records that carry-forward itself (so the app does not make its own at launch) and dates
// its movable rows on the first of this month or today, which are after it and never in the future.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { seedFixture } from "./seed.mjs";
import { isoDaysFromNow, monthFromNow } from "./dates.mjs";

const now = new Date();
export const FIRST = `${monthFromNow(0)}-01`;
export const TODAY = isoDaysFromNow(0);
/** The day the carry-forward is dated: the last day of last month. */
export const LAST_MONTH_END = isoDaysFromNow(-now.getDate());
/** A day before the carry-forward, so a row dated then cannot be moved. */
export const OLD_DAY = isoDaysFromNow(-now.getDate() - 5);
export const PERIOD = monthFromNow(0);

/** Python for the fixture's accounts, carry-forward and rows. `extra` runs after it with `cur` and `acct` (name -> id). */
/** `legacyCarryForward: false` leaves out the carry-forward, so the app records its own (with what it counted) at launch. */
export function moveFixturePython(extra = "", { legacyCarryForward = true } = {}) {
  return `
import json
acct = {}
for name, kind, start, hidden in [
    ("Checking", "checking", "1000.00", 0), ("Savings", "savings", "500.00", 0), ("Visa", "credit", "2000.00", 0),
    ("Mortgage", "loan", "100000.00", 0), ("Brokerage", "investment", "0.00", 0), ("Old Account", "checking", "0.00", 1),
]:
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance, hidden) VALUES (?, ?, ?, ?)", (name, kind, start, hidden))
    acct[name] = cur.lastrowid
    if ${legacyCarryForward ? "True" : "False"}:
        cur.execute("INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?, ?, ?, ?)", (acct[name], "${PERIOD}", "${LAST_MONTH_END}", start))
cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis) VALUES (?, 'VTI', 'Total market', '10', '250.00', '2000.00')", (acct["Brokerage"],))

def add(account, date, desc, amount, category="Groceries", cleared=0):
    key = f"{acct[account]}|{date}|{desc.strip().lower()}|{amount}"
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, category_source, confidence, fingerprint, cleared) VALUES (?, ?, ?, ?, ?, 'user', 0.9, ?, ?)",
        (acct[account], date, desc, amount, category, key, cleared),
    )
    return cur.lastrowid

${extra}
`;
}

export async function seedMoveFixture(extra = "", options = {}) {
  return seedFixture(moveFixturePython(extra, options));
}

export function makeInvoke(browser) {
  return async (command, args = {}) => {
    const r = await browser.executeAsync(
      (command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then((ok) => done({ ok }), (e) => done({ error: String(e) })),
      command,
      args,
    );
    if (r.error) throw new Error(`${command}: ${r.error}`);
    return r.ok;
  };
}

/** Runs a SQLite query against the disposable database file (read-only use) and returns the rows as arrays. */
export function sqlRows(dbDir, sql) {
  const script = `import sqlite3, json
con = sqlite3.connect(r"${path.join(dbDir, "vaultspend.db").replace(/\\/g, "\\\\")}")
print(json.dumps([list(r) for r in con.execute(${JSON.stringify(sql)}).fetchall()]))`;
  return JSON.parse(execFileSync("python", ["-c", script]).toString());
}

export const sel = {
  dialog: "[data-move-dialog]",
  confirm: "[data-move-confirm]",
  notice: "[data-move-notice]",
  blockersTitle: "#move-blockers-title",
  bar: ".bulk-actions-bar",
  moveTrigger: 'button[aria-label="Move to account"]',
};

/** Ticks the row whose description cell contains `description`. */
export async function tickRow(browser, description) {
  const box = await browser.$(`//tr[.//td[contains(.,'${description}')]]//input[@type='checkbox']`);
  await box.waitForExist({ timeout: 10000 });
  await box.click();
}

/** Chooses a destination in the selection bar's Move to account menu, opening the review. */
export async function chooseMoveDestination(browser, name) {
  await (await browser.$(sel.moveTrigger)).click();
  const item = await browser.$(`//button[@role='menuitemradio'][starts-with(normalize-space(.), '${name}')]`);
  await item.waitForClickable({ timeout: 5000 });
  await item.click();
  await browser.$(sel.dialog).waitForExist({ timeout: 10000, timeoutMsg: "the move review should open" });
}

export async function waitForReview(browser) {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const dialog = document.querySelector("[data-move-dialog]");
        if (!dialog || dialog.querySelector("[data-move-loading]")) return false;
        return Boolean(dialog.querySelector("#move-blockers-title, [data-move-error], [data-move-summary], [data-move-already-there], [data-move-balances]"));
      }),
    { timeout: 15000, timeoutMsg: "the review should finish loading" },
  );
}

export const dialogText = (browser) => browser.execute(() => document.querySelector("[data-move-dialog]")?.textContent ?? "");
export const pageText = (browser) => browser.execute(() => document.body.textContent ?? "");

export async function openTransactions(browser) {
  await (await browser.$("button*=Transactions")).click();
  await browser.$("table.ledger").waitForExist({ timeout: 15000 });
}
