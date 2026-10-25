// Waiting for an Ask the Vault dialog to open after a question is submitted. When it never opens, the bare wait only says it timed out, which cannot tell a
// question that was never submitted (the form still busy, the field damaged) from one the app answered differently. This reports the page as it was at that moment.

/** The Ask card as the page shows it right now, as JSON text: whether the form is busy, each button's disabled state, the typed question, the dialog and the card text. */
export async function describeAskState(browser) {
  const state = await browser.execute(() => ({
    busy: document.querySelector(".ledger-qa-card form")?.getAttribute("aria-busy") ?? null,
    buttons: [...document.querySelectorAll(".ledger-qa-card button")].map(b => `${b.textContent.trim()}:${b.disabled ? "disabled" : "enabled"}`),
    value: document.querySelector(".ledger-qa-card input")?.value ?? null,
    dialog: document.querySelector("[role='dialog']")?.innerText?.slice(0, 400) ?? null,
    card: document.querySelector(".ledger-qa-card")?.innerText?.slice(0, 400) ?? null,
  }));
  return JSON.stringify(state);
}

/**
 * Waits, with the same condition and limit as a plain waitUntil, for the dialog to say `fragment`. A timeout is rethrown with the caller's message first
 * and the page state after it, the original timeout kept as the cause. Reading the page can itself fail (a lost session); that is reported, never swallowed into a pass.
 */
export async function waitForAskDialog(browser, fragment, { timeout = 8000, timeoutMsg } = {}) {
  try {
    await browser.waitUntil(async () => {
      const dialog = await browser.$("[role='dialog']");
      return (await dialog.isExisting()) && (await dialog.getText()).includes(fragment);
    }, { timeout });
  } catch (error) {
    const state = await describeAskState(browser).catch(failure => `page state unavailable: ${failure.message}`);
    throw new Error(`${timeoutMsg ?? `the dialog should say "${fragment}"`}\n${state}`, { cause: error });
  }
}
