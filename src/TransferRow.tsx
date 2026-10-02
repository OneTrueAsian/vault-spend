import { ArrowLeftRight } from "lucide-react";
import type { Transaction } from "./types";
import { AppliedPaymentDetails } from "./AppliedPaymentDetails";
import { formatAmount } from "./format";

/** One linked transfer shown as a single Transactions row instead of two —
 * "Everyday Checking → High-Yield Savings", with the amount unsigned (money
 * moving between your own accounts isn't a gain or a loss). Built from the
 * outgoing leg and the incoming leg `collapseTransferPairs` paired up.
 * Deliberately not editable inline: to change either side's date, amount or
 * description, unlink it first — the two transactions are then ordinary rows
 * again. Selecting the row selects both legs. Each leg is still its own
 * transaction underneath, though, so each keeps its own note action. */

/** One leg's note action — its own account label, its own transaction, never
 * the other leg's. Mirrors the plain row's Add note/Edit note button so the
 * two look and behave the same, just addressed at one specific leg. */
function LegNoteAction({ leg, role, onEditNote }: { leg: Transaction; role: "outgoing" | "incoming"; onEditNote: (t: Transaction) => void }) {
  const preview = leg.notes && leg.notes.length > 28 ? `${leg.notes.slice(0, 28)}…` : leg.notes;
  return leg.notes ? (
    <button
      type="button"
      className="modal-secondary btn-sm transaction-note-preview"
      onClick={() => onEditNote(leg)}
      title={leg.notes}
      aria-label={`Edit note for ${leg.account_name} (${role} leg)`}
    >
      {leg.account_name}: {preview}
    </button>
  ) : (
    <button
      type="button"
      className="modal-secondary btn-sm transaction-note-add"
      onClick={() => onEditNote(leg)}
      aria-label={`Add note for ${leg.account_name} (${role} leg)`}
    >
      {leg.account_name}: + Add note
    </button>
  );
}

export function TransferRow({
  out,
  highlighted = false,
  incoming,
  selected,
  onToggleSelected,
  onUnlink,
  onEditNote,
  showDebtColumn,
  narrow,
  detailsOpen,
  onToggleDetails,
}: {
  out: Transaction;
  highlighted?: boolean;
  incoming: Transaction;
  selected: boolean;
  onToggleSelected: () => void;
  onUnlink: () => void;
  /** Each leg is still its own transaction, so notes are edited per leg. */
  onEditNote: (t: Transaction) => void;
  /** Whether the ledger has its (empty here) Debt column, so this row lines up. */
  showDebtColumn: boolean;
  /** Below the ledger's narrow breakpoint, the account line, Transfer badge,
   * and Source move into an expandable Details panel, same as an ordinary
   * row's Account/Member/Category/Source/Debt do. */
  narrow: boolean;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  const accountsLine = (
    <span>
      {out.account_name} → {incoming.account_name}
    </span>
  );
  return (
    <>
      <tr data-payment-row={out.id} tabIndex={-1} className={`ledger-row-transfer${selected ? " ledger-row-selected" : ""}${highlighted ? " payment-row-highlight" : ""}`}>
        <td className="select-col">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Select transfer from ${out.account_name} to ${incoming.account_name}`}
          />
        </td>
        <td>
          <span className="date-cell">{out.date}</span>
        </td>
        <td>
          <span className="cell-with-icon" title={`${out.description} → ${incoming.description}`}>
            <span className="row-icon-badge">
              <ArrowLeftRight aria-hidden="true" />
            </span>
            <span>{out.description}</span>
          </span>
          <AppliedPaymentDetails transaction={out} />
          <AppliedPaymentDetails transaction={incoming} />
          <div className="transfer-row-notes">
            <LegNoteAction leg={out} role="outgoing" onEditNote={onEditNote} />
            <LegNoteAction leg={incoming} role="incoming" onEditNote={onEditNote} />
          </div>
        </td>
        <td className="amount-col">
          <span className="transfer-amount">{formatAmount(incoming.amount)}</span>
        </td>
        {!narrow && (
          <td className="account-col transfer-accounts" colSpan={2}>
            {accountsLine}
          </td>
        )}
        {!narrow && (
          <td>
            <span className="transfer-badge">Transfer</span>
          </td>
        )}
        {!narrow && <td className="source-col">linked</td>}
        {!narrow && showDebtColumn && <td className="debt-col"></td>}
        <td className="actions-col">
          {narrow && (
            <button type="button" className="modal-secondary" aria-expanded={detailsOpen} onClick={onToggleDetails}>
              {detailsOpen ? "Hide details" : "Details"}
            </button>
          )}
          <button type="button" className="modal-secondary" onClick={onUnlink} title="Show these as two separate transactions again">
            Unlink
          </button>
        </td>
      </tr>
      {narrow && detailsOpen && (
        <tr className="ledger-details-row">
          <td colSpan={5}>
            <div className="ledger-details">
              <label className="ledger-details-field">
                <span>Accounts</span>
                {accountsLine}
              </label>
              <label className="ledger-details-field">
                <span>Category</span>
                <span className="transfer-badge">Transfer</span>
              </label>
              <label className="ledger-details-field">
                <span>Source</span>
                <span>linked</span>
              </label>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
