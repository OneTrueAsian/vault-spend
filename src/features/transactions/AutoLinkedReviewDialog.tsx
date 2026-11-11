import { type Transaction } from "../../shared/lib/types";
import { formatDisplayDate, formatAmount } from "../../shared/lib/format";
import { ModalShell } from "../../shared/ui/Modal";

/** The review report for automatic transfer links (Settings > "Link matching
 * transfers automatically"): every pair Vault Spend linked on its own that
 * nobody has confirmed yet. "Looks right" clears a pair from this list (the link
 * stays); "Unlink" undoes it, and that pair is never auto-linked again. */
export function AutoLinkedReviewDialog({
  pairs,
  onUnlink,
  onLooksRight,
  onClose,
}: {
  pairs: { out: Transaction; in: Transaction }[];
  onUnlink: (outId: number) => void;
  onLooksRight: (outIds: number[]) => void;
  onClose: () => void;
}) {
  return (
    <ModalShell title="Auto-linked transfers" onCancel={onClose} wide>
      <p className="modal-message modal-message-secondary">
        Vault Spend linked these pairs on its own: each was the only possible match for the other. They no longer count as
        income or spending. Mark a pair “Looks right” to clear it from this list, or Unlink it if it isn't really a transfer
        (it won't be linked automatically again).
      </p>
      {pairs.length === 0 ? (
        <p className="empty-state" data-autolink-empty>
          Nothing left to review.
        </p>
      ) : (
        <ul className="transfer-review-list" data-autolink-list>
          {pairs.map((p) => (
            <li key={p.out.id}>
              <div className="autolink-review-row" data-autolink-row={p.out.id}>
                <span className="transfer-review-when">{formatDisplayDate(p.out.date)}</span>
                <span className="transfer-review-what">
                  {p.out.account_name} → {p.in.account_name}
                </span>
                <span className="transfer-review-amount">{formatAmount(p.in.amount)}</span>
                <span className="autolink-review-actions">
                  <button type="button" className="modal-secondary btn-sm" data-autolink-unlink onClick={() => onUnlink(p.out.id)}>
                    Unlink
                  </button>
                  <button type="button" className="modal-secondary btn-sm" data-autolink-ok onClick={() => onLooksRight([p.out.id])}>
                    Looks right
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onClose}>
          Close
        </button>
        {pairs.length > 1 && (
          <button type="button" data-autolink-ok-all onClick={() => onLooksRight(pairs.map((p) => p.out.id))}>
            Looks right — all {pairs.length}
          </button>
        )}
      </div>
    </ModalShell>
  );
}
