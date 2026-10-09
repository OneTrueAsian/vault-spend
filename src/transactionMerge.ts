import type { Transaction } from "./types";
/** Preserve full-model order, replace requested survivors and remove requested deletions. */
export function mergeTransactionRows(previous: Transaction[], requested: number[], returned: Transaction[]) {
  const asked = new Set(requested),
    rows = new Map(returned.map((row) => [row.id, row]));
  const matched = new Set<number>();
  const transactions: Transaction[] = [];
  for (const row of previous) {
    const replacement = rows.get(row.id);
    if (replacement) {
      transactions.push(replacement);
      matched.add(row.id);
    } else if (!asked.has(row.id)) transactions.push(row);
  }
  return { transactions, hasNewRows: matched.size !== returned.length };
}
