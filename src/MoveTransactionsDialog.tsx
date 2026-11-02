import { useState } from "react";
import { ModalShell } from "./Modal";
import type { MoveDialogState } from "./useTransactionMove";
import { formatDisplayDate } from "./format";
import { effectLine, effectReason, money, moveTransactionsText, type ConfirmationAccount, type MoveBlocker, type MovePreview } from "./transactionAccountMove";
import "./MoveTransactionsDialog.css";

const PAGE = 10;

/** One screen of a long list: the first PAGE entries, and a button for the next ones. `wrap` puts the button
 * inside the kind of element the list needs around it (a list item, or a table row). */
function Paged<T>({ items, label, render, wrap }: { items: readonly T[]; label: string; render: (item: T) => React.ReactNode; wrap: (button: React.ReactNode) => React.ReactNode }) {
  const [shown, setShown] = useState(PAGE);
  const left = items.length - shown;
  return (
    <>
      {items.slice(0, shown).map(render)}
      {left > 0 &&
        wrap(
          <button type="button" className="modal-secondary move-more" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, left)} more {label} ({left} left)
          </button>,
        )}
    </>
  );
}

function Blockers({ blockers }: { blockers: readonly MoveBlocker[] }) {
  return (
    <section className="move-blockers" aria-labelledby="move-blockers-title">
      <h3 id="move-blockers-title" role="alert">Nothing will be moved</h3>
      <p>These need your attention first. Transactions can only be moved together, so take the blocked ones out of your selection to continue.</p>
      {blockers.map((b) => (
        <div key={b.code} className="move-blocker" data-move-blocker={b.code}>
          <p className="move-blocker-summary">{b.summary}</p>
          <ul>
            <Paged items={b.items} label="transactions" render={(item) => <li key={item.transactionId}>{item.detail}</li>} wrap={(button) => <li className="move-more-item">{button}</li>} />
          </ul>
        </div>
      ))}
    </section>
  );
}

function sourcesText(preview: MovePreview): string {
  return preview.sources.map((s) => `${s.accountName} (${s.count})`).join(", ");
}

