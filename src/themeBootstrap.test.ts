// @vitest-environment jsdom
//
// The launch error screen appears before the app has mounted, so it has to put the saved appearance
// on the page itself. These are the same keys and the same rules the app uses.
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, THEME_STYLE_STORAGE_KEY, applyStoredTheme, readThemeStyle } from "./themeBootstrap";

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
