import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// QA (continuation 12 matrix): in the Futuristic style's light theme the profile switcher on the rail is forced dark (#101927) but its ▾ kept
// the page's muted text colour (#405d70), about 2.5:1, so the dropdown affordance was barely visible. It must use the rail's own dim text colour.
const css = readFileSync(new URL("./themes/futuristic.css", import.meta.url), "utf8");
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("Futuristic profile switcher caret", () => {
  it("has its own colour rule using the rail's dim text colour", () => {
    const rule = css.match(/\.profile-switcher-toggle\s+\.account-filter-caret\s*\{([^}]*)\}/);
    expect(rule, "caret rule").not.toBeNull();
    expect(rule![1]).toMatch(/color:\s*var\(--sidebar-text-dim\)/);
  });
  it("reads at 4.5:1 or better against the rail's dark toggle", () => {
    const dim = css.match(/--sidebar-text-dim:\s*(#[0-9a-f]{6})/i)?.[1];
    const toggle = css.match(/\.profile-switcher-toggle\s*\{[^}]*background:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(dim && toggle).toBeTruthy();
    expect(ratio(dim!, toggle!)).toBeGreaterThanOrEqual(4.5);
  });
});
