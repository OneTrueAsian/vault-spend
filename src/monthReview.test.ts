import { describe, expect, it } from "vitest";
import { monthDelta, monthName, monthReviewDue, previousMonth } from "./monthReview";

describe("previousMonth", () => {
  it("is the month before, wrapping the year in January", () => {
    expect(previousMonth(new Date(2026, 8, 18))).toEqual({ year: 2026, month: 8 });
    expect(previousMonth(new Date(2026, 0, 3))).toEqual({ year: 2025, month: 12 });
  });
});

describe("monthName", () => {
  it("spells the month out", () => {
    expect(monthName(2026, 8)).toBe("August");
    expect(monthName(2025, 12)).toBe("December");
  });
});

describe("monthReviewDue", () => {
  const augustActivity = [{ date: "2026-08-14" }];

  it("is due in the first two weeks of a month when last month has activity and isn't reviewed", () => {
    expect(monthReviewDue({ today: new Date(2026, 8, 1), reviewedMonths: [], transactions: augustActivity })).toEqual({
      year: 2026,
      month: 8,
      label: "August",
    });
    expect(monthReviewDue({ today: new Date(2026, 8, 14), reviewedMonths: [], transactions: augustActivity })).not.toBeNull();
  });

  it("is not due once the first two weeks are over", () => {
    expect(monthReviewDue({ today: new Date(2026, 8, 15), reviewedMonths: [], transactions: augustActivity })).toBeNull();
  });

  it("is not due once that month has been reviewed", () => {
    expect(monthReviewDue({ today: new Date(2026, 8, 3), reviewedMonths: ["2026-08"], transactions: augustActivity })).toBeNull();
  });

  it("is not due when last month had no activity to review", () => {
    expect(monthReviewDue({ today: new Date(2026, 8, 3), reviewedMonths: [], transactions: [{ date: "2026-07-30" }] })).toBeNull();
    expect(monthReviewDue({ today: new Date(2026, 8, 3), reviewedMonths: [], transactions: [] })).toBeNull();
  });

  it("looks back across a year boundary", () => {
    expect(monthReviewDue({ today: new Date(2027, 0, 5), reviewedMonths: [], transactions: [{ date: "2026-12-20" }] })).toEqual({
      year: 2026,
      month: 12,
      label: "December",
    });
  });
});

describe("monthDelta", () => {
  it("describes the move against the month before", () => {
    expect(monthDelta(3200, 3000)).toEqual({ direction: "up", amount: 200 });
    expect(monthDelta(1500, 1700.5)).toEqual({ direction: "down", amount: 200.5 });
    expect(monthDelta(500, 500)).toEqual({ direction: "same", amount: 0 });
  });

  it("treats a sub-cent difference as no change", () => {
    expect(monthDelta(100.004, 100)).toEqual({ direction: "same", amount: 0 });
  });
});
