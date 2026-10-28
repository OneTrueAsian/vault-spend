// @vitest-environment jsdom
//
// QA-OBS-002: the bar and line charts show their numbers only in a tooltip that appears on mouse hover, so a keyboard or
// screen-reader user had no way to read them. Like the Sankey and heatmap, each now carries a visually hidden table of the same figures.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BarChart, LineChart, SeriesChart } from "./charts";

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

const rowsOf = (table: HTMLTableElement) => [...table.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent));

describe("BarChart hidden table", () => {
  const data = [
    { label: "Aug", values: [{ value: 1600, color: "var(--positive)", name: "Income" }, { value: 1180.5, color: "var(--negative)", name: "Expenses" }] },
    { label: "Sep", values: [{ value: 900, color: "var(--positive)", name: "Income" }, { value: -80, color: "var(--negative)", name: "Expenses" }] },
  ];
  it("lists every bar's exact figure under its month, in a table a screen reader can reach", () => {
    act(() => root.render(<BarChart data={data} caption="Income and expenses by month" />));
    const wrapper = host.querySelector<HTMLElement>(".sr-only");
    expect(wrapper, "a visually hidden wrapper").not.toBeNull();
    const table = wrapper!.querySelector("table")!;
    expect(table.querySelector("caption")?.textContent).toBe("Income and expenses by month");
    expect(rowsOf(table)).toEqual([
      ["Aug", "Income", "$1,600.00"],
      ["Aug", "Expenses", "$1,180.50"],
      ["Sep", "Income", "$900.00"],
      ["Sep", "Expenses", "-$80.00"],
    ]);
  });
  it("names the picture so it is not read as unlabelled shapes", () => {
    act(() => root.render(<BarChart data={data} caption="Income and expenses by month" />));
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Income and expenses by month");
  });
});

describe("LineChart hidden table", () => {
  it("lists each point in the chart's own value format", () => {
    act(() => root.render(<LineChart points={[{ label: "Jan", value: 75 }, { label: "Feb", value: -10 }]} formatValue={(v) => `${v.toFixed(0)}%`} caption="Savings rate by month" />));
    const table = host.querySelector<HTMLElement>(".sr-only table") as HTMLTableElement;
    expect(table.querySelector("caption")?.textContent).toBe("Savings rate by month");
    expect(rowsOf(table)).toEqual([["Jan", "75%"], ["Feb", "-10%"]]);
    expect(host.querySelector("svg")!.getAttribute("role")).toBe("img");
  });
  it("prints dollar points with their cents when no format is given", () => {
    act(() => root.render(<LineChart points={[{ label: "Jan 5", value: 1234.5 }]} />));
    const table = host.querySelector<HTMLElement>(".sr-only table") as HTMLTableElement;
    expect(rowsOf(table)).toEqual([["Jan 5", "$1,234.50"]]);
  });
});

// QA-OBS-004: with a flat or tiny series the four gridline values round to the same short label ("$125" twice), which reads as an error.
// The gridlines stay; a label that would repeat its neighbour is left off, and the exact figures stay in the tooltip and the hidden table.
const valueAxisLabels = () => [...host.querySelectorAll<SVGTextElement>('text.axis-label[text-anchor="end"]')].map((t) => t.textContent);

describe("value-axis labels on a flat chart", () => {
  it("never print the same label twice on a line chart whose points are all equal", () => {
    act(() => root.render(<LineChart points={[{ label: "Jan", value: 125 }, { label: "Feb", value: 125 }, { label: "Mar", value: 125 }]} />));
    const labels = valueAxisLabels();
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
    expect(host.querySelectorAll("svg line").length).toBe(5);
    expect(rowsOf(host.querySelector<HTMLElement>(".sr-only table") as HTMLTableElement)).toEqual([["Jan", "$125.00"], ["Feb", "$125.00"], ["Mar", "$125.00"]]);
  });
  it("never print the same label twice on a bar chart of tiny amounts", () => {
    act(() => root.render(<BarChart data={[{ label: "Aug", values: [{ value: 0.5, color: "var(--positive)", name: "Income" }] }]} />));
    const labels = valueAxisLabels();
    expect(new Set(labels).size).toBe(labels.length);
    expect(rowsOf(host.querySelector<HTMLElement>(".sr-only table") as HTMLTableElement)).toEqual([["Aug", "Income", "$0.50"]]);
  });
  it("never print the same label twice on a series chart whose points are all equal", () => {
    act(() => root.render(<SeriesChart ariaLabel="Worth" series={[{ key: "worth", name: "Worth", color: "var(--accent)", points: [{ x: 1, value: 125 }, { x: 2, value: 125 }] }]} />));
    const labels = valueAxisLabels();
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });
  it("keeps all five labels when the values are far enough apart", () => {
    act(() => root.render(<LineChart points={[{ label: "Jan", value: 0 }, { label: "Feb", value: 10000 }]} />));
    expect(valueAxisLabels().length).toBe(5);
  });
});
