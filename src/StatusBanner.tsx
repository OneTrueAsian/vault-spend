import type { StatusKind } from "./appTypes";

/** The one status line shared by every success confirmation, error, and
 * in-progress message in the app (~90+ call sites) — styled by `kind` so an
 * error doesn't look identical to a routine confirmation (see App.css's
 * `.status-*` rules), with its own dismiss button since errors stay up
 * longer than the auto-dismiss timer and a raw error string is worth being
 * able to clear once read. */
export function StatusBanner({
  text,
  kind,
  action,
  onDismiss,
}: {
  text: string;
  kind: StatusKind;
  /** An optional extra button (e.g. "Undo") next to the dismiss ×, as a
   * sibling — not nested inside it, so it's independently clickable/
   * focusable. Used by the Transactions tab's bulk-delete undo toast, which is its
   * own independent piece of state from `status` (see `undoToast` below)
   * precisely so a routine confirmation elsewhere can't clobber an active
   * undo window — both just render through this one shared component. */
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
}) {
  return (
    <p className={`status status-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <svg className="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {kind === "success" && <path d="M20 6 9 17l-5-5" />}
        {kind === "error" && <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>}
        {kind === "info" && <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>}
      </svg>
      <span className="status-text">{text}</span>
      {action && (
        <button type="button" className="status-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      <button type="button" className="status-dismiss" onClick={onDismiss} aria-label="Dismiss message">
        ×
      </button>
    </p>
  );
}
