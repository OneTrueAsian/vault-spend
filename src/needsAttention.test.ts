import { describe, expect, it } from "vitest";
import { attentionItems } from "./needsAttention";
import type { Account, Recurring, RecurringMatch, Transaction } from "./types";

const TODAY = new Date(2026, 8, 18); // 2026-09-18

function account(over: Partial<Account> & Pick<Account, "id" | "name" | "account_type">): Account {
  return {
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
    ...over,
  };
}

function txn(over: Partial<Transaction> & Pick<Transaction, "id" | "account_id" | "date">): Transaction {
  return {
    transfer_counterpart_id: null,
    description: "Something",
    amount: "-10.00",
    category: "Groceries",
    category_source: "user",
    confidence: null,
    account_name: "",
    applied_to_debt: null,
    principal_amount: null,
    split_count: 0,
    tags: [],
    member_id: null,
    member_name: null,
    ...over,
  };
}

function bill(over: Partial<Recurring> & Pick<Recurring, "id" | "merchant" | "next_date">): Recurring {
  return {
    category: null,
    amount: "-50.00",
    cadence: "monthly",
    anchor_date: over.next_date,
    account_id: null,
    account_name: null,
    member_id: null,
    member_name: null,
    status: "keep",
    ...over,
  };
}

function match(over: Partial<RecurringMatch> & Pick<RecurringMatch, "recurring_id">): RecurringMatch {
  return { state: "paid", last_due: null, last_paid_date: null, last_paid_amount: null, price_change: null, ...over };
}

const checking = account({ id: 1, name: "Everyday Checking", account_type: "checking" });

describe("attentionItems", () => {
  it("is empty when there is nothing to do", () => {
    const items = attentionItems({
      transactions: [txn({ id: 1, account_id: 1, date: "2026-09-17" })],
      recurring: [],
      accounts: [checking],
      today: TODAY,
    });

    expect(items).toEqual([]);
  });

  it("counts transactions with no category", () => {
    const items = attentionItems({
      transactions: [
        txn({ id: 1, account_id: 1, date: "2026-09-17", category: null }),
        txn({ id: 2, account_id: 1, date: "2026-09-16", category: null }),
        txn({ id: 3, account_id: 1, date: "2026-09-15" }),
      ],
      recurring: [],
      accounts: [checking],
      today: TODAY,
    });

    expect(items).toEqual([{ kind: "uncategorized", count: 2, label: "2 transactions need a category" }]);
  });

  it("does not count the legs of a linked transfer as needing a category", () => {
    const items = attentionItems({
      transactions: [
        txn({ id: 1, account_id: 1, date: "2026-09-17", category: null, transfer_counterpart_id: 2 }),
        txn({ id: 2, account_id: 2, date: "2026-09-17", category: null, transfer_counterpart_id: 1 }),
      ],
      recurring: [],
      accounts: [checking],
      today: TODAY,
    });

    expect(items).toEqual([]);
  });

  it("uses singular wording for one uncategorized transaction", () => {
    const items = attentionItems({
      transactions: [txn({ id: 1, account_id: 1, date: "2026-09-17", category: null })],
      recurring: [],
      accounts: [checking],
      today: TODAY,
    });

    expect(items[0].label).toBe("1 transaction needs a category");
  });

  it("flags bills due today through 3 days out, but not later, past, income, or canceled ones", () => {
    const items = attentionItems({
      transactions: [txn({ id: 1, account_id: 1, date: "2026-09-17" })],
      recurring: [
        bill({ id: 1, merchant: "Geico Auto", next_date: "2026-09-18" }), // today
        bill({ id: 2, merchant: "Union Realty", next_date: "2026-09-21" }), // +3 days
        bill({ id: 3, merchant: "Netflix", next_date: "2026-09-22" }), // +4: too far
        bill({ id: 4, merchant: "Overdue Thing", next_date: "2026-09-17" }), // yesterday
        bill({ id: 5, merchant: "Payroll", next_date: "2026-09-19", amount: "3200.00" }), // income
        bill({ id: 6, merchant: "Old Gym", next_date: "2026-09-19", status: "canceled" }),
      ],
      accounts: [checking],
      today: TODAY,
    });

    expect(items).toEqual([
      { kind: "bills_due", count: 2, label: "2 bills due in the next 3 days", detail: "Geico Auto, Union Realty" },
    ]);
  });

  it("summarizes the names once more than two bills are due", () => {
    const items = attentionItems({
      transactions: [txn({ id: 1, account_id: 1, date: "2026-09-17" })],
      recurring: [
        bill({ id: 1, merchant: "A", next_date: "2026-09-18" }),
        bill({ id: 2, merchant: "B", next_date: "2026-09-19" }),
        bill({ id: 3, merchant: "C", next_date: "2026-09-20" }),
      ],
      accounts: [checking],
      today: TODAY,
    });

    expect(items[0].detail).toBe("A, B, +1 more");
  });

  it("flags a checking or credit account with no activity in 30+ days", () => {
    const card = account({ id: 2, name: "Visa Rewards", account_type: "credit" });
    const items = attentionItems({
      transactions: [
        txn({ id: 1, account_id: 1, date: "2026-08-18" }), // exactly 31 days ago
        txn({ id: 2, account_id: 2, date: "2026-09-10" }), // recent
      ],
      recurring: [],
      accounts: [checking, card],
      today: TODAY,
    });

    expect(items).toEqual([
      { kind: "stale_accounts", count: 1, label: "1 account with no activity in 30+ days", detail: "Everyday Checking" },
    ]);
  });

  it("does not flag savings, loan, or investment accounts, or one that has never had a transaction", () => {
    const items = attentionItems({
      transactions: [
        txn({ id: 1, account_id: 10, date: "2026-01-01" }),
        txn({ id: 2, account_id: 11, date: "2026-01-01" }),
        txn({ id: 3, account_id: 12, date: "2026-01-01" }),
      ],
      recurring: [],
      accounts: [
        account({ id: 10, name: "High-Yield Savings", account_type: "savings" }),
        account({ id: 11, name: "Car Loan", account_type: "loan" }),
        account({ id: 12, name: "Brokerage", account_type: "investment" }),
        account({ id: 13, name: "Brand New Checking", account_type: "checking" }),
      ],
      today: TODAY,
    });

    expect(items).toEqual([]);
  });

  it("orders items uncategorized, bills, stale accounts", () => {
    const items = attentionItems({
      transactions: [
        txn({ id: 1, account_id: 1, date: "2026-06-01", category: null }),
      ],
      recurring: [bill({ id: 1, merchant: "Geico Auto", next_date: "2026-09-19" })],
      accounts: [checking],
      today: TODAY,
    });

    expect(items.map((i) => i.kind)).toEqual(["uncategorized", "bills_due", "stale_accounts"]);
  });
});

