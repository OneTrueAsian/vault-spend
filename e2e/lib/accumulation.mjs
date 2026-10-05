// Helpers shared by the investment accumulation & projection specs
// (feature92-95): navigating, opening an account's Details page, filling a
// React-controlled field, and an independent re-derivation of the projection
// figures (a closed-form formula, NOT the app's month-by-month loop, so the
// specs check the app's numbers against something that isn't the app).

import { dismissStatusMessages, waitUntilOrDiagnose } from "../harness.mjs";

export async function nav(browser, label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) {
      await b.click();
      await browser.pause(400);
      return;
    }
  }
  throw new Error(`no nav button "${label}"`);
}

/** Accounts tab -> Details of the account with this exact name. Returns its id. */
export async function openDetails(browser, name) {
  await nav(browser, "Accounts");
  // The Accounts tab keeps a Details page open (the sidebar link doesn't close it), so leave it first.
  const back = await browser.$("[data-account-back]");
  if (await back.isExisting()) {
    await back.click();
    await nav(browser, "Accounts");
  }
  let id = null;
  await browser.waitUntil(
    async () => {
      id = await browser.execute((wanted) => {
        const card = [...document.querySelectorAll(".account-card")].find((c) => c.querySelector(".account-name-cell")?.textContent.trim() === wanted);
        return card?.querySelector("[data-account-details]")?.getAttribute("data-account-details") ?? null;
      }, name);
      return id !== null;
    },
    { timeout: 15000, timeoutMsg: `no account card named "${name}" on the Accounts tab` },
  );
  await (await browser.$(`[data-account-details='${id}']`)).click();
  await browser.$(`[data-account-detail='${id}']`).waitForExist({ timeout: 10000 });
  return id;
}

/** Waits for an investment account's accumulation section to finish loading. */
export async function waitForAccumulation(browser, id) {
  await browser.$(`[data-accumulation='${id}']`).waitForExist({ timeout: 15000, timeoutMsg: "the accumulation section should render for an investment account" });
}

/** Sets a controlled input's value the way typing would (works for type=month too). */
export async function setField(browser, selector, value) {
  const el = await browser.$(selector);
  await el.waitForExist({ timeout: 10000, timeoutMsg: `no field ${selector}` });
  await browser.execute(
    (sel, v) => {
      const input = document.querySelector(sel);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    value,
  );
}

export async function text(browser, selector) {
  const el = await browser.$(selector);
  await el.waitForExist({ timeout: 10000, timeoutMsg: `nothing matches ${selector}` });
  return (await el.getText()).trim();
}

export async function value(browser, selector) {
  const el = await browser.$(selector);
  await el.waitForExist({ timeout: 10000, timeoutMsg: `nothing matches ${selector}` });
  return el.getValue();
}

/** 1234.5 -> "$1,234.50", -5 -> "-$5.00" (the app's formatAmount). */
export function money(n) {
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${s}` : `$${s}`;
}

/** "$1,234.50" / "+$1,234.50" / "-$5.00" -> a number. */
export function parseMoney(s) {
  const negative = s.includes("-");
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return negative ? -n : n;
}

/** Balance after `months` months of monthly compounding at `pct` a year with
 * `monthly` added after each month's growth — the closed-form annuity formula. */
export function futureValue(start, monthly, pct, months) {
  const r = pct / 100 / 12;
  if (r === 0) return start + monthly * months;
  const growth = (1 + r) ** months;
  return start * growth + monthly * ((growth - 1) / r);
}

export { monthFromNow } from "./dates.mjs";

/** Clicks Save and waits for the save to finish: the "Saved the plan" message (cleared first, so an
 * earlier save's message can't count) or the form's own error. A fixed pause was not enough under
 * the parallel runner: a later read still saw the figures from before the save. */
export async function saveAndSettle(browser) {
  const outcome = () =>
    browser.execute(() => ({
      saved: [...document.querySelectorAll(".status .status-text")].some((s) => /^Saved the plan for /.test(s.textContent)),
      error: !!document.querySelector("[data-acc-error]"),
    }));
  await dismissStatusMessages(browser);
  await browser.waitUntil(async () => !(await outcome()).saved, { timeout: 5000, timeoutMsg: "the previous save's message should close" });
  await (await browser.$("[data-acc-save]")).click();
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const o = await outcome();
      return o.saved || o.error;
    },
    { timeout: 15000, timeoutMsg: "Save should finish with the saved message or the form's error", extra: outcome },
  );
  // A refusal from the app (not the form's own check) replaces the message after a round trip, and an
  // earlier refusal's message looks the same until then.
  if ((await outcome()).error) await browser.pause(500);
}
