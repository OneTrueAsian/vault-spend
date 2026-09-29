import { useRef, useState } from "react";
import { ModalShell } from "./Modal";
import type { Transaction } from "./types";

const NOTES_MAX_CHARS = 4000;

/** Add/edit/clear the one freeform note attached to a single transaction —
 * never its description, category, amount, or any other field. `onSave`
 * receiving `null` clears the note. A rejected save (validation, or any
 * other write failure) keeps the dialog open with the typed text intact
 * and an inline error, exactly like every other dialog in this app that
 * can fail mid-save. */
export function TransactionNotesDialog({
  transaction,
  onSave,
  onClose,
}: {
  transaction: Transaction;
  onSave: (notes: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(transaction.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Unicode scalar values, matching the backend's own count (Rust
  // `.chars().count()`) so the number shown here is the number that
  // actually decides whether Save succeeds.
  const charCount = Array.from(value).length;
  const overLimit = charCount > NOTES_MAX_CHARS;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(value.trim() === "" ? null : value);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={`Note for "${transaction.description}"`} onCancel={onClose}>
      {error && (
        <p className="launch-error-problem" role="alert">
          {error}
        </p>
      )}
      <label className="modal-field">
        <span>Note</span>
        <textarea
          ref={textareaRef}
          autoFocus
          rows={5}
          value={value}
          disabled={saving}
          aria-invalid={overLimit}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <p className={overLimit ? "notes-char-count notes-char-count-over" : "notes-char-count"}>
        {charCount.toLocaleString()} / {NOTES_MAX_CHARS.toLocaleString()}
      </p>
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="button" onClick={handleSave} disabled={saving}>
          Save
        </button>
      </div>
    </ModalShell>
  );
}
