import { MenuSelect } from "./MenuSelect";
import { formatAmount } from "./format";
import type { ImportRow, RowChoices } from "./importResolution";

/** The menu value for "Leave uncategorized". Category values carry a `cat:` prefix, so no category
 * name can be mistaken for it. */
export const LEAVE_UNCATEGORIZED = "__leave__";

function toValue(choices: RowChoices, index: number): string {
  if (!choices.has(index)) return "";
  const choice = choices.get(index);
  return choice == null ? LEAVE_UNCATEGORIZED : `cat:${choice}`;
}

function hint(row: ImportRow, categories: string[]): string {
  const s = row.suggestion;
  if (s && categories.includes(s.category)) {
    return `Possible category: ${s.category}. The app is less than half sure.`;
  }
  return "The app couldn't find a category.";
}

/** The import review screen's "Needs your choice" list: checked rows the app can't place with at
 * least 50% confidence. Each gets a category menu with nothing preselected, including "Leave
 * uncategorized"; Import stays off until every one has a choice. Renders nothing when no row
 * needs one. */
export function ImportNeedsChoice({
  rows,
  categories,
  choices,
  onChoose,
  onLeaveRest,
  disabled = false,
}: {
  /** The checked rows that need a choice, chosen or not, in file order. */
  rows: ImportRow[];
  /** The person's own categories. */
  categories: string[];
  choices: RowChoices;
  /** A category, or `null` for "Leave uncategorized". */
  onChoose: (index: number, category: string | null) => void;
  onLeaveRest: () => void;
  /** While the import is being saved. */
  disabled?: boolean;
}) {
  if (rows.length === 0) return null;
  const remaining = rows.filter((r) => !choices.has(r.index)).length;

  return (
    <section className="import-needs-choice" aria-labelledby="import-needs-choice-title" data-import-needs-choice>
      <div className="import-category-reconcile-head">
        <h3 id="import-needs-choice-title" className="import-needs-choice-title">
          Needs your choice
        </h3>
        <button type="button" className="modal-secondary" onClick={onLeaveRest} disabled={disabled || remaining === 0}>
          Leave the rest uncategorized
        </button>
      </div>
      <p className="modal-message-secondary">
        {remaining === 0
          ? "Every row here has a choice. "
          : `${remaining} ${remaining === 1 ? "row needs" : "rows need"} a category. `}
        The app isn't sure what these are. Choose a category for each one, or leave it uncategorized and sort it out later.
      </p>
      <ul className="import-category-list">
        {rows.map((r) => {
          const value = toValue(choices, r.index);
          const state = value === "" ? "unresolved" : value === LEAVE_UNCATEGORIZED ? "uncategorized" : "category";
          return (
            <li key={r.index} className="import-category-row import-needs-choice-row" data-import-choice-row={r.index} data-choice-state={state}>
              <span className="import-category-name">
                <span className="import-needs-choice-desc">
                  <span className="import-needs-choice-date">{r.date}</span> {r.description}{" "}
                  <span className="import-needs-choice-amount">{formatAmount(r.amount)}</span>
                </span>
                <span className="account-col">{hint(r, categories)}</span>
              </span>
              <MenuSelect
                ariaLabel={`Category for "${r.description}"`}
                value={value}
                placeholder="Choose a category"
                disabled={disabled}
                onChange={(v) => onChoose(r.index, v === LEAVE_UNCATEGORIZED ? null : v.slice(4))}
                options={[
                  { value: LEAVE_UNCATEGORIZED, label: "Leave uncategorized" },
                  ...categories.map((c) => ({ value: `cat:${c}`, label: c, group: "Your categories" })),
                ]}
                fill
                triggerAttrs={{ "data-import-row-choice": "", "data-import-row-index": r.index }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
