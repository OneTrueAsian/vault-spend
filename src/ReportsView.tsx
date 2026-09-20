import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Account, CashFlow, DebtPayoffPlan, FamilyMember, MonthTotal, Transaction, Asset } from "./types";
import { LineChart } from "./charts";
import { formatAmount, toLocalIsoDate } from "./format";
import { groupOf, isIncomeTransaction, owedAmount } from "./accountGroups";
import { PinToDashboardButton } from "./PinToDashboardButton";
import type { WidgetId } from "./dashboardLayout";
import { netWorthByMember, spendingByMember } from "./memberBreakdowns";
import {
  buildCategoryTable,
  inMonthRange,
  monthEndDate,
  monthHeading,
  monthKeys,
  monthStartDate,
  PRESET_LABELS,
  presetRange,
  yearlySummary,
  type RangePreset,
} from "./reportRange";
import { buildSankeyData, layoutSankey, sankeyRibbonPath, spreadLabelPositions, type SankeyNode } from "./sankey";
import { buildHeatmapWeeks, heatmapBucket, heatmapScaleMax, type DailyAmount } from "./heatmap";

/** Savings rate — (income − expenses) ÷ income — trended over every month
 * with transaction history, trailing 12. A purely client-side reduction
 * over the same `transactions`/`accounts` this page already has (income via
 * `isIncomeTransaction` — the same rule `Store::monthly_totals` uses on the
 * backend for Cash Flow's own income figure; expense is any negative
 * amount, see `tagTotals` above, except "Transfer" — money moving between
 * the household's own accounts, same exclusion the backend applies), so it
 * needed no new prop or fetch beyond `accounts`. Cash Flow's "Income vs.
 * expenses" chart shows one month's totals in dollars; this is the trend
 * those totals form over time, as a rate. */
function SavingsRateTrendSection({ transactions, accounts }: { transactions: Transaction[]; accounts: Account[] }) {
  const monthly = new Map<string, { income: number; expense: number }>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    const entry = monthly.get(month) ?? { income: 0, expense: 0 };
    const amount = parseFloat(t.amount);
    if (isIncomeTransaction(t, accounts)) entry.income += amount;
    else if (amount < 0 && t.category !== "Transfer") entry.expense += Math.abs(amount);
    monthly.set(month, entry);
  }
  const points = Array.from(monthly.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-12)
    .map(([month, { income, expense }]) => ({
      label: new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" }),
      value: income > 0 ? ((income - expense) / income) * 100 : 0,
    }));

  if (points.length === 0) return null;

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Savings rate trend</span>
      </div>
      <p className="modal-message-secondary">
        (Income − expenses) ÷ income, by month — a rate can go negative in a month spending outpaced income.
      </p>
      <LineChart points={points} height={180} formatValue={(v) => `${v.toFixed(0)}%`} />
    </div>
  );
}

/** How much is actually owed on a debt account — the positive counterpart
 * to `netWorthContribution`'s (negative) debt contribution. Matches
 * `AccountRow`'s own `owed` calculation. */
const DEBT_STRATEGY_OPTIONS: { value: string; label: string }[] = [
  { value: "snowball", label: "Snowball (smallest balance first)" },
  { value: "avalanche", label: "Avalanche (highest rate first)" },
];

