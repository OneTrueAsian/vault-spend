import { useState, FormEvent, useEffect } from "react";
import { cardAttr, SettingStar } from "../../shared/ui/SettingStar";
import { type Backup } from "../../shared/lib/types";
import { formatDisplayDateTime } from "../../shared/lib/format";
import { ModalShell } from "../../shared/ui/Modal";
import { PasswordForm } from "../../shared/ui/PasswordForm";
import { useCardFeedback, Feedback } from "../../shared/ui/CardFeedback";

/** "Also copy each backup to another folder" — so one dead disk can't take
 * the data and its backups together. Works with any folder, including a
 * cloud-synced one (OneDrive, Dropbox) or a USB drive. */
function BackupCopySection({
  copyDir,
  onSetCopyDir,
  onBrowse,
}: {
  copyDir: string | null;
  onSetCopyDir: (dir: string | null) => void;
  onBrowse: () => void;
}) {
  const [draft, setDraft] = useState("");
  const feedback = useCardFeedback("backup-copy");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    feedback.begin();
    onSetCopyDir(draft.trim());
  }

  // The typed folder stays until the app has accepted it (a refused folder keeps what was typed, so it can be fixed).
  useEffect(() => {
    setDraft("");
  }, [copyDir]);

  return (
    <div className="card" data-backup-copy {...cardAttr("backup-copy")}>
      <div className="card-head">
        <h2 className="reports-section-title">Second copy</h2>
        <SettingStar id="backup-copy" />
      </div>
      {copyDir ? (
        <>
          <p className="modal-message-secondary">
            Every backup is also copied to <strong data-backup-copy-dir>{copyDir}</strong>.
          </p>
          <div className="backup-copy-actions">
            <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onBrowse(); }}>
              Change folder
            </button>
            <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onSetCopyDir(null); }}>
              Stop copying
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="modal-message-secondary">
            Also keep a copy of each backup in another folder, like a cloud folder (OneDrive, Dropbox) or a USB drive.
            Then one failed disk can't take your data and its backups together.
          </p>
          <form className="backup-copy-form" onSubmit={handleSubmit}>
            <input
              className="text-input"
              aria-label="Second backup folder"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Folder path, e.g. D:\OneDrive\VaultSpend"
            />
            <button type="button" className="modal-secondary" onClick={() => { feedback.begin(); onBrowse(); }}>
              Browse
            </button>
            <button type="submit" disabled={!draft.trim()}>
              Start copying
            </button>
          </form>
        </>
      )}
      <Feedback text={feedback.text} kind={feedback.kind} />
    </div>
  );
}

/** The backup cards of the Data group: automatic backups, the second-copy folder and the backup history. */
export function BackupsBlock({
  backups,
  onCreateBackupNow,
  onRestoreBackup,
  copyDir,
  onSetCopyDir,
  onBrowseCopyDir,
  isProtected,
}: {
  backups: Backup[];
  onCreateBackupNow: () => void;
  onRestoreBackup: (filename: string, password?: string) => void | Promise<void>;
  copyDir: string | null;
  onSetCopyDir: (dir: string | null) => void;
  onBrowseCopyDir: () => void;
  isProtected: boolean;
}) {
  const feedback = useCardFeedback("backups");
  const [confirmingRestoreFilename, setConfirmingRestoreFilename] = useState<string | null>(null);
  const [passwordRestoreFilename, setPasswordRestoreFilename] = useState<string | null>(null);

  return (
    <>
      <div className="settings-pair">
      <div className="card" {...cardAttr("backups")}>
        <div className="card-head">
          <h2 className="reports-section-title">Automatic backups</h2>
          <SettingStar id="backups" />
        </div>
        <p className="modal-message-secondary">
          Vault Spend backs up once a day when you open it, keeping the most recent 15.
        </p>
        <div className="settings-action settings-action-result">
          <button type="button" onClick={() => { feedback.begin(); onCreateBackupNow(); }}>
            Back up now
          </button>
          <Feedback text={feedback.text} kind={feedback.kind} />
        </div>
      </div>
      <BackupCopySection copyDir={copyDir} onSetCopyDir={onSetCopyDir} onBrowse={onBrowseCopyDir} />
      </div>
      <div className="card" data-backups {...cardAttr("backup-history")}>
        <div className="card-head">
          <h2 className="reports-section-title">Backup history</h2>
          <SettingStar id="backup-history" />
        </div>
        <p className="modal-message-secondary">
          Restoring backs up your current data first, then reloads it. No restart needed.
        </p>
      <table className="ledger">
        <thead>
          <tr>
            <th>Created</th>
            <th className="amount-col">Size</th>
            <th className="actions-col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {backups.map((b) => confirmingRestoreFilename === b.filename ? (
            <tr key={b.filename}>
              {/* The confirmation takes the whole row: in the narrow actions cell it wrapped to a few characters a line on small windows. */}
              <td colSpan={3}>
                <div className="backup-restore-confirm">
                  <span className="backup-restore-warning" role="alert">Replace your current data with {b.filename}? Your current data will be backed up first.</span>
                  <span className="backup-restore-actions">
                    <button
                      type="button"
                      className="modal-secondary"
                      autoFocus
                      onClick={() => {
                        setConfirmingRestoreFilename(null);
                        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-restore-for="${b.filename}"]`)?.focus());
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingRestoreFilename(null);
                        if (isProtected) setPasswordRestoreFilename(b.filename);
                        else void onRestoreBackup(b.filename);
                      }}
                    >
                      Restore
                    </button>
                  </span>
                </div>
              </td>
            </tr>
          ) : (
            <tr key={b.filename}>
              <td className="date-cell">
                {formatDisplayDateTime(b.created_at)}
                <div className="backup-file-label">{b.filename}</div>
              </td>
              <td className="amount-col">{(b.size_bytes / 1024).toFixed(0)} KB</td>
              <td className="actions-col">
                <button type="button" className="modal-secondary" data-restore-for={b.filename} onClick={() => setConfirmingRestoreFilename(b.filename)}>
                  Restore
                </button>
              </td>
            </tr>
          ))}
          {backups.length === 0 && (
            <tr>
              <td colSpan={3} className="empty-state">
                No backups yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {passwordRestoreFilename && (
        <ModalShell title="Restore password-protected backup" onCancel={() => setPasswordRestoreFilename(null)}>
          <p className="modal-message-secondary">
            Enter the password that protected this backup when it was created. If you changed your password later,
            this may be your old password. Restoring also makes that password current again.
          </p>
          <PasswordForm
            submitLabel="Restore"
            onCancel={() => setPasswordRestoreFilename(null)}
            onSubmit={async (password) => {
              await onRestoreBackup(passwordRestoreFilename, password);
              setPasswordRestoreFilename(null);
            }}
          />
        </ModalShell>
      )}
      </div>
    </>
  );
}
