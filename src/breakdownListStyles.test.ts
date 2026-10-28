import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// A long member name with no spaces ran 23.5px past the Household card at 720px (e2e feature335): a flex row's first
// child keeps its full text width unless it may shrink and break anywhere. The amount must stay whole.
describe("Household breakdown rows", () => {
  const css = readFileSync(new URL("./SharedCards.css", import.meta.url), "utf8");
  const declarations = (selector: string) => {
    const start = css.indexOf(selector + " {");
    if (start < 0) return "";
    return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  };
  it("has a rule for the name that exists", () => {
    expect(css).toContain(".breakdown-list li {");
  });
  it("lets the name shrink and break inside its card", () => {
    expect(declarations(".breakdown-list li > span:first-child")).toMatch(/min-width:\s*0/);
    expect(declarations(".breakdown-list li > span:first-child")).toMatch(/overflow-wrap:\s*anywhere/);
  });
  it("keeps the amount whole", () => {
    expect(declarations(".breakdown-list li > span:last-child")).toMatch(/flex-shrink:\s*0/);
  });
});

// The Reports page's Net Worth by Member table ran 41px past the page at 720px with the same kind of name (e2e feature335).
describe('Reports member table names', () => {
  it('wraps a long unbroken member name inside its cell', () => {
    const css = readFileSync(new URL('./SharedCards.css', import.meta.url), 'utf8');
    const start = css.indexOf('.member-name-cell {');
    expect(start, '.member-name-cell rule').toBeGreaterThanOrEqual(0);
    expect(css.slice(css.indexOf("{", start), css.indexOf("}", start))).toMatch(/overflow-wrap:\s*anywhere/);
  });
  it('is used by the Reports table cell that prints the name', () => {
    const source = readFileSync(new URL('./ReportsOverview.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<td className="member-name-cell">{row.name}</td>');
  });
});

// A pinned account or goal tile with a long unbroken name ran 474px past the tile at 1280px (e2e feature338): the label is a flex child
// of .stat-top and keeps its full text width unless it may shrink and break anywhere.
describe('Dashboard tile labels', () => {
  it('let a long unbroken name shrink and wrap inside the tile', () => {
    const css = readFileSync(new URL('./DashboardCards.css', import.meta.url), 'utf8');
    const start = css.indexOf('.stat-top > .stat-label {');
    expect(start, '.stat-top > .stat-label rule').toBeGreaterThanOrEqual(0);
    const rule = css.slice(css.indexOf('{', start), css.indexOf('}', start));
    expect(rule).toMatch(/min-width:\s*0/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

// The "Rolled forward this month's starting balance…" message named an account with a long unbroken name and ran off the right edge of the
// screen (found in a retained screenshot, QA-UI-008): the text may shrink (min-width: 0) but could not break inside a word.
describe('Message text', () => {
  it('breaks inside a long unbroken name instead of leaving the message', () => {
    const css = readFileSync(new URL('./DashboardCards.css', import.meta.url), 'utf8');
    const start = css.indexOf('.status-text {');
    expect(start, '.status-text rule').toBeGreaterThanOrEqual(0);
    expect(css.slice(css.indexOf('{', start), css.indexOf('}', start))).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
