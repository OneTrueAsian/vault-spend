import { array, boolean, date, decimal, id, integer, nullable, object, string, type Check } from "./contractChecks";
import { TransactionError } from "./transactionContracts";
import { formatAmount } from "./format";

/** The most transactions one move may name; the same limit as the native command. */
export const MAX_MOVE_TRANSACTIONS = 10_000;

export type MoveWarning = { code: string; count: number; detail: string };
export type BlockedItem = { transactionId: number; detail: string };
export type MoveBlocker = { code: string; count: number; summary: string; items: BlockedItem[] };
export type MoveRow = { id: number; date: string; description: string; amount: string; accountId: number; accountName: string; status: "move" | "blocked" | "already_there" };
export type AccountEffect = {
  accountId: number; accountName: string; accountType: string; role: "source" | "destination"; movedCount: number;
  label: "Balance" | "Owed" | "Holdings value"; current: string; projected: string;
  availableCurrent: string | null; availableProjected: string | null; transactionChange: string; holdingsOverride: boolean;
  /** False while the balance after the move still has to be confirmed (then `projected` only repeats `current`). */
  projectedIsFinal: boolean;
};
/** One balance the person has to give (or keep) before a historical move can go ahead. */
export type ConfirmationAccount = {
  accountId: number; accountName: string; accountType: string; inputLabel: "Balance" | "Amount owed"; currentDisplay: string;
  creditLimit: string | null; availableCredit: string | null; reasons: string[]; confirmedDisplay: string | null;
  choice: "set" | "keep" | null; projectedBaseline: string | null; problem: string | null;
};
export type CheckpointEffects = { correctedCount: number; firstDate: string | null; lastDate: string | null; notes: string[] };
/** A balance as the person supplied it; native parses it, so no money is ever calculated from it here. */
export type BalanceInput = { accountId: number; keep: boolean; value: string | null };
export type MovePreview = {
  destinationAccountId: number; destinationName: string; asOf: string; selectedCount: number; effectiveCount: number; alreadyThereCount: number;
  normalizedIds: number[]; sources: { accountId: number; accountName: string; count: number }[]; firstDate: string | null; lastDate: string | null;
  total: string; rows: MoveRow[]; effects: AccountEffect[]; warnings: MoveWarning[]; blockers: MoveBlocker[]; canCommit: boolean; token: string;
  status: "ready" | "needs_balance_confirmation" | "blocked"; mode: "automatic" | "confirmation"; confirmations: ConfirmationAccount[];
  checkpointEffects: CheckpointEffects; netBefore: string; netAfter: string;
};
export type MovePreviewResponse = { contractVersion: 2; revision: { local: number; external: number }; preview: MovePreview };
export type MoveStatus = "moved" | "nothing_to_move" | "stale_preview" | "blocked" | "operation_conflict";
export type MoveResult = {
  contractVersion: 2; status: MoveStatus; movedIds: number[]; movedCount: number; alreadyThereIds: number[]; alreadyThereCount: number;
  affectedAccountIds: number[]; blockers: MoveBlocker[]; mode: "automatic" | "confirmation"; operationId: string | null; replayed: boolean;
  correctedCheckpoints: number; confirmedAccountIds: number[]; revision: { local: number; external: number };
};
/** One earlier move as the profile's audit record keeps it. */
export type MoveRecord = {
  operationId: string; mode: "automatic" | "confirmation"; effectiveDate: string; destinationAccountId: number; destinationName: string;
  movedCount: number; movedIds: number[]; affectedAccountIds: number[]; confirmedAccountIds: number[]; correctedCheckpoints: number;
  accounts: { accountId: number; name: string; role: string; label: string; displayedBefore: string; displayedAfter: string }[];
  inputs: unknown; corrections: number;
};

