import { describe, expect, it } from "vitest";
import { shortMonthDay } from "./format";

describe("shortMonthDay", () => {
  it("turns a stored date into a compact axis label", () => {
    expect(shortMonthDay("2026-09-18")).toBe("Sep 18");
    expect(shortMonthDay("2025-01-05")).toBe("Jan 5");
    expect(shortMonthDay("2026-12-31")).toBe("Dec 31");
  });

  it("leaves something that isn't a date alone", () => {
    expect(shortMonthDay("Yr 3")).toBe("Yr 3");
  });
});
