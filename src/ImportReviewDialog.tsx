import "./Ledger.css";
import { ImportCategoryReconcile, type CategoryChoice } from "./ImportCategoryReconcile";
import { ImportNeedsChoice } from "./ImportNeedsChoice";
import { MenuSelect } from "./MenuSelect";
import { ModalShell } from "./Modal";
import { formatAmount, formatDisplayDate } from "./format";
import { rowNeedsChoice, unresolvedRows } from "./importResolution";
import type { ImportReview } from "./useImportReview";
import type { Account } from "./types";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The import review (see `useImportReview`), as a pop-up over the page so it is in front of the
 * person wherever they had scrolled: the bank's categories they don't have, the rows that need a
 * category, every row with its checkbox and account, and Cancel / Import pinned at the foot.
 * Escape cancels; a click outside doesn't, so a stray click keeps their choices. Renders nothing
 * while no import is being reviewed. */
export function ImportReviewDialog({
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
    notice,
  } = review;
  if (!pendingImport) return null;

  const { rows, row_errors, unmatched_categories, choice_below } = pendingImport.preview;
  const accountName = accounts.find((a) => a.id === pendingImport.defaultAccountId)?.name ?? "the selected account";
  const remaining = unresolvedRows(rows, includedIndices, importCategoryChoices, importRowChoices, choice_below).length;

  const footer = (
    <div className="dup-review-actions">
      <p id="import-remaining-choices" className="import-remaining-choices" aria-live="polite" data-import-remaining={remaining}>
        {remaining > 0 ? `${count(remaining, "row still needs", "rows still need")} a category` : ""}
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
        {busy ? "Importing…" : `Import ${count(includedIndices.size, "transaction", "transactions")}`}
      </button>
    </div>
  );

  return (
    <ModalShell
      title={`Import ${count(rows.length, "transaction", "transactions")} into ${accountName}`}
      onCancel={() => {
        if (!busy) cancelPendingImport();
      }}
      wide
      footer={footer}
      dismissOnOverlayClick={false}
    >
      <div className="import-review-dialog">
        {notice && (
          <p role="alert" className="import-review-notice">
            {notice}
          </p>
        )}
        <p className="dup-review-summary">
          Untick anything you don't want. You can change the account on any row.
          {row_errors > 0 && ` ${count(row_errors, "row", "rows")} couldn't be read.`}
        </p>
        <ImportCategoryReconcile
          unmatched={unmatched_categories}
          categories={categoryOptions}
          choices={importCategoryChoices}
          disabled={busy}
          onChange={(name, choice) => updateImportCategoryChoices({ ...importCategoryChoices, [name]: choice })}
          onSetAll={(action) =>
            updateImportCategoryChoices(Object.fromEntries(unmatched_categories.map((u) => [u.name, { action } as CategoryChoice])))
          }
        />
        <ImportNeedsChoice
          rows={rows.filter((r) => includedIndices.has(r.index) && rowNeedsChoice(r, importCategoryChoices, choice_below))}
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
                    checked={rows.length > 0 && rows.every((r) => includedIndices.has(r.index))}
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
              {rows.map((row) => (
                <tr key={row.index} className={row.is_duplicate ? "import-row-duplicate" : undefined}>
                  <td className="dup-review-check">
                    <input type="checkbox" checked={includedIndices.has(row.index)} onChange={() => toggleIncluded(row.index)} disabled={busy} />
                  </td>
                  <td className="date-cell">{formatDisplayDate(row.date)}</td>
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
                    {row.account_name && !accounts.some((a) => a.name.toLowerCase() === row.account_name!.toLowerCase()) && (
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
      </div>
    </ModalShell>
  );
}
