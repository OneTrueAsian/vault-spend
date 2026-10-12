import { accountTypeLabel } from "./accountGroups";
import "./AccountsCards.css";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Account, AccountTransaction } from "./types";
import { LineChart } from "./charts";
import { formatAmount, formatDisplayDate, isValidDecimalString, shortMonthDay, toLocalIsoDate } from "./format";
import { sumMoney } from "./money";
import { DateField } from "./DateField";
import { errorMessage } from "./errorMessage";
// Loaded on demand like the app's other views, so the chart and projection code stay out of the main chunk.
const AccountAccumulationSection = lazy(() => import("./AccumulationSection").then((m) => ({ default: m.AccountAccumulationSection })));

type BalancePoint = { date: string; balance: string };
type ReconcileStatus = { starting_point: string | null; needs_starting_balance: boolean; ticked_change: string; ticked_count: number; difference: string | null };
type LastReconciliation = { statement_date: string; statement_balance: string };

/** What a statement calls this account's balance, in plain words. */
function balanceWords(accountType: string): { start: string; end: string } {
  if (accountType === "credit") return { start: "Amount owed at the start of the statement", end: "Amount owed at the end of the statement" };
  if (accountType === "loan") return { start: "Principal owed at the start of the statement", end: "Principal owed at the end of the statement" };
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
  focus = null,
}: {
  account: Account;
  onBack: () => void;
  /** Where Back leads, when it isn't the account list (opened from the Investments tab). */
  backLabel?: string;
  onOpenTransactions: () => void;
  onOpenPayment: (sourceId: number) => void;
  onMessage: (text: string, kind: "success" | "error" | "info") => void;
  /** "reconcile": opened from an account row's "Reconcile with a statement…", so the page starts at
   * the reconcile card with its first field ready to type in. */
  focus?: "reconcile" | null;
}) {
  const [history, setHistory] = useState<BalancePoint[]>([]);
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [lastRec, setLastRec] = useState<LastReconciliation | null>(null);

  const [periodStart, setPeriodStart] = useState("");
  const [statementDate, setStatementDate] = useState(toLocalIsoDate());
  const [statementStart, setStatementStart] = useState("");
  const [statementBalance, setStatementBalance] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [candidates, setCandidates] = useState<AccountTransaction[]>([]);
  const [status, setStatus] = useState<ReconcileStatus | null>(null);

  const reconcileCardRef = useRef<HTMLDivElement>(null);
  const statementBalanceRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus !== "reconcile") return;
    reconcileCardRef.current?.scrollIntoView({ block: "start" });
    statementBalanceRef.current?.focus({ preventScroll: true });
    // Only when the page opens: later re-renders leave the person where they are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadOverview = useCallback(async () => {
    setHistory(await invoke<BalancePoint[]>("account_balance_history", { accountId: account.id, months: 12 }));
    setTransactions(await invoke<AccountTransaction[]>("list_account_transactions", { accountId: account.id, limit: 200 }));
    setLastRec(await invoke<LastReconciliation | null>("last_reconciliation", { accountId: account.id }));
  }, [account.id]);

  useEffect(() => {
    loadOverview().catch((e) => onMessage(errorMessage(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadOverview]);

  const loadReconciliation = useCallback(async () => {
    setCandidates(await invoke<AccountTransaction[]>("reconcile_candidates", { accountId: account.id, statementDate }));
    setStatus(
      await invoke<ReconcileStatus>("reconcile_status", {
        accountId: account.id,
        statementStart: lastRec ? null : statementStart,
        statementEnd: statementBalance,
      }),
    );
  }, [account.id, statementDate, statementStart, statementBalance, lastRec]);

  const words = balanceWords(account.account_type);
  const balanceValid =
    statementBalance.trim() !== "" &&
    isValidDecimalString(statementBalance) &&
    (lastRec !== null || (statementStart.trim() !== "" && isValidDecimalString(statementStart)));

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
        statementStart: lastRec ? null : statementStart,
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
          <LineChart points={history.map((p) => ({ label: shortMonthDay(p.date), value: parseFloat(p.balance) }))} height={160} maxLabels={6} />
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
              {lastRec ? (
                <p className="modal-message-secondary">
                  Picks up from your last reconciliation on {formatDisplayDate(lastRec.statement_date)} ({formatAmount(lastRec.statement_balance)}).
                </p>
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
                  {status && status.starting_point !== null ? formatAmount(String(sumMoney([status.starting_point, status.ticked_change]))) : "—"}
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
            {transactions.map((t) => (
              <tr key={t.id}>
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
      </div>
    </div>
  );
}
