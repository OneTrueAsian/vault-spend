import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RuleEditorDialog } from "./Modal";
import { useAutoCancelDelete } from "./useAutoCancelDelete";

type Rule = { pattern: string; category: string; match_count: number };

/** Settings' "Categorization rules" — every rule the app uses to
 * auto-categorize new transactions, the built-in starters and the ones
 * learned from your own corrections alike, with how many transactions each
 * one touches. Self-contained (it talks to the backend itself rather than
 * threading a dozen handlers through App) because nothing else on screen
 * depends on the rule list; it only tells its parent when a save actually
 * re-categorized existing transactions, so the rest of the app can reload. */
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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!rules) return [];
    if (!q) return rules;
    return rules.filter((r) => r.pattern.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
  }, [rules, query]);

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
      <input
        type="search"
        className="help-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter rules by text or category…"
        aria-label="Filter rules"
      />
      <table className="ledger">
        <thead>
          <tr>
            <th>When the description contains</th>
            <th>Category</th>
            <th className="amount-col">Matches</th>
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
