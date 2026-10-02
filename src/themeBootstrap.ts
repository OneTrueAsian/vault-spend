// The saved appearance lives in browser storage and is normally applied by App once it mounts. The
// launch error screen appears before that, so it applies the same saved values itself, with the same
// rules: "system" (light/dark) means no attribute, and the style always goes on as data-palette.
export const THEME_STORAGE_KEY = "meadow-theme";
export const THEME_STYLE_STORAGE_KEY = "meadow-theme-style";

import type { ThemeStyle } from "./types";

const THEME_STYLES: readonly ThemeStyle[] = ["transparent", "futuristic", "retro"];

/** The saved style, or the Default look ("transparent") for the retired Slate style ("classic"),
 * nothing saved, or anything unknown. */
export function readThemeStyle(stored: string | null): ThemeStyle {
  return THEME_STYLES.find((s) => s === stored) ?? "transparent";
}

export function applyStoredTheme(root: HTMLElement = document.documentElement): void {
  let theme: string | null = null;
  let style: string | null = null;
  try {
    theme = localStorage.getItem(THEME_STORAGE_KEY);
    style = localStorage.getItem(THEME_STYLE_STORAGE_KEY);
  } catch {
    // per-viewer preference only — fine to skip if storage is unavailable
  }
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  root.setAttribute("data-palette", readThemeStyle(style));
}
