import "./Ledger.css";
import type * as React from "react";

import { Fragment } from "react";

import { TransferRow } from "./TransferRow";
import { AppliedPaymentDetails } from "./AppliedPaymentDetails";

import { RowFieldDropdown } from "./RowFieldDropdown";

import { SortableTh } from "./SortableTh";

import { isBatchSelected, type SelectAllBatch } from "./ledgerSelection";

import { CategoryIcon } from "./icons";
import { formatAmount } from "./format";

import { InfoTip } from "./InfoTip";

import type { Account, AnomalyFlag, AppSettings, FamilyMember, Transaction } from "./types";
import { MenuSelect } from "./MenuSelect";

import { describeDeleteImpact } from "./ledgerHelpers";
import { type LedgerDensity } from "./appStorage";
import { CATEGORY_SOURCE_LABELS, type LedgerSortColumn } from "./appTypes";

interface LedgerTableProps {
  setLedgerScrollEl: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  ledgerDensity: LedgerDensity;
  ledgerNarrow: boolean;
  appSettings: AppSettings;
  selectAllBatch: SelectAllBatch | null;
  selectedIds: Set<number>;
  toggleSelectAll: () => void;
  sortColumn: LedgerSortColumn;
  sortDirection: "asc" | "desc";
  toggleSort: (column: LedgerSortColumn) => void;
  pagedTransactions: Transaction[];
  inLegByOutId: Map<number, Transaction>;
  highlightedPaymentRow: number | null;
  toggleSelectedMany: (ids: number[]) => void;
  handleUnlinkTransfer: (transactionId: number) => Promise<void>;
  setNotesDialogFor: React.Dispatch<React.SetStateAction<Transaction | null>>;
  detailsOpenId: number | null;
  setDetailsOpenId: React.Dispatch<React.SetStateAction<number | null>>;
  accounts: Account[];
  handleAccountChangeForTransaction: (id: number, accountId: string) => Promise<void>;
  familyMembers: FamilyMember[];
  handleMemberChangeForTransaction: (id: number, memberId: string) => Promise<void>;
  categoryOptions: string[];
  handleCategoryChange: (id: number, value: string) => Promise<void>;
  toggleSplitEditor: (t: Transaction) => Promise<void>;
  editingPrincipalId: number | null;
  principalDraft: string;
  setPrincipalDraft: React.Dispatch<React.SetStateAction<string>>;
  handleSetPrincipalAmount: (id: number) => Promise<void>;
  setEditingPrincipalId: React.Dispatch<React.SetStateAction<number | null>>;
  handleResetPrincipalAmount: (id: number) => Promise<void>;
  startEditingPrincipal: (t: Transaction) => void;
  handleUnapplyDebtPayment: (sourceTransactionId: number) => Promise<void>;
  applyingDebtId: number | null;
  applyDebtForm: { accountId: string; amount: string; };
  setApplyDebtForm: React.Dispatch<React.SetStateAction<{ accountId: string; amount: string; }>>;
  debtAccounts: Account[];
  handleApplyDebtPayment: (sourceTransactionId: number, date: string) => Promise<void>;
  setApplyingDebtId: React.Dispatch<React.SetStateAction<number | null>>;
  startApplyingDebtPayment: (t: Transaction) => void;
  toggleSelected: (id: number) => void;
  editingDate: { id: number; value: string; } | null;
  setEditingDate: React.Dispatch<React.SetStateAction<{ id: number; value: string; } | null>>;
  commitDateEdit: (id: number, value: string) => Promise<void>;
  categoryIconMap: Record<string, string | null>;
  editingDescription: { id: number; value: string; } | null;
  setEditingDescription: React.Dispatch<React.SetStateAction<{ id: number; value: string; } | null>>;
  commitDescriptionEdit: (id: number, value: string) => Promise<void>;
  anomalyFlagsByTransaction: Map<number, AnomalyFlag[]>;
  handleRemoveTag: (id: number, tag: string) => Promise<void>;
  newTagText: Record<number, string>;
  setNewTagText: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  handleAddTag: (id: number, tag: string) => Promise<void>;
  editingAmount: { id: number; value: string; } | null;
  setEditingAmount: React.Dispatch<React.SetStateAction<{ id: number; value: string; } | null>>;
  commitAmountEdit: (id: number, value: string) => Promise<void>;
  confirmingDeleteId: number | null;
  setConfirmingDeleteId: React.Dispatch<React.SetStateAction<number | null>>;
  handleDeleteTransaction: (id: number) => Promise<void>;
  ledgerColumnCount: 5 | 10 | 9;
  expandedSplitId: number | null;
  splitLines: { category: string; amount: string; note: string; }[];
  updateSplitLine: (index: number, patch: Partial<{ category: string; amount: string; note: string; }>) => void;
  removeSplitLine: (index: number) => void;
  addSplitLine: () => void;
  splitRemaining: (t: Transaction) => number;
  saveSplits: (t: Transaction) => Promise<void>;
  clearSplits: (t: Transaction) => Promise<void>;
  setExpandedSplitId: React.Dispatch<React.SetStateAction<number | null>>;
  filteredTransactions: Transaction[];
  transactions: Transaction[];
}

