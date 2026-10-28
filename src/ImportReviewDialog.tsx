import "./Transactions.css";
import { ImportCategoryReconcile, type CategoryChoice } from "./ImportCategoryReconcile";
import { ImportNeedsChoice } from "./ImportNeedsChoice";
import { MenuSelect } from "./MenuSelect";
import { ModalShell } from "./Modal";
import { formatAmount, formatDisplayDate } from "./format";
import { pickableAccounts } from "./hiddenAccounts";
import { rowNeedsChoice, unresolvedRows, type ImportRow } from "./importResolution";
import type { ImportReview } from "./useImportReview";
import type { Account } from "./types";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The accessible name of a row's include checkbox: which transaction it is. Two rows with the same
 * description, date and amount get "row N of M" added so no two boxes share a name. */
function rowCheckboxLabel(row: ImportRow, rows: ImportRow[]): string {
  const base = `Include ${row.description}, ${formatDisplayDate(row.date)}, ${formatAmount(row.amount)}`;
  const twins = rows.filter((r) => r.description === row.description && r.date === row.date && r.amount === row.amount);
  return twins.length > 1 ? `${base} (row ${rows.indexOf(row) + 1} of ${rows.length})` : base;
}

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
  onChangeColumns,
}: {
  review: ImportReview;
  accounts: Account[];
  categoryOptions: string[];
  busy: boolean;
  /** Reopens "Match your columns" over the review, to pick other columns for this file. */
  onChangeColumns?: () => void;
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
        {pendingImport.columnMap && pendingImport.columns && onChangeColumns && (
          <p className="import-review-columns" data-import-columns-note>
            <span>{pendingImport.columns.source === "saved" ? "Using the columns you picked last time." : "Using the columns you picked."}</span>
            <button type="button" className="modal-secondary" data-change-columns onClick={onChangeColumns} disabled={busy}>
              Change columns
            </button>
          </p>
        )}
        {rows.length === 0 ? (
          <p className="dup-review-summary" role="status">
            {row_errors > 0
              ? `No transactions could be read from this file. ${count(row_errors, "row", "rows")} couldn't be read.`
              : "No transactions were found in this file. Check that it is a bank download (CSV, OFX, QFX or QIF), or try downloading it again."}
          </p>
        ) : (
          <p className="dup-review-summary">
            Untick anything you don't want. You can change the account on any row.
            {row_errors > 0 && ` ${count(row_errors, "row", "rows")} couldn't be read.`}
          </p>
        )}
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
        {rows.length > 0 && (
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
                      <input
                        type="checkbox"
                        checked={includedIndices.has(row.index)}
                        onChange={() => toggleIncluded(row.index)}
                        disabled={busy}
                        aria-label={rowCheckboxLabel(row, rows)}
                      />
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
                        options={pickableAccounts(accounts, accountOverrides.get(row.index) ?? pendingImport.defaultAccountId).map((a) => ({ value: String(a.id), label: a.name }))}
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
        )}
      </div>
    </ModalShell>
  );
}
