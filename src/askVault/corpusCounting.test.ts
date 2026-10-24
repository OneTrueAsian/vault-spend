import { describe, expect, it } from "vitest";
import { countKey, canonical, validateManifest } from "../testSupport/askVaultM6/counting";

describe("M6 count-key-v1 (Validation-Plan VP-03)", () => {
  it("normalizes NFC, CRLF, Unicode whitespace and locale-independent case for counting only", () => {
    expect(countKey("  CAFE\u0301\r\n spending\u00a0 LAST month  ")).toBe(countKey("café spending last month"));
  });
  it.each([["spend $1.00", "spend $100"], ["spend last month", "spend not last month"], ['at "Sam"', "at Sam"], ["over $50", "under $50"], ["in 2026", "in 2027"], ["spending?", "spending"]])("preserves material spelling: %s / %s", (a,b) => expect(countKey(a)).not.toBe(countKey(b)));
  it("canonical request keys sort object keys but preserve array order, money representation and every filter", () => {
    expect(canonical({ a: 1, b: [2,3] })).toBe(canonical({ b: [2,3], a: 1 }));
    expect(canonical({ a: [2,3] })).not.toBe(canonical({ a: [3,2] }));
    expect(canonical({ amount: "10.00" })).not.toBe(canonical({ amount: "10" }));
    expect(() => canonical({ amount: NaN })).toThrow();
  });
  it("refuses overlapping core/long-tail texts, duplicate IDs and missing financial seeds", () => {
    const required = [101,202,303].map(seed => ({ seed, contextId: String(seed), requestId: "q", referenceId: "r"+seed }));
    const c = { id: "a", text: "Spending last month", population: "P-CORE" as const, family: "m1:total-all", cluster: "total", tags: [], required };
    expect(() => validateManifest([c, { ...c, id: "b", text: " spending LAST month ", population: "P-LT" }])).toThrow(/overlap/);
    expect(() => validateManifest([c, { ...c }])).toThrow(/duplicate/i);
    expect(() => validateManifest([{ ...c, required: required.slice(1) }])).toThrow(/three|3/i);
    expect(() => validateManifest([c, { ...c, id: "b" }])).not.toThrow(); // collision retains both contexts; never extra credit
  });
});
