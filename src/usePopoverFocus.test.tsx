// @vitest-environment jsdom
// An open popover floats over the page, so a control behind it can be entirely hidden. Tab must not carry focus
// out of the panel to such a control while the panel stays open: the panel closes when focus leaves it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePopover } from "./usePopover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  const { open, setOpen, rootRef, triggerRef } = usePopover();
  return (
    <>
      <div ref={rootRef}>
        <button ref={triggerRef} type="button" onClick={() => setOpen((v) => !v)}>Open</button>
        {open && (
          <div className="account-filter-panel">
            <input aria-label="Inside" />
          </div>
        )}
      </div>
      <button type="button" id="behind">Behind the panel</button>
    </>
  );
}

describe("usePopover focus", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
    act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.querySelectorAll("[data-portal]").forEach((el) => el.remove());
  });

  const panel = () => container.querySelector(".account-filter-panel");

  it("closes when focus moves to a control outside it, and leaves focus where it went", () => {
    expect(panel()).not.toBeNull();
    const behind = container.querySelector<HTMLButtonElement>("#behind")!;
    act(() => behind.focus());
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(behind);
  });

  it("stays open while focus moves around inside it, including to the trigger", () => {
    act(() => container.querySelector<HTMLInputElement>("input")!.focus());
    expect(panel()).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>("button")!.focus());
    expect(panel()).not.toBeNull();
  });

  it("stays open when focus moves into a menu opened from inside the panel (it is drawn outside the panel's own box)", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-portal", "");
    const item = document.createElement("button");
    item.setAttribute("role", "menuitemradio");
    menu.append(item);
    document.body.append(menu);
    act(() => item.focus());
    expect(panel()).not.toBeNull();
  });
});
