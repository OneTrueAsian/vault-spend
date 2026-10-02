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
  applyAppearancePrefs(readStoredAppearancePrefs(), root);
}

// Futuristic's accent and glow strength, and the app-wide Reduce motion choice. They stay saved while
// another style is in use; the CSS only reads data-accent and --neon-glow under data-palette="futuristic".
export const ACCENT_STORAGE_KEY = "meadow-futuristic-accent";
export const INTENSITY_STORAGE_KEY = "meadow-futuristic-intensity";
export const MOTION_STORAGE_KEY = "meadow-reduce-motion";

export type NeonAccent = "cyan" | "pink" | "violet";
export type AppearancePrefs = { accent: NeonAccent; intensity: number; reduceMotion: boolean };

const ACCENTS: readonly NeonAccent[] = ["cyan", "pink", "violet"];
export const DEFAULT_APPEARANCE_PREFS: AppearancePrefs = { accent: "cyan", intensity: 70, reduceMotion: false };

/** Reads the saved choices through `get`; anything missing or unrecognised gets its default. */
export function readAppearancePrefs(get: (key: string) => string | null): AppearancePrefs {
  const accent = ACCENTS.find((a) => a === get(ACCENT_STORAGE_KEY)) ?? DEFAULT_APPEARANCE_PREFS.accent;
  const rawIntensity = get(INTENSITY_STORAGE_KEY);
  const intensity =
    rawIntensity !== null && /^\d{1,3}$/.test(rawIntensity) && Number(rawIntensity) <= 100
      ? Number(rawIntensity)
      : DEFAULT_APPEARANCE_PREFS.intensity;
  return { accent, intensity, reduceMotion: get(MOTION_STORAGE_KEY) === "on" };
}

export function readStoredAppearancePrefs(): AppearancePrefs {
  try {
    return readAppearancePrefs((key) => localStorage.getItem(key));
  } catch {
    return DEFAULT_APPEARANCE_PREFS;
  }
}

export function saveAppearancePrefs(prefs: AppearancePrefs): void {
  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, prefs.accent);
    localStorage.setItem(INTENSITY_STORAGE_KEY, String(prefs.intensity));
    if (prefs.reduceMotion) localStorage.setItem(MOTION_STORAGE_KEY, "on");
    else localStorage.removeItem(MOTION_STORAGE_KEY);
  } catch {
    // per-viewer preference only — fine to skip if storage is unavailable
  }
}

export function applyAppearancePrefs(prefs: AppearancePrefs, root: HTMLElement = document.documentElement): void {
  root.setAttribute("data-accent", prefs.accent);
  root.style.setProperty("--neon-glow", String(prefs.intensity / 100));
  if (prefs.reduceMotion) root.setAttribute("data-motion", "reduced");
  else root.removeAttribute("data-motion");
}
