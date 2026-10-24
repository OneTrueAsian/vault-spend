// Test-side submission precondition for the compiled retirement screen matrix.
export async function withAskReady(browser, ask) {
  // An empty question also disables Ask. Wait for the roster's actual readiness,
  // then let the existing question helper type and submit the intended text.
  await (await browser.$('.ledger-qa-card form[aria-busy="false"]')).waitForExist({ timeout: 5000 });
  return ask();
}
