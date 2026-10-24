import { describe, expect, it } from "vitest";
import { alignedPrior, dayCount, monthsTouching } from "./calendar";

describe("monthsTouching", () => {
  it("lists every calendar month a range touches, with the part inside the range", () => {
    const months = monthsTouching({ from: "2025-11-20", to: "2026-02-10" });
    expect(months.map((m) => [m.month, m.from, m.to])).toEqual([
      ["2025-11", "2025-11-20", "2025-11-30"],
      ["2025-12", "2025-12-01", "2025-12-31"],
      ["2026-01", "2026-01-01", "2026-01-31"],
      ["2026-02", "2026-02-01", "2026-02-10"],
    ]);
  });
  it("knows how long February is", () => {
    expect(monthsTouching({ from: "2028-02-01", to: "2028-02-29" })[0].end).toBe("2028-02-29");
    expect(monthsTouching({ from: "2027-02-01", to: "2027-02-28" })[0].end).toBe("2027-02-28");
  });
  it("gives one row for a range inside one month", () => {
    expect(monthsTouching({ from: "2026-03-05", to: "2026-03-05" })).toHaveLength(1);
  });
});

describe("dayCount", () => {
  it("counts both ends", () => {
    expect(dayCount({ from: "2026-03-01", to: "2026-03-30" })).toBe(30);
    expect(dayCount({ from: "2026-03-01", to: "2026-03-01" })).toBe(1);
  });
});

describe("alignedPrior", () => {
  it("compares a month so far with the same days of the month before, stopping at its last day", () => {
    expect(alignedPrior({ from: "2026-03-01", to: "2026-03-30" }, "same-days-previous-month")).toEqual({
      range: { from: "2026-02-01", to: "2026-02-28" },
      clamped: { requestedDays: 30, usedDays: 28 },
    });
    expect(alignedPrior({ from: "2026-03-01", to: "2026-03-28" }, "same-days-previous-month")?.clamped).toBeNull();
    expect(alignedPrior({ from: "2026-01-01", to: "2026-01-20" }, "same-days-previous-month")?.range).toEqual({ from: "2025-12-01", to: "2025-12-20" });
  });
  it("refuses a range that does not start on the 1st or leaves its month", () => {
    expect(alignedPrior({ from: "2026-03-05", to: "2026-03-30" }, "same-days-previous-month")).toBeNull();
    expect(alignedPrior({ from: "2026-03-01", to: "2026-04-10" }, "same-days-previous-month")).toBeNull();
  });
  it("moves both ends back one year, with 29 February becoming 28 February", () => {
    expect(alignedPrior({ from: "2028-01-01", to: "2028-02-29" }, "same-days-previous-year")).toEqual({
      range: { from: "2027-01-01", to: "2027-02-28" },
      clamped: { requestedDays: 60, usedDays: 59 },
    });
    expect(alignedPrior({ from: "2026-01-01", to: "2026-03-30" }, "same-days-previous-year")?.clamped).toBeNull();
  });
  it("has nothing to align when the ranges are taken as given", () => {
    expect(alignedPrior({ from: "2026-03-01", to: "2026-03-30" }, "as-requested")).toBeNull();
  });
});
