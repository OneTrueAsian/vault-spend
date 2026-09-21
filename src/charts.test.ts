import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SeriesChart, monthAxisLabel, timeTicks, type SeriesChartSeries } from "./charts";

const at = (year: number, month1: number) => year * 12 + (month1 - 1);

describe("timeTicks", () => {
  it("names every month of a short span, once each", () => {
    const ticks = timeTicks(at(2026, 9) + 0.2, at(2026, 12) + 0.5);
    expect(ticks.map((t) => t.label)).toEqual(["Oct 2026", "Nov 2026", "Dec 2026"]);
  });

  it("never repeats a label across several years (no '2027, 2027')", () => {
    const ticks = timeTicks(at(2026, 9), at(2029, 9));
    const labels = ticks.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  });

  it("uses whole years, on January, once the span is long", () => {
    const ticks = timeTicks(at(2026, 9), at(2036, 9));
    expect(ticks.every((t) => t.x % 12 === 0)).toBe(true);
    expect(ticks.every((t) => /^\d{4}$/.test(t.label))).toBe(true);
    expect(ticks.map((t) => t.label)).toEqual(["2028", "2030", "2032", "2034", "2036"]);
  });

  it("keeps every tick inside the span, in order", () => {
    const min = at(2026, 9) + 0.66;
    const max = at(2031, 3) + 0.1;
    const ticks = timeTicks(min, max);
    expect(ticks.every((t) => t.x >= min && t.x <= max)).toBe(true);
    expect(ticks.map((t) => t.x)).toEqual([...ticks.map((t) => t.x)].sort((a, b) => a - b));
  });

  it("uses fewer labels when asked to (a narrow chart)", () => {
    expect(timeTicks(at(2026, 9), at(2029, 9), 4).length).toBeLessThanOrEqual(4);
  });

  it("falls back to the two ends when no calendar boundary fits inside", () => {
    const ticks = timeTicks(at(2026, 9) + 0.2, at(2026, 9) + 0.7);
    expect(ticks.map((t) => t.x)).toEqual([at(2026, 9) + 0.2, at(2026, 9) + 0.7]);
  });
});

describe("monthAxisLabel", () => {
  it("names a month and year, or just the year on a long span", () => {
    expect(monthAxisLabel(at(2026, 9) + 0.5, 0)).toBe("Sep 2026");
    expect(monthAxisLabel(at(2031, 1), 60)).toBe("2031");
  });
});

describe("SeriesChart", () => {
  const render = (series: SeriesChartSeries[]) => renderToStaticMarkup(createElement(SeriesChart, { series, ariaLabel: "test chart" }));

  it("draws nothing when no series has a point (not an empty grid with made-up axis labels)", () => {
    const markup = render([
      { key: "invested", name: "Cash invested", color: "grey", points: [] },
      { key: "projected", name: "Projected", color: "blue", dashed: true, points: [] },
    ]);
    expect(markup).toBe("");
  });

  it("still draws the series that have points once something can be drawn", () => {
    const markup = render([
      { key: "invested", name: "Cash invested", color: "grey", points: [{ x: at(2026, 1), value: 0 }, { x: at(2026, 9), value: 5540 }] },
      { key: "projected", name: "Projected", color: "blue", dashed: true, points: [] },
    ]);
    expect(markup).toContain('data-series="invested"');
    expect(markup).not.toContain('data-series="projected"');
    expect(markup).not.toMatch(/undefined|NaN/);
  });
});