const revision = object({ local: integer, external: integer });
const warning = object({ code: string, count: integer, detail: string });
const blocker = object({ code: string, count: integer, summary: string, items: array(object({ transactionId: id, detail: string })) });
const oneOf = (...values: string[]): Check => (v) => typeof v === "string" && values.includes(v);
const effect = object({
  accountId: id, accountName: string, accountType: string, role: oneOf("source", "destination"), movedCount: integer,
  label: oneOf("Balance", "Owed", "Holdings value"), current: decimal, projected: decimal,
  availableCurrent: nullable(decimal), availableProjected: nullable(decimal), transactionChange: decimal, holdingsOverride: boolean, projectedIsFinal: boolean,
});
const confirmation = object({
  accountId: id, accountName: string, accountType: string, inputLabel: oneOf("Balance", "Amount owed"), currentDisplay: decimal,
  creditLimit: nullable(decimal), availableCredit: nullable(decimal), reasons: array(string), confirmedDisplay: nullable(decimal),
  choice: nullable(oneOf("set", "keep")), projectedBaseline: nullable(decimal), problem: nullable(string),
});
const row = object({ id, date, description: string, amount: decimal, accountId: id, accountName: string, status: oneOf("move", "blocked", "already_there") });
const preview: Check = (v) => {
  if (!object({
    destinationAccountId: id, destinationName: string, asOf: date, selectedCount: integer, effectiveCount: integer, alreadyThereCount: integer,
    normalizedIds: array(id), sources: array(object({ accountId: id, accountName: string, count: integer })), firstDate: nullable(date), lastDate: nullable(date),
    total: decimal, rows: array(row), effects: array(effect), warnings: array(warning), blockers: array(blocker), canCommit: boolean, token: (t) => typeof t === "string" && t.length > 0,
    status: oneOf("ready", "needs_balance_confirmation", "blocked"), mode: oneOf("automatic", "confirmation"), confirmations: array(confirmation),
    checkpointEffects: object({ correctedCount: integer, firstDate: nullable(date), lastDate: nullable(date), notes: array(string) }), netBefore: decimal, netAfter: decimal,
  })(v)) return false;
  const p = v as MovePreview;
  // Counts must agree with the rows, and a plan with blockers can never be confirmed.
  return p.rows.length === p.selectedCount && p.normalizedIds.length === p.selectedCount
    && p.effectiveCount + p.alreadyThereCount === p.selectedCount
    && p.rows.filter((r) => r.status !== "already_there").length === p.effectiveCount
    && (!p.canCommit || (p.blockers.length === 0 && p.effectiveCount > 0 && p.status === "ready"))
    && (p.status !== "blocked" || p.blockers.length > 0)
    && (p.status !== "needs_balance_confirmation" || (p.mode === "confirmation" && p.confirmations.length > 0 && !p.canCommit))
    && (p.mode !== "confirmation" || p.status === "blocked" || p.confirmations.length > 0 || p.effectiveCount === 0);
};
const previewResponse = object({ contractVersion: (v) => v === 2, revision, preview });
const result: Check = (v) => {
  if (!object({
    contractVersion: (c) => c === 2, status: oneOf("moved", "nothing_to_move", "stale_preview", "blocked", "operation_conflict"), movedIds: array(id), movedCount: integer,
    alreadyThereIds: array(id), alreadyThereCount: integer, affectedAccountIds: array(id), blockers: array(blocker), mode: oneOf("automatic", "confirmation"),
    operationId: nullable(string), replayed: boolean, correctedCheckpoints: integer, confirmedAccountIds: array(id), revision,
  })(v)) return false;
  const r = v as MoveResult;
  return r.movedIds.length === r.movedCount && r.alreadyThereIds.length === r.alreadyThereCount
    && (r.status !== "moved" || r.movedCount > 0) && (r.status === "moved" || r.movedCount === 0)
    && (r.status !== "blocked" || r.blockers.length > 0);
};

