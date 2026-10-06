import { describe, expect, it } from "vitest";
import { formatDisplayDate, formatDisplayDateTime, formatFullDate, formatMonthYear, shortMonthDay } from "./format";

describe("shortMonthDay", () => {
  it("turns a stored date into a compact axis label", () => {
    expect(shortMonthDay("2026-09-18")).toBe("Sep 18");
    expect(shortMonthDay("2025-01-05")).toBe("Jan 5");
    expect(shortMonthDay("2026-12-31")).toBe("Dec 31");
  });

  it("leaves something that isn't a date alone", () => {
    expect(shortMonthDay("Yr 3")).toBe("Yr 3");
  });
});

describe("formatDisplayDate", () => {
  const today = new Date(2026, 9, 4);

  it("leaves the year off for a date in this year", () => {
    expect(formatDisplayDate("2026-10-04", today)).toBe("Oct 4");
    expect(formatDisplayDate("2026-01-01", today)).toBe("Jan 1");
  });

  it("names the year for a date in any other year", () => {
    expect(formatDisplayDate("2025-12-31", today)).toBe("Dec 31, 2025");
    expect(formatDisplayDate("2027-01-02", today)).toBe("Jan 2, 2027");
  });

  it("gives back anything that isn't a stored date unchanged", () => {
    expect(formatDisplayDate("not a date", today)).toBe("not a date");
    expect(formatDisplayDate("", today)).toBe("");
    expect(formatDisplayDate("2026-13-01", today)).toBe("2026-13-01");
    expect(formatDisplayDate("2026-02-30", today)).toBe("2026-02-30");
    expect(formatDisplayDate("2026-04-31", today)).toBe("2026-04-31");
    expect(formatDisplayDate("2026-02-29", today)).toBe("2026-02-29");
    expect(formatFullDate("2026-02-30")).toBe("2026-02-30");
  });

  it("knows leap days", () => {
    expect(formatDisplayDate("2028-02-29", today)).toBe("Feb 29, 2028");
  });

  it("defaults to the real today", () => {
    const now = new Date();
    const iso = `${now.getFullYear()}-03-15`;
    expect(formatDisplayDate(iso)).toBe("Mar 15");
  });
});

describe("formatDisplayDateTime", () => {
  const today = new Date(2026, 9, 4);

  it("shows the date the same way, then the time on a 12-hour clock", () => {
    expect(formatDisplayDateTime("2026-10-04 14:05", today)).toBe("Oct 4, 2:05 PM");
    expect(formatDisplayDateTime("2025-12-31 00:30", today)).toBe("Dec 31, 2025, 12:30 AM");
    expect(formatDisplayDateTime("2026-10-04 12:00", today)).toBe("Oct 4, 12:00 PM");
  });

  it("gives back anything else unchanged", () => {
    expect(formatDisplayDateTime("vaultspend-backup.db", today)).toBe("vaultspend-backup.db");
  });
});

describe("formatFullDate", () => {
  it("always names the year", () => {
    expect(formatFullDate("2026-10-04")).toBe("Oct 4, 2026");
    expect(formatFullDate("2025-01-09")).toBe("Jan 9, 2025");
    expect(formatFullDate("")).toBe("");
  });
});

describe("formatMonthYear", () => {
  it("shows a month and its year", () => {
    expect(formatMonthYear("2027-06-18")).toBe("Jun 2027");
    expect(formatMonthYear("2027-06")).toBe("Jun 2027");
    expect(formatMonthYear("soon")).toBe("soon");
  });
});
