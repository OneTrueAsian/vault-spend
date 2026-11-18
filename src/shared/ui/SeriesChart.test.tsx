// @vitest-environment jsdom
//
// The series chart's values used to appear only when the mouse moved over it (the tooltip), so a keyboard
// or screen-reader user couldn't read any of them. It is now focusable: the arrow keys step through the same
// points the mouse hover shows, and the values at the current point are announced through a live region.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SeriesChart, type SeriesChartSeries } from "./charts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = (year: number, month1: number) => year * 12 + (month1 - 1);

const series: SeriesChartSeries[] = [
  {
    key: "invested",
    name: "Cash invested",
    color: "grey",
    points: [
      { x: at(2026, 1), value: 0 },
      { x: at(2026, 5), value: 1800 },
      { x: at(2026, 9), value: 5540 },
    ],
  },
  {
    key: "projected",
    name: "Projected",
    color: "blue",
    dashed: true,
    points: [
      { x: at(2026, 9), value: 5540 },
      { x: at(2027, 9), value: 11000 },
    ],
  },
];

describe("SeriesChart keyboard access", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(<SeriesChart series={series} nowX={at(2026, 9)} ariaLabel="Cash invested and projected value over time" />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const chart = () => container.querySelector<HTMLElement>("[data-series-chart]")!;
  const title = () => container.querySelector(".chart-tooltip-title")?.textContent ?? null;
  const live = () => container.querySelector("[data-chart-live]")?.textContent ?? "";

  function press(key: string) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    act(() => {
      chart().dispatchEvent(event);
    });
    return event;
  }

  it("can be reached with Tab and says how to read it", () => {
    expect(chart().tabIndex).toBe(0);
    expect(chart().getAttribute("aria-label")).toMatch(/arrow keys/i);
  });

  it("shows nothing until a key is pressed", () => {
    expect(title()).toBeNull();
    expect(live()).toBe("");
  });

  it("shows the same tooltip the mouse shows, and announces its values, when an arrow key is pressed", () => {
    press("ArrowRight");
    expect(title(), "the tooltip should appear").not.toBeNull();
    expect(container.querySelector(".chart-tooltip-text")).not.toBeNull();
    expect(live()).toContain(title()!);
    expect(live()).toContain("Cash invested");
  });

  it("steps through the points with the arrow keys and stops at the ends", () => {
    press("Home");
    const first = title();
    press("ArrowRight");
    const second = title();
    expect(second).not.toBe(first);
    press("ArrowLeft");
    expect(title()).toBe(first);
    press("ArrowLeft");
    expect(title(), "it stays on the first point rather than wrapping").toBe(first);
    press("End");
    const last = title();
    expect(last).not.toBe(first);
    press("ArrowRight");
    expect(title(), "it stays on the last point").toBe(last);
  });

  it("announces the values at the point the keys have reached", () => {
    press("Home");
    expect(live()).toContain("Cash invested");
    expect(live()).toContain("$0");
    press("End");
    expect(live()).toContain("Projected");
    expect(live()).toContain("$11k");
  });

  it("hides the tooltip on Escape and when focus leaves", () => {
    press("ArrowRight");
    expect(title()).not.toBeNull();
    press("Escape");
    expect(title()).toBeNull();
    expect(live()).toBe("");
    press("ArrowRight");
    act(() => {
      chart().dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
    });
    expect(title()).toBeNull();
  });

  it("keeps the page from scrolling on the keys it uses, and ignores the rest", () => {
    expect(press("ArrowRight").defaultPrevented).toBe(true);
    expect(press("Tab").defaultPrevented).toBe(false);
    expect(press("a").defaultPrevented).toBe(false);
  });

  it("lets Escape through when nothing is showing (so it can still close a dialog)", () => {
    expect(press("Escape").defaultPrevented).toBe(false);
  });
});
