import { describe, expect, it } from "vitest";
import { canLinkAsTransfer, collapseTransferPairs, isTransferTransaction } from "./transfers";
import type { Transaction } from "./types";

function txn(over: Partial<Transaction> & Pick<Transaction, "id" | "account_id" | "amount">): Transaction {
  return {
    transfer_counterpart_id: null,
    date: "2026-08-10",
    description: "Something",
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

describe("isTransferTransaction", () => {
  it("is true for the Transfer category", () => {
    expect(isTransferTransaction(txn({ id: 1, account_id: 1, amount: "-5.00", category: "Transfer" }))).toBe(true);
  });

  it("is true for one leg of a linked pair, whatever its category", () => {
    expect(isTransferTransaction(txn({ id: 1, account_id: 1, amount: "-5.00", transfer_counterpart_id: 2 }))).toBe(true);
  });

  it("is false for an ordinary transaction, categorized or not", () => {
    expect(isTransferTransaction(txn({ id: 1, account_id: 1, amount: "-5.00" }))).toBe(false);
    expect(isTransferTransaction(txn({ id: 2, account_id: 1, amount: "-5.00", category: null }))).toBe(false);
  });
});

describe("collapseTransferPairs", () => {
  const out = txn({ id: 1, account_id: 1, amount: "-500.00", transfer_counterpart_id: 2 });
  const inn = txn({ id: 2, account_id: 2, amount: "500.00", transfer_counterpart_id: 1 });
  const other = txn({ id: 3, account_id: 1, amount: "-20.00" });

  it("keeps the outgoing leg, hides the incoming one, and remembers which it hid", () => {
    const { rows, inLegByOutId } = collapseTransferPairs([other, inn, out]);

    expect(rows.map((t) => t.id)).toEqual([3, 1]);
    expect(inLegByOutId.get(1)).toBe(inn);
  });

  it("keeps both legs as ordinary rows when only one of them is in the list (e.g. filtered by account)", () => {
    const { rows, inLegByOutId } = collapseTransferPairs([inn, other]);

    expect(rows.map((t) => t.id)).toEqual([2, 3]);
    expect(inLegByOutId.size).toBe(0);
  });

  it("leaves a list with no linked pairs exactly as it was", () => {
    const { rows } = collapseTransferPairs([other]);

    expect(rows).toEqual([other]);
  });

  it("collapses several pairs independently", () => {
    const out2 = txn({ id: 10, account_id: 1, amount: "-75.00", transfer_counterpart_id: 11 });
    const in2 = txn({ id: 11, account_id: 3, amount: "75.00", transfer_counterpart_id: 10 });

    const { rows, inLegByOutId } = collapseTransferPairs([out, in2, inn, out2]);

    expect(rows.map((t) => t.id)).toEqual([1, 10]);
    expect(inLegByOutId.get(10)).toBe(in2);
    expect(inLegByOutId.get(1)).toBe(inn);
  });
});

describe("canLinkAsTransfer", () => {
  const out = txn({ id: 1, account_id: 1, amount: "-500.00" });
  const inn = txn({ id: 2, account_id: 2, amount: "500.00" });

  it("accepts an outgoing and an incoming transaction in different accounts, in either order", () => {
    expect(canLinkAsTransfer(out, inn)).toBe(true);
    expect(canLinkAsTransfer(inn, out)).toBe(true);
  });

  it("rejects the same account", () => {
    expect(canLinkAsTransfer(out, txn({ id: 3, account_id: 1, amount: "500.00" }))).toBe(false);
  });

  it("rejects two legs going the same direction", () => {
    expect(canLinkAsTransfer(out, txn({ id: 3, account_id: 2, amount: "-500.00" }))).toBe(false);
  });

  it("rejects a leg that is already linked", () => {
    expect(canLinkAsTransfer(out, txn({ id: 3, account_id: 2, amount: "500.00", transfer_counterpart_id: 9 }))).toBe(false);
  });

  it("rejects a zero amount", () => {
    expect(canLinkAsTransfer(out, txn({ id: 3, account_id: 2, amount: "0.00" }))).toBe(false);
  });
});
