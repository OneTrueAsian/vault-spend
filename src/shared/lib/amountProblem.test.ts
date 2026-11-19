import { describe, expect, it } from "vitest";
import { amountTextProblem } from "./amountProblem";

// VS-49: an amount box says how to fix what was typed, instead of only greying out the button. Owner decision 2026-11-19: commas
// stay rejected, and the box says to leave them out.
describe("what's wrong with a typed amount", () => {
  it("says nothing about an empty box or a usable amount", () => {
    for (const text of ["", "  ", "1250.40", "-12", "0.5"]) expect(amountTextProblem(text), text).toBeNull();
  });
  it("shows the amount without its commas", () => {
    expect(amountTextProblem("1,250.40")).toBe("Leave out the comma: 1250.40");
    expect(amountTextProblem(" 12,345,678 ")).toBe("Leave out the comma: 12345678");
  });
  it("gives an example for anything else", () => {
    for (const text of ["abc", "$12", "12.3.4", "1,2a"]) expect(amountTextProblem(text), text).toBe("Enter an amount like 1250.40.");
  });
});
