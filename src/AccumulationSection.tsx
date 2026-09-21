import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Account, InvestmentAccumulation, PortfolioPoint } from "./types";
import { SeriesChart, type SeriesChartSeries } from "./charts";
import { formatAmount, shortMonthDay, toLocalIsoDate } from "./format";
import {
  averageMonthlyContribution,
  combineProjections,
  cumulativeNet,
  dateX,
  deflatePoints,
  monthIndex,
  summarizeAccumulation,
  validatePlanForm,
  type AccountSummary,
  type MonthFlow,
  type PlanFormFields,
} from "./accumulation";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2031-06" as "Jun 2031". */
function monthYearLabel(ym: string): string {
  const [year, month] = ym.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** The calendar month `offset` months after the month `today` falls in, as "Jun 2031". */
function labelForOffset(today: string, offset: number): string {
  const index = monthIndex(today.slice(0, 7)) + offset;
  return `${MONTH_NAMES[index % 12]} ${Math.floor(index / 12)}`;
}

const TODAYS_DOLLARS_KEY = "vaultspend-todays-dollars";

/** The "in today's dollars" switch. Per viewer, like the density toggle: kept in
 * this browser's storage, never in the database, and shared by every place that
 * shows projected figures. */
export function useTodaysDollars(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return window.localStorage.getItem(TODAYS_DOLLARS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(TODAYS_DOLLARS_KEY, next ? "1" : "0");
    } catch {
      /* the switch still works for this session */
    }
  }, []);
  return [on, set];
}

function toMonthFlows(a: InvestmentAccumulation): MonthFlow[] {
  return a.months.map((m) => ({ month: m.month, moneyIn: parseFloat(m.money_in), moneyOut: parseFloat(m.money_out) }));
}

function summaryFor(account: Account, a: InvestmentAccumulation, inflationPct: number, todaysDollars: boolean, today: string): AccountSummary {
  return summarizeAccumulation({
    worthNow: parseFloat(account.current_balance),
    months: toMonthFlows(a),
    totalIn: parseFloat(a.total_in),
    totalOut: parseFloat(a.total_out),
    plan: {
      monthlyContribution: a.plan.monthly_contribution === null ? null : parseFloat(a.plan.monthly_contribution),
      annualReturnPct: parseFloat(a.plan.annual_return_pct),
      withdrawMonth: a.plan.withdraw_month,
      withdrawYears: a.plan.withdraw_years,
    },
    today,
    inflationPct,
    todaysDollars,
  });
}

