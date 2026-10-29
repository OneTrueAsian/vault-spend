import { accountTypeLabel } from "./accountGroups";
import "./AccountsCards.css";
import "./Transactions.css";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Account, AccountTransaction } from "./types";
import { LineChart } from "./charts";
import { formatAmount, formatDisplayDate, isValidDecimalString, shortMonthDay, toLocalIsoDate } from "./format";
import { addAmounts } from "./reconcileMath";
import { ModalShell } from "./Modal";
import { StatementReviewDialog } from "./StatementReviewDialog";
import { StatementTeachDialog } from "./StatementTeachDialog";
import { useStatementReconcile } from "./useStatementReconcile";
import { DateField } from "./DateField";
import { errorMessage } from "./errorMessage";
import { holdingCount } from "./holdingImport";
import { MenuSelect } from "./MenuSelect";
import { LEDGER_STEPS, transactionsShownLabel, showMoreLabel } from "./transactionPaging";
// Loaded on demand like the app's other views, so the chart and projection code stay out of the main chunk.
const AccountAccumulationSection = lazy(() => import("./AccumulationSection").then((m) => ({ default: m.AccountAccumulationSection })));

type BalancePoint = { date: string; balance: string };
type ReconcileStatus = { starting_point: string | null; needs_starting_balance: boolean; ticked_change: string; ticked_count: number; difference: string | null };
/** `statement_date`: the last reconciliation of any kind; `statement_balance`: the ending balance of the
 * last one that states a balance (an investment statement's record never does). */
type LastReconciliation = { statement_date: string; statement_balance: string | null };

/** What a statement calls this account's balance, in plain words. */
function balanceWords(accountType: string): { start: string; end: string } {
  if (accountType === "credit") return { start: "Amount owed at the start of the statement", end: "Amount owed at the end of the statement" };
  if (accountType === "loan") return { start: "Amount you owed on the loan at the start of the statement", end: "Amount you owed on the loan at the end of the statement" };
  return { start: "Starting balance on the statement", end: "Ending balance on the statement" };
}

/** One account on its own page: how its balance has moved, the recent
 * transactions, and a reconciliation against a bank statement (enter the
 * statement's dates and balances, tick what shows up on it, and finish once
 * the difference is $0.00). Every account type can be reconciled. */
