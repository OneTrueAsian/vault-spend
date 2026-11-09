import { useId, useState } from "react";
import { formatAmount, formatDisplayDate } from "../lib/format";
import { InfoTip } from "./InfoTip";
import { MenuSelect } from "./MenuSelect";
import type { ImportRow, UnmatchedCategory } from "../lib/importResolution";
export type { UnmatchedCategory } from "../lib/importResolution";
/** What to do with a category an import file uses that the person doesn't have. Sent to
 * `commit_import` as-is (`action` is what the backend reads). Nothing is added to their
 * category list unless it is `create`. "skip" is shown as "Let the app guess". */
export type CategoryChoice = { action: "skip" } | { action: "create" } | { action: "map_to"; category: string };

/** A name the person mapped on an earlier import starts on that choice; every other one starts as
 * "Let the app guess" — the choice that adds nothing to their list and lets their own rules and
 * the auto-categorizer have a go at those rows. */
export function defaultCategoryChoices(unmatched: UnmatchedCategory[]): Record<string, CategoryChoice> {
  return Object.fromEntries(
    unmatched.map((u) => [
      u.name,
      u.remembered_category ? ({ action: "map_to", category: u.remembered_category } as CategoryChoice) : ({ action: "skip" } as CategoryChoice),
    ]),
  );
}

function toValue(choice: CategoryChoice | undefined): string {
  if (!choice || choice.action === "skip") return "skip";
  if (choice.action === "create") return "create";
  return `map:${choice.category}`;
}

function fromValue(value: string): CategoryChoice {
  if (value === "create") return { action: "create" };
  if (value.startsWith("map:")) return { action: "map_to", category: value.slice(4) };
  return { action: "skip" };
}

/** Shown on the import review screen when the file's own Category column holds names the person
 * doesn't have (a bank's "Merchandise", "Gas/Automotive", ...). Vault Spend no longer adds those
 * to the list by itself: for each one the person picks one of their own categories, adds it as a
 * new category, or lets the app guess. Renders nothing when there is nothing to decide. */
export function ImportCategoryReconcile({
  unmatched,
  categories,
  choices,
  onChange,
  onSetAll,
  disabled = false,
  rows = [],
  included = new Set<number>(),
}: {
  unmatched: UnmatchedCategory[];
  /** The person's own categories — the only ones a file category can be filed under. */
  categories: string[];
  choices: Record<string, CategoryChoice>;
  onChange: (name: string, choice: CategoryChoice) => void;
  onSetAll: (action: "skip" | "create") => void;
  /** While the import is being saved. */
  disabled?: boolean;
  /** Every row of the file. Clicking a category's row count lists the ones that use it. */
  rows?: ImportRow[];
  /** The rows ticked for import; the others are listed as "Not importing". */
  included?: Set<number>;
}) {
  const listId = useId();
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (unmatched.length === 0) return null;
  const many = unmatched.length !== 1;

  return (
    <div className="import-category-reconcile" role="group" aria-labelledby="import-category-reconcile-title" data-import-category-reconcile>
      <div className="import-category-reconcile-head">
        <strong id="import-category-reconcile-title">
          Your bank uses {unmatched.length} {many ? "categories" : "category"} you don't have
        </strong>
        <span className="import-category-reconcile-all">
          <button type="button" className="modal-secondary" onClick={() => onSetAll("skip")} disabled={disabled}>
            Let the app guess for all
          </button>
          <button type="button" className="modal-secondary" onClick={() => onSetAll("create")} disabled={disabled}>
            Add all as new categories
          </button>
        </span>
      </div>
      <p className="modal-message-secondary">
        Pick one of yours for each. The app will remember it next time.{" "}
        <InfoTip
          label="Let the app guess"
          text={
            "If you choose “Let the app guess”, the app does not remember that choice. If your bank uses this name again, it will ask again. " +
            "To stop being asked, pick one of your own categories for it. The app remembers that."
          }
        />
      </p>
      <ul className="import-category-list" data-has-open={open.size > 0 || undefined}>
        {unmatched.map((u, i) => {
          const key = u.name.trim().toLowerCase();
          const uses = rows.filter((r) => r.category && r.category.trim().toLowerCase() === key);
          const isOpen = open.has(u.name);
          const rowsId = `${listId}-${i}`;
          const countText = `${u.count} ${u.count === 1 ? "row" : "rows"}`;
          return (
            <li key={u.name} className="import-category-row">
              <span className="import-category-name">
                <span className="import-category-file-name">{u.name}</span>
                <span className="account-col">
                  {uses.length === 0 ? (
                    countText
                  ) : (
                    <button
                      type="button"
                      className="import-category-rows-toggle"
                      aria-expanded={isOpen}
                      aria-controls={rowsId}
                      onClick={() =>
                        setOpen((prev) => {
                          const next = new Set(prev);
                          if (!next.delete(u.name)) next.add(u.name);
                          return next;
                        })
                      }
                    >
                      {countText}
                    </button>
                  )}
                  {u.remembered_category &&
                    choices[u.name]?.action === "map_to" &&
                    (choices[u.name] as { category: string }).category === u.remembered_category &&
                    " · Your choice from last time"}
                </span>
              </span>
              {isOpen && uses.length > 0 && (
                <ul id={rowsId} className="import-category-transactions" tabIndex={0} aria-label={`Transactions in “${u.name}”`}>
                  {uses.map((r) => (
                    <li key={r.index} data-not-importing={!included.has(r.index) || undefined}>
                      <span className="import-category-tx-date">{formatDisplayDate(r.date)}</span>
                      <span className="import-category-tx-desc">
                        {r.description}
                        {!included.has(r.index) && <span className="import-category-tx-skipped">Not importing</span>}
                      </span>
                      <span className="import-category-tx-amount">{formatAmount(r.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <MenuSelect
                ariaLabel={`What to do with the file's “${u.name}” category`}
                value={toValue(choices[u.name])}
                onChange={(v) => onChange(u.name, fromValue(v))}
                disabled={disabled}
                options={[
                  { value: "skip", label: "Let the app guess" },
                  { value: "create", label: "Add as a new category" },
                  ...categories.map((c) => ({
                    value: `map:${c}`,
                    label: c,
                    group: "Use one of my categories",
                  })),
                ]}
                fill
                triggerAttrs={{
                  "data-import-category-choice": "",
                  "data-import-category-name": u.name,
                }}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
