import { invoke } from "@tauri-apps/api/core";

export type AutoLockSettings = {
  inactivity_minutes: 0 | 1 | 5 | 15 | 30 | 60;
  lock_when_hidden: boolean;
  lock_on_focus_loss: boolean;
  lock_on_system_event: boolean;
  system_event_supported: boolean;
};

export type SavedAutoLockSettings = Omit<AutoLockSettings, "system_event_supported">;

export const getAutoLockSettings = () => invoke<AutoLockSettings>("get_auto_lock_settings");

export const setAutoLockSettings = (settings: SavedAutoLockSettings, expectedGeneration: number) =>
  invoke<void>("set_auto_lock_settings", { settings, expectedGeneration });

export type AutoLockReason = "inactivity";

export type AutoLockCountdownPayload = {
  profile_id: string;
  generation: number;
  seconds: number;
  reason: AutoLockReason;
};

export type AutoLockCountdownIdentity = Pick<AutoLockCountdownPayload, "profile_id" | "generation">;

export const getCurrentGeneration = () => invoke<number>("get_current_generation");

export const recordTrustedActivity = (expectedGeneration: number) =>
  invoke<void>("record_trusted_activity", { expectedGeneration });

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
const REPORT_INTERVAL_MS = 15_000;

type ActivityReporterOptions = {
  target?: EventTarget;
  isTrusted?: (event: Event) => boolean;
  intervalMs?: number;
};

/** Reports real user input with a leading/trailing throttle. Window focus is an intentional
 * exception: it reports immediately so returning to Vault Spend always resets the backend clock. */
export function installTrustedActivityReporter(
  report: () => void | Promise<void>,
  options: ActivityReporterOptions = {},
) {
  const target = options.target ?? window;
  const isTrusted = options.isTrusted ?? ((event: Event) => event.isTrusted);
  const intervalMs = options.intervalMs ?? REPORT_INTERVAL_MS;
  let lastReportedAt: number | null = null;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const send = () => {
    if (disposed) return;
    if (trailingTimer !== null) clearTimeout(trailingTimer);
    trailingTimer = null;
    lastReportedAt = Date.now();
    Promise.resolve(report()).catch(() => {
      // Activity is best effort. A stale/locked session is handled by StartupGate's state event.
    });
  };

  const onActivity = (event: Event) => {
    if (!isTrusted(event)) return;
    const elapsed = lastReportedAt === null ? intervalMs : Date.now() - lastReportedAt;
    if (elapsed >= intervalMs) {
      send();
    } else if (trailingTimer === null) {
      trailingTimer = setTimeout(send, intervalMs - elapsed);
    }
  };

  const onFocus = (event: Event) => {
    if (isTrusted(event)) send();
  };

  for (const name of ACTIVITY_EVENTS) target.addEventListener(name, onActivity);
  target.addEventListener("focus", onFocus);

  return () => {
    disposed = true;
    if (trailingTimer !== null) clearTimeout(trailingTimer);
    trailingTimer = null;
    for (const name of ACTIVITY_EVENTS) target.removeEventListener(name, onActivity);
    target.removeEventListener("focus", onFocus);
  };
}
