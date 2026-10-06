// The Add transaction dialog's amount since 1.3.0: a Money out / Money in switch (Charge / Payment
// on a credit card or loan) decides the sign, and the field takes the amount without one.

/** Enters a signed amount the way a person does: types it without its sign, then picks the
 * switch's first option (money out, a charge) for a negative amount or its second (money in, a
 * payment) otherwise. Picks by position, so it works under either pair of labels. `panel` is the
 * dialog's `.modal-panel` (or any element inside the dialog). */
export async function enterTransactionAmount(browser, panel, signed) {
  const text = String(signed).trim();
  const out = text.startsWith("-");
  await (await panel.$("[data-amount-input]")).setValue(out ? text.slice(1) : text.replace(/^\+/, ""));
  const options = await panel.$$('[role="radiogroup"][aria-label="Direction"] [role="radio"]');
  if (options.length !== 2) throw new Error(`expected the Direction switch's two options, found ${options.length}`);
  const option = options[out ? 0 : 1];
  await option.click();
  await browser.waitUntil(async () => (await option.getAttribute("aria-checked")) === "true", {
    timeout: 3000,
    timeoutMsg: `the Direction switch should show ${out ? "money out" : "money in"} chosen`,
  });
}
