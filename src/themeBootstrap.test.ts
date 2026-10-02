// @vitest-environment jsdom
//
// The launch error screen appears before the app has mounted, so it has to put the saved appearance
// on the page itself. These are the same keys and the same rules the app uses.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_APPEARANCE_PREFS,
  INTENSITY_STORAGE_KEY,
  MOTION_STORAGE_KEY,
  THEME_STORAGE_KEY,
  THEME_STYLE_STORAGE_KEY,
  applyAppearancePrefs,
  applyStoredTheme,
  readAppearancePrefs,
  readThemeStyle,
  saveAppearancePrefs,
} from "./themeBootstrap";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-palette");
  vi.restoreAllMocks();
});

describe("applyStoredTheme", () => {
  it("puts the saved light or dark mode and style on the page", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    localStorage.setItem(THEME_STYLE_STORAGE_KEY, "transparent");

    applyStoredTheme();

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-palette")).toBe("transparent");
  });

  it("puts the saved Retro style on the page before the app has mounted", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    localStorage.setItem(THEME_STYLE_STORAGE_KEY, "retro");

    applyStoredTheme();

    expect(document.documentElement.getAttribute("data-palette")).toBe("retro");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("leaves the system mode as no attribute, the way the app does", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem(THEME_STORAGE_KEY, "system");

    applyStoredTheme();

    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("shows the Default look for the retired Slate style, for nothing saved, and for anything unknown", () => {
    for (const saved of ["classic", null, "aurora"]) {
      document.documentElement.setAttribute("data-palette", "futuristic");
      if (saved === null) localStorage.removeItem(THEME_STYLE_STORAGE_KEY);
      else localStorage.setItem(THEME_STYLE_STORAGE_KEY, saved);

      applyStoredTheme();

      expect(document.documentElement.getAttribute("data-palette"), `saved: ${saved}`).toBe("transparent");
    }
  });

  it("does nothing harmful when nothing is saved or storage is unavailable", () => {
    expect(() => applyStoredTheme()).not.toThrow();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => applyStoredTheme()).not.toThrow();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("reads a saved style, mapping the retired Slate style and anything unknown to Default", () => {
    expect(readThemeStyle("futuristic")).toBe("futuristic");
    expect(readThemeStyle("retro")).toBe("retro");
    expect(readThemeStyle("transparent")).toBe("transparent");
    expect(readThemeStyle("classic")).toBe("transparent");
    expect(readThemeStyle(null)).toBe("transparent");
    expect(readThemeStyle("aurora")).toBe("transparent");
  });

  it("keeps the storage keys the app has always used, so nobody's saved appearance is lost", () => {
    expect(THEME_STORAGE_KEY).toBe("meadow-theme");
    expect(THEME_STYLE_STORAGE_KEY).toBe("meadow-theme-style");
  });
});

// Futuristic's accent and glow, and the app-wide Reduce motion choice. Per viewer, kept in browser
// storage like the style itself, and put on the page before the first frame so nothing flashes.
describe("appearance preferences", () => {
  const stored = (values: Record<string, string>) => (key: string) => values[key] ?? null;

  it("defaults to Ion Cyan, glow 70 and the app's normal motion", () => {
    expect(DEFAULT_APPEARANCE_PREFS).toEqual({ accent: "cyan", intensity: 70, reduceMotion: false });
    expect(readAppearancePrefs(stored({}))).toEqual(DEFAULT_APPEARANCE_PREFS);
  });

  it("reads each saved choice", () => {
    const prefs = readAppearancePrefs(
      stored({ [ACCENT_STORAGE_KEY]: "violet", [INTENSITY_STORAGE_KEY]: "0", [MOTION_STORAGE_KEY]: "on" }),
    );
    expect(prefs).toEqual({ accent: "violet", intensity: 0, reduceMotion: true });
    expect(readAppearancePrefs(stored({ [ACCENT_STORAGE_KEY]: "pink", [INTENSITY_STORAGE_KEY]: "100" }))).toEqual({
      accent: "pink",
      intensity: 100,
      reduceMotion: false,
    });
  });

  it("falls back to the default for anything it does not recognise", () => {
    for (const accent of ["magenta", "CYAN", "", " cyan"]) {
      expect(readAppearancePrefs(stored({ [ACCENT_STORAGE_KEY]: accent })).accent, accent).toBe("cyan");
    }
    for (const intensity of ["101", "-1", "abc", "", "55.5", "1e2", " 50"]) {
      expect(readAppearancePrefs(stored({ [INTENSITY_STORAGE_KEY]: intensity })).intensity, intensity).toBe(70);
    }
    for (const motion of ["off", "true", "1", ""]) {
      expect(readAppearancePrefs(stored({ [MOTION_STORAGE_KEY]: motion })).reduceMotion, motion).toBe(false);
    }
  });

  it("puts the choices on the page: accent and motion as attributes, glow as a 0-1 number", () => {
    const root = document.documentElement;
    applyAppearancePrefs({ accent: "pink", intensity: 35, reduceMotion: true }, root);
    expect(root.getAttribute("data-accent")).toBe("pink");
    expect(root.getAttribute("data-motion")).toBe("reduced");
    expect(root.style.getPropertyValue("--neon-glow")).toBe("0.35");

    applyAppearancePrefs(DEFAULT_APPEARANCE_PREFS, root);
    expect(root.getAttribute("data-accent")).toBe("cyan");
    expect(root.hasAttribute("data-motion")).toBe(false);
    expect(root.style.getPropertyValue("--neon-glow")).toBe("0.7");
  });

  it("saves the choices under their own keys and reads them back", () => {
    saveAppearancePrefs({ accent: "violet", intensity: 15, reduceMotion: true });
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("violet");
    expect(localStorage.getItem(INTENSITY_STORAGE_KEY)).toBe("15");
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBe("on");
    expect(readAppearancePrefs((k) => localStorage.getItem(k))).toEqual({ accent: "violet", intensity: 15, reduceMotion: true });

    saveAppearancePrefs(DEFAULT_APPEARANCE_PREFS);
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveAppearancePrefs({ accent: "pink", intensity: 10, reduceMotion: true })).not.toThrow();
  });

  it("applies the saved choices together with the style before the app has mounted", () => {
    localStorage.setItem(THEME_STYLE_STORAGE_KEY, "futuristic");
    localStorage.setItem(ACCENT_STORAGE_KEY, "violet");
    localStorage.setItem(INTENSITY_STORAGE_KEY, "0");
    localStorage.setItem(MOTION_STORAGE_KEY, "on");

    applyStoredTheme();

    const root = document.documentElement;
    expect(root.getAttribute("data-palette")).toBe("futuristic");
    expect(root.getAttribute("data-accent")).toBe("violet");
    expect(root.style.getPropertyValue("--neon-glow")).toBe("0");
    expect(root.getAttribute("data-motion")).toBe("reduced");
  });

  it("applies the defaults when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    applyStoredTheme();
    expect(document.documentElement.getAttribute("data-accent")).toBe("cyan");
    expect(document.documentElement.style.getPropertyValue("--neon-glow")).toBe("0.7");
  });
});
