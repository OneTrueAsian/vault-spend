/** Pure logic behind the import review inbox: which transactions need a
 * human look after an import (or any time), and a best-guess category for the
 * ones with none. Kept out of the dialog so it can be unit tested. */

import { isTransferTransaction } from "./transfers";
import type { AnomalyFlag, Transaction } from "./types";

/** An auto-categorization the classifier made below this confidence is worth
 * a second look. (Rule matches are exact and never flagged.) */
export const LOW_CONFIDENCE = 0.7;

export type InboxReasonKind = "uncategorized" | "low_confidence" | "duplicate" | "large";

export type InboxReason = { kind: InboxReasonKind; detail: string };

export type InboxItem = {
  transaction: Transaction;
  /** Why it's here, in a fixed order (category first). */
  reasons: InboxReason[];
  /** For an uncategorized row: the category other transactions from the same
   * merchant carry, and how many back it up. */
  suggestion: { category: string; support: number } | null;
};

/** Words that say how a card was charged, not who was paid. */
const NOISE = new Set([
  "the", "and", "inc", "llc", "ltd", "corp", "pos", "purchase", "debit", "credit", "card", "checkcard",
  "payment", "pmt", "ach", "www", "com", "online", "recurring", "withdrawal", "visa", "mastercard",
]);

/** The words of a description that identify the merchant: lower-cased, at
 * least three letters, not a bare number, not card-processor noise. */
function merchantTokens(description: string): string[] {
  return description
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !NOISE.has(w));
}

/** The category people have most often given transactions from the same
 * merchant — the description's first meaningful word must appear in the other
 * transaction's description. A tie goes to the more recent use. `null` when
 * the merchant has no categorized history (or the description is all noise). */
export function suggestCategory(
  description: string,
  history: Pick<Transaction, "description" | "category" | "date">[],
): { category: string; support: number } | null {
  const [merchant] = merchantTokens(description);
  if (!merchant) return null;

  const tally = new Map<string, { support: number; latest: string }>();
  for (const row of history) {
    if (row.category === null || !merchantTokens(row.description).includes(merchant)) continue;
    const entry = tally.get(row.category) ?? { support: 0, latest: "" };
    entry.support += 1;
    if (row.date > entry.latest) entry.latest = row.date;
    tally.set(row.category, entry);
  }

  let best: { category: string; support: number; latest: string } | null = null;
  for (const [category, entry] of tally) {
    if (best === null || entry.support > best.support || (entry.support === best.support && entry.latest > best.latest)) {
      best = { category, ...entry };
    }
  }
  return best ? { category: best.category, support: best.support } : null;
}

const KIND_ORDER: InboxReasonKind[] = ["uncategorized", "low_confidence", "duplicate", "large"];

/** Every transaction that needs a look, most pressing first: no category,
 * then a shaky auto-category, then possible duplicates, then unusually large
 * ones (newest first within each). `scopeIds` limits it to particular
 * transactions — the rows just imported — or `null` for everything. A linked
 * transfer's legs never need a category, so they're left out. */
export function buildInbox({
  transactions,
  flags,
  scopeIds,
}: {
  transactions: Transaction[];
  flags: AnomalyFlag[];
  scopeIds: Set<number> | null;
}): InboxItem[] {
  const flagsByTransaction = new Map<number, AnomalyFlag[]>();
  for (const flag of flags) {
    const list = flagsByTransaction.get(flag.transaction_id) ?? [];
    list.push(flag);
    flagsByTransaction.set(flag.transaction_id, list);
  }

  // What the merchant guess learns from: categories a person or a rule set,
  // never the classifier's own earlier guesses.
  const history = transactions.filter((t) => t.category !== null && t.category_source !== "classifier");

  const items: InboxItem[] = [];
  for (const transaction of transactions) {
    if (scopeIds && !scopeIds.has(transaction.id)) continue;
    if (isTransferTransaction(transaction)) continue;

    const reasons: InboxReason[] = [];
    if (transaction.category === null) {
      reasons.push({ kind: "uncategorized", detail: "No category yet" });
    } else if (
      transaction.category_source === "classifier" &&
      transaction.confidence !== null &&
      transaction.confidence < LOW_CONFIDENCE
    ) {
      reasons.push({ kind: "low_confidence", detail: `Guessed ${transaction.category} (${Math.round(transaction.confidence * 100)}% sure)` });
    }
    for (const flag of flagsByTransaction.get(transaction.id) ?? []) {
      reasons.push({ kind: flag.kind, detail: flag.detail });
    }
    if (reasons.length === 0) continue;
    reasons.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

    items.push({
      transaction,
      reasons,
      suggestion:
        transaction.category === null
          ? suggestCategory(
              transaction.description,
              history.filter((h) => h.id !== transaction.id),
            )
          : null,
    });
  }

  const tier = (item: InboxItem) => Math.min(...item.reasons.map((r) => KIND_ORDER.indexOf(r.kind)));
  items.sort((a, b) => tier(a) - tier(b) || b.transaction.date.localeCompare(a.transaction.date) || b.transaction.id - a.transaction.id);
  return items;
}
