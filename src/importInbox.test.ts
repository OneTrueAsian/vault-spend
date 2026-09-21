import { describe, expect, it } from "vitest";
import { buildInbox, LOW_CONFIDENCE, suggestCategory } from "./importInbox";
import type { AnomalyFlag, Transaction } from "./types";

function txn(over: Partial<Transaction> & Pick<Transaction, "id">): Transaction {
  return {
    account_id: 1,
    date: "2026-09-10",
    transfer_counterpart_id: null,
    description: "Something",
    amount: "-10.00",
    category: "Groceries",
    category_source: "user",
    confidence: null,
    account_name: "Checking",
    applied_to_debt: null,
    principal_amount: null,
    split_count: 0,
    tags: [],
    member_id: null,
    member_name: null,
    ...over,
  };
}

describe("suggestCategory", () => {
  const history = [
    txn({ id: 1, description: "Starbucks Store 55", category: "Dining Out" }),
    txn({ id: 2, description: "STARBUCKS #0042 SEATTLE", category: "Dining Out" }),
    txn({ id: 3, description: "Starbucks", category: "Coffee" }),
    txn({ id: 4, description: "Kroger 445", category: "Groceries" }),
  ];

  it("suggests the category most often used for the same merchant, with how many rows back it", () => {
    expect(suggestCategory("STARBUCKS #1234 PORTLAND", history)).toEqual({ category: "Dining Out", support: 2 });
  });

  it("matches on the merchant, not on card-processor noise", () => {
    expect(suggestCategory("POS PURCHASE KROGER 9981", history)).toEqual({ category: "Groceries", support: 1 });
    expect(suggestCategory("THE HOME DEPOT #22", [txn({ id: 9, description: "Home Depot 100", category: "Home" })])).toEqual({
      category: "Home",
      support: 1,
    });
  });

  it("has no suggestion for a merchant it has never seen", () => {
    expect(suggestCategory("Brand New Vendor", history)).toBeNull();
  });

  it("ignores history rows that have no category", () => {
    expect(suggestCategory("Kroger 12", [txn({ id: 1, description: "Kroger 1", category: null })])).toBeNull();
  });

  it("breaks a tie toward the more recent category", () => {
    const tied = [
      txn({ id: 1, description: "Amazon Marketplace", category: "Shopping", date: "2026-06-01" }),
      txn({ id: 2, description: "Amazon Prime", category: "Subscriptions", date: "2026-09-01" }),
    ];

    expect(suggestCategory("Amazon Digital", tied)?.category).toBe("Subscriptions");
  });

  it("has nothing to go on for a description that is all noise", () => {
    expect(suggestCategory("POS 1234 #55", history)).toBeNull();
  });
});

describe("buildInbox", () => {
  const flag = (transaction_id: number, kind: "large" | "duplicate", detail = "x"): AnomalyFlag => ({ transaction_id, kind, detail });

  it("lists uncategorized rows with a suggestion drawn from the rest of the history", () => {
    const items = buildInbox({
      transactions: [
        txn({ id: 1, description: "Starbucks 9", category: null }),
        txn({ id: 2, description: "Starbucks 1", category: "Dining Out" }),
      ],
      flags: [],
      scopeIds: null,
    });

    expect(items).toHaveLength(1);
    expect(items[0].transaction.id).toBe(1);
    expect(items[0].reasons.map((r) => r.kind)).toEqual(["uncategorized"]);
    expect(items[0].suggestion).toEqual({ category: "Dining Out", support: 1 });
  });

  it("lists shaky auto-categorizations, but not confident ones or ones the user chose", () => {
    const items = buildInbox({
      transactions: [
        txn({ id: 1, category_source: "classifier", confidence: LOW_CONFIDENCE - 0.1 }),
        txn({ id: 2, category_source: "classifier", confidence: LOW_CONFIDENCE }),
        txn({ id: 3, category_source: "rule", confidence: null }),
        txn({ id: 4, category_source: "user", confidence: 0.2 }),
      ],
      flags: [],
      scopeIds: null,
    });

    expect(items.map((i) => i.transaction.id)).toEqual([1]);
    expect(items[0].reasons[0].kind).toBe("low_confidence");
  });

  it("carries unusually large and possible-duplicate flags, several per transaction", () => {
    const items = buildInbox({
      transactions: [txn({ id: 1 }), txn({ id: 2 })],
      flags: [flag(1, "large", "5x typical"), flag(1, "duplicate", "same as Aug 3"), flag(2, "large")],
      scopeIds: null,
    });

    const first = items.find((i) => i.transaction.id === 1)!;
    expect(first.reasons).toEqual([
      { kind: "duplicate", detail: "same as Aug 3" },
      { kind: "large", detail: "5x typical" },
    ]);
  });

  it("limits itself to the given ids, e.g. the rows just imported", () => {
    const items = buildInbox({
      transactions: [txn({ id: 1, category: null }), txn({ id: 2, category: null }), txn({ id: 3, category: null })],
      flags: [],
      scopeIds: new Set([2, 3]),
    });

    expect(items.map((i) => i.transaction.id).sort()).toEqual([2, 3]);
  });

  it("leaves out the legs of a linked transfer", () => {
    const items = buildInbox({
      transactions: [txn({ id: 1, category: null, transfer_counterpart_id: 2 }), txn({ id: 2, category: null, transfer_counterpart_id: 1 })],
      flags: [],
      scopeIds: null,
    });

    expect(items).toEqual([]);
  });

  it("puts what needs a category first, then duplicates, then large ones; newest first within each", () => {
    const items = buildInbox({
      transactions: [
        txn({ id: 1, date: "2026-09-01" }), // large only
        txn({ id: 2, date: "2026-09-02" }), // duplicate
        txn({ id: 3, date: "2026-09-03", category: null }),
        txn({ id: 4, date: "2026-09-05", category: null }),
      ],
      flags: [flag(1, "large"), flag(2, "duplicate")],
      scopeIds: null,
    });

    expect(items.map((i) => i.transaction.id)).toEqual([4, 3, 2, 1]);
  });

  it("is empty when nothing needs a look", () => {
    expect(buildInbox({ transactions: [txn({ id: 1 })], flags: [], scopeIds: null })).toEqual([]);
  });
});
