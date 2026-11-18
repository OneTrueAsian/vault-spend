// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmInvertDialog } from "./ConfirmInvertDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ConfirmInvertDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
  const hint = () => document.querySelector("[data-import-sign-hint]")?.textContent ?? null;

  function show(props: Partial<React.ComponentProps<typeof ConfirmInvertDialog>> = {}) {
    act(() => {
      root.render(<ConfirmInvertDialog onCancel={onCancel} onConfirm={onConfirm} {...props} />);
    });
  }

  beforeEach(() => {
    onCancel.mockReset();
    onConfirm.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("asks as before when there is nothing to suggest", () => {
    show({ accountName: "Checking", suggestion: { flip: null, reason: null } });
    expect(hint()).toBeNull();
    expect(button("Flip the signs").classList.contains("modal-secondary")).toBe(false);
    expect(button("Keep as-is").classList.contains("modal-secondary")).toBe(true);
  });

  it("preselects flipping when the last import into the account flipped, and says so", () => {
    show({ accountName: "Amex Blue", suggestion: { flip: true, reason: "remembered" } });
    expect(hint()).toBe("Last import into Amex Blue: flipped the signs.");
    expect(document.activeElement).toBe(button("Flip the signs"));
  });

  it("preselects keeping the signs when the last import kept them", () => {
    show({ accountName: "Capitol One", suggestion: { flip: false, reason: "remembered" } });
    expect(hint()).toBe("Last import into Capitol One: kept as-is.");
    expect(document.activeElement).toBe(button("Keep as-is"));
    expect(button("Keep as-is").classList.contains("modal-secondary")).toBe(false);
    expect(button("Flip the signs").classList.contains("modal-secondary")).toBe(true);
  });

  it("explains a suggestion to flip a credit card file that is mostly positive", () => {
    show({ accountName: "Amex Blue", suggestion: { flip: true, reason: "credit-positive" } });
    expect(hint()).toBe("Most amounts in this file are positive. For a credit card that usually means charges are shown as positive.");
    expect(document.activeElement).toBe(button("Flip the signs"));
  });

  it("still lets either answer be chosen, whatever is preselected", () => {
    show({ accountName: "Amex Blue", suggestion: { flip: true, reason: "remembered" } });
    act(() => button("Keep as-is").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => button("Flip the signs").click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
