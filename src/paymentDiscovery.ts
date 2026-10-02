import type { Transaction } from "./types";

/** Account filtering includes the funding side and the applied debt side,
 * while the row and all its other filters still belong to the source. */
export function matchesPaymentAccount(t: Transaction, accounts: "all" | ReadonlySet<number>): boolean {
  return accounts === "all" || accounts.has(t.account_id) ||
    (t.applied_to_debt !== null && accounts.has(t.applied_to_debt.debt_account_id));
}

export function paymentDisplayIndex(rows: Transaction[], incomingByOutgoing: Map<number, Transaction>, id: number): number {
  return rows.findIndex(t => t.id === id || incomingByOutgoing.get(t.id)?.id === id);
}
