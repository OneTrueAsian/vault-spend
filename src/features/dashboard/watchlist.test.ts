import { describe, expect, it } from "vitest";
import { parseWidgetId, watchWidgetId } from "../../shared/lib/dashboardLayout";
import type { SavedTransactionFilter } from "../../shared/native/appTypes";
import type { Transaction } from "../../shared/lib/types";
import { categoryWatchTotals, usualMonth, watchFilterValues, watchLedgerFilter, watchMonths, watchTotals } from "./watchlist";
import { NO_TRANSACTION_FILTER } from "../transactions/transactionFilter";

// VS-46: a watch tile shows this month's spending so far against a usual month: the average of the last 3 full
// months (owner decision 22 Nov 2026). Category watches count like Budget, split lines included; tag, store and
// saved-filter watches count the rows their "See transactions" link shows.
const tx = (over: Partial<Transaction>): Transaction => ({
  id: 1, transfer_counterpart_id: null, date: "2026-11-05", description: "Blue Bottle Coffee", amount: "-5.00", category: "Coffee",
  category_source: "user", confidence: null, account_id: 1, account_name: "Checking", applied_to_debt: null, principal_amount: null,
  split_count: 0, tags: [], member_id: null, member_name: null, notes: null, excluded_from_budget: false, ...over,
});
const TODAY = new Date(2026, 10, 22);

describe("watch widget ids", () => {
  it("round-trip a kind and a name, colons included", () => {
    const id = watchWidgetId("filter", "Trips: 2026");
    expect(id).toBe("watch:filter:Trips: 2026");
    expect(parseWidgetId(id)).toEqual({ kind: "watch", watchKind: "filter", name: "Trips: 2026" });
  });
});

describe("watchMonths", () => {
  it("is this month up to today, then the 3 full months before it, newest first", () => {
    expect(watchMonths(TODAY)).toEqual({
      thisMonth: { from: "2026-11-01", to: "2026-11-22" },
      previous: [
        { year: 2026, month: 10, from: "2026-10-01", to: "2026-10-31" },
        { year: 2026, month: 9, from: "2026-09-01", to: "2026-09-30" },
        { year: 2026, month: 8, from: "2026-08-01", to: "2026-08-31" },
      ],
    });
  });

  it("crosses into last year in January", () => {
    expect(watchMonths(new Date(2027, 0, 3)).previous.map((m) => m.from)).toEqual(["2026-12-01", "2026-11-01", "2026-10-01"]);
  });
});

describe("usualMonth", () => {
  const months = watchMonths(TODAY).previous;

  it("averages the 3 full months", () => {
    expect(usualMonth([30, 60, 90], months, "2026-01-01")).toBe(60);
  });

  it("averages only the full months there is history for, not empty ones before it", () => {
    // History starts 1 Sep: September and October count, August does not.
    expect(usualMonth([30, 60, 90], months, "2026-09-01")).toBe(45);
    // Starting 25 Sep, September is not a full month.
    expect(usualMonth([30, 60, 90], months, "2026-09-25")).toBe(30);
  });

  it("has no usual month without a full month of history", () => {
    expect(usualMonth([0, 0, 0], months, "2026-10-02")).toBeNull();
    expect(usualMonth([0, 0, 0], months, null)).toBeNull();
  });
});

