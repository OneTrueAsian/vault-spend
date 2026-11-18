import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, addYears, compareDates, daysInMonth, formatIso, formatIsoMonth, isLeapYear, parseIso, parseIsoMonth,
  resolveBounds, resolveMonthBounds, startOfWeek, endOfWeek, weekdayOf, clampDate, dateInBounds, monthInBounds,
} from "./calendarDate";

const d = (iso: string) => parseIso(iso)!;

describe("Gregorian dates", () => {
  it("knows leap years: 1900 and 2100 are not, 2000 and 2024 are", () => {
    expect([1900, 2000, 2024, 2100].map(isLeapYear)).toEqual([false, true, true, false]);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
  });

  it("parses only strict, real YYYY-MM-DD dates", () => {
    expect(parseIso("2026-10-04")).toEqual({ year: 2026, month: 10, day: 4 });
    for (const bad of ["", "2026-1-4", "2026-10-4", "26-10-04", "2026-13-01", "2026-00-10", "2026-02-30", "2100-02-29", "2026-10-04T00:00", " 2026-10-04", "2026/10/04", "02026-10-04"]) {
      expect(parseIso(bad), bad).toBeNull();
    }
    expect(parseIso("2000-02-29")).not.toBeNull();
  });

  it("round-trips through formatIso and pads small years", () => {
    expect(formatIso({ year: 1900, month: 1, day: 5 })).toBe("1900-01-05");
    expect(formatIso({ year: 5, month: 3, day: 9 })).toBe("0005-03-09");
  });

  it("parses strict YYYY-MM months", () => {
    expect(parseIsoMonth("2026-10")).toEqual({ year: 2026, month: 10 });
    for (const bad of ["", "2026-1", "2026-13", "2026-00", "2026-10-01", "26-10"]) expect(parseIsoMonth(bad), bad).toBeNull();
    expect(formatIsoMonth({ year: 2026, month: 3 })).toBe("2026-03");
  });

  it("compares dates", () => {
    expect(compareDates(d("2026-10-04"), d("2026-10-05"))).toBeLessThan(0);
    expect(compareDates(d("2027-01-01"), d("2026-12-31"))).toBeGreaterThan(0);
    expect(compareDates(d("2026-10-04"), d("2026-10-04"))).toBe(0);
  });

  it("moves by days across month, year and leap-day edges without mutating its input", () => {
    const start = d("2024-02-28");
    expect(formatIso(addDays(start, 1))).toBe("2024-02-29");
    expect(formatIso(addDays(start, 2))).toBe("2024-03-01");
    expect(formatIso(addDays(d("2026-12-31"), 1))).toBe("2027-01-01");
    expect(formatIso(addDays(d("2026-01-01"), -1))).toBe("2025-12-31");
    expect(formatIso(addDays(d("1900-03-01"), -1))).toBe("1900-02-28");
    expect(formatIso(addDays(d("2100-03-01"), -1))).toBe("2100-02-28");
    expect(start).toEqual({ year: 2024, month: 2, day: 28 });
  });

  it("moves by months and years, clamping the day to the shorter month", () => {
    expect(formatIso(addMonths(d("2026-01-31"), 1))).toBe("2026-02-28");
    expect(formatIso(addMonths(d("2024-01-31"), 1))).toBe("2024-02-29");
    expect(formatIso(addMonths(d("2026-03-31"), -1))).toBe("2026-02-28");
    expect(formatIso(addMonths(d("2026-11-15"), 3))).toBe("2027-02-15");
    expect(formatIso(addMonths(d("2026-01-15"), -2))).toBe("2025-11-15");
    expect(formatIso(addYears(d("2024-02-29"), 1))).toBe("2025-02-28");
    expect(formatIso(addYears(d("2024-02-29"), 4))).toBe("2028-02-29");
  });

  it("finds weekdays (Sunday = 0) and week boundaries for any first day", () => {
    expect(weekdayOf(d("2026-10-04"))).toBe(0); // a Sunday
    expect(weekdayOf(d("2000-01-01"))).toBe(6);
    expect(weekdayOf(d("1900-01-01"))).toBe(1);
    expect(formatIso(startOfWeek(d("2026-10-07"), 0))).toBe("2026-10-04");
    expect(formatIso(startOfWeek(d("2026-10-07"), 1))).toBe("2026-10-05");
    expect(formatIso(startOfWeek(d("2026-10-04"), 1))).toBe("2026-09-28");
    expect(formatIso(endOfWeek(d("2026-10-07"), 1))).toBe("2026-10-11");
    expect(formatIso(endOfWeek(d("2026-10-07"), 6))).toBe("2026-10-09");
  });
});

