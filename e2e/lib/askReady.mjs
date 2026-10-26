// Test-side submission precondition for the compiled retirement screen matrix.
export async function withAskReady(browser, ask) {
  // An empty question also disables Ask. Wait for the roster's actual readiness,
  // then let the existing question helper type and submit the intended text.
  await (await browser.$('.ledger-qa-card form[aria-busy="false"]')).waitForExist({ timeout: 5000 });
  return ask();
}

/**
 * The keyboard-only way to ask: wait for the live "ready" form (aria-busy="false"), focus the question field in the current page,
 * type the question, then press Enter. Nothing is typed or submitted until the wait resolves, and a failed wait is thrown as is,
 * because the card ignores a submission made while its account list is still loading and no dialog would ever open.
 */
export async function askByKeyboard(browser, question) {
  return withAskReady(browser, async () => {
    await browser.execute(() => { const input = document.querySelector(".ledger-qa-card input"); input.focus(); input.select(); });
    await browser.keys(question);
    await browser.keys("Enter");
  });
}
