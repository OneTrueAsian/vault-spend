// The Transactions tab shows its matching rows a step at a time with a "Show N more" button
// instead of numbered pages (owner, 2026-10-04).
import { describe, expect, it } from "vitest";
import { LEDGER_STEPS, ledgerShownLabel, rowsToShowFor, showMoreLabel, transactionsInRows } from "./ledgerPaging";

describe("ledger paging", () => {
  it("offers 25, 50 or 100 rows at a time", () => {
    expect(LEDGER_STEPS).toEqual([25, 50, 100]);
  });

  it("says how many of the matching rows show, with thousands separators", () => {
    expect(ledgerShownLabel(50, 1200)).toBe("Showing 50 of 1,200 transactions");
    expect(ledgerShownLabel(1200, 1200)).toBe("Showing all 1,200 transactions");
    expect(ledgerShownLabel(60, 7)).toBe("Showing all 7 transactions");
    expect(ledgerShownLabel(50, 1)).toBe("Showing 1 transaction");
  });

  it("counts transactions, so a transfer shown as one row counts as its two", () => {
    // rows of 1, 2 (a merged transfer), 1, 2 transactions
    expect(transactionsInRows([1, 2, 1, 2], 2)).toEqual({ shown: 3, total: 6 });
    expect(transactionsInRows([1, 2, 1, 2], 50)).toEqual({ shown: 6, total: 6 });
    expect(transactionsInRows([], 50)).toEqual({ shown: 0, total: 0 });
  });

  it("names the size of the next step, or nothing once everything shows", () => {
    expect(showMoreLabel(50, 1200, 50)).toBe("Show 50 more");
    expect(showMoreLabel(1150, 1200, 100)).toBe("Show 50 more");
    expect(showMoreLabel(1200, 1200, 50)).toBeNull();
  });

  it("shows enough rows to include a row it jumps to, in whole steps", () => {
    expect(rowsToShowFor(10, 50, 50)).toBe(50);
    expect(rowsToShowFor(49, 50, 50)).toBe(50);
    expect(rowsToShowFor(50, 50, 50)).toBe(100);
    expect(rowsToShowFor(130, 50, 50)).toBe(150);
    expect(rowsToShowFor(5, 150, 50)).toBe(150);
  });
});
