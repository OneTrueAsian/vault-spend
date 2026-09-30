// @vitest-environment jsdom
//
// RowFieldDropdown: a single-select popover for a row's own account/member/
// category editor, replacing the native <select> those cells used to hold.
// A native select's closed-state box always clips its selected text to a
// fixed pixel width in every browser — no amount of CSS makes it wrap — so
// a long account/category name (the actual reproduced defect) needs a real
// custom trigger, not a wider native select. Shares usePopover's proven
// menu/keyboard pattern with CategoryFilterDropdown and
// AccountDestinationDropdown; this one wraps its trigger's text across
// lines instead of truncating, since it lives inline in a table cell
// rather than a fixed-width toolbar slot.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RowFieldDropdown } from "./RowFieldDropdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = [
  { value: "1", label: "Checking" },
  { value: "2", label: "Household checking — annual expenses and reimbursements" },
  { value: "3", label: "Savings" },
];

describe("RowFieldDropdown", () => {
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
      root.render(<RowFieldDropdown options={OPTIONS} value={value} ariaLabel='Account for "Green Leaf Grocers"' onChange={onChange} />);
    });
  }

  const trigger = () => container.querySelector<HTMLButtonElement>(".row-field-toggle")!;
  const openMenu = () => act(() => trigger().click());
  // The menu portals to document.body (see the "renders its open menu..."
  // test below for why), so it's queried from document, not container.
  const menuButton = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")].find((b) => b.textContent?.includes(label))!;

  it("shows the selected option's full label on the trigger, not truncated", () => {
    show("2");
    expect(trigger().textContent).toContain("Household checking — annual expenses and reimbursements");
  });

  it("carries the caller's own aria-label", () => {
    show("1");
    expect(trigger().getAttribute("aria-label")).toBe('Account for "Green Leaf Grocers"');
  });

  it("opens a menu listing every option and marks the selected one", () => {
    show("1");
    openMenu();
    expect(menuButton("Checking").getAttribute("aria-checked")).toBe("true");
    expect(menuButton("Savings").getAttribute("aria-checked")).toBe("false");
  });

  it("selecting a different option calls onChange and closes the menu", () => {
    show("1");
    openMenu();
    act(() => menuButton("Savings").click());
    expect(onChange).toHaveBeenCalledWith("3");
    expect(document.querySelector("[role='menu']")).toBeNull();
  });

  it("returns focus to the trigger after selecting an option", () => {
    show("1");
    openMenu();
    act(() => menuButton("Savings").click());
    expect(document.activeElement).toBe(trigger());
  });

  it("closes and returns focus to the trigger on Escape", () => {
    show("1");
    openMenu();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("supports keyboard navigation: ArrowDown moves focus to the next option", () => {
    show("1");
    openMenu();
    const menu = document.querySelector<HTMLElement>("[role='menu']")!;
    const options = [...menu.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")];
    options[0].focus();
    act(() => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(options[1]);
  });

  it("renders its open menu as a direct child of document.body, not nested inside the row's own DOM", () => {
    // A row lives inside the ledger's scrolling container
    // (.ledger-table-scroll { overflow-x: auto }, which per the CSS spec
    // also clips vertically once either axis is non-visible). A menu
    // nested in that subtree gets clipped near the bottom of the table;
    // portaling to document.body escapes any ancestor's overflow.
    show("1");
    openMenu();
    const menu = document.querySelector("[role='menu']")!;
    expect(menu.parentElement).toBe(document.body);
    expect(container.contains(menu)).toBe(false);
  });

  it("selecting the already-selected option does not call onChange again", () => {
    show("1");
    openMenu();
    act(() => menuButton("Checking").click());
    expect(onChange).not.toHaveBeenCalled();
  });

  describe("a disabled placeholder option", () => {
    const OPTIONS_WITH_PLACEHOLDER = [
      { value: "", label: "Uncategorized", disabled: true },
      { value: "1", label: "Groceries" },
      { value: "2", label: "Dining Out" },
    ];

    function showWithPlaceholder(value: string) {
      act(() => {
        root.render(<RowFieldDropdown options={OPTIONS_WITH_PLACEHOLDER} value={value} ariaLabel='Category for "Green Leaf Grocers"' onChange={onChange} />);
      });
    }

    it("clicking it does not call onChange — a native select's disabled option can never be chosen either", () => {
      showWithPlaceholder("1");
      openMenu();
      act(() => menuButton("Uncategorized").click());
      expect(onChange).not.toHaveBeenCalled();
    });

    it("is marked aria-disabled and skipped by ArrowUp from the first real option", () => {
      showWithPlaceholder("1");
      openMenu();
      expect(menuButton("Uncategorized").getAttribute("aria-disabled")).toBe("true");
      const menu = document.querySelector<HTMLElement>("[role='menu']")!;
      menuButton("Groceries").focus();
      act(() => {
        menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      });
      expect(document.activeElement).toBe(menuButton("Dining Out"));
    });

    it("is skipped when the menu opens with no real selection yet", () => {
      showWithPlaceholder("");
      openMenu();
      expect(document.activeElement).toBe(menuButton("Groceries"));
    });
  });
});
