// @vitest-environment jsdom
//
// CategoryFilterDropdown: replaces the Transactions toolbar's native
// category <select> with the same popover-menu pattern its account/member
// filter siblings already use (AccountFilterDropdown, MemberFilterDropdown,
// AccountDestinationDropdown) — a single-select menu, not the inbox
// dialog's top-layer popover (App.tsx's own toolbar isn't clipped by any
// scrolling container, so it doesn't need that heavier mechanism).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CategoryFilterDropdown } from "./CategoryFilterDropdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = [
  { value: "all", label: "All categories" },
  { value: "__uncategorized__", label: "Uncategorized" },
  { value: "Groceries", label: "Groceries" },
  { value: "Dining Out", label: "Dining Out" },
  { value: "A Very Long Category Name That Should Not Break The Layout", label: "A Very Long Category Name That Should Not Break The Layout" },
];

describe("CategoryFilterDropdown", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(value: string) {
    act(() => {
      root.render(<CategoryFilterDropdown options={OPTIONS} value={value} onChange={onChange} />);
    });
  }

  const trigger = () => container.querySelector<HTMLButtonElement>(".category-filter-toggle")!;
  const openMenu = () => act(() => trigger().click());
  const menuButton = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")].find((b) => b.textContent?.includes(label))!;

  it("shows the selected option's label on the trigger (also covers saved-filter restoration: purely value-driven)", () => {
    show("Groceries");
    expect(trigger().textContent).toContain("Groceries");
  });

  it("shows the right label for an existing sentinel value", () => {
    show("__uncategorized__");
    expect(trigger().textContent).toContain("Uncategorized");
    show("all");
    expect(trigger().textContent).toContain("All categories");
  });

  it("renders a long label without erroring, and the menu offers it in full", () => {
    show("all");
    openMenu();
    expect(menuButton("A Very Long Category Name That Should Not Break The Layout")).not.toBeUndefined();
  });

  it("opens a menu of every option, marks the selected one, and selecting a different one calls onChange and closes", () => {
    show("Groceries");
    openMenu();
    expect(container.querySelector("[role='menu']")).not.toBeNull();
    expect(menuButton("Groceries").getAttribute("aria-checked")).toBe("true");
    expect(menuButton("Dining Out").getAttribute("aria-checked")).toBe("false");
    act(() => menuButton("Dining Out").click());
    expect(onChange).toHaveBeenCalledWith("Dining Out");
    expect(container.querySelector("[role='menu']")).toBeNull();
  });

  it("moves focus onto the selected option as soon as the menu opens", () => {
    show("Dining Out");
    openMenu();
    expect(document.activeElement).toBe(menuButton("Dining Out"));
  });

  it("supports keyboard selection: ArrowDown moves focus to the next option", () => {
    show("all");
    openMenu();
    const menu = container.querySelector<HTMLElement>("[role='menu']")!;
    const options = [...menu.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")];
    options[0].focus();
    act(() => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(options[1]);
  });

  it("returns focus to the trigger after selecting an option", () => {
    show("all");
    openMenu();
    act(() => menuButton("Groceries").click());
    expect(document.activeElement).toBe(trigger());
  });

  it("closes and returns focus to the trigger on Escape", () => {
    show("all");
    openMenu();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on an outside click", () => {
    show("all");
    openMenu();
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(container.querySelector("[role='menu']")).toBeNull();
  });
});
