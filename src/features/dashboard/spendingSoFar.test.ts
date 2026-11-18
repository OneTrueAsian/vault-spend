import { describe, expect, it } from "vitest";
import type { CategoryAmount, Recurring, Transaction } from "../../shared/lib/types";
import { EVERYTHING_ELSE_KEY, biggestOneOff, foldSmallest, spendingSoFar } from "./spendingSoFar";

function txn(over: Partial<Transaction> & Pick<Transaction, "id" | "date">): Transaction {
  return {
    transfer_counterpart_id: null,
    description: "Something",
    amount: "-10.00",
    category: "Groceries",
    category_source: "user",
    confidence: null,
    account_id: 1,
    account_name: "Checking",
    applied_to_debt: null,
    principal_amount: null,
    split_count: 0,
    tags: [],
    member_id: null,
    member_name: null,
    notes: null,
    ...over,
  };
}
const spend = (category: string, amount: string): CategoryAmount => ({ category, amount });
function bill(over: Partial<Recurring> & Pick<Recurring, "id" | "merchant">): Recurring {
  return { category: null, amount: "-50.00", cadence: "monthly", anchor_date: "2026-11-01", next_date: "2026-12-01", account_id: null, account_name: null, member_id: null, member_name: null, status: "keep", ...over };
}

// Sunday 15 November 2026.
const today = new Date(2026, 10, 15);

describe("spendingSoFar", () => {
  it("names the month, the days compared and the days of last month it is compared with", () => {
    const s = spendingSoFar({ spendingThisMonth: [], transactions: [], today });
    expect(s.title).toBe("Spending in November 2026 so far");
    expect(s.subtitle).toBe("Nov 1\u201315, largest first. The change is against Oct 1\u201315.");
  });

  it("stops last month's days at its last day when this month is longer", () => {
    const s = spendingSoFar({ spendingThisMonth: [], transactions: [], today: new Date(2026, 2, 31) });
    expect(s.subtitle).toBe("Mar 1\u201331, largest first. The change is against Feb 1\u201328.");
  });

  it("takes this month's rows and total straight from spendingThisMonth, largest first", () => {
    const s = spendingSoFar({ spendingThisMonth: [spend("Rent", "1500.00"), spend("Groceries", "300.00"), spend("Dining", "300.00")], transactions: [], today });
    expect(s.rows.map((r) => [r.label, r.amount])).toEqual([["Rent", 1500], ["Dining", 300], ["Groceries", 300]]);
    expect(s.total).toBe(2100);
  });

  it("compares with the same days of last month, ignoring later days, refunds, transfers and uncategorized rows", () => {
    const s = spendingSoFar({
      spendingThisMonth: [spend("Groceries", "300.00"), spend("Dining", "50.00")],
      transactions: [
        txn({ id: 1, date: "2026-10-01", amount: "-100.00" }),
        txn({ id: 2, date: "2026-10-15", amount: "-20.00" }),
        txn({ id: 3, date: "2026-10-16", amount: "-999.00" }),
        txn({ id: 4, date: "2026-10-05", amount: "40.00" }),
        txn({ id: 5, date: "2026-10-05", amount: "-70.00", category: "Transfer" }),
        txn({ id: 6, date: "2026-10-05", amount: "-80.00", transfer_counterpart_id: 9 }),
        txn({ id: 7, date: "2026-10-05", amount: "-90.00", category: null }),
        txn({ id: 8, date: "2026-10-05", amount: "-33.00", category: "Dining" }),
        txn({ id: 9, date: "2026-09-30", amount: "-500.00" }),
      ],
      today,
    });
    expect(s.rows.map((r) => [r.label, r.previous])).toEqual([["Groceries", 120], ["Dining", 33]]);
  });

  it("reads a category with no spending in the same days last month as nothing before", () => {
    const s = spendingSoFar({ spendingThisMonth: [spend("Travel", "80.00")], transactions: [], today });
    expect(s.rows[0].previous).toBe(0);
  });
});

describe("foldSmallest", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ key: `c${i}`, label: `C${i}`, amount: 100 - i, previous: 10 }));
  it("keeps up to eight rows as they are", () => {
    expect(foldSmallest(rows.slice(0, 8))).toHaveLength(8);
  });
  it("folds the rest into Everything else (n), counting what was folded and adding up amounts", () => {
    const folded = foldSmallest(rows);
    expect(folded).toHaveLength(8);
    const last = folded[7];
    expect(last.key).toBe(EVERYTHING_ELSE_KEY);
    expect(last.label).toBe("Everything else (3)");
    expect(last.amount).toBe(93 + 92 + 91);
    expect(last.previous).toBe(30);
  });
});

describe("biggestOneOff", () => {
  const base = { today, recurring: [] as Recurring[] };
  it("picks the biggest charge this month and says nothing when there is none", () => {
    expect(biggestOneOff({ ...base, transactions: [] })).toBeNull();
    const big = biggestOneOff({
      ...base,
      transactions: [
        txn({ id: 1, date: "2026-11-03", amount: "-40.00", description: "Cafe" }),
        txn({ id: 2, date: "2026-11-09", amount: "-640.00", description: "Brake repair", category: "Car" }),
        txn({ id: 3, date: "2026-10-30", amount: "-9000.00", description: "Last month" }),
        txn({ id: 4, date: "2026-11-10", amount: "-5000.00", description: "Card payment", category: "Transfer" }),
        txn({ id: 5, date: "2026-11-10", amount: "-4000.00", description: "To savings", transfer_counterpart_id: 7 }),
        txn({ id: 6, date: "2026-11-11", amount: "3000.00", description: "Refund" }),
        txn({ id: 7, date: "2026-11-16", amount: "-8000.00", description: "Tomorrow" }),
      ],
    });
    expect(big).toMatchObject({ description: "Brake repair", amount: 640, date: "2026-11-09", category: "Car" });
  });
  it("leaves out charges that match a bill you pay every month", () => {
    const big = biggestOneOff({
      ...base,
      recurring: [bill({ id: 1, merchant: "Landlord LLC" }), bill({ id: 2, merchant: "Old gym", status: "canceled" })],
      transactions: [
        txn({ id: 1, date: "2026-11-01", amount: "-1500.00", description: "LANDLORD LLC rent" }),
        txn({ id: 2, date: "2026-11-02", amount: "-300.00", description: "Old gym" }),
      ],
    });
    expect(big?.description).toBe("Old gym");
  });
});
