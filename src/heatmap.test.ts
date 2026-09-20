import { describe, expect, it } from "vitest";
import { buildHeatmapWeeks, heatmapBucket, heatmapScaleMax } from "./heatmap";

describe("heatmapScaleMax", () => {
  it("is 0 when nothing was spent, ignoring zero and negative amounts", () => {
    expect(heatmapScaleMax([])).toBe(0);
    expect(heatmapScaleMax([0, 0, -5])).toBe(0);
  });

  it("is simply the biggest day when there are fewer than ten spending days", () => {
    expect(heatmapScaleMax([12, 40, 1850])).toBe(1850);
    expect(heatmapScaleMax([5, 6, 7, 8, 9, 10, 11, 12, 13])).toBe(13);
  });

  it("does not let one huge day (rent) set the scale for everything else", () => {
    // Nineteen ordinary days and one 1850 rent day: the scale follows the ordinary days.
    const amounts = [...Array.from({ length: 19 }, (_, i) => 20 + i), 1850];
    const scale = heatmapScaleMax(amounts);
    expect(scale).toBe(37);
    // An ordinary $30 day now reads as a strong cell, and the rent day still clamps to the top step.
    expect(heatmapBucket(30, scale)).toBe(4);
    expect(heatmapBucket(1850, scale)).toBe(4);
    expect(heatmapBucket(20, scale)).toBe(3);
  });

  it("takes the 90th-percentile spending day", () => {
    const amounts = Array.from({ length: 10 }, (_, i) => (i + 1) * 10); // 10..100
    expect(heatmapScaleMax(amounts)).toBe(90);
  });
});

describe("buildHeatmapWeeks", () => {
  it("pads a partial week at both ends so every week is 7 days", () => {
    // 2026-09-01 is a Tuesday, 2026-09-03 is a Thursday.
    const weeks = buildHeatmapWeeks([], "2026-09-01", "2026-09-03");
    expect(weeks.length).toBe(1);
    expect(weeks[0].length).toBe(7);
    expect(weeks[0].map((d) => d.date)).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ]);
    expect(weeks[0].map((d) => d.inRange)).toEqual([false, false, true, true, true, false, false]);
  });

  it("maps each in-range day to its amount, and defaults a missing day to 0", () => {
    const weeks = buildHeatmapWeeks([{ date: "2026-09-02", amount: 42.5 }], "2026-09-01", "2026-09-03");
    const byDate = new Map(weeks.flat().map((d) => [d.date, d.amount]));
    expect(byDate.get("2026-09-01")).toBe(0);
    expect(byDate.get("2026-09-02")).toBe(42.5);
    expect(byDate.get("2026-09-03")).toBe(0);
  });

  it("spans multiple weeks for a longer range", () => {
    // 2026-09-01 (Tue) to 2026-09-20 (Sun) is just under 3 weeks.
    const weeks = buildHeatmapWeeks([], "2026-09-01", "2026-09-20");
    expect(weeks.length).toBe(4);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0].date).toBe("2026-08-30"); // Sunday before the range starts
    expect(weeks[weeks.length - 1][6].date).toBe("2026-09-26"); // Saturday after it ends
  });

  it("padding days outside the range never carry a real amount even if one happens to match the date", () => {
    const weeks = buildHeatmapWeeks([{ date: "2026-08-31", amount: 99 }], "2026-09-01", "2026-09-03");
    const padding = weeks[0].find((d) => d.date === "2026-08-31")!;
    expect(padding.inRange).toBe(false);
    expect(padding.amount).toBe(0);
  });

  it("returns an empty array when the range is inverted", () => {
    expect(buildHeatmapWeeks([], "2026-09-05", "2026-09-01")).toEqual([]);
  });

  it("handles a range crossing a month and year boundary", () => {
    const weeks = buildHeatmapWeeks([], "2025-12-30", "2026-01-02");
    const dates = weeks.flat().map((d) => d.date);
    expect(dates).toContain("2025-12-30");
    expect(dates).toContain("2026-01-02");
  });
});

describe("heatmapBucket", () => {
  it("buckets 0 or negative amounts as step 0 regardless of max", () => {
    expect(heatmapBucket(0, 100)).toBe(0);
    expect(heatmapBucket(-5, 100)).toBe(0);
  });

  it("buckets a positive amount into 1..bucketCount-1 scaled against max", () => {
    expect(heatmapBucket(1, 100, 5)).toBe(1);
    expect(heatmapBucket(25, 100, 5)).toBe(1);
    expect(heatmapBucket(26, 100, 5)).toBe(2);
    expect(heatmapBucket(100, 100, 5)).toBe(4);
  });

  it("clamps an amount above max to the top bucket", () => {
    expect(heatmapBucket(500, 100, 5)).toBe(4);
  });

  it("treats a zero or negative max as no data (bucket 0)", () => {
    expect(heatmapBucket(10, 0)).toBe(0);
  });
});
