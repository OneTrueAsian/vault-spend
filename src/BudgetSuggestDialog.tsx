import { useState } from "react";
import { ModalShell } from "./Modal";
import { formatAmount } from "./format";
import { defaultSuggestionSelection, suggestionWindowLabel } from "./budgetPlan";
import type { BudgetSuggestions } from "./types";

export type AppliedSuggestion = { category: string; amount: string; group: string };

/** The Budget page's "Suggest from my 3-month average": what each category
 * would be budgeted at if the month simply repeated your recent spending.
 * Categories with no budget line start ticked; ones that already have a line
 * are shown for comparison but left alone unless ticked. Nothing is saved
 * until "Apply". */
export function BudgetSuggestDialog({
  monthLabel,
  suggestions,
  onApply,
  onCancel,
}: {
  monthLabel: string;
  suggestions: BudgetSuggestions;
  onApply: (rows: AppliedSuggestion[]) => void;
  onCancel: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => defaultSuggestionSelection(suggestions.lines));

  function toggle(category: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  const chosen = suggestions.lines.filter((l) => checked.has(l.category));
  const noHistory = suggestions.months_used === 0;

  return (
    <ModalShell title="Suggest budgets from your spending" onCancel={onCancel} wide>
      {noHistory ? (
        <p className="modal-message modal-message-secondary" data-suggest-empty="no-history">
          There's no spending before {monthLabel} to average yet. Once you have a month of transactions, this will suggest a
          budget for each category.
        </p>
      ) : suggestions.lines.length === 0 ? (
        <p className="modal-message modal-message-secondary" data-suggest-empty="nothing">
          No category averaged $1 or more over {suggestionWindowLabel(suggestions.months_used)}, so there's nothing to suggest.
        </p>
      ) : (
        <>
          <p className="modal-message modal-message-secondary">
            Each figure is what you spent per month, on average, over {suggestionWindowLabel(suggestions.months_used)}. Ticked
            rows will be set for {monthLabel}; categories that already have a budget line are left alone unless you tick them.
          </p>
          <ul className="budget-suggest-list">
            {suggestions.lines.map((l) => (
              <li key={l.category}>
                <label className="budget-suggest-row" data-suggest-row={l.category}>
                  <input type="checkbox" checked={checked.has(l.category)} onChange={() => toggle(l.category)} />
                  <span className="budget-suggest-name">{l.category}</span>
                  <span className="budget-suggest-current">
                    {l.current === null ? "no budget yet" : `now ${formatAmount(l.current)}`}
                  </span>
                  <span className="budget-suggest-amount">{formatAmount(l.suggested)}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel}>
          {noHistory || suggestions.lines.length === 0 ? "Close" : "Not now"}
        </button>
        {!noHistory && suggestions.lines.length > 0 && (
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => onApply(chosen.map((l) => ({ category: l.category, amount: l.suggested, group: l.budget_group })))}
          >
            Apply {chosen.length} {chosen.length === 1 ? "budget" : "budgets"}
          </button>
        )}
      </div>
    </ModalShell>
  );
}
