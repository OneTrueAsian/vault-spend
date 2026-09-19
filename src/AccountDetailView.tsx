import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Account } from "./types";
import { LineChart } from "./charts";
import { formatAmount, isValidDecimalString, shortMonthDay, toLocalIsoDate } from "./format";

type BalancePoint = { date: string; balance: string };
type AccountTransaction = { id: number; date: string; description: string; amount: string; category: string | null; cleared: boolean };
type ReconciliationStatus = { cleared_balance: string; difference: string; cleared_count: number };
type LastReconciliation = { statement_date: string; statement_balance: string };

/** Reconciliation compares a statement to the transactions you tick, which
 * only makes sense where the balance is plain money in and out. */
const RECONCILABLE_TYPES = new Set(["checking", "savings"]);

/** One account on its own page: how its balance has moved, the recent
 * transactions, and — for a checking or savings account — a reconciliation
 * against a bank statement (enter the statement's ending balance, tick what
 * shows up on it, and finish once the difference is $0.00). */
export function AccountDetailView({
  account,
  onBack,
  onMessage,
}: {
  account: Account;
  onBack: () => void;
  onMessage: (text: string, kind: "success" | "error" | "info") => void;
}) {
  const [history, setHistory] = useState<BalancePoint[]>([]);
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [lastRec, setLastRec] = useState<LastReconciliation | null>(null);

  const [statementDate, setStatementDate] = useState(toLocalIsoDate());
  const [statementBalance, setStatementBalance] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [candidates, setCandidates] = useState<AccountTransaction[]>([]);
  const [status, setStatus] = useState<ReconciliationStatus | null>(null);

  const canReconcile = RECONCILABLE_TYPES.has(account.account_type);

  const loadOverview = useCallback(async () => {
    setHistory(await invoke<BalancePoint[]>("account_balance_history", { accountId: account.id, months: 12 }));
    setTransactions(await invoke<AccountTransaction[]>("list_account_transactions", { accountId: account.id, limit: 200 }));
    setLastRec(await invoke<LastReconciliation | null>("last_reconciliation", { accountId: account.id }));
  }, [account.id]);

  useEffect(() => {
    loadOverview().catch((e) => onMessage(String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadOverview]);

  const loadReconciliation = useCallback(async () => {
    setCandidates(await invoke<AccountTransaction[]>("reconcile_candidates", { accountId: account.id, statementDate }));
    setStatus(await invoke<ReconciliationStatus>("reconciliation_status", { accountId: account.id, statementBalance }));
  }, [account.id, statementDate, statementBalance]);

  const balanceValid = statementBalance.trim() !== "" && isValidDecimalString(statementBalance);

  async function startReconciling() {
    if (!balanceValid) return;
    try {
      await loadReconciliation();
      setReconciling(true);
    } catch (e) {
      onMessage(String(e), "error");
    }
  }

  async function toggleCleared(t: AccountTransaction) {
    try {
      await invoke("set_transactions_cleared", { ids: [t.id], cleared: !t.cleared });
      await loadReconciliation();
    } catch (e) {
      onMessage(String(e), "error");
    }
  }

  async function finish() {
    try {
      const ok = await invoke<boolean>("finish_reconciliation", { accountId: account.id, statementDate, statementBalance });
      if (!ok) {
        onMessage("That doesn't balance yet — the difference has to be $0.00.", "error");
        return;
      }
      setReconciling(false);
      setStatementBalance("");
      await loadOverview();
      onMessage(`Reconciled ${account.name} through ${statementDate}.`, "success");
    } catch (e) {
      onMessage(String(e), "error");
    }
  }

  const difference = status ? parseFloat(status.difference) : null;
  const balances = history.map((p) => parseFloat(p.balance));

  return (
    <div className="account-detail" data-account-detail={account.id}>
      <div className="page-top">
        <div>
          <button type="button" className="modal-secondary" onClick={onBack} data-account-back>
            ← All accounts
          </button>
          <h1 className="view-title" style={{ marginTop: 12 }}>
            {account.name}
          </h1>
          <p className="view-sub">
            {account.account_type}
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
          <span className={lastRec ? "stat-value" : "stat-value stat-value-muted"}>{lastRec ? lastRec.statement_date : "Never"}</span>
          <span className="stat-label">Last reconciled</span>
        </div>
      </div>

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
          <p className="modal-message-secondary">An investment account's history shows its cash activity; holdings' value over time is on the Investments page.</p>
        )}
      </div>

      <div className="card" data-reconcile-card>
        <div className="card-head">
          <span className="reports-section-title">Reconcile with a statement</span>
        </div>
        {!canReconcile ? (
          <p className="modal-message-secondary">Reconciliation is for checking and savings accounts.</p>
        ) : !reconciling ? (
          <>
            <p className="modal-message-secondary">
              Enter the ending balance from your bank statement, then tick each transaction that appears on it. When the
              difference reaches $0.00 the two agree.
            </p>
            <form
              className="reconcile-form"
              onSubmit={(e) => {
                e.preventDefault();
                void startReconciling();
              }}
            >
              <label className="labeled-field">
                <span className="labeled-field-label">Statement ending date</span>
                <input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} data-statement-date />
              </label>
              <label className="labeled-field">
                <span className="labeled-field-label">Statement ending balance</span>
                <input
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
                <span className="reconcile-label">Statement</span>
                <span className="reconcile-figure">{formatAmount(statementBalance)}</span>
              </div>
              <div>
                <span className="reconcile-label">Cleared</span>
                <span className="reconcile-figure" data-cleared-balance>
                  {status ? formatAmount(status.cleared_balance) : "—"}
                </span>
              </div>
              <div>
                <span className="reconcile-label">Difference</span>
                <span
                  className={difference === 0 ? "reconcile-figure reconcile-balanced" : "reconcile-figure reconcile-off"}
                  data-difference
                  data-balanced={difference === 0 ? "true" : "false"}
                >
                  {status ? formatAmount(status.difference) : "—"}
                </span>
              </div>
            </div>
            <table className="ledger">
              <thead>
                <tr>
                  <th className="dup-review-check">Cleared</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="amount-col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((t) => (
                  <tr key={t.id} data-reconcile-row={t.description}>
                    <td className="dup-review-check">
                      <input type="checkbox" checked={t.cleared} onChange={() => void toggleCleared(t)} aria-label={`Cleared: ${t.description}`} />
                    </td>
                    <td>{t.date}</td>
                    <td>{t.description}</td>
                    <td className="amount-col">{formatAmount(t.amount)}</td>
                  </tr>
                ))}
                {candidates.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty-state">
                      Nothing left to reconcile up to {statementDate}.
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
                <td>{t.date}</td>
                <td>{t.description}</td>
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
