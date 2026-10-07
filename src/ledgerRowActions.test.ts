import { describe, expect, it } from "vitest";
import { ledgerRowActions } from "./ledgerRowActions";
const t = (over: Partial<{ amount: string; split_count: number; notes: string | null }> = {}) =>
  ({ amount: "-20.00", split_count: 0, notes: null, ...over }) as never;
const base = { splitEnabled: true, debtEnabled: true, isLoanAccount: false, canApplyToDebt: true, hasPrincipalOverride: false, hasAppliedDebt: false };

describe("ledgerRowActions", () => {
  it("offers split, apply to a debt, note, tag and delete for an ordinary purchase", () => {
    expect(ledgerRowActions(t(), base).map((a) => a.label)).toEqual(["Split…", "Apply to a debt…", "Add note…", "Add tag…", "Delete…"]);
  });
  it("says Edit splits / Edit note when they exist", () => {
    expect(ledgerRowActions(t({ split_count: 2, notes: "x" }), base).map((a) => a.label)).toEqual(["Edit splits…", "Apply to a debt…", "Edit note…", "Add tag…", "Delete…"]);
  });
  it("offers principal on a loan account instead of apply to a debt", () => {
    expect(ledgerRowActions(t(), { ...base, isLoanAccount: true }).map((a) => a.id)).toEqual(["split", "principal", "note", "tag", "delete"]);
  });
  it("hides debt items when the feature is off, already applied, or money came in", () => {
    expect(ledgerRowActions(t(), { ...base, debtEnabled: false }).some((a) => a.id === "applyDebt")).toBe(false);
    expect(ledgerRowActions(t(), { ...base, hasAppliedDebt: true }).some((a) => a.id === "applyDebt")).toBe(false);
    expect(ledgerRowActions(t({ amount: "20.00" }), base).some((a) => a.id === "applyDebt")).toBe(false);
  });
  it("hides split when splitting is turned off", () => {
    expect(ledgerRowActions(t(), { ...base, splitEnabled: false }).some((a) => a.id === "split")).toBe(false);
  });
  it("hides principal on a loan account when it is already set or debt is off", () => {
    expect(ledgerRowActions(t(), { ...base, isLoanAccount: true, hasPrincipalOverride: true }).some((a) => a.id === "principal")).toBe(false);
    expect(ledgerRowActions(t(), { ...base, isLoanAccount: true, debtEnabled: false }).some((a) => a.id === "principal")).toBe(false);
  });
  it("hides apply to a debt when no debt can take it", () => {
    expect(ledgerRowActions(t(), { ...base, canApplyToDebt: false }).some((a) => a.id === "applyDebt")).toBe(false);
  });
});