describe("bounds", () => {
  it("defaults to 1900-01-01 through 2100-12-31", () => {
    const b = resolveBounds(undefined, undefined);
    expect(b.empty).toBe(false);
    expect(formatIso(b.min)).toBe("1900-01-01");
    expect(formatIso(b.max)).toBe("2100-12-31");
  });

  it("intersects the caller's bounds with that range, inclusively", () => {
    const b = resolveBounds("2026-10-04", "2026-10-04");
    expect(b.empty).toBe(false);
    expect(dateInBounds(d("2026-10-04"), b)).toBe(true);
    expect(dateInBounds(d("2026-10-03"), b)).toBe(false);
    expect(dateInBounds(d("2026-10-05"), b)).toBe(false);
    const wide = resolveBounds("1800-01-01", "2200-01-01");
    expect(formatIso(wide.min)).toBe("1900-01-01");
    expect(formatIso(wide.max)).toBe("2100-12-31");
  });

  it("reports contradictory or unusable bounds as empty rather than swapping them", () => {
    expect(resolveBounds("2026-10-05", "2026-10-04").empty).toBe(true);
    expect(resolveBounds("2101-01-01", undefined).empty).toBe(true);
    expect(resolveBounds(undefined, "1899-12-31").empty).toBe(true);
    expect(resolveBounds("nonsense", undefined).empty).toBe(true);
  });

  it("clamps a date to the bounds, and says so for an empty range", () => {
    const b = resolveBounds("2026-10-10", "2026-10-20");
    expect(formatIso(clampDate(d("2026-10-01"), b)!)).toBe("2026-10-10");
    expect(formatIso(clampDate(d("2026-11-01"), b)!)).toBe("2026-10-20");
    expect(formatIso(clampDate(d("2026-10-15"), b)!)).toBe("2026-10-15");
    expect(clampDate(d("2026-10-15"), resolveBounds("2027-01-01", "2026-01-01"))).toBeNull();
  });

  it("applies the same rules to months, with caller bounds only", () => {
    const b = resolveMonthBounds("2026-10", "2100-12");
    expect(b.empty).toBe(false);
    expect(monthInBounds({ year: 2026, month: 10 }, b)).toBe(true);
    expect(monthInBounds({ year: 2026, month: 9 }, b)).toBe(false);
    expect(monthInBounds({ year: 2101, month: 1 }, b)).toBe(false);
    const open = resolveMonthBounds("2026-10", undefined);
    expect(monthInBounds({ year: 9999, month: 12 }, open)).toBe(true);
    expect(resolveMonthBounds("2026-11", "2026-10").empty).toBe(true);
  });
});

describe("time zones", () => {
  it("never shifts a stored date, whatever the process time zone", () => {
    // The helpers use plain year/month/day records; none of them goes through local-midnight Date values.
    for (const iso of ["2026-03-08", "2026-11-01", "2026-03-29", "2026-10-25"]) {
      expect(formatIso(addDays(addDays(d(iso), 1), -1))).toBe(iso);
      expect(formatIso(parseIso(iso)!)).toBe(iso);
    }
  });
});
