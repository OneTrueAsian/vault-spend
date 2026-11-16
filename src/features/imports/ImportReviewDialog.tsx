import { useState, type ComponentProps } from "react";
import "../transactions/Transactions.css";
import { ImportCategoryReconcile, type CategoryChoice } from "../../shared/ui/ImportCategoryReconcile";
import { ImportNeedsChoice } from "./ImportNeedsChoice";
import { MenuSelect } from "../../shared/ui/MenuSelect";
import { PageTabs } from "../../shared/ui/PageTabs";
import { ModalShell } from "../../shared/ui/Modal";
import { formatAmount, formatDisplayDate } from "../../shared/lib/format";
import { pickableAccounts } from "../../shared/lib/hiddenAccounts";
import { rowNeedsChoice, splitBankCategories, unresolvedRows, type ImportRow } from "../../shared/lib/importResolution";
import type { ImportReview } from "./useImportReview";
import type { Account } from "../../shared/lib/types";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The accessible name of a row's include checkbox: which transaction it is. Two rows with the same
 * description and date get "row N of M" added so no two boxes share a name. */
function rowCheckboxLabel(row: ImportRow, rows: ImportRow[]): string {
  const base = `Include ${row.description}, ${formatDisplayDate(row.date)}`;
  const twins = rows.filter((r) => r.description === row.description && r.date === row.date);
  return twins.length > 1 ? `${base} (row ${rows.indexOf(row) + 1} of ${rows.length})` : base;
}

type ImportTab = "bank" | "needs" | "rows";

/** The import review (see `useImportReview`), as a pop-up over the page so it is in front of the
 * person wherever they had scrolled: the bank's categories they don't have, the rows that need a
 * category, every row with its checkbox and account, and Cancel / Import pinned at the foot.
 * Escape cancels; a click outside doesn't, so a stray click keeps their choices. Renders nothing
 * while no import is being reviewed. */

export function ImportReviewDialog(props: ComponentProps<typeof ImportReviewContent>) {
  return props.review.pendingImport ? <ImportReviewContent {...props} /> : null;
}

function ImportReviewContent({
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
  const pendingImport = review.pendingImport!;

  const { rows, row_errors, unmatched_categories, choice_below } = pendingImport.preview;
  const accountName = accounts.find((a) => a.id === pendingImport.defaultAccountId)?.name ?? "the selected account";
  const remaining = unresolvedRows(rows, includedIndices, importCategoryChoices, importRowChoices, choice_below).length;

  const { ask, remembered } = splitBankCategories(unmatched_categories, categoryOptions);
  const opening: ImportTab = ask.length > 0 ? "bank" : remaining > 0 ? "needs" : "rows";
  const [tabState, setTabState] = useState(() => ({
    token: pendingImport.preview.review_token,
    bank: ask.length > 0,
    needs: remaining > 0,
    revealed: false,
    selected: opening,
  }));
  // A replacement preview starts a fresh set of sticky tabs, retaining selection if it applies.
  if (tabState.token !== pendingImport.preview.review_token) {
    const stillAvailable = tabState.selected === "bank" ? ask.length > 0 : tabState.selected === "needs" ? remaining > 0 : rows.length > 0;
    setTabState({ token: pendingImport.preview.review_token, bank: ask.length > 0, needs: remaining > 0, revealed: false, selected: stillAvailable ? tabState.selected : opening });
  } else if ((!tabState.bank && ask.length > 0) || (!tabState.needs && remaining > 0)) {
    setTabState({ ...tabState, bank: tabState.bank || ask.length > 0, needs: tabState.needs || remaining > 0 });
  }
  const listedBankCategories = tabState.revealed ? unmatched_categories : ask;
  const tabs: { id: ImportTab; label: string }[] = [
    ...(tabState.bank ? [{ id: "bank" as const, label: `Bank categories (${listedBankCategories.length})` }] : []),
    ...(tabState.needs ? [{ id: "needs" as const, label: `Needs a category (${remaining})` }] : []),
    { id: "rows", label: `Transactions (${rows.length})` },
  ];

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
        {rows.length > 0 && remembered.length > 0 && !tabState.revealed && (
          <p className="import-review-remembered">
            Using your choices from last time for {count(remembered.length, "bank category", "bank categories")}.{" "}
            <button type="button" className="modal-secondary" aria-label="Change your choices from last time" disabled={busy}
              onClick={() => setTabState({ ...tabState, bank: true, revealed: true, selected: "bank" })}>
              Change
            </button>
          </p>
        )}
        {rows.length > 0 && (
          <PageTabs<ImportTab>
            key={pendingImport.preview.review_token}
            tabs={tabs}
            initial={opening}
            selected={tabState.selected}
            onSelect={(selected) => setTabState({ ...tabState, selected })}
            idPrefix="import-review"
            label="Import sections"
            className="import-review-tabs"
            render={(id) => id === "bank" ? (
                <ImportCategoryReconcile
                  unmatched={listedBankCategories}
                  categories={categoryOptions}
                  choices={importCategoryChoices}
                  disabled={busy}
                  rows={rows}
                  included={includedIndices}
                  onChange={(name, choice) => updateImportCategoryChoices({ ...importCategoryChoices, [name]: choice })}
                  onSetAll={(action) =>
                    updateImportCategoryChoices({ ...importCategoryChoices, ...Object.fromEntries(listedBankCategories.map((u) => [u.name, { action } as CategoryChoice])) })
                  }
                />
            ) : id === "needs" ? (remaining === 0 ? <p role="status">Every row has a category now.</p> : (
                <ImportNeedsChoice
                  rows={rows.filter((r) => includedIndices.has(r.index) && rowNeedsChoice(r, importCategoryChoices, choice_below))}
                  categories={categoryOptions}
                  choices={importRowChoices}
                  disabled={busy}
                  onChoose={(index, category) => setImportRowChoices((prev) => new Map(prev).set(index, category))}
                  onLeaveRest={leaveRestOfRowsUncategorized}
                />
            )) : (
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
                              <div className="account-col" title="Account name from the file. Import uses the existing account selected above.">
                                CSV: {row.account_name}
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
          />
        )}
      </div>
    </ModalShell>
  );
}
