import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Checkboxes are 20% larger than they were so they are easier to click: the browser's 13px box is 15.6px,
// the new-profile form's 16px box is 19.2px, and the phone and setup-wizard 22px box (with its 13x12 check)
// is 26.4px (15.6x14.4).
const css = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const block = (source: string, selector: string) => {
  const start = source.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf("}", start));
};

describe("checkbox size", () => {
  it("makes every native checkbox 20% larger than the 13px default, from one shared size", () => {
    const shared = css("SharedControls.css");
    expect(block(shared, ":root")).toMatch(/--checkbox-size:\s*15\.6px/);
    const rule = block(shared, 'input[type="checkbox"]');
    expect(rule).toMatch(/width:\s*var\(--checkbox-size\)/);
    expect(rule).toMatch(/height:\s*var\(--checkbox-size\)/);
  });

  it("scales the new-profile form's box and the phone pages' custom box and check the same 20%", () => {
    expect(block(css("Modal.css"), ".category-create-form .checkbox-label input")).toMatch(/width:\s*19\.2px;[^}]*height:\s*19\.2px/);
    const mobile = css("MobileControls.css");
    expect(mobile).toMatch(/width:\s*26\.4px;\s*height:\s*26\.4px;\s*min-height:\s*26\.4px;\s*flex:\s*0 0 26\.4px/);
    expect(mobile).toMatch(/::before\s*\{[^}]*width:\s*15\.6px;\s*height:\s*14\.4px/);
  });

  it("leaves no other stylesheet sizing a checkbox", () => {
    const others = ["Transactions.css", "BudgetAndGoals.css", "HoldingImportDialog.css", "SettingsPage.css", "themes/futuristic.css", "themes/retro.css"];
    for (const name of others) {
      expect(css(name), name).not.toMatch(/input\[type=["']?checkbox["']?\][^{]*\{[^}]*\b(width|height)\s*:/);
    }
  });
});
