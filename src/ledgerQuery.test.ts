import { describe, expect, it } from "vitest";
import { compareQuery, resolveSubject, runQuery, type QaContext } from "./ledgerQuery";
import type { Account, Transaction } from "./types";

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

function ctx(overrides: Partial<QaContext> = {}): QaContext {
  return {
    transactions: [],
    categories: ["Groceries", "Dining Out", "Income"],
    accounts: [account()],
    buckets: [],
    recurring: [],
    avgMonthlySpend: "0",
    today: new Date(2026, 8, 6), // Sat 2026-09-06
    ...overrides,
  };
}

describe("runQuery — metrics", () => {
  const c = ctx({
    transactions: [
      tx({ date: "2026-07-01", amount: "-20.00", category: "Groceries" }),
      tx({ date: "2026-07-10", amount: "-50.00", category: "Groceries" }),
      tx({ date: "2026-07-20", amount: "-80.00", category: "Groceries" }),
    ],
  });
  const subject = { type: "category" as const, value: "Groceries" };

  it("sum totals the magnitude of every matching expense", () => {
    expect(runQuery({ metric: "sum", sign: "expense", subject }, c).value).toBeCloseTo(150);
  });

  it("avg divides the sum by the match count", () => {
    expect(runQuery({ metric: "avg", sign: "expense", subject }, c).value).toBeCloseTo(50);
  });

  it("count is the number of matching transactions", () => {
    expect(runQuery({ metric: "count", sign: "expense", subject }, c).value).toBe(3);
  });

  it("max is the single largest matching magnitude", () => {
    expect(runQuery({ metric: "max", sign: "expense", subject }, c).value).toBeCloseTo(80);
  });

  it("min is the single smallest matching magnitude", () => {
    expect(runQuery({ metric: "min", sign: "expense", subject }, c).value).toBeCloseTo(20);
  });

  it("returns 0, not NaN, for a query with zero matches", () => {
    const result = runQuery({ metric: "avg", sign: "expense", subject: { type: "category", value: "Nonexistent" } }, c);
    expect(result.value).toBe(0);
    expect(result.count).toBe(0);
    expect(Number.isNaN(result.value)).toBe(false);
  });
});

describe("runQuery — sign", () => {
  const c = ctx({
    transactions: [
      tx({ date: "2026-07-01", amount: "4000.00", category: "Salary", description: "Paycheck" }),
      tx({ date: "2026-07-05", amount: "35.00", category: "Shopping", description: "Amazon Return" }),
      tx({ date: "2026-07-10", amount: "-60.00", category: "Dining Out" }),
    ],
  });

  it("'income' means isIncomeTransaction — any positive, non-Transfer amount not on a credit/loan account, not literally category === 'Income'", () => {
    // Previously required category === "Income" specifically, which meant
    // a paycheck categorized "Salary" (or anything else) silently reported
    // as $0 income here while Cash Flow — driven by Store::monthly_totals,
    // which never checks category name — showed the real figure. Fixed to
    // match Store::monthly_totals exactly: both the $4,000 paycheck and the
    // $35 refund count (backend applies the identical rule to both).
    const result = runQuery({ metric: "sum", sign: "income" }, c);
    expect(result.value).toBeCloseTo(4035);
    expect(result.count).toBe(2);
  });

  it("'expense' means any negative amount, except Transfer", () => {
    const result = runQuery({ metric: "sum", sign: "expense" }, c);
    expect(result.value).toBeCloseTo(60);
    expect(result.count).toBe(1);
  });

  it("'both' applies no sign filtering at all", () => {
    const result = runQuery({ metric: "count", sign: "both" }, c);
    expect(result.count).toBe(3);
  });
});

