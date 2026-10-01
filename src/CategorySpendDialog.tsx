import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CategoryTransaction } from "./types";
import { formatAmount } from "./format";
import { ModalShell } from "./Modal";

export function CategorySpendDialog({ category, year, month, onClose }: {
  category: string;
  year: number;
  month: number;
  onClose: () => void;
}) {
  const [items, setItems] = useState<CategoryTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    invoke<CategoryTransaction[]>("spending_transactions_for_category", { category, year, month })
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch((reason) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [category, year, month]);

  const label = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const total = (items ?? []).reduce((sum, item) => sum - Number(item.amount), 0);
  return (
    <ModalShell title={`${category} — ${label}`} onCancel={onClose} wide>
      <div data-category-spend-detail>
        {error ? <p role="alert">Could not load category spending: {error}</p> : items === null ? <p>Loading transactions…</p> : (
          <>
            <p className="modal-message-secondary">{items.length} contributing {items.length === 1 ? "transaction" : "transactions"} · Total {formatAmount(total.toFixed(2))}</p>
            {items.length === 0 ? <p className="empty-state">No spending in this category for this month.</p> : (
              <div className="modal-table-scroll">
                <table className="ledger">
                  <thead><tr><th>Date</th><th>Description</th><th>Account</th><th className="amount-col">Spent</th></tr></thead>
                  <tbody>{items.map((item, index) => (
                    <tr key={`${item.transaction_id}-${index}`}>
                      <td>{item.date}</td>
                      <td>{item.description}{item.is_split && <span className="account-col"> · split{item.split_note ? `: ${item.split_note}` : ""}</span>}</td>
                      <td>{item.account_name}</td>
                      <td className="amount-col">{formatAmount((-Number(item.amount)).toFixed(2))}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </>
        )}
        <div className="modal-actions"><button type="button" onClick={onClose}>Close</button></div>
      </div>
    </ModalShell>
  );
}
