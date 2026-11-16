import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// VS-31 step 0: the shared chart pieces (CategoryBars, SegmentBar, StackedRows) take every color from
// theme variables, so all three styles in light and dark recolor them, and no fixed color can
// disappear against a dark background.
const css = readFileSync(new URL("./ChartPieces.css", import.meta.url), "utf8");

describe("ChartPieces.css colors", () => {
  it("uses no fixed hex, rgb or hsl colors", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/i);
  });

  // Review finding: the global `button:hover` (SharedButtons.css) and Retro's raised `:where(button)` look would
  // turn a clickable category name into an accent-filled or raised button.
  it("keeps clickable category names looking like text, on hover too and in Retro", () => {
    const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.:]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule(".category-bars .category-bars-select")).toMatch(/box-shadow:\s*none/);
    const hover = rule(".category-bars .category-bars-select:hover");
    expect(hover).toMatch(/background(-color)?:\s*(none|transparent)/);
    expect(hover).toMatch(/border-color:\s*transparent/);
    expect(hover).toMatch(/box-shadow:\s*none/);
    expect(hover).toMatch(/color:\s*inherit/);
  });

  // Investments' run 1 failed feature156: --surface is see-through in the Transparent style, so the muted amount
  // on a segment label read against the bar's colour (3.0 to 4.3:1). --bg is solid in every style.
  it("puts segment labels on the solid page background, and hides a label that was cut short", () => {
    const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.:]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule(".segment-bar-seg-text")).toMatch(/background:\s*var\(--bg\)/);
    expect(rule(".segment-bar-seg-text.is-cut")).toMatch(/visibility:\s*hidden/);
  });

  it("uses only theme variables that App.css defines", () => {
    const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    for (const name of used) expect(appCss, `${name} is defined`).toContain(`${name}:`);
  });
});
