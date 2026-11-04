import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { clickUntilShown } from "./clickUntilShown.mjs";

// A fake page: `shownAfterClicks` is how many clicks it takes before the expected element appears (Infinity = never).
function fakeBrowser({ shownAfterClicks, targetPresent = true }) {
  const state = { clicks: 0, shownChecks: 0 };
  const browser = {
    state,
    $: selector => ({
      isExisting: async () => {
        if (selector === "#shown") { state.shownChecks++; return state.clicks >= shownAfterClicks; }
        return targetPresent && state.clicks < shownAfterClicks;
      },
      click: async () => { state.clicks++; },
    }),
    waitUntil: async (condition, { timeout, timeoutMsg }) => {
      for (let i = 0; i < 20; i++) if (await condition()) return true;
      throw new Error(timeoutMsg ?? `timed out after ${timeout}ms`);
    },
  };
  return browser;
}

describe("clickUntilShown", () => {
  it("clicks once when the click registers", async () => {
    const b = fakeBrowser({ shownAfterClicks: 1 });
    await clickUntilShown(b, "#target", "#shown");
    expect(b.state.clicks).toBe(1);
  });
  it("clicks again when a click was missed, and stops as soon as the result is showing", async () => {
    const b = fakeBrowser({ shownAfterClicks: 3 });
    await clickUntilShown(b, "#target", "#shown");
    expect(b.state.clicks).toBe(3);
  });
  it("never clicks when the result is already showing", async () => {
    const b = fakeBrowser({ shownAfterClicks: 0 });
    await clickUntilShown(b, "#target", "#shown");
    expect(b.state.clicks).toBe(0);
  });
  it("does not click a target that is not on the page, and fails with the message given", async () => {
    const b = fakeBrowser({ shownAfterClicks: Infinity, targetPresent: false });
    await expect(clickUntilShown(b, "#target", "#shown", { timeoutMsg: "Back should return to the Investments tab" })).rejects.toThrow("Back should return to the Investments tab");
    expect(b.state.clicks).toBe(0);
  });
});

describe("the specs that use it", () => {
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  it("spec 94 returns to the Investments tab with it, all three times (a missed Back click failed a hosted first attempt)", () => {
    const source = read("feature94_accumulation_summary.mjs");
    expect(source.match(/clickUntilShown\(browser, "\[data-account-back\]", "\[data-acc-summary\]"/g)?.length).toBe(3);
    expect(source).not.toMatch(/\(await browser\.\$\("\[data-account-back\]"\)\)\.click\(\);\s*await browser\.\$\("\[data-acc-summary\]"\)\.waitForExist/);
  });
});
