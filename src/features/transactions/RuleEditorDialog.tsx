import { useState, useRef, useEffect, FormEvent } from "react";
import { EditableCombobox } from "../../shared/ui/EditableCombobox";
import { ModalShell } from "../../shared/ui/Modal";

export type RulePreview = { matching: number; would_change: number };

/** Create or edit one categorization rule: "when a description contains X,
 * make it category Y". Shows — live, before anything is saved — how many
 * transactions already on the books that would re-categorize, and offers to
 * do it in the same step. Transactions you categorized yourself are never
 * touched (the backend excludes them from the count too). */
export function RuleEditorDialog({
  categories,
  initial,
  onPreview,
  onSubmit,
  onCancel,
}: {
  categories: string[];
  /** The rule being edited, or `null` for a brand-new one. */
  initial: { pattern: string; category: string } | null;
  onPreview: (pattern: string, category: string) => Promise<RulePreview>;
  onSubmit: (pattern: string, category: string, applyToExisting: boolean) => void;
  onCancel: () => void;
}) {
  const [pattern, setPattern] = useState(initial?.pattern ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [applyToExisting, setApplyToExisting] = useState(true);

  // Latest `onPreview` without making it an effect dependency — the parent
  // hands in a fresh closure every render, and re-running the debounce on
  // each one would mean the preview never settles.
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;

  useEffect(() => {
    if (!pattern.trim() || !category.trim()) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      onPreviewRef
        .current(pattern, category)
        .then((p) => {
          if (!cancelled) setPreview(p);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pattern, category]);

  const wouldChange = preview?.would_change ?? 0;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pattern.trim() || !category.trim()) return;
    onSubmit(pattern.trim(), category.trim(), applyToExisting && wouldChange > 0);
  }

  return (
    <ModalShell title={initial ? "Edit rule" : "New rule"} onCancel={onCancel}>
      <form onSubmit={handleSubmit}>
        <label className="modal-field">
          <span>When a transaction's description contains</span>
          <input
            autoFocus
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder='e.g. "Ferrywood Coffee"'
          />
        </label>
        <label className="modal-field">
          <span>Give it this category</span>
          <EditableCombobox
            options={categories}
            aria-label="Give it this category"
            value={category}
            onChange={setCategory}
            placeholder="Pick one, or type a new one"
          />
        </label>
        <p className="modal-message modal-message-secondary" data-rule-preview={preview ? "ready" : "none"}>
          {preview === null
            ? "Matching is not case-sensitive, and the longest matching text wins when two rules overlap."
            : preview.matching === 0
              ? "No existing transactions contain this text — it will apply to future imports."
              : `${preview.matching} existing transaction${preview.matching === 1 ? " contains" : "s contain"} this text; ${
                  wouldChange === 0 ? "none need changing" : `${wouldChange} would be re-categorized`
                }. Ones you categorized yourself are never changed.`}
        </p>
        {wouldChange > 0 && (
          <label className="modal-field modal-field-inline">
            <input type="checkbox" checked={applyToExisting} onChange={(e) => setApplyToExisting(e.target.checked)} />
            <span>
              Also re-categorize those {wouldChange} transaction{wouldChange === 1 ? "" : "s"} now
            </span>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!pattern.trim() || !category.trim()}>
            Save rule
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
