import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WINDOW_SIZE,
  DRIVER_REQUEST_OPTIONS,
  isCommandTimeout,
  applyLaunchWindowSize,
  applyWindowSize,
  chooseMenuOption,
  chooseStyle,
  dismissFirstLaunchDialogs,
  menuOptionLabels,
  pickFromMenu,
  reclaimWindowFocus,
  requestedWindowSize,
  trackWindowSize,
  withFocusRetry,
} from "./harness.mjs";

// Unit tests for the harness's own logic, against a stand-in for WebdriverIO: no app, no driver. The
// stand-in models one MenuSelect (a trigger, its popover menu, the items) and lets a test make the menu
// close — what a real window losing OS focus to another spec's window does — at a chosen moment.

const realDocument = globalThis.document;
afterEach(() => {
  globalThis.document = realDocument;
});

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie" },
];

/**
 * A browser with one MenuSelect. Hooks simulate focus theft:
 * - `onClickTrigger(state)`: runs after each trigger click (e.g. close it again so it never shows)
 * - `onRead(state)`: runs after the menu's items are read in the page (e.g. close it mid-choice)
 * - `itemClickError`: an error an item click throws while the menu is still open (a genuine failure)
 * `triggerFromElement` makes the trigger the child of another element, as `container.$(...)` would.
 */
function fakeMenuSelect({ options = OPTIONS, value = "a", onClickTrigger, onRead, itemClickError, triggerFromElement = false } = {}) {
  const state = { open: false, opens: 0, triggerClicks: 0, itemClicks: 0, value, focused: true };

  const browser = {
    async execute(fn, ...args) {
      globalThis.document = { hasFocus: () => state.focused };
      return fn(...args);
    },
    async getWindowSize() {
      return { width: 1200, height: 800 };
    },
    async maximizeWindow() {
      state.focused = true;
    },
    async setWindowSize() {},
    async waitUntil(condition, { timeoutMsg } = {}) {
      for (let i = 0; i < 3; i++) if (await condition()) return true;
      throw new Error(timeoutMsg ?? "waitUntil timed out");
    },
  };

  const container = { parent: browser };
  const trigger = {
    parent: triggerFromElement ? container : browser,
    async getAttribute(name) {
      if (name === "aria-expanded") return String(state.open);
      if (name === "data-value") return state.value;
      return null;
    },
    async click() {
      state.triggerClicks++;
      state.open = !state.open;
      if (state.open) state.opens++;
      onClickTrigger?.(state);
    },
    async parentElement() {
      return root;
    },
  };
  const root = {
    parent: trigger,
    async $(selector) {
      expect(selector).toBe("[role='menu']");
      return menu;
    },
  };
  const menu = {
    parent: root,
    async waitForDisplayed({ timeoutMsg } = {}) {
      if (!state.open) throw new Error(timeoutMsg ?? "not displayed");
    },
    async isDisplayed() {
      return state.open;
    },
    // What the in-page script sees (readMenuItems runs inside browser.execute with the menu element).
    querySelectorAll(selector) {
      expect(selector).toBe("[role='menuitemradio']");
      if (!state.open) throw new Error("stale element reference: the menu is gone");
      const items = options.map((o) => ({
        getAttribute: (name) => (name === "data-value" ? o.value : null),
        innerText: o.value === state.value ? `${o.label} ✓` : o.label,
      }));
      queueMicrotask(() => onRead?.(state));
      return items;
    },
    async $$(selector) {
      expect(selector).toBe("[role='menuitemradio']");
      return options.map((o) => ({
        async click() {
          state.itemClicks++;
          if (!state.open) throw new Error("Can't call click on element because element wasn't found");
          if (itemClickError) throw itemClickError;
          state.value = o.value;
          state.open = false;
        },
      }));
    },
  };
  return { browser, trigger, state };
}