export function AccountDetailView({
  account,
  onBack,
  backLabel = "← All accounts",
  onOpenTransactions,
  onOpenPayment,
  onMessage,
  onDataChanged,
  focus = null,
}: {
  account: Account;
  onBack: () => void;
  /** Where Back leads, when it isn't the account list (opened from the Investments tab). */
  backLabel?: string;
  onOpenTransactions: () => void;
  onOpenPayment: (sourceId: number) => void;
  onMessage: (text: string, kind: "success" | "error" | "info") => void;
  /** Called after a statement was finished: it can add transactions and change holdings, so the rest of the
   * app reloads its shared data. */
  onDataChanged?: () => Promise<void>;
  /** "reconcile": opened from an account row's "Reconcile with a statement", so the page starts at
   * the reconcile card with its first field ready to type in. */
  focus?: "reconcile" | null;
}) {
  const [history, setHistory] = useState<BalancePoint[]>([]);
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  // Like the Transactions tab: a step of rows at a time (25, 50 or 100), starting at 50. A different
  // account remounts this page (keyed in App), so it starts over at the first step.
  const [pageSize, setPageSize] = useState(50);
  const [shownCount, setShownCount] = useState(50);
  const [lastRec, setLastRec] = useState<LastReconciliation | null>(null);

  const [periodStart, setPeriodStart] = useState("");
  const [statementDate, setStatementDate] = useState(toLocalIsoDate());
  const [statementStart, setStatementStart] = useState("");
  const [statementBalance, setStatementBalance] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [candidates, setCandidates] = useState<AccountTransaction[]>([]);
  const [status, setStatus] = useState<ReconcileStatus | null>(null);
  /** Where a statement ending on `statementDate` picks up from, before any balance is typed. */
  const [preview, setPreview] = useState<ReconcileStatus | null>(null);
  const statementDateRef = useRef(statementDate);
  statementDateRef.current = statementDate;

  const reconcileCardRef = useRef<HTMLDivElement>(null);
  const statement = useStatementReconcile(account.id, (done) => {
    // The page was left while the statement saved: reload the rest of the app and say it finished.
    Promise.resolve(onDataChanged?.()).catch(() => {});
    onMessage(`Reconciled ${account.name}.${done.added ? ` Added ${done.added} transaction${done.added === 1 ? "" : "s"}.` : ""}`, "success");
  });
  const statementBalanceRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus !== "reconcile") return;
    reconcileCardRef.current?.scrollIntoView({ block: "start" });
    statementBalanceRef.current?.focus({ preventScroll: true });
    // Only when the page opens: later re-renders leave the person where they are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPreview = useCallback(
    async (date: string): Promise<ReconcileStatus | null> =>
      date
        ? invoke<ReconcileStatus>("reconcile_status", { accountId: account.id, statementDate: date, statementStart: null, statementEnd: null })
        : null,
    [account.id],
  );

  // Everything is fetched first and set together, so the page never shows a new last reconciliation
  // with an old answer to whether the next statement needs its starting balance.
  const loadOverview = useCallback(async () => {
    const [nextHistory, nextTransactions, nextLastRec, nextPreview] = await Promise.all([
      invoke<BalancePoint[]>("account_balance_history", { accountId: account.id, months: 12 }),
      invoke<AccountTransaction[]>("list_account_transactions", { accountId: account.id, limit: 200 }),
      invoke<LastReconciliation | null>("last_reconciliation", { accountId: account.id }),
      fetchPreview(statementDateRef.current),
    ]);
    setHistory(nextHistory);
    setTransactions(nextTransactions);
    setLastRec(nextLastRec);
    setPreview(nextPreview);
  }, [account.id, fetchPreview]);

  useEffect(() => {
    loadOverview().catch((e) => onMessage(errorMessage(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadOverview]);

  // A different statement date can pick up from a different reconciliation (an older month starts
  // from the one before it), or need its own starting balance.
  const previewedDate = useRef(statementDate);
  useEffect(() => {
    if (statementDate === previewedDate.current) return;
    let live = true;
    previewedDate.current = statementDate;
    fetchPreview(statementDate)
      .then((next) => live && setPreview(next))
      .catch((e) => live && onMessage(errorMessage(e), "error"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPreview, statementDate]);

  // Until the app has said otherwise, ask for the starting balance (an account's first reconciliation).
  const needsStart = preview?.needs_starting_balance ?? true;

  const loadReconciliation = useCallback(async () => {
    setCandidates(await invoke<AccountTransaction[]>("reconcile_candidates", { accountId: account.id, statementDate }));
    setStatus(
      await invoke<ReconcileStatus>("reconcile_status", {
        accountId: account.id,
        statementDate,
        statementStart: needsStart ? statementStart : null,
        statementEnd: statementBalance,
      }),
    );
  }, [account.id, statementDate, statementStart, statementBalance, needsStart]);

  const words = balanceWords(account.account_type);
  const balanceValid =
    statementBalance.trim() !== "" &&
    isValidDecimalString(statementBalance) &&
    (!needsStart || (statementStart.trim() !== "" && isValidDecimalString(statementStart)));

  async function startReconciling() {
    if (!balanceValid) return;
    try {
      await loadReconciliation();
      setReconciling(true);
    } catch (e) {
      onMessage(errorMessage(e), "error");
    }
  }

  async function toggleCleared(t: AccountTransaction) {
    try {
      await invoke("set_transactions_cleared", { ids: [t.id], cleared: !t.cleared });
      await loadReconciliation();
    } catch (e) {
      onMessage(errorMessage(e), "error");
    }
  }

  async function finish() {
    try {
      const ok = await invoke<boolean>("finish_reconciliation", {
        accountId: account.id,
        periodStart: periodStart || null,
        statementDate,
        statementStart: needsStart ? statementStart : null,
        statementEnd: statementBalance,
      });
      if (!ok) {
        onMessage("That doesn't balance yet — the difference has to be $0.00.", "error");
        return;
      }
      setReconciling(false);
      setStatementBalance("");
      setStatementStart("");
      setPeriodStart("");
      await loadOverview();
      onMessage(`Reconciled ${account.name} through ${formatDisplayDate(statementDate)}.`, "success");
    } catch (e) {
      onMessage(errorMessage(e), "error");
    }
  }

  const difference = status && status.difference !== null ? parseFloat(status.difference) : null;
  const balances = history.map((p) => parseFloat(p.balance));

  // A finished statement: refresh the page, say what happened, and close the flow.
  const finished = statement.phase.kind === "done" ? statement.phase.finished : null;
  const closeStatement = statement.cancel;
  useEffect(() => {
    if (!finished) return;
    const added = finished.added ? ` Added ${finished.added} transaction${finished.added === 1 ? "" : "s"}.` : "";
    const learned = finished.layout_saved ? ` The app will recognize ${finished.layout_saved} statements next time.` : "";
    loadOverview().catch((e) => onMessage(errorMessage(e), "error"));
    Promise.resolve(onDataChanged?.()).catch((e) => onMessage(`The statement was saved, but the rest of the app couldn't reload: ${errorMessage(e)}`, "error"));
    onMessage(`Reconciled ${account.name} through ${formatDisplayDate(statementDateRef.current)}.${added}${learned}`, "success");
    closeStatement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  return (
    <div className="account-detail" data-account-detail={account.id}>
      <div className="page-top">
        <div>
          <button type="button" className="modal-secondary" onClick={onBack} data-account-back>
            {backLabel}
          </button>
          <h1 className="view-title" style={{ marginTop: 12 }}>
            {account.name}
          </h1>
          <p className="view-sub">
            {accountTypeLabel(account.account_type)}
            {account.institution ? ` · ${account.institution}` : ""}
            {account.mask ? ` ···${account.mask}` : ""}
          </p>
        </div>
      </div>

      <div className="stats">
        <div className="stat tint-accent">
          <span className="stat-value">{formatAmount(account.current_balance)}</span>
          <span className="stat-label">Balance</span>
        </div>
        <div className="stat tint-blue" data-last-reconciled={lastRec ? lastRec.statement_date : ""}>
          <span className={lastRec ? "stat-value" : "stat-value stat-value-muted"}>{lastRec ? formatDisplayDate(lastRec.statement_date) : "Never"}</span>
          <span className="stat-label">Last reconciled</span>
        </div>
      </div>

      {account.account_type === "investment" && (
        <Suspense fallback={null}>
          <AccountAccumulationSection account={account} onMessage={onMessage} onOpenTransactions={onOpenTransactions} />
        </Suspense>
      )}

      <div className="card">
        <div className="card-head">
          <span className="reports-section-title">Balance over the last year</span>
        </div>
        {balances.length >= 2 ? (
          <LineChart points={history.map((p) => ({ label: shortMonthDay(p.date), value: parseFloat(p.balance) }))} height={160} maxLabels={6} caption="Account balance over time" />
        ) : (
          <p className="modal-message-secondary">Not enough history to draw a chart yet.</p>
        )}
        {account.account_type === "investment" && (
          <p className="modal-message-secondary">
            An investment account's balance history shows its cash activity; what it is worth over time is charted under Accumulation &amp; projection above.
          </p>
        )}
      </div>

      <div className="card" data-reconcile-card ref={reconcileCardRef}>
        <div className="card-head">
          <span className="reports-section-title">Reconcile with a statement</span>
        </div>
        {!reconciling ? (
          <>
            <p className="modal-message-secondary">
              Enter the dates and balances from your statement, then tick each transaction that appears on it. When the
              difference reaches $0.00 the two agree.
            </p>
            {account.account_type === "investment" && (
              <p className="modal-message-secondary">
                For an investment account this checks its cash activity. Uploading the statement also checks your share counts.
              </p>
            )}
            <form
              className="reconcile-form"
              onSubmit={(e) => {
                e.preventDefault();
                void startReconciling();
              }}
            >
              <label className="labeled-field">
                <span className="labeled-field-label">Statement start date</span>
                <DateField value={periodStart} onChange={setPeriodStart} ariaLabel="Statement start date" data-statement-period-start />
              </label>
              <label className="labeled-field">
                <span className="labeled-field-label">Statement end date</span>
                <DateField value={statementDate} onChange={setStatementDate} ariaLabel="Statement end date" data-statement-date />
              </label>
              {!needsStart ? (
                preview?.starting_point != null && (
                  <p className="modal-message-secondary" data-reconcile-picks-up>
                    Picks up from your last reconciliation before this statement: {formatAmount(preview.starting_point)}.
                  </p>
                )
              ) : (
                <label className="labeled-field">
                  <span className="labeled-field-label">{words.start}</span>
                  <input
                    value={statementStart}
                    onChange={(e) => setStatementStart(e.target.value)}
                    placeholder="0.00"
                    data-statement-start-balance
                  />
                </label>
              )}
              <label className="labeled-field">
                <span className="labeled-field-label">{words.end}</span>
                <input
                  ref={statementBalanceRef}
                  value={statementBalance}
                  onChange={(e) => setStatementBalance(e.target.value)}
                  placeholder="0.00"
                  data-statement-balance
                />
              </label>
              <button type="submit" disabled={!balanceValid} data-reconcile-start>
                Start reconciling
              </button>
            </form>
            <div className="reconcile-upload">
              <p className="modal-message-secondary">
                Or let the app check your statement for you. Enter the statement's start and end dates above, then upload it.
              </p>
              <button
                type="button"
                disabled={!periodStart || statement.busy}
                onClick={() => void statement.start(periodStart, statementDate)}
                data-upload-statement
              >
                Upload a statement
              </button>
              <button
                type="button"
                className="modal-secondary"
                disabled={!periodStart || statement.busy}
                onClick={() => void statement.start(periodStart, statementDate, "download")}
                data-upload-download
              >
                Use a CSV or OFX download
              </button>
              {statement.error && statement.phase.kind === "idle" && (
                <p className="statement-error" role="alert" data-statement-error>
                  {statement.error}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="reconcile-summary" data-reconcile-summary>
              <div>
                <span className="reconcile-label">Statement ending</span>
                <span className="reconcile-figure">{formatAmount(statementBalance)}</span>
              </div>
              <div>
                <span className="reconcile-label">Ticked so far</span>
                <span className="reconcile-figure" data-cleared-balance>
                  {status && status.starting_point !== null ? formatAmount(addAmounts([status.starting_point, status.ticked_change])) : "—"}
                </span>
              </div>
              <div>
                <span className="reconcile-label">Difference</span>
                <span
                  className={difference === 0 ? "reconcile-figure reconcile-balanced" : "reconcile-figure reconcile-off"}
                  data-difference
                  data-balanced={difference === 0 ? "true" : "false"}
                >
                  {status && status.difference !== null ? formatAmount(status.difference) : "—"}
                </span>
              </div>
            </div>
            <table className="ledger">
              <thead>
                <tr>
                  <th className="dup-review-check">On statement</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="amount-col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((t) => (
                  <tr key={t.id} data-reconcile-row={t.description}>
                    <td className="dup-review-check">
                      <input type="checkbox" checked={t.cleared} onChange={() => void toggleCleared(t)} aria-label={`On statement: ${t.description}`} />
                    </td>
                    <td className="date-cell">{formatDisplayDate(t.date)}</td>
                    <td>{t.description}</td>
                    <td className="amount-col">{formatAmount(t.amount)}</td>
                  </tr>
                ))}
                {candidates.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty-state">
                      Nothing left to reconcile up to {formatDisplayDate(statementDate)}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="modal-actions">
              <button type="button" className="modal-secondary" onClick={() => setReconciling(false)}>
                Not now
              </button>
              <button type="button" disabled={difference !== 0} onClick={() => void finish()} data-reconcile-finish>
                Finish reconciliation
              </button>
            </div>
          </>
        )}
      </div>

      {statement.phase.kind === "choose_section" && (
        <ModalShell title="Which account is this?" onCancel={statement.cancel}>
          <p className="modal-message-secondary">This statement covers more than one account. Choose the part for {account.name}.</p>
          {statement.error && (
            <p className="statement-error" role="alert">
              {statement.error}
            </p>
          )}
          {statement.phase.read.sections.map((section) => (
            <button
              key={section.index}
              type="button"
              className="modal-secondary"
              disabled={statement.busy}
              onClick={() => void statement.chooseSection(section.index)}
              data-statement-section={section.index}
            >
              {section.name} ({section.row_count} transaction{section.row_count === 1 ? "" : "s"}{section.holding_count ? `, ${holdingCount(section.holding_count)}` : ""})
            </button>
          ))}
        </ModalShell>
      )}
      {statement.phase.kind === "review" && (
        <StatementReviewDialog
          key={statement.phase.review.token}
          review={statement.phase.review}
          accountName={account.name}
          busy={statement.busy}
          error={statement.error}
          onFlip={(flip) => void statement.setFlip(flip)}
          onTeach={() => void statement.openTeach()}
          onUseDownload={() => {
            statement.cancel();
            void statement.start(periodStart, statementDate, "download");
          }}
          onReconcileByHand={() => {
            statement.cancel();
            reconcileCardRef.current?.scrollIntoView({ block: "start" });
          }}
          onFinish={(decisions) => void statement.finish(decisions)}
          onCancel={statement.cancel}
        />
      )}
      {statement.phase.kind === "teach" && (
        <StatementTeachDialog
          lines={statement.phase.lines}
          kind={statement.phase.review.account_kind}
          attempts={statement.phase.attempts}
          busy={statement.busy}
          error={statement.error}
          needs={{
            rows: statement.phase.review.activity_check.outcome !== "passed",
            holdings: statement.phase.review.account_kind === "investment" && statement.phase.review.holdings_check.outcome === "failed",
          }}
          onTeach={(marks) => void statement.teach(marks)}
          onBack={statement.backToReview}
          onGiveUp={statement.backToReview}
        />
      )}

      <div className="card">
        <div className="card-head">
          <span className="reports-section-title">Recent transactions</span>
        </div>
        <table className="ledger">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th className="amount-col">Amount</th>
              <th className="dup-review-check">✓</th>
            </tr>
          </thead>
          <tbody>
            {transactions.slice(0, shownCount).map((t) => (
              <tr key={t.id} data-account-transaction-row>
                <td className="date-cell">{formatDisplayDate(t.date)}</td>
                <td>
                  {t.description}
                  {t.payment_source_id != null && (
                    <button type="button" className="modal-secondary btn-sm view-payment"
                      aria-label={`View payment from ${t.payment_source_account_name} on ${formatDisplayDate(t.payment_source_date ?? "")}`}
                      onClick={() => onOpenPayment(t.payment_source_id!)}>
                      View payment
                    </button>
                  )}
                </td>
                <td>{t.category ?? <span className="account-col">—</span>}</td>
                <td className="amount-col">{formatAmount(t.amount)}</td>
                <td className="dup-review-check" title={t.cleared ? "Cleared on a statement" : ""}>
                  {t.cleared ? "✓" : ""}
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-state">
                  No transactions in this account yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {transactions.length > 0 && (
          <div className="ledger-pagination">
            <label className="ledger-page-size">
              Show
              <MenuSelect
                ariaLabel="Rows at a time"
                value={String(pageSize)}
                onChange={(v) => {
                  setPageSize(Number(v));
                  setShownCount(Number(v));
                }}
                options={LEDGER_STEPS.map((step) => ({ value: String(step), label: String(step) }))}
              />
              at a time
            </label>
            <span className="ledger-page-count" aria-live="polite" data-account-ledger-shown>
              {transactionsShownLabel(Math.min(shownCount, transactions.length), transactions.length)}
            </span>
            {showMoreLabel(shownCount, transactions.length, pageSize) && (
              <button type="button" className="modal-secondary" onClick={() => setShownCount((count) => count + pageSize)} data-account-show-more>
                {showMoreLabel(shownCount, transactions.length, pageSize)}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