export function LedgerTable({
  setLedgerScrollEl,
  ledgerDensity,
  ledgerNarrow,
  appSettings,
  selectAllBatch,
  selectedIds,
  toggleSelectAll,
  sortColumn,
  sortDirection,
  toggleSort,
  pagedTransactions,
  inLegByOutId,
  highlightedPaymentRow,
  toggleSelectedMany,
  handleUnlinkTransfer,
  setNotesDialogFor,
  detailsOpenId,
  setDetailsOpenId,
  accounts,
  handleAccountChangeForTransaction,
  familyMembers,
  handleMemberChangeForTransaction,
  categoryOptions,
  handleCategoryChange,
  toggleSplitEditor,
  editingPrincipalId,
  principalDraft,
  setPrincipalDraft,
  handleSetPrincipalAmount,
  setEditingPrincipalId,
  handleResetPrincipalAmount,
  startEditingPrincipal,
  handleUnapplyDebtPayment,
  applyingDebtId,
  applyDebtForm,
  setApplyDebtForm,
  debtAccounts,
  handleApplyDebtPayment,
  setApplyingDebtId,
  startApplyingDebtPayment,
  toggleSelected,
  editingDate,
  setEditingDate,
  commitDateEdit,
  categoryIconMap,
  editingDescription,
  setEditingDescription,
  commitDescriptionEdit,
  anomalyFlagsByTransaction,
  handleRemoveTag,
  newTagText,
  setNewTagText,
  handleAddTag,
  editingAmount,
  setEditingAmount,
  commitAmountEdit,
  confirmingDeleteId,
  setConfirmingDeleteId,
  handleDeleteTransaction,
  ledgerColumnCount,
  expandedSplitId,
  splitLines,
  updateSplitLine,
  removeSplitLine,
  addSplitLine,
  splitRemaining,
  saveSplits,
  clearSplits,
  setExpandedSplitId,
  filteredTransactions,
  transactions,
}: LedgerTableProps) {
  return (
    <div className="ledger-table-scroll" ref={setLedgerScrollEl}>
      <table className={ledgerDensity === "compact" ? "ledger ledger-compact" : "ledger"}>
        <colgroup>
          <col style={{ width: ledgerNarrow ? "6%" : "3%" }} />
          {/* the date needs ~80px in every style's font: 7% left it ~38px and it ran into the description */}
          <col style={{ width: ledgerNarrow ? "16%" : "11%" }} />
          <col style={{ width: ledgerNarrow ? "43%" : "17%" }} />
          <col style={{ width: ledgerNarrow ? "16%" : "8%" }} />
          {!ledgerNarrow && <col style={{ width: "14%" }} />}
          {!ledgerNarrow && <col style={{ width: "10%" }} />}
          {!ledgerNarrow && <col style={{ width: "13%" }} />}
          {!ledgerNarrow && <col style={{ width: "8%" }} />}
          {!ledgerNarrow && appSettings.apply_to_debt_enabled && <col style={{ width: "8%" }} />}
          <col style={{ width: ledgerNarrow ? "19%" : "7%" }} />
        </colgroup>
        <thead>
          <tr>
            <th className="select-col">
              <input
                type="checkbox"
                checked={isBatchSelected(selectAllBatch, selectedIds)}
                onChange={toggleSelectAll}
                aria-label="Select all matching transactions"
              />
            </th>
            <SortableTh column="date" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort}>
              Date
            </SortableTh>
            <SortableTh column="description" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort}>
              Description
            </SortableTh>
            <SortableTh column="amount" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} className="amount-col">
              Amount
            </SortableTh>
            {!ledgerNarrow && (
              <SortableTh column="account" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort}>
                Account
              </SortableTh>
            )}
            {!ledgerNarrow && <th>Member</th>}
            {!ledgerNarrow && (
              <SortableTh column="category" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort}>
                Category
              </SortableTh>
            )}
            {!ledgerNarrow && (
              <SortableTh column="source" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort}>
                Sorted by
              </SortableTh>
            )}
            {!ledgerNarrow && appSettings.apply_to_debt_enabled && <th>Debt</th>}
            <th className="actions-col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {pagedTransactions.map((t) => {
            const inLeg = inLegByOutId.get(t.id);
            if (inLeg) {
              return (
                <TransferRow
                  key={t.id}
                  out={t}
                  highlighted={highlightedPaymentRow === t.id}
                  incoming={inLeg}
                  selected={selectedIds.has(t.id)}
                  onToggleSelected={() => toggleSelectedMany([t.id, inLeg.id])}
                  onUnlink={() => handleUnlinkTransfer(t.id)}
                  onEditNote={setNotesDialogFor}
                  showDebtColumn={appSettings.apply_to_debt_enabled}
                  narrow={ledgerNarrow}
                  detailsOpen={detailsOpenId === t.id}
                  onToggleDetails={() => setDetailsOpenId(detailsOpenId === t.id ? null : t.id)}
                />
              );
            }
            // Extracted once per row so the same live editor — same
            // component, same handlers — can render either as its own
            // column (normal width) or folded into the row's Details panel
            // (narrow width), never both, without duplicating the editing
            // logic itself.
            const accountField = (
              <RowFieldDropdown
                ariaLabel={`Account for "${t.description}"`}
                value={String(t.account_id)}
                options={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
                onChange={(value) => handleAccountChangeForTransaction(t.id, value)}
              />
            );
            const memberField = (
              <RowFieldDropdown
                ariaLabel={`Family member for "${t.description}"`}
                value={t.member_id !== null ? String(t.member_id) : ""}
                options={[
                  { value: "", label: "Unassigned" },
                  ...familyMembers.map((m) => ({ value: String(m.id), label: m.name })),
                ]}
                onChange={(value) => handleMemberChangeForTransaction(t.id, value)}
              />
            );
            const categoryField = (
              <>
                {t.split_count > 0 ? (
                  <span className="split-summary">Split ({t.split_count})</span>
                ) : (
                  <RowFieldDropdown
                    ariaLabel={`Category for "${t.description}"`}
                    value={t.category ?? ""}
                    options={[
                      // Matches the old native select's `<option disabled>`
                      // placeholder: describes the current "nothing chosen"
                      // state without itself being pickable — choosing it
                      // would otherwise write an empty category back as a
                      // real, saved choice (and register "" as a category,
                      // and save a rule sending this merchant to "").
                      { value: "", label: "Uncategorized", disabled: true },
                      ...(t.category && !categoryOptions.includes(t.category) ? [{ value: t.category, label: t.category }] : []),
                      ...categoryOptions.map((c) => ({ value: c, label: c })),
                      { value: "__new__", label: "+ New category…" },
                    ]}
                    onChange={(value) => handleCategoryChange(t.id, value)}
                  />
                )}
                {appSettings.split_purchases_enabled && (
                  <button type="button" className="modal-secondary split-toggle" onClick={() => toggleSplitEditor(t)}>
                    {t.split_count > 0 ? "Edit splits" : "Split →"}
                  </button>
                )}
              </>
            );
            const sourceField = (
              <>
                {t.category_source ? (CATEGORY_SOURCE_LABELS[t.category_source] ?? t.category_source) : ""}
                {t.confidence !== null && <span className="confidence-badge">{Math.round(t.confidence * 100)}%</span>}
              </>
            );
            const debtField = accounts.find((a) => a.id === t.account_id)?.account_type === "loan" ? (
              editingPrincipalId === t.id ? (
                <span className="debt-apply-form">
                  <input
                    className="debt-apply-amount"
                    value={principalDraft}
                    onChange={(e) => setPrincipalDraft(e.target.value)}
                    title="How much of this transaction counts toward what's owed (e.g. just the principal on a mortgage payment)"
                  />
                  <button type="button" className="debt-apply-confirm" onClick={() => handleSetPrincipalAmount(t.id)}>
                    Save
                  </button>
                  <button type="button" className="modal-secondary" onClick={() => setEditingPrincipalId(null)}>
                    Cancel
                  </button>
                </span>
              ) : t.principal_amount !== null ? (
                <span className="debt-applied-badge">
                  Principal: {formatAmount(t.principal_amount)}
                  <button type="button" className="modal-secondary" onClick={() => handleResetPrincipalAmount(t.id)}>
                    Reset
                  </button>
                </span>
              ) : (
                <button type="button" className="modal-secondary debt-apply-trigger" onClick={() => startEditingPrincipal(t)}>
                  Split principal →
                </button>
              )
            ) : t.applied_to_debt ? (
              <span className="debt-applied-badge">
                → {t.applied_to_debt.debt_account_name} ({formatAmount(t.applied_to_debt.amount)})
                <button type="button" className="modal-secondary" onClick={() => handleUnapplyDebtPayment(t.id)}>
                  Undo
                </button>
              </span>
            ) : applyingDebtId === t.id ? (
              <span className="debt-apply-form">
                <MenuSelect
                  ariaLabel={`Debt account to apply "${t.description}" toward`}
                  value={applyDebtForm.accountId}
                  onChange={(v) => setApplyDebtForm({ ...applyDebtForm, accountId: v })}
                  options={debtAccounts.map((a) => ({ value: String(a.id), label: a.name }))}
                />
                <input
                  className="debt-apply-amount"
                  value={applyDebtForm.amount}
                  onChange={(e) => setApplyDebtForm({ ...applyDebtForm, amount: e.target.value })}
                  title="How much of this payment counts toward the debt (e.g. just the principal on a mortgage payment)"
                />
                <button type="button" className="debt-apply-confirm" onClick={() => handleApplyDebtPayment(t.id, t.date)}>
                  Apply
                </button>
                <button type="button" className="modal-secondary" onClick={() => setApplyingDebtId(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              // The loan case is already handled above — only credit
              // (excluded, a payment there needs no principal split) and
              // every non-debt account reach here.
              // Only money going out can be a debt payment (not income or a transfer in).
              debtAccounts.length > 0 &&
              parseFloat(t.amount) < 0 &&
              accounts.find((a) => a.id === t.account_id)?.account_type !== "credit" && (
                <button type="button" className="modal-secondary debt-apply-trigger" onClick={() => startApplyingDebtPayment(t)}>
                  Apply to a debt →
                </button>
              )
            );
            return (
              <Fragment key={t.id}>
                <tr data-payment-row={t.id} tabIndex={-1} className={[selectedIds.has(t.id) ? "ledger-row-selected" : "", highlightedPaymentRow === t.id ? "payment-row-highlight" : ""].filter(Boolean).join(" ") || undefined}>
                  <td className="select-col">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(t.id)}
                      onChange={() => toggleSelected(t.id)}
                      aria-label={`Select transaction ${t.id}`}
                    />
                  </td>
                  <td className="date-col">
                    {editingDate?.id === t.id ? (
                      <input
                        autoFocus
                        type="date"
                        className="row-edit-input"
                        value={editingDate.value}
                        onChange={(e) => setEditingDate({ id: t.id, value: e.target.value })}
                        onBlur={() => commitDateEdit(t.id, editingDate.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitDateEdit(t.id, editingDate.value);
                          if (e.key === "Escape") setEditingDate(null);
                        }}
                      />
                    ) : (
                      <span
                        className="amount-editable date-cell"
                        title="Click to fix the date"
                        onClick={() => setEditingDate({ id: t.id, value: t.date })}
                      >
                        {t.date}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="cell-with-icon">
                      <span className="row-icon-badge">
                        <CategoryIcon category={t.category} iconKey={t.category ? categoryIconMap[t.category] : null} />
                      </span>
                      {editingDescription?.id === t.id ? (
                        <input
                          autoFocus
                          className="row-edit-input"
                          value={editingDescription.value}
                          onChange={(e) => setEditingDescription({ id: t.id, value: e.target.value })}
                          onBlur={() => commitDescriptionEdit(t.id, editingDescription.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitDescriptionEdit(t.id, editingDescription.value);
                            if (e.key === "Escape") setEditingDescription(null);
                          }}
                        />
                      ) : (
                        <span
                          className="amount-editable"
                          title="Click to fix the description"
                          onClick={() => setEditingDescription({ id: t.id, value: t.description })}
                        >
                          {t.description}
                        </span>
                      )}
                    </span>
                    <AppliedPaymentDetails transaction={t} />
                    {(anomalyFlagsByTransaction.get(t.id) ?? []).map((flag, i) => (
                      <InfoTip
                        key={i}
                        label={flag.kind === "large" ? "unusually large charge" : "possible duplicate"}
                        text={flag.detail}
                        glyph={flag.kind === "large" ? "⚠" : "⧉"}
                        buttonClassName={flag.kind === "large" ? "anomaly-badge anomaly-large" : "anomaly-badge anomaly-duplicate"}
                      />
                    ))}
                    {t.transfer_counterpart_id !== null && (
                      <button
                        type="button"
                        className="transfer-badge transfer-badge-button"
                        title="Linked as a transfer with a transaction that isn't shown here — click to unlink"
                        onClick={() => handleUnlinkTransfer(t.id)}
                      >
                        ⇄ Transfer ×
                      </button>
                    )}
                    <div className="transaction-description-meta">
                      <div className="tag-pills">
                        {t.tags.map((tag) => (
                          <span key={tag} className="tag-pill">
                            {tag}
                            <button
                              type="button"
                              onClick={() => handleRemoveTag(t.id, tag)}
                              aria-label={`Remove tag ${tag}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}

                        <input
                          className="tag-input"
                          list="known-tags"
                          placeholder="+ tag"
                          value={newTagText[t.id] ?? ""}
                          onChange={(e) =>
                            setNewTagText((prev) => ({
                              ...prev,
                              [t.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddTag(t.id, newTagText[t.id] ?? "");
                            }
                          }}
                        />
                      </div>

                      {t.notes ? (
                        <button
                          type="button"
                          className="modal-secondary btn-sm transaction-note-preview"
                          onClick={() => setNotesDialogFor(t)}
                          title={t.notes}
                          aria-label={`Edit note for "${t.description}"`}
                        >
                          {t.notes.length > 40 ? `${t.notes.slice(0, 40)}…` : t.notes}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="modal-secondary btn-sm transaction-note-add"
                          onClick={() => setNotesDialogFor(t)}
                          aria-label={`Add note for "${t.description}"`}
                        >
                          + Add note
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="amount-col">
                    {editingAmount?.id === t.id ? (
                      <input
                        autoFocus
                        className="amount-edit-input"
                        value={editingAmount.value}
                        onChange={(e) => setEditingAmount({ id: t.id, value: e.target.value })}
                        onBlur={() => commitAmountEdit(t.id, editingAmount.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitAmountEdit(t.id, editingAmount.value);
                          if (e.key === "Escape") setEditingAmount(null);
                        }}
                      />
                    ) : (
                      <span
                        className="amount-editable"
                        title="Click to fix the amount"
                        onClick={() => setEditingAmount({ id: t.id, value: t.amount })}
                      >
                        {formatAmount(t.amount)}
                      </span>
                    )}
                  </td>
                  {!ledgerNarrow && <td className="account-col">{accountField}</td>}
                  {!ledgerNarrow && <td className="member-col">{memberField}</td>}
                  {!ledgerNarrow && <td className="category-col">{categoryField}</td>}
                  {!ledgerNarrow && <td className="source-col">{sourceField}</td>}
                  {!ledgerNarrow && appSettings.apply_to_debt_enabled && <td className="debt-col">{debtField}</td>}
                  <td className="actions-col">
                    {ledgerNarrow && (
                      <button
                        type="button"
                        className="modal-secondary"
                        aria-expanded={detailsOpenId === t.id}
                        onClick={() => setDetailsOpenId(detailsOpenId === t.id ? null : t.id)}
                      >
                        {detailsOpenId === t.id ? "Hide details" : "Details"}
                      </button>
                    )}
                    {confirmingDeleteId === t.id ? (
                      <span className="row-delete-confirm row-delete-confirm-detailed">
                        {(() => {
                          const impact = describeDeleteImpact(t.amount, accounts.find((a) => a.id === t.account_id));
                          return impact ? <span className="delete-impact-note">{impact}</span> : null;
                        })()}
                        <span className="row-delete-confirm-actions">
                          <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(null)}>
                            Cancel
                          </button>
                          <button type="button" className="btn-danger" onClick={() => handleDeleteTransaction(t.id)}>
                            Delete
                          </button>
                        </span>
                      </span>
                    ) : (
                      <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(t.id)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
                {ledgerNarrow && detailsOpenId === t.id && (
                  <tr className="ledger-details-row">
                    <td colSpan={ledgerColumnCount}>
                      <div className="ledger-details">
                        <label className="ledger-details-field">
                          <span>Account</span>
                          {accountField}
                        </label>
                        <label className="ledger-details-field">
                          <span>Member</span>
                          {memberField}
                        </label>
                        <label className="ledger-details-field">
                          <span>Category</span>
                          {categoryField}
                        </label>
                        <label className="ledger-details-field">
                          <span>Sorted by</span>
                          {sourceField}
                        </label>
                        {appSettings.apply_to_debt_enabled && (
                          <label className="ledger-details-field">
                            <span>Debt</span>
                            {debtField}
                          </label>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {expandedSplitId === t.id && (
                  <tr className="split-editor-row">
                    <td colSpan={ledgerColumnCount}>
                      <div className="split-editor">
                        {splitLines.map((line, i) => (
                          <div className="split-editor-line" key={i}>
                            <MenuSelect
                              ariaLabel={`Category for split ${i + 1} of "${t.description}"`}
                              value={line.category}
                              onChange={(v) => updateSplitLine(i, { category: v })}
                              options={categoryOptions.map((c) => ({ value: c, label: c }))}
                            />
                            <input
                              className="debt-apply-amount"
                              value={line.amount}
                              onChange={(e) => updateSplitLine(i, { amount: e.target.value })}
                              placeholder="Amount"
                            />
                            <input
                              value={line.note}
                              onChange={(e) => updateSplitLine(i, { note: e.target.value })}
                              placeholder="Note (optional)"
                            />
                            <button type="button" className="modal-secondary" onClick={() => removeSplitLine(i)}>
                              Remove
                            </button>
                          </div>
                        ))}
                        <div className="split-editor-actions">
                          <button type="button" className="modal-secondary" onClick={addSplitLine}>
                            Add line
                          </button>
                          <span className={Math.abs(splitRemaining(t)) < 0.01 ? "split-remaining split-remaining-ok" : "split-remaining"}>
                            Remaining to allocate: {formatAmount(splitRemaining(t).toFixed(2))}
                          </span>
                          <button type="button" disabled={Math.abs(splitRemaining(t)) >= 0.01} onClick={() => saveSplits(t)}>
                            Save splits
                          </button>
                          {t.split_count > 0 && (
                            <button type="button" className="modal-secondary" onClick={() => clearSplits(t)}>
                              Clear splits
                            </button>
                          )}
                          <button type="button" className="modal-secondary" onClick={() => setExpandedSplitId(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {filteredTransactions.length === 0 && (
            <tr>
              <td colSpan={ledgerColumnCount} className="empty-state">
                {transactions.length === 0
                  ? "No transactions yet — import a CSV to get started."
                  : "No transactions match your filters."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