/** One account's balance for a move that needs it: what the app shows now (a reference), and a box or an explicit keep. */
function BalanceInputs({ accounts, balances, onSet }: { accounts: readonly ConfirmationAccount[]; balances: MoveDialogState["balances"]; onSet: (accountId: number, change: { keep: boolean; value?: string }) => void }) {
  return (
    <section className="move-confirm" aria-labelledby="move-confirm-title" data-move-confirm-balances>
      <h3 id="move-confirm-title">Confirm the balance after this move</h3>
      <p>
        Your transactions will move. The balances you confirm will apply from today. Older saved balances cannot be reconstructed from the available records,
        so they keep their values.
      </p>
      {accounts.map((c) => {
        const mine = balances[c.accountId];
        const keep = Boolean(mine?.keep);
        const inputId = `move-balance-${c.accountId}`;
        const errorId = `move-balance-error-${c.accountId}`;
        return (
          <fieldset key={c.accountId} className="move-confirm-account" data-move-confirm-account={c.accountId}>
            <legend>{c.accountName}</legend>
            <ul className="move-confirm-reasons">
              {c.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
            <p className="move-confirm-current">
              Shown now: <strong>{money(c.currentDisplay)}</strong> (for reference only; it is not counted as confirmed)
              {c.creditLimit !== null && c.availableCredit !== null && <> · Credit limit {money(c.creditLimit)}, available credit {money(c.availableCredit)}</>}
            </p>
            <div className="move-confirm-row">
              <label htmlFor={inputId}>{c.inputLabel} after the move</label>
              <input
                id={inputId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={keep ? c.currentDisplay : mine?.value ?? ""}
                disabled={keep}
                aria-invalid={Boolean(c.problem)}
                aria-describedby={errorId}
                placeholder="For example 1250.40"
                onChange={(e) => onSet(c.accountId, { keep: false, value: e.target.value })}
              />
              <button type="button" className="modal-secondary" aria-pressed={keep} data-move-keep={c.accountId} onClick={() => onSet(c.accountId, { keep: !keep, value: keep ? "" : undefined })}>
                {keep ? "Entering my own" : "Keep this balance"}
              </button>
            </div>
            {/* The space is always reserved, so an error appearing never moves the buttons below it. */}
            <p className="move-confirm-error" id={errorId} role={c.problem ? "alert" : undefined} data-move-balance-error={c.accountId}>{c.problem ?? ""}</p>
          </fieldset>
        );
      })}
    </section>
  );
}

function Review({ preview, hiddenByFilter, balances, editing, onSetBalance }: {
  preview: MovePreview; hiddenByFilter: string | null; balances: MoveDialogState["balances"]; editing: boolean; onSetBalance: (accountId: number, change: { keep: boolean; value?: string }) => void;
}) {
  const blocked = preview.blockers.length > 0;
  const choosing = preview.mode === "confirmation" && preview.confirmations.length > 0 && preview.blockers.length === 0 && editing;
  return (
    <>
      {preview.effectiveCount > 0 && (
        <p className="move-summary" data-move-summary>
          {moveTransactionsText(preview.effectiveCount)} from {sourcesText(preview)}, dated {preview.firstDate === preview.lastDate ? formatDisplayDate(preview.firstDate!) : `${formatDisplayDate(preview.firstDate!)} to ${formatDisplayDate(preview.lastDate!)}`}, adding up to {money(preview.total)}. Amounts keep their signs; this moves the entries and is not a bank transfer.
        </p>
      )}
      {preview.alreadyThereCount > 0 && (
        <p data-move-already-there>
          {preview.alreadyThereCount} selected {preview.alreadyThereCount === 1 ? "transaction is" : "transactions are"} already in {preview.destinationName} and will stay there.
        </p>
      )}
      {preview.effectiveCount === 0 && !blocked && <p>Every selected transaction is already in {preview.destinationName}, so there is nothing to move.</p>}
      {blocked && <Blockers blockers={preview.blockers} />}
      {choosing && <BalanceInputs accounts={preview.confirmations} balances={balances} onSet={onSetBalance} />}
      {!choosing && !blocked && preview.mode === "confirmation" && preview.confirmations.length > 0 && (
        <section aria-labelledby="move-confirmed-title" data-move-confirmed>
          <h3 id="move-confirmed-title">Balances you confirmed</h3>
          <ul className="move-balances">
            {preview.confirmations.map((c) => (
              <li key={c.accountId}><strong>{c.accountName}</strong> <span className="move-effect-line">{c.inputLabel} after the move: {c.confirmedDisplay !== null ? money(c.confirmedDisplay) : "not confirmed"} ({c.choice === "keep" ? "kept as shown" : "entered by you"})</span></li>
            ))}
          </ul>
        </section>
      )}
      {!choosing && !blocked && preview.checkpointEffects.notes.length > 0 && (
        <ul className="move-notes" data-move-notes>
          {preview.checkpointEffects.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      {preview.effects.length > 0 && (
        <section aria-labelledby="move-balances-title">
          <h3 id="move-balances-title">{blocked ? "What would change" : "What changes"}</h3>
          <ul className="move-balances" data-move-balances>
            {preview.effects.map((e) => (
              <li key={e.accountId} data-move-effect={e.accountId}>
                <strong>{e.accountName}</strong> <span className="move-role">{e.role === "destination" ? "receives" : "gives up"} {moveTransactionsText(e.movedCount)}</span>
                <span className="move-effect-line">{effectLine(e)}</span>
                {preview.mode === "automatic" && effectReason(e) && <span className="move-effect-line move-effect-secondary">{effectReason(e)}</span>}
                {e.availableCurrent !== null && e.availableProjected !== null && !e.holdingsOverride && (
                  <span className="move-effect-line move-effect-secondary">Available credit {money(e.availableCurrent)} → {money(e.availableProjected)}</span>
                )}
              </li>
            ))}
          </ul>
          <p data-move-total>Across these accounts, assets less debts: {money(preview.netBefore)} → {money(preview.netAfter)}{preview.status === "needs_balance_confirmation" ? " (enter balances to review the final total)" : ""}.</p>
        </section>
      )}
      {preview.warnings.length > 0 && (
        <ul className="move-warnings" data-move-warnings>
          {preview.warnings.map((w) => <li key={w.code} data-move-warning={w.code}>{w.detail}</li>)}
        </ul>
      )}
      <p className="move-keeps">Categories, tags, notes, splits and who each transaction is for stay with the transactions. No transactions are deleted or created.</p>
      {hiddenByFilter && !blocked && preview.effectiveCount > 0 && (
        <p className="move-filter-note">These transactions may disappear from this list because you are viewing {hiddenByFilter}.</p>
      )}
      <section aria-labelledby="move-list-title">
        <h3 id="move-list-title">The transactions</h3>
        <div className="move-table-wrap" tabIndex={0} role="region" aria-label="The transactions, scrollable">
          <table className="move-table">
            <thead>
              <tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col" className="move-amount">Amount</th><th scope="col">Now in</th><th scope="col">Result</th></tr>
            </thead>
            <tbody>
              <Paged
                items={preview.rows}
                label="rows"
                wrap={(button) => <tr><td colSpan={5}>{button}</td></tr>}
                render={(r) => (
                  <tr key={r.id} data-move-row={r.id} data-status={r.status}>
                    <td>{formatDisplayDate(r.date)}</td><td className="move-description">{r.description}</td><td className="move-amount">{money(r.amount)}</td><td>{r.accountName}</td>
                    <td>{r.status === "move" ? "Will move" : r.status === "blocked" ? "Blocked" : "Already there"}</td>
                  </tr>
                )}
              />
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** Review and confirm moving transactions to another account. Everything shown comes from the native preview; the
 * only things this component decides are what to say and whether the one confirm button is enabled. */
export function MoveTransactionsDialog({ dialog, hiddenByFilter, onCancel, onConfirm, onReviewAgain, onReloadAndClose, onSetBalance, onReviewBalances, onChangeBalances }: {
  dialog: MoveDialogState;
  /** The account the Transactions list is limited to, when moving would take rows out of that view. */
  hiddenByFilter: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onReviewAgain: () => void;
  onReloadAndClose: () => void;
  onSetBalance: (accountId: number, change: { keep: boolean; value?: string }) => void;
  onReviewBalances: () => void;
  onChangeBalances: () => void;
}) {
  const { phase, preview, destinationName } = dialog;
  const effective = preview?.effectiveCount ?? 0;
  const blocked = (preview?.blockers.length ?? 0) > 0;
  const choosing = preview?.mode === "confirmation" && preview.confirmations.length > 0 && preview.blockers.length === 0 && dialog.editingBalances;
  const everyBalanceGiven = (preview?.confirmations ?? []).every((c) => {
    const mine = dialog.balances[c.accountId];
    return Boolean(mine && (mine.keep || mine.value.trim() !== ""));
  });
  const title = blocked ? `Can't move these to ${destinationName} yet` : choosing ? `Confirm balances to move these to ${destinationName}` : preview && effective > 0 ? `Move ${moveTransactionsText(effective)} to ${destinationName}?` : `Move to ${destinationName}`;
  const busy = phase === "committing";
  const canConfirm = phase === "ready" && Boolean(preview?.canCommit);
  // Said once the review has loaded or has changed, for people who cannot see the dialog fill in.
  const announcement =
    phase === "ready" && preview
      ? choosing
        ? `${preview.confirmations.length === 1 ? "One balance needs" : `${preview.confirmations.length} balances need`} confirming before these transactions can move. Enter each balance or keep the one shown, then choose Review the move.`
        : blocked
        ? `Nothing will be moved. ${preview.blockers.length === 1 ? "There is 1 reason" : `There are ${preview.blockers.length} reasons`}, listed in the dialog.`
        : effective > 0
          ? `Ready to move ${moveTransactionsText(effective)} to ${destinationName}. Review what changes, then choose Move.`
          : `Every selected transaction is already in ${destinationName}.`
      : "";
  const footer =
    phase === "uncertain" ? (
      <div className="modal-actions">
        <button type="button" onClick={onReloadAndClose}>Reload and check</button>
      </div>
    ) : phase === "failed" ? (
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel}>Close</button>
        <button type="button" onClick={onReviewAgain}>Try again</button>
      </div>
    ) : choosing ? (
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={onReviewBalances} disabled={!everyBalanceGiven} data-move-review-balances>Review the move</button>
      </div>
    ) : (
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        {preview?.mode === "confirmation" && phase === "ready" && !blocked && (
          <button type="button" className="modal-secondary" onClick={onChangeBalances} data-move-change-balances>Change balances</button>
        )}
        <button type="button" onClick={onConfirm} disabled={!canConfirm || busy} data-move-confirm>
          {busy ? "Moving…" : effective > 0 && !blocked ? `Move ${moveTransactionsText(effective)}` : "Move"}
        </button>
      </div>
    );
  return (
    <ModalShell title={title} wide onCancel={onCancel} dismissOnOverlayClick={false} footer={footer} panelAttrs={{ "data-move-dialog": true, "aria-busy": busy || phase === "loading" }}>
      <p className="move-sr" role="status" data-move-announcement>{announcement}</p>
      <div className="move-dialog-body" tabIndex={0} role="region" aria-label="Move details">
        {dialog.notice && <p className="move-notice" role="status" data-move-notice>{dialog.notice}</p>}
        {phase === "loading" && <p role="status" data-move-loading>Checking these transactions…</p>}
        {(phase === "failed" || phase === "uncertain") && dialog.message && <p className="move-notice move-notice-error" role="alert" data-move-error>{dialog.message}</p>}
        {preview && phase !== "uncertain" && <Review preview={preview} hiddenByFilter={hiddenByFilter} balances={dialog.balances} editing={dialog.editingBalances} onSetBalance={onSetBalance} />}
        {busy && <p role="status">Moving the transactions. Don't close the app.</p>}
      </div>
    </ModalShell>
  );
}
