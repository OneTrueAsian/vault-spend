import { describe, expect, it } from "vitest";
import * as checks from "./askLayoutChecks.mjs";

describe("M6 compiled layout evidence must prove the labelled state", () => {
  const choices = () => [checks.LONG_STORE.toUpperCase(), checks.LONG_STORE_ALTERNATIVE.toUpperCase(), "Both"];
  it("rejects a generic refusal that used to count as a long-store clarification", () => {
    expect(() => checks.assertLayoutState("clarification-long-store", { clarification: false, answer: false, choices: [], status: "", text: "I couldn't find that store" })).toThrow(/clarification/);
  });
  it("accepts only real, visible long-store choices, with no financial answer", () => {
    const state = { clarification: true, answer: false, choices: choices(), status: "", text: choices().join(" ") };
    expect(() => checks.assertLayoutState("clarification-long-store", state)).not.toThrow();
    for (const invalid of [{ ...state, answer: true }, { ...state, choices: ["Random store", "Both"] }, { ...state, choices: choices().slice(1) }]) {
      expect(() => checks.assertLayoutState("clarification-long-store", invalid)).toThrow();
    }
  });
  it("does not credit a review screen as reading just because the dialog title remained", () => {
    expect(() => checks.assertLayoutState("m3-reading", { text: "What if you spent less on Dining Check these details", status: "", clarification: false, answer: false, choices: [] })).toThrow(/reading/i);
    expect(() => checks.assertLayoutState("m3-reading", { text: "", status: "Reading your last three months of Dining…", clarification: false, answer: false, choices: [] })).not.toThrow();
  });
  it("requires both declared widths, and does not multiply narrow-only states", () => {
    const required = checks.requiredLayoutCoverage(["ordinary", "m3", "m4"]);
    expect(required).toContain("720 clarification-long-store");
    expect(required).toContain("960 clarification-long-store");
    expect(required).toContain("720 m3-reading");
    expect(required).not.toContain("960 m3-reading");
    expect(() => checks.assertLayoutCoverage(new Set(required), ["ordinary", "m3", "m4"])).not.toThrow();
    expect(() => checks.assertLayoutCoverage(new Set(required.filter(x => x !== "960 clarification-long-store")), ["ordinary", "m3", "m4"])).toThrow(/960 clarification-long-store/);
  });
});
