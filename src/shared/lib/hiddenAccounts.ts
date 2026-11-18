/** A hidden account is tidied out of lists, not out of the books (QA-GAP-001). The pickers that choose where
 * something new goes (a transaction, an import, a recurring item, a goal's linked account, a holding file)
 * leave hidden accounts out; the Accounts page, history, filters, totals and reports keep them. */
export function pickableAccounts<T extends { id: number; hidden: boolean }>(
  accounts: readonly T[],
  ...keep: (number | string | null | undefined)[]
): T[] {
  const kept = new Set(keep.filter((k) => k !== null && k !== undefined && k !== "").map(Number));
  return accounts.filter((a) => !a.hidden || kept.has(a.id));
}

export function hiddenAccountCount(accounts: readonly { hidden: boolean }[]): number {
  return accounts.filter((a) => a.hidden).length;
}
