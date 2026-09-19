import type { Transaction } from "./types";

/** Money moving between the user's own accounts — neither income nor
 * spending. True for the "Transfer" category and for either leg of a
 * linked pair (see the backend's `Store::link_transfer`), whatever category
 * that leg carries. Every frontend calculation that decides "is this real
 * income/spending?" uses this so it can't disagree with the backend. */
export function isTransferTransaction(t: { category: string | null; transfer_counterpart_id?: number | null }): boolean {
  return t.category === "Transfer" || (t.transfer_counterpart_id ?? null) !== null;
}

/** For display: shows each linked transfer as one row instead of two. When
 * *both* legs of a linked pair are in `transactions`, the outgoing leg keeps
 * its place and the incoming leg is dropped (and remembered in
 * `inLegByOutId`, so the row can show where the money went). A leg whose
 * partner isn't in the list — say the Transactions tab is filtered to just
 * the savings account — stays as an ordinary row rather than vanishing. */
export function collapseTransferPairs(transactions: Transaction[]): {
  rows: Transaction[];
  inLegByOutId: Map<number, Transaction>;
} {
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const inLegByOutId = new Map<number, Transaction>();
  const hiddenInLegIds = new Set<number>();
  for (const t of transactions) {
    if (t.transfer_counterpart_id === null || parseFloat(t.amount) >= 0) continue; // only start from an outgoing leg
    const partner = byId.get(t.transfer_counterpart_id);
    if (!partner) continue;
    inLegByOutId.set(t.id, partner);
    hiddenInLegIds.add(partner.id);
  }
  return { rows: transactions.filter((t) => !hiddenInLegIds.has(t.id)), inLegByOutId };
}

/** Whether two transactions can be linked as one transfer: different
 * accounts, one going out and one coming in, and neither already linked.
 * Mirrors `Store::link_transfer`'s own rules, so the "Link as transfer"
 * button only appears when the backend will accept it. */
export function canLinkAsTransfer(a: Transaction, b: Transaction): boolean {
  if (a.account_id === b.account_id) return false;
  if (a.transfer_counterpart_id !== null || b.transfer_counterpart_id !== null) return false;
  const amountA = parseFloat(a.amount);
  const amountB = parseFloat(b.amount);
  if (amountA === 0 || amountB === 0) return false;
  return amountA < 0 !== amountB < 0;
}
