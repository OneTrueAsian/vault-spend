// The helper specs use when they call commit_import directly (the native file dialog is out of
// WebDriver's reach): it settles the rows the review screen would ask about, the same way the
// screen's "Leave the rest uncategorized" does, and never touches rows the app can place itself.
import { describe, expect, it } from "vitest";
import { leaveUnsureRowsUncategorized } from "./importReview.mjs";

const preview = {
  choice_below: 0.5,
  rows: [
    { index: 0, category: "groceries", matched_category: "Groceries", suggestion: null },
    { index: 1, category: "Merchandise", matched_category: null, suggestion: null },
    { index: 2, category: null, matched_category: null, suggestion: { category: "Dining", source: "rule", confidence: null } },
    { index: 3, category: null, matched_category: null, suggestion: { category: "Dining", source: "guess", confidence: 0.2 } },
    { index: 4, category: null, matched_category: null, suggestion: { category: "Dining", source: "guess", confidence: 0.5 } },
  ],
};

describe("leaveUnsureRowsUncategorized", () => {
  it("leaves only the checked rows the app can't place uncategorized", () => {
    expect(leaveUnsureRowsUncategorized(preview, [0, 1, 2, 3, 4])).toEqual({ 1: null, 3: null });
  });

  it("skips unchecked rows", () => {
    expect(leaveUnsureRowsUncategorized(preview, [0, 2])).toEqual({});
  });

  it("does not ask about a file category the panel maps or adds, under any casing", () => {
    expect(leaveUnsureRowsUncategorized(preview, [1], { MERCHANDISE: { action: "create" } })).toEqual({});
    expect(leaveUnsureRowsUncategorized(preview, [1], { merchandise: { action: "skip" } })).toEqual({ 1: null });
  });

  it("keeps choices the spec already made", () => {
    expect(leaveUnsureRowsUncategorized(preview, [1, 3], {}, { 3: "Dining" })).toEqual({ 1: null, 3: "Dining" });
  });
});
