import { describe, expect, it } from "vitest";
import { buildCategoryTable, inMonthRange, monthEndDate, monthHeading, monthKeys, monthStartDate, presetRange, yearlySummary } from "./reportRange";

const TODAY = new Date(2026, 8, 18); // 2026-09-18

describe("presetRange", () => {
  it("covers the year so far, the trailing 12 or 6 months, or just last month", () => {
    expect(presetRange("year_to_date", TODAY)).toEqual({ from: { year: 2026, month: 1 }, to: { year: 2026, month: 9 } });
    expect(presetRange("last_12", TODAY)).toEqual({ from: { year: 2025, month: 10 }, to: { year: 2026, month: 9 } });
    expect(presetRange("last_6", TODAY)).toEqual({ from: { year: 2026, month: 4 }, to: { year: 2026, month: 9 } });
    expect(presetRange("last_month", TODAY)).toEqual({ from: { year: 2026, month: 8 }, to: { year: 2026, month: 8 } });
  });

  it("wraps last month across a year boundary", () => {
    expect(presetRange("last_month", new Date(2026, 0, 5))).toEqual({ from: { year: 2025, month: 12 }, to: { year: 2025, month: 12 } });
  });
});

describe("monthKeys", () => {
  it("lists every month in the range, inclusive, across a year end", () => {
    expect(monthKeys({ year: 2025, month: 11 }, { year: 2026, month: 2 })).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("is empty when the range runs backwards", () => {
    expect(monthKeys({ year: 2026, month: 5 }, { year: 2026, month: 3 })).toEqual([]);
  });
});

describe("inMonthRange", () => {
  it("includes the first and last day of the range's months", () => {
    const from = { year: 2026, month: 7 };
    const to = { year: 2026, month: 8 };

    expect(inMonthRange("2026-07-01", from, to)).toBe(true);
    expect(inMonthRange("2026-08-31", from, to)).toBe(true);
    expect(inMonthRange("2026-06-30", from, to)).toBe(false);
    expect(inMonthRange("2026-09-01", from, to)).toBe(false);
  });
});

describe("monthHeading", () => {
  it("is the short month name, with the year when it isn't the range's first month's year", () => {
    expect(monthHeading("2026-07")).toBe("Jul");
    expect(monthHeading("2026-01", true)).toBe("Jan ’26");
  });
});

describe("monthStartDate / monthEndDate", () => {
  it("is the first and last calendar day of the month", () => {
    expect(monthStartDate({ year: 2026, month: 9 })).toBe("2026-09-01");
    expect(monthEndDate({ year: 2026, month: 9 })).toBe("2026-09-30");
  });

  it("handles February, including a leap year", () => {
    expect(monthEndDate({ year: 2026, month: 2 })).toBe("2026-02-28");
    expect(monthEndDate({ year: 2028, month: 2 })).toBe("2028-02-29");
  });

  it("handles December rolling into the next year", () => {
    expect(monthEndDate({ year: 2026, month: 12 })).toBe("2026-12-31");
  });
});

describe("buildCategoryTable", () => {
  const months = ["2026-07", "2026-08", "2026-09"];
  const cells = [
    { month: "2026-07", category: "Groceries", amount: "300.00" },
    { month: "2026-08", category: "Groceries", amount: "450.50" },
    { month: "2026-08", category: "Dining Out", amount: "100.00" },
    { month: "2026-09", category: "Rent", amount: "1200.00" },
  ];

  it("makes one row per category with a value for every month, zero where nothing was spent", () => {
    const table = buildCategoryTable(cells, months);

    const groceries = table.rows.find((r) => r.category === "Groceries")!;
    expect(groceries.byMonth).toEqual([300, 450.5, 0]);
    expect(groceries.total).toBe(750.5);
  });

  it("orders categories by what they cost overall, biggest first", () => {
    expect(buildCategoryTable(cells, months).rows.map((r) => r.category)).toEqual(["Rent", "Groceries", "Dining Out"]);
  });

  it("totals each month and the whole range", () => {
    const table = buildCategoryTable(cells, months);

    expect(table.monthTotals).toEqual([300, 550.5, 1200]);
    expect(table.grandTotal).toBe(2050.5);
  });

  it("ignores cells outside the months asked for", () => {
    const table = buildCategoryTable([...cells, { month: "2027-01", category: "Travel", amount: "999.00" }], months);

    expect(table.rows.map((r) => r.category)).not.toContain("Travel");
  });

  it("is empty for no spending", () => {
    const table = buildCategoryTable([], months);

    expect(table.rows).toEqual([]);
    expect(table.monthTotals).toEqual([0, 0, 0]);
    expect(table.grandTotal).toBe(0);
  });
});

describe("yearlySummary", () => {
  it("totals income and spending per calendar year, with the savings rate", () => {
    const summary = yearlySummary([
      { year: 2025, month: 11, income: "3000.00", expense: "2000.00" },
      { year: 2025, month: 12, income: "3000.00", expense: "2500.00" },
      { year: 2026, month: 1, income: "3200.00", expense: "1600.00" },
    ]);

    expect(summary).toEqual([
      { year: 2025, income: 6000, expense: 4500, net: 1500, savingsRate: 25 },
      { year: 2026, income: 3200, expense: 1600, net: 1600, savingsRate: 50 },
    ]);
  });

  it("has no savings rate for a year with no income, and can go negative", () => {
    const summary = yearlySummary([
      { year: 2025, month: 1, income: "0", expense: "500.00" },
      { year: 2026, month: 1, income: "1000.00", expense: "1500.00" },
    ]);

    expect(summary[0].savingsRate).toBeNull();
    expect(summary[1].savingsRate).toBe(-50);
  });
});
