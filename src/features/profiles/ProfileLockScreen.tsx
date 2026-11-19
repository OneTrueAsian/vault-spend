import "./ProfileAccess.css";
import { useEffect, useRef, useState } from "react";
import { invokeProfile } from "../../shared/native/profileIpc";
import { PasswordForm } from "../../shared/ui/PasswordForm";
import { RecoverProfileDialog } from "./RecoverProfileDialog";
import { getCurrentGeneration } from "../../shared/lib/profileUiState";
import { showProfileSelector, unlockProfile } from "../../shared/lib/protection";
import { useAutoCancelDelete } from "../../shared/hooks/useAutoCancelDelete";
import { getStartupState, type StartupState } from "../../shared/lib/startup";

/** Shown instead of the app when the runtime holds a locked profile. Reuses `LaunchErrorScreen`'s
 * card shell — this is the same shape of thing, a full-screen gate. */
export function ProfileLockScreen({
  profileId,
  profileName,
  notice,
  onResolved,
}: {
  profileId: string;
  profileName: string;
  notice?: string;
  onResolved: (next: StartupState) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [recoveryGeneration, setRecoveryGeneration] = useState<number | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  useAutoCancelDelete(confirmingRemove, () => setConfirmingRemove(false));

  useEffect(() => {
    headingRef.current?.focus();
  }, [profileId]);

  async function switchProfile() {
    onResolved(await showProfileSelector());
  }

  async function removeFromList() {
    setConfirmingRemove(false);
    await invokeProfile("delete_profile", { id: profileId });
    onResolved(await showProfileSelector());
  }

  return (
    <main className="profile-gate" data-profile-lock-screen>
      <div className="profile-gate-card">
        <h1 ref={headingRef} tabIndex={-1}>
          {profileName} is locked
        </h1>
        {notice && (
          <p className="profile-gate-notice" role="status" data-gate-notice>
            {notice}
          </p>
        )}
        <p className="profile-gate-subtitle">Enter your password to continue.</p>
        <PasswordForm submitLabel="Unlock" onSubmit={async (password) => onResolved(await unlockProfile(profileId, password))} />
        <button
          type="button"
          className="modal-secondary profile-gate-forgot"
          data-forgot-password
          onClick={() => void getCurrentGeneration().then(setRecoveryGeneration)}
        >
          Forgot your password?
        </button>
        <button type="button" className="modal-secondary profile-gate-switch" data-switch-profile onClick={switchProfile}>
          Switch profile
        </button>
        {confirmingRemove ? (
          <div className="row-delete-confirm profile-gate-remove-confirm">
            <p className="modal-message modal-message-secondary">
              {profileName}&apos;s files will stay on disk but can&apos;t be opened without the password or recovery key.
            </p>
            <span className="profile-card-actions">
              <button type="button" className="modal-secondary btn-sm" data-cancel-remove-profile onClick={() => setConfirmingRemove(false)}>
                Cancel
              </button>
              <button type="button" className="btn-danger btn-sm" data-confirm-remove-profile onClick={removeFromList}>
                Remove profile
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="modal-secondary profile-gate-forgot-remove"
            data-forgot-remove-profile
            onClick={() => setConfirmingRemove(true)}
          >
            Forgot the password? Remove this profile from the list
          </button>
        )}
      </div>
      {recoveryGeneration !== null && (
        <RecoverProfileDialog
          profileId={profileId}
          expectedGeneration={recoveryGeneration}
          onDone={() => {
            setRecoveryGeneration(null);
            // Usually open; still locked, with a notice, when the new password was saved but the
            // profile couldn't be reopened. commitRecovery returns the recovery code, not the state.
            void getStartupState().then(onResolved);
          }}
          onCancel={() => setRecoveryGeneration(null)}
        />
      )}
    </main>
  );
}
