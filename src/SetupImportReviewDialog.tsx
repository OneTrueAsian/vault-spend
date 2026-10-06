import { accountTypeLabel } from "./accountGroups";
import "./Ledger.css";

import { formatAmount, formatDisplayDate } from "./format";
import { ModalShell } from "./Modal";

import type { SetupImportPreview } from "./types";

/** A setup-data file being reviewed: what it holds, and which rows of each kind are ticked. */
export type PendingSetupImport = {
  path: string;
  preview: SetupImportPreview;
  includedAccounts: Set<number>;
  includedCategories: Set<number>;
  includedBudgets: Set<number>;
  includedBuckets: Set<number>;
  includedHoldings: Set<number>;
};

export type SetupImportSection = "includedAccounts" | "includedCategories" | "includedBudgets" | "includedBuckets" | "includedHoldings";

/** The setup-data import review, as a pop-up over whichever tab started it (Settings): each kind
 * of row with its checkbox, and Cancel / Import selected pinned at the foot. Escape cancels; a
 * click outside doesn't. */
export function SetupImportReviewDialog({
  pending: pendingSetupImport,
  busy,
  onToggle: toggleSetupIncluded,
  onCancel,
  onConfirm: confirmSetupImport,
}: {
  pending: PendingSetupImport;
  busy: boolean;
  onToggle: (section: SetupImportSection, index: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const errors = pendingSetupImport.preview.row_errors;
  const footer = (
    <div className="dup-review-actions">
      <button className="modal-secondary" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
      <button
        onClick={confirmSetupImport}
        disabled={
          busy ||
          pendingSetupImport.includedAccounts.size +
            pendingSetupImport.includedCategories.size +
            pendingSetupImport.includedBudgets.size +
            pendingSetupImport.includedBuckets.size +
            pendingSetupImport.includedHoldings.size ===
            0
        }
      >
        {busy ? "Importing…" : "Import selected"}
      </button>
    </div>
  );
  return (
    <ModalShell
      title="Import setup data"
      onCancel={() => {
        if (!busy) onCancel();
      }}
      wide
      footer={footer}
      dismissOnOverlayClick={false}
    >
      <div className="import-review-dialog">
        <p className="dup-review-summary">
          Untick anything you don't want.
          {errors > 0 && ` ${errors} ${errors === 1 ? "row had a problem and will be skipped" : "rows had problems and will be skipped"}.`}
        </p>

        {pendingSetupImport.preview.accounts.length > 0 && (
          <>
            <h2 className="reports-section-title">Accounts</h2>
            <table className="dup-review-table">
              <thead>
                <tr>
                  <th className="select-col"><span className="sr-only">Include</span></th>
                  <th>Name</th>
                  <th>Type</th>
                  <th className="amount-col">Starting balance</th>
                  <th>Institution</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pendingSetupImport.preview.accounts.map((row) => (
                  <tr key={row.index} className={row.already_exists ? "import-row-duplicate" : undefined}>
                    <td className="select-col">
                      <input
                        type="checkbox"
                        checked={pendingSetupImport.includedAccounts.has(row.index)}
                        onChange={() => toggleSetupIncluded("includedAccounts", row.index)}
                        aria-label={`Include account ${row.name}`}
                      />
                    </td>
                    <td>{row.name}</td>
                    <td>{accountTypeLabel(row.account_type)}</td>
                    <td className="amount-col">{row.starting_balance ? formatAmount(row.starting_balance) : ""}</td>
                    <td>{row.institution ?? ""}</td>
                    <td className="source-col">{row.already_exists ? "Already exists" : "New"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {pendingSetupImport.preview.categories.length > 0 && (
          <>
            <h2 className="reports-section-title">Categories</h2>
            <table className="dup-review-table">
              <thead>
                <tr>
                  <th className="select-col"><span className="sr-only">Include</span></th>
                  <th>Name</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pendingSetupImport.preview.categories.map((row) => (
                  <tr key={row.index} className={row.already_exists ? "import-row-duplicate" : undefined}>
                    <td className="select-col">
                      <input
                        type="checkbox"
                        checked={pendingSetupImport.includedCategories.has(row.index)}
                        onChange={() => toggleSetupIncluded("includedCategories", row.index)}
                        aria-label={`Include category ${row.name}`}
                      />
                    </td>
                    <td>{row.name}</td>
                    <td className="source-col">{row.already_exists ? "Already exists" : "New"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {pendingSetupImport.preview.budgets.length > 0 && (
          <>
            <h2 className="reports-section-title">Budgets</h2>
            <table className="dup-review-table">
              <thead>
                <tr>
                  <th className="select-col"><span className="sr-only">Include</span></th>
                  <th>Category</th>
                  <th>Group</th>
                  <th className="amount-col">Monthly amount</th>
                  <th>Period</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pendingSetupImport.preview.budgets.map((row) => (
                  <tr key={row.index}>
                    <td className="select-col">
                      <input
                        type="checkbox"
                        checked={pendingSetupImport.includedBudgets.has(row.index)}
                        onChange={() => toggleSetupIncluded("includedBudgets", row.index)}
                        aria-label={`Include budget ${row.category}`}
                      />
                    </td>
                    <td>{row.category}</td>
                    <td>{row.budget_group}</td>
                    <td className="amount-col">{formatAmount(row.monthly_amount)}</td>
                    <td>{row.period ?? "This month"}</td>
                    <td className="source-col">{row.will_update ? "Will update existing" : "New"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {pendingSetupImport.preview.buckets.length > 0 && (
          <>
            <h2 className="reports-section-title">Goals</h2>
            <table className="dup-review-table">
              <thead>
                <tr>
                  <th className="select-col"><span className="sr-only">Include</span></th>
                  <th>Name</th>
                  <th className="amount-col">Target</th>
                  <th>Target date</th>
                  <th>Linked account</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pendingSetupImport.preview.buckets.map((row) => (
                  <tr key={row.index} className={row.already_exists ? "import-row-duplicate" : undefined}>
                    <td className="select-col">
                      <input
                        type="checkbox"
                        checked={pendingSetupImport.includedBuckets.has(row.index)}
                        onChange={() => toggleSetupIncluded("includedBuckets", row.index)}
                        aria-label={`Include goal ${row.name}`}
                      />
                    </td>
                    <td>{row.name}</td>
                    <td className="amount-col">{row.target_amount ? formatAmount(row.target_amount) : ""}</td>
                    <td className="date-cell">{row.target_date ? formatDisplayDate(row.target_date) : ""}</td>
                    <td>{row.linked_account_name ?? ""}</td>
                    <td className="source-col">{row.already_exists ? "Already exists" : "New"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {pendingSetupImport.preview.holdings.length > 0 && (
          <>
            <h2 className="reports-section-title">Holdings</h2>
            <table className="dup-review-table">
              <thead>
                <tr>
                  <th className="select-col"><span className="sr-only">Include</span></th>
                  <th>Account</th>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th className="amount-col">Shares</th>
                  <th className="amount-col">Price</th>
                  <th className="amount-col">What you paid</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pendingSetupImport.preview.holdings.map((row) => (
                  <tr key={row.index} className={row.account_found ? undefined : "import-row-duplicate"}>
                    <td className="select-col">
                      <input
                        type="checkbox"
                        checked={pendingSetupImport.includedHoldings.has(row.index)}
                        onChange={() => toggleSetupIncluded("includedHoldings", row.index)}
                        aria-label={`Include holding ${row.symbol}`}
                      />
                    </td>
                    <td>{row.account_name}</td>
                    <td>{row.symbol}</td>
                    <td>{row.name ?? ""}</td>
                    <td className="amount-col">{row.shares}</td>
                    <td className="amount-col">{formatAmount(row.price)}</td>
                    <td className="amount-col">{formatAmount(row.cost_basis)}</td>
                    <td className="source-col">{row.account_found ? "New" : "Account not found"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

      </div>
    </ModalShell>
  );
}
