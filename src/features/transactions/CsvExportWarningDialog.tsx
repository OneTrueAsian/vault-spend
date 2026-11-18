import { ModalShell } from "../../shared/ui/Modal";

/** Shown before a CSV export completes, but only when the active profile is
 * password protected — a plain export never asks. CSV has no encryption of
 * its own, so an exported file carries the same data in the clear next to
 * an encrypted database; this is the one place that fact needs saying, per
 * plan v2 §4.11's exact wording. */
export function CsvExportWarningDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title="Export as CSV?" onCancel={onCancel}>
      <p className="modal-message">
        CSV files are not password protected. Anyone who can open the exported file can read this data.
      </p>
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm}>
          Export anyway
        </button>
      </div>
    </ModalShell>
  );
}