describe("watchTotals (tag, store and saved filter)", () => {
  const rows = [
    tx({ id: 1, date: "2026-11-05", amount: "-5.00", tags: ["treat"] }),
    tx({ id: 2, date: "2026-11-21", amount: "-7.50", tags: ["treat"] }),
    tx({ id: 3, date: "2026-11-23", amount: "-100.00", tags: ["treat"] }), // after today
    tx({ id: 4, date: "2026-10-10", amount: "-30.00", tags: ["treat"] }),
    tx({ id: 5, date: "2026-10-11", amount: "12.00", tags: ["treat"] }), // a refund is not spending
    tx({ id: 6, date: "2026-09-02", amount: "-60.00", tags: ["treat"], transfer_counterpart_id: 99 }), // a transfer leg
    tx({ id: 7, date: "2026-09-03", amount: "-40.00", tags: ["treat"], category: "Transfer" }),
    tx({ id: 8, date: "2026-08-15", amount: "-90.00", tags: ["treat"], excluded_from_budget: true }), // still spending
    tx({ id: 9, date: "2026-11-06", amount: "-1.00", tags: ["other"] }),
  ];

  it("adds up money out for this month so far and each of the 3 months before", () => {
    const totals = watchTotals(rows, watchFilterValues({ kind: "tag", name: "treat" }, [])!, watchMonths(TODAY));
    expect(totals).toEqual({ thisMonth: 12.5, previous: [30, 0, 90] });
  });

  it("matches a store the way the Transactions search box does", () => {
    const values = watchFilterValues({ kind: "store", name: "blue bottle" }, [])!;
    expect(values.searchText).toBe("blue bottle");
    expect(watchTotals(rows, values, watchMonths(TODAY)).thisMonth).toBe(13.5);
  });

  it("uses a saved filter's other settings but not its dates", () => {
    const saved: SavedTransactionFilter = {
      name: "Treats", searchText: "", filterCategory: "Coffee", filterAccountIds: [1], filterMemberIds: "all",
      filterFrom: "2020-01-01", filterTo: "2020-12-31", filterTag: "treat",
    };
    const values = watchFilterValues({ kind: "filter", name: "Treats" }, [saved])!;
    expect(values.filterFrom).toBe("");
    expect(values.filterTo).toBe("");
    expect(values.filterAccountIds).toEqual(new Set([1]));
    expect(watchTotals(rows, values, watchMonths(TODAY)).thisMonth).toBe(12.5);
  });

  it("has no values for a saved filter that no longer exists, or for a category (counted like Budget instead)", () => {
    expect(watchFilterValues({ kind: "filter", name: "Gone" }, [])).toBeNull();
    expect(watchFilterValues({ kind: "category", name: "Coffee" }, [])).toBeNull();
  });
});

describe("watchLedgerFilter", () => {
  it("opens Transactions on this month with the watch's own filter", () => {
    const thisMonth = { filterFrom: "2026-11-01", filterTo: "2026-11-22" };
    expect(watchLedgerFilter({ kind: "category", name: "Coffee" }, [], TODAY)).toEqual({ ...NO_TRANSACTION_FILTER, filterCategory: "Coffee", ...thisMonth });
    expect(watchLedgerFilter({ kind: "tag", name: "treat" }, [], TODAY)).toEqual({ ...NO_TRANSACTION_FILTER, filterTag: "treat", ...thisMonth });
    expect(watchLedgerFilter({ kind: "store", name: "amazon" }, [], TODAY)).toEqual({ ...NO_TRANSACTION_FILTER, searchText: "amazon", ...thisMonth });
    const saved: SavedTransactionFilter = {
      name: "Weekend", searchText: "bar", filterCategory: "all", filterAccountIds: [2], filterMemberIds: "all", filterFrom: "2020-01-01", filterTo: "", filterTag: "all",
    };
    expect(watchLedgerFilter({ kind: "filter", name: "Weekend" }, [saved], TODAY)).toEqual({
      ...NO_TRANSACTION_FILTER, searchText: "bar", filterAccountIds: new Set([2]), ...thisMonth,
    });
  });

  it("has nothing to open for a saved filter that no longer exists", () => {
    expect(watchLedgerFilter({ kind: "filter", name: "Gone" }, [], TODAY)).toBeNull();
  });
});

describe("categoryWatchTotals", () => {
  it("reads Budget's per-category spending for this month and each earlier month, 0 when absent", () => {
    const totals = categoryWatchTotals(
      "Coffee",
      [{ category: "Coffee", amount: "12.50" }, { category: "Dining", amount: "40.00" }],
      [[{ category: "Coffee", amount: "30.00" }], [], [{ category: "Coffee", amount: "90.10" }]],
    );
    expect(totals).toEqual({ thisMonth: 12.5, previous: [30, 0, 90.1] });
  });
});
