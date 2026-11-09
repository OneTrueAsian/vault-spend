// Page-side totals are added in whole cents (2026-10-02 QA, L8): adding parsed floats drifts
// (0.1 + 0.2 = 0.30000000000000004), and a long column of amounts can round a cent the wrong way.
import { describe, expect, it } from "vitest";
import { sumMoney } from "./money";

describe("sumMoney", () => {
  it("adds money exactly", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe(0.3);
    expect(sumMoney(Array(1000).fill("0.01"))).toBe(10);
    expect(sumMoney(["19.99", "-5.01", "100"])).toBe(114.98);
  });

  it("accepts numbers and strings with a currency sign or commas", () => {
    expect(sumMoney([1.1, "2.2", "$1,000.05"])).toBe(1003.35);
  });

  it("treats blanks and non-numbers as zero", () => {
    expect(sumMoney([])).toBe(0);
    expect(sumMoney(["", "abc", "4.50"])).toBe(4.5);
  });
});
