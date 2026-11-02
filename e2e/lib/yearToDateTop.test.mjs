import { describe, expect, it } from "vitest";
import { yearToDateTop3 } from "./yearToDateTop.mjs";

const ROWS = [
  ["a", 1, 5, "x", "-120.00", "Groceries"], ["a", 1, 9, "x", "-45.50", "Dining Out"], ["a", 1, 12, "x", "-80.00", "Groceries"], ["a", 1, 20, "x", "-60.00", "Gas"], ["a", 1, 1, "x", "-900.00", "Rent"],
  ["c", 1, 14, "x", "-70.00", "Dining Out"], ["c", 2, 6, "x", "-100.00", "Groceries"], ["a", 2, 10, "x", "-30.00", "Dining Out"], ["a", 2, 1, "x", "-900.00", "Rent"], ["a", 2, 22, "x", "-55.00", "Gas"],
  ["a", 0, 1, "x", "-25.00", "Groceries"], ["a", 1, 16, "x", "-33.00", "Dining In"],
];
describe("yearToDateTop3", () => {
  it("27 October 2026: all three months fall in the year (Rent 1,800; Groceries 325; Dining Out 145.50)", () => {
    expect(yearToDateTop3(ROWS, new Date(2026, 9, 27))).toEqual([["Rent", "1,800.00"], ["Groceries", "325.00"], ["Dining Out", "145.50"]]);
  });
  it("January: last month and the month before are last year, so only this month's Groceries remain", () => {
    expect(yearToDateTop3(ROWS, new Date(2027, 0, 15))).toEqual([["Groceries", "25.00"]]);
  });
  it("February: the month before last is last year", () => {
    expect(yearToDateTop3(ROWS, new Date(2027, 1, 10))).toEqual([["Rent", "900.00"], ["Groceries", "225.00"], ["Dining Out", "115.50"]]);
  });
});
