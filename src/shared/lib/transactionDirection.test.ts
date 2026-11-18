import { describe, expect, it } from "vitest";
import { amountProblem, directionLabels, signedAmount } from "./transactionDirection";

describe("signedAmount", () => {
  it("makes money out negative and money in positive", () => {
    expect(signedAmount("50", "out")).toBe("-50");
    expect(signedAmount("50", "in")).toBe("50");
  });

  it("ignores a typed sign: the switch decides", () => {
    expect(signedAmount("-50", "out")).toBe("-50");
    expect(signedAmount("-50", "in")).toBe("50");
    expect(signedAmount("+12.5", "out")).toBe("-12.5");
    expect(signedAmount(" −7.25 ", "out")).toBe("-7.25");
  });

  it("keeps the typed precision", () => {
    expect(signedAmount("4.50", "out")).toBe("-4.50");
    expect(signedAmount("100.00", "in")).toBe("100.00");
    expect(signedAmount(".5", "in")).toBe(".5");
  });

  it("refuses zero and things that aren't numbers", () => {
    expect(signedAmount("0", "out")).toBeNull();
    expect(signedAmount("0.00", "in")).toBeNull();
    expect(signedAmount("-0", "in")).toBeNull();
    expect(signedAmount("", "out")).toBeNull();
    expect(signedAmount("   ", "out")).toBeNull();
    expect(signedAmount("-", "out")).toBeNull();
    expect(signedAmount("12abc", "out")).toBeNull();
    expect(signedAmount("--5", "out")).toBeNull();
    expect(signedAmount("-+5", "out")).toBeNull();
  });
});

describe("amountProblem", () => {
  it("says why an amount can't be saved", () => {
    expect(amountProblem("")).toBe("empty");
    expect(amountProblem("  ")).toBe("empty");
    expect(amountProblem("-")).toBe("not_a_number");
    expect(amountProblem("12abc")).toBe("not_a_number");
    expect(amountProblem("--5")).toBe("not_a_number");
    expect(amountProblem("0")).toBe("zero");
    expect(amountProblem("-0.00")).toBe("zero");
    expect(amountProblem("−7.25")).toBeNull();
    expect(amountProblem("50")).toBeNull();
  });
});

describe("directionLabels", () => {
  it("says Charge / Payment for cards and loans", () => {
    expect(directionLabels("credit")).toEqual(["Charge", "Payment"]);
    expect(directionLabels("loan")).toEqual(["Charge", "Payment"]);
    expect(directionLabels("checking")).toEqual(["Money out", "Money in"]);
    expect(directionLabels(undefined)).toEqual(["Money out", "Money in"]);
  });
});
