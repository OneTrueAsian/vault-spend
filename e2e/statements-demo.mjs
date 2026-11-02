// `npm run demo:statements` — opens the REAL compiled app on small practice accounts, with fictional
// statement PDFs to upload against them, for trying statement reconciling by hand. The accounts and the
// files are rebuilt from scratch on every run, relative to today, in `.demo-statements/` (gitignored)
// through the same VAULTSPEND_DB_DIR switch the e2e suite uses — never your real data.
//
// Usage:
//   npm run demo:statements             # rebuild the data and the files, launch the app
//   npm run demo:statements -- --keep   # relaunch on the existing data (keeps your changes)
//   npm run demo:statements -- --seed   # rebuild the data and the files only, do not launch
//
// The PDFs land in `.demo-statements/files/`, with a `README.txt` listing each file's start and end dates
// (type those into the account page) and what to expect.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedFixtureInto } from "./lib/seed.mjs";
import { dateInMonth, displayDate } from "./lib/dates.mjs";
import { buildPdf, checkingStatement, unknownBankStatement, unknownBrokerageStatement } from "./lib/statementPdf.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(repoRoot); // seed.mjs resolves target/debug/init_db.exe relative to cwd

const exe = path.join(repoRoot, "target", "debug", "vaultspend.exe");
const demoDir = path.join(repoRoot, ".demo-statements");
const filesDir = path.join(demoDir, "files");
const args = new Set(process.argv.slice(2));

if (!fs.existsSync(exe)) {
  console.error("Build the app first: npx tauri build --debug --no-bundle");
  process.exit(1);
}

const aStart = dateInMonth(-2, 1);
const aEnd = dateInMonth(-2, 28);
const bStart = dateInMonth(-1, 1);
const bEnd = dateInMonth(-1, 28);
const day = (offset, d) => dateInMonth(offset, d);