describe("runQuery — Transfer exclusion", () => {
  // Money moving between the household's own accounts isn't spending —
  // matches the same exclusion Store::monthly_totals applies on the
  // backend (see core/src/store.rs). Regression coverage for a real
  // production case: a $6,000 internal transfer was inflating "how much
  // did I spend" answers before this exclusion existed.
  const c = ctx({
    transactions: [
      tx({ date: "2026-07-10", amount: "-6000.00", category: "Transfer", description: "To Savings" }),
      tx({ date: "2026-07-10", amount: "-60.00", category: "Dining Out" }),
    ],
  });

  it("excludes a Transfer-categorized transaction from a general 'how much did I spend' total", () => {
    const result = runQuery({ metric: "sum", sign: "expense" }, c);
    expect(result.value).toBeCloseTo(60);
    expect(result.count).toBe(1);
  });

  it("still reports it when the question is specifically about the Transfer category", () => {
    const result = runQuery({ metric: "sum", sign: "expense", subject: { type: "category", value: "Transfer" } }, c);
    expect(result.value).toBeCloseTo(6000);
    expect(result.count).toBe(1);
  });
});

describe("runQuery — credit/loan payments are never income", () => {
  // Same blanket rule Store::monthly_totals applies on the backend: a
  // positive amount on a credit or loan account is a balance adjustment,
  // never income — even if (mistakenly) categorized "Income".
  const c = ctx({
    accounts: [account({ id: 1, name: "Everyday Checking" }), account({ id: 2, name: "Capital One", account_type: "credit" })],
    transactions: [
      tx({ amount: "4000.00", category: "Income", description: "Paycheck" }),
      tx({ amount: "1867.82", category: "Income", account_id: 2, account_name: "Capital One", description: "Payment" }),
    ],
  });

  it("excludes a credit account's positive amount even when categorized Income", () => {
    const result = runQuery({ metric: "sum", sign: "income" }, c);
    expect(result.value).toBeCloseTo(4000);
    expect(result.count).toBe(1);
  });
});

describe("runQuery — subject types", () => {
  const c = ctx({
    accounts: [account({ id: 1, name: "Everyday Checking" }), account({ id: 2, name: "Rewards Card", account_type: "credit" })],
    transactions: [
      tx({ description: "Whole Foods", category: "Groceries", amount: "-40.00" }),
      tx({ description: "Trader Joe's", category: "Groceries", amount: "-30.00" }),
      tx({ account_id: 2, account_name: "Rewards Card", description: "Chipotle", category: "Dining Out", amount: "-15.00" }),
      tx({ member_id: 1, member_name: "Alex", description: "Movie Tickets", category: "Entertainment", amount: "-25.00" }),
      tx({ member_id: null, member_name: null, description: "Gas Station", category: "Transportation", amount: "-45.00" }),
    ],
  });

  it("filters by category", () => {
    const result = runQuery({ metric: "sum", sign: "expense", subject: { type: "category", value: "Groceries" } }, c);
    expect(result.count).toBe(2);
    expect(result.value).toBeCloseTo(70);
  });

  it("filters by merchant (transaction description)", () => {
    const result = runQuery({ metric: "sum", sign: "expense", subject: { type: "merchant", value: "Whole Foods" } }, c);
    expect(result.count).toBe(1);
    expect(result.value).toBeCloseTo(40);
  });

  it("filters by account name", () => {
    const result = runQuery({ metric: "sum", sign: "expense", subject: { type: "account", value: "Rewards Card" } }, c);
    expect(result.count).toBe(1);
    expect(result.value).toBeCloseTo(15);
  });

  it("filters by family member, treating a null member as 'Unassigned'", () => {
    const alex = runQuery({ metric: "count", sign: "expense", subject: { type: "member", value: "Alex" } }, c);
    expect(alex.count).toBe(1);
    const unassigned = runQuery({ metric: "count", sign: "expense", subject: { type: "member", value: "Unassigned" } }, c);
    expect(unassigned.count).toBe(4);
  });
});

