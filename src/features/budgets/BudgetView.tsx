import "./BudgetAndGoals.css";
import "./BudgetGroupCards.css";
import { DragEvent, FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BudgetAlert, BudgetSuggestions, ReportBudgetLine } from "../../shared/lib/types";
import { formatAmount } from "../../shared/lib/format";
import { amountTextProblem } from "../../shared/lib/amountProblem";
import { useAutoCancelDelete } from "../../shared/hooks/useAutoCancelDelete";
import { Sparkline } from "../../shared/ui/charts";
import { CategoryBars, type CategoryBarRow } from "../../shared/ui/CategoryBars";
import { budgetAllocation, effectiveBudget, monthElapsed } from "../../shared/lib/budgetPlan";
import { budgetNetSummary } from "./budgetNet";
import { planBarRows } from "./budgetSummary";
import { BudgetSuggestDialog, type AppliedSuggestion } from "./BudgetSuggestDialog";
import { getCurrentGeneration, getProfileUiState, setProfileUiState } from "../../shared/lib/profileUiState";
import { MenuSelect } from "../../shared/ui/MenuSelect";
import { sumMoney } from "../../shared/lib/money";
import { CategoryIcon } from "../../shared/ui/icons";
import { RowMenu, type RowMenuItem } from "../../shared/ui/RowMenu";
import { incomeProgressTone, netTone, toneFillClass, usedInFull as isUsedInFull, viewedMonth, type ViewedMonth } from "./colourStatus";
import { HelpLink } from "../../shared/ui/HelpLink";
import { FinancialReadState } from "../../shared/native/FinancialReadState";
import type { Tab } from "../../shared/native/appTypes";

type MonthElapsed = NonNullable<ReturnType<typeof monthElapsed>>;

/** A thin tick on a budget progress bar marking how far through the month
 * we are — the fill sitting to the right of it means spending is running
 * ahead of an even pace. Current month only (`elapsed` is null otherwise),
 * and never on an income bar, where being "ahead" isn't a warning. */
function PaceMarker({ elapsed }: { elapsed: MonthElapsed | null }) {
  if (!elapsed) return null;
  return (
    <span
      className="progress-pace"
      style={{ left: `${(elapsed.fraction * 100).toFixed(2)}%` }}
      title={`Day ${elapsed.day} of ${elapsed.daysInMonth} — spending an even amount each day would put the bar here`}
    />
  );
}

/** A one-line description of a sparkline's trend, for the `<title>` WCAG
 * 1.1.1 requires on non-decorative non-text content — this is what a
 * screen reader announces in place of the line chart. States the actual
 * direction over the whole window, not just first-vs-last, since a
 * sparkline's whole point is showing shape a single number can't. */
function describeTrend(category: string, points: number[]): string {
  const first = points[0];
  const last = points[points.length - 1];
  const direction = last > first ? "trending up" : last < first ? "trending down" : "flat";
  return `${category} spending over the last ${points.length} months: ${direction}, from ${formatAmount(first)} to ${formatAmount(last)}`;
}

const GROUP_ORDER = ["income", "fixed", "flexible", "nonmonthly"] as const;
type Group = (typeof GROUP_ORDER)[number];
const GROUP_LABELS: Record<Group, string> = {
  income: "Income",
  fixed: "Fixed",
  flexible: "Flexible",
  nonmonthly: "Non-monthly (saved for over time)",
};
/** The shorter names a row's "Move to …" menu items use. */
const GROUP_SHORT_LABELS: Record<Group, string> = {
  income: "Income",
  fixed: "Fixed",
  flexible: "Flexible",
  nonmonthly: "Non-Monthly",
};
/** One plain sentence under the group menu in the "Add budget line" form. */
const GROUP_HINTS: Record<Group, string> = {
  income: "Money coming in, like your pay.",
  fixed: "About the same every month, like rent or a phone bill.",
  flexible: "Changes from month to month, like groceries or eating out.",
  nonmonthly: "Bills that come less often than monthly, like car insurance. Set aside a share each month.",
};

/** The three amount columns' headings. A row's cells repeat them as `data-label`, which the
 * narrow (stacked) layout prints in front of each amount once the heading row is hidden. Income
 * is coming in, not going out, so its columns say what was received and how far that is from the
 * plan. */
const EXPENSE_COLUMNS = ["Planned", "Spent", "Left"] as const;
const INCOME_COLUMNS = ["Planned", "Received", "Still expected"] as const;

/** A per-profile display preference (same mechanism as saved filters — see
 * profileUiState.ts) — one flat list covering every category ever manually
 * positioned, regardless of group. Filtering it down to one group's
 * categories naturally keeps their relative order, so a single stored list
 * is enough to give every group its own independent ordering without a
 * separate array each. */
