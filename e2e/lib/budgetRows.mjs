// Reading and driving one category row on the Budget page. Since 1.3.0 (s2) a row's figures sit
// under column headings with no words after them, the budget is a typed field (an <input>, whose
// value isn't part of the row's text) and the row's settings live in its ⋯ menu.

import { withFocusRetry } from "../harness.mjs";

/** The xpath of `category`'s row. */
export const budgetRowXpath = (category) =>
  `//div[contains(concat(' ', normalize-space(@class), ' '), ' cat-row ')][.//span[contains(@class,'category-link')][normalize-space()='${category}']]`;

/** The row's ⋯ settings button, as a trigger for `chooseRowAction`. */
export const budgetRowMenu = (browser, category) => async () => (await browser.$(budgetRowXpath(category))).$("[data-row-menu]");

/** Opens `category`'s ⋯ menu, reads its items as `{ label, checked, disabled }` (`checked` is
 * null for a plain action), and closes it again with Escape. Through `withFocusRetry`, since the
 * menu closes if another window takes focus while it's open. With `withDividers`, each divider is
 * in the list too, in its place, as `{ divider: true }`. */
export async function budgetRowMenuItems(browser, category, { withDividers = false } = {}) {
  const read = () =>
    browser.execute(() => {
      const panel = document.querySelector(".row-menu-panel");
      if (!panel) return [];
      return [...panel.children].map((b) =>
        b.getAttribute("role") === "separator"
          ? { divider: true }
          : {
              label: b.textContent.trim(),
              checked: b.hasAttribute("aria-checked") ? b.getAttribute("aria-checked") === "true" : null,
              disabled: b.getAttribute("aria-disabled") === "true",
            },
      );
    });
  let items = [];
  await withFocusRetry(browser, async () => {
    if ((await read()).length === 0) await (await budgetRowMenu(browser, category)()).click();
    await browser.waitUntil(async () => (items = await read()).length > 0, {
      timeout: 3000,
      timeoutMsg: `${category}'s ⋯ menu never opened`,
    });
  });
  await browser.keys("Escape");
  await browser.waitUntil(async () => (await read()).length === 0, { timeout: 3000, timeoutMsg: `${category}'s ⋯ menu never closed` });
  return withDividers ? items : items.filter((item) => !item.divider);
}

/** Why a menu read with `withDividers` has a misplaced divider (first, last, or two in a row), or
 * null when it has none. */
export function strayDivider(items) {
  if (items[0]?.divider) return "starts with a divider";
  if (items.at(-1)?.divider) return "ends with a divider";
  if (items.some((item, i) => item.divider && items[i + 1]?.divider)) return "has two dividers in a row";
  return null;
}

/** `{ budget, hasInput, spent, left, text }` for `category`'s row, or null while it isn't on the
 * page. `budget` is the field's value ("400.00"), or the cell's text while amounts are hidden. */
export function readBudgetRow(browser, category) {
  return browser.execute((name) => {
    const row = [...document.querySelectorAll(".cat-row")].find((r) => r.querySelector(".category-link")?.textContent.trim() === name);
    if (!row) return null;
    const cells = [...row.querySelectorAll(".cat-amt")];
    const input = cells[0]?.querySelector("input");
    return {
      budget: input ? input.value : (cells[0]?.textContent.trim() ?? ""),
      hasInput: Boolean(input),
      spent: cells[1]?.textContent.trim() ?? "",
      left: cells[2]?.textContent.trim() ?? "",
      text: row.textContent.replace(/\s+/g, " ").trim(),
    };
  }, category);
}

/** Waits until `category`'s row satisfies `test(row)`, and returns that row. On a timeout the
 * message carries the last row it read. */
export async function waitForBudgetRow(browser, category, test, { timeout = 10000, timeoutMsg = `${category}'s budget row never matched` } = {}) {
  let last = null;
  try {
    await browser.waitUntil(
      async () => {
        last = await readBudgetRow(browser, category);
        return last !== null && Boolean(test(last));
      },
      { timeout },
    );
  } catch {
    throw new Error(`${timeoutMsg}; last read: ${JSON.stringify(last)}`);
  }
  return last;
}
