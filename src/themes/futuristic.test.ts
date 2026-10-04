// Futuristic's typefaces ship inside the app (SIL Open Font License), so the look holds offline and the
// theme adds no request to Google Fonts. The theme's CSS is loaded after App.css so it wins ties.
import { existsSync, readFileSync } from "node:fs";
import { readAppStyles } from "../cssTestUtils";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const css = read("./futuristic.css");

describe("Futuristic fonts", () => {
  it("bundles Barlow Condensed, DM Sans and Space Mono from the installed packages", () => {
    for (const pkg of ["barlow-condensed", "dm-sans", "space-mono"]) {
      expect(css, pkg).toMatch(new RegExp(`@import "@fontsource/${pkg}/latin-[1-9]00[.]css";`));
    }
  });

  it("names them in the theme's font tokens with local fallbacks", () => {
    expect(css).toMatch(/--font-display: "Barlow Condensed", "Arial Narrow", sans-serif;/);
    expect(css).toMatch(/--font-body: "DM Sans", "Segoe UI", sans-serif;/);
    expect(css).toMatch(/--font-mono: "Space Mono", Consolas, monospace;/);
  });

  it("no longer asks Google Fonts for the old Futuristic typefaces", () => {
    const html = read("../../index.html");
    for (const family of ["Orbitron", "Rajdhani", "Share+Tech+Mono", "Barlow", "DM+Sans", "Space+Mono"]) {
      expect(html, family).not.toContain(family);
    }
  });

  it("carries the font license with the app's source", () => {
    expect(existsSync(new URL("../../docs/THIRD-PARTY-FONTS.md", import.meta.url))).toBe(true);
    expect(read("../../docs/THIRD-PARTY-FONTS.md")).toContain("SIL OPEN FONT LICENSE");
  });

  it("is loaded after App.css", () => {
    const app = read("../App.tsx");
    const base = app.indexOf('import "./App.css";');
    const theme = app.indexOf('import "./themes/futuristic.css";');
    expect(base).toBeGreaterThan(-1);
    expect(theme).toBeGreaterThan(base);
  });
});

/** A selector list split at its top-level commas (not the ones inside :is(), :not(), …). */
function splitTopLevel(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === "(") depth++;
    else if (selector[i] === ")") depth--;
    else if (selector[i] === "," && depth === 0) {
      parts.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts;
}

// One canonical source for the theme, scoped so Default and Retro cannot change.
describe("Futuristic stylesheet", () => {
  const block = (selector: string) => {
    const at = css.indexOf(selector);
    expect(at, selector).toBeGreaterThan(-1);
    const open = css.indexOf("{", at);
    return css.slice(open + 1, css.indexOf("}", open)).replace(/\s+/g, " ").trim();
  };

  it("uses the Neon Ledger dark palette", () => {
    const dark = block(':root[data-palette="futuristic"][data-theme="dark"] {');
    for (const token of [
      "--bg: #070b13;",
      "--surface: #101723;",
      "--surface-2: #121c2a;",
      "--border: #263549;",
      "--border-soft: #1c2939;",
      "--text: #e9f4fc;",
      "--text-muted: #8da5ba;",
      "--positive: #8cf5a8;",
      "--negative: #ff4bac;",
      "--warning: #ffc470;",
      "--info: #a181ff;",
    ]) {
      expect(dark, token).toContain(token);
    }
    expect(block(':root[data-palette="futuristic"] {')).toContain("--sidebar-bg: #090d17;");
  });

  it("keeps the system-dark and explicit-dark token lists identical", () => {
    expect(block(':root[data-palette="futuristic"]:not([data-theme="light"]) {')).toBe(
      block(':root[data-palette="futuristic"][data-theme="dark"] {'),
    );
  });

  it("defines the three accents, with darker ink for light mode", () => {
    expect(block(':root[data-palette="futuristic"] {')).toContain("--neon: #00e5ff;");
    expect(block(':root[data-palette="futuristic"][data-accent="pink"] {')).toContain("--neon: #ff4bac;");
    expect(block(':root[data-palette="futuristic"][data-accent="violet"] {')).toContain("--neon: #a181ff;");
    expect(block(':root[data-palette="futuristic"] {')).toContain("--accent: #006f84;");
    expect(block(':root[data-palette="futuristic"][data-accent="pink"] {')).toContain("--accent: #ad1f62;");
    expect(block(':root[data-palette="futuristic"][data-accent="violet"] {')).toContain("--accent: #6248af;");
  });

  it("scopes every component rule to Futuristic without raising its specificity", () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...withoutComments.matchAll(/(^|[{}])\s*([^{}@]+?)\s*{/g)].map((m) => m[2].trim());
    const settingsOnly = /^\.(futuristic-options|accent-[a-z-]+|neon-intensity[a-z-]*|reduce-motion-row)\b/;
    for (const selector of selectors) {
      if (selector.startsWith(':root[data-palette="futuristic"]')) {
        // token blocks only: a custom-property list, no component rule hiding behind a :root selector
        expect(selector, selector).toMatch(/^:root\[data-palette="futuristic"\](\[data-accent="(pink|violet)"\]|:not\(\[data-theme="light"\]\)|\[data-theme="dark"\])?$/);
        continue;
      }
      for (const part of splitTopLevel(selector)) {
        expect(part.startsWith(':where([data-palette="futuristic"])') || settingsOnly.test(part), part).toBe(true);
      }
    }
  });

  it("is the only place Futuristic is styled", () => {
    const app = readAppStyles(false).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(app).not.toContain('data-palette="futuristic"');
  });
});

describe("Futuristic color syntax", () => {
  // The *-rgb tokens hold "r, g, b" with commas, which only the comma form of rgba() accepts;
  // rgb(var(--x-rgb) / a) is invalid and silently drops the whole declaration.
  it("uses the comma form wherever an -rgb token gets an alpha", () => {
    expect(css).not.toMatch(/rgb\(var\(--[a-z-]+-rgb\)\s*\//);
  });
});

// The bars light up like the Neon Ledger mockup: chart bars use their gradient and glow in their own
// color, and meter fills carry a halo of their fill. Glows scale with Neon intensity, so 0 turns them off.
describe("Futuristic chart bars and meters", () => {
  const rule = (selector: string) => {
    const at = css.indexOf(selector + " {");
    expect(at, selector).toBeGreaterThan(-1);
    const open = css.indexOf("{", at);
    return css.slice(open + 1, css.indexOf("}", open)).replace(/\s+/g, " ").trim();
  };

  it("fills chart bars with their gradient and a glow in the bar's color", () => {
    const bar = rule(':where([data-palette="futuristic"]) .chart-bar');
    expect(bar).toContain("fill: var(--bar-fill);");
    expect(bar).toMatch(/filter: drop-shadow\(0 0 calc\([0-9.]+px \* var\(--glow\)\) currentColor\);/);
  });

  it("gives meter fills a halo of their own fill, behind the fill", () => {
    expect(rule(':where([data-palette="futuristic"]) .progress-track')).toContain("overflow: visible;");
    expect(rule(':where([data-palette="futuristic"]) .progress-track')).toContain("isolation: isolate;");
    const halo = rule(':where([data-palette="futuristic"]) .progress-fill::after');
    expect(halo).toContain("background: inherit;");
    expect(halo).toContain("z-index: -1;");
    expect(halo).toMatch(/filter: blur\(calc\([0-9.]+px \* var\(--glow\)\)\);/);
  });
});
