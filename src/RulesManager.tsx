import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RuleEditorDialog } from "./Modal";
import { SortableTh } from "./SortableTh";
import { useAutoCancelDelete } from "./useAutoCancelDelete";

type Rule = { pattern: string; category: string; match_count: number };
type SortColumn = "pattern" | "category" | "matches";

/** Settings' "Categorization rules" — every rule the app uses to
 * auto-categorize new transactions, the built-in starters and the ones
 * learned from your own corrections alike, with how many transactions each
 * one touches. Self-contained (it talks to the backend itself rather than
 * threading a dozen handlers through App) because nothing else on screen
 * depends on the rule list; it only tells its parent when a save actually
 * re-categorized existing transactions, so the rest of the app can reload.
 *
 * Every correction to a merchant adds a rule, so this list only ever grows. The table therefore
 * lives in its own scrolling region (the Settings page stays the same length however many rules
 * there are), sorts by any column, and narrows by category as well as by text. */
export function RulesManager({
  categories,
  onRulesApplied,
  onMessage,
}: {
  categories: string[];
  /** Called after a save re-categorized existing transactions. */
  onRulesApplied: () => void;
  onMessage: (text: string, kind: "success" | "error" | "info") => void;
}) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sort, setSort] = useState<{ column: SortColumn; direction: "asc" | "desc" }>({ column: "pattern", direction: "asc" });
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  useAutoCancelDelete(confirmingDelete, () => setConfirmingDelete(null));

  // The parent passes a fresh callback every render; keeping it in a ref
  // means `load` (and so the effect below) doesn't re-run on each one.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const load = useCallback(async () => {
    try {
      setRules(await invoke<Rule[]>("list_rules"));
    } catch (e) {
      onMessageRef.current(String(e), "error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Only categories that have a rule are worth filtering by. A filter left on a category whose last
  // rule was just deleted falls back to "all" rather than showing an empty list nobody asked for.
  const filterCategories = useMemo(() => {
    const names = new Set((rules ?? []).map((r) => r.category));
    return [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [rules]);
  const activeCategory = filterCategories.includes(categoryFilter) ? categoryFilter : "";

  const shown = useMemo(() => {
    if (!rules) return [];
    const q = query.trim().toLowerCase();
    const byText = (a: Rule, b: Rule) => a.pattern.toLowerCase().localeCompare(b.pattern.toLowerCase());
    const direction = sort.direction === "asc" ? 1 : -1;
    return rules
      .filter((r) => !activeCategory || r.category === activeCategory)
      .filter((r) => !q || r.pattern.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
      .sort((a, b) => {
        let order = 0;
        if (sort.column === "matches") order = a.match_count - b.match_count;
        else if (sort.column === "category") order = a.category.toLowerCase().localeCompare(b.category.toLowerCase());
        else order = byText(a, b);
        // Rules that tie stay in alphabetical order whichever way the column is sorted.
        return order !== 0 ? order * direction : byText(a, b);
      });
  }, [rules, query, activeCategory, sort]);

  function toggleSort(column: SortColumn) {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : // the number that matters most is the biggest one
          { column, direction: column === "matches" ? "desc" : "asc" },
    );
  }

  async function handleSave(pattern: string, category: string, applyToExisting: boolean) {
    const replacing = editing !== null && editing !== "new" ? editing.pattern : null;
    setEditing(null);
    try {
      const changed = await invoke<number>("save_rule", { pattern, category, replacing, applyToExisting });
      await load();
      if (changed > 0) {
        onRulesApplied();
        onMessage(`Saved the rule and re-categorized ${changed} transaction${changed === 1 ? "" : "s"}.`, "success");
      } else {
        onMessage("Saved the rule.", "success");
      }
    } catch (e) {
      onMessage(String(e), "error");
    }
  }

  async function handleDelete(pattern: string) {
    setConfirmingDelete(null);
    try {
      await invoke("delete_rule", { pattern });
      await load();
      onMessage("Deleted the rule. Transactions it already categorized keep their category.", "success");
    } catch (e) {
      onMessage(String(e), "error");
    }
  }

  const editingPattern = editing !== null && editing !== "new" ? editing.pattern : null;
  const total = rules?.length ?? 0;
  const countText =
    rules === null
      ? ""
      : shown.length === total
        ? `${total} ${total === 1 ? "rule" : "rules"}`
        : `Showing ${shown.length} of ${total} ${total === 1 ? "rule" : "rules"}`;

  return (
    <div className="card" id="categorization-rules">
      <div className="card-head">
        <span className="reports-section-title">Categorization rules</span>
        <button type="button" className="modal-secondary" onClick={() => setEditing("new")}>
          Add rule…
        </button>
      </div>
      <p className="modal-message-secondary">
        When a new transaction's description contains a rule's text, it's given that category automatically. Fixing a
        transaction's category creates a rule for that merchant too. Deleting a rule never changes transactions it
        already categorized, and a rule never overrides a category you set yourself.
      </p>
      <div className="rules-controls">
        <input
          type="search"
          className="help-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rules by text or category…"
          aria-label="Filter rules"
        />
        <select
          value={activeCategory}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Show rules for one category"
          data-rules-category-filter
        >
          <option value="">All categories</option>
          {filterCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="account-col rules-count" role="status">
          {countText}
        </span>
      </div>
      <div className="rules-scroll" data-rules-scroll role="region" aria-label="Categorization rules list" tabIndex={0}>
        <table className="ledger rules-table">
          <thead>
            <tr>
              <SortableTh<SortColumn> column="pattern" activeColumn={sort.column} direction={sort.direction} onSort={toggleSort}>
                When the description contains
              </SortableTh>
              <SortableTh<SortColumn> column="category" activeColumn={sort.column} direction={sort.direction} onSort={toggleSort}>
                Category
              </SortableTh>
              <SortableTh<SortColumn>
                column="matches"
                activeColumn={sort.column}
                direction={sort.direction}
                onSort={toggleSort}
                className="amount-col"
              >
                Matches
              </SortableTh>
              <th className="actions-col"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.pattern}>
                <td>{r.pattern}</td>
                <td>{r.category}</td>
                <td className="amount-col">{r.match_count}</td>
                <td className="actions-col">
                  {confirmingDelete === r.pattern ? (
                    <span className="row-delete-confirm">
                      <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(null)}>
                        Cancel
                      </button>
                      <button type="button" className="btn-danger" onClick={() => handleDelete(r.pattern)}>
                        Delete
                      </button>
                    </span>
                  ) : (
                    <span className="row-delete-confirm">
                      <button type="button" className="modal-secondary" onClick={() => setEditing(r)}>
                        Edit
                      </button>
                      <button type="button" className="modal-secondary" onClick={() => setConfirmingDelete(r.pattern)}>
                        Delete
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rules !== null && shown.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-state">
                  {rules.length === 0 ? "No rules yet — fixing a transaction's category will create one." : "No rules match that filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <RuleEditorDialog
          categories={categories}
          initial={editing === "new" ? null : { pattern: editing.pattern, category: editing.category }}
          onPreview={(pattern, category) => invoke("preview_rule", { pattern, category, replacing: editingPattern })}
          onSubmit={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
