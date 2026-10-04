import "./ProfileAccess.css";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PasswordForm } from "./PasswordForm";
import { RecoverProfileDialog } from "./RecoverProfileDialog";
import { getCurrentGeneration } from "./profileUiState";
import { showProfileSelector, unlockProfile } from "./protection";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import type { StartupState } from "./startup";

/** Shown instead of the app when the runtime holds a locked profile. Reuses `LaunchErrorScreen`'s
 * card shell — this is the same shape of thing, a full-screen gate. */
export function ProfileLockScreen({
  profileId,
  profileName,
  onResolved,
}: {
  profileId: string;
  profileName: string;
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
    await invoke("delete_profile", { id: profileId });
    onResolved(await showProfileSelector());
  }

  return (
    <main className="profile-gate" data-profile-lock-screen>
      <div className="profile-gate-card">
        <h1 ref={headingRef} tabIndex={-1}>
          {profileName} is locked
        </h1>
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
            // commit_recovery only ever succeeds by hot-swapping to the newly-recovered profile —
            // the same guarantee unlock_profile's own Ok(StartupState::Open) return codifies, just
            // not threaded back through commitRecovery's return value (that's the one-time recovery
            // code, checked above against what the dialog displayed).
            onResolved({ status: "open" });
          }}
          onCancel={() => setRecoveryGeneration(null)}
        />
      )}
    </main>
  );
}
