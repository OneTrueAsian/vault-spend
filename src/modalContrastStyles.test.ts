import { describe, expect, it } from "vitest";
import { readAppStyles } from "./cssTestUtils";

// QA-A11Y-003: in the Default style's light theme the dialog panel is a see-through 40% white over
// the dimmed page, which composites to about #afb2b2. The muted label colour (#5a5a61) measured
// 3.2:1 on that. The panel has to be opaque enough for every text colour a dialog uses to reach 4.5:1.

type Rgba = [number, number, number, number];

function parseColor(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), 1];
  const rgba = value.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  throw new Error(`unparsed colour ${value}`);
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The declarations of the first rule whose selector is exactly `selector`. */
function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

function token(declarations: string, name: string): string {
  const match = declarations.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`no ${name}`);
  return match[1].trim();
}

describe("Default light dialog panel contrast", () => {
  const css = readAppStyles(false);
  const light = block(css, ':root[data-palette="transparent"]');
  const overlay = parseColor(token(block(css, ".modal-overlay"), "background"));
  // The dimmed page behind the panel: the lightest page colour under the overlay is the worst case
  // for dark text only when the panel is see-through, so use the page token itself.
  const behind = over(overlay, parseColor(token(light, "--bg")));

  function panelSurface(): Rgba {
    const panelRule = css.match(/\[data-palette="transparent"\] \.modal-panel\s*\{([^}]*)\}/g)?.join("\n") ?? "";
    const own = panelRule.match(/background:\s*([^;]+);/);
    const value = own ? own[1].trim() : "var(--surface)";
    const resolved = value.replace(/var\((--[a-z-]+)(?:,\s*[^)]*)?\)/, (_m, name) => token(light, name));
    return over(parseColor(resolved), behind);
  }

  it.each(["--text", "--text-muted", "--text-faint"])("keeps %s at 4.5:1 or better on the composited panel", (name) => {
    expect(contrast(parseColor(token(light, name)), panelSurface())).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["success green", "#136d2f"],
    ["error red", "#d70015"],
  ])("keeps the %s used in dialogs readable on the panel", (_label, colour) => {
    expect(contrast(parseColor(colour), panelSurface())).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves the shared surface tokens alone, so cards and the sidebar keep their glass", () => {
    expect(token(light, "--surface")).toBe("rgba(255, 255, 255, 0.40)");
    expect(token(light, "--surface-2")).toBe("rgba(255, 255, 255, 0.25)");
  });
});
