// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HelpView, TAB_HELP } from "./HelpView";
import { NAV_ITEMS, PINNED_NAV_ITEMS } from "./appTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("HelpView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(<HelpView />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("finds the complete mobile setup, offline and removal guidance together", () => {
    const input=container.querySelector<HTMLInputElement>("input[type=search]")!;
    act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"mobile snapshots");input.dispatchEvent(new Event("input",{bubbles:true}));});
    const text=container.textContent??"";
    expect(text).toContain("How do I set up mobile snapshots on my phone?");
    expect(text).toContain("Can I use mobile snapshots away from my computer?");
    expect(text).toContain("How do I stop phone access or remove mobile snapshots?");
    expect(text).not.toContain("Getting started");
  });

  // The Settings card that holds the password controls is titled "Password protection"
  // (ProfileProtectionSection). Help must send people to a heading that exists.
  it("points to the Settings heading that exists for password protection and automatic locking", () => {
    const text = container.textContent ?? "";

    expect(text).not.toContain("Profile protection");
    expect(text).toContain("Settings → Password protection");
    expect(text).toContain("Settings → Password protection → Automatic locking");
  });

  it("lists every network request the app makes in the privacy answer, including Google Fonts", () => {
    const text = container.textContent ?? "";

    expect(text).toContain("Google Fonts");
    expect(text).not.toContain("The only network requests Vault Spend makes");
  });

  it("explains Futuristic's accent and glow choices and the Reduce motion option", () => {
    const text = container.textContent ?? "";
    expect(text).toContain("Ion Cyan, Rebel Pink, or Ultraviolet");
    expect(text).toContain("Neon intensity");
    expect(text).toContain("Reduce motion");
  });

  it("explains that unsure import rows wait for a choice and that file category choices are remembered", () => {
    const text = container.textContent ?? "";
    expect(text).toContain("Pick a category");
    expect(text).toContain("opens in a window");
    expect(text).toContain("Leave the rest uncategorized");
    expect(text).toContain("remembers that choice for your next import");
    expect(text).not.toContain("or not use it");
  });

  it("explains that Select all works in batches of 250 and how Show more works", () => {
    const text = container.textContent ?? "";
    expect(text).toContain("at most 250 transactions at a time");
    expect(text).toContain("Show 50 more");
  });

  it("explains that rules ignore store numbers", () => {
    expect(container.textContent).toContain("ignoring store numbers");
  });

  it("explains that a split merchant's rule is flagged for review, not applied silently", () => {
    expect(container.textContent).toContain("filed under more than one category");
  });

  it("finds the legal notice when searching for \"disclaimer\"", () => {
    const input = container.querySelector<HTMLInputElement>("input[type=search], input[placeholder*=earch]")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "disclaimer");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("legal notice");
  });

  it("finds the Transactions entry when searching for \"note\"", () => {
    const input = container.querySelector<HTMLInputElement>("input[type=search], input[placeholder*=earch]")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "note");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Transactions");
  });
  it("explains the age-based comparisons: gross income, age groups, past data, unavailable benchmarks and privacy", () => {
    const text = container.textContent ?? "";

    expect(text).toContain("How do the age-based comparisons in Reports work?");
    expect(text).toContain("Income is before tax");
    expect(text).toContain("which survey age group");
    expect(text).toContain("past surveys");
    expect(text).toContain("nothing is substituted");
    expect(text).toContain("Your details");
    expect(text).toContain("nothing you enter is");
  });
});

