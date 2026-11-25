// @vitest-environment jsdom
//
// VS-98: the banner on Transactions that says it was opened from a Reports row and offers the way back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { formatDisplayDate } from "../../shared/lib/format";
import { UNCATEGORIZED_FILTER } from "../../shared/native/appTypes";
import { ReportReturnBar } from "./ReportReturnBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ReportReturnBar", () => {
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
  const show = (category: string, onBack = vi.fn(), showing = true) => act(() => { root.render(<ReportReturnBar category={category} from="2025-12-01" to="2026-11-30" showing={showing} onBack={onBack} />); });
  const bar = () => container.querySelector<HTMLElement>("[data-report-return]")!;

  it("names the category and both dates, and claims no total", () => {
    show("Groceries");
    expect(bar().textContent).toContain(`Showing Groceries transactions from ${formatDisplayDate("2025-12-01")} to ${formatDisplayDate("2026-11-30")}.`);
    expect(bar().textContent).not.toMatch(/\$/);
  });

  it("says Uncategorized for the uncategorized filter", () => {
    show(UNCATEGORIZED_FILTER);
    expect(bar().textContent).toContain("Showing Uncategorized transactions");
    expect(bar().textContent).not.toContain(UNCATEGORIZED_FILTER);
  });

  it("is a labelled region", () => {
    show("Groceries");
    expect(bar().getAttribute("role")).toBe("region");
    expect(bar().getAttribute("aria-label")).toBe("Opened from Reports");
  });

  it("keeps the Back button but says nothing about what is shown once the filters have changed", () => {
    const onBack = vi.fn();
    show("Groceries", onBack, false);
    expect(bar().textContent).toBe("← Back to Reports");
    expect(bar().textContent).not.toContain("Showing");
    act(() => container.querySelector<HTMLButtonElement>("button[data-report-return-back]")!.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("has a real Back button that calls onBack once", () => {
    const onBack = vi.fn();
    show("Groceries", onBack);
    const back = container.querySelector<HTMLButtonElement>("button[data-report-return-back]")!;
    expect(back.type).toBe("button");
    expect(back.textContent).toBe("← Back to Reports");
    act(() => back.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
