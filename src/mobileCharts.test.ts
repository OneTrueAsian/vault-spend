import { describe, expect, it } from "vitest";
import { donutSlices } from "./mobileCharts";

describe("donutSlices", () => {
  it("gives each category its own colour and share, biggest first", () => {
    const slices = donutSlices([["Housing", "500.00"], ["Groceries", "300.00"], ["Fuel", "200.00"]]);
    expect(slices.map((s) => [s.label, s.amount, Math.round(s.share)])).toEqual([
      ["Housing", "500.00", 50],
      ["Groceries", "300.00", 30],
      ["Fuel", "200.00", 20],
    ]);
    expect(new Set(slices.map((s) => s.color)).size).toBe(3);
  });

  it("keeps six slices at most: the five biggest and Other, so no two slices share a colour", () => {
    const rows: [string, string][] = ["A", "B", "C", "D", "E", "F", "G", "H"].map((l, i) => [l, `${(80 - i * 10).toFixed(2)}`]);
    const slices = donutSlices(rows);
    expect(slices.map((s) => s.label)).toEqual(["A", "B", "C", "D", "E", "Other"]);
    expect(Number(slices[5].amount)).toBe(60); // 30 + 20 + 10
    expect(new Set(slices.map((s) => s.color)).size).toBe(6);
    expect(Math.round(slices.reduce((sum, s) => sum + s.share, 0))).toBe(100);
  });

  it("shows six categories as they are, without an Other slice", () => {
    const rows: [string, string][] = ["A", "B", "C", "D", "E", "F"].map((l) => [l, "10.00"]);
    expect(donutSlices(rows).map((s) => s.label)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("leaves out categories with nothing spent, and returns nothing when nothing was spent", () => {
    expect(donutSlices([["Housing", "100.00"], ["Refund", "-20.00"], ["Zero", "0.00"]]).map((s) => s.label)).toEqual(["Housing"]);
    expect(donutSlices([["Zero", "0.00"]])).toEqual([]);
  });
});
