// Futuristic's typefaces ship inside the app (SIL Open Font License), so the look holds offline and the
// theme adds no request to Google Fonts. The theme's CSS is loaded after App.css so it wins ties.
import { existsSync, readFileSync } from "node:fs";
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
