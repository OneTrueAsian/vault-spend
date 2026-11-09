// @vitest-environment jsdom
// "Show names" lays the full sidebar over the page in a narrow window. It must close when keyboard
// focus leaves the sidebar (or a Tab could land on a control hidden under it), but not when the whole
// window loses focus (switching to another program), and it closes on Escape and a click outside.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSidebarOverlay } from "./useSidebarOverlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof useSidebarOverlay>;

function Harness() {
  const ref = useRef<HTMLElement>(null);
  api = useSidebarOverlay(ref);
  return (
    <>
      <aside ref={ref} onBlur={api.handleBlur} data-expanded={api.expanded}>
        <button type="button" id="inside-1">one</button>
        <button type="button" id="inside-2">two</button>
      </aside>
      <button type="button" id="outside">page</button>
    </>
  );
}

describe("useSidebarOverlay", () => {
  let container: HTMLDivElement;
  let root: Root;
  const q = (id: string) => container.querySelector<HTMLButtonElement>(`#${id}`)!;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
    act(() => api.setExpanded(true));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("stays open while focus moves within the sidebar", () => {
    act(() => q("inside-1").focus());
    act(() => q("inside-2").focus());
    expect(api.expanded).toBe(true);
  });

  it("closes when focus moves out of the sidebar", () => {
    act(() => q("inside-1").focus());
    act(() => q("outside").focus());
    expect(api.expanded).toBe(false);
  });

  it("stays open when the window itself loses focus (no element receives it)", () => {
    act(() => q("inside-1").focus());
    act(() => {
      q("inside-1").dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    });
    expect(api.expanded).toBe(true);
  });

  it("closes on Escape and on a mousedown outside, not inside", () => {
    act(() => q("inside-1").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(api.expanded).toBe(true);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(api.expanded).toBe(false);
    act(() => api.setExpanded(true));
    act(() => q("outside").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(api.expanded).toBe(false);
  });

  it("reports icon-only mode from the 1000px media query, and closes when the window widens", () => {
    const listeners: (() => void)[] = [];
    let matches = true;
    const matchMedia = vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => {},
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<Harness />));
    expect(matchMedia).toHaveBeenCalledWith("(max-width: 1000px)");
    expect(api.iconOnly).toBe(true);
    act(() => api.setExpanded(true));
    expect(api.iconOnly).toBe(false);
    matches = false;
    act(() => listeners.forEach((fn) => fn()));
    expect(api.expanded).toBe(false);
    expect(api.iconOnly).toBe(false);
    vi.unstubAllGlobals();
  });
});
