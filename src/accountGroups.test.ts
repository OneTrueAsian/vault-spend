import { describe, expect, it } from "vitest";
import { isBeforeAccountCheckpoint, isIncomeTransaction, pickDefaultAccountId } from "./accountGroups";
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
    id: 1,
    transfer_counterpart_id: null,
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

// The single definition of "income," mirrored exactly from
// Store::monthly_totals on the backend (see core/src/store.rs) — Reports'
// "Income (all-time)" stat and Savings Rate Trend, Ask the Vault's
// "income" queries, and Household's income-by-member all route through
// this one function so they can never disagree with Cash Flow, which is
// driven by the backend rule directly.
describe("isIncomeTransaction", () => {
  const accounts = [
    account({ id: 1, name: "Everyday Checking", account_type: "checking" }),
    account({ id: 2, name: "Rewards Card", account_type: "credit" }),
    account({ id: 3, name: "Car Loan", account_type: "loan" }),
  ];

  it("counts a positive amount categorized anything other than 'Income' — the reported bug", () => {
    expect(isIncomeTransaction(tx({ amount: "4000.00", category: "Salary" }), accounts)).toBe(true);
  });

  it("still counts a positive amount literally categorized 'Income'", () => {
    expect(isIncomeTransaction(tx({ amount: "4000.00", category: "Income" }), accounts)).toBe(true);
  });

  it("counts a positive amount with no category set at all", () => {
    expect(isIncomeTransaction(tx({ amount: "4000.00", category: null }), accounts)).toBe(true);
  });

  it("excludes a negative amount", () => {
    expect(isIncomeTransaction(tx({ amount: "-60.00" }), accounts)).toBe(false);
  });

  it("excludes a zero amount", () => {
    expect(isIncomeTransaction(tx({ amount: "0.00" }), accounts)).toBe(false);
  });

  it("excludes a Transfer-categorized transaction even though it's positive", () => {
    expect(isIncomeTransaction(tx({ amount: "6000.00", category: "Transfer" }), accounts)).toBe(false);
  });

  it("excludes a positive amount on a credit account, even categorized 'Income' — a payment isn't income", () => {
    expect(isIncomeTransaction(tx({ amount: "200.00", category: "Income", account_id: 2, account_name: "Rewards Card" }), accounts)).toBe(
      false,
    );
  });

  it("excludes a positive amount on a loan account — a payment isn't income", () => {
    expect(isIncomeTransaction(tx({ amount: "75.00", account_id: 3, account_name: "Car Loan" }), accounts)).toBe(false);
  });

  it("treats an account_id missing from the given accounts list as not credit/loan, not as excluded", () => {
    // Should never happen in practice (a transaction's account is never
    // hard-deleted out from under it) — but callers that only pass a
    // partial `accounts` list because account type doesn't matter to what
    // they're testing shouldn't have every transaction silently excluded.
    expect(isIncomeTransaction(tx({ amount: "500.00", account_id: 99, account_name: "Unknown Account" }), accounts)).toBe(true);
  });

  it("still counts income when no accounts are supplied at all", () => {
    expect(isIncomeTransaction(tx({ amount: "4000.00", category: "Salary" }), [])).toBe(true);
  });
});

// A transaction dated on or before an account's last checkpoint can't move
// its current_balance (see Store::account_balance_as_of's `since_date` on
// the backend) — NewTransactionDialog uses this to warn before that's a
// silent surprise.
describe("isBeforeAccountCheckpoint", () => {
  it("is true for a date exactly on the checkpoint", () => {
    expect(isBeforeAccountCheckpoint(account({ checkpoint_date: "2026-09-09" }), "2026-09-09")).toBe(true);
  });

  it("is true for a date before the checkpoint", () => {
    expect(isBeforeAccountCheckpoint(account({ checkpoint_date: "2026-09-09" }), "2026-09-02")).toBe(true);
  });

  it("is false for a date after the checkpoint", () => {
    expect(isBeforeAccountCheckpoint(account({ checkpoint_date: "2026-09-09" }), "2026-09-10")).toBe(false);
  });

  it("is false when the account has no checkpoint yet", () => {
    expect(isBeforeAccountCheckpoint(account({ checkpoint_date: null }), "2020-01-01")).toBe(false);
  });

  it("is false for an empty date (nothing picked yet)", () => {
    expect(isBeforeAccountCheckpoint(account({ checkpoint_date: "2026-09-09" }), "")).toBe(false);
  });
});

describe("pickDefaultAccountId", () => {
  const acct = (id: number, account_type: string) => ({ id, account_type });

  it("prefers the account last used, when it still exists", () => {
    expect(pickDefaultAccountId([acct(1, "loan"), acct(2, "checking"), acct(3, "savings")], 3)).toBe(3);
  });

  it("falls back to the first checking account rather than whichever sorts first", () => {
    expect(pickDefaultAccountId([acct(1, "loan"), acct(2, "investment"), acct(3, "checking")], null)).toBe(3);
  });

  it("ignores a remembered account that has since been deleted", () => {
    expect(pickDefaultAccountId([acct(1, "loan"), acct(2, "checking")], 99)).toBe(2);
  });

  it("then prefers a credit card, then savings, over a loan or brokerage account", () => {
    expect(pickDefaultAccountId([acct(1, "loan"), acct(2, "savings"), acct(3, "credit")], null)).toBe(3);
    expect(pickDefaultAccountId([acct(1, "loan"), acct(2, "investment"), acct(3, "savings")], null)).toBe(3);
  });

  it("takes the first account when none is an everyday one, and null when there are none", () => {
    expect(pickDefaultAccountId([acct(7, "loan"), acct(8, "investment")], null)).toBe(7);
    expect(pickDefaultAccountId([], null)).toBeNull();
  });
});
