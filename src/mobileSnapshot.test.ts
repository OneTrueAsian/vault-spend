import { describe, expect, it } from "vitest";
import complete from "../core/tests/fixtures/mobile_snapshot_v1.json";
import comparisons from "../core/tests/fixtures/mobile_snapshot_comparisons_v1.json";
import cases from "../core/tests/fixtures/mobile_snapshot_cases.json";
import empty from "../core/tests/fixtures/mobile_snapshot_empty_v1.json";
import { parseMobileSnapshot, MAX_MOBILE_SNAPSHOT_BYTES } from "./mobileSnapshot";

const copy = () => structuredClone(complete);
describe("mobile V1 boundary", () => {
  it("accepts complete and empty profiles without IPC", () => {
    expect(parseMobileSnapshot(JSON.stringify(complete))).toEqual(complete);
    expect(parseMobileSnapshot(JSON.stringify(empty))).toEqual(empty);
    expect(parseMobileSnapshot(JSON.stringify(comparisons))).toEqual(comparisons);
  });
  it.each([
    ["future schema", (v: ReturnType<typeof copy>) => { v.schemaVersion = 2; }],
    ["future viewer", (v: ReturnType<typeof copy>) => { v.minimumViewerVersion = 2; }],
    ["float money", (v: ReturnType<typeof copy>) => { Object.assign(v.overview, { cash: 0.1 }); }],
    ["invalid date", (v: ReturnType<typeof copy>) => { v.asOfDate = "2026-02-30"; }],
    ["noncanonical sequence", (v: ReturnType<typeof copy>) => { v.sequence = "01"; }],
    ["future actuals", (v: ReturnType<typeof copy>) => { v.history.months[0].month = "2026-11"; }],
    ["raw ledger", (v: ReturnType<typeof copy>) => { Object.assign(v, { transactions: [] }); }],
    ["raw holdings", (v: ReturnType<typeof copy>) => { Object.assign(v.investments, { holdings: [] }); }],
    ["missing section", (v: ReturnType<typeof copy>) => { Reflect.deleteProperty(v, "calculators"); }],
    ["duplicate account", (v: ReturnType<typeof copy>) => { v.accounts.push(v.accounts[0]); }],
  ])("rejects %s", (_name, mutate) => {
    const v = copy(); mutate(v);
    expect(() => parseMobileSnapshot(JSON.stringify(v))).toThrow();
  });
  it.each(cases)("shared compatibility: $name", ({ path, value, valid }) => {
    const v = copy();
    const keys = path.slice(1).split("/");
    let parent: unknown = v;
    for (const key of keys.slice(0, -1)) parent = (parent as Record<string, unknown>)[key];
    (parent as Record<string, unknown>)[keys[keys.length - 1]] = value;
    if (valid) expect(parseMobileSnapshot(JSON.stringify(v))).toEqual(v);
    else expect(() => parseMobileSnapshot(JSON.stringify(v))).toThrow();
  });
  it("preserves a uint64 sequence above JavaScript's safe Number range", () => {
    const v = copy(); v.sequence = "9007199254740993";
    expect(parseMobileSnapshot(JSON.stringify(v)).sequence).toBe("9007199254740993");
    v.sequence = "18446744073709551616";
    expect(() => parseMobileSnapshot(JSON.stringify(v))).toThrow();
  });
  it("checks expected installation and profile before replacement", () => {
    expect(() => parseMobileSnapshot(JSON.stringify(complete), { installationId: "other", profileId: complete.profile.id })).toThrow();
    expect(() => parseMobileSnapshot(JSON.stringify(complete), { installationId: complete.installationId, profileId: "other" })).toThrow();
  });
  it("rejects over-limit bodies rather than shortening history", () => {
    expect(() => parseMobileSnapshot(" ".repeat(MAX_MOBILE_SNAPSHOT_BYTES + 1))).toThrow();
  });
  it("redacts malformed JSON and untrusted property names in errors", () => {
    expect(() => parseMobileSnapshot("private-financial-content")).toThrow("Invalid mobile snapshot at json");
    const v = copy(); Object.assign(v, { "private-financial-content": true });
    expect(() => parseMobileSnapshot(JSON.stringify(v))).toThrow("Invalid mobile snapshot at snapshot");
  });
  it("retains more than twelve months of aggregate history", () => {
    const v = copy(); v.history.fromMonth = "2025-01";
    v.history.months = Array.from({ length: 22 }, (_, i) => ({ month: `${2025 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`, income: "0.00", spending: "0.00", savingsRatePct: null }));
    expect(parseMobileSnapshot(JSON.stringify(v)).history.months).toHaveLength(22);
  });
  it("keeps gross cash flow separate from split-aware net budget actuals", () => {
    const v = parseMobileSnapshot(JSON.stringify(complete));
    expect(v.history.months.find(m => m.month === "2026-09")).toMatchObject({ income: "5100.00", spending: "900.00" });
    expect(v.budgets.find(b => b.month === "2026-09")!.lines.find(l => l.category === "Groceries")).toMatchObject({ actual: "250.00", rollover: "50.00", effectiveBudget: "350.00", remaining: "100.00" });
    expect(v.overview.netWorth).toBe("27800.00");
    expect(v.investments.unrealizedGain).toBe("1000.00");
    expect(v.investments.dayChange).toBeNull();
  });
});
