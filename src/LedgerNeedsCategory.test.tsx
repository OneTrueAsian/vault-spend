// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LedgerNeedsCategory } from "./LedgerNeedsCategory";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("LedgerNeedsCategory", () => {
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
  const show = (count: number, active: boolean, onToggle = vi.fn()) => {
    act(() => root.render(<LedgerNeedsCategory count={count} active={active} onToggle={onToggle} />));
    return onToggle;
  };
  const line = () => container.querySelector<HTMLElement>("[data-needs-category]");
  const button = () => line()?.querySelector("button") ?? null;

  it("renders nothing when nothing needs a category and the filter is off", () => {
    show(0, false);
    expect(line()).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("says how many need a category and offers Review", () => {
    const onToggle = show(12, false);
    expect(line()?.className).toBe("ledger-needs-category");
    expect(line()?.textContent).toContain("12 transactions need a category");
    expect(button()?.textContent).toBe("Review");
    expect(button()?.className).toBe("modal-secondary btn-sm");
    act(() => button()!.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("uses the singular for one", () => {
    show(1, false);
    expect(line()?.textContent).toContain("1 transaction needs a category");
  });

  it("says it is showing them and offers Show all while the filter is on", () => {
    const onToggle = show(12, true);
    expect(line()?.textContent).toContain("Showing the 12 that need a category");
    expect(button()?.textContent).toBe("Show all");
    act(() => button()!.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("still offers Show all when the filter is on and the last one was just sorted", () => {
    show(0, true);
    expect(button()?.textContent).toBe("Show all");
  });
});
