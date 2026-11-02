// Shared steps for the statement-upload specs (feature300-302): opening an account's page, setting the
// statement's dates, uploading a PDF through the stubbed file picker and finishing a review.

import fs from "node:fs";
import path from "node:path";
import { stubFilePicker, waitUntilOrDiagnose } from "../harness.mjs";
import { makeTempDir } from "./tempDir.mjs";

/** Writes a statement PDF to a throwaway folder and returns its path. */
export function writeStatement(name, pdf) {
  const dir = makeTempDir("vaultspend-statements-");
  const file = path.join(dir, name);
  fs.writeFileSync(file, pdf);
  return file;
}

export async function goTo(browser, label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}

/** Opens an account's own page from the Accounts tab. */
export async function openAccountPage(browser, name) {
  await goTo(browser, "Accounts");
  const opener = await browser.$(`//button[@data-account-details and normalize-space()="${name}"]`);
  await opener.waitForExist({ timeout: 10000, timeoutMsg: `Accounts should list ${name}` });
  await opener.click();
  await browser.$("[data-account-detail]").waitForExist({ timeout: 10000, timeoutMsg: "Details should open the account's page" });
}

/** Sets a date field to a canonical ISO date the way a paste does: the box's text, then the event React
 * listens to. Every region's field accepts pasted ISO text; use `typeDate` (lib/dateFields.mjs) to type. */
export async function setDateInput(browser, selector, iso) {
  const input = await browser.$(selector);
  await input.waitForExist({ timeout: 10000 });
  await browser.execute(
    (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    input,
    iso,
  );
}

/** Sets the statement's start and end dates on the account page. */
export async function setStatementDates(browser, start, end) {
  await setDateInput(browser, "[data-statement-period-start]", start);
  await setDateInput(browser, "[data-statement-date]", end);
}

/** Answers the file picker with `file`, then clicks Upload a statement. */
export async function uploadStatement(browser, file, { download = false } = {}) {
  await stubFilePicker(browser, [file]);
  const button = await browser.$(download ? "[data-upload-download]" : "[data-upload-statement]");
  await browser.waitUntil(async () => !(await button.getAttribute("disabled")), {
    timeout: 10000,
    timeoutMsg: "the upload button should be ready once the start date is set",
  });
  await button.click();
}

export async function waitForReview(browser) {
  await browser.$("[data-statement-review]").waitForExist({ timeout: 20000, timeoutMsg: "the statement review should open" });
}

/** The text of the review's difference figure, and whether it reads as balanced. */
export async function differenceState(browser) {
  const el = await browser.$(".modal-panel [data-difference]");
  return { text: (await el.getText()).trim(), balanced: (await el.getAttribute("data-balanced")) === "true" };
}

export async function waitForBalanced(browser) {
  let seen = null;
  await waitUntilOrDiagnose(
    browser,
    async () => {
      seen = await differenceState(browser);
      return seen.balanced;
    },
    { timeout: 10000, timeoutMsg: "the review's difference should reach $0.00", extra: () => seen },
  );
}

/** Waits for a status message containing `text`, and returns the full message. */
export async function waitForNotice(browser, text) {
  let seen = [];
  await waitUntilOrDiagnose(
    browser,
    async () => {
      seen = await browser.execute(() => [...document.querySelectorAll(".status .status-text")].map((n) => n.textContent.trim()));
      return seen.some((t) => t.includes(text));
    },
    { timeout: 20000, timeoutMsg: `a message containing "${text}" should show`, extra: () => seen },
  );
  return seen.find((t) => t.includes(text));
}

export async function finishReview(browser) {
  const finish = await browser.$("[data-statement-finish]");
  await browser.waitUntil(async () => !(await finish.getAttribute("disabled")), {
    timeout: 10000,
    timeoutMsg: `Finish should be ready; the screen says: ${await (await browser.$("[data-finish-reason]")).getText().catch(() => "(no reason shown)")}`,
  });
  await finish.click();
  await browser.waitUntil(async () => !(await (await browser.$("[data-statement-review]")).isExisting()), {
    timeout: 20000,
    timeoutMsg: "the review should close once the statement is finished",
  });
}
