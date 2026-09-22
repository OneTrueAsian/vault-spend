import { useEffect, useRef } from "react";
import { PasswordForm } from "./PasswordForm";
import { showProfileSelector, unlockProfile } from "./protection";
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

  useEffect(() => {
    headingRef.current?.focus();
  }, [profileId]);

  async function switchProfile() {
    onResolved(await showProfileSelector());
  }

  return (
    <main className="launch-error" data-profile-lock-screen>
      <div className="launch-error-card">
        <h1 ref={headingRef} tabIndex={-1}>
          {profileName} is locked
        </h1>
        <PasswordForm submitLabel="Unlock" onSubmit={async (password) => onResolved(await unlockProfile(profileId, password))} />
        <button type="button" data-switch-profile onClick={switchProfile}>
          Switch profile
        </button>
      </div>
    </main>
  );
}
