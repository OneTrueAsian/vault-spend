import { describe, expect, it } from "vitest";
import { answerLedgerQuestion, LEDGER_QA_EXAMPLES, type QaContext } from "./ledgerQa";
import type { Account, Bucket, Recurring, Transaction } from "./types";

const TODAY = new Date(2026, 8, 6); // Sat 2026-09-06

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    name: "Everyday Checking",
    account_type: "checking",
    starting_balance: "0",
    current_balance: "0",
    institution: null,
    mask: null,
    interest_rate: null,
    excluded_from_debt_payoff: false,
    member_id: null,
    member_name: null,
    checkpoint_date: null,
    icon_key: null,
    ...overrides,
  };
}

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: Math.floor(Math.random() * 1e9),
    account_id: 1,
    account_name: "Everyday Checking",
    date: "2026-07-05",
    description: "Sushi Place",
    amount: "-60.00",
    category: "Dining Out",
    category_source: "user",
    confidence: null,
    applied_to_debt: null,
    principal_amount: null,
    split_count: 0,
    tags: [],
    member_id: null,
    member_name: null,
    ...overrides,
  };
}

function bucket(overrides: Partial<Bucket> = {}): Bucket {
  return {
    id: 1,
    name: "Vacation Fund",
    target_amount: "3000.00",
    saved_amount: "1500.00",
    target_date: null,
    account_id: null,
    account_name: null,
    member_id: null,
    member_name: null,
    sinking_amount: null,
    color: null,
    icon_key: null,
    ...overrides,
  } as Bucket;
}

function recurring(overrides: Partial<Recurring> = {}): Recurring {
  return {
    id: 1,
    merchant: "Netflix",
    category: "Entertainment",
    amount: "-15.00",
    cadence: "monthly",
    anchor_date: "2026-01-01",
    next_date: "2026-09-15",
    account_id: null,
    account_name: null,
    member_id: null,
    member_name: null,
    status: "keep",
    ...overrides,
  } as Recurring;
}

function ctx(overrides: Partial<QaContext> = {}): QaContext {
  return {
    transactions: [],
    categories: ["Dining Out", "Groceries", "Transportation"],
    accounts: [],
    buckets: [],
    recurring: [],
    avgMonthlySpend: "0",
    today: TODAY,
    ...overrides,
  };
}

function ask(question: string, c: QaContext) {
  return answerLedgerQuestion(question, c);
}

