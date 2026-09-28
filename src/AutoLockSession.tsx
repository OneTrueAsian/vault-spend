import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getCurrentGeneration,
  installTrustedActivityReporter,
  recordTrustedActivity,
  type AutoLockCountdownIdentity,
  type AutoLockCountdownPayload,
} from "./autoLock";
import "./AutoLockSession.css";

type VisibleCountdown = AutoLockCountdownPayload & { receivedAt: number };

export function AutoLockSession() {
  const [countdown, setCountdown] = useState<VisibleCountdown | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [stayingUnlocked, setStayingUnlocked] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let cleanupActivity = () => {};
    const unlistenWarning = listen<AutoLockCountdownPayload>("profile-lock-countdown", ({ payload }) => {
      if (disposed) return;
      setError("");
      setSeconds(payload.seconds);
      setCountdown({ ...payload, receivedAt: Date.now() });
    });
    const unlistenCancellation = listen<AutoLockCountdownIdentity>("profile-lock-countdown-cancelled", ({ payload }) => {
      if (disposed) return;
      setCountdown((current) =>
        current?.profile_id === payload.profile_id && current.generation === payload.generation ? null : current,
      );
    });

    getCurrentGeneration()
      .then((generation) => {
        if (!disposed) {
          cleanupActivity = installTrustedActivityReporter(() => recordTrustedActivity(generation));
        }
      })
      .catch(() => {
        // StartupGate owns session availability. A failed generation read has no safe value to send.
      });

    return () => {
      disposed = true;
      cleanupActivity();
      unlistenWarning.then((unlisten) => unlisten());
      unlistenCancellation.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!countdown) return;
    const update = () => {
      const elapsed = Math.floor((Date.now() - countdown.receivedAt) / 1_000);
      setSeconds(Math.max(0, countdown.seconds - elapsed));
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [countdown]);

  if (!countdown) return null;

  async function stayUnlocked() {
    if (!countdown || stayingUnlocked) return;
    setStayingUnlocked(true);
    setError("");
    const identity = countdown;
    try {
      await recordTrustedActivity(countdown.generation);
      setCountdown((current) =>
        current?.profile_id === identity.profile_id && current.generation === identity.generation ? null : current,
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setStayingUnlocked(false);
    }
  }

  return (
    <div
      className="status status-info auto-lock-countdown"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-auto-lock-countdown
    >
      <svg className="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span className="status-text">
        Vault Spend will lock in {seconds} {seconds === 1 ? "second" : "seconds"} due to inactivity.
        {error && <span className="auto-lock-countdown-error"> Couldn’t keep this session unlocked: {error}</span>}
      </span>
      <button type="button" className="status-action" data-stay-unlocked disabled={stayingUnlocked} onClick={() => void stayUnlocked()}>
        {stayingUnlocked ? "Keeping unlocked…" : "Stay unlocked"}
      </button>
    </div>
  );
}
