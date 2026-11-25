// VS-98: the ledger filter a Reports drill-down applies.
import { describe, expect, it } from "vitest";
import { UNCATEGORIZED_FILTER } from "../../shared/native/appTypes";
import { drillLedgerFilter, drillStillShown, type ReportDrill } from "./reportReturn";

const drill = (category: string): ReportDrill => ({ view: { tab: "categories", preset: "last_12" }, category, from: "2025-12-01", to: "2026-11-30" });

describe("drillLedgerFilter", () => {
  it("maps the report's Uncategorized row to the ledger's uncategorized filter", () => {
    expect(drillLedgerFilter(drill("Uncategorized")).category).toBe(UNCATEGORIZED_FILTER);
  });

  it("keeps any other category name as it is", () => {
    expect(drillLedgerFilter(drill("Groceries")).category).toBe("Groceries");
  });

  it("covers every account and carries the exact dates it was given", () => {
    expect(drillLedgerFilter(drill("Groceries"))).toEqual({ category: "Groceries", accountIds: [], from: "2025-12-01", to: "2026-11-30" });
  });
});

describe("drillStillShown", () => {
  const live = { searchText: "", filterCategory: "Groceries", filterAccountIds: "all" as const, filterMemberIds: "all" as const, filterFrom: "2025-12-01", filterTo: "2026-11-30", filterTag: "all" };

  it("is true while the ledger filters are exactly what the drill-down set", () => {
    expect(drillStillShown(drill("Groceries"), live)).toBe(true);
    expect(drillStillShown(drill("Uncategorized"), { ...live, filterCategory: UNCATEGORIZED_FILTER })).toBe(true);
  });

  it.each([
    ["category", { filterCategory: "Dining" }],
    ["from date", { filterFrom: "2026-01-01" }],
    ["to date", { filterTo: "2026-10-31" }],
    ["search", { searchText: "milk" }],
    ["accounts", { filterAccountIds: new Set([1]) }],
    ["members", { filterMemberIds: new Set([1]) }],
    ["tag", { filterTag: "holiday" }],
  ])("is false once the %s changes", (_name, change) => {
    expect(drillStillShown(drill("Groceries"), { ...live, ...change })).toBe(false);
  });
});