describe("chooseMenuOption", () => {
  it("chooses the option with the given value", async () => {
    const { trigger, state } = fakeMenuSelect();
    await chooseMenuOption(trigger, { value: "c" });
    expect(state.value).toBe("c");
    expect(state.opens).toBe(1);
  });

  it("chooses by visible label, ignoring the checked item's ✓", async () => {
    const { trigger, state } = fakeMenuSelect({ value: "b" });
    await chooseMenuOption(trigger, { label: "Bravo" });
    expect(state.value).toBe("b");
  });

  it("reopens the menu when it closed while being read (focus taken by another window)", async () => {
    let reads = 0;
    const { trigger, state } = fakeMenuSelect({
      onRead: (s) => {
        if (++reads === 1) s.open = false;
      },
    });
    await chooseMenuOption(trigger, { value: "b" });
    expect(state.value).toBe("b");
    expect(state.opens).toBe(2);
  });

  it("reopens the menu when it closed before it was shown", async () => {
    const { trigger, state } = fakeMenuSelect({
      onClickTrigger: (s) => {
        if (s.triggerClicks === 1) s.open = false;
      },
    });
    await chooseMenuOption(trigger, { value: "b" });
    expect(state.value).toBe("b");
  });

  it("reports a missing option at once instead of reopening", async () => {
    const { trigger, state } = fakeMenuSelect();
    await expect(chooseMenuOption(trigger, { value: "zzz" })).rejects.toThrow(/no menu option with value "zzz" \(options: Alpha, Bravo, Charlie\)/);
    expect(state.opens).toBe(1);
  });

  it("does not retry a failure while the menu is still open", async () => {
    const { trigger, state } = fakeMenuSelect({ itemClickError: new Error("element click intercepted") });
    await expect(chooseMenuOption(trigger, { value: "b" })).rejects.toThrow(/intercepted/);
    expect(state.itemClicks).toBe(1);
  });

  it("reports a missing option at once even if the menu closed right after it was read", async () => {
    const { trigger, state } = fakeMenuSelect({ onRead: (s) => (s.open = false) });
    await expect(chooseMenuOption(trigger, { value: "zzz" })).rejects.toThrow(/no menu option/);
    expect(state.opens).toBe(1);
  });

  it("gives up after three tries when the menu keeps closing", async () => {
    const { trigger, state } = fakeMenuSelect({ onRead: (s) => (s.open = false) });
    await expect(chooseMenuOption(trigger, { value: "b" })).rejects.toThrow(/wasn't found|stale/);
    expect(state.opens).toBe(3);
    expect(state.value).toBe("a");
  });

  it("reclaims focus through the browser even when the trigger was found inside another element", async () => {
    const { trigger, state } = fakeMenuSelect({ triggerFromElement: true });
    state.focused = false;
    await chooseMenuOption(trigger, { value: "b" });
    expect(state.focused).toBe(true);
    expect(state.value).toBe("b");
  });
});

describe("menuOptionLabels", () => {
  it("returns the labels in order without the ✓ and leaves the menu closed", async () => {
    const { trigger, state } = fakeMenuSelect({ value: "b" });
    expect(await menuOptionLabels(trigger)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(state.open).toBe(false);
  });

  it("reopens the menu when it closed before its items could be read", async () => {
    const { trigger, state } = fakeMenuSelect();
    // Focus is taken between the menu showing and the in-page read: the read finds no menu.
    let first = true;
    const menuRoot = await trigger.parentElement();
    const menu = await menuRoot.$("[role='menu']");
    const realWait = menu.waitForDisplayed;
    menu.waitForDisplayed = async (opts) => {
      await realWait(opts);
      if (first) {
        first = false;
        state.open = false;
      }
    };
    expect(await menuOptionLabels(trigger)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(state.opens).toBe(2);
  });
});

describe("withFocusRetry", () => {
  /** A window that can lose OS focus: `steal()` fires blur, `giveBack()` returns focus on its own. */
  function fakeWindow({ focused = true } = {}) {
    const state = { focused, blurListeners: [], maximized: 0 };
    const win = {
      addEventListener(type, listener) {
        if (type === "blur") state.blurListeners.push(listener);
      },
    };
    const browser = {
      async execute(fn, ...args) {
        globalThis.window = win;
        globalThis.document = { hasFocus: () => state.focused };
        try {
          return fn(...args);
        } finally {
          delete globalThis.window;
        }
      },
      async getWindowSize() {
        return { width: 1200, height: 800 };
      },
      async maximizeWindow() {
        state.maximized++;
        state.focused = true;
      },
      async setWindowSize() {},
      async waitUntil(condition, { timeoutMsg } = {}) {
        for (let i = 0; i < 3; i++) if (await condition()) return true;
        throw new Error(timeoutMsg ?? "waitUntil timed out");
      },
    };
    const steal = () => {
      state.focused = false;
      // Listeners run in the page, where `window` is the page's window.
      globalThis.window = win;
      try {
        for (const listener of state.blurListeners) listener();
      } finally {
        delete globalThis.window;
      }
    };
    const giveBack = () => (state.focused = true);
    return { browser, state, steal, giveBack };
  }

  it("returns what the step returns, running it once when nothing goes wrong", async () => {
    const { browser } = fakeWindow();
    let runs = 0;
    expect(await withFocusRetry(browser, async () => ++runs && "done")).toBe("done");
    expect(runs).toBe(1);
  });

  it("reclaims focus before running the step", async () => {
    const { browser, state } = fakeWindow({ focused: false });
    let focusedWhenRun;
    await withFocusRetry(browser, async () => (focusedWhenRun = state.focused));
    expect(focusedWhenRun).toBe(true);
  });

  it("retries a step that failed after the window lost focus, even if focus came back before the check", async () => {
    const { browser, steal, giveBack } = fakeWindow();
    let runs = 0;
    const result = await withFocusRetry(browser, async () => {
      runs++;
      if (runs === 1) {
        steal();
        giveBack();
        throw new Error("the menu closed");
      }
      return "chosen";
    });
    expect(result).toBe("chosen");
    expect(runs).toBe(2);
  });

  it("does not retry a failure in a window that kept its focus", async () => {
    const { browser } = fakeWindow();
    let runs = 0;
    await expect(
      withFocusRetry(browser, async () => {
        runs++;
        throw new Error("genuinely wrong");
      }),
    ).rejects.toThrow(/genuinely wrong/);
    expect(runs).toBe(1);
  });

  it("gives up after three attempts and says focus was lost", async () => {
    const { browser, steal } = fakeWindow();
    let runs = 0;
    await expect(
      withFocusRetry(browser, async () => {
        runs++;
        steal();
        throw new Error("the menu closed");
      }),
    ).rejects.toThrow(/the menu closed.*3 attempt\(s\).*lost focus/s);
    expect(runs).toBe(3);
  });
});

describe("reclaimWindowFocus", () => {
  /** A window that behaves as measured on WebView2: resizing a maximized window only un-maximizes it,
   * back to the size it was created at, ignoring the size asked for. */
  function fakeWindow({ created = { width: 800, height: 600 }, size = { width: 1440, height: 1000 } } = {}) {
    const state = { size: { ...size }, maximized: false, focused: false };
    const browser = {
      async execute(fn) {
        globalThis.document = { hasFocus: () => state.focused };
        return fn();
      },
      async getWindowSize() {
        return state.maximized ? { width: 2560, height: 1400 } : { ...state.size };
      },
      async maximizeWindow() {
        state.maximized = true;
        state.focused = true;
      },
      async setWindowSize(width, height) {
        if (state.maximized) {
          state.maximized = false;
          state.size = { ...created };
        } else {
          state.size = { width, height };
        }
      },
      async waitUntil(condition, { timeoutMsg } = {}) {
        for (let i = 0; i < 3; i++) if (await condition()) return true;
        throw new Error(timeoutMsg ?? "waitUntil timed out");
      },
    };
    return { browser, state };
  }

  it("gets focus back and leaves the window the size it was", async () => {
    const { browser, state } = fakeWindow();
    await reclaimWindowFocus(browser);
    expect(state.focused).toBe(true);
    expect(state.maximized).toBe(false);
    expect(state.size).toEqual({ width: 1440, height: 1000 });
  });

  it("does nothing to a window that already has focus", async () => {
    const { browser, state } = fakeWindow();
    state.focused = true;
    await reclaimWindowFocus(browser);
    expect(state.size).toEqual({ width: 1440, height: 1000 });
  });

  it("puts back the size last asked for, even if the window has slipped to another size", async () => {
    const { browser, state } = fakeWindow({ size: { width: 800, height: 600 } });
    trackWindowSize(browser);
    await browser.setWindowSize(1280, 800);
    state.size = { width: 800, height: 600 }; // an earlier un-maximize that did not hold
    await reclaimWindowFocus(browser);
    expect(state.size).toEqual({ width: 1280, height: 800 });
  });
});

describe("window size", () => {
  it("defaults to 1280x800, wide enough for the sidebar to show its names", () => {
    expect(DEFAULT_WINDOW_SIZE).toEqual({ width: 1280, height: 800 });
  });

  it("applyWindowSize asks again until the size holds, and remembers it", async () => {
    const asked = [];
    const state = { size: { width: 800, height: 600 }, misses: 1 };
    const browser = {
      async getWindowSize() {
        return { ...state.size };
      },
      async setWindowSize(width, height) {
        asked.push([width, height]);
        if (state.misses-- > 0) return; // the first request is ignored, as after an un-maximize
        state.size = { width, height };
      },
    };
    trackWindowSize(browser);
    expect(await applyWindowSize(browser, DEFAULT_WINDOW_SIZE)).toEqual({ width: 1280, height: 800 });
    expect(state.size).toEqual({ width: 1280, height: 800 });
    expect(asked).toEqual([
      [1280, 800],
      [1280, 800],
    ]);
  });

  const stuckAt800 = () => ({
    async getWindowSize() {
      return { width: 800, height: 600 };
    },
    async setWindowSize() {},
  });

  it("applyWindowSize returns the size the window ended at when the size never holds", async () => {
    expect(await applyWindowSize(stuckAt800(), DEFAULT_WINDOW_SIZE)).toEqual({ width: 800, height: 600 });
  });

  it("applyLaunchWindowSize logs the size it ended at and throws when the launch default does not hold", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(applyLaunchWindowSize(stuckAt800(), DEFAULT_WINDOW_SIZE)).rejects.toThrow(/1280x800.*800x600/);
      expect(log).toHaveBeenCalledWith("[harness] window 800x600");
      log.mockClear();
      const fine = { async getWindowSize() { return { width: 1280, height: 800 }; }, async setWindowSize() {} };
      expect(await applyLaunchWindowSize(fine, DEFAULT_WINDOW_SIZE)).toEqual({ width: 1280, height: 800 });
      expect(log).toHaveBeenCalledWith("[harness] window 1280x800");
    } finally {
      log.mockRestore();
    }
  });

  it("trackWindowSize records sizes a spec sets itself", async () => {
    const browser = {
      async setWindowSize() {},
      async getWindowSize() {
        return { width: 1, height: 1 };
      },
    };
    trackWindowSize(browser);
    await browser.setWindowSize(800, 600);
    expect(requestedWindowSize(browser)).toEqual({ width: 800, height: 600 });
  });
});

describe("chooseStyle", () => {
  /** Settings > Appearance, whose style tiles render only after `rowsAfter` reads (a lazy page). */
  function fakeAppearance({ rowsAfter = 1, labels = ["Default", "Futuristic", "Retro"] } = {}) {
    const state = { reads: 0, palette: "transparent", settingsClicks: 0, radioClicks: 0 };
    const rows = labels.map((label) => ({
      querySelector(selector) {
        if (selector === ".style-preview-name") return { textContent: label };
        if (selector === "input") return { click: () => (state.radioClicks++, (state.palette = label.toLowerCase())) };
        return null;
      },
    }));
    const browser = {
      async $(selector) {
        expect(selector).toBe(".nav-item[data-tab=settings]");
        return { click: async () => state.settingsClicks++ };
      },
      async execute(fn, ...args) {
        globalThis.document = {
          documentElement: { dataset: { palette: state.palette } },
          querySelectorAll: (selector) => {
            expect(selector).toBe('[role="radiogroup"][aria-label="Style"] .style-preview-tile');
            return state.reads++ >= rowsAfter ? rows : [];
          },
        };
        return fn(...args);
      },
      async waitUntil(condition, { timeoutMsg } = {}) {
        for (let i = 0; i < 3; i++) if (await condition()) return true;
        throw new Error(timeoutMsg ?? "waitUntil timed out");
      },
    };
    return { browser, state };
  }

  it("opens Settings, waits for the style's row, then chooses it", async () => {
    const { browser, state } = fakeAppearance({ rowsAfter: 1 });
    await chooseStyle(browser, "Retro", "retro");
    expect(state.settingsClicks).toBe(1);
    expect(state.radioClicks).toBe(1);
    expect(state.palette).toBe("retro");
  });

  it("fails by name, without clicking, when the style is never offered", async () => {
    const { browser, state } = fakeAppearance({ labels: ["Default"] });
    await expect(chooseStyle(browser, "Retro", "retro")).rejects.toThrow(/should offer Retro/);
    expect(state.radioClicks).toBe(0);
  });
});

describe("pickFromMenu", () => {
  /** A blur-dismissed dropdown: `open` shows the option; focus theft (`stealOnOpen`) closes it again. */
  function fakeDropdown({ stealOnOpen = 0 } = {}) {
    const state = { open: false, opens: 0, picked: false, focused: true, blurListeners: [] };
    const win = { addEventListener: (type, l) => type === "blur" && state.blurListeners.push(l) };
    const steal = () => {
      state.focused = false;
      state.open = false;
      globalThis.window = win;
      state.blurListeners.forEach((l) => l());
      delete globalThis.window;
    };
    const option = {
      async waitForDisplayed({ timeoutMsg } = {}) {
        if (!state.open) throw new Error(timeoutMsg ?? "not displayed");
      },
      async click() {
        if (!state.open) throw new Error("element wasn't found");
        state.picked = true;
        state.open = false;
      },
    };
    const trigger = {
      async click() {
        state.open = !state.open;
        if (state.open && ++state.opens <= stealOnOpen) steal();
      },
    };
    const browser = {
      async $(selector) {
        if (selector === "#trigger") return trigger;
        if (selector === ".option") return option;
        throw new Error(`unexpected selector ${selector}`);
      },
      async execute(fn, ...args) {
        globalThis.window = win;
        globalThis.document = { hasFocus: () => state.focused };
        try {
          return fn(...args);
        } finally {
          delete globalThis.window;
        }
      },
      async getWindowSize() {
        return { width: 1, height: 1 };
      },
      async maximizeWindow() {
        state.focused = true;
      },
      async setWindowSize() {},
      async waitUntil(condition, { timeoutMsg } = {}) {
        for (let i = 0; i < 3; i++) if (await condition()) return true;
        throw new Error(timeoutMsg ?? "waitUntil timed out");
      },
    };
    return { browser, state };
  }

  it("opens the menu and clicks the option", async () => {
    const { browser, state } = fakeDropdown();
    await pickFromMenu(browser, "#trigger", ".option");
    expect(state.picked).toBe(true);
    expect(state.opens).toBe(1);
  });

  it("opens it again when another window's focus theft closed it before the click", async () => {
    const { browser, state } = fakeDropdown({ stealOnOpen: 1 });
    await pickFromMenu(browser, "#trigger", ".option");
    expect(state.picked).toBe(true);
    expect(state.opens).toBe(2);
  });

  it("reports an option that never shows in a window that kept its focus", async () => {
    const { browser } = fakeDropdown();
    browser.$ = async (selector) => ({
      async click() {},
      async waitForDisplayed({ timeoutMsg }) {
        throw new Error(timeoutMsg);
      },
      selector,
    });
    await expect(pickFromMenu(browser, "#trigger", ".missing")).rejects.toThrow(/\.missing should show after clicking #trigger/);
  });
});

describe("dismissFirstLaunchDialogs", () => {
  function fakeLaunch({ welcomeClick }) {
    const welcome = {
      exists: true,
      async isExisting() {
        return this.exists;
      },
      async click() {
        await welcomeClick(welcome);
      },
    };
    const gotIt = {
      async waitForExist() {
        throw new Error("no What's new dialog");
      },
    };
    return {
      browser: {
        async $(selector) {
          if (selector === "button*=Just get started") return welcome;
          if (selector === "button=Got it") return gotIt;
          throw new Error(`unexpected selector ${selector}`);
        },
      },
    };
  }

  it("clicks the welcome dialog away", async () => {
    let clicked = false;
    const { browser } = fakeLaunch({ welcomeClick: () => (clicked = true) });
    await dismissFirstLaunchDialogs(browser);
    expect(clicked).toBe(true);
  });

  it("treats a welcome dialog that vanished before the click as dismissed", async () => {
    const { browser } = fakeLaunch({
      welcomeClick: (welcome) => {
        welcome.exists = false; // e.g. a focus-loss lock replaced the app with the lock screen
        throw new Error("Can't call elementClick on element with selector \"button*=Just get started\" because element wasn't found");
      },
    });
    await expect(dismissFirstLaunchDialogs(browser)).resolves.toBeUndefined();
  });

  it("still fails when the click fails and the dialog is still there", async () => {
    const { browser } = fakeLaunch({
      welcomeClick: () => {
        throw new Error("element click intercepted");
      },
    });
    await expect(dismissFirstLaunchDialogs(browser)).rejects.toThrow(/intercepted/);
  });
});

// A WebDriver command that never gets an answer used to wait WebdriverIO's default 120 s (and then retry
// three times), so a spec sat silent until run-all.mjs killed it at 60 s with no clue which command hung
// (feature163, Task 16). Each command now gives up well inside that cap and says which one it was.
describe("driver request limits", () => {
  it("gives every command 25 s and never repeats one silently", () => {
    expect(DRIVER_REQUEST_OPTIONS).toEqual({ connectionRetryTimeout: 25_000, connectionRetryCount: 0 });
  });

  it("recognises a command that timed out, and nothing else", () => {
    const timedOut = Object.assign(new Error('WebDriverError: Request timed out! Consider increasing the "connectionRetryTimeout" option. when running "http://127.0.0.1:4444/session/s1/elements" with method "POST"'), { name: "WebDriverRequestError", code: "ETIMEDOUT" });
    expect(isCommandTimeout(timedOut)).toBe(true);
    expect(isCommandTimeout(new Error("element not interactable"))).toBe(false);
    expect(isCommandTimeout(new Error("waitUntil condition timed out after 3000ms"))).toBe(false);
    expect(isCommandTimeout(undefined)).toBe(false);
  });
});
