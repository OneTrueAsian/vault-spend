import "./Ledger.css";
import { ImportCategoryReconcile, type CategoryChoice } from "./ImportCategoryReconcile";
import { ImportNeedsChoice } from "./ImportNeedsChoice";
import { MenuSelect } from "./MenuSelect";
import { formatAmount } from "./format";
import { rowNeedsChoice, unresolvedRows } from "./importResolution";
import type { ImportReview } from "./useImportReview";
import type { Account } from "./types";

/** The Transactions tab's import review (see `useImportReview`): what the file holds, the
 * unfamiliar file categories, the rows that need the person's choice, every row with its checkbox
 * and account, and Cancel / Import. Renders nothing while no import is being reviewed. */
export function ImportReviewPanel({
  review,
  accounts,
  categoryOptions,
  busy,
}: {
  review: ImportReview;
  accounts: Account[];
  categoryOptions: string[];
  busy: boolean;
}) {
  const {
    pendingImport,
    includedIndices,
    accountOverrides,
    importCategoryChoices,
    importRowChoices,
    setImportRowChoices,
    toggleIncluded,
    toggleSelectAllImportRows,
    setImportRowAccount,
    updateImportCategoryChoices,
    leaveRestOfRowsUncategorized,
    confirmPendingImport,
    cancelPendingImport,
  } = review;
  if (!pendingImport) return null;

  return (
    <div className="dup-review">
      <p className="dup-review-summary">
        Reviewing {pendingImport.preview.rows.length} transaction(s) from this file
        {pendingImport.preview.row_errors
          ? ` (${pendingImport.preview.row_errors} row(s) couldn't be read)`
          : ""}
        . Uncheck any you don't want to import, and fix the account for any row that doesn't belong to{" "}
        {accounts.find((a) => a.id === pendingImport.defaultAccountId)?.name ?? "the selected account"}.
      </p>
      <ImportCategoryReconcile
        unmatched={pendingImport.preview.unmatched_categories}
        categories={categoryOptions}
        choices={importCategoryChoices}
        disabled={busy}
        onChange={(name, choice) => updateImportCategoryChoices({ ...importCategoryChoices, [name]: choice })}
        onSetAll={(action) =>
          updateImportCategoryChoices(
            Object.fromEntries(pendingImport.preview.unmatched_categories.map((u) => [u.name, { action } as CategoryChoice])),
          )
        }
      />
      <ImportNeedsChoice
        rows={pendingImport.preview.rows.filter(
          (r) => includedIndices.has(r.index) && rowNeedsChoice(r, importCategoryChoices, pendingImport.preview.choice_below),
        )}
        categories={categoryOptions}
        choices={importRowChoices}
        disabled={busy}
        onChoose={(index, category) => setImportRowChoices((prev) => new Map(prev).set(index, category))}
        onLeaveRest={leaveRestOfRowsUncategorized}
      />
      <div className="dup-review-table-scroll">
        <table className="dup-review-table">
          <thead>
            <tr>
              <th className="dup-review-check">
                <input
                  type="checkbox"
                  checked={
                    pendingImport.preview.rows.length > 0 &&
                    pendingImport.preview.rows.every((r) => includedIndices.has(r.index))
                  }
                  onChange={toggleSelectAllImportRows}
                  disabled={busy}
                  aria-label="Select all"
                />
              </th>
              <th>Date</th>
              <th>Description</th>
              <th className="amount-col">Amount</th>
              <th>Account</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pendingImport.preview.rows.map((row) => (
              <tr key={row.index} className={row.is_duplicate ? "import-row-duplicate" : undefined}>
                <td className="dup-review-check">
                  <input
                    type="checkbox"
                    checked={includedIndices.has(row.index)}
                    onChange={() => toggleIncluded(row.index)}
                    disabled={busy}
                  />
                </td>
                <td>{row.date}</td>
                <td>{row.description}</td>
                <td className="amount-col">{formatAmount(row.amount)}</td>
                <td>
                  <MenuSelect
                    ariaLabel={`Account for "${row.description}"`}
                    value={String(accountOverrides.get(row.index) ?? pendingImport.defaultAccountId)}
                    onChange={(v) => setImportRowAccount(row.index, Number(v))}
                    disabled={busy}
                    options={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
                  />
                  {row.account_name &&
                    !accounts.some((a) => a.name.toLowerCase() === row.account_name!.toLowerCase()) && (
                      <div className="account-col" title="No account by that name exists yet — it'll be created on import">
                        CSV: {row.account_name} (new)
                      </div>
                    )}
                </td>
                <td className="source-col">{row.is_duplicate ? "Already added" : "New"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(() => {
        const remaining = unresolvedRows(
          pendingImport.preview.rows,
          includedIndices,
          importCategoryChoices,
          importRowChoices,
          pendingImport.preview.choice_below,
        ).length;
        return (
          <div className="dup-review-actions">
            <p id="import-remaining-choices" className="import-remaining-choices" aria-live="polite" data-import-remaining={remaining}>
              {remaining > 0
                ? `Choose a category for ${remaining} more ${remaining === 1 ? "row" : "rows"}, or leave ${remaining === 1 ? "it" : "them"} uncategorized.`
                : ""}
            </p>
            <button className="modal-secondary" onClick={cancelPendingImport} disabled={busy}>
              Cancel
            </button>
            <button
              onClick={confirmPendingImport}
              disabled={busy || includedIndices.size === 0 || remaining > 0}
              aria-describedby="import-remaining-choices"
              data-import-confirm
            >
              {busy ? "Importing…" : `Import ${includedIndices.size} transaction(s)`}
            </button>
          </div>
        );
      })()}
    </div>
  );
}