async function loadCategoryOrder(): Promise<string[]> {
  try {
    const stored = await getProfileUiState("category_order");
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed.filter((c): c is string => typeof c === "string");
    }
  } catch {
    // corrupt/unavailable value — fall back to the default order
  }
  return [];
}

async function saveCategoryOrder(order: string[]) {
  try {
    const generation = await getCurrentGeneration();
    await setProfileUiState("category_order", JSON.stringify(order), generation);
  } catch {
    // per-viewer preference only — fine to skip if the save fails
  }
}

/** Sorts `categories` by their position in the saved `order`; anything
 * not yet positioned keeps its original relative order, appended after
 * everything that has been. */
function sortByCustomOrder(categories: string[], order: string[]): string[] {
  const rank = new Map(order.map((c, i) => [c, i]));
  return categories
    .map((c, i) => ({ c, i, r: rank.has(c) ? rank.get(c)! : Infinity }))
    .sort((a, b) => (a.r !== b.r ? a.r - b.r : a.i - b.i))
    .map((x) => x.c);
}

function NewBudgetLineForm({
  availableCategories,
  onSet,
}: {
  availableCategories: string[];
  onSet: (category: string, monthlyAmount: string, budgetGroup: string) => void;
}) {
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [group, setGroup] = useState<Group>("flexible");
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (category !== "" && !availableCategories.includes(category)) {
      setCategory("");
    }
  }, [availableCategories, category]);

  // VS-103: opening the form brings it into view and puts the cursor on its first field.
  useEffect(() => {
    if (!open) return;
    formRef.current?.scrollIntoView?.({ block: "nearest" });
    formRef.current?.querySelector<HTMLButtonElement>(".menu-select-toggle")?.focus();
  }, [open]);

  // VS-49: the first thing stopping Save, said beside it instead of only greying it out.
  const missing = !amount.trim() ? "Enter a monthly amount." : (amountTextProblem(amount) ?? (category === "" ? "Choose a category." : null));
  const valid = missing === null;
  const amountWrong = amountTextProblem(amount) !== null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onSet(category, amount.trim(), group);
    setAmount("");
    setOpen(false);
  }

  if (availableCategories.length === 0) {
    return <p className="modal-message-secondary">Every category already has a budget line this month.</p>;
  }

  if (!open) {
    return <button onClick={() => setOpen(true)}>Add budget line</button>;
  }

  return (
    <form className="bucket-new-form" ref={formRef} onSubmit={handleSubmit}>
      <div className="bucket-new-field">
        <span>Category</span>
        <MenuSelect
          ariaLabel="Category"
          value={category}
          onChange={setCategory}
          options={availableCategories.map((c) => ({ value: c, label: c }))}
          placeholder="Choose a category"
          fill
        />
      </div>
      <div className="bucket-new-field">
        <span>Budget group</span>
        <MenuSelect
          ariaLabel="Budget group"
          value={group}
          onChange={(v) => setGroup(v as Group)}
          options={GROUP_ORDER.map((g) => ({ value: g, label: GROUP_LABELS[g] }))}
          fill
        />
        <small className="modal-message-secondary" data-budget-group-hint>{GROUP_HINTS[group]}</small>
      </div>
      <label className="bucket-new-field">
        <span>Monthly amount</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monthly amount" aria-invalid={amountWrong} />
      </label>
      <button type="submit" disabled={!valid}>
        Save
      </button>
      <button type="button" className="modal-secondary" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {missing && <small className="field-problem" role="status" data-budget-line-missing>{missing}</small>}
    </form>
  );
}

/** An amount as a budget field shows it: two decimals, no "$" or thousands commas. */
function fieldAmount(amount: string): string {
  const n = Number(amount);
  return Number.isFinite(n) ? n.toFixed(2) : amount;
}

