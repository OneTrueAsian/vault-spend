// The category colors used by Dashboard, Cash Flow and Reports come from one list of CSS variables, so a
// style can recolor every chart and legend together, and a category keeps its place in the list (and so
// its color) across those views.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATEGORY_COLORS, categoryColor } from "./categoryPalette";

const css = readFileSync(new URL("./App.css", import.meta.url), "utf8");

describe("category palette", () => {
  it("is six CSS variables, cycled in order", () => {
    expect(CATEGORY_COLORS).toEqual([1, 2, 3, 4, 5, 6].map((n) => `var(--cat-${n})`));
    expect(categoryColor(0)).toBe("var(--cat-1)");
    expect(categoryColor(5)).toBe("var(--cat-6)");
    expect(categoryColor(6)).toBe("var(--cat-1)");
    expect(categoryColor(-1)).toBe("var(--cat-1)");
  });

  it("keeps the original colors for every style that does not recolor them", () => {
    const base = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
    const original = ["#1E9E76", "#3E7CB8", "#C08A2E", "#8A5FB0", "#BD5B3C", "#4E8FC9"];
    original.forEach((hex, i) => expect(base, `--cat-${i + 1}`).toContain(`--cat-${i + 1}: ${hex};`));
  });

  it("is the only category list: the views no longer carry their own", () => {
    for (const file of ["DashboardView.tsx", "CashFlowView.tsx", "ReportsOverview.tsx", "InvestmentsView.tsx"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/const (CATEGORY|CLASS)_COLORS\s*=/);
      expect(source, file).not.toMatch(/#(1E9E76|3E7CB8|C08A2E|8A5FB0|BD5B3C|4E8FC9)/i);
    }
  });
});