function formFromPlan(a: InvestmentAccumulation, inflation: string, today: string): PlanFormFields {
  const average = averageMonthlyContribution(toMonthFlows(a), today);
  return {
    // Shows the figure in use: the saved amount, else the average it defaults to.
    monthly: a.plan.monthly_contribution ?? (average !== null ? average.toFixed(2) : ""),
    returnPct: a.plan.annual_return_pct,
    withdrawMonth: a.plan.withdraw_month ?? "",
    withdrawYears: a.plan.withdraw_years === null ? "" : String(a.plan.withdraw_years),
    inflation,
  };
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${formatAmount(n.toFixed(2))}`;

function TodaysDollarsToggle({ on, onChange, inflation }: { on: boolean; onChange: (on: boolean) => void; inflation: string }) {
  return (
    <label className="acc-toggle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} data-acc-todays-dollars />
      <span>Show projected figures in today's dollars{on ? ` (at ${inflation}%/yr)` : ""}</span>
    </label>
  );
}

/** The Accounts → Details page of an investment account: what has gone in, what
 * it is worth, and where it is headed if the deposits keep coming until the
 * withdraw month. Everything here is a plain reading of the account's own
 * transactions and saved values — nothing is estimated for the past. */
export function AccountAccumulationSection({
  account,
  onMessage,
  onOpenTransactions,
}: {
  account: Account;
  onMessage: (text: string, kind: "success" | "error" | "info") => void;
  onOpenTransactions: () => void;
}) {
  const today = toLocalIsoDate();
  const [acc, setAcc] = useState<InvestmentAccumulation | null>(null);
  const [history, setHistory] = useState<PortfolioPoint[]>([]);
  const [inflation, setInflation] = useState("3");
  const [form, setForm] = useState<PlanFormFields | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [todaysDollars, setTodaysDollars] = useTodaysDollars();

  const load = useCallback(async () => {
    const [a, h, infl] = await Promise.all([
      invoke<InvestmentAccumulation>("investment_accumulation", { accountId: account.id }),
      invoke<PortfolioPoint[]>("account_value_history", { accountId: account.id }),
      invoke<string>("get_inflation_pct"),
    ]);
    setAcc(a);
    setHistory(h);
    setInflation(infl);
    setForm(formFromPlan(a, infl, toLocalIsoDate()));
  }, [account.id]);

  useEffect(() => {
    load().catch((e) => onMessage(String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const summary = useMemo(
    () => (acc ? summaryFor(account, acc, parseFloat(inflation) || 0, todaysDollars, today) : null),
    [account, acc, inflation, todaysDollars, today],
  );

  if (!acc || !form || !summary) {
    return (
      <div className="card" data-accumulation>
        <p className="modal-message-secondary">Loading…</p>
      </div>
    );
  }

  const flows = toMonthFlows(acc);
  const nowX = dateX(today);
  const withdrawLabel = acc.plan.withdraw_month ? monthYearLabel(acc.plan.withdraw_month) : null;
  const inflationNumber = parseFloat(inflation) || 0;

  // ---- the chart: money put in (a record), worth (a record), projection (a forecast) ----
  const investedPoints: SeriesChartSeries["points"] = flows.length
    ? [
        { x: monthIndex(flows[0].month), value: 0 },
        ...cumulativeNet(flows).map((c) => ({ x: Math.min(monthIndex(c.month) + 1, nowX), value: c.net })),
      ]
    : [];
  const valuePoints: SeriesChartSeries["points"] = history.map((h) => ({ x: dateX(h.date), value: parseFloat(h.value) }));
  if (valuePoints.length > 0 && history[history.length - 1].date !== today) {
    valuePoints.push({ x: nowX, value: summary.worthNow });
  }
  const showValueLine = valuePoints.length >= 2;
  const projectionPoints: SeriesChartSeries["points"] = summary.projection
    ? (todaysDollars ? deflatePoints(summary.projection.points, inflationNumber) : summary.projection.points).map((p) => ({
        x: nowX + p.month,
        value: p.balance,
      }))
    : [];
  const series: SeriesChartSeries[] = [
    { key: "invested", name: "Cash invested", color: "var(--text-muted)", points: investedPoints },
    { key: "worth", name: "Worth", color: "var(--accent)", points: showValueLine ? valuePoints : [] },
    { key: "projected", name: todaysDollars ? "Projected (today's dollars)" : "Projected", color: "var(--accent)", dashed: true, points: projectionPoints },
  ];

  async function save() {
    if (!acc || !form) return;
    const problem = validatePlanForm(form, today, acc.plan.withdraw_month);
    if (problem) {
      setFormError(problem);
      return;
    }
    const defaultText = formFromPlan({ ...acc, plan: { ...acc.plan, monthly_contribution: null } }, inflation, today).monthly;
    // Left at the default average and never saved: keep following the average rather than freezing today's figure.
    const followAverage = form.monthly.trim() === "" || (acc.plan.monthly_contribution === null && form.monthly.trim() === defaultText);
    try {
      await invoke("set_investment_plan", {
        accountId: account.id,
        monthlyContribution: followAverage ? null : form.monthly.trim(),
        annualReturnPct: form.returnPct.trim(),
        withdrawMonth: form.withdrawMonth.trim() || null,
        withdrawYears: form.withdrawYears.trim() ? Number(form.withdrawYears.trim()) : null,
        // The shared inflation goes in the same request, so a refusal can't leave half of it saved.
        inflationPct: form.inflation.trim() !== inflation ? form.inflation.trim() : null,
      });
    } catch (e) {
      setFormError(String(e));
      return;
    }
    setFormError(null);
    // The save is done; a failed refresh must not be reported as a failed save.
    try {
      await load();
      onMessage(`Saved the plan for ${account.name}.`, "success");
    } catch {
      onMessage(`Saved the plan for ${account.name}, but the page couldn't refresh — reopen it to see the latest figures.`, "error");
    }
  }

  async function resetToAverage() {
    if (!acc) return;
    try {
      await invoke("set_investment_plan", {
        accountId: account.id,
        monthlyContribution: null,
        annualReturnPct: acc.plan.annual_return_pct,
        withdrawMonth: acc.plan.withdraw_month,
        withdrawYears: acc.plan.withdraw_years,
      });
      setFormError(null);
      await load();
    } catch (e) {
      setFormError(String(e));
    }
  }

  const set = (patch: Partial<PlanFormFields>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const average = summary.averageMonthly;
  const projectedLabel =
    summary.status === "ok" && withdrawLabel ? `Projected at ${withdrawLabel}` : summary.status === "passed" ? "Withdraw month has passed" : "Projected";
  const dollarsNote = todaysDollars ? ` · in today's dollars at ${inflation}%/yr` : "";

  return (
    <div data-accumulation={account.id}>
      <div className="card">
        <div className="card-head">
          <span className="reports-section-title">Accumulation &amp; projection</span>
        </div>
        <p className="modal-message-secondary">
          Cash invested counts every money-in on this account as a deposit (a dividend logged as plain income counts too); money out is
          shown separately and lowers the net. Worth now is the same figure the Accounts tab shows.
        </p>
        <div className="stats">
          <div className="stat tint-blue">
            <span className="stat-value" data-acc-invested>
              {formatAmount(summary.netInvested.toFixed(2))}
            </span>
            <span className="stat-label">Cash invested (net)</span>
            <span className="stat-delta">
              <span data-acc-in>{formatAmount(summary.totalIn.toFixed(2))}</span> in · <span data-acc-out>{formatAmount(summary.totalOut.toFixed(2))}</span> out
            </span>
          </div>
          <div className="stat tint-accent">
            <span className="stat-value" data-acc-worth>
              {formatAmount(summary.worthNow.toFixed(2))}
            </span>
            <span className="stat-label">Worth now</span>
          </div>
          <div className="stat tint-teal">
            <span className={summary.growth < 0 ? "stat-value report-over-budget" : "stat-value"} data-acc-growth data-acc-growth-negative={summary.growth < 0 ? "true" : "false"}>
              {signed(summary.growth)}
            </span>
            <span className="stat-label">Growth (worth − invested)</span>
          </div>
          <div className="stat tint-purple">
            {summary.projectedFinal !== null ? (
              <span className="stat-value" data-acc-projected>
                {formatAmount(summary.projectedFinal.toFixed(2))}
              </span>
            ) : (
              <span className="stat-value stat-value-muted" data-acc-projected>
                —
              </span>
            )}
            <span className="stat-label">{projectedLabel}</span>
            {summary.status === "ok" && (
              <span className="stat-delta" data-acc-projected-note>
                {summary.monthsToWithdraw} month{summary.monthsToWithdraw === 1 ? "" : "s"} · {formatAmount(summary.monthly.toFixed(2))}/mo at {acc.plan.annual_return_pct}%/yr
                {dollarsNote}
              </span>
            )}
          </div>
        </div>

        {summary.status === "no-date" && (
          <p className="modal-message-secondary" data-acc-no-date>
            Set a withdraw date below to see a projection.
          </p>
        )}
        {summary.status === "passed" && (
          <p className="modal-message-secondary" data-acc-date-passed>
            The saved withdraw month ({withdrawLabel}) has passed — pick a new one below to see a projection.
          </p>
        )}

        <div data-acc-chart>
          <SeriesChart series={series} nowX={nowX} height={230} ariaLabel="Cash invested, worth and projected value over time" />
        </div>
        <p className="modal-message-secondary" data-acc-value-note>
          {history.length === 0
            ? "The Worth line will start once Vault Spend has recorded this account's value — it does that each day you open the app. Earlier months are never estimated."
            : `The Worth line starts on ${shortMonthDay(history[0].date)}, ${history[0].date.slice(0, 4)} — Vault Spend records this account's value each day you open it, so earlier months aren't drawn and nothing is estimated${
                showValueLine ? "." : ` (first point: ${formatAmount(history[0].value)}); it becomes a line after the next day it's opened.`
              }`}
        </p>
      </div>

      <div className="card" data-acc-settings>
        <div className="card-head">
          <span className="reports-section-title">Projection settings</span>
        </div>
        <form
          className="labeled-field-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="labeled-field">
            <span className="labeled-field-label">Monthly amount</span>
            <input value={form.monthly} onChange={(e) => set({ monthly: e.target.value })} placeholder="0.00" inputMode="decimal" data-acc-monthly />
          </label>
          <label className="labeled-field">
            <span className="labeled-field-label">Assumed annual return %</span>
            <input value={form.returnPct} onChange={(e) => set({ returnPct: e.target.value })} placeholder="7" inputMode="decimal" data-acc-return />
          </label>
          <label className="labeled-field">
            <span className="labeled-field-label">Withdraw month</span>
            <input type="month" value={form.withdrawMonth} min={today.slice(0, 7)} onChange={(e) => set({ withdrawMonth: e.target.value })} data-acc-withdraw-month />
          </label>
          <label className="labeled-field">
            <span className="labeled-field-label">Spread over (years, optional)</span>
            <input value={form.withdrawYears} onChange={(e) => set({ withdrawYears: e.target.value })} placeholder="all at once" inputMode="numeric" data-acc-withdraw-years />
          </label>
          <label className="labeled-field">
            <span className="labeled-field-label">Inflation % (all accounts)</span>
            <input value={form.inflation} onChange={(e) => set({ inflation: e.target.value })} placeholder="3" inputMode="decimal" data-acc-inflation />
          </label>
        </form>
        <p className="modal-message-secondary" data-acc-monthly-note>
          {acc.plan.monthly_contribution !== null
            ? `You saved this monthly amount.${average !== null ? ` Your average over the last 6 complete months is ${formatAmount(average.toFixed(2))}.` : ""}`
            : average !== null
              ? `Default: your average over the last 6 complete months (fewer if the account is newer) — ${formatAmount(average.toFixed(2))} a month. Type a different amount to override it.`
              : "There isn't a complete month of deposits to average yet — type the amount you plan to invest each month."}{" "}
          The projection keeps investing that flat amount until the withdraw month, compounding monthly.
        </p>
        {formError && (
          <p className="acc-error" role="alert" data-acc-error>
            {formError}
          </p>
        )}
        <div className="acc-actions">
          <button type="button" onClick={() => void save()} data-acc-save>
            Save plan
          </button>
          {acc.plan.monthly_contribution !== null && (
            <button type="button" className="modal-secondary" onClick={() => void resetToAverage()} data-acc-reset-average>
              Reset to average
            </button>
          )}
          <TodaysDollarsToggle on={todaysDollars} onChange={setTodaysDollars} inflation={inflation} />
        </div>
      </div>

      {summary.withdrawals.length > 0 && (
        <div className="card" data-acc-drawdown>
          <div className="card-head">
            <span className="reports-section-title">Yearly withdrawals</span>
          </div>
          <p className="modal-message-secondary">
            Starting {withdrawLabel}, each year takes the balance divided by the years left; what remains keeps growing at the same
            return, so the account reaches $0 after year {summary.withdrawals.length}. Contributions stop once withdrawals start
            {todaysDollars ? `. Amounts are in today's dollars at ${inflation}%/yr` : ""}.
          </p>
          <div className="table-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Year</th>
                  <th>When</th>
                  <th className="amount-col">Withdrawal</th>
                  <th className="amount-col">Left after</th>
                </tr>
              </thead>
              <tbody>
                {summary.withdrawals.map((w) => (
                  <tr key={w.year} data-acc-drawdown-row={w.year}>
                    <td>{w.year}</td>
                    <td>{labelForOffset(today, w.month)}</td>
                    <td className="amount-col" data-acc-drawdown-amount>
                      {formatAmount(w.amount.toFixed(2))}
                    </td>
                    <td className="amount-col">{formatAmount(w.balanceAfter.toFixed(2))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" data-acc-counted>
        <div className="card-head">
          <span className="reports-section-title">What was counted</span>
        </div>
        {acc.deposit_count === 0 ? (
          <p className="empty-state" data-acc-no-deposits>
            No money has gone into this account yet, so there is nothing to total.{" "}
            <button type="button" className="modal-secondary btn-sm" onClick={onOpenTransactions}>
              Open Transactions
            </button>{" "}
            to add or import deposits — every money-in on this account will count.
          </p>
        ) : (
          <>
            <p className="modal-message-secondary">
              {acc.deposit_count} deposit{acc.deposit_count === 1 ? "" : "s"} since {acc.first_deposit}. A month with no deposit shows as $0.00.
            </p>
            <div className="table-scroll acc-months-scroll">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="amount-col">Money in</th>
                    <th className="amount-col">Money out</th>
                    <th className="amount-col">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {[...acc.months].reverse().map((m) => (
                    <tr key={m.month} data-acc-month-row={m.month}>
                      <td>{monthYearLabel(m.month)}</td>
                      <td className="amount-col" data-acc-month-in>
                        {formatAmount(m.money_in)}
                      </td>
                      <td className="amount-col" data-acc-month-out>
                        {formatAmount(m.money_out)}
                      </td>
                      <td className="amount-col">{formatAmount((parseFloat(m.money_in) - parseFloat(m.money_out)).toFixed(2))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="report-table-foot">
                    <td>Total</td>
                    <td className="amount-col">{formatAmount(acc.total_in)}</td>
                    <td className="amount-col">{formatAmount(acc.total_out)}</td>
                    <td className="amount-col">{formatAmount(acc.net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The Investments tab's one-row-per-account view of the same numbers, with a
 * total and a combined chart. A row opens that account's Details page. */
export function AccumulationSummaryCard({ accounts, onOpenAccount }: { accounts: Account[]; onOpenAccount: (accountId: number) => void }) {
  const today = toLocalIsoDate();
  const [byId, setById] = useState<Map<number, InvestmentAccumulation> | null>(null);
  const [inflation, setInflation] = useState("3");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [todaysDollars, setTodaysDollars] = useTodaysDollars();
  const investmentAccounts = useMemo(() => accounts.filter((a) => a.account_type === "investment"), [accounts]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([invoke<InvestmentAccumulation[]>("list_investment_accumulation"), invoke<string>("get_inflation_pct")])
      .then(([list, infl]) => {
        if (cancelled) return;
        setById(new Map(list.map((a) => [a.account_id, a])));
        setInflation(infl);
        setLoadError(null);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [accounts, attempt]);

  const rows = useMemo(() => {
    if (!byId) return [];
    const inflationPct = parseFloat(inflation) || 0;
    return investmentAccounts.flatMap((account) => {
      const acc = byId.get(account.id);
      return acc ? [{ account, acc, summary: summaryFor(account, acc, inflationPct, todaysDollars, today) }] : [];
    });
  }, [byId, investmentAccounts, inflation, todaysDollars, today]);

  if (investmentAccounts.length === 0) return null;
  // A failed load must not look like "no investment accounts": say so, and let the person try again.
  if (byId === null && loadError !== null) {
    return (
      <div className="card" data-acc-summary-error>
        <div className="card-head">
          <span className="reports-section-title">Accumulation &amp; projection</span>
        </div>
        <p className="modal-message-secondary">Couldn't load the accumulation summary: {loadError}</p>
        <button
          type="button"
          className="modal-secondary"
          onClick={() => {
            setLoadError(null);
            setAttempt((n) => n + 1);
          }}
          data-acc-summary-retry
        >
          Try again
        </button>
      </div>
    );
  }
  if (rows.length === 0) return null;

  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((total, r) => total + pick(r), 0);
  const projectedRows = rows.filter((r) => r.summary.status === "ok");
  const withoutDate = rows.length - projectedRows.length;
  const nowX = dateX(today);
  const combined = combineProjections(projectedRows.map((r) => r.summary.projection!), 1);
  const combinedPoints = (todaysDollars ? deflatePoints(combined, parseFloat(inflation) || 0) : combined).map((p) => ({ x: nowX + p.month, value: p.balance }));
  const totalGrowth = sum((r) => r.summary.growth);

  return (
    <div className="card" data-acc-summary>
      <div className="card-head">
        <span className="reports-section-title">Accumulation &amp; projection</span>
      </div>
      <p className="modal-message-secondary">
        For each investment account: the cash put in, what it is worth, and where it is headed if the monthly amount keeps going until
        its withdraw date. Open an account to change its plan.
      </p>
      <div className="table-scroll">
        <table className="ledger acc-summary-table" data-acc-summary-table>
          <thead>
            <tr>
              <th>Account</th>
              <th className="amount-col">Cash invested</th>
              <th className="amount-col">Worth now</th>
              <th className="amount-col">Growth</th>
              <th className="amount-col acc-col-monthly">Monthly</th>
              <th className="amount-col">Projected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ account, summary }) => (
              <tr key={account.id} className="acc-summary-row" data-acc-summary-row={account.name} onClick={() => onOpenAccount(account.id)}>
                <td>
                  <button
                    type="button"
                    className="acc-name-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenAccount(account.id);
                    }}
                    title="Open this account's accumulation & projection"
                    data-acc-open={account.id}
                  >
                    {account.name}
                  </button>
                </td>
                <td className="amount-col" data-acc-row-invested>
                  {formatAmount(summary.netInvested.toFixed(2))}
                </td>
                <td className="amount-col" data-acc-row-worth>
                  {formatAmount(summary.worthNow.toFixed(2))}
                </td>
                <td className={summary.growth < 0 ? "amount-col report-over-budget" : "amount-col"} data-acc-row-growth>
                  {signed(summary.growth)}
                </td>
                <td className="amount-col acc-col-monthly" data-acc-row-monthly>
                  {summary.monthlySource === "none" ? <span className="account-col">—</span> : formatAmount(summary.monthly.toFixed(2))}
                </td>
                <td className="amount-col" data-acc-row-projected>
                  {summary.projectedFinal !== null ? (
                    <>
                      {formatAmount(summary.projectedFinal.toFixed(2))}
                      <br />
                      <span className="account-col">{labelForOffset(today, summary.monthsToWithdraw ?? 0)}</span>
                    </>
                  ) : (
                    <span className="account-col">{summary.status === "passed" ? "Date passed" : "No date set"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="report-table-foot" data-acc-total-row>
              <td>Total</td>
              <td className="amount-col" data-acc-total-invested>
                {formatAmount(sum((r) => r.summary.netInvested).toFixed(2))}
              </td>
              <td className="amount-col" data-acc-total-worth>
                {formatAmount(sum((r) => r.summary.worthNow).toFixed(2))}
              </td>
              <td className={totalGrowth < 0 ? "amount-col report-over-budget" : "amount-col"} data-acc-total-growth>
                {signed(totalGrowth)}
              </td>
              <td className="amount-col acc-col-monthly" data-acc-total-monthly>
                {formatAmount(sum((r) => r.summary.monthly).toFixed(2))}
              </td>
              <td className="amount-col">
                {projectedRows.length > 0 ? (
                  <>
                    <span data-acc-total-projected>{formatAmount(projectedRows.reduce((t, r) => t + (r.summary.projectedFinal ?? 0), 0).toFixed(2))}</span>
                    <br />
                    {/* Each row above carries its own date; the total says it is a sum of those, not one date's value. */}
                    <span className="account-col" data-acc-total-caption>
                      each at its own date{withoutDate > 0 ? ` · ${withoutDate} left out` : ""}
                    </span>
                  </>
                ) : (
                  <span className="account-col" data-acc-total-projected>
                    —
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="modal-message-secondary" data-acc-total-note>
        {projectedRows.length > 0
          ? `The projected total adds each account's number at its own withdraw date${withoutDate > 0 ? `; ${withoutDate} account${withoutDate === 1 ? " has" : "s have"} no usable withdraw date and ${withoutDate === 1 ? "isn't" : "aren't"} in it` : ""}${todaysDollars ? ` — all in today's dollars at ${inflation}%/yr` : ""}.`
          : "Set a withdraw date on an account's Details page to see a projection."}
      </p>
      <TodaysDollarsToggle on={todaysDollars} onChange={setTodaysDollars} inflation={inflation} />
      {projectedRows.length > 0 && (
        <div data-acc-combined-chart>
          <h3 className="acc-chart-title">Combined projection, all accounts</h3>
          <SeriesChart
            series={[{ key: "combined", name: "All accounts, projected", color: "var(--accent)", points: combinedPoints }]}
            nowX={nowX}
            height={200}
            ariaLabel="Combined projected balance of all investment accounts by year"
          />
          <p className="modal-message-secondary">
            Contributing until each withdraw date, then withdrawing; an account with no “spread over years” is treated as withdrawn in full on
            its withdraw date.
          </p>
        </div>
      )}
    </div>
  );
}
