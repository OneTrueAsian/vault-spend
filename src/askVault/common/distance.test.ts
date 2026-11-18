import { describe, expect, it } from "vitest";
import { distance } from "./distance";

describe("distance between two words", () => {
  it("caps a bounded lookup without changing accepted substitutions, insertions or swaps", () => {
    expect(distance("", "abcd", 1)).toBe(2);
    expect(distance("groceries", "category 0001", 1)).toBe(2);
    expect(distance("sepnd", "spend", 1)).toBe(1);
    expect(distance("spent", "spend", 1)).toBe(1);
    expect(distance("spnd", "spend", 1)).toBe(1);
  });
  it("agrees with the full edit distance at each fuzzy acceptance boundary", () => {
    let level = [""];
    const words = [...level];
    for (let length = 1; length <= 4; length++) {
      level = level.flatMap(word => [word + "a", word + "b"]);
      words.push(...level);
    }
    for (const a of words) for (const b of words) for (const limit of [1, 2])
      expect(distance(a, b, limit), `${a}/${b}/${limit}`).toBe(Math.min(distance(a, b), limit + 1));
  });
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
