import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// VS-122: the Dashboard layout (two-column To do / Insights, Safe to spend / Runway, spending table, spacing)
// lived in default.css behind data-palette="transparent", so Futuristic and Retro stacked everything full width.
const defaultCss = readFileSync(new URL("../../themes/default.css", import.meta.url), "utf8");
const layoutCss = readFileSync(new URL("./DashboardLayout.css", import.meta.url), "utf8");
const mainTsx = readFileSync(new URL("../../main.tsx", import.meta.url), "utf8");

const DASHBOARD_PAGE = ".page:has(> .reports-view > .dashboard-toolbar)";

function rules(css: string): { selector: string; body: string }[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

describe("Dashboard layout is shared by every theme (VS-122)", () => {
  it("keeps no Dashboard layout rule behind the Default-only palette selector", () => {
    const stillDefaultOnly = rules(defaultCss).filter(
      (r) => r.selector.includes('data-palette="transparent"') && r.selector.includes(DASHBOARD_PAGE) && /display|grid-|padding|margin|gap|width/.test(r.body) && !/outline/.test(r.body),
    );
    expect(stillDefaultOnly.map((r) => r.selector)).toEqual([]);
  });

  it("puts To do and Insights side by side from 1200px, in whatever theme is active", () => {
    expect(layoutCss).toMatch(/@media\s*\(min-width:\s*1200px\)/);
    const grid = rules(layoutCss).find((r) => r.selector.endsWith('[data-widget-id="needs_a_look"]') && /display:\s*grid/.test(r.body));
    expect(grid).toBeDefined();
    expect(grid!.body).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(layoutCss).toMatch(/needs_a_look"\]\s*>\s*\.card:has\(\.todo-list\)\s*\{[^}]*grid-column:\s*1/);
    expect(layoutCss).toMatch(/needs_a_look"\]\s*>\s*\.card:has\(\.insights-list\)\s*\{[^}]*grid-column:\s*2/);
  });

  it("puts Safe to spend and Runway side by side when they sit next to each other", () => {
    expect(layoutCss).toMatch(/\[data-widget-id="safe_to_spend"\]\s*\+\s*\[data-widget-id="runway"\]/);
    expect(layoutCss).toMatch(/\[data-widget-id="runway"\]\s*\{[^}]*grid-column:\s*2/);
  });

  it("is scoped to the Dashboard page and to the light and dark modes, never to one palette", () => {
    const dashboardRules = rules(layoutCss);
    expect(dashboardRules.length).toBeGreaterThan(20);
    for (const r of dashboardRules) {
      expect(r.selector).toContain(DASHBOARD_PAGE);
      expect(r.selector).not.toMatch(/data-palette="(transparent|futuristic|retro)"/);
      expect(r.selector).toMatch(/^:root\[data-palette\]:is\(\[data-theme="light"\],\[data-theme="dark"\]\)/);
    }
  });

  it("loads after default.css so Default keeps its place in the cascade", () => {
    const order = [...mainTsx.matchAll(/import "([^"]+\.css)";/g)].map((m) => m[1]);
    expect(order.indexOf("./features/dashboard/DashboardLayout.css")).toBe(order.indexOf("./themes/default.css") + 1);
    expect(order.indexOf("./themes/default.css")).toBeGreaterThanOrEqual(0);
  });
});
