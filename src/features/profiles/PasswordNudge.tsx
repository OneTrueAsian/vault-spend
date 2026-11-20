import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentGeneration } from "../../shared/lib/autoLock";
import { passwordNudge } from "../../shared/lib/protection";

/** Shown after unlocking with a password shorter than the current minimum. The backend remembers
 * that for the one unlock only (never saved), so it is asked again whenever the open profile is
 * swapped: a password change, a recovery or a profile switch all end the nudge. */
export function PasswordNudge({ onChangePassword }: { onChangePassword: () => void }) {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let disposed = false;
    const refresh = () =>
      getCurrentGeneration()
        .then((generation) => passwordNudge(generation))
        .then((needed) => {
          if (!disposed) setShow(needed);
        })
        .catch(() => {
          if (!disposed) setShow(false);
        });
    void refresh();
    const unlisten = listen("profile-lock-state-changed", () => void refresh());
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop());
    };
  }, []);

  if (!show || dismissed) return null;
  return (
    <p className="status status-info" role="status">
      <svg className="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
      <span className="status-text">Your password is shorter than we now recommend. A longer one is much harder to guess.</span>
      <button type="button" className="status-action" onClick={onChangePassword}>
        Change password
      </button>
      <button type="button" className="status-action" onClick={() => setDismissed(true)}>
        Not now
      </button>
    </p>
  );
}
