// @vitest-environment jsdom
//
// The launch error screen appears before the app has mounted, so it has to put the saved appearance
// on the page itself. These are the same keys and the same rules the app uses.
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, THEME_STYLE_STORAGE_KEY, applyStoredTheme } from "./themeBootstrap";

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

  it("leaves the system mode and the classic style as no attribute, the way the app does", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-palette", "futuristic");
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    localStorage.setItem(THEME_STYLE_STORAGE_KEY, "classic");

    applyStoredTheme();

    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(document.documentElement.hasAttribute("data-palette")).toBe(false);
  });

  it("does nothing harmful when nothing is saved or storage is unavailable", () => {
    expect(() => applyStoredTheme()).not.toThrow();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => applyStoredTheme()).not.toThrow();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("keeps the storage keys the app has always used, so nobody's saved appearance is lost", () => {
    expect(THEME_STORAGE_KEY).toBe("meadow-theme");
    expect(THEME_STYLE_STORAGE_KEY).toBe("meadow-theme-style");
  });
});
