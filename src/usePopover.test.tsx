// @vitest-environment jsdom
// A popover panel normally drops below its trigger (top: 100% + 6px of its container). The icon-only
// sidebar shows the profile menu as a `position: fixed` panel beside the rail instead (its 68px rail
// would cut an absolutely placed one off), so a fixed panel is placed in window coordinates, level
// with its trigger.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePopover } from "./usePopover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ position }: { position: "absolute" | "fixed" }) {
  const { open, setOpen, rootRef, triggerRef } = usePopover();
  return (
    <div ref={rootRef}>
      <button ref={triggerRef} type="button" onClick={() => setOpen((v) => !v)}>
        Open
      </button>
      {open && (
        <div className="profile-switcher-panel" style={{ position, maxHeight: "260px" }}>
          menu
        </div>
      )}
    </div>
  );
}

describe("usePopover placement", () => {
  let container: HTMLDivElement;
  let root: Root;
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    HTMLElement.prototype.getBoundingClientRect = function () {
      const box = this.tagName === "BUTTON" ? { top: 100, bottom: 136, left: 20, right: 56 } : { top: 0, bottom: 0, left: 90, right: 290 };
      return { ...box, width: box.right - box.left, height: box.bottom - box.top, x: box.left, y: box.top, toJSON() {} } as DOMRect;
    };
  });
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = realRect;
    act(() => root.unmount());
    container.remove();
  });

  function open(position: "absolute" | "fixed") {
    act(() => root.render(<Harness position={position} />));
    act(() => container.querySelector("button")!.click());
    return container.querySelector<HTMLDivElement>(".profile-switcher-panel")!;
  }

  it("drops an ordinary panel below its trigger", () => {
    const panel = open("absolute");
    expect(panel.style.top).toBe("calc(100% + 6px)");
    expect(panel.style.bottom).toBe("auto");
  });

  it("places a fixed panel level with its trigger, in window coordinates", () => {
    const panel = open("fixed");
    expect(panel.style.top).toBe("100px");
    expect(panel.style.bottom).toBe("auto");
  });

  it("grows with its contents: a row added while open (More filters' Clear all) is not cut off", async () => {
    function Growing() {
      const { open, setOpen, rootRef, triggerRef } = usePopover();
      const [rows, setRows] = useState(1);
      return (
        <div ref={rootRef}>
          <button ref={triggerRef} type="button" onClick={() => setOpen((v) => !v)}>
            Open
          </button>
          <button type="button" data-add onClick={() => setRows((n) => n + 1)}>
            Add
          </button>
          {open && (
            <div className="account-filter-panel" style={{ maxHeight: "340px" }}>
              {Array.from({ length: rows }, (_, i) => (
                <p key={i}>row</p>
              ))}
            </div>
          )}
        </div>
      );
    }
    // Each row is 60px tall.
    const realScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.querySelectorAll("p").length * 60;
      },
    });
    try {
      act(() => root.render(<Growing />));
      act(() => container.querySelector<HTMLButtonElement>("button")!.click());
      const panel = container.querySelector<HTMLDivElement>(".account-filter-panel")!;
      expect(panel.style.maxHeight).toBe("62px");
      await act(async () => {
        container.querySelector<HTMLButtonElement>("[data-add]")!.click();
        await Promise.resolve();
      });
      expect(panel.style.maxHeight).toBe("122px");
    } finally {
      if (realScroll) Object.defineProperty(HTMLElement.prototype, "scrollHeight", realScroll);
    }
  });
});
