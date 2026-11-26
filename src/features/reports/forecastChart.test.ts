import { describe, expect, it } from "vitest";
import { forecastChartPoints, forecastHorizons } from "./forecastChart";

// VS-45: 6 and 12 months reach the same date that many months ahead, so a yearly bill due on today's date is included.
describe("forecastHorizons", () => {
  it("offers 30, 60 and 90 days, then the days to the same date 6 and 12 months ahead", () => {
    expect(forecastHorizons(new Date(2026, 10, 22))).toEqual([
      { label: "30 days", days: 30 },
      { label: "60 days", days: 60 },
      { label: "90 days", days: 90 },
      { label: "6 months", days: 181 },
      { label: "12 months", days: 365 },
    ]);
  });

  it("counts a leap day and stops at the end of a shorter month", () => {
    expect(forecastHorizons(new Date(2027, 5, 1)).at(-1)!.days).toBe(366);
    expect(forecastHorizons(new Date(2026, 7, 31))[3].days).toBe(181);
  });
});

describe("forecastChartPoints", () => {
  const days = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(2026, 9, 4 + i);
      return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, balance: String(1000 + i) };
    });

  it("labels about every 8th day the way chart axes write dates", () => {
    const pts = forecastChartPoints(days(30));
    const labels = pts.map((p) => p.label).filter(Boolean);
    expect(labels).toEqual(["Oct 4", "Oct 8", "Oct 12", "Oct 16", "Oct 20", "Oct 24", "Oct 28", "Nov 1"]);
    expect(labels.some((l) => /\d{2}-\d{2}/.test(l))).toBe(false);
  });

  it("keeps every point's value", () => {
    const pts = forecastChartPoints(days(5));
    expect(pts.map((p) => p.value)).toEqual([1000, 1001, 1002, 1003, 1004]);
    expect(pts.every((p) => p.label !== "")).toBe(true);
  });
});
