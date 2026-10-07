// Task 13: Add transaction's Money out / Money in switch decides the sign, not a typed minus sign.
// Typing "-25" out of habit with Money out chosen saves -$25.00; "25" with Money in saves $25.00;
// zero is refused; on a credit card the switch reads Charge | Payment. Screenshots of the dialog in
// every style for review.
//
// Run with: npm run e2e -- --spec=276
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, chooseMenuOption, chooseStyle, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const shots = process.env.VS_T13_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), "vault-task13-shots-"));
fs.mkdirSync(shots, { recursive: true });

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Visa', 'credit', '0.00')")
`);
const app = await launchApp({ dbDir });
const browser = app.browser;

const directionLabels = () =>
  browser.execute(() =>
    [...document.querySelectorAll('.modal-panel [role="radiogroup"][aria-label="Direction"] [role="radio"]')].map((b) => ({
      label: b.textContent.trim(),
      checked: b.getAttribute("aria-checked") === "true",
    })),
  );

async function openDialog(accountName) {
  await (await browser.$("button*=Add transaction")).click();
  const panel = await browser.$(".modal-panel");
  await panel.waitForExist({ timeout: 10000 });
  await chooseMenuOption((await panel.$$(".menu-select-toggle"))[0], { label: accountName });
  return panel;
}

async function closeDialog() {
  await (await (await browser.$(".modal-panel")).$("button=Cancel")).click();
  await waitUntilOrDiagnose(browser, async () => !(await browser.$(".modal-panel").isExisting()), { timeoutMsg: "the dialog should close" });
}

/** Adds a transaction, typing `typed` into the amount field as-is and choosing the switch's option
 * at `index` (0 = money out, 1 = money in), then waits for its row and returns the row's text. */
async function add(description, typed, index) {
  const panel = await openDialog("Checking");
  await (await panel.$("input[placeholder='e.g. \"Coffee shop\"']")).setValue(description);
  await (await panel.$("[data-amount-input]")).setValue(typed);
  const option = (await panel.$$('[role="radiogroup"][aria-label="Direction"] [role="radio"]'))[index];
  await option.click();
  await browser.waitUntil(async () => (await option.getAttribute("aria-checked")) === "true", { timeout: 3000, timeoutMsg: "the chosen direction should be checked" });
  await (await panel.$("button=Add transaction")).click();
  await waitUntilOrDiagnose(browser, async () => !(await browser.$(".modal-panel").isExisting()), {
    timeout: 15000,
    timeoutMsg: `the dialog should close once "${description}" is saved`,
  });
  const row = await browser.$(`//table//tr[.//*[contains(normalize-space(.), '${description}')]]`);
  await row.waitForExist({ timeout: 10000 });
  return (await row.getText()).replace(/\s+/g, " ");
}

try {
  await browser.setWindowSize(1280, 900);
  await (await browser.$("button*=Transactions")).click();
  await (await browser.$("button*=Add transaction")).waitForExist({ timeout: 10000 });

  // Defaults and labels: Money out | Money in, Money out chosen; Charge | Payment on the card.
  await openDialog("Checking");
  const checking = await directionLabels();
  if (JSON.stringify(checking) !== JSON.stringify([{ label: "Money out", checked: true }, { label: "Money in", checked: false }])) {
    throw new Error(`Checking should offer Money out (chosen) | Money in, got ${JSON.stringify(checking)}`);
  }
  await chooseMenuOption((await (await browser.$(".modal-panel")).$$(".menu-select-toggle"))[0], { label: "Visa" });
  await waitUntilOrDiagnose(browser, async () => (await directionLabels()).map((o) => o.label).join(" | ") === "Charge | Payment", {
    timeoutMsg: "a credit card account's switch should read Charge | Payment",
  });

  // Zero is refused with a plain message, and nothing is saved.
  const panel = await browser.$(".modal-panel");
  await (await panel.$("input[placeholder='e.g. \"Coffee shop\"']")).setValue("Nothing at all");
  await (await panel.$("[data-amount-input]")).setValue("0");
  await (await panel.$("button=Add transaction")).click();
  await waitUntilOrDiagnose(browser, async () => (await panel.getText()).includes("Enter an amount other than zero."), {
    timeoutMsg: "a zero amount should be refused with a message",
  });
  await closeDialog();

  // A typed minus sign with Money out stays money out; a plain number with Money in is money in.
  const outRow = await add("Habit minus purchase", "-25", 0);
  if (!outRow.includes("-$25.00")) throw new Error(`"-25" with Money out should save -$25.00, got: ${outRow}`);
  const inRow = await add("Refund from store", "25", 1);
  if (!inRow.includes("$25.00") || inRow.includes("-$25.00")) throw new Error(`"25" with Money in should save $25.00, got: ${inRow}`);
  console.log("money out / in saved with the right signs");

  // The dialog in every style, for a person to look at.
  for (const [name, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await chooseStyle(browser, name, palette);
    for (const theme of ["Light", "Dark"]) {
      await browser.execute((t) => [...document.querySelectorAll(".theme-toggle button")].find((b) => b.textContent === t).click(), theme);
      await (await browser.$("button*=Transactions")).click();
      await openDialog(palette === "retro" ? "Visa" : "Checking");
      await browser.pause(300);
      await browser.saveScreenshot(path.join(shots, `${palette}-${theme.toLowerCase()}-add-transaction.png`));
      await closeDialog();
    }
  }
  console.log(`FEATURE 276 E2E TEST PASSED; screenshots in ${shots}`);
} finally {
  await app.close();
}
