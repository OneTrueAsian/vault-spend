import { describe, expect, it } from "vitest";
import { distance } from "./distance";

describe("distance between two words", () => {
  it("counts a wrong, missing or extra letter as one slip", () => {
    expect(distance("spend", "spend")).toBe(0);
    expect(distance("spend", "spent")).toBe(1);
    expect(distance("spnd", "spend")).toBe(1);
    expect(distance("sspend", "spend")).toBe(1);
  });
  it("counts two neighbouring letters swapped as one slip", () => {
    expect(distance("sepnd", "spend")).toBe(1);
    expect(distance("wohle", "whole")).toBe(1);
  });
  it("does not count letters swapped far apart as one slip", () => {
    expect(distance("sdnep", "spend")).toBeGreaterThan(1);
    expect(distance("", "abc")).toBe(3);
  });
});
