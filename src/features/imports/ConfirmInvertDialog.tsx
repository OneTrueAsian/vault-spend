import { type ImportSignSuggestion } from "../../shared/lib/importSigns";
import { ModalShell } from "../../shared/ui/Modal";

/** `suggestion` (see `importSignSuggestion`) preselects an answer — the primary, focused button — and says
 * why; with none, Flip stays the primary button as it always was. Either answer can still be chosen. */
export function ConfirmInvertDialog({
  onCancel,
  onConfirm,
  accountName,
  suggestion,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  accountName?: string;
  suggestion?: ImportSignSuggestion;
}) {
  const flip = suggestion?.flip ?? null;
  const hint =
    suggestion?.reason === "remembered"
      ? `Last import into ${accountName}: ${flip ? "flipped the signs" : "kept as-is"}.`
      : suggestion?.reason === "credit-positive"
        ? "Most amounts in this file are positive. For a credit card that usually means charges are shown as positive."
        : null;
  const keepIsPrimary = flip === false;
  return (
    <ModalShell title="Which way do the amounts go?" onCancel={onCancel}>
      <p className="modal-message">
        Does this file show charges as positive amounts, like a credit card
        statement (with payments shown as negative)?
      </p>
      <p className="modal-message modal-message-secondary">
        Choose "Flip the signs" to match the rest of your transactions, where money
        out is a minus amount. Choose "Keep as-is" if the file already shows money
        out as minus — most bank and checking files do.
      </p>
      {hint && (
        <p className="modal-message" data-import-sign-hint>
          {hint}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className={keepIsPrimary ? undefined : "modal-secondary"} onClick={onCancel} autoFocus={flip === false}>
          Keep as-is
        </button>
        <button type="button" className={keepIsPrimary ? "modal-secondary" : undefined} onClick={onConfirm} autoFocus={flip === true}>
          Flip the signs
        </button>
      </div>
    </ModalShell>
  );
}
