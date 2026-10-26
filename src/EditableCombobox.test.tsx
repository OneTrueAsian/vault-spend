// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditableCombobox } from "./EditableCombobox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const submit = vi.fn(), blur = vi.fn();
function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState("");
  return <EditableCombobox aria-label="Tag" value={value} onChange={setValue} options={["Work", "work", "Work", "Travel"]}
    disabled={disabled} aria-invalid={true} onBlur={blur} onKeyDown={e => { if (e.key === "Enter") submit(value); }} />;
}
beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); act(() => root.render(<Harness />)); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
function key(name: string, composing = false) { act(() => { host.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, isComposing: composing })); }); }
function type(value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(host.querySelector("input"), value);
    host.querySelector("input")!.dispatchEvent(new Event("input", { bubbles: true })); });
}
it("filters without restricting free text, preserves case, deduplicates exact suggestions", () => {
  act(() => host.querySelector("input")!.focus());
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(3);
  type("wOr"); expect([...host.querySelectorAll('[role="option"]')].map(e => e.textContent)).toEqual(["Work", "work"]);
  type("new tag"); expect(host.querySelector('[role="listbox"]')).toBeNull(); key("Enter"); expect(submit).toHaveBeenCalledWith("new tag");
});
it("keeps input focus, fills an active suggestion on Enter, then preserves caller submission", () => {
  act(() => host.querySelector("input")!.focus()); key("ArrowDown");
  const input = host.querySelector("input")!;
  expect(input.getAttribute("aria-activedescendant")).toBe(host.querySelector('[aria-selected="true"]')!.id);
  key("Enter"); expect(input.value).toBe("Work"); expect(submit).not.toHaveBeenCalled(); expect(document.activeElement).toBe(input);
  key("Enter"); expect(submit).toHaveBeenCalledWith("Work");
});
it("pointer selection prevents premature blur, closes on Tab or Escape, and ignores IME Enter", () => {
  act(() => host.querySelector("input")!.focus());
  const option = host.querySelector('[role="option"]')!;
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => { option.dispatchEvent(event); option.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(event.defaultPrevented).toBe(true); expect(blur).not.toHaveBeenCalled();
  key("ArrowDown"); key("Enter", true); expect(submit).not.toHaveBeenCalled(); expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  key("Escape"); expect(host.querySelector('[role="listbox"]')).toBeNull();
  key("ArrowUp"); key("Tab"); expect(host.querySelector('[role="listbox"]')).toBeNull();
});
it("retains invalid and disabled input states without exposing a popup", () => {
  act(() => root.render(<Harness disabled />)); expect(host.querySelector("input")!.disabled).toBe(true);
  expect(host.querySelector("input")!.getAttribute("aria-invalid")).toBe("true"); expect(host.querySelector('[role="listbox"]')).toBeNull();
});
it("dismisses on an outside pointer even when it does not move focus", () => {
  act(() => host.querySelector("input")!.focus());
  expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(host.querySelector('[role="listbox"]')).toBeNull();
});
it("keeps a growing or repositioned popup clear of its input and disconnects sizing on close", async () => {
  let resized: (() => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect = disconnect; });
  const input = host.querySelector("input")!;
  vi.spyOn(input, "getBoundingClientRect").mockReturnValue({ left: 20, top: 600, bottom: 620, width: 100 } as DOMRect);
  act(() => input.focus());
  const panel = host.querySelector('[role="listbox"]') as HTMLElement;
  Object.defineProperty(panel, "scrollHeight", { configurable: true, value: 160 }); act(() => resized!());
  expect(Number.parseFloat(panel.style.top) + 160).toBeLessThan(600);
  Object.defineProperty(panel, "scrollHeight", { configurable: true, value: 280 }); act(() => resized!());
  expect(Number.parseFloat(panel.style.top) + 280).toBeLessThan(600);
  vi.mocked(input.getBoundingClientRect).mockReturnValue({ left: 20, top: 530, bottom: 550, width: 100 } as DOMRect);
  await act(async () => { document.documentElement.dataset.palette = "retro"; await Promise.resolve(); });
  expect(Number.parseFloat(panel.style.top) + 280).toBeLessThan(530);
  key("Escape"); expect(disconnect).toHaveBeenCalledOnce(); vi.unstubAllGlobals();
  delete document.documentElement.dataset.palette;
});
