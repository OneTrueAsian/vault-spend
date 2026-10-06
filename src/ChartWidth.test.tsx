// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BarChart, LineChart, SeriesChart } from "./charts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let resize: (width: number) => void;
const disconnect = vi.fn();
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    active = false;
    constructor(callback: ResizeObserverCallback) {
      resize = (width) => {
        if (this.active) callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      };
    }
    observe() { this.active = true; resize(900); }
    disconnect() { this.active = false; disconnect(); }
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const data = ["Jan", "Feb", "Mar"].map((label, index) => ({ label, values: [{ value: 100 + index, color: "var(--accent)" }] }));
const charts = {
  BarChart: <BarChart data={data} />,
  LineChart: <LineChart points={data.map(d => ({ label: d.label, value: d.values[0].value }))} />,
  SeriesChart: <SeriesChart ariaLabel="Worth" series={[{ key: "worth", name: "Worth", color: "var(--accent)", points: [{ x: 1, value: 100 }, { x: 2, value: 120 }] }]} />,
};
describe("charts measured at the card width", () => {
  for (const [name, chart] of Object.entries(charts)) {
    it(`${name} draws at 900px and follows resizing without stretching labels`, () => {
      act(() => root.render(chart));
      const svg = host.querySelector("svg")!;
      expect(svg.getAttribute("viewBox")).toMatch(/^0 0 900 /);
      act(() => resize(640));
      expect(svg.getAttribute("viewBox")).toMatch(/^0 0 640 /);
      act(() => resize(0));
      expect(svg.getAttribute("viewBox")).toMatch(/^0 0 640 /);
      act(() => resize(180));
      expect(svg.getAttribute("viewBox")).toMatch(/^0 0 280 /);
      act(() => root.render(null));
      expect(disconnect).toHaveBeenCalled();
    });
  }
  it("keeps observing after StrictMode cleans up and restarts effects", () => {
    act(() => root.render(<StrictMode>{charts.LineChart}</StrictMode>));
    act(() => resize(640));
    expect(host.querySelector("svg")?.getAttribute("viewBox")).toMatch(/^0 0 640 /);
  });
  it("measures a SeriesChart when its data arrives after an empty render", () => {
    act(() => root.render(<SeriesChart ariaLabel="Worth" series={[]} />));
    expect(host.querySelector("svg")).toBeNull();
    act(() => root.render(charts.SeriesChart));
    expect(host.querySelector("svg")?.getAttribute("viewBox")).toMatch(/^0 0 900 /);
    act(() => root.render(<SeriesChart ariaLabel="Worth" series={[]} />));
    expect(disconnect).toHaveBeenCalled();
  });
  it("uses the supplied fallback when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    act(() => root.render(<LineChart width={720} points={[{ label: "Jan", value: 100 }]} />));
    expect(host.querySelector("svg")?.getAttribute("viewBox")).toMatch(/^0 0 720 /);
  });
  it("leaves room for the last line-chart date label", () => {
    act(() => root.render(<LineChart points={[{ label: "Nov 30", value: 100 }, { label: "Oct 6", value: 120 }]} />));
    const svg = host.querySelector("svg")!;
    const lastLabel = [...svg.querySelectorAll("text")].find(label => label.textContent === "Oct 6")!;
    const textHalfWidth = "Oct 6".length * 12 * .62 / 2;
    expect(Number(lastLabel.getAttribute("x")) + textHalfWidth).toBeLessThanOrEqual(900);
  });
  it("leaves room for the last series-chart month label", () => {
    act(() => root.render(<SeriesChart ariaLabel="Worth" series={[{ key: "w", name: "Worth", color: "var(--accent)", points: [{ x: 2026 * 12, value: 100 }, { x: 2026 * 12 + 2, value: 120 }] }]} />));
    const lastLabel = [...host.querySelectorAll("text")].find(label => label.textContent === "Mar 2026")!;
    expect(Number(lastLabel.getAttribute("x")) + "Mar 2026".length * 12 * .62 / 2).toBeLessThanOrEqual(900);
  });
  it("centres capped bars in each group in a wide card", () => {
    act(() => root.render(<BarChart data={data} />));
    const bars = [...host.querySelectorAll(".chart-bar")];
    expect(bars).toHaveLength(3);
    for (const bar of bars) expect(Number(bar.getAttribute("width"))).toBe(48);
    const groups = [...host.querySelectorAll('rect[fill="transparent"]')];
    bars.forEach((bar, i) => {
      expect(Number(bar.getAttribute("x")) + 24).toBeCloseTo(Number(groups[i].getAttribute("x")) + Number(groups[i].getAttribute("width")) / 2);
    });
  });
});
