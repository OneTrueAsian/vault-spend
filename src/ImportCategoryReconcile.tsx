import { MenuSelect } from "./MenuSelect";
import type { UnmatchedCategory } from "./importResolution";
export type { UnmatchedCategory } from "./importResolution";
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
}: {
  unmatched: UnmatchedCategory[];
  /** The person's own categories — the only ones a file category can be filed under. */
  categories: string[];
  choices: Record<string, CategoryChoice>;
  onChange: (name: string, choice: CategoryChoice) => void;
  onSetAll: (action: "skip" | "create") => void;
}) {
  if (unmatched.length === 0) return null;
  const many = unmatched.length !== 1;

  return (
    <div className="import-category-reconcile" role="group" aria-labelledby="import-category-reconcile-title" data-import-category-reconcile>
      <div className="import-category-reconcile-head">
        <strong id="import-category-reconcile-title">
          {unmatched.length} {many ? "categories" : "category"} in this file {many ? "aren't" : "isn't"} in your list
        </strong>
        <span className="import-category-reconcile-all">
          <button type="button" className="modal-secondary" onClick={() => onSetAll("skip")}>
            Let the app guess for all
          </button>
          <button type="button" className="modal-secondary" onClick={() => onSetAll("create")}>
            Add all as new categories
          </button>
        </span>
      </div>
      <p className="modal-message-secondary">
        Vault Spend won't add them unless you say so. For each one, use a category you already have, add it as a new category, or
        let the app guess from your rules and past choices. If the app isn't sure about a row, you'll choose its category below
        before importing. When you pick one of your categories here, the app remembers it for your next import.
      </p>
      <ul className="import-category-list">
        {unmatched.map((u) => (
          <li key={u.name} className="import-category-row">
            <span className="import-category-name">
              <span className="import-category-file-name">{u.name}</span>
              <span className="account-col">
                {u.count} {u.count === 1 ? "row" : "rows"}
                {u.remembered_category &&
                  choices[u.name]?.action === "map_to" &&
                  (choices[u.name] as { category: string }).category === u.remembered_category &&
                  " · Your choice from last time"}
              </span>
            </span>
            <MenuSelect
              ariaLabel={`What to do with the file's “${u.name}” category`}
              value={toValue(choices[u.name])}
              onChange={(v) => onChange(u.name, fromValue(v))}
              options={[
                { value: "skip", label: "Let the app guess" },
                { value: "create", label: "Add as a new category" },
                ...categories.map((c) => ({ value: `map:${c}`, label: c, group: "Use one of my categories" })),
              ]}
              fill
              triggerAttrs={{ "data-import-category-choice": "", "data-import-category-name": u.name }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
