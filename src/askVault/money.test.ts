import { describe, expect, it } from "vitest";
import { addMoney, averageToCents, compareMoney, formatMoney, isMoney, percentChangeTenths, subtractMoney } from "./money";

describe("isMoney", () => {
  it("accepts plain decimal strings only", () => {
    for (const ok of ["0", "12", "12.5", "12.50", "0.001", "79228162514264337593543950335"]) expect(isMoney(ok), ok).toBe(true);
    for (const bad of ["", "-1", "1e3", "1,000", " 1", "1.", ".5", "$5", "NaN", "1.2.3", "٣"]) expect(isMoney(bad), bad).toBe(false);
  });
});

describe("exact arithmetic on decimal strings", () => {
  it("adds without floating point error", () => {
    expect(addMoney("0.1", "0.2")).toBe("0.3");
    expect(addMoney("79228162514264337593543950334", "1")).toBe("79228162514264337593543950335");
    expect(addMoney("0", "0")).toBe("0");
  });
  it("subtracts without floating point error", () => {
    expect(subtractMoney("0.3", "0.1")).toBe("0.2");
    expect(subtractMoney("0.30", "0.10")).toBe("0.2"); // trailing zeros are trimmed; the value is what matters
    expect(subtractMoney("100", "0.01")).toBe("99.99");
    expect(subtractMoney("1", "1")).toBe("0");
  });
  it("goes negative exactly", () => {
    expect(subtractMoney("0.1", "0.3")).toBe("-0.2");
    expect(subtractMoney("5", "12.25")).toBe("-7.25");
  });
  it("keeps cents beyond JavaScript's safe integer range", () => {
    expect(subtractMoney("79228162514264337593543950335", "1")).toBe("79228162514264337593543950334");
    expect(subtractMoney("90071992547409.93", "0.01")).toBe("90071992547409.92");
  });
  it("compares by value, ignoring trailing zeros", () => {
    expect(compareMoney("1.50", "1.5")).toBe(0);
    expect(compareMoney("1.49", "1.5")).toBe(-1);
    expect(compareMoney("10", "9.99")).toBe(1);
  });
});

describe("formatMoney for display", () => {
  it("always shows two decimals and thousands separators", () => {
    expect(formatMoney("0")).toBe("$0.00");
    expect(formatMoney("5")).toBe("$5.00");
    expect(formatMoney("1234.5")).toBe("$1,234.50");
    expect(formatMoney("1234567.89")).toBe("$1,234,567.89");
  });
  it("shows a negative amount with a leading minus", () => {
    expect(formatMoney("-7.25")).toBe("-$7.25");
    expect(formatMoney("-0.2")).toBe("-$0.20");
  });
  it("rounds to the nearest cent, half away from zero, only for display of extra decimals", () => {
    expect(formatMoney("1.005")).toBe("$1.01");
    expect(formatMoney("1.004")).toBe("$1.00");
    expect(formatMoney("-1.005")).toBe("-$1.01");
    expect(formatMoney("0.999")).toBe("$1.00");
  });
  it("does not lose digits on very large amounts", () => {
    expect(formatMoney("79228162514264337593543950335")).toBe("$79,228,162,514,264,337,593,543,950,335.00");
  });
  it("never shows a negative zero", () => {
    expect(formatMoney("-0.001")).toBe("$0.00");
  });
});

describe("averages and percentages round half away from zero", () => {
  it("shows an average to the cent", () => {
    expect(averageToCents("610.00", 3)).toBe("203.33");
    expect(averageToCents("80.00", 3)).toBe("26.67");
    expect(averageToCents("450.50", 4)).toBe("112.63"); // 112.625 rounds up
    expect(averageToCents("0.00", 5)).toBe("0.00");
    expect(averageToCents("5", 2)).toBe("2.50");
  });
  it("rounds a half-cent on a negative amount away from zero", () => {
    expect(averageToCents("-0.05", 2)).toBe("-0.03");
  });
  it("gives a percentage to one decimal", () => {
    expect(percentChangeTenths("30.00", "20.00")).toBe("50.0");
    expect(percentChangeTenths("200.50", "200.00")).toBe("0.3"); // 0.25 rounds up
    expect(percentChangeTenths("199.50", "200.00")).toBe("-0.3");
    expect(percentChangeTenths("0.00", "100.00")).toBe("-100.0");
    expect(percentChangeTenths("1", "3")).toBe("-66.7");
  });
});
