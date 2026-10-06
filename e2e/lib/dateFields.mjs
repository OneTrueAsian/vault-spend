// Reading a date field (src/DateField.tsx). Since 1.3.0 (s5) every date field is a real
// <input type="date"> with the date written out over it ("Oct 4, 2026") while it isn't being edited.
// The input keeps the stored "YYYY-MM-DD" value, so `setValue` / `getValue` on it work as before; what a
// person reads is the `.date-field-text` beside it.

import { waitUntilOrDiagnose } from "../harness.mjs";

/** What the date field whose input matches `inputSelector` shows: its written-out text, whether that
 * text is the visible one (the field isn't being edited), and the input's stored value. null when there
 * is no such field. */
export function readDateField(browser, inputSelector) {
  return browser.execute((sel) => {
    const input = document.querySelector(sel);
    const wrapper = input?.closest(".date-field");
    if (!input || !wrapper) return null;
    const text = wrapper.querySelector(".date-field-text");
    return {
      text: text?.textContent ?? null,
      textShown: text ? getComputedStyle(text).visibility === "visible" : false,
      editing: wrapper.classList.contains("date-field-editing"),
      value: input.value,
    };
  }, inputSelector);
}

/** Waits until the date field shows `expected` as its resting text (and not the input's own text). */
export async function waitForDateFieldText(browser, inputSelector, expected, what = inputSelector) {
  let seen = null;
  await waitUntilOrDiagnose(
    browser,
    async () => {
      seen = await readDateField(browser, inputSelector);
      return seen !== null && seen.text === expected && seen.textShown && !seen.editing;
    },
    { timeout: 10000, timeoutMsg: `${what} should read "${expected}"`, extra: () => seen },
  );
}
