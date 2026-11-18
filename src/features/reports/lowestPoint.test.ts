import { describe, expect, it } from "vitest";
import { lowestPoint } from "./lowestPoint";

describe("lowestPoint", () => {
  it("finds the day the balance bottoms out", () => {
    const points = [
      { date: "2026-09-18", balance: "3000" },
      { date: "2026-09-28", balance: "1200" },
      { date: "2026-09-29", balance: "1300" },
      { date: "2026-10-05", balance: "3300" },
    ];

    expect(lowestPoint(points)).toEqual({ date: "2026-09-28", balance: 1200 });
  });

  it("is null for no points", () => {
    expect(lowestPoint([])).toBeNull();
  });
});
