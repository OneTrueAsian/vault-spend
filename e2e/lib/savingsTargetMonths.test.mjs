import { describe, expect, it } from "vitest";
import { monthlyEquivalent, monthsLeftInYear } from "./savingsTargetMonths.mjs";

describe("monthsLeftInYear", () => {
  it("counts whole months after this one and this month's remaining days, today included", () => {
    expect(monthsLeftInYear(new Date(2026, 9, 27))).toEqual({ whole: 2, partDays: 5, daysInMonth: 31 });
    expect(monthsLeftInYear(new Date(2027, 0, 1))).toEqual({ whole: 11, partDays: 31, daysInMonth: 31 });
    expect(monthsLeftInYear(new Date(2027, 1, 28))).toEqual({ whole: 10, partDays: 1, daysInMonth: 28 });
    expect(monthsLeftInYear(new Date(2028, 1, 29))).toEqual({ whole: 10, partDays: 1, daysInMonth: 29 });
    expect(monthsLeftInYear(new Date(2026, 11, 15))).toEqual({ whole: 0, partDays: 17, daysInMonth: 31 });
  });
});

describe("monthlyEquivalent", () => {
  // Independent arithmetic, to the cent, rounding halves up: cut = allocated / months, limit = usual month - cut.
  it("matches the values worked by hand for 27 October 2026 (whole months: 2; by the day: 2 + 5/31 = 67/31)", () => {
    const whole = { num: 2n, den: 1n }, byDay = { num: 67n, den: 31n };
    expect(monthlyEquivalent(4000n, 9000n, whole)).toEqual({ cut: 2000n, limit: 7000n });
    expect(monthlyEquivalent(13333n, 30000n, whole)).toEqual({ cut: 6667n, limit: 23334n });
    expect(monthlyEquivalent(2667n, 6000n, whole)).toEqual({ cut: 1334n, limit: 4667n });
    expect(monthlyEquivalent(4000n, 9000n, byDay)).toEqual({ cut: 1851n, limit: 7149n });
    expect(monthlyEquivalent(13333n, 30000n, byDay)).toEqual({ cut: 6169n, limit: 23831n });
    expect(monthlyEquivalent(2667n, 6000n, byDay)).toEqual({ cut: 1234n, limit: 4766n });
  });
  it("uses another date's month count", () => {
    expect(monthlyEquivalent(4000n, 9000n, { num: 12n, den: 1n })).toEqual({ cut: 333n, limit: 8667n });
  });
});
