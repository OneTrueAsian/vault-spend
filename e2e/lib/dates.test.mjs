import { describe, expect, it } from "vitest";
import { dateInMonth, monthFromNow } from "./dates.mjs";

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
