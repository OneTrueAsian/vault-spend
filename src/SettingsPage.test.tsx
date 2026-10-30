// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";

const getProfileUiState = vi.hoisted(() => vi.fn());
const setProfileUiState = vi.hoisted(() => vi.fn());
const getCurrentGeneration = vi.hoisted(() => vi.fn());
vi.mock("./profileUiState", () => ({ getProfileUiState, setProfileUiState, getCurrentGeneration }));

import { SettingsPage } from "./SettingsPage";
import { SettingStar } from "./SettingStar";
import { menuOptions, menuValue, pickMenuOption } from "./menuSelectTestUtils";
import type { SettingsGroupId } from "./settingsIndex";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const backupAction = vi.fn();

// Stand-ins for the real cards: each carries the anchors the real sections carry.
const PANELS = {
  display: (
    <div>
      <div data-setting="theme" tabIndex={-1}>
        Light or dark <input id="note" aria-label="note" />
        <SettingStar id="theme" />
      </div>
    </div>
  ),
  profiles: (
    <div>
      <div data-setting-card="password-protection" tabIndex={-1}>Password protection</div>
    </div>
  ),
  data: (
    <div>
      <div data-setting="backups" tabIndex={-1}>
        Backups <button type="button" onClick={backupAction}>Back up now</button>
      </div>
      <div data-setting-card="mobile-snapshots" tabIndex={-1}>Mobile snapshots</div>
    </div>
  ),
  features: <div><div data-setting="apply-to-debt" tabIndex={-1}>Apply to Debt</div></div>,
  about: <div><div data-setting-card="about" tabIndex={-1}>About</div></div>,
} satisfies Record<Exclude<SettingsGroupId, "quick">, ReactNode>;

