import { DragEvent, FormEvent, useEffect, useState } from "react";
import type { BudgetAlert, ReportBudgetLine } from "./types";
import { formatAmount } from "./format";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import { Sparkline } from "./charts";

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
  fixed: "Fixed Expenses",
  flexible: "Flexible Spending",
  nonmonthly: "Non-Monthly",
};

const CATEGORY_ORDER_STORAGE_KEY = "meadow-budget-category-order";

/** A per-viewer display preference (same as theme/nav order) — one flat
 * list covering every category ever manually positioned, regardless of
 * group. Filtering it down to one group's categories naturally keeps
 * their relative order, so a single stored list is enough to give every
 * group its own independent ordering without a separate array each. */
function loadCategoryOrder(): string[] {
  try {
    const stored = localStorage.getItem(CATEGORY_ORDER_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed.filter((c): c is string => typeof c === "string");
    }
  } catch {
    // corrupt/unavailable storage — fall back to the default order
  }
  return [];
}

function saveCategoryOrder(order: string[]) {
  try {
    localStorage.setItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // per-viewer preference only — fine to skip if storage is unavailable
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
  const [category, setCategory] = useState(availableCategories[0] ?? "");
  const [amount, setAmount] = useState("");
  const [group, setGroup] = useState<Group>("flexible");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!availableCategories.includes(category)) {
      setCategory(availableCategories[0] ?? "");
    }
  }, [availableCategories, category]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!category || !amount.trim()) return;
    onSet(category, amount.trim(), group);
    setAmount("");
    setOpen(false);
  }

  if (availableCategories.length === 0) {
    return <p className="modal-message-secondary">Every category already has a budget line this month.</p>;
  }

  if (!open) {
    return <button onClick={() => setOpen(true)}>Add budget line…</button>;
  }

  return (
    <form className="bucket-new-form" onSubmit={handleSubmit}>
      <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
        {availableCategories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select aria-label="Budget group" value={group} onChange={(e) => setGroup(e.target.value as Group)}>
        {GROUP_ORDER.map((g) => (
          <option key={g} value={g}>
            {GROUP_LABELS[g]}
          </option>
        ))}
      </select>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monthly amount" />
      <button type="submit" disabled={!category || !amount.trim()}>
        Save
      </button>
      <button type="button" className="modal-secondary" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function BudgetRow({
  line,
  alertLevel,
  editingAmount,
  setEditingAmount,
  onSetBudget,
  onSetCap,
  envelopeCapsEnabled,
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
  editingAmount: { category: string; value: string } | null;
  setEditingAmount: (v: { category: string; value: string } | null) => void;
  onSetBudget: (category: string, monthlyAmount: string, budgetGroup: string) => void;
  onSetCap: (category: string, capEnabled: boolean) => void;
  envelopeCapsEnabled: boolean;
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
  /** Keyboard-accessible alternative to the drag handle — reorders within
   * this category's own group, same as dragging does, for anyone who'd
   * rather click than drag (same pairing as the Dashboard widget
   * customizer's ↑/↓ buttons). */
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
  // For expenses, "remaining" is budgeted minus actual (positive = under
  // budget). Income is the opposite — exceeding the expected amount is
  // good, so the sign flips for the income group.
  const budgeted = parseFloat(line.budgeted);
  const actual = parseFloat(line.actual);
  const remaining = isIncome ? actual - budgeted : budgeted - actual;
  const remainingLabel = isIncome ? "diff" : remaining < 0 ? "over" : "left";
  // The consumption bar mirrors the same alert classification as the
  // badge, so a row flagged "Over"/"80%+" also reads red/amber at a
  // glance, not just via the badge text.
  const pct = budgeted > 0 ? Math.min(100, (actual / budgeted) * 100) : actual > 0 ? 100 : 0;
  const fillClass =
    alertLevel === "over" ? "progress-fill over" : alertLevel === "warning" ? "progress-fill warn" : "progress-fill";

  function commitAmountEdit(value: string) {
    setEditingAmount(null);
    if (!value.trim()) return;
    onSetBudget(line.category, value.trim(), line.budget_group);
  }

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

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={isDragging ? "cat-row budget-row-dragging" : "cat-row"}
    >
      <div className="cat-row-name">
        <span className="drag-handle" title="Drag to reorder">
          ⠿
        </span>
        <span className="cat-row-move-buttons">
          <button type="button" className="modal-secondary" onClick={onMoveUp} disabled={!canMoveUp} aria-label="Move up">
            ↑
          </button>
          <button type="button" className="modal-secondary" onClick={onMoveDown} disabled={!canMoveDown} aria-label="Move down">
            ↓
          </button>
        </span>
        <span className="cat-row-name-stack">
          <span
            className="category-link"
            title={`See every transaction under ${line.category} this month`}
            onClick={() => onCategoryClick(line.category)}
          >
            {line.category}
          </span>
          {trend && (
            <Sparkline
              points={trend}
              width={40}
              height={12}
              color="var(--info)"
              title={describeTrend(line.category, trend)}
            />
          )}
        </span>
        {alertLevel && (
          <span
            className={alertLevel === "over" ? "budget-alert-badge budget-alert-over" : "budget-alert-badge budget-alert-warning"}
            title={
              alertLevel === "over"
                ? "Spent past its monthly budget"
                : Math.abs(remaining) < 0.005
                  ? "Right at its monthly budget"
                  : `Approaching its monthly budget (${effectiveCap ? "90%+" : "80%+"})`
            }
          >
            {alertLevel === "over" ? "Over" : Math.abs(remaining) < 0.005 ? "100%" : effectiveCap ? "90%+" : "80%+"}
          </span>
        )}
        {!isIncome && envelopeCapsEnabled && (
          <label
            className="budget-cap-toggle"
            title="Only warn once this category hits 90% of its budget instead of the default 80% — for a category you're already watching closely"
          >
            <input
              type="checkbox"
              checked={line.cap_enabled}
              onChange={(e) => onSetCap(line.category, e.target.checked)}
            />
            Cap
          </label>
        )}
      </div>
      <select
        aria-label={`Budget group for ${line.category}`}
        className="cat-row-group"
        value={line.budget_group}
        onChange={(e) => onSetBudget(line.category, line.budgeted, e.target.value)}
      >
        {GROUP_ORDER.map((g) => (
          <option key={g} value={g}>
            {GROUP_LABELS[g]}
          </option>
        ))}
      </select>
      <div className="progress-track cat-row-bar">
        <div className={fillClass} style={{ width: `${pct}%` }} />
      </div>
      <span className="cat-amt">
        {editingAmount?.category === line.category ? (
          <input
            autoFocus
            className="amount-edit-input"
            value={editingAmount.value}
            onChange={(e) => setEditingAmount({ category: line.category, value: e.target.value })}
            onBlur={() => commitAmountEdit(editingAmount.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAmountEdit(editingAmount.value);
              if (e.key === "Escape") setEditingAmount(null);
            }}
          />
        ) : (
          <span
            className="amount-editable"
            title="Click to adjust this month's budget"
            onClick={() => setEditingAmount({ category: line.category, value: line.budgeted })}
          >
            {formatAmount(line.budgeted)}
          </span>
        )}{" "}
        budget
      </span>
      <span className="cat-amt">{formatAmount(line.actual)} actual</span>
      <span className={remaining < 0 ? "cat-amt neg" : "cat-amt"}>
        {formatAmount(remaining.toFixed(2))} {remainingLabel}
      </span>
      <span className="cat-row-actions">
        {confirmingDelete === line.category ? (
          <span className="row-delete-confirm">
            <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(null)}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={() => onDeleteBudget(line.category)}>
              Delete
            </button>
          </span>
        ) : (
          <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(line.category)}>
            Delete
          </button>
        )}
      </span>
    </div>
  );
}

