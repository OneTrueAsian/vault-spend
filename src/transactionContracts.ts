import type { Account, AnomalyFlag, CategoryIconEntry, FamilyMember, Transaction } from "./types";
import type { Stats } from "./appTypes";
import { string, boolean, integer, id, decimal, date, nullable, array, object } from "./contractChecks";

export class TransactionError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "TransactionError"; }
}
export function transactionError(error: unknown): TransactionError {
  if (error instanceof TransactionError) return error;
  if (error && typeof error === "object" && "code" in error && "message" in error && typeof error.code === "string" && typeof error.message === "string") return new TransactionError(error.code, error.message);
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "The transaction request failed.";
  const prefixes: Record<string, string> = { PROFILE_LOCKED: "profile_locked", NO_PROFILE_OPEN: "no_profile_open", STALE_PROFILE: "stale_profile" };
  const match = /^([A-Z_]+):\s*(.*)$/s.exec(message);
  return new TransactionError(match && prefixes[match[1]] ? prefixes[match[1]] : "legacy_failure", match && prefixes[match[1]] ? match[2] : message);
}
const debt = object({ date, debt_account_id: id, debt_account_name: string, amount: decimal });
const row = object({ id, transfer_counterpart_id: nullable(id), date, description: string, amount: decimal, category: nullable(string), category_source: v => v === null || v === "rule" || v === "user" || v === "classifier", confidence: nullable(v => typeof v === "number" && Number.isFinite(v)), account_id: id, account_name: string, applied_to_debt: nullable(debt), principal_amount: nullable(decimal), split_count: integer, tags: array(string), member_id: nullable(id), member_name: nullable(string), notes: nullable(string) });
const account = object({ id, name: string, account_type: string, starting_balance: decimal, current_balance: decimal, institution: nullable(string), mask: nullable(string), interest_rate: nullable(decimal), excluded_from_debt_payoff: boolean, member_id: nullable(id), member_name: nullable(string), checkpoint_date: nullable(date), icon_key: nullable(string), import_flip_signs: nullable(boolean) });
const stats = object({ total: integer, auto_categorized: integer, user_confirmed: integer, uncategorized: integer });
export type TransactionContext = { contractVersion: 1; generation: number; sessionRevision: number };
export type TransactionSnapshot = {
  contractVersion: 1; context: TransactionContext; revision: { local: number; external: number }; requestedIds: number[] | null;
  transactions: Transaction[]; stats: Stats; accounts: Account[]; categories: string[]; categoryIcons: CategoryIconEntry[]; flags: AnomalyFlag[]; tags: string[]; members: FamilyMember[];
};
const context = object({ contractVersion: v => v === 1, generation: integer, sessionRevision: integer });
function validate<T>(value: unknown, check: (value: unknown) => boolean): T {
  if (!check(value)) throw new TransactionError("invalid_response", "The app received an incomplete transaction response. Retry loading your data.");
  return value as T;
}
export const validateTransactions = (value: unknown) => validate<Transaction[]>(value, array(row));
export const validateTransactionContext = (value: unknown) => validate<TransactionContext>(value, context);
export const validateTransactionSnapshot = (value: unknown) => {
  const result = validate<TransactionSnapshot>(value, object({ contractVersion: v => v === 1, context, revision: object({ local: integer, external: integer }), requestedIds: nullable(array(id)), transactions: array(row), stats, accounts: array(account), categories: array(string), categoryIcons: array(object({ name: string, icon_key: nullable(string) })), flags: array(object({ transaction_id: id, kind: string, detail: string })), tags: array(string), members: array(object({ id, name: string })) }));
  if (new Set(result.transactions.map(t => t.id)).size !== result.transactions.length || (result.requestedIds === null && result.stats.total !== result.transactions.length)) throw new TransactionError("invalid_response", "Transaction totals did not match the returned rows.");
  if (result.requestedIds !== null) {
    const asked = new Set(result.requestedIds);
    if (result.transactions.some(row => !asked.has(row.id))) throw new TransactionError("invalid_response", "The response included unrequested transaction rows.");
  }
  return result;
};
