// The practice files that go with the practice data (see COVERAGE.md): statement PDFs for the statement-file
// accounts, CSV downloads for "Match your columns", a normal bank CSV to import, and a README explaining each.
// Every name, bank and amount is made up. Dates are relative to today, like the practice rows they match.
import fs from "node:fs";
import path from "node:path";
import { dateInMonth, displayDate } from "../dates.mjs";
import { buildPdf, checkingStatement, unknownBankStatement, unknownBrokerageStatement } from "../statementPdf.mjs";

/** Writes every practice file into `filesDir` (created if missing). */
export function writePracticeFiles(filesDir) {
  fs.mkdirSync(filesDir, { recursive: true });
  const aStart = dateInMonth(-2, 1);
  const aEnd = dateInMonth(-2, 28);
  const bStart = dateInMonth(-1, 1);
  const bEnd = dateInMonth(-1, 28);
  const day = (offset, d) => dateInMonth(offset, d);
  const write = (name, pdf) => fs.writeFileSync(path.join(filesDir, name), pdf);

  // Practice Checking: a statement the app reads by itself. Month A has one line the app lacks (the salary);
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
      "1-northwind-month-1.pdf  Practice Checking, month 1. The app reads it by itself. The salary line isn't in the app yet (it starts as Add); the gas stop is in the app but not on the statement.",
      "2-northwind-month-2.pdf  Practice Checking, month 2. Recognized from month 1; no starting balance is asked.",
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

  // A normal download from the household's own bank, with headings the app already knows.
  write("11-joint-checking-download.csv", ["Date,Description,Amount", `${day(0, 1)},Corner Bookshop,-24.99`, `${day(0, 1)},Farmers Market,-31.50`, ""].join("\n"));
  fs.appendFileSync(path.join(filesDir, "README.txt"), "11-joint-checking-download.csv  A normal download for Joint Checking: imports straight away.\n");

  // A small statement to import: a few rows the app has seen before and a few it hasn't, so the review list opens.
  write(
    "12-sample-import.csv",
    [
      "Date,Description,Amount",
      `${day(0, 1)},Kroger,-64.12`,
      `${day(0, 1)},STARBUCKS #2210 BELLEVUE,-7.10`,
      `${day(0, 1)},Zenith Plumbing Services,-185.00`,
      `${day(0, 1)},PAYPAL *WHOLESALER,-46.80`,
      `${day(0, 1)},Ferrywood Coffee,-4.55`,
      `${day(0, 1)},Trader Joe's,-52.30`,
      `${day(0, 1)},Local Thai Kitchen,-33.90`,
      `${day(0, 1)},Amazon Marketplace,-312.00`,
      "",
    ].join("\n"),
  );
  fs.appendFileSync(path.join(filesDir, "README.txt"), "12-sample-import.csv           A small statement for Joint Checking: some rows are recognised, some go to the review list.\n");
}
