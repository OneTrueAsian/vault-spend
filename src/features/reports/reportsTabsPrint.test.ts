import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// What the saved PDF showed (UAT, and stream R's own look at it): amounts split inside the number, a heatmap with no colors,
// and a status message printed over the report.
describe("printing the Reports sections", () => {
  const css = readFileSync(new URL("./ReportsTabs.css", import.meta.url), "utf8");
  const print = css.slice(css.indexOf("@media print"));

  it("hides the tab panels and shows the print-only copy of every section", () => {
    expect(css).toMatch(/\.reports-print-all\s*\{[^}]*display:\s*none/);
    expect(print).toMatch(/\.reports-view\[data-printing\] \.reports-panel\s*\{[^}]*display:\s*none/);
    expect(print).toMatch(/\.reports-view\[data-printing\] \.reports-print-all\s*\{[^}]*display:\s*block/);
  });

  it("keeps the flow chart and heatmap inside the sheet instead of a scroll bar", () => {
    expect(print).toMatch(/\.reports-print-all \.table-scroll\s*\{[^}]*overflow:\s*visible/);
    expect(print).toMatch(/\.reports-print-all \.sankey-svg\s*\{[^}]*min-width:\s*0/);
  });

  it("keeps each amount in the category table whole and shrinks the table to fit, more for a long range", () => {
    expect(print).toMatch(/\.report-table td\.amount-col,[^{]*\{[^}]*white-space:\s*nowrap/);
    expect(print).toMatch(/\.reports-print-all \.report-table th,\s*\.reports-print-all \.report-table td\s*\{[^}]*font-size:\s*10px/);
    expect(print).toMatch(/\.report-table-wide td\s*\{[^}]*font-size:\s*8px/);
  });

  it("asks paper to print the heatmap's colors", () => {
    expect(print).toMatch(/\.heatmap-cell,[^{]*\{[^}]*print-color-adjust:\s*exact/);
  });

  // VS-31 step 3: a status message is left off every print in the app, so the rule lives in the shared print block
  // (loaded with the app), not in the Reports stylesheet that only exists once Reports has loaded.
  it("leaves a status message off every print, from the app's shared print rules", () => {
    expect(print).not.toMatch(/\.toast-stack/);
    const shared = readFileSync(new URL("../transactions/Transactions.css", import.meta.url), "utf8");
    const sharedPrint = shared.slice(shared.indexOf("@media print"));
    expect(sharedPrint).toMatch(/\.toast-stack[^{]*\{[^}]*display:\s*none\s*!important/);
  });
});
