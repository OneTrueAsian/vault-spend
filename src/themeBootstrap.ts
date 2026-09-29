// The saved appearance lives in browser storage and is normally applied by App once it mounts. The
// launch error screen appears before that, so it applies the same saved values itself, with the same
// rules: "system" (light/dark) and "classic" (style) mean no attribute at all.
export const THEME_STORAGE_KEY = "meadow-theme";
export const THEME_STYLE_STORAGE_KEY = "meadow-theme-style";

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
  if (style && style !== "classic") root.setAttribute("data-palette", style);
  else root.removeAttribute("data-palette");
}
