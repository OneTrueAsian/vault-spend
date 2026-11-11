import { type CategoryTransaction } from "../../shared/lib/types";
import { useState } from "react";
import { MenuSelect } from "../../shared/ui/MenuSelect";
import { formatDisplayDate, formatAmount } from "../../shared/lib/format";
import { ModalShell } from "../../shared/ui/Modal";

export function CategoryTransactionsDialog({
  category,
  monthLabel,
  transactions,
  categoryOptions,
  onCorrectCategory,
  onBulkCorrectCategory,
  onClose,
}: {
  category: string;
  monthLabel: string;
  transactions: CategoryTransaction[];
  categoryOptions: string[];
  /** Reconciles a miscategorized whole transaction — not offered for a
   * split line (`is_split`), since a split's category lives on its own
   * split row, edited via the Transactions tab's "Edit splits" flow instead. */
  onCorrectCategory: (transactionId: number, category: string) => void;
  /** Resolves once the change has actually been applied (or `false` if
   * the user backed out of an in-flight "+ New category" prompt, or the
   * call failed) — the selection only clears on a real success, same as
   * the Transactions tab's own bulk bar. */
  onBulkCorrectCategory: (transactionIds: number[], category: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Only whole transactions can be bulk-recategorized this way — a split
  // line's category lives on its own split row (see onCorrectCategory's
  // note above), so it never gets a checkbox here either.
  const selectableIds = transactions.filter((t) => !t.is_split).map((t) => t.transaction_id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) selectableIds.forEach((id) => next.delete(id));
      else selectableIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function handleBulkChange(value: string) {
    if (!value) return;
    const applied = await onBulkCorrectCategory(Array.from(selectedIds), value);
    if (applied) setSelectedIds(new Set());
  }

  return (
    <ModalShell title={`${category} — ${monthLabel}`} onCancel={onClose} wide>
      {transactions.length === 0 ? (
        <p className="empty-state">No transactions in this category this month.</p>
      ) : (
        <>
          {selectedIds.size > 0 && (
            <div className="bulk-actions-bar">
              <span className="bulk-actions-count">{selectedIds.size} selected</span>
              <MenuSelect
                ariaLabel="Set category to"
                placeholder="Set category to"
                value={""}
                onChange={handleBulkChange}
                options={[
                  ...categoryOptions.map((c) => ({ value: c, label: c })),
                  { value: "__new__", label: "+ New category" },
                ]}
              />
              <button type="button" className="modal-secondary" onClick={() => setSelectedIds(new Set())}>
                Clear selection
              </button>
            </div>
          )}
          <div className="modal-table-scroll">
            <table className="ledger category-transactions-table">
              <thead>
                <tr>
                  <th className="select-col">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all"
                      disabled={selectableIds.length === 0}
                    />
                  </th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Account</th>
                  <th className="amount-col">Amount</th>
                  <th>Category</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t, i) => (
                  <tr
                    key={`${t.transaction_id}-${i}`}
                    className={selectedIds.has(t.transaction_id) ? "ledger-row-selected" : undefined}
                  >
                    <td className="select-col">
                      {!t.is_split && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(t.transaction_id)}
                          onChange={() => toggleSelected(t.transaction_id)}
                          aria-label={`Select transaction ${t.transaction_id}`}
                        />
                      )}
                    </td>
                    <td className="date-cell">{formatDisplayDate(t.date)}</td>
                    <td>
                      {t.description}
                      {t.is_split && (
                        <span className="split-summary"> (split{t.split_note ? `: ${t.split_note}` : ""})</span>
                      )}
                    </td>
                    <td>{t.account_name}</td>
                    <td className="amount-col">{formatAmount(t.amount)}</td>
                    <td>
                      {t.is_split ? (
                        <span className="modal-message-secondary" title="Edit a split's category from the Transactions tab's Edit splits screen">
                          {category}
                        </span>
                      ) : (
                        <MenuSelect
                          ariaLabel={`Category for "${t.description}"`}
                          value={category}
                          onChange={(v) => onCorrectCategory(t.transaction_id, v)}
                          options={[
                            ...(!categoryOptions.includes(category) ? [{ value: category, label: category }] : []),
                            ...categoryOptions.map((c) => ({ value: c, label: c })),
                            { value: "__new__", label: "+ New category" },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </ModalShell>
  );
}
