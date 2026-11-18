import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// On screen the category-by-month table sizes its columns to the figures and scrolls inside its card.
// Paper can't scroll, so when printed the table must fit the page: no clipping wrapper, and cells may wrap.
describe("printing the Reports category-by-month table", () => {
  const css = readFileSync(new URL("./Transactions.css", import.meta.url), "utf8");
  const print = css.slice(css.indexOf("@media print"));

  it("lets the table spill out of its scroll box and wrap its cells on paper", () => {
    expect(print).toMatch(/\.report-table-scroll\s*\{[^}]*overflow:\s*visible/);
    expect(print).toMatch(/table\.ledger\.report-table\s*\{[^}]*table-layout:\s*fixed/);
    expect(print).toMatch(/\.report-table th,\s*\.report-table td\s*\{[^}]*white-space:\s*normal/);
  });

  // The app shell is a fixed-height window with its own scroll box (.main). Printed as-is, everything past the
  // first sheet is cut off (UAT-124: a 6-month report came out as one page ending at "Daily spending").
  it("lets the whole report flow onto as many pages as it needs instead of clipping at the window height", () => {
    expect(print).toMatch(/\.app-shell\s*\{[^}]*height:\s*auto/);
    expect(print).toMatch(/\.app-shell\s*\{[^}]*overflow:\s*visible/);
    expect(print).toMatch(/\.main\s*\{[^}]*overflow:\s*visible/);
    expect(print).toMatch(/html,\s*body\s*\{[^}]*height:\s*auto/);
  });

  it("gives the Category column room so its heading is not broken mid-word on paper", () => {
    expect(print).toMatch(/\.report-table th:first-child,\s*\.report-table td:first-child\s*\{[^}]*width:\s*\d+%/);
  });
});
