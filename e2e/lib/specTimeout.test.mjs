import { describe, expect, it } from "vitest";
import { DEFAULT_SPEC_TIMEOUT_MS, resolveSpecTimeout } from "./specTimeout.mjs";

// run-all.mjs kills a spec that outlives this ceiling. The 60 s default is right for a developer machine; the
// hosted Windows runner measured 15-60 s for protection specs that take about 10 s locally, so CI may raise it.

describe("resolveSpecTimeout", () => {
  it("keeps the 60 second ceiling when nothing is configured", () => {
    expect(DEFAULT_SPEC_TIMEOUT_MS).toBe(60_000);
    expect(resolveSpecTimeout({})).toBe(60_000);
    expect(resolveSpecTimeout({ VAULTSPEND_E2E_SPEC_TIMEOUT_MS: "" })).toBe(60_000);
  });

  it("accepts a whole number of milliseconds from the environment", () => {
    expect(resolveSpecTimeout({ VAULTSPEND_E2E_SPEC_TIMEOUT_MS: "180000" })).toBe(180_000);
  });

  it("refuses values that would disable or hide the hang guard", () => {
    for (const bad of ["abc", "12.5", "-1", "0", "59999", "600001", "1e5", " 120000"]) {
      expect(() => resolveSpecTimeout({ VAULTSPEND_E2E_SPEC_TIMEOUT_MS: bad }), bad).toThrow(/VAULTSPEND_E2E_SPEC_TIMEOUT_MS/);
    }
  });
});
