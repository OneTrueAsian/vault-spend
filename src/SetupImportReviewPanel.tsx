import "./Ledger.css";
import type * as React from "react";

import { formatAmount } from "./format";

import type { SetupImportPreview } from "./types";

interface SetupImportReviewPanelProps {
  pendingSetupImport: { path: string; preview: SetupImportPreview; includedAccounts: Set<number>; includedCategories: Set<number>; includedBudgets: Set<number>; includedBuckets: Set<number>; includedHoldings: Set<number>; };
  toggleSetupIncluded: (section: "includedAccounts" | "includedCategories" | "includedBudgets" | "includedBuckets" | "includedHoldings", index: number) => void;
  setPendingSetupImport: React.Dispatch<React.SetStateAction<{ path: string; preview: SetupImportPreview; includedAccounts: Set<number>; includedCategories: Set<number>; includedBudgets: Set<number>; includedBuckets: Set<number>; includedHoldings: Set<number>; } | null>>;
  busy: boolean;
  confirmSetupImport: () => Promise<void>;
}

export function SetupImportReviewPanel({
  pendingSetupImport,
  toggleSetupIncluded,
  setPendingSetupImport,
  busy,
  confirmSetupImport,
}: SetupImportReviewPanelProps) {
  return (
    <div className="dup-review">
      <p className="dup-review-summary">
        Reviewing setup data from this file — uncheck anything you don't want imported.
        {pendingSetupImport.preview.row_errors > 0 &&
          ` ${pendingSetupImport.preview.row_errors} row(s) had errors and will be ignored.`}
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
                  <td>{row.account_type}</td>
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
                  <td>{row.target_date ?? ""}</td>
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

      <div className="dup-review-actions">
        <button className="modal-secondary" onClick={() => setPendingSetupImport(null)} disabled={busy}>
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
    </div>
  );
}