export function DebtPayoffPlannerSection({
  accounts,
  onSetAccountInterestRate,
  onCalculateDebtPayoff,
  onSetAccountExcludedFromDebtPayoff,
  layoutWidgets,
  onPinWidget,
}: {
  accounts: Account[];
  onSetAccountInterestRate: (accountId: number, rate: string | null) => void;
  onCalculateDebtPayoff: (
    strategy: string,
    extraPayment: string,
    minimums: { accountId: number; minimumPayment: string }[],
  ) => Promise<DebtPayoffPlan | null>;
  onSetAccountExcludedFromDebtPayoff: (accountId: number, excluded: boolean) => void;
  layoutWidgets: WidgetId[];
  onPinWidget: (id: WidgetId) => void;
}) {
  // Every debt with a balance owed is listed — including ones the user has
  // excluded (e.g. a card paid off in full every month) — so excluding is
  // reversible via the checkbox rather than making the account disappear
  // from view entirely.
  const debtAccounts = accounts.filter((a) => {
    const g = groupOf(a.account_type);
    return (g === "credit" || g === "loan") && owedAmount(a) > 0;
  });

  const [strategy, setStrategy] = useState("snowball");
  const [extraPayment, setExtraPayment] = useState("0");
  const [minimums, setMinimums] = useState<Record<number, string>>({});
  const [plan, setPlan] = useState<DebtPayoffPlan | null>(null);
  const [calculating, setCalculating] = useState(false);

  if (debtAccounts.length === 0) return null;

  async function handleCalculate() {
    setCalculating(true);
    setPlan(
      await onCalculateDebtPayoff(
        strategy,
        extraPayment.trim() || "0",
        debtAccounts.map((a) => ({ accountId: a.id, minimumPayment: minimums[a.id]?.trim() || "0" })),
      ),
    );
    setCalculating(false);
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Debt Payoff Planner</span>
        <PinToDashboardButton widgetId="debt_payoff" layoutWidgets={layoutWidgets} onPin={onPinWidget} />
      </div>
      <table className="ledger">
        <thead>
          <tr>
            <th>Include</th>
            <th>Debt</th>
            <th className="amount-col">Balance</th>
            <th className="amount-col">APR %</th>
            <th className="amount-col">Minimum payment</th>
          </tr>
        </thead>
        <tbody>
          {debtAccounts.map((a) => (
            <tr key={a.id}>
              <td>
                <input
                  type="checkbox"
                  checked={!a.excluded_from_debt_payoff}
                  title="Include in payoff plan — uncheck for a debt you already pay off in full, like a credit card, so it isn't treated as debt to pay down"
                  onChange={(e) => onSetAccountExcludedFromDebtPayoff(a.id, !e.target.checked)}
                />
              </td>
              <td>{a.name}</td>
              <td className="amount-col">{formatAmount(owedAmount(a))}</td>
              <td className="amount-col">
                <input
                  className="amount-edit-input"
                  defaultValue={a.interest_rate ?? ""}
                  placeholder="0.00"
                  onBlur={(e) => onSetAccountInterestRate(a.id, e.target.value.trim() || null)}
                />
              </td>
              <td className="amount-col">
                <input
                  className="amount-edit-input"
                  value={minimums[a.id] ?? ""}
                  placeholder="0.00"
                  onChange={(e) => setMinimums({ ...minimums, [a.id]: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="labeled-field-form" onSubmit={(e) => { e.preventDefault(); handleCalculate(); }}>
        <label className="labeled-field">
          <span className="labeled-field-label">Strategy</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            {DEBT_STRATEGY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="labeled-field">
          <span className="labeled-field-label">Extra monthly payment</span>
          <input value={extraPayment} onChange={(e) => setExtraPayment(e.target.value)} placeholder="0.00" />
        </label>
        <button type="submit" disabled={calculating} style={{ alignSelf: "flex-end" }}>
          {calculating ? "Calculating…" : "Calculate"}
        </button>
      </form>

      {plan && (
        <>
          <div className="stats">
            <div className="stat tint-accent">
              <span className="stat-value">{plan.total_months !== null ? `${plan.total_months} mo` : "Never"}</span>
              <span className="stat-label">Debt-free in</span>
            </div>
            <div className="stat tint-red">
              <span className="stat-value">{formatAmount(plan.total_interest_paid)}</span>
              <span className="stat-label">Total interest</span>
            </div>
          </div>
          <table className="ledger">
            <thead>
              <tr>
                <th>Debt</th>
                <th>Payoff date</th>
                <th className="amount-col">Interest paid</th>
              </tr>
            </thead>
            <tbody>
              {plan.per_account.map((l) => (
                <tr key={l.account_id}>
                  <td>{l.account_name}</td>
                  <td>{l.payoff_date ?? "Never at this payment level"}</td>
                  <td className="amount-col">{formatAmount(l.total_interest_paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** A table of name → amount, with each row's share of the total. Used for the
 * by-member and by-tag cuts. */
function BreakdownTable({
  title,
  dataKey,
  rows,
  emptyMessage,
}: {
  title: string;
  dataKey: string;
  rows: { name: string; amount: number }[];
  emptyMessage: string;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const sorted = [...rows].sort((a, b) => b.amount - a.amount);
  return (
    <div className="card" {...{ [`data-${dataKey}`]: "" }}>
      <div className="card-head">
        <span className="reports-section-title">{title}</span>
      </div>
      <table className="ledger">
        <thead>
          <tr>
            <th>Name</th>
            <th className="amount-col">Spent</th>
            <th className="amount-col">Share</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.name} data-breakdown-row={r.name}>
              <td>{r.name}</td>
              <td className="amount-col">{formatAmount(r.amount.toFixed(2))}</td>
              <td className="amount-col">{total > 0 ? `${((r.amount / total) * 100).toFixed(0)}%` : "—"}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={3} className="empty-state">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Same palette CashFlowView/DashboardView use for their category donuts, so
// a category reads the same color everywhere it shows up on Reports.
const CATEGORY_COLORS = ["#1E9E76", "#3E7CB8", "#C08A2E", "#8A5FB0", "#BD5B3C", "#4E8FC9"];

// Sankey geometry, in viewBox units. The side margins hold the labels.
const SANKEY_MARGIN = { top: 20, right: 190, bottom: 6, left: 150 };
const SANKEY_INNER_WIDTH = 600;
const SANKEY_NODE_WIDTH = 14;
const SANKEY_NODE_PADDING = 8;
const SANKEY_MIN_HEIGHT = 240;
const SANKEY_ROW_HEIGHT = 28;
const SANKEY_LABEL_GAP = 16;

/** Keeps a long category name from running out of its label margin; the full
 * name is in the hidden figures table. */
function shortLabel(label: string, max = 15): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** A node's fill color: the synthetic income/spending/leftover/shortfall/
 * other nodes each get a fixed theme color, and a real category cycles
 * through `CATEGORY_COLORS` in the same biggest-first order it's listed. */
function sankeyNodeColor(node: SankeyNode, categoryOrder: string[]): string {
  switch (node.id) {
    case "income":
      return "var(--accent)";
    case "shortfall":
      return "var(--negative)";
    case "spending":
      return "var(--accent-strong)";
    case "leftover":
      return "var(--positive)";
    case "other":
      return "var(--text-faint)";
    default: {
      const i = categoryOrder.indexOf(node.id);
      return CATEGORY_COLORS[Math.max(i, 0) % CATEGORY_COLORS.length];
    }
  }
}

/** Income → spending Sankey for the selected range: income (plus a
 * "Shortfall" flow when spending exceeds it) on the left, the biggest
 * spending categories on the right (the rest grouped as "Other"), and
 * either a "Left over" flow or a "Shortfall" one depending on which side
 * won. All layout math lives in `sankey.ts`, tested on its own — this
 * component only turns a `SankeyLayout` into SVG.
 *
 * Accessibility/privacy: the SVG carries only a plain-language
 * `aria-label` (no dollar figures, so nothing to leak through the
 * accessibility tree while Privacy mode is on) plus `aria-hidden` on the
 * decorative shapes; the actual numbers live in a visually-hidden table
 * right below it, which is real DOM text `startPrivacyMask` can find and
 * mask like everywhere else. */
function SankeySection({ income, categoryTotals, loading }: { income: number; categoryTotals: { category: string; amount: number }[]; loading: boolean }) {
  const data = buildSankeyData(
    income,
    categoryTotals.map((c) => ({ label: c.category, amount: c.amount })),
  );
  const categoryOrder = [...categoryTotals]
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category))
    .map((c) => `cat:${c.category}`);

  const columns = [...new Set(data.nodes.map((n) => n.column))].sort((a, b) => a - b);
  const maxInColumn = Math.max(1, ...columns.map((c) => data.nodes.filter((n) => n.column === c).length));
  const height = Math.max(SANKEY_MIN_HEIGHT, maxInColumn * SANKEY_ROW_HEIGHT);
  const layout = layoutSankey(data, SANKEY_INNER_WIDTH, height, SANKEY_NODE_WIDTH, SANKEY_NODE_PADDING);
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  const nodeWidth = SANKEY_NODE_WIDTH;
  // The labels live inside the drawing (in the side margins), so they scale
  // with it and can never fall outside the SVG at any window width.
  const viewWidth = SANKEY_MARGIN.left + SANKEY_INNER_WIDTH + SANKEY_MARGIN.right;
  const viewHeight = SANKEY_MARGIN.top + height + SANKEY_MARGIN.bottom;
  // Thin bars sit closer together than a line of text is tall, so each side's
  // labels are nudged apart (only the outer columns carry a label beside the bar).
  const labelY = new Map<string, number>();
  for (const col of columns) {
    const colNodes = layout.nodes.filter((n) => n.column === col).sort((a, b) => a.y0 - b.y0);
    const ys = spreadLabelPositions(
      colNodes.map((n) => (n.y0 + n.y1) / 2),
      SANKEY_LABEL_GAP,
      SANKEY_LABEL_GAP / 2,
      height - SANKEY_LABEL_GAP / 2,
    );
    colNodes.forEach((n, i) => labelY.set(n.id, ys[i]));
  }
  const lastColumn = columns[columns.length - 1];

  return (
    <div className="card" data-report-sankey>
      <div className="card-head">
        <span className="reports-section-title">Income → spending</span>
      </div>
      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : data.nodes.length === 0 ? (
        <p className="empty-state">No income or spending in this range.</p>
      ) : (
        <>
          <div className="table-scroll">
            <svg
              className="sankey-svg"
              viewBox={`0 0 ${viewWidth} ${viewHeight}`}
              role="img"
              aria-label={`Diagram of income flowing to spending categories${data.leftover < 0 ? ", including a shortfall" : data.leftover > 0 ? ", with money left over" : ""}. Exact figures are in the table below.`}
            >
              <g aria-hidden="true" transform={`translate(${SANKEY_MARGIN.left},${SANKEY_MARGIN.top})`}>
                {layout.links.map((l, i) => {
                  const target = nodeById.get(l.target)!;
                  const color = sankeyNodeColor(data.nodes.find((n) => n.id === l.target)!, categoryOrder);
                  const source = nodeById.get(l.source)!;
                  return (
                    <path
                      key={i}
                      d={sankeyRibbonPath(source.x + nodeWidth, l.sy0, l.sy1, target.x, l.ty0, l.ty1)}
                      fill={color}
                      opacity={0.32}
                      stroke="none"
                    />
                  );
                })}
                {layout.nodes.map((n) => {
                  const isLeftmost = n.column === columns[0];
                  const isMiddle = !isLeftmost && n.column !== lastColumn;
                  const color = sankeyNodeColor(n, categoryOrder);
                  // Outer columns: the label sits beside the bar. The single middle
                  // "Total spending" bar (shortfall shape) has ribbons on both sides,
                  // so its label goes just above it instead.
                  const labelX = isMiddle ? n.x + nodeWidth / 2 : isLeftmost ? n.x - 8 : n.x + nodeWidth + 8;
                  const labelBaseline = isMiddle ? n.y0 - 7 : (labelY.get(n.id) ?? (n.y0 + n.y1) / 2);
                  return (
                    <g key={n.id}>
                      <rect x={n.x} y={n.y0} width={nodeWidth} height={Math.max(n.y1 - n.y0, 1)} fill={color} rx={2} />
                      <text x={labelX} y={labelBaseline} dominantBaseline="central" textAnchor={isMiddle ? "middle" : isLeftmost ? "end" : "start"} className="sankey-label">
                        {shortLabel(n.label)}{" "}
                        <tspan className="sankey-node-amount">{formatAmount(n.value.toFixed(2))}</tspan>
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
          <table className="sr-only">
            <caption>Income and spending flow, in full dollar figures</caption>
            <thead>
              <tr>
                <th>Flow</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.nodes.map((n) => (
                <tr key={n.id}>
                  <td>{n.label}</td>
                  <td>{formatAmount(n.value.toFixed(2))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

const HEATMAP_BUCKET_COLORS = ["var(--surface-2)", "color-mix(in srgb, var(--accent) 25%, var(--surface))", "color-mix(in srgb, var(--accent) 50%, var(--surface))", "color-mix(in srgb, var(--accent) 75%, var(--surface))", "var(--accent)"];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Calendar-style daily-spend heatmap for the selected range: one cell per
 * day, color intensity scaled to that day's spending against the biggest
 * single day in the range. Grid layout comes from `heatmap.ts`.
 *
 * Accessibility/privacy: each day is a focusable/hoverable `<button>`
 * without a dollar amount in its `aria-label` (just the date, so nothing
 * leaks through the accessibility tree under Privacy mode); the actual
 * total for the focused/hovered day is announced through a real, masked
 * text node in an `aria-live` status line, and every day's figure is also
 * listed in a visually-hidden table for a screen-reader user who'd rather
 * scan than tab through ~180 buttons one at a time. */
function DailySpendHeatmapSection({ daily, from, to, loading }: { daily: DailyAmount[]; from: string; to: string; loading: boolean }) {
  const [focused, setFocused] = useState<{ date: string; amount: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const weeks = buildHeatmapWeeks(daily, from, to);
  const inRangeDays = weeks.flat().filter((d) => d.inRange);
  const max = heatmapScaleMax(inRangeDays.map((d) => d.amount));
  const hasSpending = inRangeDays.some((d) => d.amount > 0);

  // A long range is wider than the card and scrolls inside it; the newest weeks
  // matter most, so it opens scrolled to them (like a contribution graph).
  useEffect(() => {
    const frame = frameRef.current;
    if (frame) frame.scrollLeft = frame.scrollWidth;
  }, [from, to, loading, hasSpending, weeks.length]);

  return (
    <div className="card" data-report-heatmap>
      <div className="card-head">
        <span className="reports-section-title">Daily spending</span>
      </div>
      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : !hasSpending ? (
        <p className="empty-state">No spending in this range.</p>
      ) : (
        <>
          <div className="table-scroll" ref={frameRef}>
            <div className="heatmap-grid" role="presentation">
              <div className="heatmap-weekday-col">
                {WEEKDAY_LABELS.map((w) => (
                  <div key={w} className="heatmap-weekday-label" aria-hidden="true">
                    {w}
                  </div>
                ))}
              </div>
              {weeks.map((week, wi) => (
                <div key={wi} className="heatmap-week-col">
                  {week.map((day) => {
                    const bucket = day.inRange ? heatmapBucket(day.amount, max) : -1;
                    const label = new Date(`${day.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                    return (
                      <button
                        type="button"
                        key={day.date}
                        className="heatmap-cell"
                        disabled={!day.inRange}
                        data-heatmap-day={day.inRange ? day.date : undefined}
                        style={{ background: bucket >= 0 ? HEATMAP_BUCKET_COLORS[bucket] : "transparent" }}
                        aria-label={day.inRange ? label : undefined}
                        onMouseEnter={() => day.inRange && setFocused({ date: day.date, amount: day.amount })}
                        onFocus={() => day.inRange && setFocused({ date: day.date, amount: day.amount })}
                        onMouseLeave={() => setFocused(null)}
                        onBlur={() => setFocused(null)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <p className="heatmap-status" aria-live="polite" data-heatmap-status>
            {focused
              ? `${new Date(`${focused.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}: ${formatAmount(focused.amount.toFixed(2))}`
              : "Hover or focus a day to see its total."}
          </p>
          <div className="heatmap-legend" aria-hidden="true">
            <span>Less</span>
            {HEATMAP_BUCKET_COLORS.map((c, i) => (
              <span key={i} className="heatmap-legend-swatch" style={{ background: c }} />
            ))}
            <span>More</span>
          </div>
          <table className="sr-only">
            <caption>Daily spending totals</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Spent</th>
              </tr>
            </thead>
            <tbody>
              {inRangeDays.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td>{formatAmount(d.amount.toFixed(2))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

type CategoryMonthCell = { month: string; category: string; amount: string };

/** Reports: one date range drives everything on the page — the summary, a
 * category-by-month table, a year-by-year summary, and spending cut by family
 * member and by tag. (Property & Valuables lives on Accounts and data
 * import/export in Settings; this page is for reading your numbers.) */
export function ReportsView({
  accounts,
  transactions,
  assets,
  familyMembers,
  onExportCsv,
  onPrint,
  onOpenBudget,
  layoutWidgets,
  onPinWidget,
}: {
  accounts: Account[];
  transactions: Transaction[];
  assets: Asset[];
  familyMembers: FamilyMember[];
  onExportCsv: () => void;
  onPrint: () => void;
  onOpenBudget: () => void;
  layoutWidgets: WidgetId[];
  onPinWidget: (id: WidgetId) => void;
}) {
  const [preset, setPreset] = useState<RangePreset>("last_6");
  const { from, to } = presetRange(preset, new Date());
  const months = monthKeys(from, to);
  const rangeKey = `${months[0]}..${months[months.length - 1]}`;

  const [cells, setCells] = useState<CategoryMonthCell[]>([]);
  const [flow, setFlow] = useState<CashFlow | null>(null);
  const [daily, setDaily] = useState<DailyAmount[]>([]);
  const [loadedRange, setLoadedRange] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      invoke<CategoryMonthCell[]>("category_spending_by_month", { fromYear: from.year, fromMonth: from.month, toYear: to.year, toMonth: to.month }),
      invoke<CashFlow>("cash_flow_for_range", { fromYear: from.year, fromMonth: from.month, toYear: to.year, toMonth: to.month }),
      invoke<{ date: string; amount: string }[]>("daily_spending", { fromYear: from.year, fromMonth: from.month, toYear: to.year, toMonth: to.month }),
    ])
      .then(([spending, cashFlow, dailySpend]) => {
        if (cancelled) return;
        setCells(spending);
        setFlow(cashFlow);
        setDaily(dailySpend.map((d) => ({ date: d.date, amount: parseFloat(d.amount) })));
        setLoadedRange(rangeKey);
      })
      .catch(() => {
        if (!cancelled) setLoadedRange(rangeKey);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const loading = loadedRange !== rangeKey;
  const income = flow ? parseFloat(flow.total_income) : 0;
  const spending = flow ? parseFloat(flow.total_expense) : 0;
  const net = income - spending;
  const savingsRate = income > 0 ? (net / income) * 100 : null;

  const table = buildCategoryTable(cells, months);
  const showYear = from.year !== to.year;
  const years = yearlySummary((flow?.months ?? []) as MonthTotal[]);
  const categoryTotals = table.rows.map((r) => ({ category: r.category, amount: r.total }));
  // The heatmap only ever shows days that have actually happened — a range
  // whose "to" month is the current one (every preset but "last month")
  // would otherwise pad out the rest of this month with meaningless zeros.
  const heatmapFrom = monthStartDate(from);
  const heatmapTo = [monthEndDate(to), toLocalIsoDate()].sort()[0];

  const inRange = transactions.filter((t) => inMonthRange(t.date, from, to));
  const memberRows = spendingByMember(inRange);
  const tagTotals = new Map<string, number>();
  for (const t of inRange) {
    const amount = parseFloat(t.amount);
    if (amount >= 0) continue;
    for (const tag of t.tags) tagTotals.set(tag, (tagTotals.get(tag) ?? 0) + Math.abs(amount));
  }
  const tagRows = Array.from(tagTotals, ([name, amount]) => ({ name, amount }));

  const netWorthByMemberRows = netWorthByMember(accounts, assets);

  return (
    <div className="reports-view" data-reports-hub data-report-range={rangeKey}>
      <div className="page-top">
        <div>
          <h1 className="view-title">Reports</h1>
          <p className="view-sub">
            {PRESET_LABELS[preset]}: {monthHeading(months[0], true)} – {monthHeading(months[months.length - 1], true)}.
          </p>
        </div>
        <div className="page-actions no-print">
          <button type="button" className="modal-secondary" onClick={onExportCsv}>
            Export CSV…
          </button>
          <button type="button" className="modal-secondary" onClick={onPrint}>
            Print / Save as PDF…
          </button>
        </div>
      </div>

      <div className="view-toggle no-print" role="group" aria-label="Report range">
        {(Object.keys(PRESET_LABELS) as RangePreset[]).map((p) => (
          <button
            key={p}
            type="button"
            className={preset === p ? "view-toggle-active" : ""}
            onClick={() => setPreset(p)}
            data-range-preset={p}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>

      <div className="stats" data-report-summary style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div className="stat tint-blue">
          <span className="stat-value" data-summary-income>
            {loading ? "…" : formatAmount(income.toFixed(2))}
          </span>
          <span className="stat-label">Income</span>
        </div>
        <div className="stat tint-red">
          <span className="stat-value" data-summary-spending>
            {loading ? "…" : formatAmount(spending.toFixed(2))}
          </span>
          <span className="stat-label">Spending</span>
        </div>
        <div className="stat tint-accent">
          <span className={net < 0 ? "stat-value report-over-budget" : "stat-value"} data-summary-net>
            {loading ? "…" : formatAmount(net.toFixed(2))}
          </span>
          <span className="stat-label">Net</span>
        </div>
        <div className="stat tint-teal">
          <span className="stat-value" data-summary-rate>
            {loading ? "…" : savingsRate === null ? "—" : `${savingsRate.toFixed(0)}%`}
          </span>
          <span className="stat-label">Savings rate</span>
        </div>
      </div>

      <SankeySection income={income} categoryTotals={categoryTotals} loading={loading} />

      <div className="card" data-report-table>
        <div className="card-head">
          <span className="reports-section-title">Where the money went, by category and month</span>
        </div>
        <div className="report-table-scroll">
          <table className="ledger report-table">
            <thead>
              <tr>
                <th>Category</th>
                {months.map((m) => (
                  <th key={m} className="amount-col">
                    {monthHeading(m, showYear)}
                  </th>
                ))}
                <th className="amount-col">Total</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.category} data-report-category={r.category}>
                  <td>{r.category}</td>
                  {r.byMonth.map((v, i) => (
                    <td key={months[i]} className="amount-col">
                      {v > 0 ? formatAmount(v.toFixed(2)) : <span className="account-col">—</span>}
                    </td>
                  ))}
                  <td className="amount-col report-table-total" data-category-total>
                    {formatAmount(r.total.toFixed(2))}
                  </td>
                </tr>
              ))}
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={months.length + 2} className="empty-state">
                    {loading ? "Loading…" : "No spending in this range."}
                  </td>
                </tr>
              )}
            </tbody>
            {table.rows.length > 0 && (
              <tfoot>
                <tr className="report-table-foot" data-report-totals>
                  <td>Total</td>
                  {table.monthTotals.map((v, i) => (
                    <td key={months[i]} className="amount-col">
                      {formatAmount(v.toFixed(2))}
                    </td>
                  ))}
                  <td className="amount-col" data-grand-total>
                    {formatAmount(table.grandTotal.toFixed(2))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <DailySpendHeatmapSection daily={daily} from={heatmapFrom} to={heatmapTo} loading={loading} />

      <div className="card" data-report-years>
        <div className="card-head">
          <span className="reports-section-title">Year by year</span>
        </div>
        <table className="ledger">
          <thead>
            <tr>
              <th>Year</th>
              <th className="amount-col">Income</th>
              <th className="amount-col">Spending</th>
              <th className="amount-col">Net</th>
              <th className="amount-col">Savings rate</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.year} data-report-year={y.year}>
                <td>{y.year}</td>
                <td className="amount-col">{formatAmount(y.income.toFixed(2))}</td>
                <td className="amount-col">{formatAmount(y.expense.toFixed(2))}</td>
                <td className={y.net < 0 ? "amount-col report-over-budget" : "amount-col"}>{formatAmount(y.net.toFixed(2))}</td>
                <td className="amount-col">{y.savingsRate === null ? "—" : `${y.savingsRate.toFixed(0)}%`}</td>
              </tr>
            ))}
            {years.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-state">
                  {loading ? "Loading…" : "Nothing in this range."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="report-pair">
        <BreakdownTable
          title="Spending by member"
          dataKey="report-members"
          rows={memberRows}
          emptyMessage={familyMembers.length === 0 ? "Add family members (Household) to see this." : "No spending attributed to a member in this range."}
        />
        <BreakdownTable
          title="Spending by tag"
          dataKey="report-tags"
          rows={tagRows}
          emptyMessage="No tags used in this range — add some from Transactions."
        />
      </div>

      <SavingsRateTrendSection transactions={transactions} accounts={accounts} />

      {familyMembers.length > 0 && (
        <div>
          <div className="card-head">
            <h2 className="reports-section-title">Net Worth by Member</h2>
            <PinToDashboardButton widgetId="net_worth_by_member" layoutWidgets={layoutWidgets} onPin={onPinWidget} />
          </div>
          <table className="ledger">
            <thead>
              <tr>
                <th>Member</th>
                <th className="amount-col">Net Worth</th>
              </tr>
            </thead>
            <tbody>
              {netWorthByMemberRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td className="amount-col">{formatAmount(row.amount)}</td>
                </tr>
              ))}
              {netWorthByMemberRows.length === 0 && (
                <tr>
                  <td colSpan={2} className="empty-state">
                    Nothing to show yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="card clickable-row" onClick={onOpenBudget} title="Go to the Budget tab">
        <span className="category-link">This month's budget →</span>
      </div>
    </div>
  );
}