describe("HelpView sections per tab (s12)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(focusTab?: Parameters<typeof HelpView>[0]["focusTab"]) {
    act(() => root.render(<HelpView focusTab={focusTab} />));
  }

  function search(text: string) {
    const input = container.querySelector<HTMLInputElement>("input[type=search]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const sections = () => Array.from(container.querySelectorAll<HTMLDetailsElement>("details.help-tab"));

  it("has one section for every tab except Help, in sidebar order", () => {
    const tabs = [...NAV_ITEMS, ...PINNED_NAV_ITEMS].map((n) => n.id).filter((t) => t !== "help");
    expect(TAB_HELP.map((h) => h.tab)).toEqual(tabs);
    show();
    expect(sections().map((d) => d.id)).toEqual(tabs.map((t) => `help-${t}`));
  });

  it("gives each section its title, a one-sentence summary and How do I steps", () => {
    show();
    expect(sections()).toHaveLength(11);
    for (const [i, details] of sections().entries()) {
      const help = TAB_HELP[i];
      expect(details.querySelector("summary")?.textContent).toContain(help.title);
      const first = details.querySelector(":scope > p, :scope > .help-tab-body > p");
      expect(first?.textContent, help.title).toBe(help.summary);
      expect(help.summary.length, help.summary).toBeLessThanOrEqual(160);
      expect(help.summary, help.title).toMatch(/\.$/);
      const questions = Array.from(details.querySelectorAll(".help-howto"));
      expect(questions.length, help.title).toBeGreaterThan(0);
      for (const q of questions) {
        expect(q.querySelector("h3")?.textContent, help.title).toMatch(/^How do I /);
        const steps = q.querySelectorAll("ol > li").length;
        expect(steps, q.textContent ?? "").toBeGreaterThanOrEqual(2);
        expect(steps, q.textContent ?? "").toBeLessThanOrEqual(5);
      }
    }
  });

  it("starts with every section closed", () => {
    show();
    expect(sections()).toHaveLength(11);
    expect(sections().every((d) => !d.open)).toBe(true);
  });

  it("opens the matching section when searching and hides the unrelated ones", () => {
    show();
    search("budget");
    expect(container.querySelector<HTMLDetailsElement>("#help-budget")?.open).toBe(true);
    expect(container.querySelector("#help-investments")).toBeNull();
    expect(container.querySelector("#help-settings")).toBeNull();
  });

  it("still finds each tab by the words its old entry was tagged with", () => {
    show();
    for (const [word, tab] of [
      ["sankey", "reports"],
      ["reconcile", "accounts"],
      ["ctrl+k", "dashboard"],
      ["auto-contribute", "buckets"],
      ["price change", "recurring"],
      ["target allocation", "investments"],
      ["unassigned", "household"],
      ["year over year", "cashflow"],
      ["categorization rules", "settings"],
      ["auto-link", "ledger"],
    ]) {
      search(word);
      expect(container.querySelector<HTMLDetailsElement>(`#help-${tab}`)?.open, word).toBe(true);
    }
  });

  it("explains signs the same way everywhere, without calling a card or loan the other way around", () => {
    show();
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).not.toMatch(/other way around/);
    expect(text).not.toMatch(/payment is a positive amount/);
    expect(text).toContain("follows the same rule from its own side");
  });

  it("covers the Mobile snapshots card in the Settings section", () => {
    const settings = TAB_HELP.find((h) => h.tab === "settings")!;
    expect(settings.summary).toMatch(/phone/i);
    expect(settings.howTo.map((h) => h.question)).toContain("How do I see my money on my phone?");
    show();
    for (const word of ["phone", "mobile snapshots", "pairing"]) {
      search(word);
      expect(container.querySelector<HTMLDetailsElement>("#help-settings")?.open, word).toBe(true);
    }
  });

  it("opens and scrolls to the section a page's ? link asked for", () => {
    show("budget");
    const budget = container.querySelector<HTMLDetailsElement>("#help-budget")!;
    expect(budget.open).toBe(true);
    expect(budget.scrollIntoView).toHaveBeenCalled();
    expect(container.querySelector<HTMLDetailsElement>("#help-accounts")!.open).toBe(false);
  });

  it("describes where things are now", () => {
    show();
    const text = container.textContent ?? "";
    for (const words of [
      ["Hide amounts", "bottom of the sidebar"],
      ["Light, Dark or System", "Settings → Appearance"],
      ["⋯", "Split"],
      ["Money out", "Money in"],
      ["Layout", "Customize"],
      ["Show names"],
    ]) {
      for (const w of words) expect(text, w).toContain(w);
    }
  });

  it("no longer mentions the top bar, the header or typing a minus sign", () => {
    show();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/top bar/i);
    expect(text).not.toMatch(/header's/i);
    expect(text).not.toContain("Negative = money out");
    expect(text).not.toContain("+ Add note");
    expect(text).not.toContain("Split →");
  });
});

