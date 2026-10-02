import type { Account } from "./types";

/** What the import's "Which way do the amounts go?" question should preselect, and why. `flip: null` means
 * no suggestion (the question is asked exactly as before). */
export type ImportSignSuggestion = {
  flip: boolean | null;
  reason: "remembered" | "credit-positive" | null;
};

/** How many of a file's amounts are positive and negative, as written (the `count_import_signs` command). */
export type ImportSignCounts = { positive: number; negative: number };

/**
 * The answer the last import into this account used, if there was one. Otherwise, for a credit card whose
 * file is mostly positive amounts, "Flip the signs": a card export like that shows charges as positive
 * (payments negative), the reverse of this app's money-out-is-negative.
 */
export function importSignSuggestion(
  account: Pick<Account, "account_type" | "import_flip_signs"> | undefined,
  counts: ImportSignCounts | null,
): ImportSignSuggestion {
  if (account && account.import_flip_signs !== null) return { flip: account.import_flip_signs, reason: "remembered" };
  if (account?.account_type === "credit" && counts && counts.positive > counts.negative) return { flip: true, reason: "credit-positive" };
  return { flip: null, reason: null };
}

/** The bulk "Flip signs" confirmation: how many rows, in which accounts. */
export function flipConfirmText(count: number, accountNames: string[]): string {
  const names =
    accountNames.length <= 1 ? (accountNames[0] ?? "") : `${accountNames.slice(0, -1).join(", ")} and ${accountNames[accountNames.length - 1]}`;
  return `Flip the sign of ${count} transaction${count === 1 ? "" : "s"} in ${names}?`;
}