describe("attentionItems with recurring matches", () => {
  const base = { transactions: [txn({ id: 1, account_id: 1, date: "2026-09-17" })], accounts: [checking], today: TODAY };

  it("flags bills that look missed, but not canceled ones, income, or ones still pending", () => {
    const items = attentionItems({
      ...base,
      recurring: [
        bill({ id: 1, merchant: "Geico Auto", next_date: "2026-10-01" }),
        bill({ id: 2, merchant: "Old Gym", next_date: "2026-10-01", status: "canceled" }),
        bill({ id: 3, merchant: "Payroll", next_date: "2026-10-01", amount: "3200.00" }),
        bill({ id: 4, merchant: "Netflix", next_date: "2026-10-01" }),
      ],
      recurringMatches: [
        match({ recurring_id: 1, state: "missed" }),
        match({ recurring_id: 2, state: "missed" }),
        match({ recurring_id: 3, state: "missed" }),
        match({ recurring_id: 4, state: "pending" }),
      ],
    });

    expect(items).toEqual([
      { kind: "bills_missed", count: 1, label: "1 bill looks missed — no matching charge", detail: "Geico Auto" },
    ]);
  });

  it("flags a price change and shows the old and new price", () => {
    const items = attentionItems({
      ...base,
      recurring: [bill({ id: 1, merchant: "Netflix", next_date: "2026-10-03", amount: "-15.49" })],
      recurringMatches: [match({ recurring_id: 1, price_change: { from: "-15.49", to: "-17.99" } })],
    });

    expect(items).toEqual([
      { kind: "price_changes", count: 1, label: "1 subscription changed price", detail: "Netflix $15.49 → $17.99" },
    ]);
  });

  it("stops flagging a price change once the amount on file matches the new price", () => {
    const items = attentionItems({
      ...base,
      recurring: [bill({ id: 1, merchant: "Netflix", next_date: "2026-10-03", amount: "-17.99" })],
      recurringMatches: [match({ recurring_id: 1, price_change: { from: "-15.49", to: "-17.99" } })],
    });

    expect(items).toEqual([]);
  });

  it("puts missed bills and price changes between uncategorized and bills due", () => {
    const items = attentionItems({
      transactions: [txn({ id: 1, account_id: 1, date: "2026-09-17", category: null })],
      accounts: [checking],
      today: TODAY,
      recurring: [
        bill({ id: 1, merchant: "Geico Auto", next_date: "2026-09-19" }),
        bill({ id: 2, merchant: "Netflix", next_date: "2026-10-03", amount: "-15.49" }),
        bill({ id: 3, merchant: "Union Realty", next_date: "2026-10-01" }),
      ],
      recurringMatches: [
        match({ recurring_id: 2, price_change: { from: "-15.49", to: "-17.99" } }),
        match({ recurring_id: 3, state: "missed" }),
      ],
    });

    expect(items.map((i) => i.kind)).toEqual(["uncategorized", "bills_missed", "price_changes", "bills_due"]);
  });
});

describe("attentionItems with a month review due", () => {
  it("offers the review first, ahead of everything else", () => {
    const items = attentionItems({
      transactions: [txn({ id: 1, account_id: 1, date: "2026-09-17", category: null })],
      recurring: [],
      accounts: [checking],
      today: TODAY,
      monthReview: { label: "August" },
    });

    expect(items.map((i) => i.kind)).toEqual(["month_review", "uncategorized"]);
    expect(items[0]).toEqual({ kind: "month_review", count: 1, label: "Review August — last month's check-in" });
  });

  it("adds nothing when no review is due", () => {
    const items = attentionItems({
      transactions: [txn({ id: 1, account_id: 1, date: "2026-09-17" })],
      recurring: [],
      accounts: [checking],
      today: TODAY,
      monthReview: null,
    });

    expect(items).toEqual([]);
  });
});
