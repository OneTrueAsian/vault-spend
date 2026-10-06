import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// On screen the category-by-month table sizes its columns to the figures and scrolls inside its card.
// Paper can't scroll, so when printed the table must fit the page: no clipping wrapper, and cells may wrap.
describe("printing the Reports category-by-month table", () => {
  const css = readFileSync(new URL("./Ledger.css", import.meta.url), "utf8");
  const print = css.slice(css.indexOf("@media print"));

  it("lets the table spill out of its scroll box and wrap its cells on paper", () => {
    expect(print).toMatch(/\.report-table-scroll\s*\{[^}]*overflow:\s*visible/);
    expect(print).toMatch(/table\.ledger\.report-table\s*\{[^}]*table-layout:\s*fixed/);
    expect(print).toMatch(/\.report-table th,\s*\.report-table td\s*\{[^}]*white-space:\s*normal/);
  });
});
