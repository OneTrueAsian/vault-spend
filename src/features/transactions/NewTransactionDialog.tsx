import { type Account, type FamilyMember, type ReportBudgetLine } from "../../shared/lib/types";
import { pickableAccounts } from "../../shared/lib/hiddenAccounts";
import { useState, useId, FormEvent } from "react";
import { toLocalIsoDate, formatDisplayDate, formatAmount } from "../../shared/lib/format";
import { type Direction, signedAmount, amountProblem, directionLabels } from "../../shared/lib/transactionDirection";
import { isBeforeAccountCheckpoint } from "../../shared/lib/accountGroups";
import { FinancialReadState } from "../../shared/native/FinancialReadState";
import { MenuSelect } from "../../shared/ui/MenuSelect";
import { DateField } from "../../shared/ui/DateField";
import { effectiveBudget } from "../../shared/lib/budgetPlan";
import { ModalShell } from "../../shared/ui/Modal";

/** The Transactions tab's "Add transaction" — the one way to get a single
 * transaction in without a file import (see `App.tsx`'s
 * `handleCreateManualTransaction`). Leaving Category on "Auto-categorize"
 * runs it through the same categorization pass an import row gets; picking
 * one explicitly skips that. There's no inline "+ New category" here
 * (unlike the Transactions tab's own row-level category dropdown) — every other
 * `askX()` dialog in this app is top-level, never nested inside another
 * modal, and leaving Category blank plus correcting it afterward via that
 * existing per-row dropdown already covers "I want a brand-new category"
 * without introducing a new stacked-modal pattern just for this form. */
