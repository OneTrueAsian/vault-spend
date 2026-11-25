import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseModeUntil } from "./themeMode.mjs";

// A fake page: the theme changes on the Nth click of the mode button (Infinity = never).
function fakePage({ appliedOnClick }) {
  const state = { clicks: 0 };
  const browser = {
    execute: async () => (state.clicks >= appliedOnClick ? "dark" : "light"),
    waitUntil: async (condition, { timeoutMsg }) => {
      for (let i = 0; i < 20; i++) if (await condition()) return true;
      throw new Error(timeoutMsg);
    },
    // waitUntilOrDiagnose calls this to describe the page when a wait runs out.
    getTitle: async () => "fake",
    getUrl: async () => "fake://",
  };
  return { state, browser, chooseMode: async () => { state.clicks++; } };
}

afterEach(() => vi.restoreAllMocks());

describe("chooseModeUntil", () => {
  it("always clicks once, even when the theme already matches", async () => {
    const page = fakePage({ appliedOnClick: 0 });
    await chooseModeUntil(page.browser, page.chooseMode, "Dark", "dark");
    expect(page.state.clicks).toBe(1);
  });
  it("clicks once when the click registers", async () => {
    const page = fakePage({ appliedOnClick: 1 });
    await chooseModeUntil(page.browser, page.chooseMode, "Dark", "dark");
    expect(page.state.clicks).toBe(1);
  });
  it("clicks again only while the theme differs, and stops once it is applied", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const page = fakePage({ appliedOnClick: 3 });
    await chooseModeUntil(page.browser, page.chooseMode, "Dark", "dark");
    expect(page.state.clicks).toBe(3);
  });
  it("reports the repeat clicks", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const page = fakePage({ appliedOnClick: 3 });
    await chooseModeUntil(page.browser, page.chooseMode, "Dark", "dark");
    expect(log).toHaveBeenCalledWith("[harness] action repeated 2x: choose Dark in the sidebar");
  });
  it("fails with the label when the theme never applies", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const page = fakePage({ appliedOnClick: Infinity });
    await expect(chooseModeUntil(page.browser, page.chooseMode, "Dark", "dark")).rejects.toThrow("Dark should apply from the sidebar");
  });
});
