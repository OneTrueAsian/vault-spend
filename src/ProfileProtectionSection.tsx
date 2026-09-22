import { useState } from "react";
import { ProtectionSetupDialog } from "./ProtectionSetupDialog";
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
      {!active.is_password_protected && (
        <button type="button" className="modal-secondary" onClick={() => void openSetup()}>
          Turn on password protection…
        </button>
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
    </div>
  );
}
