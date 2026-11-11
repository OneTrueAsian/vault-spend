import { ModalShell } from "../../shared/ui/Modal";

export function ChooseExistingDataSourceDialog({
  onCancel,
  onDatabase,
  onPackage,
}: {
  onCancel: () => void;
  onDatabase: () => void;
  onPackage: () => void;
}) {
  return (
    <ModalShell title="Add an existing profile" onCancel={onCancel}>
      <p className="modal-message-secondary">Choose what you brought to this computer.</p>
      <div className="choice-card-list">
        <button type="button" className="choice-card" onClick={onDatabase}>
          <strong>Database file</strong>
          <span>An unprotected Vault Spend .db file</span>
        </button>
        <button type="button" className="choice-card" onClick={onPackage}>
          <strong>Protected package</strong>
          <span>A password-protected .vaultspend package folder</span>
        </button>
      </div>
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </ModalShell>
  );
}