describe("runQuery — period filtering", () => {
  const c = ctx({
    transactions: [
      tx({ date: "2026-06-15", amount: "-10.00" }),
      tx({ date: "2026-07-15", amount: "-20.00" }),
      tx({ date: "2026-08-15", amount: "-30.00" }),
    ],
  });

  it("only counts transactions inside the given date range", () => {
    const result = runQuery(
      { metric: "sum", sign: "expense", period: { from: new Date(2026, 6, 1), to: new Date(2026, 6, 31) } },
      c,
    );
    expect(result.count).toBe(1);
    expect(result.value).toBeCloseTo(20);
  });

  it("with no period, every matching transaction counts regardless of date", () => {
    const result = runQuery({ metric: "sum", sign: "expense" }, c);
    expect(result.count).toBe(3);
  });
});

describe("runQuery — groupBy", () => {
  const c = ctx({
    transactions: [
      tx({ date: "2026-07-05", category: "Groceries", amount: "-40.00" }),
      tx({ date: "2026-07-20", category: "Dining Out", amount: "-90.00" }),
      tx({ date: "2026-08-05", category: "Groceries", amount: "-30.00" }),
      tx({ member_name: "Alex", category: "Entertainment", amount: "-25.00" }),
    ],
  });

  it("groups by category, sorted by value descending, without dropping the overall total", () => {
    const result = runQuery({ metric: "sum", sign: "expense", groupBy: "category" }, c);
    expect(result.value).toBeCloseTo(185);
    expect(result.groups?.[0]).toEqual({ label: "Dining Out", value: 90, count: 1 });
    expect(result.groups?.map((g) => g.label)).toContain("Groceries");
  });

  it("groups by month using a raw YYYY-MM key", () => {
    const result = runQuery({ metric: "sum", sign: "expense", subject: { type: "category", value: "Groceries" }, groupBy: "month" }, c);
    const labels = result.groups?.map((g) => g.label).sort();
    expect(labels).toEqual(["2026-07", "2026-08"]);
  });

  it("groups by member, bucketing an unattributed transaction as 'Unassigned'", () => {
    const result = runQuery({ metric: "count", sign: "expense", groupBy: "member" }, c);
    const alex = result.groups?.find((g) => g.label === "Alex");
    const unassigned = result.groups?.find((g) => g.label === "Unassigned");
    expect(alex?.count).toBe(1);
    expect(unassigned?.count).toBe(3);
  });
});

describe("compareQuery", () => {
  it("runs the same query — subject filter included — over two different periods", () => {
    const c = ctx({
      transactions: [
        tx({ date: "2026-06-10", category: "Dining Out", amount: "-40.00" }),
        tx({ date: "2026-06-15", category: "Groceries", amount: "-100.00" }), // must be excluded by the subject filter
        tx({ date: "2026-07-10", category: "Dining Out", amount: "-70.00" }),
      ],
    });
    const { a, b } = compareQuery(
      { metric: "sum", sign: "expense", subject: { type: "category", value: "Dining Out" } },
      { from: new Date(2026, 5, 1), to: new Date(2026, 5, 30) },
      { from: new Date(2026, 6, 1), to: new Date(2026, 6, 31) },
      c,
    );
    expect(a.value).toBeCloseTo(40);
    expect(b.value).toBeCloseTo(70);
  });
});

describe("resolveSubject", () => {
  const c = ctx({
    categories: ["Groceries", "Dining Out"],
    accounts: [account({ name: "Everyday Checking" })],
    transactions: [tx({ description: "Whole Foods" }), tx({ member_name: "Jordan" })],
  });

  it("resolves a category via fuzzy match", () => {
    expect(resolveSubject("category", "groceries", c)).toEqual({ type: "category", value: "Groceries" });
  });

  it("resolves a merchant from distinct transaction descriptions", () => {
    expect(resolveSubject("merchant", "Whole Foods", c)).toEqual({ type: "merchant", value: "Whole Foods" });
  });

  it("resolves an account by name", () => {
    expect(resolveSubject("account", "everyday checking", c)).toEqual({ type: "account", value: "Everyday Checking" });
  });

  it("resolves a family member from distinct transaction member_names", () => {
    expect(resolveSubject("member", "Jordan", c)).toEqual({ type: "member", value: "Jordan" });
  });

  it("returns null when nothing matches closely enough", () => {
    expect(resolveSubject("category", "spaceships", c)).toBeNull();
  });
});
