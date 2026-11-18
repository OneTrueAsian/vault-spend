// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { waitForFocusOn } from "./dialogFocus.mjs";

const INPUT = 'input[placeholder*="Ferrywood"]';
const RESTORE_DELAY_MS = 40;

// A page where closing the confirmation dialog hands focus to the draft input one timer later, as Modal.tsx does, and where the profile
// menu closes if focus lands outside it after it opened (usePopover.ts). `b` runs page functions in this document, like the WebDriver session.
function setUp() {
  document.body.innerHTML = `<div class="profile-switcher"><button class="profile-switcher-toggle">menu</button></div>
    <div class="rule-dialog"><input placeholder="Ferrywood"></div><div class="confirm-dialog"><button id="keep">Keep editing</button></div>`;
  const input = document.querySelector(INPUT), toggle = document.querySelector(".profile-switcher-toggle"), keep = document.querySelector("#keep");
  const state = { menuOpen: false, menuOpenedWithDraftFocused: null };
  input.addEventListener("focusin", () => { state.menuOpen = false; });
  keep.focus();
  keep.addEventListener("click", () => {
    document.querySelector(".confirm-dialog").remove();
    setTimeout(() => input.focus(), RESTORE_DELAY_MS);
  });
  toggle.addEventListener("click", () => { state.menuOpen = true; state.menuOpenedWithDraftFocused = document.activeElement === input; });
  const b = {
    execute: async (fn, ...args) => fn(...args),
    waitUntil: async (condition, { timeout, timeoutMsg }) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) { if (await condition()) return true; await new Promise(r => setTimeout(r, 5)); }
      throw new Error(timeoutMsg);
    },
  };
  return { b, state, input, toggle, keep };
}

describe("waiting for a closed dialog to give focus back before opening the profile menu (spec 286)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("without the wait, a menu opened right after the dialog closes is closed again by the focus restore", async () => {
    const { state, toggle, keep } = setUp();
    keep.click();
    toggle.click();
    expect(state.menuOpen).toBe(true);
    await new Promise(r => setTimeout(r, RESTORE_DELAY_MS * 2));
    expect(state.menuOpen).toBe(false); // the failure the spec showed: open for a moment, then gone
  });

  it("with the wait, the menu opens only after the draft input holds focus, and stays open", async () => {
    const { b, state, toggle, keep, input } = setUp();
    keep.click();
    await waitForFocusOn(b, INPUT, "the draft");
    expect(document.activeElement).toBe(input);
    toggle.click();
    expect(state.menuOpenedWithDraftFocused).toBe(true);
    await new Promise(r => setTimeout(r, RESTORE_DELAY_MS * 2));
    expect(state.menuOpen).toBe(true);
  });

  it("does not return while focus is elsewhere, and says what it was waiting for when it never comes back", async () => {
    const { b } = setUp();
    let returned = false;
    const waiting = waitForFocusOn(b, INPUT, "the draft").then(() => { returned = true; }, e => e);
    await new Promise(r => setTimeout(r, 100));
    expect(returned).toBe(false);
    document.querySelector(INPUT).focus();
    await waiting;
    expect(returned).toBe(true);
    const never = { execute: async () => false, waitUntil: async (c, o) => { throw new Error(o.timeoutMsg); } };
    await expect(waitForFocusOn(never, INPUT, "the draft")).rejects.toThrow("the draft should hold focus again before the next step");
  });
});

describe("spec 286 waits for focus after every Keep editing, before the next menu opening", () => {
  const spec = fs.readFileSync(path.join(process.cwd(), "e2e", "feature286_manual_lock_confirmation.mjs"), "utf8").replaceAll("\r\n", "\n");
  it("places the focus wait between the dialog closing and the next opening, with the existing timeouts and single clicks", () => {
    const loop = spec.slice(spec.indexOf("for (const palette"), spec.indexOf("await lockViaProfileMenu(b, 'discard and lock')"));
    const order = ["Keep editing').click()", "waitForExist({ reverse: true", "waitForFocusOn(b,", "getValue()"].map(s => loop.indexOf(s));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(spec.match(/waitForFocusOn\(/g)).toHaveLength(1);
    expect(spec.match(/timeout: 10000, timeoutMsg/g)).toHaveLength(2);
    expect(spec).not.toMatch(/withFocusRetry\(b, async \(\) => \{ await b\.\$\('input/);
  });
});
