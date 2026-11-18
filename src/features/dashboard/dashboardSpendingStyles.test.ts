import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./DashboardCards.css", import.meta.url), "utf8");
const block = css.slice(css.indexOf("/* VS-31 stream D"));

describe("Dashboard spending and goals styles (VS-31 stream D)", () => {
  it("lets names and the recent-transactions row wrap between words: the global button rule is nowrap", () => {
    expect(block).toMatch(/\.dashboard-spending \.category-bars-select\s*\{[^}]*white-space:\s*normal/);
    expect(block).toMatch(/\.dashboard-pair-row \.recent-transaction\s*\{[^}]*white-space:\s*normal/);
  });

  it("sizes the goal icon itself, since the pinned-widget icon rules only apply inside a stat card", () => {
    expect(block).toMatch(/\.dashboard-goal-icon svg[^{]*\{[^}]*width:\s*18px/);
  });

  it("uses theme variables, never a hex or rgb colour", () => {
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
