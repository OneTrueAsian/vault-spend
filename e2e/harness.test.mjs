import { afterEach, describe, expect, it } from "vitest";
import { chooseMenuOption, dismissFirstLaunchDialogs, menuOptionLabels, withFocusRetry } from "./harness.mjs";

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
