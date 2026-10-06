import { useEffect, useState } from "react";
import type { Theme } from "./appTypes";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Light or dark as actually shown: an explicit choice, or the system's when System is chosen. */
export function resolveTheme(theme: Theme, systemPrefersDark: boolean): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  return systemPrefersDark ? "dark" : "light";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

/** `resolveTheme` for the current system setting, updated when the system switches while System is
 * chosen. (App sets `data-theme` only for an explicit choice; CSS follows the system otherwise.) */
export function useResolvedTheme(theme: Theme): "light" | "dark" {
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (e: { matches: boolean }) => setPrefersDark(e.matches);
    setPrefersDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return resolveTheme(theme, prefersDark);
}
