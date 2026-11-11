import { type Transaction } from "../../shared/lib/types";
import { useState } from "react";
import { errorMessage } from "../../shared/lib/errorMessage";
import { formatDisplayDate, formatAmount } from "../../shared/lib/format";
import { ModalShell } from "../../shared/ui/Modal";

/** "Review possible transfers" — pairs of transactions that look like the two
 * legs of one move of money between the user's own accounts (equal amounts,
 * opposite directions, different accounts, within a few days). Each starts
 * ticked; unticking one leaves it as ordinary spending/income for Link, and
 * for Dismiss selected. Dismiss (selected, or all) tells Vault
 * Spend to stop suggesting a pair — it's a decision about the *suggestion*,
 * never the transactions themselves: nothing is deleted, no category or
 * amount changes, and totals are untouched. Not now just closes for this
 * session; a dismissed pair won't come back even after restart. */
export function TransferReviewDialog({
  pairs,
  onLink,
  onDismiss,
  onDismissAll,
  onCancel,
}: {
  pairs: { out: Transaction; in: Transaction }[];
  onLink: (pairs: { out_id: number; in_id: number }[]) => void;
  /** Dismiss one or more exact pairs — never treats an unchecked pair as
   * included. Rejecting means the dialog stays open with an inline error;
   * resolving means the caller has already refreshed `pairs` for the next render. */
  onDismiss: (pairs: { out_id: number; in_id: number }[]) => Promise<void>;
  /** Dismisses the *complete* current eligible set, including alternate
   * pairings this dialog's own one-per-transaction view doesn't show — the
   * caller fetches that full set itself so "Dismiss all" really clears the list. */
  onDismissAll: () => Promise<void>;
  onCancel: () => void;
}) {
  // Keyed by the *pair* (both legs), not just the out id: if dismissing one
  // alternate surfaces another with the same out transaction but a
  // different in leg, that's a different pair the user hasn't reviewed —
  // keying by out id alone let it silently inherit whatever the old pair's
  // checkbox happened to say (found by code review). A pair not in this
  // set (new, or never explicitly toggled) reads as unchecked.
  const pairKey = (p: { out: Transaction; in: Transaction }) => `${p.out.id}:${p.in.id}`;
  const [checked, setChecked] = useState<Set<string>>(() => new Set(pairs.map(pairKey)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const chosen = pairs.filter((p) => checked.has(pairKey(p)));

  async function runDismiss(action: () => Promise<void>) {
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (pairs.length === 0) {
    return (
      <ModalShell title="Possible transfers" onCancel={onCancel} wide>
        <p className="modal-message modal-message-secondary">No more possible transfers to review right now.</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Close
          </button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Possible transfers" onCancel={onCancel} wide>
      <p className="modal-message modal-message-secondary">
        These look like money moving between your own accounts. Linking a pair keeps both sides out of your income and
        spending totals, and shows them as one row in Transactions. Dismissing a pair just stops Vault Spend suggesting
        it again — it never changes the transactions themselves. You can unlink or manually link any time.
      </p>
      {error && (
        <p className="launch-error-problem" role="alert">
          {error}
        </p>
      )}
      <ul className="transfer-review-list">
        {pairs.map((p) => {
          const days = Math.abs(Math.round((Date.parse(p.out.date) - Date.parse(p.in.date)) / 86_400_000));
          return (
            <li key={p.out.id}>
              <label className="transfer-review-row">
                <input type="checkbox" checked={checked.has(pairKey(p))} onChange={() => toggle(pairKey(p))} />
                <span className="transfer-review-when">{formatDisplayDate(p.out.date)}</span>
                <span className="transfer-review-what">
                  {p.out.account_name} → {p.in.account_name}
                </span>
                <span className="transfer-review-amount">{formatAmount(p.in.amount)}</span>
                <span className="transfer-review-note">{days === 0 ? "same day" : `${days} day${days === 1 ? "" : "s"} apart`}</span>
              </label>
              <details className="transfer-review-details">
                <summary>View transactions</summary>
                <div className="transfer-review-transactions">
                  {[{ transaction: p.out, direction: "Money out" }, { transaction: p.in, direction: "Money in" }].map(({ transaction, direction }) => (
                    <div className="transfer-review-transaction" key={transaction.id}>
                      <strong>{direction} · {transaction.account_name}</strong>
                      <span>{formatDisplayDate(transaction.date)} · {formatAmount(transaction.amount)}</span>
                      <span>{transaction.description}</span>
                      <span className="transfer-review-note">Category: {transaction.category || "Uncategorized"}</span>
                    </div>
                  ))}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel} disabled={saving}>
          Not now
        </button>
        <button
          type="button"
          className="modal-secondary"
          data-dismiss-selected
          disabled={saving || chosen.length === 0}
          onClick={() => runDismiss(() => onDismiss(chosen.map((p) => ({ out_id: p.out.id, in_id: p.in.id }))))}
        >
          Dismiss {chosen.length > 0 ? chosen.length : ""} selected
        </button>
        <button type="button" className="modal-secondary" data-dismiss-all disabled={saving} onClick={() => runDismiss(onDismissAll)}>
          Dismiss all
        </button>
        <button
          type="button"
          disabled={saving || chosen.length === 0}
          onClick={() => onLink(chosen.map((p) => ({ out_id: p.out.id, in_id: p.in.id })))}
        >
          Link {chosen.length} as {chosen.length === 1 ? "a transfer" : "transfers"}
        </button>
      </div>
    </ModalShell>
  );
}
