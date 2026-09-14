// A broad calculation-correctness QA sweep: one fixture exercising every
// income/expense path touched by this release's fixes at once — the
// Transfer exclusion, the credit/loan-never-income blanket rule, a
// properly linked debt payment (still correctly hidden/excluded), and
// multi-member attribution — cross-checked against Accounts/Cash Flow/
// Budget/Dashboard so a regression in any one of them can't hide behind
// the others agreeing. Every expected number below is hand-computed from
// the raw seed data, not copied from a prior run.
//
// Run with: node e2e/feature52_income_calculation_qa.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

// Expected hand-computed values (account_type in parens):
//   Checking (checking) start 5000.00: +4000 -150 -60 -1000 -500 -300 = 1990 -> current 6990.00
//   HYSA     (savings)  start 0.00:    +1000                          -> current 1000.00
//   Capital One (credit) start 2000.00 (limit): -600 +500 = -100      -> current 1900.00 (owed 100.00)
//   Car Loan (loan) start 10000.00 (owed): +300 (generated payment)   -> current 9700.00 (owed 9700.00)
//
//   monthly income  = 4000.00 (Paycheck only; the $1,000 transfer-in and
//                      the $500 credit card payment are both excluded)
//   monthly expense = 150 + 60 + 600 + 500 + 300 = 1610.00
//                     (the $1,000 transfer-out is excluded; the $300
//                      debt-payment-generated row on Car Loan is excluded)
//   net             = 4000 - 1610 = 2390.00 -> savings rate 2390/4000 = 59.75% -> "60%"
//
//   Household income by person:   Joint 4000.00 (only)
//   Household spending by person: Joint 150+600+500=1250.00, Alex 60+300=360.00
//
//   Total Assets      = 6990 + 1000 = 7990.00
//   Total Liabilities = netWorthContribution(Capital One) + netWorthContribution(Car Loan)
//                      = (1900-2000) + (-9700) = -9800.00 — rendered WITH the
//                      minus sign (a pre-existing app convention: this stat
//                      is the net-worth *contribution* of debt accounts, not
//                      an owed-amount magnitude — the Dashboard's "Debt" tile
//                      uses the same convention. Documented here, not
//                      asserted as correct or incorrect.)
//   Net Worth         = 7990.00 + (-9800.00) = -1810.00
//
//   Budget: Groceries budgeted 400.00, actual = the one Groceries-categorized
//   transaction = 150.00 (the credit card charge is "Shopping", not Groceries)

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today().isoformat()
period = datetime.date.today().strftime("%Y-%m")

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('HYSA', 'savings', '0.00')")
hysa_id = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Capital One', 'credit', '2000.00')")
credit_id = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Car Loan', 'loan', '10000.00')")
loan_id = cur.lastrowid

cur.execute("INSERT INTO family_members (name) VALUES ('Joint')")
joint_id = cur.lastrowid
cur.execute("INSERT INTO family_members (name) VALUES ('Alex')")
alex_id = cur.lastrowid

def txn(account_id, date, desc, amount, category, member_id, fp):
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint, member_id) VALUES (?, ?, ?, ?, ?, 'user', ?, ?)",
        (account_id, date, desc, amount, category, fp, member_id),
    )

txn(checking_id, today, "Paycheck", "4000.00", "Income", joint_id, "fp1")
txn(checking_id, today, "Groceries Run", "-150.00", "Groceries", joint_id, "fp2")
txn(checking_id, today, "Dinner Out", "-60.00", "Dining Out", alex_id, "fp3")
txn(checking_id, today, "Transfer to HYSA", "-1000.00", "Transfer", joint_id, "fp4")
txn(hysa_id, today, "Transfer from Checking", "1000.00", "Transfer", joint_id, "fp5")
txn(credit_id, today, "Amazon Purchase", "-600.00", "Shopping", joint_id, "fp6")
txn(checking_id, today, "WITHDRAWAL CAPITAL ONE", "-500.00", "Credit Card Payment", joint_id, "fp7")
txn(credit_id, today, "CAPITAL ONE ONLINE PYMT", "500.00", "Credit Card Payment", joint_id, "fp8")
txn(checking_id, today, "Auto Loan Payment", "-300.00", "Auto Loan", alex_id, "fp9")
txn(loan_id, today, "Payment applied from: Auto Loan Payment", "300.00", "Auto Loan", alex_id, "fp10")

# Link fp9 (source) -> fp10 (generated) as a proper debt payment, the same
# shape apply_debt_payment itself produces.
cur.execute("SELECT id FROM transactions WHERE fingerprint = 'fp9'")
source_id = cur.fetchone()[0]
cur.execute("SELECT id FROM transactions WHERE fingerprint = 'fp10'")
generated_id = cur.fetchone()[0]
cur.execute(
    "INSERT INTO debt_payments (source_transaction_id, debt_account_id, generated_transaction_id, amount, date) VALUES (?, ?, ?, '300.00', ?)",
    (source_id, loan_id, generated_id, today),
)

