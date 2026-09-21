import { ArrowLeftRight } from "lucide-react";
import type { Transaction } from "./types";
import { formatAmount } from "./format";

/** One linked transfer shown as a single Transactions row instead of two —
 * "Everyday Checking → High-Yield Savings", with the amount unsigned (money
 * moving between your own accounts isn't a gain or a loss). Built from the
 * outgoing leg and the incoming leg `collapseTransferPairs` paired up.
 * Deliberately not editable inline: to change either side's date, amount or
 * description, unlink it first — the two transactions are then ordinary rows
 * again. Selecting the row selects both legs. */
export function TransferRow({
  out,
  incoming,
  selected,
  onToggleSelected,
  onUnlink,
  showDebtColumn,
}: {
  out: Transaction;
  incoming: Transaction;
  selected: boolean;
  onToggleSelected: () => void;
  onUnlink: () => void;
  /** Whether the ledger has its (empty here) Debt column, so this row lines up. */
  showDebtColumn: boolean;
}) {
  return (
    <tr className={selected ? "ledger-row-selected ledger-row-transfer" : "ledger-row-transfer"}>
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
      </td>
      <td className="amount-col">
        <span className="transfer-amount">{formatAmount(incoming.amount)}</span>
      </td>
      <td className="account-col transfer-accounts" colSpan={2}>
        {out.account_name} → {incoming.account_name}
      </td>
      <td>
        <span className="transfer-badge">Transfer</span>
      </td>
      <td className="source-col">linked</td>
      {showDebtColumn && <td className="debt-col"></td>}
      <td className="actions-col">
        <button type="button" className="modal-secondary" onClick={onUnlink} title="Show these as two separate transactions again">
          Unlink
        </button>
      </td>
    </tr>
  );
}
