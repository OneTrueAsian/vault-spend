import { describe, expect, it } from "vitest";
import { spendingByMember } from "./memberBreakdowns";
import type { Transaction } from "./types";

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: Math.floor(Math.random() * 1e9),
    transfer_counterpart_id: null,
    date: "2026-09-05",
    description: "Test transaction",
    amount: "-60.00",
    category: "Dining Out",
    category_source: "user",
    confidence: null,
    account_id: 1,
    account_name: "Everyday Checking",
    applied_to_debt: null,
    principal_amount: null,
    split_count: 0,
    tags: [],
    member_id: 3,
    member_name: "Joint",
    notes: null,
    excluded_from_budget: false,
    ...overrides,
  };
}

// Regression coverage for a real production case: a family member's
// September income included a $6,000 internal transfer (checking -> HYSA)
// and the deposit side of a credit-card payment, both attributed to
// "Joint" — neither is actually income. Transfer-categorized transactions
// must be excluded from both breakdowns, matching the same exclusion
// Store::monthly_totals applies on the backend (core/src/store.rs). The income
// side is covered on the Household page (HouseholdCards.test.tsx).

describe("spendingByMember", () => {
  it("excludes a Transfer-categorized withdrawal from a member's spending total", () => {
    const result = spendingByMember([
      tx({ amount: "-33.09", category: "Dining Out" }),
      tx({ amount: "-6000.00", category: "Transfer", description: "Internet transfer to savings" }),
    ]);
    expect(result).toEqual([{ name: "Joint", amount: 33.09 }]);
  });
});

// QA-FUNC-007: Household can show spending nobody has been named for.
describe("spendingByMember with includeUnassigned", () => {
  const unassigned = (over: Partial<Transaction> = {}) => tx({ member_id: null, member_name: null, ...over });

  it("is unchanged by default: unassigned spending stays out", () => {
    expect(spendingByMember([tx({ amount: "-10.00" }), unassigned({ amount: "-25.00" })])).toEqual([{ name: "Joint", amount: 10 }]);
  });

  it("adds one Unassigned line after the named people", () => {
    const rows = spendingByMember([unassigned({ amount: "-25.00" }), tx({ amount: "-10.00" }), unassigned({ amount: "-5.50" })], { includeUnassigned: true });
    expect(rows).toEqual([
      { name: "Joint", amount: 10 },
      { name: "Unassigned", amount: 30.5, unassigned: true },
    ]);
  });

  it("counts only money out, and leaves transfers and refunds out of Unassigned like it does for people", () => {
    const rows = spendingByMember(
      [
        unassigned({ amount: "-40.00" }),
        unassigned({ amount: "-900.00", category: "Transfer" }),
        unassigned({ amount: "15.00", category: "Dining Out" }), // a refund or deposit: not spending
        unassigned({ amount: "-60.00", split_count: 2 }), // a split purchase still counts once, whole
      ],
      { includeUnassigned: true },
    );
    expect(rows).toEqual([{ name: "Unassigned", amount: 100, unassigned: true }]);
  });

  it("shows no Unassigned line when everything is attributed", () => {
    expect(spendingByMember([tx({ amount: "-10.00" })], { includeUnassigned: true })).toEqual([{ name: "Joint", amount: 10 }]);
  });

  it("keeps a person who is actually named Unassigned apart from the unattributed total", () => {
    const rows = spendingByMember([tx({ member_name: "Unassigned", amount: "-7.00" }), unassigned({ amount: "-3.00" })], { includeUnassigned: true });
    expect(rows.map((r) => r.amount)).toEqual([7, 3]);
  });
});
