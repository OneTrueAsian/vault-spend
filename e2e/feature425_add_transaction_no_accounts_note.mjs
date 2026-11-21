// VS-49: in a profile with no accounts, Add transaction is greyed out with "Add an account first, on the Accounts page."
// The note must read as a sentence (at most two lines) and the buttons must keep their one-line shape, in every style.
// The 1.3.5 UAT found the note squeezed into a five-line column with both buttons stretched tall.
// Run with: node e2e/feature425_add_transaction_no_accounts_note.mjs

import assert from "node:assert/strict";
import { launchApp, chooseStyle } from "./harness.mjs";
import { footerLayout } from "./lib/notesPartialMonthRowProblems.mjs";

const app = await launchApp();
const b = app.browser;
try {
  await b.setWindowSize(1280, 900);
  for (const [style, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await chooseStyle(b, style, palette);
    await (await b.$('.nav-item[aria-label="Transactions"]')).click();
    await (await b.$("button*=Add transaction")).click();
    const note = await b.$("[data-transaction-missing]");
    await note.waitForExist({ timeout: 10000 });
    await b.waitUntil(async () => (await b.execute(() => document.querySelector("[data-transaction-missing]")?.textContent)) === "Add an account first, on the Accounts page.", { timeout: 5000, timeoutMsg: "the note names what is missing" });
    assert.equal(await (await b.$("//div[contains(@class,'modal-actions')]//button[normalize-space()='Add transaction']")).isEnabled(), false);
    const layout = await footerLayout(b, "[data-transaction-missing]");
    assert.ok(layout.noteLines <= 2, `${style}: the note reads as a sentence, not a narrow column: ${JSON.stringify(layout)}`);
    assert.ok(layout.buttonLines.every(n => n === 1) && layout.buttonsTogether, `${style}: the buttons stay on one row, each on one line: ${JSON.stringify(layout)}`);
    assert.ok(layout.buttonHeights.every(h => h <= 48), `${style}: the buttons keep their normal height, not stretched to the note: ${JSON.stringify(layout)}`);
    await b.keys("Escape");
    await note.waitForExist({ reverse: true, timeout: 5000 });
  }
  console.log("FEATURE 425 PASSED: with no accounts, Add transaction's note reads as a sentence beside one-line buttons in Default, Futuristic and Retro.");
} finally { await app.close(); }
