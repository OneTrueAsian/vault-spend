import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// In the Futuristic light style the accent-soft pair measured 3.59:1, under the 4.5:1 needed for small text.
// The "what I understood" chips use the plain text and surface colors, which every style keeps readable.
describe("Ask the Vault understood-as chips", () => {
  it("use the ordinary text and surface colors, not the soft accent pair", () => {
    const css = readFileSync(new URL("./BudgetAndGoals.css", import.meta.url), "utf8");
    const rule = css.match(/\.ledger-qa-chips li\s*\{([^}]*)\}/);
    expect(rule, ".ledger-qa-chips li rule").not.toBeNull();
    expect(rule![1]).not.toContain("accent-soft");
    expect(rule![1]).toMatch(/color:\s*var\(--text\)/);
  });
});
