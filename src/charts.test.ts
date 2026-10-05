import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BarChart, LineChart, SeriesChart, axisGutter, fmtMoneyShort, monthAxisLabel, timeTicks, type SeriesChartSeries } from "./charts";

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
// The value labels on a chart's left axis are drawn right-aligned against its gutter. A fixed
// 46-unit gutter cut off the "$" of six-character labels like "$267.9k" (UI review, 2026-10-04).
// Axis text is 12px; a digit is about 0.6em wide.
const AXIS_FONT = 12;
const needed = (label: string) => Math.ceil(label.length * AXIS_FONT * 0.6);
/** The x of each axis label in rendered markup, with its text. */
function axisLabels(markup: string): { x: number; text: string }[] {
  return [...markup.matchAll(/<text x="([\d.]+)"[^>]*class="axis-label"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), text: m[2] }));
}

describe("axisGutter", () => {
  it("leaves room for the widest label", () => {
    expect(axisGutter(["$267.9k", "$256k"])).toBeGreaterThanOrEqual(needed("$267.9k") + 8);
  });

  it("keeps the usual gutter for short labels", () => {
    expect(axisGutter(["$0", "$9k"])).toBe(46);
  });
});

describe("value axis labels fit inside the chart", () => {
  const fits = (markup: string) => {
    const labels = axisLabels(markup);
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l.x, `"${l.text}" at x=${l.x}`).toBeGreaterThanOrEqual(needed(l.text));
  };

  it("LineChart: a net worth around $267k", () => {
    const points = [256_000, 259_500, 262_000, 264_900, 267_400].map((value, i) => ({ label: `M${i}`, value }));
    fits(renderToStaticMarkup(createElement(LineChart, { points })));
  });

  it("BarChart: monthly income around $19k", () => {
    const data = [{ label: "Aug", values: [{ value: 19_067.63, color: "green" }] }];
    fits(renderToStaticMarkup(createElement(BarChart, { data })));
  });

  it("SeriesChart: an account worth $1.2m", () => {
    const series: SeriesChartSeries[] = [{ key: "w", name: "Worth", color: "blue", points: [{ x: at(2026, 1), value: 1_150_000 }, { x: at(2026, 6), value: 1_234_567 }] }];
    fits(renderToStaticMarkup(createElement(SeriesChart, { series, ariaLabel: "Worth" })));
  });
});

describe("fmtMoneyShort", () => {
  it("shortens thousands and millions", () => {
    expect(fmtMoneyShort(267_900)).toBe("$267.9k");
    expect(fmtMoneyShort(1_234_567)).toBe("$1.2M");
    expect(fmtMoneyShort(-5_750)).toBe("-$5.8k");
    expect(fmtMoneyShort(64)).toBe("$64");
  });

  it("moves up a unit when rounding reaches it, instead of \"$1000k\" or \"$1000\"", () => {
    expect(fmtMoneyShort(999_960)).toBe("$1M");
    expect(fmtMoneyShort(999.6)).toBe("$1k");
    expect(fmtMoneyShort(-999_999)).toBe("-$1M");
  });
});
