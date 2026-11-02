// Reading and filling a date or month field (src/DateField.tsx, src/MonthField.tsx).
// Since 1.3.3 every date and month field is a text box in the region's own order ("10/04/2026",
// "04/10/2026", "2026/10/04") with an app-drawn calendar beside it; no native date control is involved.
// While a field isn't being edited the date is written out ("Oct 4, 2026") over the box.
//
// The box's own text is regional, so a spec never reads the stored date from `input.value`: the wrapper
// carries it as `data-value` ("YYYY-MM-DD" or "YYYY-MM"), the same way a MenuSelect's trigger carries its
// value. A spec fills a field by typing a canonical ISO date, which every region accepts, or by choosing
// in the calendar with the helpers below.

import { waitUntilOrDiagnose } from "../harness.mjs";

/** What the date field whose box matches `inputSelector` shows: its written-out text, whether that text
 * is the visible one (the field isn't being edited), the box's own text, and the stored ISO value. null
 * when there is no such field. */
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
      boxText: input.value,
      value: wrapper.getAttribute("data-value"),
    };
  }, inputSelector);
}

/** The stored value ("YYYY-MM-DD" / "YYYY-MM", or "") of the field whose box matches `inputSelector`. */
export async function readDateValue(browser, inputSelector) {
  const field = await readDateField(browser, inputSelector);
  if (field === null) throw new Error(`no date field matches ${inputSelector}`);
  return field.value ?? "";
}

/** Waits until the date field shows `expected` as its resting text (and not the box's own text). */
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

/** Waits until the field's stored value is `expected`. */
export async function waitForDateValue(browser, inputSelector, expected, what = inputSelector) {
  let seen = null;
  await waitUntilOrDiagnose(browser, async () => (seen = (await readDateField(browser, inputSelector))?.value ?? null) === expected, {
    timeout: 10000,
    timeoutMsg: `${what} should hold ${expected}`,
    extra: () => seen,
  });
}
