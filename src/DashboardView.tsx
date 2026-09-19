import { FormEvent, useMemo, useState } from "react";
import { Check, Info, Leaf, LineChart as LineChartIcon, MessageCircleQuestion } from "lucide-react";
import { CategoryIcon, BudgetGroupIcon, AccountTypeIcon, BucketIcon, IconEntryGlyph, flatIconEntry } from "./icons";
import type {
  BillAwareForecast,
  Account,
  AccountContributionDelta,
  Asset,
  Bucket,
  BudgetAlert,
  CashFlow,
  CategoryAmount,
  FamilyMember,
  Holding,
  Insight,
  NetWorthPoint,
  Recurring,
  RecurringMatch,
  Report,
  Transaction,
} from "./types";
import { DonutChart, LineChart, ProgressRing, Sparkline, fmtMoneyShort } from "./charts";
import { StatDetailPanel } from "./StatDetailPanel";
import { formatAmount } from "./format";
import { groupOf, netWorthContribution, owedAmount } from "./accountGroups";
import { netWorthByMember } from "./memberBreakdowns";
import { daysLeft } from "./BucketsView";
import {
  LAYOUT_PRESETS,
  LAYOUT_PRESET_LABELS,
  loadCustomLayoutPresets,
  matchingLayoutPreset,
  parseWidgetId,
  saveCustomLayoutPresets,
  type FixedWidgetId,
  type LayoutPresetKey,
  type SavedLayoutPreset,
  type WidgetId,
} from "./dashboardLayout";
import { answerLedgerQuestion, LEDGER_QA_EXAMPLES, type QaResult } from "./ledgerQa";
import { attentionItems, type AttentionKind } from "./needsAttention";
import { effectiveBudget } from "./budgetPlan";
import { SafeToSpendCard } from "./SafeToSpendCard";

const CHECKLIST_DISMISSED_KEY = "meadow-checklist-dismissed";

/** A single template-matched natural-language question, answered entirely
 * from data already on hand (see ledgerQa.ts) — never a hosted LLM call.
 * Always visible above the widget layout, not itself a customizable
 * widget, since it's a utility rather than a report. */
