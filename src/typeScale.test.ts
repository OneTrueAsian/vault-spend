// No readable text below 12px (2026-10-02 QA, L2: 39 declarations went as low as 9.5px, including
// chart axes, calendar entries, stat labels and table headers). Only arrow glyphs drawn as text
// (disclosure markers, a menu caret) may be smaller.
import { readAppStyles, readCssWithImports } from "./cssTestUtils";
import { describe, expect, it } from "vitest";

const SHEETS = ["./App.css", "./themes/futuristic.css", "./InfoTip.css", "./AutoLockSession.css"];
const GLYPHS_ONLY = ["summary::before", ".account-filter-caret"];

describe("type scale", () => {
  it("sets no text below 12px outside arrow glyphs", () => {
    const tooSmall: string[] = [];
    for (const sheet of SHEETS) {
      const css = (sheet === "./App.css" ? readAppStyles() : readCssWithImports(new URL(sheet, import.meta.url))).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1].trim();
        for (const size of rule[2].matchAll(/font-size:\s*([\d.]+)px/g)) {
          if (Number(size[1]) < 12 && !GLYPHS_ONLY.some((g) => selector.includes(g))) tooSmall.push(`${sheet} ${selector}: ${size[1]}px`);
        }
      }
    }
    expect(tooSmall).toEqual([]);
  });
});
