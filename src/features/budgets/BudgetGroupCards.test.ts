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

describe("Spending against the plan styles (VS-31 stream B)", () => {
  const css = readFileSync(new URL("./BudgetGroupCards.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("/* VS-31 stream B"));

  it("lets a category name wrap between words: the global button rule is nowrap", () => {
    expect(block).toMatch(/\.budget-plan \.category-bars-select[^{]*\{[^}]*white-space:\s*normal/);
  });

  it("uses theme variables, never a hex or rgb colour", () => {
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});

describe("Budget's old summary strip styles (VS-31 step 3)", () => {
  const css = readFileSync(new URL("./BudgetAndGoals.css", import.meta.url), "utf8");

  it("no longer carries the rules of the strip the plan card replaced", () => {
    const selectors = css.replace(/\/\*[^]*?\*\//g, "").split("{").map((part) => part.split("}").pop()!.trim());
    for (const name of [".budget-summary", ".budget-summary-grid", ".budget-summary-cell", ".budget-summary-sub"]) {
      expect(selectors.filter((sel) => sel.split(",").some((one) => one.trim() === name)), name).toEqual([]);
    }
    expect(css).not.toMatch(/\.budget-summary \.budget-allocation/);
  });

  it("keeps the note rule, which the plan card still uses", () => {
    expect(css).toMatch(/\.budget-summary-note\s*\{/);
  });
});

// Owner decision 17.12: the Flexible card clipped "-$1,140.00" (a category far over plan). The Left column now
// has room for eleven characters, and the row still fits the narrowest two-column card.
describe("Budget group card columns (VS-31 step 3)", () => {
  const css = readFileSync(new URL("./BudgetGroupCards.css", import.meta.url), "utf8");
  const rule = css.match(/\.budget-view \.cat-row, \.budget-view \.cat-list-head \{([^}]*)\}/);
  const template = rule?.[1].match(/grid-template-columns:\s*([^;]*);/)?.[1] ?? "";
  const mins = [...template.matchAll(/minmax\((\d+)px/g)].map((m) => Number(m[1])).concat([...template.matchAll(/\s(\d+)px(?=\s|$)/g)].map((m) => Number(m[1])));
  const columns = template.split(/\s+(?![^(]*\))/).filter(Boolean);

  it("gives the Left column room for a figure like -$11,140.00", () => {
    expect(columns).toHaveLength(6);
    expect(Number(columns[3].match(/minmax\((\d+)px/)?.[1])).toBeGreaterThanOrEqual(78);
  });

  it("still fits the narrowest two-column card (489px inside, with five 8px gaps)", () => {
    expect(mins.reduce((a, b) => a + b, 0) + 5 * 8).toBeLessThanOrEqual(489);
  });
});

// VS-58: the Goals starter cards are buttons, and the global button rule is nowrap, so a description ran past its card at 1280px.
describe("Goals starter cards", () => {
  it("let the description wrap inside the card", () => {
    const css = readFileSync(new URL("./BudgetAndGoals.css", import.meta.url), "utf8");
    const rule = css.match(/\.goals-empty \.goals-empty-starter\s*\{([^}]*)\}/);
    expect(rule, "Goals starter card rule").not.toBeNull();
    expect(rule![1]).toMatch(/white-space:\s*normal\s*;/);
  });
});
