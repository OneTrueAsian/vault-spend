import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Every button inherits `white-space: nowrap` from SharedButtons.css. The budget-alert banner is a button
// holding a whole sentence that names every budget needing attention, so on a narrow window (800px with the
// household demo data) it ran past the page edge and the Dashboard scrolled sideways (e2e feature270).
describe("budget alert banner", () => {
  it("wraps its sentence instead of inheriting the button's no-wrap rule", () => {
    const css = readFileSync(new URL("./Transactions.css", import.meta.url), "utf8");
    const rule = css.match(/\.budget-alert-banner\s*\{([^}]*)\}/);
    expect(rule, ".budget-alert-banner rule").not.toBeNull();
    expect(rule![1]).toMatch(/white-space:\s*normal/);
  });
});