function validated<T>(value: unknown, check: Check, what: string): T {
  if (!check(value)) throw new TransactionError("invalid_response", `The app received an incomplete ${what}. Reload the transactions and check where they are before trying again.`);
  return value as T;
}
export const validateMovePreview = (value: unknown) => validated<MovePreviewResponse>(value, previewResponse, "move preview");
export const validateMoveResult = (value: unknown) => validated<MoveResult>(value, result, "move result");
const record = object({
  operationId: string, mode: oneOf("automatic", "confirmation"), effectiveDate: date, destinationAccountId: id, destinationName: string, movedCount: integer,
  movedIds: array(id), affectedAccountIds: array(id), confirmedAccountIds: array(id), correctedCheckpoints: integer,
  accounts: array(object({ accountId: id, name: string, role: string, label: string, displayedBefore: decimal, displayedAfter: decimal })), inputs: () => true, corrections: integer,
});
export const validateMoveRecord = (value: unknown) => validated<{ contractVersion: 2; record: MoveRecord | null }>(value, object({ contractVersion: (v) => v === 2, record: (r) => r === null || record(r) }), "move record");
export const validateMoveRecords = (value: unknown) => validated<MoveRecord[]>(value, array(record), "move history");

const noun = (n: number) => `${n} transaction${n === 1 ? "" : "s"}`;
export const moveTransactionsText = noun;

/** What to tell the person once a move has been committed. */
export function movedMessage(result: Pick<MoveResult, "movedCount" | "alreadyThereCount">, destination: string): string {
  const base = `Moved ${noun(result.movedCount)} to ${destination}.`;
  return result.alreadyThereCount > 0 ? `${base} ${result.alreadyThereCount} ${result.alreadyThereCount === 1 ? "was" : "were"} already there.` : base;
}

/** What to tell the person once a move is known to have been applied, by whichever route. */
export function movedWithBalancesMessage(result: Pick<MoveResult, "movedCount" | "alreadyThereCount" | "mode" | "correctedCheckpoints" | "confirmedAccountIds">, destination: string): string {
  const base = movedMessage(result, destination);
  if (result.mode === "confirmation") {
    const n = result.confirmedAccountIds.length;
    return `${base} The balance${n === 1 ? "" : "s"} you confirmed now apply${n === 1 ? "s" : ""} from today.`;
  }
  return result.correctedCheckpoints > 0 ? `${base} ${result.correctedCheckpoints} saved balance${result.correctedCheckpoints === 1 ? " was" : "s were"} corrected.` : base;
}

export const NOT_REFRESHED_MESSAGE = "Transactions moved, but the updated list could not load. Retry loading.";
export const UNCERTAIN_MESSAGE = "Vault Spend could not confirm whether the move finished. The list is reloaded below; check where the transactions are before trying again. Nothing is retried automatically.";

/** Money as the app shows it: `-$1,234.50`. */
export const money = (amount: string) => formatAmount(amount);

/** A one-line summary of an account's before and after in its own terms ("Owed $125.50 → $0.00"). */
/** Why a plain account balance moves the way it does, in words; nothing for credit, loan or holdings accounts, whose
 * numbers read differently. */
export function effectReason(effect: AccountEffect): string | null {
  if (effect.holdingsOverride || effect.label !== "Balance") return null;
  const cents = (v: string) => Math.round(Number(v) * 100);
  const delta = cents(effect.projected) - cents(effect.current);
  if (delta === 0) return null;
  const amount = money((Math.abs(delta) / 100).toFixed(2));
  const rises = delta > 0;
  const addsMoney = effect.role === "source" ? !rises : rises;
  const lead = effect.role === "source" ? "Taking them out" : "Bringing them in";
  const together = effect.role === "source" ? (addsMoney ? "added money to it" : "took money out of it") : addsMoney ? "add money to it" : "take money out of it";
  return `${lead} ${rises ? "raises" : "lowers"} this balance by ${amount}, because together they ${together}.`;
}

export function effectLine(effect: AccountEffect): string {
  if (effect.holdingsOverride) return `${effect.label} ${money(effect.current)}, unchanged (it follows your holdings)`;
  return `${effect.label} ${money(effect.current)} → ${money(effect.projected)}`;
}