cur.execute(
    "INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES ('Groceries', ?, '400.00', 'flexible')",
    (period,),
)
`);

// Word-boundary match on class "stat" — a naive contains(@class,'stat')
// also matches the outer .stats *container* (since "stats" contains the
// substring "stat"), which would silently grab the first stat tile's
// value instead of the one actually asked for.
async function statValue(app, label) {
  const stat = await app.browser.$(
    `//*[contains(concat(' ', normalize-space(@class), ' '), ' stat ')][.//span[text()='${label}']]`,
  );
  return (await stat.$(".stat-value")).getText();
}

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();
  await (await app.browser.$(".stats")).waitForExist({ timeout: 10000 });

  const txCount = await statValue(app, "Transactions");
  if (txCount !== "9") throw new Error(`expected 9 visible transactions, got ${txCount}`);
  const correctedCount = await statValue(app, "Corrected by you");
  if (correctedCount !== "9") throw new Error(`expected 9 "Corrected by you", got ${correctedCount}`);
  const uncategorizedCount = await statValue(app, "Needs a category");
  if (uncategorizedCount !== "0") {
    throw new Error(`expected 0 "Needs a category" (every seeded row has a real category), got ${uncategorizedCount}`);
  }

  const ledgerText = await (await app.browser.$(".page")).getText();
  if (!ledgerText.includes("Car Loan")) throw new Error(`expected the linked payment's "→ Car Loan" badge, got:\n${ledgerText}`);
  if (ledgerText.includes("Payment applied from")) {
    throw new Error("the debt-payment-generated transaction must stay hidden from the Ledger, but its description is visible");
  }
  console.log("Ledger stats and linked/generated debt-payment visibility are correct");

  const householdNav = await app.browser.$("button*=Household");
  await householdNav.click();
  const incomeCard = await app.browser.$("//h2[contains(.,'Income by person')]/parent::div");
  await incomeCard.waitForExist({ timeout: 10000 });
  const incomeText = await incomeCard.getText();
  if (!incomeText.includes("4,000.00")) throw new Error(`expected Joint's $4,000.00 income, got:\n${incomeText}`);
  if (incomeText.includes("Alex")) throw new Error(`Alex has no income this month and must not appear, got:\n${incomeText}`);

  const spendingCard = await app.browser.$("//h2[contains(.,'Spending by person')]/parent::div");
  const spendingText = await spendingCard.getText();
  if (!spendingText.includes("1,250.00")) throw new Error(`expected Joint's $1,250.00 spending, got:\n${spendingText}`);
  if (!spendingText.includes("360.00")) throw new Error(`expected Alex's $360.00 spending, got:\n${spendingText}`);
  console.log("Household income/spending by person are correct");

  const accountsNav = await app.browser.$("button*=Accounts");
  await accountsNav.click();
  await (await app.browser.$(".stats")).waitForExist({ timeout: 10000 });
  const assetsText = await statValue(app, "Total Assets");
  const liabilitiesText = await statValue(app, "Total Liabilities");
  const netWorthText = await statValue(app, "Net Worth");
  if (assetsText !== "$7,990.00") throw new Error(`expected Total Assets $7,990.00, got ${assetsText}`);
  // See the file-level comment: "Total Liabilities" is this app's existing
  // signed net-worth-contribution convention, not an owed-amount magnitude.
  if (liabilitiesText !== "-$9,800.00") throw new Error(`expected Total Liabilities -$9,800.00, got ${liabilitiesText}`);
  if (netWorthText !== "-$1,810.00") throw new Error(`expected Net Worth -$1,810.00, got ${netWorthText}`);
  console.log("Accounts assets/liabilities/net worth are correct");

  const cashFlowNav = await app.browser.$("button*=Cash Flow");
  await cashFlowNav.click();
  const legend = await app.browser.$(".chart-legend");
  await legend.waitForExist({ timeout: 10000 });
  const legendText = await legend.getText();
  if (!legendText.includes("4,000.00")) throw new Error(`expected Cash Flow Income $4,000.00, got:\n${legendText}`);
  if (!legendText.includes("1,610.00")) throw new Error(`expected Cash Flow Expenses $1,610.00, got:\n${legendText}`);
  if (!legendText.includes("2,390.00")) throw new Error(`expected Cash Flow Net $2,390.00, got:\n${legendText}`);
  if (!legendText.includes("60%")) throw new Error(`expected a ~60% savings rate, got:\n${legendText}`);
  console.log("Cash Flow income/expense/savings-rate are correct");

  const budgetNav = await app.browser.$("button*=Budget");
  await budgetNav.click();
  // `.page` is the app-wide page wrapper — it already exists from the
  // previous tab, so waiting on it (as this used to) proves nothing about
  // whether BudgetView (lazy-loaded behind a `<Suspense fallback={null}>`)
  // has actually rendered yet. That gap is normally too short to notice,
  // but with nothing rendered into `.page` yet it briefly holds only the
  // floating status toast — including, once in a while, the one-time
  // "Rolled forward this month's starting balance" note `App.tsx`'s
  // `checkMonthlyRollover` fires on a fresh database — so a `.page` text
  // read that lands in that gap sees the toast instead of the budget rows
  // and fails despite nothing actually being wrong. Waiting for `.cat-list`
  // (BudgetView's own category-rows container) instead — the same "wait
  // for page-specific content, not just `.page`" pattern every other
  // section in this file already uses (`.stats`, `.chart-legend`, the
  // Household cards) — closes the gap this was actually racing against.
  const catList = await app.browser.$(".cat-list");
  await catList.waitForExist({ timeout: 10000 });
  const budgetText = await (await app.browser.$(".page")).getText();
  if (!budgetText.includes("150.00") || !budgetText.includes("400.00")) {
    throw new Error(`expected Groceries actual $150.00 of $400.00 budgeted, got:\n${budgetText}`);
  }
  console.log("Budget actuals are correct");

  console.log("FEATURE 52 E2E TEST PASSED");
} finally {
  await app.close();
}