export function BudgetView({
  categories,
  budgetActuals,
  budgetAlerts,
  monthLabel,
  onPrevMonth,
  onNextMonth,
  onSetBudget,
  onSetCap,
  envelopeCapsEnabled,
  onDeleteBudget,
  onCategoryClick,
  onFetchTrend,
}: {
  categories: string[];
  budgetActuals: ReportBudgetLine[];
  budgetAlerts: BudgetAlert[];
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSetBudget: (category: string, monthlyAmount: string, budgetGroup: string) => void;
  onSetCap: (category: string, capEnabled: boolean) => void;
  envelopeCapsEnabled: boolean;
  onDeleteBudget: (category: string) => void;
  onCategoryClick: (category: string) => void;
  onFetchTrend: (category: string) => Promise<{ month: string; actual: string }[]>;
}) {
  const alertByCategory = new Map(budgetAlerts.map((a) => [a.category, a.level]));
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  useAutoCancelDelete(confirmingDelete, () => setConfirmingDelete(null));
  const [editingAmount, setEditingAmount] = useState<{ category: string; value: string } | null>(null);
  const [categoryOrder, setCategoryOrder] = useState<string[]>(loadCategoryOrder);
  const [dragCategory, setDragCategory] = useState<string | null>(null);

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

  // One summary per non-empty group — computed once and shared by both the
  // top `.group-cards` row and the detailed table below it, so the two
  // never drift out of sync.
  const groupSummaries = GROUP_ORDER.map((group) => {
    const groupLines = orderedCategories.map((c) => lineByCategory.get(c)!).filter((line) => line.budget_group === group);
    const groupBudgeted = groupLines.reduce((s, b) => s + parseFloat(b.budgeted), 0);
    const groupActual = groupLines.reduce((s, b) => s + parseFloat(b.actual), 0);
    return { group, groupLines, groupBudgeted, groupActual };
  }).filter((s) => s.groupLines.length > 0);

  // Overview totals across expense groups only (fixed/flexible/nonmonthly)
  // — "income" is budgeted/tracked the opposite direction (meeting or
  // beating the target is good), so it doesn't belong in a combined
  // budgeted-vs-actual-vs-remaining figure.
  const expenseSummaries = groupSummaries.filter((s) => s.group !== "income");
  const totalBudgeted = expenseSummaries.reduce((s, g) => s + g.groupBudgeted, 0);
  const totalActual = expenseSummaries.reduce((s, g) => s + g.groupActual, 0);
  const totalRemaining = totalBudgeted - totalActual;

  return (
    <div className="budget-view">
      <div className="page-top">
        <div>
          <h1 className="view-title">Budget</h1>
          <p className="view-sub">{monthLabel}, by group.</p>
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

      {expenseSummaries.length > 0 && (
        <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <div className="stat tint-accent">
            <span className="stat-value">{formatAmount(totalBudgeted.toFixed(2))}</span>
            <span className="stat-label">Budgeted</span>
          </div>
          <div className="stat tint-red">
            <span className="stat-value">{formatAmount(totalActual.toFixed(2))}</span>
            <span className="stat-label">Actual</span>
          </div>
          <div className="stat tint-blue">
            <span className={totalRemaining < 0 ? "stat-value report-over-budget" : "stat-value"}>
              {formatAmount(totalRemaining.toFixed(2))}
            </span>
            <span className="stat-label">Remaining</span>
          </div>
        </div>
      )}

      {groupSummaries.length > 0 && (
        <div className="group-cards">
          {groupSummaries.map(({ group, groupBudgeted, groupActual }) => {
            const isIncome = group === "income";
            const pct = groupBudgeted > 0 ? (groupActual / groupBudgeted) * 100 : 0;
            // Expense groups: at/under budget is good, over is bad. Income
            // is the mirror image — meeting or beating the target is good,
            // falling short is what deserves a warning color.
            const status = isIncome
              ? pct >= 100
                ? "ok"
                : pct >= 80
                  ? "warn"
                  : "over"
              : pct > 100
                ? "over"
                : pct >= 80
                  ? "warn"
                  : "ok";
            const fillClass = status === "over" ? "progress-fill over" : status === "warn" ? "progress-fill warn" : "progress-fill";
            const pctLabel =
              status === "over"
                ? isIncome
                  ? `${pct.toFixed(0)}% received`
                  : "Over budget"
                : pct >= 99.5 && pct <= 100.5
                  ? "On target"
                  : `${pct.toFixed(0)}% ${isIncome ? "received" : "used"}`;
            return (
              <div className="group-card" key={group}>
                <span className="group-card-title">{GROUP_LABELS[group]}</span>
                <span className="group-card-amt">
                  {formatAmount(groupActual.toFixed(2))} <span className="of">of {formatAmount(groupBudgeted.toFixed(2))}</span>
                </span>
                <div className="progress-track">
                  <div className={fillClass} style={{ width: `${Math.min(pct, 100)}%` }}></div>
                </div>
                <span className={`group-card-pct ${status}`}>{pctLabel}</span>
              </div>
            );
          })}
        </div>
      )}

      {groupSummaries.map(({ group, groupLines, groupBudgeted, groupActual }) => {
        return (
          <div key={group}>
            <h2 className="reports-section-title">
              {GROUP_LABELS[group]}{" "}
              <span className="account-col">
                {formatAmount(groupActual.toFixed(2))} of {formatAmount(groupBudgeted.toFixed(2))}
              </span>
            </h2>
            <div className="cat-list">
              {groupLines.map((line, i) => (
                <BudgetRow
                  key={line.category}
                  line={line}
                  alertLevel={alertByCategory.get(line.category)}
                  editingAmount={editingAmount}
                  setEditingAmount={setEditingAmount}
                  onSetBudget={onSetBudget}
                  onSetCap={onSetCap}
                  envelopeCapsEnabled={envelopeCapsEnabled}
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
          </div>
        );
      })}
      {budgetActuals.length === 0 && <p className="empty-state">No budget lines yet.</p>}

      <NewBudgetLineForm availableCategories={availableCategories} onSet={onSetBudget} />
    </div>
  );
}
