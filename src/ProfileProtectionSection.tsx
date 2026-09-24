import { useState } from "react";
import { ProtectionSetupDialog } from "./ProtectionSetupDialog";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { RegenerateRecoveryDialog } from "./RegenerateRecoveryDialog";
import { RemoveProtectionDialog } from "./RemoveProtectionDialog";
import { AutoLockSettings } from "./AutoLockSettings";
import { getCurrentGeneration } from "./profileUiState";
import type { Profile } from "./types";

/** The Profile section's password-protection status and entry point into `ProtectionSetupDialog` —
 * mounted once in `SettingsView` for whichever profile is currently active. Once the dialog reports
 * success, `onProtected` refreshes the `profiles` list (not a full data-file reload): `enable_
 * profile_protection` re-encrypts the exact same rows, so everything already fetched from them stays
 * valid — only the `is_password_protected` flag this section itself reads is actually stale. */
export function ProfileProtectionSection({
  profiles,
  onProtected,
}: {
  profiles: Profile[];
  onProtected: () => void;
}) {
  const [dialogGeneration, setDialogGeneration] = useState<number | null>(null);
  const [changeGeneration, setChangeGeneration] = useState<number | null>(null);
  const [regenerateGeneration, setRegenerateGeneration] = useState<number | null>(null);
  const [removeGeneration, setRemoveGeneration] = useState<number | null>(null);
  const active = profiles.find((p) => p.is_active);

  if (!active) return null;

  async function openSetup() {
    setDialogGeneration(await getCurrentGeneration());
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Password protection</span>
      </div>
      <p className="modal-message-secondary">
        Password protection: {active.is_password_protected ? "On" : "Off"}
      </p>
      <AutoLockSettings enabled={active.is_password_protected} />
      {!active.is_password_protected && (
        <button type="button" className="modal-secondary" onClick={() => void openSetup()}>
          Turn on password protection…
        </button>
      )}
      {active.is_password_protected && (
        <div className="button-row">
          <button type="button" className="modal-secondary" onClick={() => void getCurrentGeneration().then(setChangeGeneration)}>
            Change password…
          </button>
          <button type="button" className="modal-secondary" onClick={() => void getCurrentGeneration().then(setRegenerateGeneration)}>
            Regenerate recovery key…
          </button>
          <button type="button" className="modal-secondary" onClick={() => void getCurrentGeneration().then(setRemoveGeneration)}>
            Remove protection…
          </button>
        </div>
      )}
      {dialogGeneration !== null && (
        <ProtectionSetupDialog
          targetProfileId={active.id}
          newProfileName={null}
          expectedGeneration={dialogGeneration}
          onDone={() => {
            setDialogGeneration(null);
            onProtected();
          }}
          onCancel={() => setDialogGeneration(null)}
        />
      )}
      {changeGeneration !== null && (
        <ChangePasswordDialog
          expectedGeneration={changeGeneration}
          onDone={() => {
            setChangeGeneration(null);
            onProtected();
          }}
          onCancel={() => setChangeGeneration(null)}
        />
      )}
      {regenerateGeneration !== null && (
        <RegenerateRecoveryDialog
          expectedGeneration={regenerateGeneration}
          onDone={() => {
            setRegenerateGeneration(null);
            onProtected();
          }}
          onCancel={() => setRegenerateGeneration(null)}
        />
      )}
      {removeGeneration !== null && (
        <RemoveProtectionDialog expectedGeneration={removeGeneration} onDone={() => { setRemoveGeneration(null); onProtected(); }} onCancel={() => setRemoveGeneration(null)} />
      )}
    </div>
  );
}