describe("SettingsPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  const scrollIntoView = vi.fn();

  const q = (sel: string) => container.querySelector<HTMLElement>(sel)!;
  const qa = (sel: string) => [...container.querySelectorAll<HTMLElement>(sel)];
  const listItems = () => qa('[aria-label="Settings groups"] button');
  const listItem = (name: string) => listItems().find((b) => b.textContent?.includes(name))!;
  const panel = (id: string) => q(`[data-settings-panel="${id}"]`);
  const search = () => q('input[aria-label="Search settings"]');
  function typeInto(input: HTMLInputElement, value: string) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function mount(jumpRequest?: { group: SettingsGroupId; nonce: number }) {
    await act(async () => {
      root.render(<SettingsPage title={<h1>Settings</h1>} panels={PANELS} jumpRequest={jumpRequest} />);
    });
  }

  beforeEach(() => {
    localStorage.clear();
    getProfileUiState.mockReset().mockResolvedValue(null);
    setProfileUiState.mockReset().mockResolvedValue(undefined);
    getCurrentGeneration.mockReset().mockResolvedValue(3);
    backupAction.mockReset();
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  describe("layout", () => {
    it("shows the title row and a named search box", async () => {
      await mount();
      expect(q("h1").textContent).toBe("Settings");
      expect(search().getAttribute("type")).toBe("search");
      expect(search().getAttribute("placeholder")).toBe("Search settings");
    });

    it("lists Quick settings first, a divider, then the five groups by name with no counts", async () => {
      await mount();
      expect(listItems().map((b) => b.textContent?.replace("★", "").trim())).toEqual(["Quick settings", "Display", "Profiles & security", "Data", "Features", "About"]);
      expect(q('[aria-label="Settings groups"] [role="separator"]')).not.toBeNull();
      expect(listItem("Display").textContent).toBe("Display");
    });

    it("opens on Quick settings the first time and marks it current", async () => {
      await mount();
      expect(listItem("Quick settings").getAttribute("aria-current")).toBe("true");
      expect(panel("quick").hidden).toBe(false);
      for (const id of ["display", "profiles", "data", "features", "about"]) expect(panel(id).hidden).toBe(true);
    });

    it("shows a group's heading, sub-line and cards when chosen, and hides the rest", async () => {
      await mount();
      act(() => listItem("Data").click());
      expect(panel("data").hidden).toBe(false);
      expect(panel("quick").hidden).toBe(true);
      expect(panel("data").querySelector("h2")?.textContent).toBe("Data");
      expect(panel("data").textContent).toContain("Where your data is saved and how it is backed up.");
      expect(listItem("Data").getAttribute("aria-current")).toBe("true");
      expect(listItem("Quick settings").hasAttribute("aria-current")).toBe(false);
    });

    it("remembers the last tab for the next visit, and falls back when the stored id is unknown", async () => {
      await mount();
      act(() => listItem("Features").click());
      expect(localStorage.getItem("vaultspend-settings-group")).toBe("features");
      act(() => root.unmount());
      root = createRoot(container);
      await mount();
      expect(panel("features").hidden).toBe(false);

      act(() => root.unmount());
      root = createRoot(container);
      localStorage.setItem("vaultspend-settings-group", "nonsense");
      await mount();
      expect(panel("quick").hidden).toBe(false);
    });

    it("keeps every group mounted: what was typed survives switching away and back", async () => {
      await mount();
      act(() => listItem("Display").click());
      typeInto(q("#note") as HTMLInputElement, "half a thought");
      const node = q("#note");
      act(() => listItem("Data").click());
      expect(panel("display").hidden).toBe(true);
      act(() => listItem("Display").click());
      expect(q("#note")).toBe(node);
      expect((q("#note") as HTMLInputElement).value).toBe("half a thought");
    });

    it("keeps focus on the clicked list item", async () => {
      await mount();
      const item = listItem("Data");
      item.focus();
      act(() => item.click());
      expect(document.activeElement).toBe(item);
    });

    it("has no collapse controls and no keyboard shortcut that moves focus to search", async () => {
      await mount();
      expect(container.querySelector(".settings-nav [aria-expanded], .settings-content [aria-expanded]")).toBeNull();
      act(() => {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
      });
      expect(document.activeElement).not.toBe(search());
    });
  });

  describe("search", () => {
    it("shows matching settings with their group and card, and the matched text marked", async () => {
      await mount();
      typeInto(search() as HTMLInputElement, "backup");
      const results = q('[role="region"][aria-label="Search results"]');
      expect(results.querySelector(".settings-path")?.textContent).toBe("Data");
      expect(results.querySelector("mark")?.textContent?.toLowerCase()).toBe("backup");
      expect(results.querySelector("button")?.textContent).toContain("Automatic backups");
      for (const id of ["quick", "display", "profiles", "data", "features", "about"]) expect(panel(id).hidden).toBe(true);
    });

    it("marks the typed letters in the card name too, so every result shows why it matched", async () => {
      await mount();
      typeInto(search() as HTMLInputElement, "background");
      const item = qa(".settings-result-item").find((r) => r.textContent?.includes("Keep Vault Spend running in the tray"))!;
      // this setting matched through its card's name (Features › Background reminders), not its own words
      expect(item.querySelector(".settings-path mark")?.textContent?.toLowerCase()).toBe("background");
      for (const result of qa(".settings-result-item")) expect(result.querySelector("mark")).not.toBeNull();
    });

    it("marks no group as selected while a search is showing", async () => {
      await mount();
      typeInto(search() as HTMLInputElement, "backup");
      expect(listItems().some((b) => b.hasAttribute("aria-current"))).toBe(false);
    });

    it("gives a plain message that names the search when nothing matches", async () => {
      await mount();
      typeInto(search() as HTMLInputElement, "xyzzy");
      expect(container.textContent).toContain("No settings match “xyzzy”. Try a shorter word, like “backup” or “color”.");
    });

    it("offers a Clear search action in the empty state that clears the search and returns focus to it", async () => {
      await mount();
      typeInto(search() as HTMLInputElement, "xyzzy");
      const clear = [...q(".settings-empty").querySelectorAll("button")].find((b) => b.textContent === "Clear search")!;
      expect(clear).toBeDefined();
      act(() => clear.click());
      expect((search() as HTMLInputElement).value).toBe("");
      expect(q('[aria-label="Search results"]')).toBeNull();
      expect(panel("quick").hidden).toBe(false);
      expect(document.activeElement).toBe(search());
    });

    it("treats typed brackets and markup as plain text", async () => {
      await mount();
      for (const text of ["(", "[", "<b>x</b>"]) {
        typeInto(search() as HTMLInputElement, text);
        expect(container.querySelector("b")).toBeNull();
      }
      expect(container.textContent).toContain("No settings match “<b>x</b>”");
    });

    it("never offers a star on a result", async () => {
      await mount();
      typeInto(search() as HTMLInputElement, "backup");
      expect(q('[aria-label="Search results"]').querySelector("button[aria-pressed]")).toBeNull();
    });

    it("never lists a setting that is not on screen (conditional cards)", async () => {
      await mount();
      typeInto(search() as HTMLInputElement, "plaintext");
      expect(q('[aria-label="Search results"]')?.textContent ?? "").not.toContain("Plaintext files left behind");
    });

    it("Esc clears the search and brings back the selected group", async () => {
      await mount();
      act(() => listItem("Data").click());
      typeInto(search() as HTMLInputElement, "backup");
      act(() => {
        search().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect((search() as HTMLInputElement).value).toBe("");
      expect(panel("data").hidden).toBe(false);
      expect(listItem("Data").getAttribute("aria-current")).toBe("true");
    });

    it("jumps to the setting from a result: group shown, scrolled to, focused, highlighted, search cleared", async () => {
      await mount();
      typeInto(search() as HTMLInputElement, "backup");
      await act(async () => q('[aria-label="Search results"] button').click());
      const target = q('[data-setting="backups"]');
      expect(panel("data").hidden).toBe(false);
      expect((search() as HTMLInputElement).value).toBe("");
      expect(scrollIntoView).toHaveBeenCalled();
      expect(document.activeElement).toBe(target);
      expect(target.classList.contains("settings-flash")).toBe(true);
    });

    it("lets the highlight go after a moment", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await mount();
      typeInto(search() as HTMLInputElement, "backup");
      await act(async () => q('[aria-label="Search results"] button').click());
      const target = q('[data-setting="backups"]');
      expect(target.classList.contains("settings-flash")).toBe(true);
      act(() => {
        vi.advanceTimersByTime(2500);
      });
      expect(target.classList.contains("settings-flash")).toBe(false);
    });

    it("shows the highlight without movement when the person asked for reduced motion", () => {
      const css = fs.readFileSync(path.join(__dirname, "SettingsPage.css"), "utf8");
      expect(css).toMatch(/html\[data-motion="reduced"\][^{]*\.settings-flash[^{]*\{[^}]*animation:\s*none/);
      expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.settings-flash/);
    });
  });

  describe("Quick settings tab", () => {
    it("holds a heading and the sub-line, with the three defaults in order, each with its path", async () => {
      await mount();
      const quick = panel("quick");
      expect(quick.querySelector("h2")?.textContent).toBe("Quick settings");
      expect(quick.textContent).toContain("Shortcuts to the settings you use most. Click one to go straight to it.");
      const entries = [...quick.querySelectorAll<HTMLElement>("[data-quick-entry]")];
      expect(entries.map((e) => e.getAttribute("data-quick-entry"))).toEqual(["mobile-snapshots", "password-protection", "backups"]);
      expect(entries[0].querySelector(".settings-path")?.textContent).toBe("Data");
      expect(entries[1].querySelector(".settings-path")?.textContent).toBe("Profiles & security");
      expect(entries[2].querySelector(".settings-path")?.textContent).toBe("Data");
      expect(quick.textContent).not.toContain("Go to setting →");
    });

    it("takes the person to the setting and never runs its action", async () => {
      await mount();
      await act(async () => q('[data-quick-entry="backups"] [data-quick-go]').click());
      expect(panel("data").hidden).toBe(false);
      expect(document.activeElement).toBe(q('[data-setting="backups"]'));
      expect(q('[data-setting="backups"]').classList.contains("settings-flash")).toBe(true);
      expect(backupAction).not.toHaveBeenCalled();
    });

    it("shows nothing wrong while the list is still loading: no defaults, no empty message", async () => {
      getProfileUiState.mockReturnValue(new Promise(() => undefined));
      await mount();
      expect(panel("quick").querySelector("[data-quick-entry]")).toBeNull();
      expect(panel("quick").textContent).not.toContain("Nothing here yet");
      expect(panel("quick").querySelector("h2")?.textContent).toBe("Quick settings");
    });

    it("removes an entry with its × button and saves the list", async () => {
      await mount();
      await act(async () => q('[aria-label="Remove Automatic backups from Quick settings"]').click());
      expect(panel("quick").querySelector('[data-quick-entry="backups"]')).toBeNull();
      expect(setProfileUiState).toHaveBeenLastCalledWith("quick_settings", '["mobile-snapshots","password-protection"]', 3);
    });

    it("says so in plain words when it is empty, and stays empty on the next visit", async () => {
      getProfileUiState.mockResolvedValue("[]");
      await mount();
      expect(panel("quick").textContent).toContain("Nothing here yet. Use “Add a setting” below, or click the ☆ beside any setting.");
      act(() => root.unmount());
      root = createRoot(container);
      await mount();
      expect(panel("quick").querySelector("[data-quick-entry]")).toBeNull();
    });

    it("adds from a searchable list that leaves out what is already there, then closes with Done", async () => {
      await mount();
      await act(async () => q("[data-quick-add-open]").click());
      const picker = q("[data-quick-picker]");
      const names = () => [...picker.querySelectorAll<HTMLElement>("[data-quick-add]")].map((b) => b.getAttribute("data-quick-add"));
      expect(names()).not.toContain("backups");
      expect(names()).not.toContain("protection-leftovers");
      typeInto(picker.querySelector<HTMLInputElement>('input[aria-label="Search for a setting to add"]')!, "light");
      expect(names()).toEqual(["theme"]);
      await act(async () => picker.querySelector<HTMLElement>('[data-quick-add="theme"]')!.click());
      expect(setProfileUiState).toHaveBeenLastCalledWith("quick_settings", '["mobile-snapshots","password-protection","backups","theme"]', 3);
      expect(panel("quick").querySelector('[data-quick-entry="theme"]')).not.toBeNull();
      act(() => q("[data-quick-done]").click());
      expect(container.querySelector("[data-quick-picker]")).toBeNull();
    });

    it("a star elsewhere adds to the same list", async () => {
      await mount();
      await act(async () => q('[aria-label="Add Light or dark to Quick settings"]').click());
      expect(panel("quick").querySelector('[data-quick-entry="theme"]')).not.toBeNull();
    });

    it("tells the person when saving failed and keeps the list as it was", async () => {
      await mount();
      setProfileUiState.mockRejectedValue(new Error("disk"));
      await act(async () => q('[aria-label="Remove Automatic backups from Quick settings"]').click());
      expect(panel("quick").querySelector('[data-quick-entry="backups"]')).not.toBeNull();
      expect(q('[role="alert"]').textContent).toBe("Couldn't save your Quick settings. Try again.");
    });
  });

  describe("one scrolling content area", () => {
    const withScroll = (el: HTMLElement, top: number) => {
      Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: top });
    };

    it("starts a newly chosen group at the top", async () => {
      await mount();
      const content = q(".settings-content");
      withScroll(content, 250);
      act(() => listItem("Data").click());
      expect(content.scrollTop).toBe(0);
    });

    it("starts the search results at the top, and does not reset the scroll when jumping to a setting", async () => {
      await mount();
      const content = q(".settings-content");
      withScroll(content, 250);
      typeInto(search() as HTMLInputElement, "backup");
      expect(content.scrollTop).toBe(0);
      withScroll(content, 250);
      await act(async () => q('[aria-label="Search results"] button').click());
      expect(content.scrollTop).toBe(250);
      expect(scrollIntoView).toHaveBeenCalled();
    });

    it("offers a category selector for very narrow windows that moves between groups", async () => {
      await mount();
      const trigger = q("[data-settings-select] [data-value]");
      expect(trigger.getAttribute("aria-label") ?? trigger.textContent).toContain("Settings group");
      expect(menuValue(trigger)).toBe("quick");
      expect(menuOptions(trigger).map((o) => o.label)).toEqual(["Quick settings", "Display", "Profiles & security", "Data", "Features", "About"]);
      pickMenuOption(trigger, "data");
      expect(panel("data").hidden).toBe(false);
      expect(listItem("Data").getAttribute("aria-current")).toBe("true");
      expect(menuValue(q("[data-settings-select] [data-value]"))).toBe("data");
    });
  });

  describe("jump requests", () => {
    it("opens the requested group", async () => {
      await mount({ group: "profiles", nonce: 101 });
      expect(panel("profiles").hidden).toBe(false);
      expect(listItem("Profiles & security").getAttribute("aria-current")).toBe("true");
    });

    it("opens it again when asked again after the person moved elsewhere", async () => {
      await mount({ group: "profiles", nonce: 201 });
      act(() => listItem("Data").click());
      await mount({ group: "profiles", nonce: 202 });
      expect(panel("profiles").hidden).toBe(false);
    });

    it("does not repeat a request it already handled when Settings is opened again", async () => {
      await mount({ group: "profiles", nonce: 301 });
      act(() => listItem("Data").click());
      act(() => root.unmount());
      root = createRoot(container);
      await mount({ group: "profiles", nonce: 301 });
      expect(panel("data").hidden).toBe(false);
      expect(listItem("Data").getAttribute("aria-current")).toBe("true");
    });
  });
});

describe("SettingsPage frame: jumps move only the content, and the category navigation fits", () => {
  let container: HTMLDivElement;
  let root: Root;
  const scrollIntoView = vi.fn();
  const observers: Array<{ callback: () => void; disconnect: () => void }> = [];

  const q = (sel: string) => container.querySelector<HTMLElement>(sel)!;
  const search = () => q('input[aria-label="Search settings"]') as HTMLInputElement;
  const page = () => q(".settings-page");
  function typeInto(input: HTMLInputElement, value: string) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const box = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  /** Gives the content scroller and the target real-looking geometry, as jsdom does no layout. */
  function layout(content: HTMLElement, target: HTMLElement, { contentTop = 100, client = 400, scroll = 3000, targetTop = 900, targetHeight = 100 } = {}) {
    let scrolled = 0;
    Object.defineProperty(content, "scrollTop", { configurable: true, get: () => scrolled, set: (value: number) => { scrolled = value; } });
    Object.defineProperty(content, "clientHeight", { configurable: true, value: client });
    Object.defineProperty(content, "scrollHeight", { configurable: true, value: scroll });
    content.getBoundingClientRect = () => box(contentTop - content.scrollTop, client);
    target.getBoundingClientRect = () => box(targetTop - content.scrollTop, targetHeight);
  }
  const fire = () => act(() => observers.forEach((o) => o.callback()));
  const define = (el: HTMLElement, props: Record<string, number>) => Object.entries(props).forEach(([k, v]) => Object.defineProperty(el, k, { configurable: true, value: v }));
  async function mount() {
    await act(async () => {
      root.render(<SettingsPage title={<h1>Settings</h1>} panels={PANELS} />);
    });
  }

  beforeEach(() => {
    localStorage.clear();
    getProfileUiState.mockReset().mockResolvedValue(null);
    setProfileUiState.mockReset().mockResolvedValue(undefined);
    getCurrentGeneration.mockReset().mockResolvedValue(3);
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
    observers.length = 0;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      private entry: { callback: () => void; disconnect: () => void };
      constructor(callback: () => void) {
        this.entry = { callback, disconnect: () => undefined };
        observers.push(this.entry);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        observers.splice(observers.indexOf(this.entry), 1);
      }
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });

  describe("revealing a setting", () => {
    it("scrolls the content scroller itself and never asks the browser to scroll ancestors (search result)", async () => {
      await mount();
      const content = q(".settings-content");
      layout(content, q('[data-setting-card="mobile-snapshots"]'));
      typeInto(search(), "mobile");
      await act(async () => {
        container.querySelector<HTMLElement>(".settings-result-item")!.click();
      });
      expect(scrollIntoView).not.toHaveBeenCalled();
      // setting top 900 - content top 100 = 800 into the content; centred in a 400 high box: 800 - (400 - 100) / 2
      expect(content.scrollTop).toBe(650);
      expect(document.activeElement).toBe(q('[data-setting-card="mobile-snapshots"]'));
    });

    it("does the same for a Quick settings entry", async () => {
      await mount();
      const content = q(".settings-content");
      layout(content, q('[data-setting="backups"]'), { targetTop: 1500 });
      await act(async () => {
        q('[data-quick-entry="backups"] [data-quick-go]').click();
      });
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(content.scrollTop).toBe(1400 - 150);
    });

    it("lines a setting taller than the window up with the top of the content instead of centring it", async () => {
      await mount();
      const content = q(".settings-content");
      layout(content, q('[data-setting-card="mobile-snapshots"]'), { targetTop: 1100, targetHeight: 900 });
      typeInto(search(), "mobile");
      await act(async () => {
        container.querySelector<HTMLElement>(".settings-result-item")!.click();
      });
      expect(content.scrollTop).toBe(1000 - 16);
    });

    it("never scrolls past the top or bottom of the content", async () => {
      await mount();
      const content = q(".settings-content");
      layout(content, q('[data-setting-card="mobile-snapshots"]'), { targetTop: 120, targetHeight: 50 });
      typeInto(search(), "mobile");
      await act(async () => {
        container.querySelector<HTMLElement>(".settings-result-item")!.click();
      });
      expect(content.scrollTop).toBe(0);
    });

    it("falls back to the browser's own scrolling when the content is not a scroller (a very short window)", async () => {
      await mount();
      const content = q(".settings-content");
      layout(content, q('[data-setting-card="mobile-snapshots"]'), { client: 400, scroll: 400 });
      typeInto(search(), "mobile");
      await act(async () => {
        container.querySelector<HTMLElement>(".settings-result-item")!.click();
      });
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });
  });

  describe("category navigation that fits", () => {
    const strip = () => q(".settings-nav");

    it("offers the selector as soon as the tabs would not fit, and the tabs again once they do", async () => {
      await mount();
      expect(page().getAttribute("data-nav")).toBe("tabs");
      define(page(), { clientWidth: 600 });
      define(strip(), { clientWidth: 600, scrollWidth: 700 });
      fire();
      expect(page().getAttribute("data-nav")).toBe("select");
      // still too narrow for the remembered width plus a margin: stay on the selector
      define(page(), { clientWidth: 705 });
      fire();
      expect(page().getAttribute("data-nav")).toBe("select");
      define(page(), { clientWidth: 720 });
      fire();
      expect(page().getAttribute("data-nav")).toBe("tabs");
    });

    it("always uses the selector in a very narrow area, whatever the tabs measure", async () => {
      await mount();
      define(page(), { clientWidth: 540 });
      define(strip(), { clientWidth: 540, scrollWidth: 400 });
      fire();
      expect(page().getAttribute("data-nav")).toBe("select");
    });

    it("keeps the tabs when the sidebar layout is showing", async () => {
      await mount();
      define(page(), { clientWidth: 1200 });
      define(strip(), { clientWidth: 200, scrollWidth: 200 });
      fire();
      expect(page().getAttribute("data-nav")).toBe("tabs");
    });

    it("keeps every category reachable and changes group from the selector", async () => {
      await mount();
      define(page(), { clientWidth: 600 });
      define(strip(), { clientWidth: 600, scrollWidth: 700 });
      fire();
      const trigger = () => q("[data-settings-select] [data-value]");
      expect(menuOptions(trigger()).map((o) => o.label)).toEqual(["Quick settings", "Display", "Profiles & security", "Data", "Features", "About"]);
      expect(menuValue(trigger())).toBe("quick");
      pickMenuOption(trigger(), "data");
      expect(q('[data-settings-panel="data"]').hidden).toBe(false);
      expect(menuValue(trigger())).toBe("data");
    });
  });

  describe("the content boundary", () => {
    it("offsets the search box by the scroller's scrollbar and inset so it ends where the cards end", async () => {
      await mount();
      const content = q(".settings-content");
      define(content, { offsetWidth: 1060, clientWidth: 1045 });
      fire();
      expect(page().style.getPropertyValue("--settings-scrollbar")).toBe("15px");
      define(content, { offsetWidth: 1060, clientWidth: 1060 });
      fire();
      expect(page().style.getPropertyValue("--settings-scrollbar")).toBe("0px");
    });
  });
});