function BudgetRow({
  line,
  alertLevel,
  elapsed,
  viewed,
  amountsHidden,
  editingAmount,
  setEditingAmount,
  onSetBudget,
  onSetCap,
  onSetRollover,
  envelopeCapsEnabled,
  rolloverEnabled,
  confirmingDelete,
  setConfirmingDelete,
  onDeleteBudget,
  onCategoryClick,
  onFetchTrend,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  line: ReportBudgetLine;
  alertLevel: "warning" | "over" | undefined;
  /** See `PaceMarker` — null outside the current month. */
  elapsed: MonthElapsed | null;
  /** Whether the month shown has ended, is this month, or is still to come (sets income's colour). */
  viewed: ViewedMonth;
  /** "Hide amounts" is on. The privacy mask skips `<input>` values, so the budget figure then
   * shows as maskable text and only becomes a field once clicked. */
  amountsHidden: boolean;
  editingAmount: { category: string; value: string } | null;
  setEditingAmount: (v: { category: string; value: string } | null) => void;
  onSetBudget: (category: string, monthlyAmount: string, budgetGroup: string) => void | Promise<void>;
  onSetCap: (category: string, capEnabled: boolean) => void;
  onSetRollover: (category: string, rolloverEnabled: boolean) => void;
  envelopeCapsEnabled: boolean;
  /** The global Settings switch: off hides the per-category control and any rolled-in note. */
  rolloverEnabled: boolean;
  confirmingDelete: string | null;
  setConfirmingDelete: (c: string | null) => void;
  onDeleteBudget: (category: string) => void;
  onCategoryClick: (category: string) => void;
  onFetchTrend: (category: string) => Promise<{ month: string; actual: string }[]>;
  isDragging: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
  /** Keyboard-accessible alternative to the drag handle (the row menu's Move up / Move down) —
   * reorders within this category's own group, same as dragging does. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const isIncome = line.budget_group === "income";
  // Turning the feature off suspends the 90% tier everywhere it's shown,
  // without ever touching the category's own stored cap_enabled flag —
  // matches how the backend computes `budgetAlerts` (see
  // Store::budget_alerts_for_month), so the badge text here can't drift
  // out of sync with which threshold actually applies.
  const effectiveCap = line.cap_enabled && envelopeCapsEnabled;
  const showsRollover = !isIncome && rolloverEnabled && line.rollover_enabled;
  const showsCap = !isIncome && effectiveCap;
  // For expenses, "remaining" is budgeted minus actual (positive = under
  // budget). Income is the opposite — exceeding the expected amount is
  // good, so the sign flips for the income group.
  // What the month has to spend: the budget plus anything rolled in unspent.
  const budgeted = effectiveBudget(line);
  const rolledIn = parseFloat(line.rollover) || 0;
  const actual = parseFloat(line.actual);
  const remaining = isIncome ? Math.max(0, budgeted - actual) : budgeted - actual;
  const showsRolledIn = rolloverEnabled && rolledIn > 0;
  // The consumption bar mirrors the same alert classification as the
  // badge, so a row flagged "Over"/"80%+" also reads red/amber at a
  // glance, not just via the badge text.
  const pct = budgeted > 0 ? Math.max(0, Math.min(100, (actual / budgeted) * 100)) : actual > 0 ? 100 : 0;
  // Exactly at the budget is "used in full", not a warning (s4: red and amber only for what needs you).
  // `budgeted` includes rollover, as the backend's alert does, so this agrees with the Dashboard banner.
  const usedInFull = !isIncome && isUsedInFull(budgeted, actual);
  // Income uses the month-aware tone: money not in yet early in the month is normal, not a warning.
  const fillClass = isIncome
    ? toneFillClass(incomeProgressTone(actual, budgeted, elapsed?.fraction ?? 0, viewed))
    : alertLevel === "over"
      ? "progress-fill over"
      : alertLevel === "warning" && !usedInFull
        ? "progress-fill warn"
        : "progress-fill";
  const columns = isIncome ? INCOME_COLUMNS : EXPENSE_COLUMNS;

  /** Saves a typed budget. An empty or unchanged amount saves nothing (null). */
  function commitAmountEdit(value: string): Promise<void> | null {
    setEditingAmount(null);
    const amount = value.trim();
    if (!amount || Number(amount) === Number(line.budgeted)) return null;
    return saveBudget(amount, line.budget_group);
  }

  /** Sends a save and settles whatever happens. App's handler reports its own errors (it shows
   * them in the status line and never rejects), so a throw or rejection here would only be an
   * unhandled rejection; it is swallowed, and the field then shows the saved amount again. */
  function saveBudget(amount: string, group: string): Promise<void> {
    try {
      return Promise.resolve(onSetBudget(line.category, amount, group)).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }

  // The row is draggable only while the ⠿ handle is held, so selecting text in the budget field
  // with the mouse can't start a row drag instead.
  const [dragArmed, setDragArmed] = useState(false);
  useEffect(() => {
    if (!dragArmed) return;
    const disarm = () => setDragArmed(false);
    window.addEventListener("mouseup", disarm);
    return () => window.removeEventListener("mouseup", disarm);
  }, [dragArmed]);

  // The always-visible budget field (amounts shown): a local draft that follows the saved amount
  // and saves on blur (Enter blurs). An empty or unchanged field shows the saved amount again; so
  // does a save the app turns down, once it has said why (unless you're typing in it again).
  // Shown with two decimals ("250.00"), however it was typed and stored ("250").
  const shownBudget = fieldAmount(line.budgeted);
  const [draft, setDraft] = useState(shownBudget);
  const savedBudget = useRef(shownBudget);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    savedBudget.current = shownBudget;
    setDraft(shownBudget);
  }, [shownBudget]);

  function commitDraft() {
    const saving = commitAmountEdit(draft);
    if (!saving) {
      setDraft(shownBudget);
      return;
    }
    void saving.finally(() => {
      if (document.activeElement !== inputRef.current) setDraft(savedBudget.current);
    });
  }

  // Delete swaps the ⋯ menu for Cancel / Delete. When that confirm goes away without deleting
  // (Cancel, or it timing out) and focus has nowhere to be, it goes back to this row's ⋯.
  const rowRef = useRef<HTMLDivElement>(null);
  const confirming = confirmingDelete === line.category;
  const wasConfirming = useRef(false);
  useLayoutEffect(() => {
    if (wasConfirming.current && !confirming) {
      const active = document.activeElement;
      if (!active || active === document.body) rowRef.current?.querySelector<HTMLElement>("[data-row-menu]")?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  const menuItems: (RowMenuItem | false)[] = [
    !isIncome &&
      rolloverEnabled && {
        kind: "check",
        label: "Roll over unspent",
        checked: line.rollover_enabled,
        onToggle: (next) => onSetRollover(line.category, next),
      },
    !isIncome &&
      envelopeCapsEnabled && {
        kind: "check",
        label: "Warn at 90%",
        checked: line.cap_enabled,
        onToggle: (next) => onSetCap(line.category, next),
      },
    { kind: "divider" },
    ...GROUP_ORDER.filter((g) => g !== line.budget_group).map(
      (g): RowMenuItem => ({ label: `Move to ${GROUP_SHORT_LABELS[g]}`, onSelect: () => void saveBudget(line.budgeted, g) }),
    ),
    { kind: "divider" },
    { label: "Move up", onSelect: onMoveUp, disabled: !canMoveUp },
    { label: "Move down", onSelect: onMoveDown, disabled: !canMoveDown },
    { kind: "divider" },
    { label: "Delete", danger: true, onSelect: () => setConfirmingDelete(line.category) },
  ];

  // Flexible Spending only — this is the group most likely to actually
  // drift month to month (Fixed/Income are close to flat by definition),
  // and fetched lazily per row rather than bulk-loaded for every category
  // up front.
  const [trend, setTrend] = useState<number[] | null>(null);
  useEffect(() => {
    if (line.budget_group !== "flexible") return;
    let cancelled = false;
    onFetchTrend(line.category).then((points) => {
      if (!cancelled) setTrend(points.map((p) => parseFloat(p.actual)));
    });
    return () => {
      cancelled = true;
    };
  }, [line.category, line.budget_group, onFetchTrend]);

  const editingHidden = editingAmount?.category === line.category ? editingAmount : null;

  return (
    <div
      ref={rowRef}
      draggable={dragArmed}
      onDragStart={(e) => {
        if (!dragArmed) {
          e.preventDefault();
          return;
        }
        onDragStart(e);
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={() => {
        setDragArmed(false);
        onDragEnd();
      }}
      className={isDragging ? "cat-row budget-row-dragging" : "cat-row"}
    >
      <div className="cat-row-name">
        <span className="drag-handle" onMouseDown={() => setDragArmed(true)} title="Drag to reorder (or use Move up / Move down in the ⋯ menu)" aria-hidden="true">
          ⠿
        </span>
        <span className="row-icon-badge"><CategoryIcon category={line.category} /></span>
        <span className="cat-row-name-stack">
          <span
            className="category-link"
            title={`See every transaction under ${line.category} this month`}
            onClick={() => onCategoryClick(line.category)}
          >
            {line.category}
          </span>
          {/* Second line, not inline beside the name, so none of these squeeze the name. The
              markers keep the ⋯ menu's settings visible at a glance. */}
          {(trend || usedInFull || alertLevel || showsRolledIn || showsRollover || showsCap) && (
            <span className="cat-row-meta">
              {trend && (
                <Sparkline
                  points={trend}
                  width={40}
                  height={12}
                  color="var(--info)"
                  title={describeTrend(line.category, trend)}
                />
              )}
              {!isIncome && (alertLevel || usedInFull) && (
                <span
                  className={
                    alertLevel === "over"
                      ? "budget-alert-badge budget-alert-over"
                      : usedInFull
                        ? "budget-alert-badge budget-alert-done"
                        : "budget-alert-badge budget-alert-warning"
                  }
                  title={
                    alertLevel === "over"
                      ? "Spent past its monthly budget"
                      : usedInFull
                        ? "Its whole monthly budget is used, and no more"
                        : `Approaching its monthly budget (${effectiveCap ? "90%+" : "80%+"})`
                  }
                >
                  {alertLevel === "over" ? "! Over" : usedInFull ? "All used" : "Close to limit"}
                </span>
              )}
              {showsRolledIn && (
                <span className="rollover-note" data-rollover-note title="Unspent budget carried in from earlier months">
                  + {formatAmount(rolledIn.toFixed(2))} rolled in
                </span>
              )}
              {showsRollover && (
                <span
                  className="cat-row-marker"
                  data-rollover-marker
                  title="Whatever you don't spend this month carries into next month's budget for this category"
                >
                  Rolls over
                </span>
              )}
              {showsCap && (
                <span
                  className="cat-row-marker"
                  data-cap-marker
                  title="Warns once this category reaches 90% of its budget instead of the usual 80%"
                >
                  Warns at 90%
                </span>
              )}
            </span>
          )}
        </span>
      </div>
      <span className="cat-amt cat-amt-budget" data-label={columns[0]}>
        {!amountsHidden ? (
          <input
            ref={inputRef}
            className="budget-amount-input"
            aria-label={`Budget for ${line.category}`}
            inputMode="decimal"
            title="This month's budget — type a new amount, then press Enter or Tab"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setDraft(shownBudget);
            }}
          />
        ) : editingHidden ? (
          <input
            autoFocus
            className="budget-amount-input"
            aria-label={`Budget for ${line.category}`}
            inputMode="decimal"
            value={editingHidden.value}
            onChange={(e) => setEditingAmount({ category: line.category, value: e.target.value })}
            onBlur={() => commitAmountEdit(editingHidden.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAmountEdit(editingHidden.value);
              if (e.key === "Escape") setEditingAmount(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="amount-editable"
            aria-label={`Change the budget for ${line.category}`}
            title="Click to change this month's budget"
            onClick={() => setEditingAmount({ category: line.category, value: fieldAmount(line.budgeted) })}
          >
            {formatAmount(line.budgeted)}
          </button>
        )}
      </span>
      <span className="cat-amt" data-label={columns[1]}>
        {formatAmount(line.actual)}
      </span>
      {/* Red only for spending past its budget. Income still to come shows its shortfall plainly. */}
      <span className={!isIncome && remaining < 0 ? "cat-amt neg" : "cat-amt"} data-label={columns[2]}>
        {formatAmount(remaining.toFixed(2))}
      </span>
      <div className="progress-track cat-row-bar">
        <div className={fillClass} style={{ width: `${pct}%` }} />
        {!isIncome && <PaceMarker elapsed={elapsed} />}
      </div>
      <span className="cat-row-actions">
        {confirming ? (
          <span className="row-delete-confirm">
            {/* Focus lands here (the ⋯ that opened the confirm is gone), so Enter or Space cancels. */}
            <button type="button" className="modal-secondary" autoFocus onClick={() => setConfirmingDelete(null)}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={() => onDeleteBudget(line.category)}>
              Delete
            </button>
          </span>
        ) : (
          <RowMenu label={`Settings for ${line.category}`} items={menuItems} />
        )}
      </span>
    </div>
  );
}

export function BudgetView({
  categories,
  budgetActuals,
  budgetTotals,
  budgetAlerts,
  monthLabel,
  year,
  month,
  onPrevMonth,
  onNextMonth,
  onSetBudget,
  onSetCap,
  onSetRollover,
  envelopeCapsEnabled,
  rolloverEnabled,
  onDeleteBudget,
  onCategoryClick,
  onFetchTrend,
  onSuggest,
  onApplySuggestions,
  onOpenMonthReview,
  amountsHidden,
  onOpenHelp,
  readReady = true,
  readLoading = false,
  readError = null,
  onRetryRead = () => {},
}: {
  categories: string[];
  budgetActuals: ReportBudgetLine[];
  /** Income and spending counted toward the budget (rows marked Exclude from budget are left out). */
  budgetTotals: { income: string; expense: string } | null;
  budgetAlerts: BudgetAlert[];
  monthLabel: string;
  /** The month `budgetActuals` is scoped to — only used to work out how
   * far through it today is (see `PaceMarker`). */
  year: number;
  month: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSetBudget: (category: string, monthlyAmount: string, budgetGroup: string) => void | Promise<void>;
  onSetCap: (category: string, capEnabled: boolean) => void;
  onSetRollover: (category: string, rolloverEnabled: boolean) => void;
  envelopeCapsEnabled: boolean;
  /** The global "Rollover unspent" switch in Settings. */
  rolloverEnabled: boolean;
  onDeleteBudget: (category: string) => void;
  onCategoryClick: (category: string) => void;
  onFetchTrend: (category: string) => Promise<{ month: string; actual: string }[]>;
  /** Fetches the "suggest from my average" preview for the viewed month. */
  onSuggest: () => Promise<BudgetSuggestions | null>;
  onApplySuggestions: (rows: AppliedSuggestion[]) => Promise<void>;
  /** Opens the month-end review for the viewed month. */
  onOpenMonthReview: () => void;
  /** "Hide amounts" is on — see `BudgetRow`'s budget field. */
  amountsHidden: boolean;
  /** Opens Help at this page's section (the ? beside the title). */
  onOpenHelp?: (tab: Tab) => void;
  readReady?: boolean;
  readLoading?: boolean;
  readError?: string | null;
  onRetryRead?: () => void;
}) {
  const [suggestions, setSuggestions] = useState<BudgetSuggestions | null>(null);
  const suggestionRequest = useRef(0);
  useEffect(() => {
    setSuggestions(null);
    return () => { suggestionRequest.current++; };
  }, [year, month]);
  async function openSuggestions() {
    const request = ++suggestionRequest.current;
    const result = await onSuggest();
    if (result && request === suggestionRequest.current) setSuggestions(result);
  }
  const alertByCategory = new Map(budgetAlerts.map((a) => [a.category, a.level]));
  const elapsed = monthElapsed(year, month, new Date());
  const allocation = budgetAllocation(budgetActuals);
  const netSummary = budgetTotals ? budgetNetSummary(budgetActuals, budgetTotals.income, budgetTotals.expense) : null;
  const viewed = viewedMonth(year, month, new Date());
  const actualLabel = viewed === "past" ? "Money left (final)" : viewed === "future" ? "Money left (future month)" : "Money left so far";
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  useAutoCancelDelete(confirmingDelete, () => setConfirmingDelete(null));
  const [editingAmount, setEditingAmount] = useState<{ category: string; value: string } | null>(null);
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [dragCategory, setDragCategory] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCategoryOrder().then((order) => {
      if (!cancelled) setCategoryOrder(order);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Every row shown comes straight from this month's own budget_actuals —
  // no separate global budget list, since a category's budgeted amount is
  // now per-month (see the App.tsx bug this fixes: editing one month's
  // budget used to change every month, since there was only ever one
  // global row per category).
  const budgetedCategories = new Set(budgetActuals.map((b) => b.category));
  const availableCategories = categories.filter((c) => !budgetedCategories.has(c));

  const lineByCategory = new Map(budgetActuals.map((b) => [b.category, b]));
  const orderedCategories = sortByCustomOrder(
    budgetActuals.map((b) => b.category),
    categoryOrder,
  );

  // Reorder within the *full* known set (stored order plus this month's
  // categories), not just this month's subset — otherwise saving would
  // silently drop the positions of categories that only appear in a
  // different month. Shared by both drag-and-drop and the ↑/↓ buttons
  // below — they only differ in how `targetCategory` gets picked.
  function reorderCategory(category: string, targetCategory: string) {
    if (category === targetCategory) return;
    const allKnown = Array.from(new Set([...categoryOrder, ...budgetActuals.map((b) => b.category)]));
    const effective = sortByCustomOrder(allKnown, categoryOrder);
    const next = effective.filter((c) => c !== category);
    next.splice(next.indexOf(targetCategory), 0, category);
    setCategoryOrder(next);
    saveCategoryOrder(next);
  }

  function handleDrop(targetCategory: string) {
    if (dragCategory) reorderCategory(dragCategory, targetCategory);
    setDragCategory(null);
  }

  // Reordering is scoped to the category's own group — Budget renders one
  // group at a time, so "up"/"down" here means relative to the other
  // categories in the *same* group, not a global position. A direct swap
  // of the two positions, not `reorderCategory`'s "insert before target"
  // (that's the right model for a drag-and-drop *drop*, but moving "down"
  // one slot via a button needs to land *after* its neighbor, not before
  // it — "insert before" would just put it right back where it started).
  function moveCategoryWithinGroup(category: string, dir: -1 | 1) {
    const group = lineByCategory.get(category)?.budget_group;
    const groupCategories = orderedCategories.filter((c) => lineByCategory.get(c)?.budget_group === group);
    const index = groupCategories.indexOf(category);
    const targetIndex = index + dir;
    if (targetIndex < 0 || targetIndex >= groupCategories.length) return;
    const neighbor = groupCategories[targetIndex];

    const allKnown = Array.from(new Set([...categoryOrder, ...budgetActuals.map((b) => b.category)]));
    const next = sortByCustomOrder(allKnown, categoryOrder);
    const i = next.indexOf(category);
    const j = next.indexOf(neighbor);
    [next[i], next[j]] = [next[j], next[i]];
    setCategoryOrder(next);
    saveCategoryOrder(next);
  }

  // One summary per non-empty group — its heading's "spent of planned" line and the page's totals
  // both come from this one computation.
  const groupSummaries = GROUP_ORDER.map((group) => {
    const groupLines = orderedCategories.map((c) => lineByCategory.get(c)!).filter((line) => line.budget_group === group);
    const groupBudgeted = sumMoney(groupLines.map((b) => effectiveBudget(b)));
    const groupActual = sumMoney(groupLines.map((b) => b.actual));
    return { group, groupLines, groupBudgeted, groupActual };
  }).filter((s) => s.groupLines.length > 0);

  // Overview totals across expense groups only (fixed/flexible/nonmonthly)
  // — "income" is budgeted/tracked the opposite direction (meeting or
  // beating the target is good), so it doesn't belong in a combined
  // budgeted-vs-actual-vs-remaining figure.
  const expenseSummaries = groupSummaries.filter((s) => s.group !== "income");
  const totalBudgeted = sumMoney(expenseSummaries.map((g) => g.groupBudgeted));
  const totalActual = sumMoney(expenseSummaries.map((g) => g.groupActual));
  const totalRemaining = sumMoney([totalBudgeted, -totalActual]);
  const netBreakdown = netSummary
    ? {
        planned: `${formatAmount(netSummary.plannedIncome)} budgeted income − ${formatAmount(netSummary.plannedExpense)} budgeted spending`,
        actual: `${formatAmount(netSummary.actualIncome)} recorded income − ${formatAmount(netSummary.actualExpense)} recorded spending`,
      }
    : null;

  // "Spending against the plan": one bar per spending category on one dollar scale (see planBarRows).
  const plan = planBarRows(budgetActuals);
  const incomeSummary = groupSummaries.find((g) => g.group === "income");
  const planRows: CategoryBarRow[] = plan.rows.map((r) => ({
    key: r.category,
    label: r.category,
    icon: <CategoryIcon category={r.category} className="category-legend-icon" />,
    amount: r.spent,
    plan: r.plan,
    note:
      r.over > 0 ? (
        <>
          <span aria-hidden="true">!</span> {formatAmount(r.over.toFixed(2))} over
        </>
      ) : (
        `${formatAmount(Math.max(0, r.plan - r.spent).toFixed(2))} left`
      ),
    noteTone: r.over > 0 ? "bad" : undefined,
  }));
  const allocationText = allocation
    ? allocation.status === "unallocated"
      ? `${formatAmount(allocation.unallocated.toFixed(2))} of your planned income isn't given a job yet.`
      : allocation.status === "balanced"
        ? "Every dollar of your planned income has a job."
        : `Planned spending is ${formatAmount(Math.abs(allocation.unallocated).toFixed(2))} more than your planned income.`
    : null;

  return (
    <div className="budget-view">
      <div className="page-top">
        <div>
          <div className="view-title-row">
            <h1 className="view-title">Budget</h1>
            {onOpenHelp && <HelpLink tab="budget" onOpen={onOpenHelp} />}
          </div>
          <p className="view-sub">
            {monthLabel}, by group.
            {!rolloverEnabled && " Rollover of unspent budget is off in Settings."}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="modal-secondary" onClick={onOpenMonthReview}>
            Month-end review
          </button>
          <button type="button" className="modal-secondary" onClick={openSuggestions}>
            Suggest from 3-month average
          </button>
        </div>
      </div>
      <div className="month-nav">
        <button type="button" className="modal-secondary" onClick={onPrevMonth} aria-label="Previous month">
          ‹
        </button>
        <span className="month-label">{monthLabel}</span>
        <button type="button" className="modal-secondary" onClick={onNextMonth} aria-label="Next month">
          ›
        </button>
      </div>

      <FinancialReadState label="Budget totals" initial={!readReady} loading={readLoading} error={readError} onRetry={onRetryRead} />
      {readReady && <>
      {/* VS-31 stream B: "Spending against the plan" replaces the old summary strip. Every figure the strip
          showed is still here: planned, spent and left (or over) in the corner, money left after income in the
          note, and the income allocation message in the income line at the bottom. */}
      <section className="card budget-plan" data-budget-summary aria-label="Spending against the plan">
        <div className="card-head">
          <span className="reports-section-title">Spending against the plan</span>
          {planRows.length > 0 && (
            <span className="account-col" data-plan-total>
              {formatAmount(totalActual.toFixed(2))} of {formatAmount(totalBudgeted.toFixed(2))} planned,{" "}
              {totalRemaining < 0 ? (
                <b className="report-over-budget">{formatAmount(Math.abs(totalRemaining).toFixed(2))} over</b>
              ) : (
                `${formatAmount(totalRemaining.toFixed(2))} left`
              )}
            </span>
          )}
        </div>
        <p className="modal-message-secondary budget-plan-sub">
          {monthLabel}
          {elapsed && elapsed.fraction < 1 ? `, ${Math.round(elapsed.fraction * 100)}% of the month gone` : ""}
        </p>
        {planRows.length > 0 ? (
          <>
            <CategoryBars
              rows={planRows}
              caption="Spending so far by category against each plan, overspending first"
              onSelect={onCategoryClick}
            />
            {plan.more && (
              <p className="modal-message-secondary budget-plan-more" data-plan-more>
                {plan.more.count} more {plan.more.count === 1 ? "category" : "categories"}: {formatAmount(plan.more.spent.toFixed(2))} spent of{" "}
                {formatAmount(plan.more.plan.toFixed(2))} planned.
              </p>
            )}
            <p className="modal-message-secondary budget-plan-key">
              One dollar scale for every category. The outline is the plan, the fill is what has been spent, and the red striped part is spending past the plan.
            </p>
          </>
        ) : (
          <p className="empty-state">Nothing is planned for spending in {monthLabel} yet.</p>
        )}
        <div className="budget-plan-foot">
          {incomeSummary && (
            <p className="budget-plan-income" data-budget-income-line>
              Income so far is {formatAmount(incomeSummary.groupActual)} of {formatAmount(incomeSummary.groupBudgeted)} planned.
              {allocation && allocationText && (
                <>
                  {" "}
                  <span className={`budget-allocation budget-allocation-${allocation.status}`} data-allocation={allocation.status}>
                    {allocationText}
                  </span>
                </>
              )}
            </p>
          )}
          {netSummary && netBreakdown ? (
            <p className="budget-summary-note" data-budget-summary-note>
              Money left after income. Planned:{" "}
              <span className={netTone(parseFloat(netSummary.plannedNet), viewed) === "bad" ? "report-over-budget" : undefined} data-planned-net>
                {formatAmount(netSummary.plannedNet)}
              </span>{" "}
              ({netBreakdown.planned}). {actualLabel}:{" "}
              <span className={netTone(parseFloat(netSummary.actualNet), viewed) === "bad" ? "report-over-budget" : undefined} data-actual-net>
                {formatAmount(netSummary.actualNet)}
              </span>{" "}
              ({netBreakdown.actual}). Not an account balance.
            </p>
          ) : (
            <p className="budget-summary-note">Money left after income: Loading…</p>
          )}
        </div>
      </section>

      <div className="budget-group-cards">
      {([["income", "fixed"], ["flexible", "nonmonthly"]] as const).map((column, index) => (
      <div className="budget-group-column" key={index}>
      {groupSummaries.filter(({ group }) => (column as readonly string[]).includes(group)).map(({ group, groupLines, groupBudgeted, groupActual }) => {
        const isIncome = group === "income";
        const columns = isIncome ? INCOME_COLUMNS : EXPENSE_COLUMNS;
        return (
          <section key={group} className="budget-group" data-budget-group={group}>
            <div className="budget-group-head">
              <div className="budget-group-head-line">
                <h2 className="reports-section-title">{GROUP_LABELS[group]}</h2>
                <span className="budget-group-progress" data-group-progress>
                  {formatAmount(groupActual)} of {formatAmount(groupBudgeted)}
                </span>
              </div>
            </div>
            <div className="cat-list">
              <div className="cat-list-head">
                <span>Category</span>
                <span>{columns[0]}</span>
                <span>{columns[1]}</span>
                <span>{columns[2]}</span>
                <span>Progress</span>
                <span className="sr-only">Settings</span>
              </div>
              {groupLines.map((line, i) => (
                <BudgetRow
                  key={line.category}
                  line={line}
                  alertLevel={alertByCategory.get(line.category)}
                  elapsed={elapsed}
                  viewed={viewed}
                  amountsHidden={amountsHidden}
                  editingAmount={editingAmount}
                  setEditingAmount={setEditingAmount}
                  onSetBudget={onSetBudget}
                  onSetCap={onSetCap}
                  onSetRollover={onSetRollover}
                  envelopeCapsEnabled={envelopeCapsEnabled}
                  rolloverEnabled={rolloverEnabled}
                  confirmingDelete={confirmingDelete}
                  setConfirmingDelete={setConfirmingDelete}
                  onDeleteBudget={onDeleteBudget}
                  onCategoryClick={onCategoryClick}
                  onFetchTrend={onFetchTrend}
                  isDragging={dragCategory === line.category}
                  onDragStart={(e) => {
                    // Native drag-and-drop requires a payload via
                    // setData or the browser treats the drag as
                    // invalid and shows "not-allowed" over every drop
                    // target, regardless of what dragover/drop do.
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", line.category);
                    setDragCategory(line.category);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(line.category);
                  }}
                  onDragEnd={() => setDragCategory(null)}
                  canMoveUp={i > 0}
                  canMoveDown={i < groupLines.length - 1}
                  onMoveUp={() => moveCategoryWithinGroup(line.category, -1)}
                  onMoveDown={() => moveCategoryWithinGroup(line.category, 1)}
                />
              ))}
            </div>
          </section>
        );
      })}
      </div>
      ))}
      </div>
      {budgetActuals.length === 0 && <p className="empty-state">No budget lines yet.</p>}

      <NewBudgetLineForm availableCategories={availableCategories} onSet={onSetBudget} />
      </>}
      {suggestions && (
        <BudgetSuggestDialog
          monthLabel={monthLabel}
          suggestions={suggestions}
          onCancel={() => setSuggestions(null)}
          onApply={async (rows) => {
            setSuggestions(null);
            await onApplySuggestions(rows);
          }}
        />
      )}
    </div>
  );
}
