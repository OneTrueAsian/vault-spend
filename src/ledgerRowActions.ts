import type { Transaction } from "./types";

export type LedgerRowActionId = "split" | "principal" | "applyDebt" | "note" | "tag" | "delete";

export interface LedgerRowActionContext {
  /** Settings > "Split purchases" is on. */
  splitEnabled: boolean;
  /** Settings > "Apply payments to a debt" is on. */
  debtEnabled: boolean;
  /** The row's own account is a loan, where a payment's principal is set directly. */
  isLoanAccount: boolean;
  /** There is a loan or card to apply to, and this row isn't on a credit card. */
  canApplyToDebt: boolean;
  /** The loan payment already has its principal set (Reset sits under the description). */
  hasPrincipalOverride: boolean;
  /** The payment is already applied to a debt (Undo sits under the description). */
  hasAppliedDebt: boolean;
}

/** Which items a ledger row's `⋯` menu offers, in order. Pure, so the rules are tested on their own. */
export function ledgerRowActions(
  t: Pick<Transaction, "amount" | "split_count" | "notes">,
  ctx: LedgerRowActionContext,
): { id: LedgerRowActionId; label: string }[] {
  const actions: { id: LedgerRowActionId; label: string }[] = [];
  if (ctx.splitEnabled) actions.push({ id: "split", label: t.split_count > 0 ? "Edit splits…" : "Split…" });
  if (ctx.isLoanAccount) {
    if (ctx.debtEnabled && !ctx.hasPrincipalOverride) actions.push({ id: "principal", label: "Split principal…" });
  } else if (ctx.debtEnabled && ctx.canApplyToDebt && parseFloat(t.amount) < 0 && !ctx.hasAppliedDebt) {
    actions.push({ id: "applyDebt", label: "Apply to a debt…" });
  }
  actions.push({ id: "note", label: t.notes ? "Edit note…" : "Add note…" });
  actions.push({ id: "tag", label: "Add tag…" });
  actions.push({ id: "delete", label: "Delete…" });
  return actions;
}
