// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RowMenu, type RowMenuItem } from "./RowMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("RowMenu", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const render = (items: (RowMenuItem | false | null | undefined)[]) =>
    act(() => root.render(<RowMenu label='Actions for "Coffee"' items={items} />));
  const trigger = () => container.querySelector<HTMLButtonElement>("[data-row-menu]")!;
  const panel = () => document.body.querySelector<HTMLElement>(".row-menu-panel");
  const item = (label: string) =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role^='menuitem']")).find((b) => b.textContent?.trim() === label)!;

  it("names the trigger and opens a menu with only the truthy items", () => {
    render([{ label: "Split…", onSelect: () => {} }, false, null, { kind: "divider" }, { label: "Delete…", onSelect: () => {}, danger: true }]);
    expect(trigger().getAttribute("aria-label")).toBe('Actions for "Coffee"');
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    act(() => trigger().click());
    expect(panel()?.getAttribute("role")).toBe("menu");
    expect(Array.from(panel()!.querySelectorAll("[role='menuitem']")).map((b) => b.textContent)).toEqual(["Split…", "Delete…"]);
    expect(item("Delete…").className).toContain("row-menu-item-danger");
  });

  it("drops dividers with nothing on one side, and runs of dividers down to one", () => {
    const a = { label: "A", onSelect: () => {} };
    const b = { label: "B", onSelect: () => {} };
    render([{ kind: "divider" }, false, { kind: "divider" }, a, { kind: "divider" }, null, { kind: "divider" }, b, { kind: "divider" }]);
    act(() => trigger().click());
    const kinds = Array.from(panel()!.children).map((c) => c.getAttribute("role"));
    expect(kinds).toEqual(["menuitem", "separator", "menuitem"]);
  });

  it("runs an action once, closes, and gives focus back to the trigger", () => {
    const onSelect = vi.fn();
    render([{ label: "Split…", onSelect }]);
    act(() => trigger().click());
    act(() => item("Split…").click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("shows a tick for a check item and flips it", () => {
    const onToggle = vi.fn();
    render([{ kind: "check", label: "Roll over unspent", checked: true, onToggle }]);
    act(() => trigger().click());
    const check = item("Roll over unspent");
    expect(check.getAttribute("role")).toBe("menuitemcheckbox");
    expect(check.getAttribute("aria-checked")).toBe("true");
    act(() => check.click());
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("does nothing for a disabled item", () => {
    const onSelect = vi.fn();
    render([{ label: "Apply to a debt…", onSelect, disabled: true }]);
    act(() => trigger().click());
    act(() => item("Apply to a debt…").click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(item("Apply to a debt…").getAttribute("aria-disabled")).toBe("true");
  });

  it("closes on Escape (focus back to trigger) and on a click outside", () => {
    render([{ label: "Split…", onSelect: () => {} }]);
    act(() => trigger().click());
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    act(() => trigger().click());
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(panel()).toBeNull();
  });

  it("moves focus with the arrow keys and wraps", () => {
    render([{ label: "A", onSelect: () => {} }, { label: "B", onSelect: () => {} }]);
    act(() => trigger().click());
    expect(document.activeElement).toBe(item("A"));
    act(() => panel()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(item("B"));
    act(() => panel()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(item("A"));
  });

  it("with nothing focused, ArrowUp goes to the last item and ArrowDown to the first", () => {
    render([{ label: "A", onSelect: () => {} }, { label: "B", onSelect: () => {} }, { label: "C", onSelect: () => {} }]);
    act(() => trigger().click());
    act(() => trigger().focus());
    act(() => panel()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(document.activeElement).toBe(item("C"));
    act(() => trigger().focus());
    act(() => panel()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(item("A"));
  });

  it("closes without running anything when its row unmounts while open (Review Focus 5)", () => {
    const onSelect = vi.fn();
    render([{ label: "Delete…", onSelect }]);
    act(() => trigger().click());
    act(() => root.render(<></>));
    expect(panel()).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
