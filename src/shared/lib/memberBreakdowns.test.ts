import { describe, expect, it } from "vitest";
import { incomeByMember, spendingByMember } from "./memberBreakdowns";
import type { Account, Transaction } from "./types";

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
    ...overrides,
  };
}

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
    import_flip_signs: null, hidden: false,
    ...overrides,
  };
}

const checking = account({ id: 1, account_type: "checking" });
const creditCard = account({ id: 2, name: "Capital One", account_type: "credit" });

// Regression coverage for a real production case: a family member's
// September income included a $6,000 internal transfer (checking -> HYSA)
// and the deposit side of a credit-card payment, both attributed to
// "Joint" — neither is actually income. Transfer-categorized transactions
// must be excluded from both breakdowns, matching the same exclusion
// Store::monthly_totals applies on the backend (core/src/store.rs).

describe("incomeByMember", () => {
  it("excludes a Transfer-categorized deposit from a member's income total", () => {
    const result = incomeByMember(
      [
        tx({ amount: "147.70", category: "Income", description: "Interest Payment" }),
        tx({ amount: "6000.00", category: "Transfer", description: "Internet transfer from checking" }),
      ],
      [checking],
    );
    expect(result).toEqual([{ name: "Joint", amount: 147.7 }]);
  });

  it("excludes a positive amount on a credit card account, even if not categorized Transfer", () => {
    // The other half of the real production bug: a Capital One payment
    // recorded as a plain deposit (category "Credit Card Payment", not
    // linked via apply_debt_payment) still must not count as income.
    const result = incomeByMember(
      [
        tx({ amount: "147.70", category: "Income", description: "Interest Payment" }),
        tx({
          amount: "1867.82",
          category: "Credit Card Payment",
          description: "CAPITAL ONE ONLINE PYMT",
          account_id: 2,
          account_name: "Capital One",
        }),
      ],
      [checking, creditCard],
    );
    expect(result).toEqual([{ name: "Joint", amount: 147.7 }]);
  });

  it("still counts a charge on a credit card as ordinary spending, not income (negative amounts already excluded)", () => {
    const result = incomeByMember(
      [tx({ amount: "-80.00", category: "Groceries", account_id: 2, account_name: "Capital One" })],
      [checking, creditCard],
    );
    expect(result).toEqual([]);
  });

  it("still drops unattributed transactions and negative amounts as before", () => {
    const result = incomeByMember([tx({ amount: "500.00", member_name: null }), tx({ amount: "-40.00" })], [checking]);
    expect(result).toEqual([]);
  });
});

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