if (!args.has("--keep") || !fs.existsSync(path.join(demoDir, "vaultspend.db"))) {
  fs.rmSync(demoDir, { recursive: true, force: true });
  fs.mkdirSync(filesDir, { recursive: true });
  console.log("Seeding practice accounts (relative to today)...");
  await seedFixtureInto(
    demoDir,
    `
def tx(acct, d, desc, amt):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, amt, None, None, f"{acct}|{d}|{desc.lower()}|{amt}"))

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '1000.00')")
everyday = cur.lastrowid
tx(everyday, "${day(-2, 5)}", "Coffee Shop", "-50.00")
tx(everyday, "${day(-2, 12)}", "Gas Station", "-30.00")

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Riverbend Checking', 'checking', '0.00')")

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Corner Credit Union', 'checking', '0.00')")

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Harborview Brokerage', 'investment', '0.00')")
broker = cur.lastrowid
tx(broker, "${day(-2, 2)}", "Deposit from bank", "1000.00")
cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?, 'QQQZ', 'NASDAQ TRACKER FUND', 10, 300.25, 3000.00, 'US Stocks')", (broker,))

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Rewards Card', 'credit', '0.00')")
card = cur.lastrowid
tx(card, "${day(-2, 6)}", "Grocery Market", "-64.10")
tx(card, "${day(-2, 14)}", "Streaming Service", "-12.99")
tx(card, "${day(-2, 21)}", "Fuel Stop", "-38.40")
`,
  );

  const write = (name, pdf) => fs.writeFileSync(path.join(filesDir, name), pdf);

  // Everyday Checking: a statement the app reads by itself. Month A has one line the app lacks (the salary);
  // the gas stop is in the app but not on the statement. Month B picks up where A ended.
  const northA = checkingStatement({
    start: aStart,
    end: aEnd,
    opening: 1000,
    rows: [
      { date: day(-2, 5), description: "Coffee Shop", amount: -50 },
      { date: day(-2, 20), description: "Salary Deposit", amount: 200 },
    ],
  });
  const northB = checkingStatement({ start: bStart, end: bEnd, opening: northA.closing, rows: [{ date: day(-1, 10), description: "Hardware Store", amount: -75 }] });
  write("1-northwind-month-1.pdf", northA.pdf);
  write("2-northwind-month-2.pdf", northB.pdf);

  // Riverbend Checking: a bank the app has never seen (day-first dates, money out printed without a sign).
  const riverA = unknownBankStatement({
    start: aStart,
    end: aEnd,
    opening: 1250,
    rows: [
      { date: day(-2, 3), description: "Supermarket purchase", amount: -54.2 },
      { date: day(-2, 5), description: "Salary EXAMPLE EMPLOYER", amount: 2000 },
      { date: day(-2, 12), description: "Electricity bill", amount: -120.35 },
    ],
  });
  const riverB = unknownBankStatement({
    start: bStart,
    end: bEnd,
    opening: riverA.closing,
    rows: [
      { date: day(-1, 4), description: "Pharmacy", amount: -18.45 },
      { date: day(-1, 20), description: "Transfer received", amount: 75 },
    ],
  });
  write("3-riverbend-month-1.pdf", riverA.pdf);
  write("4-riverbend-month-2.pdf", riverB.pdf);

  // Harborview Brokerage: cash activity plus share counts (the app holds 10 shares of QQQZ; the statement says 10.5).
  const holdings = [
    { symbol: "QQQZ", name: "NASDAQ TRACKER FUND", quantity: 10.5, price: 300.25 },
    { symbol: "VTIZ", name: "TOTAL MARKET FUND", quantity: 4, price: 250.1 },
  ];
  const harborA = unknownBrokerageStatement({
    start: aStart,
    end: aEnd,
    beginningCash: 500,
    holdings,
    rows: [
      { date: day(-2, 2), description: "Deposit from bank", amount: 1000 },
      { date: day(-2, 9), description: "Bought QQQZ 1.0000 at $300.10", amount: -300.1 },
      { date: day(-2, 20), description: "Dividend VTIZ", amount: 12.5 },
    ],
  });
  const harborB = unknownBrokerageStatement({
    start: bStart,
    end: bEnd,
    beginningCash: harborA.endingCash,
    holdings,
    rows: [{ date: day(-1, 15), description: "Dividend VTIZ", amount: 12.5 }],
  });
  write("5-harborview-month-1.pdf", harborA.pdf);
  write("6-harborview-month-2.pdf", harborB.pdf);

  // A picture of a statement: no text to read.
  write("7-picture-only.pdf", buildPdf([[]]));

  // Corner Credit Union: transaction downloads (CSV) whose column names the app doesn't know. Import them
  // with "Import transactions" into Corner Credit Union to try the "Match your columns" window.
  const csv = (header, rows) => [header, ...rows.map(([d, desc, amt]) => `${d},${desc},${amt}`), ""].join("\n");
  const cornerRows = (offset) => [
    [day(offset, 3), "Corner Cafe", "-12.50"],
    [day(offset, 4), "Bravo Market", "-40.00"],
    [day(offset, 5), "Employer Payroll", "1500.00"],
  ];
  write("8-corner-download-unfamiliar-headers.csv", csv("Posted,Memo,Amt", cornerRows(-1)));
  write("9-corner-download-same-headers.csv", csv("Posted,Memo,Amt", [[day(0, 2), "Hardware Outlet", "-23.10"]]));
  write("10-corner-download-renamed-header.csv", csv("Posted,Details,Amt", [[day(0, 3), "Garden Centre", "-18.75"]]));

  const range = (start, end) => `${displayDate(start)} to ${displayDate(end)} (type these into the account page as the statement's start and end dates: ${start} and ${end})`;
  fs.writeFileSync(
    path.join(filesDir, "README.txt"),
    [
      "Practice statements for Vault Spend. Every name, bank and amount is made up.",
      "",
      `Month 1 dates: ${range(aStart, aEnd)}`,
      `Month 2 dates: ${range(bStart, bEnd)}`,
      "",
      "1-northwind-month-1.pdf  Everyday Checking, month 1. The app reads it by itself. The salary line isn't in the app yet (it starts as Add); the gas stop is in the app but not on the statement.",
      "2-northwind-month-2.pdf  Everyday Checking, month 2. Recognized from month 1; no starting balance is asked.",
      "3-riverbend-month-1.pdf  Riverbend Checking, month 1. A bank the app has never seen: it asks to be shown where things are.",
      "4-riverbend-month-2.pdf  Riverbend Checking, month 2. Read without any help.",
      "5-harborview-month-1.pdf Harborview Brokerage, month 1. Cash activity plus share counts (QQQZ differs, VTIZ is new).",
      "6-harborview-month-2.pdf Harborview Brokerage, month 2. Recognized; holdings read without help.",
      "7-picture-only.pdf       A picture of a statement: the app says it can't read it.",
      "",
      "Transaction downloads (CSV) for Corner Credit Union, to try \"Match your columns\" (use Import transactions, not Upload a statement):",
      "8-corner-download-unfamiliar-headers.csv  Columns Posted, Memo, Amt that the app doesn't know: it asks which is which, then remembers.",
      "9-corner-download-same-headers.csv        Same headers as file 8: imports without asking.",
      "10-corner-download-renamed-header.csv     Memo is now called Details: it asks again, with the date and amount already picked.",
      "",
    ].join("\n"),
  );
}

console.log(`\nPractice statements are in ${filesDir}`);
if (args.has("--seed")) process.exit(0);

console.log(`Launching Vault Spend on the practice data in ${demoDir}\n`);
const child = spawn(exe, [], { detached: true, stdio: "ignore", env: { ...process.env, VAULTSPEND_DB_DIR: demoDir } });
child.unref();
console.log("Vault Spend is open. This is throwaway practice data. Re-run `npm run demo:statements` any time for a fresh copy.\n");
