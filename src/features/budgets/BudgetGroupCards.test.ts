import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Budget category name wrapping", () => {
  it("wraps between words instead of splitting words in the Budget-only rule", () => {
    const css = readFileSync(new URL("./BudgetGroupCards.css", import.meta.url), "utf8");
    const rule = css.match(/\.budget-view \.cat-row-name \.category-link\s*\{([^}]*)\}/);
    expect(rule, "Budget category name rule").not.toBeNull();
    expect(rule![1]).toMatch(/white-space:\s*normal\s*;/);
    expect(rule![1]).toMatch(/overflow-wrap:\s*normal\s*;/);
    expect(rule![1]).toMatch(/word-break:\s*normal\s*;/);
    expect(rule![1]).not.toMatch(/anywhere|break-all|break-word/);
  });
});
