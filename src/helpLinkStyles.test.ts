import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The base `button:hover` rule (SharedButtons.css) fills a hovered button with the accent colour and
// outweighs `.help-link`, which left the ? button's text nearly unreadable on hover in every style.
describe("? Help button hover", () => {
  it("sets its own background on hover, so the accent fill from button:hover never applies", () => {
    const css = readFileSync(new URL("./AppShell.css", import.meta.url), "utf8");
    const hover = css.match(/\.help-link:hover\s*\{([^}]*)\}/);
    expect(hover, ".help-link:hover rule").not.toBeNull();
    expect(hover![1]).toMatch(/background(-color)?:\s*var\(--surface-hover\)/);
  });
});
