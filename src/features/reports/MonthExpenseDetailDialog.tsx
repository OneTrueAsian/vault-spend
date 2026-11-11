import { type MonthExpenseDetail } from "../../shared/lib/types";
import { formatAmount } from "../../shared/lib/format";
import { ModalShell } from "../../shared/ui/Modal";

export function MonthExpenseDetailDialog({
  detail,
  onClose,
}: {
  detail: MonthExpenseDetail;
  onClose: () => void;
}) {
  const maxCategory = detail.categories.length ? parseFloat(detail.categories[0].amount) : 1;

  return (
    <ModalShell title={`${detail.month_label} expenses`} onCancel={onClose} wide>
      {detail.categories.length === 0 ? (
        <p className="empty-state">No expenses this month.</p>
      ) : (
        <div style={{ marginBottom: 18 }}>
          {detail.categories.map((c) => (
            <div key={c.category} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: 5 }}>
                <span style={{ fontWeight: 600 }}>{c.category}</span>
                <span className="amount-col">{formatAmount(c.amount)}</span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${(parseFloat(c.amount) / maxCategory) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="modal-message-secondary" style={{ fontWeight: 700, marginBottom: 8 }}>
        Large expenses
      </p>
      {detail.large_expenses.length === 0 ? (
        <p className="modal-message modal-message-secondary">Nothing stood out as unusually large this month.</p>
      ) : (
        <ul className="large-expense-list">
          {detail.large_expenses.map((e) => (
            <li key={e.transaction_id} className="large-expense-row">
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                <span style={{ fontWeight: 600 }}>{e.description}</span>
                <span className="amount-col">{formatAmount(e.amount)}</span>
              </div>
              <div className="modal-message-secondary">{e.detail}</div>
            </li>
          ))}
        </ul>
      )}

      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </ModalShell>
  );
}
