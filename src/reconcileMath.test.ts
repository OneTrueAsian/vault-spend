import { describe, expect, it } from "vitest";
import { addAmounts, changeFor, fromUnits, isZero, statementDifference, toUnits } from "./reconcileMath";

describe("reconcile arithmetic", () => {
  it("adds money exactly, without floating-point drift", () => {
    expect(addAmounts(["0.10", "0.20"])).toBe("0.30");
    expect(addAmounts(["-43.08", "52.36", "7.40"])).toBe("16.68");
    expect(fromUnits(toUnits("-0.5"))).toBe("-0.50");
  });
  it("computes the statement difference the same way the app does", () => {
    expect(statementDifference("1150.00", "1000.00", ["200.00", "-50.00"])).toBe("0.00");
    expect(isZero(statementDifference("80.00", "300.00", [changeFor("credit", "-80.00"), changeFor("credit", "300.00")]))).toBe(true);
  });
  it("follows each account kind for rows being added", () => {
    expect(changeFor("cash", "-5.00")).toBe("-5.00");
    expect(changeFor("credit", "-5.00")).toBe("5.00");
    expect(changeFor("loan", "100.00")).toBe("-100.00");
  });
  it("refuses text that isn't an amount", () => {
    expect(() => toUnits("12abc")).toThrow();
    expect(() => toUnits("")).toThrow();
    expect(() => toUnits("1.23456")).toThrow();
  });
  it("keeps four decimals and never shows negative zero", () => {
    expect(fromUnits(toUnits("1.2345"))).toBe("1.2345");
    expect(fromUnits(0n)).toBe("0.00");
    expect(addAmounts(["-0.00", "0.00"])).toBe("0.00");
  });
  it("lowers a loan by its principal part when the row has one", () => {
    expect(changeFor("loan", "100.00", "60.00")).toBe("-60.00");
    expect(changeFor("loan", "100.00", null)).toBe("-100.00");
    expect(changeFor("loan", "100.00")).toBe("-100.00");
    expect(changeFor("credit", "-5.00", "1.00")).toBe("5.00");
  });
  it("adds negatives and cents across zero exactly", () => {
    expect(addAmounts([])).toBe("0.00");
    expect(addAmounts(["-0.01", "0.01"])).toBe("0.00");
    expect(addAmounts(["-1.005", "0.0050"])).toBe("-1.00");
    expect(addAmounts(["0.001", "0.002"])).toBe("0.003");
  });
});
