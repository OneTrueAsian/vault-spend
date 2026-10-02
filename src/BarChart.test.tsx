// @vitest-environment jsdom
//
// Futuristic draws the income and expense bars as lit columns: a gradient from a bright top to a dimmer
// base, with a glow in the bar's own color. The chart gives each bar its gradient and color so the theme's
// CSS can use them; Default and Retro keep the plain fill attribute.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BarChart } from "./charts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = [
  { label: "Aug", values: [{ value: 9000, color: "var(--positive)", name: "Income" }, { value: 6000, color: "var(--negative)", name: "Expenses" }] },
  { label: "Sep", values: [{ value: 9100, color: "var(--positive)", name: "Income" }, { value: 5800, color: "var(--negative)", name: "Expenses" }] },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<BarChart data={data} />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("BarChart bars", () => {
  it("marks every bar and keeps the plain fill for the other styles", () => {
    const bars = [...host.querySelectorAll<SVGRectElement>("rect.chart-bar")];
    expect(bars).toHaveLength(4);
    expect(bars.map((b) => b.getAttribute("fill"))).toEqual(["var(--positive)", "var(--negative)", "var(--positive)", "var(--negative)"]);
  });

  it("gives each bar its color, for the glow", () => {
    const bars = [...host.querySelectorAll<SVGRectElement>("rect.chart-bar")];
    expect(bars.map((b) => b.style.color)).toEqual(["var(--positive)", "var(--negative)", "var(--positive)", "var(--negative)"]);
  });

  it("points each bar at a vertical gradient of its own color", () => {
    for (const bar of host.querySelectorAll<SVGRectElement>("rect.chart-bar")) {
      const ref = bar.style.getPropertyValue("--bar-fill");
      const id = /^url\(#(.+)\)$/.exec(ref)?.[1];
      expect(id, ref).toBeTruthy();
      const grad = host.querySelector(`linearGradient[id="${id}"]`);
      expect(grad, id).not.toBeNull();
      expect(grad!.getAttribute("y1")).toBe("0");
      expect(grad!.getAttribute("y2")).toBe("1");
      const stops = [...grad!.querySelectorAll("stop")].map((s) => (s as SVGStopElement).style.stopColor);
      for (const stop of stops) expect(stop).toContain(bar.style.color);
    }
  });

  it("uses ids no other chart on the page shares", () => {
    const second = document.createElement("div");
    document.body.appendChild(second);
    const other = createRoot(second);
    act(() => other.render(<BarChart data={data} />));
    const ids = [...document.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    act(() => other.unmount());
    second.remove();
  });
});
