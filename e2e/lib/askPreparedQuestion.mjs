import assert from "node:assert/strict";

const READY_FORM = '.ledger-qa-card form[aria-busy="false"]';
const waitReady = async b => (await b.$(READY_FORM)).waitForExist({ timeout: 5000 });

// Types the question into the current Ask card and submits it once the card is ready. The card ignores a submission made while it is
// still getting ready (AskVaultCard.tsx), so readiness is awaited before typing and again after, and the field is looked up afresh
// each time because a reload can replace the card.
export async function askPreparedQuestion(b, question) {
  await waitReady(b);
  for (let attempt = 1; ; attempt++) {
    const input = await b.$(".ledger-qa-card input");
    await input.click();
    await b.execute(el => { el.select(); }, input);
    await input.setValue(question);
    await waitReady(b);
    const held = await (await b.$(".ledger-qa-card input")).getValue();
    if (held === question) break;
    // The field must hold exactly what was meant (see lib/askRetirement.mjs): damaged text would look like a product refusal. A mismatch is typed again and printed.
    console.log(`[feature304] the field held "${held}" instead of the question (attempt ${attempt}); typing it again`);
    assert.ok(attempt < 3, `the question could not be typed intact: "${held}"`);
  }
  await (await b.$(".ledger-qa-card button[type=submit]")).click();
}
