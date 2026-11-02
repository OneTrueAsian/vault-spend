// E2E smoke test for the Investments tab's "Add holding" form — a real
// coverage gap until now (no existing test actually creates a holding
// through the UI). Doubles as verification that switching the form to
// labeled fields (each input now has a visible <label>, not just a
// placeholder) didn't break value binding or submission.
//
// All field lookups are scoped to this specific <form> (found via the
// Symbol field's ancestor) rather than the whole page — the Goal
// Projection calculator directly above this form on the same tab also
// uses "0.00" placeholders (Starting balance, Monthly contribution), so
// an unscoped query silently grabs the wrong input.
//
// Run with: node e2e/feature29_add_holding.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Brokerage', 'investment', '0.00')")
`);

const app = await launchApp({ dbDir });
try {
  const investmentsNav = await app.browser.$("button*=Investments");
  await investmentsNav.click();

  const addHoldingBtn = await app.browser.$("button*=Add holding");
  await addHoldingBtn.waitForExist({ timeout: 10000 });
  await addHoldingBtn.click();

  const form = await app.browser.$("//form[.//input[@placeholder='e.g. AAPL']]");
  await form.waitForExist({ timeout: 10000 });

  const symbolInput = await form.$("input[placeholder='e.g. AAPL']");
  await symbolInput.setValue("AAPL");
  const sharesInput = await form.$("input[placeholder='0']");
  await sharesInput.setValue("10");
  const formZeroInputs = await form.$$("input[placeholder='0.00']");
  if (formZeroInputs.length !== 2) {
    throw new Error(`expected exactly 2 "0.00"-placeholder inputs within the Add holding form (Price, Cost basis), got ${formZeroInputs.length}`);
  }
  const [priceInput, costBasisInput] = formZeroInputs;
  await priceInput.setValue("150.00");
  await costBasisInput.setValue("1400.00");

  await app.browser.waitUntil(
    async () =>
      (await symbolInput.getValue()) === "AAPL" &&
      (await sharesInput.getValue()) === "10" &&
      (await priceInput.getValue()) === "150.00" &&
      (await costBasisInput.getValue()) === "1400.00",
    { timeout: 5000, timeoutMsg: "expected all four fields to hold their typed values before submitting" },
  );

  const saveBtn = await form.$("button=Save");
  await saveBtn.click();

  const investmentsPage = await app.browser.$(".page");
  await app.browser.waitUntil(
    async () => (await investmentsPage.getText()).includes("AAPL"),
    { timeout: 10000, timeoutMsg: "expected the new AAPL holding to appear on the Investments tab" },
  );
  const pageText = await investmentsPage.getText();
  console.log("investments page after adding a holding:", pageText);
  if (!pageText.includes("$1,500.00")) {
    throw new Error(`expected the holding's value (10 shares * $150.00) to show as $1,500.00, got:\n${pageText}`);
  }

  console.log("FEATURE 29 E2E TEST PASSED");
} finally {
  await app.close();
}
