import { describe, expect, it } from "vitest";
import { resolveVendor, vendorMatches, vendorTerm, vendorWords } from "./vendor";

describe("the matching rule mirrors the native read (same table as the Rust test)", () => {
  const table: [string, string, boolean][] = [
    ["SAMS CLUB #6482", "sams club", true],
    ["Sam's Club", "Sam's Club", true],
    ["SAMSCLUB.COM", "sams club", true],
    ["Samantha's Bakery", "sam", true],
    ["Grams Clubhouse", "ams", false],
    ["Grams Clubhouse", "club", true],
    ["SAMSCLUB.COM", "club", false],
    ["SAMS CLUB #6482", "club", true],
    ["SPEEDWAY 04123 MUNCIE IN", "speedway", true],
    ["SPEEDWAY 04123 MUNCIE IN", "Speedway Muncie", false], // a store number sits between the words
    ["SPEEDWAY 04123 MUNCIE IN", "muncie", true],
    ["Walmart Supercenter", "walmrt", false],
  ];
  it.each(table)("%s vs %s -> %s", (description, term, expected) => {
    expect(vendorMatches(description, vendorTerm(term)!)).toBe(expected);
  });
});

describe("words and terms", () => {
  it("drops apostrophes and splits on anything that is not a letter or digit", () => {
    expect(vendorWords("Sam’s Club #6482")).toEqual(["sams", "club", "6482"]);
    expect(vendorWords("WAL-MART.COM")).toEqual(["wal", "mart", "com"]);
  });
  it("a term needs two characters and at most six words", () => {
    expect(vendorTerm("a")).toBeNull();
    expect(vendorTerm("!!")).toBeNull();
    expect(vendorTerm("a b c d e f g")).toBeNull();
    expect(vendorTerm("ab")).toBe("ab");
    expect(vendorTerm("x".repeat(65))).toBeNull();
  });
});

const descriptions = [
  "SAMS CLUB #6482", "SAMS CLUB #6482", "Sam's Club", "SAMSCLUB.COM", "Samantha's Bakery",
  "SPEEDWAY 04123 MUNCIE IN", "SPEEDWAY 07754 ANDERSON IN", "Walmart Supercenter", "Costco",
];

describe("resolving what a person typed", () => {
  it("one store written several ways is one match, with every name it covers", () => {
    const r = resolveVendor("sams club", descriptions);
    expect(r).toMatchObject({ status: "matched", term: "sams club" });
    if (r.status === "matched") expect(r.names.sort()).toEqual(["SAMS CLUB #6482", "SAMSCLUB.COM", "Sam's Club"].sort());
  });
  it("a store with several locations is one match", () => {
    expect(resolveVendor("speedway", descriptions)).toMatchObject({ status: "matched", term: "speedway" });
  });
  it("a short term that fits different stores asks which, plus both", () => {
    const r = resolveVendor("sam", descriptions);
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") {
      expect(r.choices.map((c) => c.label)).toEqual(["SAMANTHAS BAKERY", "SAMS CLUB"].sort());
      expect(r.choices.every((c) => vendorMatches("SAMS CLUB #6482", vendorTerm(c.term)!) || vendorMatches("Samantha's Bakery", vendorTerm(c.term)!))).toBe(true);
      expect(r.bothTerm).toBe("sam");
    }
  });
  it("a typo with a close store suggests it; a stranger is simply not found", () => {
    expect(resolveVendor("walmrt", descriptions)).toMatchObject({ status: "none", suggestions: [{ label: "WALMART SUPERCENTER" }] });
    expect(resolveVendor("zzyzx", descriptions)).toEqual({ status: "none", suggestions: [] });
  });
  it("a term that is too short is not resolved", () => {
    expect(resolveVendor("a", descriptions)).toEqual({ status: "none", suggestions: [] });
  });
  it("a chosen suggestion's term finds the store", () => {
    const r = resolveVendor("walmrt", descriptions);
    if (r.status !== "none") throw new Error("expected none");
    expect(vendorMatches("Walmart Supercenter", vendorTerm(r.suggestions[0].term)!)).toBe(true);
  });
});

describe("whole-word resolution (for a store named without 'at')", () => {
  it("requires each typed word to be a whole word of the name", () => {
    expect(resolveVendor("whole foods", ["Whole Foods Market"], true)).toMatchObject({ status: "matched" });
    expect(resolveVendor("food", ["Whole Foods Market"], true)).toEqual({ status: "none", suggestions: [] });
    expect(resolveVendor("costco", ["COSTCO #123 MUNCIE"], true)).toMatchObject({ status: "matched", term: "costco" });
  });
  it("is unchanged without the option", () => {
    expect(resolveVendor("food", ["Whole Foods Market"])).toMatchObject({ status: "matched" });
  });
});
