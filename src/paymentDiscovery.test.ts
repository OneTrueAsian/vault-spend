import { describe, expect, it } from "vitest";
import { matchesPaymentAccount, paymentDisplayIndex } from "./paymentDiscovery";
import type { Transaction } from "./types";

const payment = { id: 1, account_id: 10, applied_to_debt: { debt_account_id: 20 } } as Transaction;
const ordinary = { id: 2, account_id: 30, applied_to_debt: null } as Transaction;

describe("payment account discovery", () => {
  it("matches either account or both without duplicating the original", () => {
    for (const ids of ["all", new Set([10]), new Set([20]), new Set([10, 20]) ] as const) {
      expect([payment].filter(t => matchesPaymentAccount(t, ids))).toEqual([payment]);
    }
    expect(matchesPaymentAccount(payment, new Set([30]))).toBe(false);
    expect(matchesPaymentAccount(ordinary, new Set([20]))).toBe(false);
    expect(matchesPaymentAccount(ordinary, new Set([30]))).toBe(true);
  });
  it("locates the exact ID, including a collapsed incoming leg, without searching descriptions", () => {
    const rows = [ordinary, payment];
    const incoming = { id: 3 } as Transaction;
    const pairs = new Map([[payment.id, incoming]]);
    expect(paymentDisplayIndex(rows, pairs, 1)).toBe(1);
    expect(paymentDisplayIndex(rows, pairs, 3)).toBe(1);
    expect(paymentDisplayIndex(rows, pairs, 99)).toBe(-1);
  });
});
