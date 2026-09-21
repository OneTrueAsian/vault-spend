import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { LaunchErrorScreen } from "./LaunchErrorScreen";
import { getStartupState, startupFailure, type StartupState } from "./startup";
import { applyStoredTheme } from "./themeBootstrap";

// Asks the backend where startup stands before the app mounts: nothing until it answers, the app when
// a profile is open, the launch error screen when none is. Phase C adds the selector and lock screen here.
export function StartupGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StartupState | null>(null);

  useLayoutEffect(() => {
    applyStoredTheme();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getStartupState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((e) => {
        if (!cancelled) setState({ status: "error", error: startupFailure(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === null) return null;
  if (state.status === "error") return <LaunchErrorScreen error={state.error} onResolved={setState} />;
  return <>{children}</>;
}
