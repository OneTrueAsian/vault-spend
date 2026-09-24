import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { EmptyRegistryScreen } from "./EmptyRegistryScreen";
import { LaunchErrorScreen } from "./LaunchErrorScreen";
import { ProfileLockScreen } from "./ProfileLockScreen";
import { ProfileSelector } from "./ProfileSelector";
import { getStartupState, startupFailure, type StartupState } from "./startup";
import { applyStoredTheme } from "./themeBootstrap";
import { AutoLockSession } from "./AutoLockSession";

// Asks the backend where startup stands before the app mounts: nothing until it answers, the app when
// a profile is open, the launch error screen when none is. Also subscribes to the backend's
// profile-lock-state-changed event (a manual lock/unlock/select that happens elsewhere in the running
// app, not during this initial fetch) *before* firing the fetch — waiting for listen()'s own returned
// promise to resolve, since that is the actual point the subscription is live under Tauri's real async
// event plumbing, not the synchronous call to listen() itself. An event that arrives while the fetch
// is still in flight wins over that fetch's now-stale answer.
export function StartupGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StartupState | null>(null);

  useLayoutEffect(() => {
    applyStoredTheme();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let sawEvent = false;
    const unlistenPromise = listen<StartupState>("profile-lock-state-changed", (event) => {
      sawEvent = true;
      if (!cancelled) setState(event.payload);
    });
    unlistenPromise.then(() =>
      getStartupState()
        .then((next) => {
          if (!cancelled && !sawEvent) setState(next);
        })
        .catch((e) => {
          if (!cancelled && !sawEvent) setState({ status: "error", error: startupFailure(e) });
        }),
    );
    return () => {
      cancelled = true;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  if (state === null) return null;
  if (state.status === "error") return <LaunchErrorScreen error={state.error} onResolved={setState} />;
  if (state.status === "selector") return <ProfileSelector profiles={state.profiles} lastUsedId={state.last_used_id} onResolved={setState} />;
  if (state.status === "locked") return <ProfileLockScreen profileId={state.profile_id} profileName={state.profile_name} onResolved={setState} />;
  if (state.status === "empty_registry") return <EmptyRegistryScreen onResolved={setState} />;
  return (
    <>
      <AutoLockSession />
      {children}
    </>
  );
}
