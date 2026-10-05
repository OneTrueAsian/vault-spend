/** Small pure helpers for the Transactions tab. */

import { formatAmount } from "./format";
import type { Account, Transaction } from "./types";
import type { LedgerSortColumn } from "./appTypes";

export function compareTransactionsBy(a: Transaction, b: Transaction, column: LedgerSortColumn): number {
  switch (column) {
    case "date":
      return a.date.localeCompare(b.date);
    case "description":
      return a.description.localeCompare(b.description);
    case "amount":
      return parseFloat(a.amount) - parseFloat(b.amount);
    case "account":
      return a.account_name.localeCompare(b.account_name);
    case "category":
      return (a.category ?? "").localeCompare(b.category ?? "");
    case "source":
      return (a.category_source ?? "").localeCompare(b.category_source ?? "");
  }
}

/** What deleting a transaction will do to its account's number, worded to
 * match what that account actually displays — "balance" for cash/other
 * accounts, "amount owed" for credit/loan (see AccountsView's identical
 * framing). Credit and loan both track "amount owed" in a way that moves
 * opposite a plain balance: a credit account's tracked value is
 * *available* credit (owed = limit − available), and a loan's
 * `current_balance` is owed directly but a positive (payment) transaction
 * *reduces* it (see `account_balance_as_of` on the Rust side) — so for
 * both, removing a negative transaction raises the tracked number and
 * therefore *lowers* what's owed, the opposite direction from every other
 * account type, where the tracked value and "owed" move together. Returns
 * `null` for a zero amount (no impact to explain) or an unknown account. */
export function describeDeleteImpact(amount: string, account: Account | undefined): string | null {
  if (!account) return null;
  const parsed = parseFloat(amount);
  if (Number.isNaN(parsed) || parsed === 0) return null;

  const isCredit = account.account_type === "credit";
  const isLoan = account.account_type === "loan";
  const label = isCredit || isLoan ? "amount owed" : "balance";
  const trackedValueGoesUp = parsed < 0; // removing a negative (expense) frees up that much
  const displayedNumberGoesUp = isCredit || isLoan ? !trackedValueGoesUp : trackedValueGoesUp;
  const direction = displayedNumberGoesUp ? "increase" : "decrease";
  return `Deleting this will ${direction} ${account.name}'s ${label} by ${formatAmount(Math.abs(parsed).toFixed(2))}.`;
}

/** How many columns the Transactions table has, for full-width rows (`colSpan`): select, date,
 * description, amount and actions always; account, category and "Sorted by" when not narrow; and the
 * member column only when it shows (wide, and two or more family members). */
export function ledgerColumnCount(narrow: boolean, showMemberCol: boolean): number {
  if (narrow) return 5;
  return 8 + (showMemberCol ? 1 : 0);
}
