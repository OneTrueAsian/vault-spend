import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Continuation 12 matrix (T01): the inline Delete confirmation's .btn-danger had dark brown text (#2a0f06) on --negative in every style. That is fine
// on the dark themes' light reds, but the light themes' reds (#d70015, #a00000, #ad1f62) gave 3.4:1, 1.9:1 and 2.6:1 (Axe: serious color-contrast).
// Each palette block that sets --negative must also set --on-negative, and the pair must reach 4.5:1.
const css = ["./App.css", "./themes/futuristic.css"].map(f => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function paletteBlocks() {
  const blocks: { selector: string; negative: string; onNegative?: string }[] = [];
  for (const m of css.matchAll(/([^{}]*data-palette="[a-z]+"[^{}]*)\{([^{}]*)\}/g)) {
    const neg = m[2].match(/--negative:\s*(#[0-9a-f]{6})/i)?.[1];
    if (neg) blocks.push({ selector: m[1].trim().split("\n").pop()!.trim(), negative: neg, onNegative: m[2].match(/--on-negative:\s*(#[0-9a-f]{6})/i)?.[1] });
  }
  return blocks;
}

describe("danger button text", () => {
  it("covers every palette block that sets --negative (3 palettes x light, dark, system dark)", () => {
    expect(paletteBlocks().length).toBe(9);
  });
  it("sets --on-negative in each of them and reaches 4.5:1 on --negative", () => {
    for (const b of paletteBlocks()) {
      expect(b.onNegative, `${b.selector} sets --on-negative`).toBeDefined();
      expect(ratio(b.onNegative!, b.negative), `${b.selector}: ${b.onNegative} on ${b.negative}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it(".btn-danger text uses that token", () => {
    const rule = readFileSync(new URL("./SharedButtons.css", import.meta.url), "utf8").match(/\.btn-danger\s*\{([^}]*)\}/);
    expect(rule![1]).toMatch(/color:\s*var\(--on-negative(,\s*#[0-9a-f]{6})?\)/);
  });
});
