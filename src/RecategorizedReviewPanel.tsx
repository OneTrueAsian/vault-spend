import "./Ledger.css";
import type * as React from "react";

import { formatAmount, formatDisplayDate } from "./format";

import type { Transaction } from "./types";
import { MenuSelect } from "./MenuSelect";

interface RecategorizedReviewPanelProps {
  reviewIds: Set<number>;
  transactions: Transaction[];
  handleCategoryChange: (id: number, value: string) => Promise<void>;
  categoryOptions: string[];
  setReviewIds: React.Dispatch<React.SetStateAction<Set<number> | null>>;
}

export function RecategorizedReviewPanel({
  reviewIds,
  transactions,
  handleCategoryChange,
  categoryOptions,
  setReviewIds,
}: RecategorizedReviewPanelProps) {
  return (
    <div className="dup-review">
      <p className="dup-review-summary">
        Just categorized {reviewIds.size} transaction(s). Review and fix any that are wrong.
      </p>
      <table className="dup-review-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th className="amount-col">Amount</th>
            <th>Category</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {transactions
            .filter((t) => reviewIds.has(t.id))
            .map((t) => (
              <tr key={t.id}>
                <td className="date-cell">{formatDisplayDate(t.date)}</td>
                <td>{t.description}</td>
                <td className="amount-col">{formatAmount(t.amount)}</td>
                <td>
                  <MenuSelect
                    ariaLabel={`Category for "${t.description}"`}
                    value={t.category ?? ""}
                    onChange={(v) => handleCategoryChange(t.id, v)}
                    options={[
                      { value: "", label: "Uncategorized", disabled: true },
                      ...(t.category && !categoryOptions.includes(t.category) ? [{ value: t.category, label: t.category }] : []),
                      ...categoryOptions.map((c) => ({ value: c, label: c })),
                      { value: "__new__", label: "+ New category…" },
                    ]}
                  />
                </td>
                <td className="source-col">
                  {t.category_source ?? ""}
                  {t.confidence !== null && (
                    <span className="confidence-badge">{Math.round(t.confidence * 100)}%</span>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="dup-review-actions">
        <button onClick={() => setReviewIds(null)}>Done</button>
      </div>
    </div>
  );
}