export function NewTransactionDialog({
  accounts,
  categories,
  familyMembers,
  defaultAccountId,
  budgetActuals,
  budgetReadReady = true,
  budgetLoading = false,
  budgetError = null,
  onRetryBudgets = () => {},
  onCancel,
  onSubmit,
}: {
  accounts: Account[];
  categories: string[];
  familyMembers: FamilyMember[];
  defaultAccountId: number | null;
  /** Current calendar month's validated planning snapshot, independent of
   * the Budget page's month cursor. Optional hints do not block transaction entry. */
  budgetActuals: ReportBudgetLine[];
  budgetReadReady?: boolean;
  budgetLoading?: boolean;
  budgetError?: string | null;
  onRetryBudgets?: () => void;
  onCancel: () => void;
  onSubmit: (
    accountId: number,
    date: string,
    description: string,
    amount: string,
    category: string | null,
    memberId: number | null,
    notes: string | null,
  ) => void;
}) {
  // A hidden account is never the starting choice; the last-used account only is if it is showing.
  const startingAccounts = pickableAccounts(accounts);
  const [accountId, setAccountId] = useState(
    defaultAccountId !== null && startingAccounts.some((a) => a.id === defaultAccountId)
      ? String(defaultAccountId)
      : startingAccounts[0]
        ? String(startingAccounts[0].id)
        : "",
  );
  const [date, setDate] = useState(() => toLocalIsoDate());
  const [dateUsable, setDateUsable] = useState(true);
  const dateId = useId();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  // The switch, not a typed minus sign, decides whether the amount is money out or in.
  const [direction, setDirection] = useState<Direction>("out");
  const [category, setCategory] = useState("");
  const [memberId, setMemberId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const signed = signedAmount(amount, direction);
  const problem = amountProblem(amount);
  const amountError =
    problem === "empty"
      ? "Enter an amount."
      : problem === "zero"
        ? "Enter an amount other than zero."
        : problem === "not_a_number"
          ? "That doesn't look like a number."
          : null;
  const valid = accountId !== "" && description.trim() !== "" && signed !== null && date !== "" && dateUsable;

  const budgetImpact = budgetReadReady ? budgetActuals.find((b) => b.category === category) : undefined;
  const selectedAccount = accounts.find((a) => String(a.id) === accountId);
  const backdated = selectedAccount ? isBeforeAccountCheckpoint(selectedAccount, date) : false;
  const [outLabel, inLabel] = directionLabels(selectedAccount?.account_type);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!valid) return;
    if (signed === null) return;
    onSubmit(
      Number(accountId),
      date,
      description.trim(),
      signed,
      category || null,
      memberId ? Number(memberId) : null,
      notes.trim() === "" ? null : notes,
    );
  }

  return (
    <ModalShell title="Add transaction" onCancel={onCancel}>
      <form onSubmit={handleSubmit}>
        <FinancialReadState label="Budget hints" initial={!budgetReadReady} loading={budgetLoading}
          error={budgetError} onRetry={onRetryBudgets} />
        <label className="modal-field">
          <span>Account</span>
          <MenuSelect
            ariaLabel="Account"
            value={accountId}
            onChange={setAccountId}
            options={[
              ...(accounts.length === 0 ? [{ value: "", label: "No accounts yet" }] : []),
              ...pickableAccounts(accounts, accountId).map((a) => ({ value: String(a.id), label: a.name })),
            ]}
            fill
          />
        </label>
        <div className="modal-field">
          <label htmlFor={dateId}>Date</label>
          <DateField id={dateId} value={date} onChange={setDate} ariaLabel="Date" required onValidityChange={setDateUsable} />
          {backdated && selectedAccount && (
            <span className="field-hint field-warning">
              {selectedAccount.name}'s balance was last locked in as of {formatDisplayDate(selectedAccount.checkpoint_date ?? "")} — this
              transaction won't change today's balance shown on the Accounts page (it still counts in past balance
              history).
            </span>
          )}
        </div>
        <label className="modal-field">
          <span>Description</span>
          <input
            autoFocus
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='e.g. "Coffee shop"'
            aria-invalid={submitAttempted && description.trim() === ""}
          />
          {submitAttempted && description.trim() === "" && <span className="field-error">Enter a description.</span>}
        </label>
        <div
          className="view-toggle direction-toggle"
          role="radiogroup"
          aria-label="Direction"
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
            e.preventDefault();
            const next: Direction = direction === "out" ? "in" : "out";
            setDirection(next);
            e.currentTarget.querySelector<HTMLButtonElement>(`[data-direction="${next}"]`)?.focus();
          }}
        >
          {(["out", "in"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              tabIndex={direction === d ? 0 : -1}
              data-direction={d}
              className={direction === d ? "view-toggle-active" : ""}
              onClick={() => setDirection(d)}
            >
              {d === "out" ? outLabel : inLabel}
            </button>
          ))}
        </div>
        <label className="modal-field">
          <span>Amount</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            data-amount-input
            aria-invalid={submitAttempted && amountError !== null}
          />
          {submitAttempted && amountError && <span className="field-error">{amountError}</span>}
        </label>
        <label className="modal-field">
          <span>Category</span>
          <MenuSelect
            ariaLabel="Category"
            value={category}
            onChange={setCategory}
            options={[
              { value: "", label: "Auto-categorize" },
              ...categories.map((c) => ({ value: c, label: c })),
            ]}
            fill
          />
          {budgetImpact &&
            (() => {
              const budgeted = effectiveBudget(budgetImpact);
              const actual = parseFloat(budgetImpact.actual);
              const remaining = budgeted - actual;
              return (
                <span className={remaining < 0 ? "field-hint report-over-budget" : "field-hint"}>
                  {formatAmount(budgetImpact.actual)} of {formatAmount(budgeted.toFixed(2))} used this month —{" "}
                  {remaining < 0 ? `${formatAmount((-remaining).toFixed(2))} over budget` : `${formatAmount(remaining.toFixed(2))} left`}
                </span>
              );
            })()}
        </label>
        {familyMembers.length > 0 && (
          <label className="modal-field">
            <span>Family member (optional)</span>
            <MenuSelect
              ariaLabel="Family member (optional)"
              value={memberId}
              onChange={setMemberId}
              options={[
                { value: "", label: "Unassigned" },
                ...familyMembers.map((m) => ({ value: String(m.id), label: m.name })),
              ]}
              fill
            />
          </label>
        )}
        <label className="modal-field">
          <span>Note (optional)</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={accounts.length === 0}>
            Add transaction
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
