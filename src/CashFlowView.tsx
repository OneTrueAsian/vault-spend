import { useState } from "react";
import type { Account, BillAwareForecast, CashFlow, CategoryAmount, DebtPayoffPlan, YoyCashFlow } from "./types";
import { lowestPoint } from "./safeToSpend";
import { BarChart, DonutChart, LineChart, fmtMoneyShort } from "./charts";
import { formatAmount } from "./format";
import { DebtPayoffPlannerSection } from "./ReportsView";
import { PinToDashboardButton } from "./PinToDashboardButton";
import type { WidgetId } from "./dashboardLayout";

const CATEGORY_COLORS = ["#1E9E76", "#3E7CB8", "#C08A2E", "#8A5FB0", "#BD5B3C", "#4E8FC9"];
const FORECAST_DAY_OPTIONS = [30, 60, 90];

export function CashFlowView({
  cashFlow,
  range,
  onSetRange,
  compareLastYear,
  onToggleCompareLastYear,
  yoyCashFlow,
  onMonthClick,
  topCategoriesData,
  topCategoriesMonth,
  onSetTopCategoriesMonth,
  previousMonthCategorySpending,
  forecastData,
  forecastDays,
  onSetForecastDays,
  accounts,
  onSetAccountInterestRate,
  onCalculateDebtPayoff,
  onSetAccountExcludedFromDebtPayoff,
  layoutWidgets,
  onPinWidget,
}: {
  cashFlow: CashFlow | null;
  range: number;
  onSetRange: (months: number) => void;
  compareLastYear: boolean;
  onToggleCompareLastYear: () => void;
  yoyCashFlow: YoyCashFlow | null;
  /** Called with the (year, month) behind a clicked bar, "this year"'s
   * side of the pair when comparing to last year. */
  onMonthClick: (year: number, month: number) => void;
  /** "Top categories"/"Top merchants" below are scoped to one month at a
   * time (defaulting to the current month), independent of the bar
   * chart's own trailing-window range above. */
  topCategoriesData: CashFlow | null;
  topCategoriesMonth: { year: number; month: number };
  onSetTopCategoriesMonth: (year: number, month: number) => void;
  /** Uncapped per-category spend for the month right before
   * `topCategoriesMonth`, used only to compute each displayed category's
   * month-over-month trend. */
  previousMonthCategorySpending: CategoryAmount[];
  /** Projected daily cash balance for the next `forecastDays` days, based
   * on recurring items only — a separate what-if view, independent of the
   * bar chart's historical window above. */
  forecastData: BillAwareForecast | null;
  forecastDays: number;
  onSetForecastDays: (days: number) => void;
  accounts: Account[];
  onSetAccountInterestRate: (accountId: number, rate: string | null) => void;
  onCalculateDebtPayoff: (
    strategy: string,
    extraPayment: string,
    minimums: { accountId: number; minimumPayment: string }[],
  ) => Promise<DebtPayoffPlan | null>;
  onSetAccountExcludedFromDebtPayoff: (accountId: number, excluded: boolean) => void;
  /** The Dashboard's current widget layout, and a way to add to it — powers
   * the "Pin to Dashboard" button next to Top merchants and, further down,
   * the Debt Payoff Planner. */
  layoutWidgets: WidgetId[];
  onPinWidget: (id: WidgetId) => void;
}) {
  // Local to this view (like `expandedStat`/`showBudgetAlerts` on the
  // Dashboard) rather than lifted to App.tsx — a per-view UI concern, not
  // app-wide state. Splits what used to be 5 sections stacked vertically
  // (the densest single tab in the app) into 3 sub-tabs using the exact
  // same tab-btn/tab-btn-active pattern already on this page for the
  // 3/6-month toggle below.
  const [subTab, setSubTab] = useState<"overview" | "forecast" | "debt">("overview");

  if (!cashFlow) {
    return <p className="empty-state">Loading…</p>;
  }

  const totalIncome = parseFloat(cashFlow.total_income);
  const totalExpense = parseFloat(cashFlow.total_expense);
  const net = totalIncome - totalExpense;
  const savingsRate = totalIncome ? (net / totalIncome) * 100 : 0;

  // Kept index-aligned with barData so a click on bar `i` can resolve back
  // to the real calendar month behind it (a "Jan"-style label alone can't
  // disambiguate which year, and in compare mode the click should always
  // drill into "this year"'s side of the pair).
  const barMonths = compareLastYear && yoyCashFlow ? yoyCashFlow.current : cashFlow.months;

  const barData =
    compareLastYear && yoyCashFlow
      ? yoyCashFlow.current.map((m, i) => {
          const prior = yoyCashFlow.prior_year[i];
          return {
            label: m.month_label,
            values: [
              { value: parseFloat(m.income) - parseFloat(m.expense), color: "var(--positive)", name: "This year" },
              {
                value: prior ? parseFloat(prior.income) - parseFloat(prior.expense) : 0,
                color: "var(--accent)",
                name: "Last year",
              },
            ],
          };
        })
      : cashFlow.months.map((m) => ({
          label: m.month_label,
          values: [
            { value: parseFloat(m.income), color: "var(--positive)", name: "Income" },
            { value: parseFloat(m.expense), color: "var(--negative)", name: "Expenses" },
          ],
        }));

  // Month-over-month trend per displayed category — "New" when it had no
  // spend at all the prior month (a percent change would be either
  // meaningless (0 -> 0) or a nonsensical infinite jump (0 -> something)).
  const previousMonthByCategory = new Map(previousMonthCategorySpending.map((c) => [c.category, parseFloat(c.amount)]));

  const donutData = (topCategoriesData?.top_categories ?? []).map((c, i) => {
    const current = parseFloat(c.amount);
    const previous = previousMonthByCategory.get(c.category) ?? 0;
    const trend: { pct: number; isNew: boolean } | null =
      previous > 0 ? { pct: ((current - previous) / previous) * 100, isNew: false } : current > 0 ? { pct: 0, isNew: true } : null;
    return {
      label: c.category,
      value: current,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
      trend,
    };
  });

  // Same "total matches what the ring itself sums to" convention as the
  // Dashboard's own Spending by category donut.
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0);

  const topMerchants = topCategoriesData?.top_merchants ?? [];
  const maxMerchant = topMerchants.length ? parseFloat(topMerchants[0].amount) : 1;

  // Year-to-date only: January of the current year through the current
  // month — never a past year, and never a future month that has no data
  // yet. Descending so the current month (the default) sorts first.
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthNum = now.getMonth() + 1;
  const monthOptions = Array.from({ length: currentMonthNum }, (_, i) => currentMonthNum - i).map((month) => ({
    year: currentYear,
    month,
    label: new Date(currentYear, month - 1, 1).toLocaleDateString("en-US", { month: "long" }),
  }));
  // "Top categories" has no selector of its own — it follows the same
  // month picked in "Top merchants" below, so its header shows the
  // selection read-only rather than duplicating a second control.
  const selectedMonthLabel = monthOptions.find((o) => o.month === topCategoriesMonth.month)?.label ?? "";

  return (
    <div className="reports-view">
      <div className="page-top">
        <div>
          <h1 className="view-title">Cash Flow</h1>
          <p className="view-sub">Income vs. expenses, forecast, and payoff planning.</p>
        </div>
      </div>
      <div className="tabs">
        {(
          [
            ["overview", "Overview"],
            ["forecast", "Forecast"],
            ["debt", "Debt Payoff"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={subTab === key ? "tab-btn tab-btn-active" : "tab-btn"}
            onClick={() => setSubTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === "overview" && (
        <>
          <div className="tabs">
            {[3, 6].map((m) => (
              <button
                key={m}
                className={range === m ? "tab-btn tab-btn-active" : "tab-btn"}
                onClick={() => onSetRange(m)}
              >
                {m} months
              </button>
            ))}
            <label className="compare-last-year-toggle">
              <input type="checkbox" checked={compareLastYear} onChange={onToggleCompareLastYear} />
              Compare to last year
            </label>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="reports-section-title">
                {compareLastYear ? "Net cash flow — this year vs. last year" : "Income vs. expenses"}
              </span>
            </div>
            <BarChart
              data={barData}
              height={240}
              onBarClick={(i) => {
                const m = barMonths[i];
                if (m) onMonthClick(m.year, m.month);
              }}
            />
            <p className="chart-hint">Click a bar to see where that month's expenses went.</p>
            {compareLastYear && yoyCashFlow ? (
              <div className="chart-legend">
                <div className="chart-legend-item">
                  <span className="chart-legend-swatch" style={{ background: "var(--positive)" }}></span>
                  This year
                </div>
                <div className="chart-legend-item">
                  <span className="chart-legend-swatch" style={{ background: "var(--accent)" }}></span>
                  Last year
                </div>
              </div>
            ) : (
              <div className="chart-legend">
                <div className="chart-legend-item">
                  <span className="chart-legend-swatch" style={{ background: "var(--positive)" }}></span>
                  Income · {formatAmount(cashFlow.total_income)}
                </div>
                <div className="chart-legend-item">
                  <span className="chart-legend-swatch" style={{ background: "var(--negative)" }}></span>
                  Expenses · {formatAmount(cashFlow.total_expense)}
                </div>
                <div className="chart-legend-item" style={{ marginLeft: "auto", fontWeight: 700 }}>
                  Net {formatAmount(net.toFixed(2))} ({savingsRate.toFixed(0)}% savings rate)
                </div>
              </div>
            )}
          </div>

          <div className="grid-2">
            <div className="card cashflow-category-card">
              <div className="card-head">
                <span className="reports-section-title">Top categories</span>
                <span className="account-col" title="Follows the month picked in Top merchants">
                  {selectedMonthLabel}
                </span>
              </div>
              <div className="cashflow-category-body">
                {!topCategoriesData ? (
                  <p className="empty-state">Loading…</p>
                ) : donutData.length > 0 ? (
                  <div className="donut-with-legend">
                    <DonutChart
                      data={donutData}
                      size={132}
                      center={{ value: fmtMoneyShort(donutTotal), label: selectedMonthLabel }}
                    />
                    <div>
                      {donutData.map((d) => (
                        <div className="chart-legend-item" key={d.label} style={{ marginBottom: 8 }}>
                          <span className="chart-legend-swatch" style={{ background: d.color }}></span>
                          {d.label}
                          <span className="account-col" style={{ marginLeft: "auto" }}>
                            {fmtMoneyShort(d.value)}
                          </span>
                          {d.trend && (
                            <span
                              className={
                                d.trend.isNew
                                  ? "category-trend category-trend-new"
                                  : d.trend.pct > 0
                                    ? "category-trend category-trend-up"
                                    : d.trend.pct < 0
                                      ? "category-trend category-trend-down"
                                      : "category-trend"
                              }
                              title="Vs. the prior month"
                            >
                              {d.trend.isNew ? "New" : `${d.trend.pct > 0 ? "▲" : d.trend.pct < 0 ? "▼" : "–"} ${Math.abs(d.trend.pct).toFixed(0)}%`}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="empty-state">No spending yet.</p>
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-head">
                <span className="reports-section-title">Top merchants</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select
                    aria-label="Month for top merchants and categories"
                    className="month-select"
                    value={topCategoriesMonth.month}
                    onChange={(e) => onSetTopCategoriesMonth(topCategoriesMonth.year, Number(e.target.value))}
                    title="Also changes the Top categories chart"
                  >
                    {monthOptions.map((opt) => (
                      <option key={opt.month} value={opt.month}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <PinToDashboardButton widgetId="top_merchants" layoutWidgets={layoutWidgets} onPin={onPinWidget} />
                </div>
              </div>
              {!topCategoriesData ? (
                <p className="empty-state">Loading…</p>
              ) : topMerchants.length > 0 ? (
                topMerchants.map((m) => (
                  <div key={m.description} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: 5 }}>
                      <span style={{ fontWeight: 600 }}>{m.description}</span>
                      <span className="amount-col">{formatAmount(m.amount)}</span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${(parseFloat(m.amount) / maxMerchant) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty-state">No spending yet.</p>
              )}
            </div>
          </div>
        </>
      )}

      {subTab === "forecast" && (
        <div className="card">
          <div className="card-head">
            <span className="reports-section-title">Forecast</span>
            <div className="tabs" style={{ marginBottom: 0 }}>
              {FORECAST_DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  className={forecastDays === d ? "tab-btn tab-btn-active" : "tab-btn"}
                  onClick={() => onSetForecastDays(d)}
                >
                  {d} days
                </button>
              ))}
            </div>
          </div>
          {forecastData ? (
            <>
            <LineChart
              // LineChart renders one axis label per point with no built-in
              // thinning — fine for the ~6-month net-worth trend elsewhere,
              // but 30-90 daily points would overlap into an unreadable mess.
              // Only label roughly every 8th point; every point still
              // contributes to the line/tooltip itself.
              points={forecastData.points.map((p, i) => ({
                label: i % Math.max(1, Math.ceil(forecastData.points.length / 8)) === 0 ? p.date.slice(5) : "",
                value: parseFloat(p.balance),
              }))}
              height={200}
            />
            {forecastData.uses_recurring && (() => {
              const low = lowestPoint(forecastData.points);
              return low ? (
                <p className="forecast-lowest" data-forecast-lowest>
                  Lowest balance: <strong>{formatAmount(low.balance.toFixed(2))}</strong> on {low.date}
                </p>
              ) : null;
            })()}
            {forecastData.events.length > 0 && (
              <div className="forecast-events">
                <span className="reports-section-title">Coming up</span>
                <ul>
                  {forecastData.events.slice(0, 10).map((ev, i) => (
                    <li key={`${ev.date}-${ev.label}-${i}`}>
                      <span className="forecast-event-date">{ev.date}</span>
                      <span className="forecast-event-label">{ev.label}</span>
                      <span className={parseFloat(ev.amount) < 0 ? "forecast-event-amount neg" : "forecast-event-amount"}>
                        {formatAmount(ev.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            </>
          ) : (
            <p className="empty-state">Loading…</p>
          )}
          <p className="chart-hint">
            {forecastData?.uses_recurring
              ? `Every bill and paycheck on your Recurring list lands on the day it's due. Everyday spending carries on at your recent average (${formatAmount(
                  Math.abs(parseFloat(forecastData.daily_baseline)).toFixed(2),
                )} a day ${parseFloat(forecastData.daily_baseline) <= 0 ? "out" : "in"}, with recurring items and transfers left out so nothing is counted twice).`
              : "Projects your cash balance (checking/savings) forward as a smooth trend, based on your actual net cash flow (income minus spending) over roughly the last 90 days. Add your bills and paycheck to Recurring for a forecast that shows each one landing on its due date."}
          </p>
        </div>
      )}

      {subTab === "debt" && (
        <DebtPayoffPlannerSection
          accounts={accounts}
          onSetAccountInterestRate={onSetAccountInterestRate}
          onCalculateDebtPayoff={onCalculateDebtPayoff}
          onSetAccountExcludedFromDebtPayoff={onSetAccountExcludedFromDebtPayoff}
          layoutWidgets={layoutWidgets}
          onPinWidget={onPinWidget}
        />
      )}
    </div>
  );
}
