import { describe, expect, it } from "vitest";
import { biggestOneOffNotes, spendingByPersonRows } from "./spendingByPerson";
import type { Account, Transaction } from "../../shared/lib/types";

const checking = { id: 1, name: "Checking", account_type: "checking" } as Account;
const card = { id: 2, name: "Card", account_type: "credit_card" } as Account;
const txn = (id: number, amount: string, member_id: number | null, category: string | null = "Groceries", over: Partial<Transaction> = {}) =>
  ({ id, date: "2026-11-10", description: `Purchase ${id}`, amount, member_id, member_name: member_id === 1 ? "Alex" : member_id === 2 ? "Sam" : null, category, account_id: 1, transfer_counterpart_id: null, ...over }) as Transaction;
const people = [{ id: 1, name: "Alex" }, { id: 2, name: "Sam" }, { id: null, name: "Shared" }];
const rows = (month: Transaction[], accounts = [checking]) => spendingByPersonRows(people, month, accounts);

describe("spendingByPersonRows", () => {
  it("gives one row per person, then Shared, each stacked by category with the month's outflows", () => {
    const result = rows([txn(1, "-30", 1, "Groceries"), txn(2, "-20", 1, "Dining Out"), txn(3, "-5", 2, "Groceries"), txn(4, "-7", null, "Gas")]);
    expect(result.map((r) => r.label)).toEqual(["Alex", "Sam", "Shared"]);
    expect(result[0].segments).toEqual([{ category: "Groceries", amount: 30 }, { category: "Dining Out", amount: 20 }]);
    expect(result[1].segments).toEqual([{ category: "Groceries", amount: 5 }]);
    expect(result[2].segments).toEqual([{ category: "Gas", amount: 7 }]);
  });

  it("adds a person's spending in one category into one segment, and names a missing category Uncategorized", () => {
    const result = rows([txn(1, "-30", 1, "Groceries"), txn(2, "-12.5", 1, "Groceries"), txn(3, "-4", 1, null)]);
    expect(result[0].segments).toEqual([{ category: "Groceries", amount: 42.5 }, { category: "Uncategorized", amount: 4 }]);
  });

  it("makes the tick what the person earned, the same money the by-person table calls income, and leaves it off when nothing came in", () => {
    const result = rows([txn(1, "2000", 1, "Salary"), txn(2, "-30", 1), txn(3, "-8", 2)]);
    expect(result[0].tick).toBe(2000);
    expect(result[1].tick).toBeUndefined();
    expect(result[2].tick).toBeUndefined();
  });

  it("keeps a person who earned but did not spend, with an empty stack and their tick", () => {
    const result = rows([txn(1, "1500", 2, "Salary")]);
    expect(result[1]).toEqual({ label: "Sam", segments: [], tick: 1500 });
  });

  it("leaves transfers, money in and money on a card's refund side out of the bars, as the table does", () => {
    const result = rows([txn(1, "-500", 1, "Transfer"), txn(2, "20", 1, "Groceries", { account_id: 2 }), txn(3, "-8", 1, "Groceries")], [checking, card]);
    expect(result[0].segments).toEqual([{ category: "Groceries", amount: 8 }]);
  });

  it("with no people at all is just Shared", () => {
    const result = spendingByPersonRows([{ id: null, name: "Shared" }], [txn(1, "-9", null)], [checking]);
    expect(result).toEqual([{ label: "Shared", segments: [{ category: "Groceries", amount: 9 }] }]);
  });
});

describe("biggestOneOffNotes", () => {
  const notes = (month: Transaction[], all: Transaction[] = month) => biggestOneOffNotes(people, month, all);

  it("names a person's biggest purchase when it is at least a fifth of what they spent", () => {
    const result = notes([txn(1, "-200", 1, "Car upkeep", { description: "Garage" }), txn(2, "-50", 1), txn(3, "-50", 1), txn(4, "-50", 1), txn(5, "-50", 1)]);
    expect(result).toEqual([{ name: "Alex", description: "Garage", amount: 200, share: 50 }]);
  });

  it("says nothing when the biggest purchase is under a fifth of what they spent, and exactly a fifth counts", () => {
    const six = [1, 2, 3, 4, 5, 6].map((i) => txn(i, "-15", 1, "Gas", { description: `Pump ${i}` }));
    expect(notes(six)).toEqual([]);
    const five = [1, 2, 3, 4, 5].map((i) => txn(i, "-20", 1, "Gas", { description: `Pump ${i}` }));
    expect(notes(five)).toEqual([{ name: "Alex", description: "Pump 1", amount: 20, share: 20 }]);
  });

  it("does not call a bill that comes round every month a one-off", () => {
    const rent = (id: number, date: string) => txn(id, "-1650", 1, "Rent", { description: "Landlord", date });
    const month = [rent(1, "2026-11-01"), txn(2, "-500", 1, "Groceries", { description: "Market" })];
    expect(notes(month, [...month, rent(3, "2026-10-01")]).map((n) => n.description)).toEqual(["Market"]);
  });

  it("still calls a purchase a one-off when the same shop was only visited for a very different amount", () => {
    const month = [txn(1, "-400", 1, "Groceries", { description: "Costco", date: "2026-11-05" }), txn(2, "-50", 1)];
    expect(notes(month, [...month, txn(3, "-60", 1, "Groceries", { description: "Costco", date: "2026-10-05" })]).map((n) => n.description)).toEqual(["Costco"]);
  });

  it("skips transfers, and gives nothing for a person who spent nothing", () => {
    expect(notes([txn(1, "-900", 1, "Transfer"), txn(2, "100", 2, "Salary")])).toEqual([]);
  });

  it("covers Shared too", () => {
    expect(notes([txn(1, "-40", null, "Gas", { description: "Fuel" })])).toEqual([{ name: "Shared", description: "Fuel", amount: 40, share: 100 }]);
  });
});
