// Filling a date or month field through its visible controls (src/DateField.tsx, src/MonthField.tsx):
// typing into the box and choosing in the app-drawn calendar. Reading a field is lib/dateFields.mjs; this
// file is separate because typing uses the shared keyboard, which makes a spec that imports it exclusive.

/** Types a date into the field the way a person does: click the box, replace its text, type. `text` is
 * usually a canonical ISO date, which every region accepts; pass the region's own text to test that
 * region. The field reports the date as soon as the text is a complete, valid date in range. */
export async function typeDate(browser, inputSelector, text) {
  const box = await browser.$(inputSelector);
  await box.waitForExist({ timeout: 10000 });
  await box.click();
  await browser.keys(["Control", "a"]);
  await browser.keys("Control");
  await browser.keys(["Backspace"]);
  await box.addValue(text);
}

/** Opens the calendar of the field whose box matches `inputSelector`, with its calendar button. */
export async function openCalendar(browser, inputSelector) {
  const trigger = await browser.execute((sel) => document.querySelector(sel)?.closest(".date-field")?.querySelector(".date-field-trigger") ?? null, inputSelector);
  if (!trigger) throw new Error(`no calendar button for ${inputSelector}`);
  await browser.$(trigger).click();
  await browser.$('.calendar-popover[role="dialog"]').waitForExist({ timeout: 5000, timeoutMsg: "the calendar should open" });
}

/** Chooses a date in an open calendar by clicking its day. The calendar must already show that month. */
export async function pickCalendarDay(browser, iso) {
  const day = await browser.$(`.calendar-popover [data-date="${iso}"]`);
  await day.waitForClickable({ timeout: 5000, timeoutMsg: `the calendar should show ${iso}` });
  await day.click();
}
