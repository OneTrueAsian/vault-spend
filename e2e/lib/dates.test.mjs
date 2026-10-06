import { describe, expect, it } from "vitest";
import { DISPLAY_DATE, dateInMonth, displayDate, fieldDate, isoDaysFromNow, monthFromNow } from "./dates.mjs";

const OCT_1_2026 = new Date(2026, 9, 1);

describe("monthFromNow", () => {
  it("is the current month at offset 0", () => {
    expect(monthFromNow(0, OCT_1_2026)).toBe("2026-10");
  });

  it("counts back across a year boundary", () => {
    expect(monthFromNow(-1, new Date(2027, 0, 15))).toBe("2026-12");
    expect(monthFromNow(-13, new Date(2027, 0, 15))).toBe("2025-12");
  });

  it("counts forward across a year boundary", () => {
    expect(monthFromNow(3, OCT_1_2026)).toBe("2027-01");
  });

  it("defaults to today", () => {
    const now = new Date();
    expect(monthFromNow(0)).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  });
});

describe("dateInMonth", () => {
  it("is that day of the month `offset` months from now, zero-padded", () => {
    expect(dateInMonth(-2, 5, OCT_1_2026)).toBe("2026-08-05");
    expect(dateInMonth(-1, 20, new Date(2027, 0, 31))).toBe("2026-12-20");
  });

  it("refuses a day that some month does not have, so a fixture means the same thing every month", () => {
    expect(() => dateInMonth(-1, 29, OCT_1_2026)).toThrow(/1-28/);
    expect(() => dateInMonth(-1, 0, OCT_1_2026)).toThrow(/1-28/);
  });
});

describe("isoDaysFromNow", () => {
  it("counts days by the local calendar, across months and years", () => {
    expect(isoDaysFromNow(0, OCT_1_2026)).toBe("2026-10-01");
    expect(isoDaysFromNow(-1, OCT_1_2026)).toBe("2026-09-30");
    expect(isoDaysFromNow(1, new Date(2026, 11, 31))).toBe("2027-01-01");
  });
});

describe("displayDate / fieldDate", () => {
  it("matches how the app writes dates out", () => {
    expect(displayDate("2026-10-04", OCT_1_2026)).toBe("Oct 4");
    expect(displayDate("2025-12-31", OCT_1_2026)).toBe("Dec 31, 2025");
    expect(fieldDate("2026-10-04")).toBe("Oct 4, 2026");
    expect(DISPLAY_DATE.test("Oct 4")).toBe(true);
    expect(DISPLAY_DATE.test("Dec 31, 2025")).toBe(true);
    expect(DISPLAY_DATE.test("2026-10-04")).toBe(false);
  });
});