function LedgerQaBox({
  onAsk,
}: {
  onAsk: (question: string) => QaResult;
}) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QaResult | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  // Picked once per mount, not re-randomized on every render — otherwise
  // it'd shuffle out from under the user mid-interaction. Previously
  // always showed the same one example, which (combined with no other
  // hint of what the box can do) made a genuinely novel feature — natural-
  // language questions answered entirely from local data — easy to miss.
  const [placeholderExample] = useState(() => LEDGER_QA_EXAMPLES[Math.floor(Math.random() * LEDGER_QA_EXAMPLES.length)]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    setResult(onAsk(trimmed));
  }

  return (
    <div className="card ledger-qa-card">
      <div className="card-head">
        <span className="reports-section-title cell-with-icon">
          <MessageCircleQuestion className="category-legend-icon" />
          Ask the Vault
        </span>
        <button type="button" className="modal-secondary" onClick={() => setShowExamples((v) => !v)}>
          {showExamples ? "Hide tips" : "Tips & examples"}
        </button>
      </div>
      {showExamples && (
        <div className="ledger-qa-tips">
          <p className="field-hint">
            Ask one thing at a time, using the exact category, account, bucket, or merchant names you use elsewhere
            in the app. Time periods work too — "this month," "last week," "the past 3 months," a month like "July,"
            a year like "2026," or "since March."
          </p>
          <ul className="ledger-qa-examples">
            {LEDGER_QA_EXAMPLES.map((example) => (
              <li key={example}>
                <button type="button" onClick={() => setQuestion(example)}>
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form className="category-create-form" onSubmit={handleSubmit}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`e.g. "${placeholderExample}"`}
        />
        <button type="submit" disabled={!question.trim()}>
          Ask
        </button>
      </form>
      {result && (
        <p className={result.matched ? "ledger-qa-answer" : "ledger-qa-answer ledger-qa-answer-unmatched"}>
          {result.answer}
        </p>
      )}
    </div>
  );
}

/** Same try/parse/catch-fallback shape as `loadNavOrder`/`theme` in
 * App.tsx — a per-viewer UI preference, not app data, so it lives in
 * localStorage rather than the database. */
function loadChecklistDismissed(): boolean {
  try {
    return localStorage.getItem(CHECKLIST_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

const CATEGORY_COLORS = ["#1E9E76", "#3E7CB8", "#C08A2E", "#8A5FB0", "#BD5B3C", "#4E8FC9"];
const GROUP_ORDER = ["income", "fixed", "flexible", "nonmonthly"] as const;
const GROUP_LABELS: Record<string, string> = {
  income: "Income",
  fixed: "Fixed Expenses",
  flexible: "Flexible Spending",
  nonmonthly: "Non-Monthly",
};

type StatKey = "networth" | "cash" | "debt" | "investments";

const STAT_LABELS: Record<StatKey, string> = {
  networth: "Net Worth",
  cash: "Cash",
  debt: "Debt",
  investments: "Investments",
};

const STAT_KEY_BY_WIDGET: Partial<Record<WidgetId, StatKey>> = {
  stat_net_worth: "networth",
  stat_cash: "cash",
  stat_debt: "debt",
  stat_investments: "investments",
};

/** Every widget rendered as a small `.stat`-styled card rather than a
 * full-width report — the 4 stat cards plus any pinned account/bucket/
 * investment-account widget. Grouped in the layout below into one shared
 * row per contiguous run, so pinning a few accounts doesn't stretch each
 * one to the full Dashboard width. */
function isCompactWidget(id: WidgetId): boolean {
  return id in STAT_KEY_BY_WIDGET || id.startsWith("account:") || id.startsWith("bucket:") || id.startsWith("investment:");
}

export function DashboardView({
  accounts,
  netWorthHistory,
  accountContributionDeltas,
  spendingThisMonth,
  report,
  recurring,
  recurringMatches,
  monthReviewOffer,
  onOpenMonthReview,
  transactions,
  budgetAlerts,
  insights,
  avgMonthlySpend,
  assetsTotal,
  assets,
  holdings,
  familyMembers,
  buckets,
  categories,
  categoryIconMap,
  topCategoriesData,
  layoutWidgets,
  onSetLayoutWidgets,
  onOpenAddWidget,
  onOpenLedger,
  onOpenRecurring,
  onOpenBudget,
  onOpenCashFlow,
  onOpenInvestments,
  onOpenReports,
  onOpenAccounts,
  onOpenBuckets,
  onOpenUncategorized,
  safeToSpendForecast,
  onAddTransaction,
  onAddAccount,
}: {
  accounts: Account[];
  netWorthHistory: NetWorthPoint[];
  /** Per-account "what changed" behind each stat card's own trend, spanning
   * the same two dates the sparkline/delta above it covers (see App.tsx's
   * `refreshDashboard`) — lets the Debt tile explain *which* account moved,
   * not just that the total did. */
  accountContributionDeltas: AccountContributionDelta[];
  spendingThisMonth: CategoryAmount[];
  report: Report | null;
  recurring: Recurring[];
  /** How each recurring item lines up with real charges (paid / missed / price change). */
  recurringMatches: RecurringMatch[];
  /** Last month, while its end-of-month review is still on offer (see `monthReviewDue`). */
  monthReviewOffer: { year: number; month: number; label: string } | null;
  onOpenMonthReview: (year: number, month: number) => void;
  transactions: Transaction[];
  budgetAlerts: BudgetAlert[];
  insights: Insight[];
  /** Average of actual spend (money out only) over the trailing ~90 days,
   * as a decimal string straight from the backend — powers the runway
   * stat below ("liquid savings ÷ average monthly spend"). */
  avgMonthlySpend: string;
  /** Total value of manually-tracked assets (Property & Valuables, see the
   * Reports tab) — folded into the *current* Net Worth figure shown here,
   * but deliberately not part of `netWorthHistory`'s trend line (an asset
   * carries only a current value, no history — see `total_assets_value` in
   * the core crate for the full reasoning). */
  assetsTotal: number;
  /** Only needed for the "Net worth by member" pinned-report widget, same
   * data `netWorthByMember` already reduces on the Reports tab. */
  assets: Asset[];
  /** Only needed for the "Allocation" pinned-report widget. Already fetched
   * unconditionally at launch (see App.tsx), so pinning it costs no extra
   * request. */
  holdings: Holding[];
  familyMembers: FamilyMember[];
  /** Only needed for "Ask the Vault" (see ledgerQa.ts) — bucket-progress
   * questions ("how much have I saved toward vacation"). */
  buckets: Bucket[];
  /** Only needed for "Ask the Vault" (see ledgerQa.ts) — matching a
   * question's category phrase against the app's real, user-curated
   * category names. */
  categories: string[];
  /** Name → explicit icon override, for every `<CategoryIcon>` rendered on
   * this page — see App.tsx's `categoryIconMap`. */
  categoryIconMap: Record<string, string | null>;
  /** Only needed for the "Top merchants" pinned-report widget — App.tsx
   * fetches this (for whatever month Cash Flow's own "Top merchants" last
   * looked at, defaulting to the current month) whenever this widget is on
   * the layout, mirroring the existing tab-scoped fetch pattern. */
  topCategoriesData: CashFlow | null;
  /** The Dashboard's current widget arrangement, persisted client-side
   * (see dashboardLayout.ts) — not app data, so it isn't fetched from the
   * backend or shared between profiles. */
  layoutWidgets: WidgetId[];
  onSetLayoutWidgets: (widgets: WidgetId[]) => void;
  onOpenAddWidget: () => void;
  /** "Recent transactions"/"Upcoming bills" rows drill into the Transactions/
   * Recurring tab — no filter passed along, matching every other tab
   * switch in this app (simplest useful version, not trying to pre-filter
   * the destination tab down to just that one row). */
  onOpenLedger: () => void;
  onOpenRecurring: () => void;
  onOpenBudget: () => void;
  onOpenCashFlow: () => void;
  onOpenInvestments: () => void;
  onOpenReports: () => void;
  onOpenAccounts: () => void;
  onOpenBuckets: () => void;
  /** Opens Transactions already filtered to just the uncategorized ones. */
  onOpenUncategorized: () => void;
  /** The bill-aware forecast the "Safe to spend" widget counts down with —
   * `null` until it loads. */
  safeToSpendForecast: BillAwareForecast | null;
  /** Quick actions panel — same triggers the Transactions toolbar's "Add
   * transaction…" button and Accounts' "Add account…" button already use. */
  onAddTransaction: () => void;
  onAddAccount: () => void;
}) {
  const [expandedStat, setExpandedStat] = useState<StatKey | null>(null);
  const [showBudgetAlerts, setShowBudgetAlerts] = useState(false);
  const [checklistDismissed, setChecklistDismissed] = useState(loadChecklistDismissed);
  const [customizeMode, setCustomizeMode] = useState(false);
  const [dragWidgetId, setDragWidgetId] = useState<WidgetId | null>(null);
  const [customPresets, setCustomPresets] = useState<SavedLayoutPreset[]>(loadCustomLayoutPresets);
  const [savingLayout, setSavingLayout] = useState(false);
  const [newLayoutName, setNewLayoutName] = useState("");

  function saveCurrentLayout() {
    const name = newLayoutName.trim();
    if (!name) return;
    const snapshot: SavedLayoutPreset = { name, widgets: layoutWidgets };
    // Saving under a name that's already in use replaces it, rather than
    // accumulating duplicates — same rule as the Transactions tab's saved filters.
    const next = [...customPresets.filter((p) => p.name !== name), snapshot];
    setCustomPresets(next);
    saveCustomLayoutPresets(next);
    setNewLayoutName("");
    setSavingLayout(false);
  }

  function deleteCustomLayout(name: string) {
    const next = customPresets.filter((p) => p.name !== name);
    setCustomPresets(next);
    saveCustomLayoutPresets(next);
  }

  function dismissChecklist() {
    setChecklistDismissed(true);
    try {
      localStorage.setItem(CHECKLIST_DISMISSED_KEY, "1");
    } catch {
      // per-viewer preference only — fine to skip if storage is unavailable
    }
  }

  const checklistSteps = [
    { done: accounts.length > 0, label: "Add an account", detail: "Checking, savings, credit card — whatever you track.", onClick: onOpenLedger },
    { done: transactions.length > 0, label: "Import or add transactions", detail: "Import a CSV from your bank, or add one by hand.", onClick: onOpenLedger },
    { done: (report?.budget_actuals.length ?? 0) > 0, label: "Set up your budget", detail: "Give at least one category a monthly amount.", onClick: onOpenBudget },
  ];
  const showChecklist = !checklistDismissed && checklistSteps.some((s) => !s.done);
  const overCount = budgetAlerts.filter((a) => a.level === "over").length;
  const warningCount = budgetAlerts.filter((a) => a.level === "warning").length;

  const netWorth = netWorthHistory.length ? parseFloat(netWorthHistory[netWorthHistory.length - 1].value) : 0;
  // The trend delta stays purely history-based (comparing two points on the
  // same series); only the headline figure below folds in assetsTotal,
  // since the trend line itself doesn't include it.
  const netWorthDelta = netWorthHistory.length ? netWorth - parseFloat(netWorthHistory[0].value) : 0;
  const netWorthWithAssets = netWorth + assetsTotal;

  const cashAccounts = useMemo(() => accounts.filter((a) => groupOf(a.account_type) === "cash"), [accounts]);
  const debtAccounts = useMemo(
    () =>
      accounts.filter((a) => {
        const group = groupOf(a.account_type);
        return group === "credit" || group === "loan";
      }),
    [accounts],
  );
  const investmentAccounts = useMemo(
    () => accounts.filter((a) => groupOf(a.account_type) === "investment"),
    [accounts],
  );

  const cash = cashAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
  const debt = debtAccounts.reduce((s, a) => s + netWorthContribution(a), 0);
  const investments = investmentAccounts.reduce((s, a) => s + netWorthContribution(a), 0);

  // "Months of expenses covered by liquid savings" — null when there's no
  // spend history to divide by yet (a brand-new file), rather than a
  // misleading Infinity/0. Ring visualization caps at 6 months (a common
  // emergency-fund benchmark) = a full ring; the number itself is never
  // clamped, so "12.4 months" still reads correctly past that point.
  const avgSpendNum = parseFloat(avgMonthlySpend);
  const monthsOfRunway = avgSpendNum > 0 ? cash / avgSpendNum : null;
  const runwayPct = monthsOfRunway !== null ? Math.min(100, Math.max(0, (monthsOfRunway / 6) * 100)) : 0;

  // Per-stat sparklines/deltas, straight off the same trailing-months
  // series the big Net worth trend chart uses — real history, not a
  // fabricated illustration, and shared across all four stat cards
  // instead of a separate fetch per group.
  const cashSpark = netWorthHistory.map((p) => parseFloat(p.cash));
  // `p.debt` is negative-signed (see `netWorthContribution` — it's a
  // contribution to net worth, so a bigger debt subtracts more). Flipped
  // here to a plain positive "amount owed" magnitude so the sparkline and
  // the delta arrow below move the way paying off a debt actually feels —
  // the line descends and the arrow points down as the balance shrinks,
  // not up (up/positive is reserved for net worth, cash, and investments
  // actually growing, which is the opposite of what a shrinking debt is).
  const debtSpark = netWorthHistory.map((p) => -parseFloat(p.debt));
  const investmentsSpark = netWorthHistory.map((p) => parseFloat(p.investments));
  const netWorthSpark = netWorthHistory.map((p) => parseFloat(p.value));
  const cashDelta = cashSpark.length ? cashSpark[cashSpark.length - 1] - cashSpark[0] : 0;
  const debtDelta = debtSpark.length ? debtSpark[debtSpark.length - 1] - debtSpark[0] : 0;
  // Now that `debtSpark` is an owed-amount magnitude, a negative debtDelta
  // means the balance shrank — debt actually went DOWN, which is good news
  // and should read as good news (green, ▼), not the alarm color/arrow a
  // merely nonzero balance would otherwise get below.
  const debtTrendingDown = netWorthHistory.length > 1 && debtDelta < 0;
  const investmentsDelta = investmentsSpark.length ? investmentsSpark[investmentsSpark.length - 1] - investmentsSpark[0] : 0;
  const monthsSpan = netWorthHistory.length;

  const breakdowns: Record<StatKey, { name: string; amount: number }[]> = useMemo(
    () => ({
      networth: [
        ...accounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
        ...(assetsTotal !== 0 ? [{ name: "Property & Valuables", amount: assetsTotal }] : []),
      ],
      cash: cashAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
      debt: debtAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
      investments: investmentAccounts.map((a) => ({ name: a.name, amount: netWorthContribution(a) })),
    }),
    [accounts, assetsTotal, cashAccounts, debtAccounts, investmentAccounts],
  );

  // "What changed" rows for each stat card's own detail panel — which
  // account(s) actually drove the trend shown above, not just the total.
  // Sorted by size of the move, capped at 5 like every other Dashboard
  // list. `toRows` covers Net Worth (every account) and each group's own
  // filtered slice; `sign` flips Debt to the same "amount owed" magnitude
  // debtSpark/debtDelta use above, since a growing loan balance should
  // read as a positive change (bad), not the negative net-worth-
  // contribution delta it actually is.
  const changeBreakdowns: Record<StatKey, { name: string; delta: number }[]> = useMemo(() => {
    const toRows = (deltas: AccountContributionDelta[], sign = 1) =>
      deltas
        .map((d) => ({ name: d.name, delta: sign * parseFloat(d.delta) }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 5);
    return {
      networth: toRows(accountContributionDeltas),
      cash: toRows(accountContributionDeltas.filter((d) => d.group === "cash")),
      debt: toRows(accountContributionDeltas.filter((d) => d.group === "credit" || d.group === "loan"), -1),
      investments: toRows(accountContributionDeltas.filter((d) => d.group === "investment")),
    };
  }, [accountContributionDeltas]);
  // Which arrow direction reads as "good" for each card's change rows —
  // inverted for Debt, same as debtTrendingDown/debtSpark above.
  const changeGoodDirection: Record<StatKey, "up" | "down"> = {
    networth: "up",
    cash: "up",
    debt: "down",
    investments: "up",
  };

  function toggleStat(key: StatKey) {
    setExpandedStat((prev) => (prev === key ? null : key));
  }

  const donutData = useMemo(
    () =>
      spendingThisMonth.slice(0, 6).map((c, i) => ({
        label: c.category,
        value: parseFloat(c.amount),
        color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
      })),
    [spendingThisMonth],
  );
  // The center total matches what the ring itself visually sums to (the
  // top 6 categories charted), not spendingThisMonth's full, possibly
  // longer tail — so the number and the ring never disagree.
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0);

  const upcoming = useMemo(
    () =>
      recurring
        .filter((r) => parseFloat(r.amount) < 0)
        .slice()
        .sort((a, b) => (a.next_date < b.next_date ? -1 : 1))
        .slice(0, 5),
    [recurring],
  );

  // Sorts the *entire* transaction list just to take the top 8 — the most
  // expensive of this file's derived values for a multi-year history, and
  // one with no dependency on which widgets are even on the layout, so
  // memoizing it is a pure win with no tradeoff.
  const recent = useMemo(
    () =>
      transactions
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
        .slice(0, 8),
    [transactions],
  );

  // Pinned-report widgets — condensed, read-only summaries of the same
  // sections that live on Cash Flow/Investments/Reports, each linking back
  // to the real tab rather than duplicating its full interactive controls.
  const topMerchantsList = (topCategoriesData?.top_merchants ?? []).slice(0, 5);
  const maxTopMerchant = topMerchantsList.length ? Math.max(...topMerchantsList.map((m) => parseFloat(m.amount))) : 0;

  const payoffDebtAccounts = useMemo(
    () =>
      accounts.filter((a) => {
        const g = groupOf(a.account_type);
        return (g === "credit" || g === "loan") && owedAmount(a) > 0 && !a.excluded_from_debt_payoff;
      }),
    [accounts],
  );
  const totalOwed = payoffDebtAccounts.reduce((s, a) => s + owedAmount(a), 0);

  const allocationData = useMemo(() => {
    const holdingsByClass = new Map<string, number>();
    for (const h of holdings) {
      const key = h.asset_class ?? "Other";
      holdingsByClass.set(key, (holdingsByClass.get(key) ?? 0) + parseFloat(h.value));
    }
    return Array.from(holdingsByClass.entries()).map(([label, value], i) => ({
      label,
      value,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    }));
  }, [holdings]);
  const allocationTotal = allocationData.reduce((s, d) => s + d.value, 0);

  const netWorthByMemberRows = useMemo(() => netWorthByMember(accounts, assets), [accounts, assets]);

  // Every widget's content, keyed by id — the layout array below just
  // decides which of these render, and in what order. Wrapping each
  // existing section here (unchanged) rather than restructuring them is
  // deliberate: the customization system should only ever reorder/hide
  // widgets, never change what's inside one.
  // The card's rows are actions, not just facts — each one lands on the
  // screen where the thing can actually be fixed.
  const attention = attentionItems({ transactions, recurring, accounts, today: new Date(), recurringMatches, monthReview: monthReviewOffer });
  function openAttention(kind: AttentionKind) {
    if (kind === "month_review") {
      if (monthReviewOffer) onOpenMonthReview(monthReviewOffer.year, monthReviewOffer.month);
    } else if (kind === "uncategorized") onOpenUncategorized();
    else if (kind === "bills_due" || kind === "bills_missed" || kind === "price_changes") onOpenRecurring();
    else onOpenAccounts();
  }

  const widgetContent: Record<FixedWidgetId, React.ReactNode> = {
    stat_net_worth: (
      <button
        type="button"
        className={
          expandedStat === "networth"
            ? "stat stat-hero tint-accent stat-clickable stat-expanded"
            : "stat stat-hero tint-accent stat-clickable"
        }
        onClick={() => toggleStat("networth")}
      >
        <div className="stat-top">
          <span className="mini-ico mini-ico-plain">
            <IconEntryGlyph entry={flatIconEntry("net-worth-dash")} />
          </span>
          <span className="stat-label">Net Worth</span>
        </div>
        <span className="stat-value">{formatAmount(netWorthWithAssets)}</span>
        {monthsSpan > 1 && (
          <span className={netWorthDelta >= 0 ? "stat-delta up" : "stat-delta down"}>
            {netWorthDelta >= 0 ? "▲" : "▼"} {fmtMoneyShort(Math.abs(netWorthDelta))} over {monthsSpan}mo
          </span>
        )}
        <Sparkline points={netWorthSpark} color="var(--accent)" width={160} fluid />
      </button>
    ),

    stat_cash: (
      <button
        type="button"
        className={
          expandedStat === "cash" ? "stat stat-hero tint-blue stat-clickable stat-expanded" : "stat stat-hero tint-blue stat-clickable"
        }
        onClick={() => toggleStat("cash")}
      >
        <div className="stat-top">
          <span className="mini-ico mini-ico-plain">
            <IconEntryGlyph entry={flatIconEntry("cash-dash")} />
          </span>
          <span className="stat-label">Cash</span>
        </div>
        <span className="stat-value">{formatAmount(cash)}</span>
        {monthsSpan > 1 && (
          <span className={cashDelta >= 0 ? "stat-delta up" : "stat-delta down"}>
            {cashDelta >= 0 ? "▲" : "▼"} {fmtMoneyShort(Math.abs(cashDelta))} over {monthsSpan}mo
          </span>
        )}
        <Sparkline points={cashSpark} color="var(--info)" width={160} fluid />
      </button>
    ),

    stat_debt: (
      <button
        type="button"
        className={
          expandedStat === "debt" ? "stat stat-hero tint-red stat-clickable stat-expanded" : "stat stat-hero tint-red stat-clickable"
        }
        onClick={() => toggleStat("debt")}
      >
        <div className="stat-top">
          <span className="mini-ico mini-ico-plain">
            <IconEntryGlyph entry={flatIconEntry(debt !== 0 && !debtTrendingDown ? "warning-icon" : "debt-dash")} />
          </span>
          <span className="stat-label">Debt</span>
        </div>
        <span
          className={
            debt === 0 ? "stat-value" : debtTrendingDown ? "stat-value report-good" : "stat-value report-over-budget"
          }
        >
          {formatAmount(debt)}
        </span>
        {monthsSpan > 1 && (
          <span className={debtDelta <= 0 ? "stat-delta up" : "stat-delta down"}>
            {debtDelta <= 0 ? "▼" : "▲"} {fmtMoneyShort(Math.abs(debtDelta))} over {monthsSpan}mo
          </span>
        )}
        <Sparkline points={debtSpark} color={debtTrendingDown ? "var(--positive)" : "var(--negative)"} width={160} fluid />
      </button>
    ),

    stat_investments: (
      <button
        type="button"
        className={
          expandedStat === "investments"
            ? "stat stat-hero tint-purple stat-clickable stat-expanded"
            : "stat stat-hero tint-purple stat-clickable"
        }
        onClick={() => toggleStat("investments")}
      >
        <div className="stat-top">
          <span className="mini-ico purple">
            <LineChartIcon aria-hidden="true" />
          </span>
          <span className="stat-label">Investments</span>
        </div>
        <span className="stat-value">{formatAmount(investments)}</span>
        {monthsSpan > 1 && (
          <span className={investmentsDelta >= 0 ? "stat-delta up" : "stat-delta down"}>
            {investmentsDelta >= 0 ? "▲" : "▼"} {fmtMoneyShort(Math.abs(investmentsDelta))} over {monthsSpan}mo
          </span>
        )}
        <Sparkline points={investmentsSpark} color="#8A5FB0" width={160} fluid />
      </button>
    ),

    runway: monthsOfRunway !== null && (
      <div className="card runway-card">
        <ProgressRing pct={runwayPct} size={64} stroke={7} />
        <div>
          <p className="runway-headline">
            <span className="stat-value">{monthsOfRunway.toFixed(1)}</span> months of expenses covered
          </p>
          <p className="modal-message-secondary">
            {fmtMoneyShort(cash)} in liquid savings ÷ {fmtMoneyShort(avgSpendNum)}/mo average spend (trailing 90
            days).
          </p>
        </div>
      </div>
    ),

    safe_to_spend: safeToSpendForecast && <SafeToSpendCard forecast={safeToSpendForecast} onOpenRecurring={onOpenRecurring} />,

    needs_a_look: (
      <>
        {attention.length > 0 && (
          <div className="card">
            <div className="card-head">
              <span className="reports-section-title">To do</span>
            </div>
            <ul className="todo-list">
              {attention.map((item) => (
                <li key={item.kind}>
                  <button type="button" className="todo-row" onClick={() => openAttention(item.kind)}>
                    <span className="todo-count">{item.count}</span>
                    <span className="todo-text">
                      {item.label}
                      {item.detail && <span className="todo-detail"> — {item.detail}</span>}
                    </span>
                    <span className="todo-chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {budgetAlerts.length > 0 && (
          <button type="button" className="budget-alert-banner" onClick={() => setShowBudgetAlerts((v) => !v)}>
            <IconEntryGlyph entry={flatIconEntry("warning-icon")} className="budget-alert-icon" />
            <span>
              {overCount > 0 && `${overCount} categor${overCount === 1 ? "y" : "ies"} over budget`}
              {overCount > 0 && warningCount > 0 && ", "}
              {warningCount > 0 && `${warningCount} approaching ${warningCount === 1 ? "its" : "their"} limit`}
            </span>
          </button>
        )}
        <StatDetailPanel
          isOpen={showBudgetAlerts}
          title={showBudgetAlerts ? "this month's budget alerts" : null}
          rows={
            showBudgetAlerts
              ? budgetAlerts.map((a) => ({ name: a.category, amount: parseFloat(a.budgeted) - parseFloat(a.actual) }))
              : null
          }
          emptyMessage="Nothing to flag."
          onClose={() => setShowBudgetAlerts(false)}
        />

        {insights.length > 0 && (
          <div className="card">
            <div className="card-head">
              <span className="reports-section-title">Insights</span>
            </div>
            <ul className="insights-list">
              {insights.map((insight, i) => (
                <li key={i} className={`insight-row insight-${insight.severity}`}>
                  {insight.severity === "warning" ? (
                    <IconEntryGlyph entry={flatIconEntry("warning-icon")} className="insight-icon" />
                  ) : insight.severity === "positive" ? (
                    <Leaf className="insight-icon" aria-hidden="true" />
                  ) : (
                    <Info className="insight-icon" aria-hidden="true" />
                  )}
                  <span className={`confidence-badge insight-badge-${insight.severity}`}>{insight.severity}</span>
                  <span>{insight.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    ),

    trend_spending: (
      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <span className="reports-section-title">Net worth trend</span>
          </div>
          <LineChart
            points={netWorthHistory.map((p) => ({ label: p.month_label, value: parseFloat(p.value) + assetsTotal }))}
            height={210}
          />
          <p className="account-col" style={{ marginTop: 8 }}>
            {netWorthDelta >= 0 ? "▲" : "▼"} {fmtMoneyShort(Math.abs(netWorthDelta))} over this period
          </p>
          {assetsTotal !== 0 && (
            <p className="modal-message-secondary" style={{ marginTop: 4 }}>
              Includes Property &amp; Valuables at their current value throughout — since they only carry a value as
              of today, past points assume that same value applied back then too.
            </p>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <span className="reports-section-title">Spending by category</span>
          </div>
          {donutData.length > 0 ? (
            <div className="donut-with-legend">
              <DonutChart
                data={donutData}
                size={132}
                center={{ value: fmtMoneyShort(donutTotal), label: "this month" }}
              />
              <div>
                {donutData.map((d) => (
                  <div className="chart-legend-item" key={d.label} style={{ marginBottom: 8 }}>
                    <CategoryIcon category={d.label} iconKey={categoryIconMap[d.label] ?? null} className="category-legend-icon" />
                    <span className="chart-legend-swatch" style={{ background: d.color }}></span>
                    {d.label}
                    <span className="account-col" style={{ marginLeft: "auto" }}>
                      {fmtMoneyShort(d.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="empty-state">No spending yet this month.</p>
          )}
        </div>
      </div>
    ),

    budget_bills: (
      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <span className="reports-section-title">{report?.month_label ?? "This month"}'s budget</span>
          </div>
          {GROUP_ORDER.map((group) => {
            const lines = (report?.budget_actuals ?? []).filter((b) => b.budget_group === group);
            if (lines.length === 0) return null;
            const budgeted = lines.reduce((s, b) => s + effectiveBudget(b), 0);
            const actual = lines.reduce((s, b) => s + parseFloat(b.actual), 0);
            const pct = budgeted ? Math.min(100, (actual / budgeted) * 100) : 0;
            const over = group === "income" ? actual < budgeted : actual > budgeted;
            return (
              <div
                key={group}
                className="clickable-row"
                style={{ marginBottom: 14, padding: 4, borderRadius: 6 }}
                onClick={onOpenBudget}
                title="Go to the Budget tab"
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: 6 }}>
                  <span className="cell-with-icon" style={{ fontWeight: 600 }}>
                    <BudgetGroupIcon group={group} className="category-legend-icon" />
                    {GROUP_LABELS[group]}
                  </span>
                  <span className="account-col">
                    {formatAmount(actual)} of {formatAmount(budgeted)}
                  </span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${pct}%`, background: over ? "var(--negative)" : undefined }}
                  />
                </div>
              </div>
            );
          })}
          {(report?.budget_actuals ?? []).length === 0 && <p className="empty-state">No budget lines yet.</p>}
        </div>
        <div className="card">
          <div className="card-head">
            <span className="reports-section-title">Upcoming bills</span>
          </div>
          {upcoming.length > 0 ? (
            upcoming.map((r) => (
              <div
                className="suggested-row clickable-row"
                key={r.id}
                onClick={onOpenRecurring}
                title="Go to the Recurring tab"
              >
                <span className="row-icon-badge">
                  <CategoryIcon category={r.category} iconKey={r.category ? categoryIconMap[r.category] : null} />
                </span>
                <div className="suggested-info">
                  <div className="account-name-cell">{r.merchant}</div>
                  <span className="account-col">{r.next_date}</span>
                </div>
                <span className="suggested-amt">{formatAmount(r.amount)}</span>
              </div>
            ))
          ) : (
            <p className="empty-state">Nothing due soon.</p>
          )}
        </div>
      </div>
    ),

    recent_transactions: (
      <div className="card">
        <div className="card-head">
          <span className="reports-section-title">Recent transactions</span>
        </div>
        <table className="ledger">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="amount-col">Amount</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((t) => (
              <tr key={t.id} className="clickable-row" onClick={onOpenLedger} title="Go to the Transactions tab">
                <td>{t.date}</td>
                <td>
                  <span className="cell-with-icon">
                    <span className="row-icon-badge">
                      <CategoryIcon category={t.category} iconKey={t.category ? categoryIconMap[t.category] : null} />
                    </span>
                    {t.description}
                  </span>
                </td>
                <td className="amount-col">{formatAmount(t.amount)}</td>
                <td>{t.category ?? "Uncategorized"}</td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-state">
                  No transactions yet — import a CSV to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    ),

    top_merchants: (
      <div className="card">
        <div className="card-head">
          <span className="reports-section-title">Top merchants</span>
        </div>
        {topMerchantsList.length > 0 ? (
          topMerchantsList.map((m) => (
            <div key={m.description} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: 5 }}>
                <span style={{ fontWeight: 600 }}>{m.description}</span>
                <span className="amount-col">{formatAmount(m.amount)}</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${(parseFloat(m.amount) / maxTopMerchant) * 100}%` }} />
              </div>
            </div>
          ))
        ) : (
          <p className="empty-state">No spending yet this month.</p>
        )}
        <div className="clickable-row" onClick={onOpenCashFlow} title="Go to the Cash Flow tab" style={{ marginTop: 4 }}>
          <span className="category-link">View Cash Flow →</span>
        </div>
      </div>
    ),

    debt_payoff: (
      <div className="card">
        <div className="card-head">
          <span className="reports-section-title">Debt payoff planner</span>
        </div>
        {payoffDebtAccounts.length > 0 ? (
          <>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Debt</th>
                  <th className="amount-col">Balance</th>
                </tr>
              </thead>
              <tbody>
                {payoffDebtAccounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td className="amount-col">{formatAmount(owedAmount(a))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="modal-message-secondary" style={{ marginTop: 8 }}>
              {formatAmount(totalOwed)} total across {payoffDebtAccounts.length} debt
              {payoffDebtAccounts.length === 1 ? "" : "s"}.
            </p>
          </>
        ) : (
          <p className="empty-state">No debt to pay off — nice.</p>
        )}
        <div className="clickable-row" onClick={onOpenCashFlow} title="Go to the Cash Flow tab" style={{ marginTop: 4 }}>
          <span className="category-link">Open payoff planner →</span>
        </div>
      </div>
    ),

    allocation: (
      <div className="card">
        <div className="card-head">
          <span className="reports-section-title">Allocation</span>
        </div>
        {allocationData.length > 0 ? (
          <div className="donut-with-legend">
            <DonutChart data={allocationData} size={132} />
            <div>
              {allocationData.map((d) => (
                <div className="chart-legend-item" key={d.label} style={{ marginBottom: 8 }}>
                  <span className="chart-legend-swatch" style={{ background: d.color }}></span>
                  {d.label}
                  <span className="account-col" style={{ marginLeft: "auto" }}>
                    {fmtMoneyShort(d.value)} ({allocationTotal ? ((d.value / allocationTotal) * 100).toFixed(0) : 0}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="empty-state">No holdings yet.</p>
        )}
        <div className="clickable-row" onClick={onOpenInvestments} title="Go to the Investments tab" style={{ marginTop: 4 }}>
          <span className="category-link">View Investments →</span>
        </div>
      </div>
    ),

    net_worth_by_member: (
      <div className="card">
        <div className="card-head">
          <span className="reports-section-title">Net worth by member</span>
        </div>
        {familyMembers.length > 0 ? (
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
        ) : (
          <p className="empty-state">Add a family member from the Household tab to see this breakdown.</p>
        )}
        <div className="clickable-row" onClick={onOpenReports} title="Go to the Reports tab" style={{ marginTop: 4 }}>
          <span className="category-link">View Reports →</span>
        </div>
      </div>
    ),
  };

  // Parameterized widgets (a specific account/bucket/investment account,
  // rather than one of the fixed catalog entries above) can't live in
  // `widgetContent`'s object literal — there's no bounded set of keys to
  // enumerate. Each returns `null` when its target has been deleted since
  // it was pinned; the pruning effect in App.tsx removes the dead entry
  // from the saved layout shortly after, so this is only ever a one-frame
  // gap rather than a permanently broken widget.
  function renderAccountWidget(targetId: number): React.ReactNode {
    const account = accounts.find((a) => a.id === targetId);
    if (!account) return null;
    const group = groupOf(account.account_type);
    const isDebt = group === "credit" || group === "loan";
    const amount = isDebt ? owedAmount(account) : netWorthContribution(account);
    const tint = isDebt ? "tint-red" : group === "investment" ? "tint-purple" : "tint-blue";
    const badgeColor = isDebt ? "red" : group === "investment" ? "purple" : "blue";
    return (
      <div className={`stat stat-hero ${tint}`}>
        <div className="stat-top">
          <span className={`mini-ico ${badgeColor}`}>
            <AccountTypeIcon accountType={account.account_type} iconKey={account.icon_key} />
          </span>
          <span className="stat-label">{account.name}</span>
        </div>
        <span className="stat-value">{formatAmount(amount)}</span>
        <span className="stat-delta">
          {isDebt ? "Owed" : "Balance"}
          {(account.institution || account.mask) &&
            ` · ${[account.institution, account.mask ? `••${account.mask}` : null].filter(Boolean).join(" ")}`}
        </span>
        <div className="clickable-row" onClick={onOpenAccounts} title="Go to the Accounts tab">
          <span className="category-link">View in Accounts →</span>
        </div>
      </div>
    );
  }

  function renderBucketWidget(targetId: number): React.ReactNode {
    const bucket = buckets.find((b) => b.id === targetId);
    if (!bucket) return null;
    const saved = parseFloat(bucket.saved_amount);
    const target = bucket.target_amount ? parseFloat(bucket.target_amount) : null;
    const pct = target && target > 0 ? Math.min(100, Math.max(0, (saved / target) * 100)) : null;
    // A goal's own picked color (BucketsView's color picker) takes over the
    // badge/card tint when set, same way it already colors that goal's
    // border and progress bar on the Goals page — falls back to the
    // standard purple tint used everywhere else on the Dashboard.
    const badgeStyle = bucket.color
      ? { background: `linear-gradient(135deg, color-mix(in srgb, ${bucket.color} 65%, black), ${bucket.color})` }
      : undefined;
    const cardStyle = bucket.color
      ? { background: `linear-gradient(180deg, var(--surface) 0%, color-mix(in srgb, ${bucket.color} 8%, var(--surface)) 100%)` }
      : undefined;
    return (
      <div className="stat stat-hero tint-purple" style={cardStyle}>
        <div className="stat-top">
          <span className="mini-ico purple" style={badgeStyle}>
            <BucketIcon name={bucket.name} iconKey={bucket.icon_key} />
          </span>
          <span className="stat-label">{bucket.name}</span>
        </div>
        <span className="stat-value">{formatAmount(bucket.saved_amount)}</span>
        <span className="stat-delta">
          {bucket.target_amount
            ? `of ${formatAmount(bucket.target_amount)}${pct !== null ? ` (${Math.round(pct)}%)` : ""}`
            : "No target set"}
          {bucket.target_date && ` · ${daysLeft(bucket.target_date)}d left`}
        </span>
        <div className="clickable-row" onClick={onOpenBuckets} title="Go to the Goals tab">
          <span className="category-link">View in Goals →</span>
        </div>
      </div>
    );
  }

  function renderInvestmentWidget(accountName: string): React.ReactNode {
    const accountHoldings = holdings.filter((h) => h.account_name === accountName);
    if (accountHoldings.length === 0) return null;
    const totalValue = accountHoldings.reduce((s, h) => s + parseFloat(h.value), 0);
    const totalGain = accountHoldings.reduce((s, h) => s + parseFloat(h.gain_loss), 0);
    return (
      <div className="stat stat-hero tint-purple">
        <div className="stat-top">
          <span className="mini-ico purple">
            <LineChartIcon aria-hidden="true" />
          </span>
          <span className="stat-label">{accountName}</span>
        </div>
        <span className="stat-value">{formatAmount(totalValue.toFixed(2))}</span>
        <span className={totalGain < 0 ? "stat-delta down" : "stat-delta up"}>
          {totalGain > 0 ? "+" : ""}
          {formatAmount(totalGain.toFixed(2))} gain/loss
        </span>
        <div className="clickable-row" onClick={onOpenInvestments} title="Go to the Investments tab">
          <span className="category-link">View in Investments →</span>
        </div>
      </div>
    );
  }

  function renderWidget(id: WidgetId): React.ReactNode {
    const parsed = parseWidgetId(id);
    if (parsed.kind === "fixed") return widgetContent[parsed.id];
    if (parsed.kind === "account") return renderAccountWidget(parsed.targetId);
    if (parsed.kind === "bucket") return renderBucketWidget(parsed.targetId);
    return renderInvestmentWidget(parsed.accountName);
  }

  function moveWidget(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= layoutWidgets.length) return;
    const next = [...layoutWidgets];
    [next[index], next[target]] = [next[target], next[index]];
    onSetLayoutWidgets(next);
  }

  function removeWidget(id: WidgetId) {
    onSetLayoutWidgets(layoutWidgets.filter((w) => w !== id));
  }

  // Same drag-and-drop convention as the sidebar nav's own reordering
  // (App.tsx's `handleNavDrop`/`dragNavTab`) — the ↑/↓ buttons above cover
  // the same ground for anyone who'd rather click than drag.
  function handleWidgetDrop(targetId: WidgetId) {
    if (!dragWidgetId || dragWidgetId === targetId) {
      setDragWidgetId(null);
      return;
    }
    const next = layoutWidgets.filter((id) => id !== dragWidgetId);
    next.splice(next.indexOf(targetId), 0, dragWidgetId);
    onSetLayoutWidgets(next);
    setDragWidgetId(null);
  }

  const presetKey = matchingLayoutPreset(layoutWidgets, customPresets);

  // Groups consecutive compact-card ids (the 4 stat cards, plus any pinned
  // account/bucket/investment-account widget) into one shared row
  // (rendered as the same 4-column `.stats` grid the combined stats
  // widget used to be), while every other id still renders solo as a
  // full-width report — so a run of small cards still reads as one row
  // instead of each stretching to the full Dashboard width, in the common
  // case where they haven't been split apart by another widget dragged in
  // between them.
  type LayoutRow = { key: WidgetId; ids: WidgetId[]; startIndex: number; isCompactRow: boolean };
  const layoutRows = useMemo(() => {
    const rows: LayoutRow[] = [];
    layoutWidgets.forEach((id, index) => {
      const compact = isCompactWidget(id);
      const last = rows[rows.length - 1];
      if (compact && last?.isCompactRow) {
        last.ids.push(id);
      } else {
        rows.push({ key: id, ids: [id], startIndex: index, isCompactRow: compact });
      }
    });
    return rows;
  }, [layoutWidgets]);

  return (
    <div className="reports-view">
      <div className="page-top">
        <div>
          <h1 className="view-title">Dashboard</h1>
          <p className="view-sub">Your accounts, budget, and goals at a glance.</p>
        </div>
      </div>
      <div className="quick-actions">
        <button type="button" onClick={onAddTransaction}>
          + Add transaction
        </button>
        <button type="button" className="modal-secondary" onClick={onAddAccount}>
          + Add account
        </button>
        <button type="button" className="modal-secondary" onClick={onOpenBudget}>
          Set budget
        </button>
        <button type="button" className="modal-secondary" onClick={onOpenBuckets}>
          Update goals
        </button>
      </div>
      <LedgerQaBox
        onAsk={(question) =>
          answerLedgerQuestion(question, {
            transactions,
            categories,
            accounts,
            buckets,
            recurring,
            avgMonthlySpend,
            today: new Date(),
          })
        }
      />

      <div className="dashboard-toolbar">
        <select
          aria-label="Dashboard layout"
          className="month-select"
          value={presetKey}
          title="Layout"
          onChange={(e) => {
            const value = e.target.value;
            if (value.startsWith("custom:")) {
              const found = customPresets.find((p) => p.name === value.slice("custom:".length));
              if (found) onSetLayoutWidgets([...found.widgets]);
            } else {
              onSetLayoutWidgets([...LAYOUT_PRESETS[value as LayoutPresetKey]]);
            }
          }}
        >
          {(Object.keys(LAYOUT_PRESETS) as LayoutPresetKey[]).map((key) => (
            <option key={key} value={key}>
              {LAYOUT_PRESET_LABELS[key]}
            </option>
          ))}
          {customPresets.map((p) => (
            <option key={p.name} value={`custom:${p.name}`}>
              {p.name}
            </option>
          ))}
          {presetKey === "custom" && (
            <option value="custom" disabled>
              Custom (unsaved)
            </option>
          )}
        </select>
        {presetKey === "custom" &&
          (savingLayout ? (
            <form
              className="saved-filter-form"
              onSubmit={(e) => {
                e.preventDefault();
                saveCurrentLayout();
              }}
            >
              <input
                autoFocus
                value={newLayoutName}
                onChange={(e) => setNewLayoutName(e.target.value)}
                placeholder='e.g. "Weekly check-in"'
              />
              <button type="submit" className="btn-sm" disabled={!newLayoutName.trim()}>
                Save
              </button>
              <button
                type="button"
                className="modal-secondary btn-sm"
                onClick={() => {
                  setSavingLayout(false);
                  setNewLayoutName("");
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className="modal-secondary btn-sm" onClick={() => setSavingLayout(true)}>
              + Save as…
            </button>
          ))}
        {presetKey.startsWith("custom:") && (
          <button
            type="button"
            className="modal-secondary btn-sm"
            title="Delete this saved report"
            onClick={() => deleteCustomLayout(presetKey.slice("custom:".length))}
          >
            Delete
          </button>
        )}
        {customizeMode && (
          <button type="button" className="modal-secondary btn-sm" onClick={onOpenAddWidget}>
            + Add widget…
          </button>
        )}
        <button type="button" className="modal-secondary" onClick={() => setCustomizeMode((v) => !v)}>
          {customizeMode ? "Done" : "Customize"}
        </button>
      </div>

      {showChecklist && (
        <div className="card checklist-card">
          <div className="card-head">
            <span className="reports-section-title">Get started</span>
            <button type="button" className="status-dismiss" onClick={dismissChecklist} aria-label="Dismiss checklist">
              ×
            </button>
          </div>
          <ul className="checklist-list">
            {checklistSteps.map((step) => (
              <li key={step.label} className={step.done ? "checklist-step checklist-step-done" : "checklist-step"}>
                <button type="button" className="checklist-step-btn" onClick={step.onClick} disabled={step.done}>
                  <span className="checklist-step-check" aria-hidden="true">{step.done ? <Check /> : null}</span>
                  <span className="checklist-step-text">
                    <span className="checklist-step-label">{step.label}</span>
                    <span className="checklist-step-detail">{step.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {layoutRows.map((row) =>
        row.isCompactRow ? (
          <div key={row.key} className={customizeMode ? "dashboard-widget-customizing" : undefined}>
            <div className="stats">
              {row.ids.map((id, offset) => {
                const index = row.startIndex + offset;
                return (
                  <div
                    key={id}
                    className={customizeMode ? "dashboard-stat-wrap" : undefined}
                    draggable={customizeMode}
                    onDragStart={() => setDragWidgetId(id)}
                    onDragOver={(e) => customizeMode && e.preventDefault()}
                    onDrop={() => handleWidgetDrop(id)}
                    onDragEnd={() => setDragWidgetId(null)}
                  >
                    {customizeMode && (
                      <div className="dashboard-widget-controls">
                        <button
                          type="button"
                          className="modal-secondary"
                          onClick={() => moveWidget(index, -1)}
                          disabled={index === 0}
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="modal-secondary"
                          onClick={() => moveWidget(index, 1)}
                          disabled={index === layoutWidgets.length - 1}
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                        <button type="button" className="modal-secondary" onClick={() => removeWidget(id)} aria-label="Remove widget">
                          ✕
                        </button>
                      </div>
                    )}
                    {renderWidget(id)}
                  </div>
                );
              })}
            </div>
            <StatDetailPanel
              isOpen={expandedStat !== null && row.ids.some((id) => STAT_KEY_BY_WIDGET[id] === expandedStat)}
              title={expandedStat ? STAT_LABELS[expandedStat] : null}
              rows={expandedStat ? breakdowns[expandedStat] : null}
              changeRows={expandedStat ? changeBreakdowns[expandedStat] : null}
              changeLabel={monthsSpan > 1 ? `over ${monthsSpan}mo` : undefined}
              changeGoodDirection={expandedStat ? changeGoodDirection[expandedStat] : "up"}
              emptyMessage="No accounts contribute to this yet."
              onClose={() => setExpandedStat(null)}
            />
          </div>
        ) : (
          <div
            key={row.key}
            className={customizeMode ? "dashboard-widget-customizing" : undefined}
            draggable={customizeMode}
            onDragStart={() => setDragWidgetId(row.ids[0])}
            onDragOver={(e) => customizeMode && e.preventDefault()}
            onDrop={() => handleWidgetDrop(row.ids[0])}
            onDragEnd={() => setDragWidgetId(null)}
          >
            {customizeMode && (
              <div className="dashboard-widget-controls">
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => moveWidget(row.startIndex, -1)}
                  disabled={row.startIndex === 0}
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => moveWidget(row.startIndex, 1)}
                  disabled={row.startIndex === layoutWidgets.length - 1}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button type="button" className="modal-secondary" onClick={() => removeWidget(row.ids[0])} aria-label="Remove widget">
                  ✕
                </button>
              </div>
            )}
            {renderWidget(row.ids[0])}
          </div>
        ),
      )}
    </div>
  );
}
