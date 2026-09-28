import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  const broadcasts = useRef(0);
  const mounted = useRef(true);

  useLayoutEffect(() => {
    applyStoredTheme();
  }, []);

  // A screen resolves a transition (an unlock, a retry, a select) with the command's return value. When
  // that value says the profile is open, the backend may already have locked it again — an automatic lock
  // (focus loss, tray, Windows lock) can land right after the open, and its broadcast can reach this page
  // BEFORE the older return value does. Applying the older "open" over the newer "locked" left the app on
  // screen over a locked profile, with every command refused. So after applying an open result, ask the
  // backend once more and take its answer if it is anything else — unless a newer broadcast has arrived
  // since, which is then the freshest word there is.
  const resolve = useCallback((next: StartupState) => {
    setState(next);
    if (next.status !== "open") return;
    const seen = broadcasts.current;
    getStartupState()
      .then((fresh) => {
        if (mounted.current && broadcasts.current === seen && fresh.status !== "open") setState(fresh);
      })
      .catch(() => {
        /* the open result stands; a real change will come as a broadcast */
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let sawEvent = false;
    const unlistenPromise = listen<StartupState>("profile-lock-state-changed", (event) => {
      sawEvent = true;
      broadcasts.current++;
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
      mounted.current = false;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  if (state === null) return null;
  if (state.status === "error") return <LaunchErrorScreen error={state.error} onResolved={resolve} />;
  if (state.status === "selector") return <ProfileSelector profiles={state.profiles} lastUsedId={state.last_used_id} onResolved={resolve} />;
  if (state.status === "locked") return <ProfileLockScreen profileId={state.profile_id} profileName={state.profile_name} onResolved={resolve} />;
  if (state.status === "empty_registry") return <EmptyRegistryScreen onResolved={resolve} />;
  return (
    <>
      <AutoLockSession />
      {children}
    </>
  );
}
