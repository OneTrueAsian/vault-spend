// @vitest-environment jsdom
//
// VS-31 step 0 (F3): a labelled segment bar, one or more rows on one scale. Accounts uses it for
// "What you own and owe" (an Own row and an Owe row); Investments for "What your investments are in".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SegmentBar, type SegmentRow } from "./SegmentBar";
import { startPrivacyMask } from "../lib/privacy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const ownOwe: SegmentRow[] = [
  {
    label: "Own",
    segments: [
      { label: "Invested", amount: 25879, color: "var(--cat-1)" },
      { label: "Cash and savings", amount: 11188, color: "var(--cat-2)" },
      { label: "Property", amount: 17000, color: "var(--cat-3)" },
    ],
  },
  { label: "Owe", segments: [{ label: "Cards and loans", amount: 15824, color: "var(--negative)" }] },
];

const visualRows = () => [...host.querySelectorAll<HTMLElement>(".segment-bar-row")];
const segs = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>(".segment-bar-seg")];
const tableRows = () => [...host.querySelectorAll(".sr-only table tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent));

describe("SegmentBar", () => {
  it("draws each row's segments on one scale set by the largest row total", () => {
    act(() => root.render(<SegmentBar rows={ownOwe} caption="What you own and owe" />));
    const [own, owe] = visualRows();
    const scale = 25879 + 11188 + 17000;
    expect(segs(own).map((s) => s.style.width)).toEqual([25879, 11188, 17000].map((v) => `${(v / scale) * 100}%`));
    expect(segs(owe).map((s) => s.style.width)).toEqual([`${(15824 / scale) * 100}%`]);
    expect(segs(own)[0].style.background).toBe("var(--cat-1)");
  });

  it("labels each segment and row in visible text, with the row's total", () => {
    act(() => root.render(<SegmentBar rows={ownOwe} caption="What you own and owe" />));
    const [own] = visualRows();
    expect(own.querySelector(".segment-bar-label")?.textContent).toBe("Own");
    expect(segs(own)[0].textContent).toBe("Invested$25,879.00");
    expect(own.querySelector(".segment-bar-total")?.textContent).toBe("$54,067.00");
  });

  it("can leave out the row label for a single-row bar", () => {
    act(() => root.render(<SegmentBar rows={[{ segments: ownOwe[0].segments }]} caption="What your investments are in" />));
    expect(visualRows()[0].querySelector(".segment-bar-label")).toBeNull();
  });

  it("names the picture without amounts, and gives screen readers the exact figures in a table", () => {
    act(() => root.render(<SegmentBar rows={ownOwe} caption="What you own and owe" />));
    const pic = host.querySelector(".segment-bar")!;
    expect(pic.getAttribute("role")).toBe("img");
    expect(pic.getAttribute("aria-label")).toBe("What you own and owe");
    expect(host.querySelector(".sr-only table caption")?.textContent).toBe("What you own and owe");
    expect(tableRows()).toEqual([
      ["Own", "Invested", "$25,879.00"],
      ["Own", "Cash and savings", "$11,188.00"],
      ["Own", "Property", "$17,000.00"],
      ["Own", "Total", "$54,067.00"],
      ["Owe", "Cards and loans", "$15,824.00"],
      ["Owe", "Total", "$15,824.00"],
    ]);
  });

  it("gives a zero or negative segment no width but keeps its real figure", () => {
    const rows: SegmentRow[] = [{ label: "Owe", segments: [{ label: "Card (overpaid)", amount: -50, color: "var(--cat-1)" }, { label: "Loan", amount: 900, color: "var(--cat-2)" }, { label: "Empty", amount: 0, color: "var(--cat-3)" }] }];
    act(() => root.render(<SegmentBar rows={rows} caption="Owe" />));
    expect(segs(visualRows()[0]).map((s) => s.style.width)).toEqual(["0%", "100%", "0%"]);
    expect(tableRows()).toContainEqual(["Owe", "Card (overpaid)", "-$50.00"]);
    expect(tableRows()).toContainEqual(["Owe", "Total", "$850.00"]);
  });

  it("still shows a row whose only figure is negative (an overpaid card), rather than the empty message", () => {
    act(() => root.render(<SegmentBar rows={[{ label: "Owe", segments: [{ label: "Card (overpaid)", amount: -50, color: "var(--cat-1)" }] }]} caption="Owe" />));
    expect(host.querySelector(".empty-state")).toBeNull();
    expect(visualRows()[0].querySelector(".segment-bar-total")?.textContent).toBe("-$50.00");
    expect(tableRows()).toContainEqual(["Owe", "Card (overpaid)", "-$50.00"]);
  });

  it("shows a plain message when there is nothing to draw", () => {
    act(() => root.render(<SegmentBar rows={[{ label: "Own", segments: [{ label: "Cash", amount: 0, color: "var(--cat-1)" }] }]} caption="What you own and owe" emptyText="Add an account to see this." />));
    expect(host.querySelector(".segment-bar")).toBeNull();
    expect(host.querySelector(".empty-state")?.textContent).toBe("Add an account to see this.");
  });

  it("uses a default empty message for no rows", () => {
    act(() => root.render(<SegmentBar rows={[]} caption="Mix" />));
    expect(host.querySelector(".empty-state")?.textContent).toBe("Nothing to show yet.");
  });

  it("keeps amounts out of every attribute", () => {
    act(() => root.render(<SegmentBar rows={ownOwe} caption="What you own and owe" />));
    for (const el of host.querySelectorAll("*")) {
      for (const attr of el.attributes) expect(attr.value, `${el.tagName} ${attr.name}`).not.toMatch(/\$\s?\d/);
    }
  });

  it("names a segment inside the bar only when it is at least 15% of its row, as in v9; the table still has every part", () => {
    const rows: SegmentRow[] = [{ segments: [
      { label: "US stocks", amount: 8000, color: "var(--cat-1)" },
      { label: "Bonds", amount: 1500, color: "var(--cat-2)" },
      { label: "Cash", amount: 500, color: "var(--cat-3)" },
    ] }];
    act(() => root.render(<SegmentBar rows={rows} caption="Mix" />));
    expect(segs(visualRows()[0]).map((s) => s.querySelector(".segment-bar-seg-text")?.textContent ?? null)).toEqual(["US stocks$8,000.00", "Bonds$1,500.00", null]);
    expect(tableRows()).toContainEqual(["", "Cash", "$500.00"]);
  });

  describe("a label too long for its segment", () => {
    let resize: () => void = () => {};
    let wide = true;
    const isTag = (el: HTMLElement) => el.classList.contains("segment-bar-seg-text");
    beforeEach(() => {
      wide = true;
      vi.stubGlobal("ResizeObserver", class {
        constructor(callback: ResizeObserverCallback) { resize = () => callback([], this as unknown as ResizeObserver); }
        observe() {}
        disconnect() {}
      });
      // jsdom has no layout: the "International stocks" tag is wider than it may be until `wide` turns off.
      vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
        return isTag(this) && wide && this.textContent?.startsWith("International") ? 160 : 90;
      });
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
        return isTag(this) ? 90 : 0;
      });
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });
    const tags = () => [...host.querySelectorAll<HTMLElement>(".segment-bar-seg-text")];
    const rows: SegmentRow[] = [{ segments: [
      { label: "US stocks", amount: 6000, color: "var(--cat-1)" },
      { label: "International stocks", amount: 4000, color: "var(--cat-2)" },
    ] }];

    it("is hidden whole rather than cut short (\"International stoc\"), and the others stay", () => {
      act(() => root.render(<SegmentBar rows={rows} caption="Mix" />));
      expect(tags().map((t) => t.classList.contains("is-cut"))).toEqual([false, true]);
    });

    it("comes back once the window is wide enough for it", () => {
      act(() => root.render(<SegmentBar rows={rows} caption="Mix" />));
      wide = false;
      act(() => resize());
      expect(tags().map((t) => t.classList.contains("is-cut"))).toEqual([false, false]);
    });
  });

  it("has every amount hidden when amounts are hidden", () => {
    act(() => root.render(<SegmentBar rows={ownOwe} caption="What you own and owe" />));
    const stop = startPrivacyMask(host);
    expect(host.textContent).not.toMatch(/\$\s?\d/);
    stop();
  });
});
