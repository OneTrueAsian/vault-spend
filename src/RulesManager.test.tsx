// @vitest-environment jsdom
//
// Settings' Categorization rules used to be one long table: every rule a new merchant correction
// added made the whole Settings page longer, and the only way to find a rule was the text filter.
// The list now sits in its own scrolling region (so the page stays the same length however many
// rules there are), can be sorted by any column, and can be narrowed by category as well as text.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { RulesManager } from "./RulesManager";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RULES = [
  { pattern: "starbucks", category: "Dining Out", match_count: 12 },
  { pattern: "payroll", category: "Income", match_count: 3 },
  { pattern: "grocer", category: "Groceries", match_count: 40 },
  { pattern: "market", category: "Groceries", match_count: 0 },
  { pattern: "Netflix", category: "Entertainment", match_count: 6 },
];

describe("RulesManager list", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_rules") return RULES;
      throw new Error(`unexpected request ${command}`);
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<RulesManager categories={["Groceries", "Income"]} onRulesApplied={() => {}} onMessage={() => {}} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const patterns = () => [...container.querySelectorAll("tbody tr td:first-child")].map((td) => td.textContent);
  const heading = (label: string) => [...container.querySelectorAll("th")].find((th) => th.textContent?.includes(label))!;
  const categoryFilter = () => container.querySelector<HTMLSelectElement>("select[data-rules-category-filter]")!;

  async function click(el: Element) {
    await act(async () => {
      (el as HTMLElement).click();
    });
  }

  async function choose(select: HTMLSelectElement, value: string) {
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function type(input: HTMLInputElement, value: string) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("lists the rules alphabetically by their text to begin with", () => {
    expect(patterns()).toEqual(["grocer", "market", "Netflix", "payroll", "starbucks"]);
    expect(heading("When the description contains").getAttribute("aria-sort")).toBe("ascending");
  });

  it("says how many rules there are", () => {
    expect(container.textContent).toContain("5 rules");
  });

  it("sorts by the heading that is clicked — most matches first for Matches — and flips on a second click", async () => {
    await click(heading("Matches").querySelector("button")!);
    expect(patterns()).toEqual(["grocer", "starbucks", "Netflix", "payroll", "market"]);
    expect(heading("Matches").getAttribute("aria-sort")).toBe("descending");

    await click(heading("Matches").querySelector("button")!);
    expect(patterns()).toEqual(["market", "payroll", "Netflix", "starbucks", "grocer"]);
    expect(heading("Matches").getAttribute("aria-sort")).toBe("ascending");
  });

  it("sorts by category, then by text within a category", async () => {
    await click(heading("Category").querySelector("button")!);
    expect(patterns()).toEqual(["starbucks", "Netflix", "grocer", "market", "payroll"]);
  });

  it("can be narrowed to one category, and says how much of the list is showing", async () => {
    const options = [...categoryFilter().querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["All categories", "Dining Out", "Entertainment", "Groceries", "Income"]);

    await choose(categoryFilter(), "Groceries");

    expect(patterns()).toEqual(["grocer", "market"]);
    expect(container.textContent).toContain("Showing 2 of 5 rules");
  });

  it("combines the text filter with the category filter", async () => {
    await choose(categoryFilter(), "Groceries");
    await type(container.querySelector<HTMLInputElement>("input[type='search']")!, "mark");
    expect(patterns()).toEqual(["market"]);
    expect(container.textContent).toContain("Showing 1 of 5 rules");
  });

  it("says so when nothing matches, and how to get the list back", async () => {
    await type(container.querySelector<HTMLInputElement>("input[type='search']")!, "zzz");
    expect(patterns()).toEqual(["No rules match that filter."]);
  });

  it("keeps the list in its own scrolling region the keyboard can reach", () => {
    const region = container.querySelector<HTMLElement>("[data-rules-scroll]")!;
    expect(region, "the table should sit in a scrolling region").not.toBeNull();
    expect(region.tabIndex).toBe(0);
    expect(region.getAttribute("role")).toBe("region");
    expect(region.getAttribute("aria-label")).toMatch(/categorization rules/i);
    expect(region.querySelector("table")).not.toBeNull();
  });

  it("still offers Edit and Delete on every row", () => {
    const rows = [...container.querySelectorAll("tbody tr")];
    for (const row of rows) {
      const labels = [...row.querySelectorAll("button")].map((b) => b.textContent);
      expect(labels).toEqual(["Edit", "Delete"]);
    }
  });
});
