import type { RangePreset } from "../../shared/lib/reportRange";
import type { ReportsTab } from "./ReportsOverview";
import { UNCATEGORIZED_FILTER } from "../../shared/native/appTypes";

/** Where the report was when someone opened its transactions. Session-only: held by App, never saved. */
export type ReportView = { tab: ReportsTab; preset: RangePreset };
/** A drill-down from a report row: the view to come back to, and the exact scope the ledger shows. */
export type ReportDrill = { view: ReportView; category: string; from: string; to: string };

/** The ledger filter a drill-down applies. The report's "Uncategorized" row is the ledger's uncategorized filter. */
export function drillLedgerFilter(d: ReportDrill): { category: string; accountIds: number[]; from: string; to: string } {
  return { category: d.category === "Uncategorized" ? UNCATEGORIZED_FILTER : d.category, accountIds: [], from: d.from, to: d.to };
}

/** The ledger's live filters, as App holds them. */
export type LiveLedgerFilters = {
  searchText: string;
  filterCategory: string;
  filterAccountIds: "all" | Set<number>;
  filterMemberIds: "all" | Set<number>;
  filterFrom: string;
  filterTo: string;
  filterTag: string;
};

/** Whether the ledger is still showing exactly what the drill-down opened it on. Any change to a filter makes this false. */
export function drillStillShown(d: ReportDrill, live: LiveLedgerFilters): boolean {
  return (
    live.filterCategory === drillLedgerFilter(d).category &&
    live.filterFrom === d.from &&
    live.filterTo === d.to &&
    live.searchText === "" &&
    live.filterAccountIds === "all" &&
    live.filterMemberIds === "all" &&
    live.filterTag === "all"
  );
}
