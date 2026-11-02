import { describe, expect, it } from "vitest";
import { lastDayOfMonth, monthlyEquivalent, monthsLeftInYear, scheduleMonths } from "./savingsTargetMonths.mjs";

describe("monthsLeftInYear", () => {
  // From now until December 31. The 1st has no part month: this month counts whole and nothing is asked. Every other day
  // leaves its remaining days (today included) as the part month. Worked by hand from the calendar.
  it.each([
    ["27 October 2026", new Date(2026, 9, 27), { whole: 2, partDays: 5, daysInMonth: 31, asksPartMonth: true }],
    ["1 November 2026 (the first)", new Date(2026, 10, 1), { whole: 2, partDays: 0, daysInMonth: 30, asksPartMonth: false }],
    ["2 November 2026 (the day after the first)", new Date(2026, 10, 2), { whole: 1, partDays: 29, daysInMonth: 30, asksPartMonth: true }],
    ["30 November 2026 (a 30-day month's last day)", new Date(2026, 10, 30), { whole: 1, partDays: 1, daysInMonth: 30, asksPartMonth: true }],
    ["1 December 2026 (the first of the last month)", new Date(2026, 11, 1), { whole: 1, partDays: 0, daysInMonth: 31, asksPartMonth: false }],
    ["15 December 2026 (no whole month left)", new Date(2026, 11, 15), { whole: 0, partDays: 17, daysInMonth: 31, asksPartMonth: true }],
    ["31 December 2026 (the last day of the year)", new Date(2026, 11, 31), { whole: 0, partDays: 1, daysInMonth: 31, asksPartMonth: true }],
    ["1 January 2027 (a year rollover)", new Date(2027, 0, 1), { whole: 12, partDays: 0, daysInMonth: 31, asksPartMonth: false }],
    ["31 January 2027", new Date(2027, 0, 31), { whole: 11, partDays: 1, daysInMonth: 31, asksPartMonth: true }],
    ["28 February 2027 (not a leap year)", new Date(2027, 1, 28), { whole: 10, partDays: 1, daysInMonth: 28, asksPartMonth: true }],
    ["1 February 2028 (a leap year)", new Date(2028, 1, 1), { whole: 11, partDays: 0, daysInMonth: 29, asksPartMonth: false }],
    ["29 February 2028 (a leap day)", new Date(2028, 1, 29), { whole: 10, partDays: 1, daysInMonth: 29, asksPartMonth: true }],
  ])("%s", (_name, today, expected) => {
    expect(monthsLeftInYear(today)).toEqual(expected);
  });
});

describe("scheduleMonths", () => {
  // Own dates, counted from the calendar: part months at either end, the whole months between, and the month count of each choice.
  it("counts a part month at the start, whole months after it, across a year end", () => {
    const s = scheduleMonths("2026-12-15", "2027-02-28");
    expect(s).toMatchObject({ startPart: { days: 17, of: 31 }, endPart: null, onlyPart: null, whole: 2, wholeOnly: { num: 2n, den: 1n } });
    expect(s.byDay).toEqual({ num: 79n, den: 31n }); // 2 + 17/31
  });
  it("counts part months at both ends with different month lengths", () => {
    const s = scheduleMonths("2027-01-05", "2027-03-20");
    expect(s).toMatchObject({ startPart: { days: 27, of: 31 }, endPart: { days: 20, of: 31 }, whole: 1 });
    expect(s.byDay.num * 31n).toBe(78n * s.byDay.den); // 1 + 27/31 + 20/31 = 78/31
  });
  it("has no part month when the schedule runs from the 1st to a month end", () => {
    expect(scheduleMonths("2026-11-01", "2026-12-31")).toMatchObject({ startPart: null, endPart: null, onlyPart: null, whole: 2, byDay: { num: 2n, den: 1n } });
    expect(scheduleMonths("2026-11-01", "2026-11-30")).toMatchObject({ onlyPart: null, whole: 1 });
  });
  it("counts a schedule inside one month as a single part month, including a leap February", () => {
    expect(scheduleMonths("2026-11-15", "2026-11-30")).toMatchObject({ onlyPart: { days: 16, of: 30 }, whole: 0, byDay: { num: 16n, den: 30n } });
    expect(scheduleMonths("2028-02-10", "2028-02-29")).toMatchObject({ onlyPart: { days: 20, of: 29 }, whole: 0 });
  });
});

describe("lastDayOfMonth", () => {
  it.each([
    ["two months after mid-November 2026 (a year rollover)", 2, new Date(2026, 10, 15), "2027-01-31"],
    ["three months after mid-November 2026 (February, not a leap year)", 3, new Date(2026, 10, 15), "2027-02-28"],
    ["three months after mid-November 2027 (February, a leap year)", 3, new Date(2027, 10, 15), "2028-02-29"],
    ["this month, 31 December", 0, new Date(2026, 11, 31), "2026-12-31"],
    ["last month from 1 January", -1, new Date(2027, 0, 1), "2026-12-31"],
  ])("%s", (_name, offset, now, expected) => {
    expect(lastDayOfMonth(offset, now)).toBe(expected);
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
