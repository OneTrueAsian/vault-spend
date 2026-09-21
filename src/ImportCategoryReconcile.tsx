/** What to do with a category an import file uses that the person doesn't have. Sent to
 * `commit_import` as-is (`action` is what the backend reads). Nothing is added to their
 * category list unless it is `create`. */
export type CategoryChoice = { action: "skip" } | { action: "create" } | { action: "map_to"; category: string };

/** A category name the file uses that isn't one of the person's, and how many rows use it. */
export type UnmatchedCategory = { name: string; count: number };

/** Every unfamiliar category starts as "don't use it" — the choice that adds nothing to the
 * person's list and lets their own rules have a go at those rows. */
export function defaultCategoryChoices(unmatched: UnmatchedCategory[]): Record<string, CategoryChoice> {
  return Object.fromEntries(unmatched.map((u) => [u.name, { action: "skip" } as CategoryChoice]));
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
 * new category, or doesn't use it. Renders nothing when there is nothing to decide. */
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
            Don't use any of them
          </button>
          <button type="button" className="modal-secondary" onClick={() => onSetAll("create")}>
            Add all as new categories
          </button>
        </span>
      </div>
      <p className="modal-message-secondary">
        Vault Spend won't add them unless you say so. For each one, use a category you already have, add it as a new category, or
        don't use it — those rows are then categorized by your rules like any other import, or left uncategorized if nothing matches.
      </p>
      <ul className="import-category-list">
        {unmatched.map((u) => (
          <li key={u.name} className="import-category-row">
            <span className="import-category-name">
              <span className="import-category-file-name">{u.name}</span>
              <span className="account-col">
                {u.count} {u.count === 1 ? "row" : "rows"}
              </span>
            </span>
            <select
              value={toValue(choices[u.name])}
              onChange={(e) => onChange(u.name, fromValue(e.target.value))}
              aria-label={`What to do with the file's “${u.name}” category`}
              data-import-category-choice
              data-import-category-name={u.name}
            >
              <option value="skip">Don't use it</option>
              <option value="create">Add as a new category</option>
              {categories.length > 0 && (
                <optgroup label="Use one of my categories">
                  {categories.map((c) => (
                    <option key={c} value={`map:${c}`}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}
