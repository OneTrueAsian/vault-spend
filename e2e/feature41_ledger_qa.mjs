// E2E test for the Dashboard's "Ask the Vault" box: template-matched
// natural-language questions answered entirely from local data (no hosted
// LLM call — see src/ledgerQa.ts). The bulk of the engine's logic (period
// parsing, fuzzy matching, every intent) has its own fast unit tests in
// src/ledgerQa.test.ts — this spec exists to confirm the real UI actually
// wires the box up to it correctly (props threaded through from App.tsx,
// including buckets/recurring which the unit tests supply directly but a
// wiring mistake here wouldn't catch), not to re-verify the logic itself.
//
// Run with: node e2e/feature41_ledger_qa.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '3000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Dining Out')")
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, '2026-07-05', 'Sushi Place', -60.00, 'Dining Out', 'fp1')",
    (checking_id,),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, '2026-07-12', 'Pizza Night', -35.00, 'Dining Out', 'fp2')",
    (checking_id,),
)
cur.execute("INSERT INTO buckets (name, target_amount, color) VALUES ('Vacation Fund', '2000.00', '#8A5FB0')")
vacation_id = cur.lastrowid
cur.execute("INSERT INTO bucket_contributions (bucket_id, date, amount) VALUES (?, '2026-08-01', '500.00')", (vacation_id,))
`);

async function ask(app, question) {
  const input = await app.browser.$(".ledger-qa-card input");
  await input.setValue(question);
  const qaCard = await app.browser.$(".ledger-qa-card");
  const askButton = await qaCard.$("button=Ask");
  await askButton.click();
  const answer = await app.browser.$(".ledger-qa-answer");
  await answer.waitForExist({ timeout: 5000 });
  return answer.getText();
}

const app = await launchApp({ dbDir });
try {
  const spendAnswer = await ask(app, "how much did I spend on dining out in July");
  console.log("spend question:", spendAnswer);
  if (!spendAnswer.includes("$95.00") || !spendAnswer.includes("Dining Out")) {
    throw new Error(`expected the answer to mention Dining Out and $95.00 (60+35), got "${spendAnswer}"`);
  }

  // New in the primitive-query-engine pass — confirms `resolveSpendQuery`/
  // `runQuery` are wired through the real UI, not just unit-tested.
  const avgAnswer = await ask(app, "what's my average spend on dining out in July");
  console.log("average spend question:", avgAnswer);
  if (!avgAnswer.includes("$47.50") || !avgAnswer.includes("Dining Out")) {
    throw new Error(`expected the average to mention Dining Out and $47.50 ((60+35)/2), got "${avgAnswer}"`);
  }

  const runwayAnswer = await ask(app, "what's my runway if rent goes up by $200");
  console.log("runway question:", runwayAnswer);
  if (!runwayAnswer.includes("runway is") || !runwayAnswer.includes("drop to")) {
    throw new Error(`expected a before/after runway comparison, got "${runwayAnswer}"`);
  }

  // Bucket-progress needs `buckets` threaded into the QaContext from
  // App.tsx — the one prop this wiring check exists to catch a regression in.
  const bucketAnswer = await ask(app, "how much have I saved toward vacation");
  console.log("bucket question:", bucketAnswer);
  if (!bucketAnswer.includes("Vacation Fund") || !bucketAnswer.includes("$500.00")) {
    throw new Error(`expected the bucket answer to mention Vacation Fund and $500.00, got "${bucketAnswer}"`);
  }

  const unmatchedAnswer = await ask(app, "who let the dogs out");
  console.log("unmatched question:", unmatchedAnswer);
  if (!unmatchedAnswer.includes("Try something like")) {
    throw new Error(`expected the graceful fallback for an unmatched question, got "${unmatchedAnswer}"`);
  }
  const unmatchedClass = await (await app.browser.$(".ledger-qa-answer")).getAttribute("class");
  if (!unmatchedClass.includes("ledger-qa-answer-unmatched")) {
    throw new Error(`expected the unmatched answer to carry the unmatched styling class, got "${unmatchedClass}"`);
  }

  console.log("FEATURE 41 E2E TEST PASSED");
} finally {
  await app.close();
}