describe("spend by category or merchant", () => {
  it("sums exact category matches within the named month", () => {
    const c = ctx({
      transactions: [
        tx({ date: "2026-07-05", amount: "-60.00", category: "Dining Out" }),
        tx({ date: "2026-07-12", amount: "-35.00", category: "Dining Out" }),
        tx({ date: "2026-08-01", amount: "-20.00", category: "Dining Out" }), // outside July
      ],
    });
    const r = ask("how much did I spend on dining out in July", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("Dining Out");
    expect(r.answer).toContain("$95.00");
    expect(r.answer).toContain("2 transactions");
  });

  it("accepts 'in' as a category preposition, not just 'on'/'at' (reported: \"how much did i spend in groceries in the past 2 months?\")", () => {
    const c = ctx({
      categories: ["Dining Out", "Groceries", "Transportation"],
      transactions: [
        tx({ date: "2026-08-01", amount: "-120.00", category: "Groceries" }),
        tx({ date: "2026-07-10", amount: "-80.00", category: "Groceries" }),
        tx({ date: "2026-05-01", amount: "-999.00", category: "Groceries" }), // outside the 2-month window
      ],
    });
    const r = ask("how much did i spend in groceries in the past 2 months?", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("Groceries");
    expect(r.answer).toContain("$200.00");
    expect(r.answer).not.toContain("couldn't");
  });

  it("fuzzy-matches a typo'd category name", () => {
    const c = ctx({
      transactions: [tx({ date: "2026-07-05", amount: "-60.00", category: "Dining Out" })],
    });
    const r = ask("how much did I spend on dinning out in July", c);
    expect(r.answer).toContain("Dining Out");
    expect(r.answer).toContain("$60.00");
  });

  it("falls back to a merchant match when the phrase isn't a category, using 'at'", () => {
    const c = ctx({
      transactions: [
        tx({ date: "2026-07-05", description: "Whole Foods Market", amount: "-45.00", category: "Groceries" }),
        tx({ date: "2026-07-20", description: "Whole Foods Market", amount: "-30.00", category: "Groceries" }),
      ],
    });
    const r = ask("how much did I spend at whole foods", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("Whole Foods Market");
    expect(r.answer).toContain("$75.00");
    expect(r.answer.toLowerCase()).toContain("all time");
  });

  it("gives a specific miss when neither a category nor a merchant matches", () => {
    const r = ask("how much did I spend on flying cars in July", ctx());
    expect(r.matched).toBe(true);
    expect(r.answer.toLowerCase()).toContain("couldn't find");
  });

  it("gives a specific miss when the period can't be parsed", () => {
    const c = ctx({ transactions: [tx()] });
    const r = ask("how much did I spend on dining out in blorptember", c);
    expect(r.matched).toBe(true);
    expect(r.answer.toLowerCase()).toContain("time period");
  });

  it("reinterprets a period-only 'subject' as a no-subject total-spend question (reported gap: \"how much did I spend in the past 3 months\")", () => {
    const c = ctx({
      transactions: [
        tx({ date: "2026-08-01", amount: "-120.00", category: "Groceries" }),
        tx({ date: "2026-07-10", amount: "-80.00", category: "Dining Out" }),
        tx({ date: "2026-05-01", amount: "-999.00", category: "Groceries" }), // outside the window
      ],
    });
    const r = ask("how much did I spend in the past 3 months", c);
    expect(r.matched).toBe(true);
    expect(r.answer).not.toContain("couldn't find");
    expect(r.answer).toContain("$200.00");
    expect(r.answer).toContain("2 transactions");
  });

  it("still reports a genuine unmatched category, even with no separate period captured", () => {
    // Guards the fallback above: a typo'd category must not get quietly
    // reinterpreted as some accidental period phrase.
    const r = ask("how much did I spend on flying cars", ctx());
    expect(r.matched).toBe(true);
    expect(r.answer.toLowerCase()).toContain("couldn't find");
  });
});

describe("total spend (no subject)", () => {
  it("totals spend for a bare relative period with no 'on/in/at' subject at all", () => {
    const c = ctx({
      today: new Date(2026, 6, 20),
      transactions: [
        tx({ date: "2026-07-05", amount: "-60.00", category: "Dining Out" }),
        tx({ date: "2026-07-12", amount: "-35.00", category: "Groceries" }),
        tx({ date: "2026-08-01", amount: "-20.00", category: "Dining Out" }), // outside July
      ],
    });
    const r = ask("how much did I spend this month", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("$95.00");
    expect(r.answer).toContain("2 transactions");
  });

  it("totals all-time spend for a completely bare question", () => {
    const c = ctx({
      transactions: [tx({ date: "2026-07-05", amount: "-60.00" }), tx({ date: "2025-01-01", amount: "-40.00" })],
    });
    const r = ask("how much did I spend", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("$100.00");
  });

  it("does not shadow a genuine 'spend on <category>' question", () => {
    const c = ctx({
      today: new Date(2026, 6, 20),
      transactions: [tx({ date: "2026-07-05", amount: "-60.00", category: "Dining Out" })],
    });
    const r = ask("how much did I spend on dining out this month", c);
    expect(r.answer).toContain("Dining Out");
    expect(r.answer).toContain("$60.00");
  });
});

describe("average spend", () => {
  it("averages matching expenses instead of summing them", () => {
    const c = ctx({
      transactions: [
        tx({ date: "2026-07-05", amount: "-20.00", category: "Groceries" }),
        tx({ date: "2026-07-12", amount: "-50.00", category: "Groceries" }),
        tx({ date: "2026-07-20", amount: "-80.00", category: "Groceries" }),
      ],
    });
    const r = ask("what's my average spend on groceries in July", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("$50.00");
    expect(r.answer).toContain("3 transactions");
  });

  it("gives a specific miss when neither a category nor a merchant matches", () => {
    const r = ask("what's my average spend on flying cars", ctx());
    expect(r.matched).toBe(true);
    expect(r.answer.toLowerCase()).toContain("couldn't find");
  });
});

describe("income", () => {
  it("sums income-categorized transactions for the named period", () => {
    const c = ctx({
      transactions: [
        tx({ date: "2026-07-01", amount: "4000.00", category: "Income", description: "Paycheck" }),
        tx({ date: "2026-07-15", amount: "4000.00", category: "Income", description: "Paycheck" }),
        tx({ date: "2026-06-01", amount: "4000.00", category: "Income", description: "Paycheck" }), // outside July
      ],
    });
    const r = ask("what was my income for July", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("$8,000.00");
    expect(r.answer).toContain("2 transactions");
  });

  it("defaults to this month when no period is given", () => {
    const c = ctx({
      today: new Date(2026, 6, 20),
      transactions: [tx({ date: "2026-07-01", amount: "4000.00", category: "Income" })],
    });
    const r = ask("what's my income", c);
    expect(r.matched).toBe(true);
    expect(r.answer.toLowerCase()).toContain("this month");
    expect(r.answer).toContain("$4,000.00");
  });

  it("reports no income found rather than a division-by-zero rate", () => {
    const r = ask("how much income did I make in July", ctx());
    expect(r.matched).toBe(true);
    expect(r.answer.toLowerCase()).toContain("no income found");
  });

  it("understands a bare relative period with no preposition at all", () => {
    const c = ctx({
      today: new Date(2026, 6, 20),
      transactions: [
        tx({ date: "2026-07-01", amount: "4000.00", category: "Income" }),
        tx({ date: "2026-06-01", amount: "4000.00", category: "Income" }), // outside this month
      ],
    });
    const r = ask("what's my income this month", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("$4,000.00");
  });

  it("understands the exact reported phrasing: \"what my income was for the past 3 months\"", () => {
    const c = ctx({
      transactions: [
        tx({ date: "2026-08-01", amount: "4000.00", category: "Income" }),
        tx({ date: "2026-05-01", amount: "4000.00", category: "Income" }), // outside the 3-month window
      ],
    });
    const r = ask("tell me what my income was for the past 3 months", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("$4,000.00");
  });
});

describe("period parsing (via the spend intent)", () => {
  function spendCtx() {
    return ctx({
      transactions: [
        tx({ date: "2026-06-06", amount: "-10.00" }), // "the past 3 months" / "since june"
        tx({ date: "2026-08-30", amount: "-20.00" }), // "last week"
        tx({ date: "2026-08-01", amount: "-30.00" }), // "last month"
        tx({ date: "2026-01-15", amount: "-40.00" }), // "2026" / "this year"
      ],
    });
  }

  it("understands 'last month' as the whole prior calendar month", () => {
    // August 2026 contains both the Aug-1 (-30) and Aug-30 (-20) seeded
    // rows — "last month" is a wider window than "last week", on purpose.
    const r = ask("how much did I spend on dining out in last month", spendCtx());
    expect(r.answer).toContain("$50.00");
  });

  it("understands a bare 4-digit year (which chrono itself doesn't parse)", () => {
    const r = ask("how much did I spend on dining out in 2026", spendCtx());
    expect(r.answer).toContain("$100.00"); // every seeded row is in 2026
  });

  it("understands 'the past 3 months' as a rolling range ending today", () => {
    const r = ask("how much did I spend on dining out in the past 3 months", spendCtx());
    // June 6 (in range: today - 3mo = June 6) through today; excludes the Jan row.
    expect(r.answer).toContain("$60.00");
  });

  it("understands 'since <month>' as open-ended through today", () => {
    const r = ask("how much did I spend on dining out since june", spendCtx());
    expect(r.answer).toContain("$60.00");
  });

  it("understands 'last week' as the 7-day week, not one day", () => {
    const r = ask("how much did I spend on dining out last week", spendCtx());
    expect(r.answer).toContain("$20.00");
  });
});

describe("runway what-if", () => {
  it("compares current runway to a runway with higher monthly spend", () => {
    const c = ctx({
      accounts: [account({ account_type: "checking", starting_balance: "0", current_balance: "6000" })],
      avgMonthlySpend: "1000",
    });
    const r = ask("what's my runway if rent goes up by $200", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("6.0 months");
    expect(r.answer).toContain("5.0 months");
  });
});

describe("balance lookups", () => {
  it("sums a whole account group", () => {
    const c = ctx({
      accounts: [
        account({ id: 1, account_type: "checking", current_balance: "1000" }),
        account({ id: 2, account_type: "savings", current_balance: "2000" }),
      ],
    });
    const r = ask("how much do I have in cash", c);
    expect(r.answer).toContain("$3,000.00");
  });

  it("fuzzy-matches a typo'd account name", () => {
    const c = ctx({
      accounts: [account({ name: "Checking Account", account_type: "checking", current_balance: "500" })],
    });
    const r = ask("how much do I have in Chekcing Account", c);
    expect(r.answer).toContain("Checking Account");
    expect(r.answer).toContain("$500.00");
  });
});

describe("net worth and debt", () => {
  it("reports net worth as the sum of every account's contribution", () => {
    const c = ctx({
      accounts: [
        account({ account_type: "checking", current_balance: "1000" }),
        account({ id: 2, account_type: "loan", starting_balance: "5000", current_balance: "2000" }),
      ],
    });
    const r = ask("what's my net worth", c);
    expect(r.answer).toContain("-$1,000.00"); // 1000 cash - 2000 owed
  });

  it("reports zero debt gracefully", () => {
    const r = ask("what's my total debt", ctx({ accounts: [account({ account_type: "checking" })] }));
    expect(r.answer.toLowerCase()).toContain("no debt");
  });

  it("fuzzy-matches a typo'd debt account name for a specific owe question", () => {
    const c = ctx({
      accounts: [account({ name: "Car Loan", account_type: "loan", starting_balance: "20000", current_balance: "8500" })],
    });
    const r = ask("how much do I owe on car laon", c);
    expect(r.answer).toContain("Car Loan");
    expect(r.answer).toContain("$8,500.00");
  });
});

describe("subscriptions and bills", () => {
  it("normalizes every cadence onto a common monthly total", () => {
    const c = ctx({
      recurring: [
        recurring({ id: 1, merchant: "Netflix", amount: "-15.00", cadence: "monthly" }),
        recurring({ id: 2, merchant: "Coffee club", amount: "-5.00", cadence: "weekly" }),
        recurring({ id: 3, merchant: "Paycheck", amount: "2000.00", cadence: "biweekly" }), // income, excluded
      ],
    });
    const r = ask("how much are my subscriptions", c);
    // 15 + 5*(52/12) = 15 + 21.666... = 36.67
    expect(r.answer).toContain("$36.67");
    expect(r.answer).toContain("2 recurring");
  });

  it("finds the next upcoming bill by date", () => {
    const c = ctx({
      recurring: [
        recurring({ id: 1, merchant: "Netflix", next_date: "2026-09-20" }),
        recurring({ id: 2, merchant: "Rent", amount: "-1500.00", next_date: "2026-09-10" }),
      ],
    });
    const r = ask("when is my next bill due", c);
    expect(r.answer).toContain("Rent");
    expect(r.answer).toContain("2026-09-10");
  });
});

describe("bucket progress", () => {
  it("reports saved vs target with a fuzzy bucket name", () => {
    const c = ctx({
      buckets: [bucket({ name: "Vacation Fund", saved_amount: "1500.00", target_amount: "3000.00" })],
    });
    const r = ask("how much have I saved toward vacation", c);
    expect(r.answer).toContain("Vacation Fund");
    expect(r.answer).toContain("$1,500.00");
    expect(r.answer).toContain("50%");
  });

  it("handles a bucket with no target", () => {
    const c = ctx({ buckets: [bucket({ name: "Someday Fund", saved_amount: "150.00", target_amount: null })] });
    const r = ask("how close am I to my someday fund", c);
    expect(r.answer).toContain("$150.00");
    expect(r.answer.toLowerCase()).toContain("no target");
  });
});

describe("savings rate", () => {
  it("computes (income - expenses) / income for the named period", () => {
    const c = ctx({
      transactions: [
        tx({ date: "2026-07-01", description: "Paycheck", amount: "4000.00", category: "Income" }),
        tx({ date: "2026-07-10", amount: "-1000.00" }),
      ],
    });
    const r = ask("what's my savings rate in july", c);
    // (4000 - 1000) / 4000 = 75%
    expect(r.answer).toContain("75%");
  });
});

describe("spend comparison", () => {
  it("compares total spend between two periods", () => {
    const c = ctx({
      transactions: [
        tx({ date: "2026-08-05", amount: "-500.00" }), // last month
        tx({ date: "2026-09-05", amount: "-300.00" }), // this month
      ],
    });
    const r = ask("compare this month to last month", c);
    expect(r.answer).toContain("$300.00");
    expect(r.answer).toContain("$500.00");
  });
});

describe("highest-spending category", () => {
  it("finds the category with the largest total for the period", () => {
    const c = ctx({
      today: new Date(2026, 6, 20),
      transactions: [
        tx({ date: "2026-07-05", amount: "-40.00", category: "Groceries" }),
        tx({ date: "2026-07-10", amount: "-40.00", category: "Groceries" }),
        tx({ date: "2026-07-15", amount: "-90.00", category: "Dining Out" }),
      ],
    });
    const r = ask("what did I spend the most on this month", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("Dining Out");
    expect(r.answer).toContain("$90.00");
  });

  it("reports no spending found for a quiet period", () => {
    const r = ask("what's my biggest spending category", ctx({ today: new Date(2026, 6, 20) }));
    expect(r.matched).toBe(true);
    expect(r.answer.toLowerCase()).toContain("no spending found");
  });
});

describe("biggest single transaction", () => {
  it("finds the single largest expense in the period", () => {
    const c = ctx({
      transactions: [
        tx({ date: "2026-07-05", description: "Costco", amount: "-40.00" }),
        tx({ date: "2026-07-15", description: "New Laptop", amount: "-899.00" }),
        tx({ date: "2026-08-01", description: "Outside window", amount: "-5000.00" }),
      ],
    });
    const r = ask("what was my biggest purchase in July", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("New Laptop");
    expect(r.answer).toContain("$899.00");
    expect(r.answer).not.toContain("5,000.00");
  });

  it("reports no spending found rather than crashing on an empty match set", () => {
    const r = ask("what's my largest transaction in July", ctx());
    expect(r.matched).toBe(true);
    expect(r.answer.toLowerCase()).toContain("no spending found");
  });

  it("understands a bare relative period with no preposition at all", () => {
    const c = ctx({
      today: new Date(2026, 6, 20),
      transactions: [tx({ date: "2026-07-05", description: "New Laptop", amount: "-899.00" })],
    });
    const r = ask("what was my biggest purchase this month", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("New Laptop");
  });
});

describe("transaction count", () => {
  it("counts matching transactions for a category and period", () => {
    const c = ctx({
      transactions: [
        tx({ date: "2026-07-05", category: "Dining Out" }),
        tx({ date: "2026-07-12", category: "Dining Out" }),
        tx({ date: "2026-08-01", category: "Dining Out" }), // outside July
      ],
    });
    const r = ask("how many transactions do I have in Dining Out in July", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("2");
    expect(r.answer).toContain("Dining Out");
  });

  it("gives a specific miss when the category/merchant doesn't resolve", () => {
    const r = ask("how many transactions were there for flying cars", ctx());
    expect(r.matched).toBe(true);
    expect(r.answer.toLowerCase()).toContain("couldn't find");
  });
});

describe("spend by family member", () => {
  it("sums a specific member's spend for a period", () => {
    const c = ctx({
      transactions: [
        tx({ date: "2026-07-05", amount: "-40.00", member_id: 1, member_name: "Alex" }),
        tx({ date: "2026-07-12", amount: "-25.00", member_id: 1, member_name: "Alex" }),
        tx({ date: "2026-07-20", amount: "-90.00", member_id: 2, member_name: "Jordan" }),
      ],
    });
    const r = ask("how much did Alex spend in July", c);
    expect(r.matched).toBe(true);
    expect(r.answer).toContain("Alex");
    expect(r.answer).toContain("$65.00");
    expect(r.answer).not.toContain("$90.00");
  });

  it("gives a specific miss when no member matches", () => {
    const r = ask("how much did Zorblax spend", ctx());
    expect(r.matched).toBe(true);
    expect(r.answer.toLowerCase()).toContain("couldn't find");
  });

  it("must not shadow 'how much did I spend on <category>' — the pronoun guard", () => {
    const c = ctx({ transactions: [tx({ date: "2026-07-05", amount: "-60.00", category: "Dining Out" })] });
    const r = ask("how much did I spend on dining out in July", c);
    expect(r.answer).toContain("Dining Out");
    expect(r.answer).toContain("$60.00");
    expect(r.answer.toLowerCase()).not.toContain("couldn't find a family member");
  });
});

describe("unmatched questions", () => {
  it("falls back to a graceful example suggestion", () => {
    const r = ask("who let the dogs out", ctx());
    expect(r.matched).toBe(false);
    expect(r.answer).toContain("Try something like");
  });
});

// The Dashboard's "Ask the Vault" box surfaces `LEDGER_QA_EXAMPLES`
// verbatim as clickable suggestions (DashboardView.tsx's `LedgerQaBox`) —
// a shipped example that fails to match (as "what's my savings rate this
// month" once did: its pattern only accepted a period phrase after "in/
// during/for", not the bare "this month" every sibling pattern in this
// file already accepts) hands a first-time user exactly the "I couldn't
// match that" failure the examples exist to prevent. Every example is
// checked here against one shared, realistically-populated context
// covering each example's own subject (an account per type, transactions
// in more than one category and month, a recurring bill, a bucket), so a
// broken example fails loudly in this suite instead of only when a user
// happens to click it.
describe("the Dashboard's curated example questions", () => {
  const exampleCtx = ctx({
    accounts: [
      account({ id: 1, name: "Everyday Checking", account_type: "checking", current_balance: "2500.00" }),
      account({ id: 2, name: "Car Loan", account_type: "loan", current_balance: "-8000.00", starting_balance: "-8000.00" }),
      account({ id: 3, name: "Rewards Card", account_type: "credit", current_balance: "-450.00", starting_balance: "-450.00" }),
    ],
    transactions: [
      tx({ account_id: 1, date: "2026-07-10", amount: "-60.00", category: "Dining Out", description: "Sushi Place" }),
      tx({ account_id: 1, date: "2026-09-03", amount: "-90.00", category: "Groceries", description: "Whole Foods" }),
      tx({ account_id: 1, date: "2026-09-05", amount: "3000.00", category: "Income", description: "Payroll" }),
      tx({ account_id: 1, date: "2026-09-05", amount: "-1200.00", category: "Rent", description: "Landlord" }),
      tx({ account_id: 1, date: "2026-08-05", amount: "-1400.00", category: "Rent", description: "Landlord" }),
    ],
    recurring: [recurring({ merchant: "Netflix", amount: "-15.00", cadence: "monthly" })],
    buckets: [bucket({ name: "Vacation Fund", target_amount: "3000.00", saved_amount: "1500.00" })],
    avgMonthlySpend: "2750.00",
  });

  for (const example of LEDGER_QA_EXAMPLES) {
    it(`matches: "${example}"`, () => {
      const r = ask(example, exampleCtx);
      expect(r.matched, `expected "${example}" to match an intent, got: ${r.answer}`).toBe(true);
    });
  }
});
