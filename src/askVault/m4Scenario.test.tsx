// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { m4Rows, m4Intent, m4Expected, nativeM4Input, retainedM4Vectors } from "../testSupport/askVaultM6/m4Scenario";
import { observeM4 } from "../testSupport/askVaultM6/routeHarnessM4";
import { calculateCutPreview } from "./cutPreviewMath";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** VP-06/08, M4 Financial-Rules: separate exact reference, real native baselines, real public card and explicit consent. */
describe("M4 conversion: independent reference and public flow", () => {
  it("preserves all 120 retained Fraction vectors and agrees with their full exact financial outputs", () => {
    expect(retainedM4Vectors()).toHaveLength(120);
    for (const v of retainedM4Vectors()) {
      expect(m4Expected(v.scenario.intent, v.scenario.baselines), v.name).toEqual(v.expected);
      const { scenario: _scenario, ...actual } = calculateCutPreview(v.scenario) as ReturnType<typeof calculateCutPreview> & { scenario?: unknown };
      expect(actual, v.name).toEqual(v.expected);
    }
  });
  it("retains both target bases, zero/penny/shortfall targets, floors and money/percentage caps without dropping any row", () => {
    expect(m4Rows()).toHaveLength(24);
    expect(new Set(m4Rows().map(r => r.basis))).toEqual(new Set(["monthly", "total"]));
    for (const seed of [101, 202, 303]) for (const row of m4Rows()) {
      const input = nativeM4Input(row, seed);
      expect(input.nativeItems).toHaveLength(2);
      expect(input.baselines.every(b => b.baseline.kind === "recorded")).toBe(true);
      expect(m4Expected(m4Intent(row), input.baselines).kind).toBe("preview");
    }
  });
  it("hand anchor: a penny tie goes to the lexical first category, while zero capacity leaves the whole positive target unmet", () => {
    const row = m4Rows()[0], intent = m4Intent({ ...row, target: "0.01", basis: "monthly", policy: "percent" });
    const baseline = (category: string, amount: string) => ({ category, baseline: { kind: "manual", monthlyAmount: amount } });
    const tie = m4Expected(intent, [baseline("Dining", "1"), baseline("Groceries", "1")]);
    expect(tie.allocations.map(a => [a.category, a.allocatedCents])).toEqual([["Dining", "1"], ["Groceries", "0"]]);
    const zero = m4Expected(intent, [baseline("Dining", "0"), baseline("Groceries", "0")]);
    expect([zero.maximumCents, zero.shortfallCents, zero.targetMet]).toEqual(["0", "1", false]);
  });
  it("every native baseline used is in the native-produced proof, with unchanged input digests", () => {
    const p = JSON.parse(readFileSync("src/testSupport/askVaultM6/nativeProofs/native-proof-scenario-prerequisites.json", "utf8"));
    for (const seed of [101, 202, 303]) for (const row of m4Rows()) for (const id of nativeM4Input(row, seed).nativeItems) expect(p.baseline).toContain(id);
  });
  it("every question completes on three seeds with its full intent and all rendered amounts; no result before consent", async () => {
    for (const seed of [101, 202, 303]) for (const row of m4Rows()) {
      const observation = await observeM4(row, seed);
      expect(observation.beforeConsent, `${row.id}/${seed}`).toBe(false);
      expect(observation.request, `${row.id}/${seed}`).toEqual(m4Intent(row));
      expect(observation.result, `${row.id}/${seed}`).toEqual(m4Expected(m4Intent(row), nativeM4Input(row, seed).baselines));
      expect(observation.displayProblems, `${row.id}/${seed}`).toEqual([]);
    }
  }, 120_000);
});
