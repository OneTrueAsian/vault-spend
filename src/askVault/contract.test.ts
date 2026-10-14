import { describe, expect, it } from "vitest";
import { validateAskVaultSnapshot } from "./contract";
import type { AskVaultRequest } from "./types";

const base: AskVaultRequest = {
  kind: "total",
  periods: [{ from: "2026-08-01", to: "2026-08-31" }],
  accountIds: [],
  categories: [],
  minimumPurchase: null,
  vendors: [],
  excludeVendors: [],
  excludeCategories: [],
  limit: 1,
  expectedRevision: null,
};
const period = (over: Record<string, unknown> = {}) => ({
  from: "2026-08-01",
  to: "2026-08-31",
  dayCount: 31,
  endsToday: false,
  historyCoverage: "unknown",
  total: "1200.50",
  purchaseCount: 4,
  categoryCount: 2,
  categories: [],
  purchases: [],
  vendors: [],
  vendorNameCount: 0,
  vendorTotals: [],
  leftOut: { total: "0", purchaseCount: 0, vendors: [], categories: [] },
  ...over,
});
const reply = (over: Record<string, unknown> = {}) => ({
  contractVersion: 1,
  context: { generation: 3, sessionRevision: 7 },
  revision: { local: 5, external: 2 },
  asOf: "2026-09-06",
  kind: "total",
  spendingBasis: "gross-negative-allocations",
  thresholdBasis: "absolute-parent-amount",
  periods: [period()],
  difference: null,
  ...over,
});
const totals = (rows: [string, string, number][]) => rows.map(([term, total, purchaseCount]) => ({ term, total, purchaseCount }));
const category = (name: string | null, amount: string, count = 1) => ({ category: name, amount, purchaseCount: count });
const purchase = (id: number, amount: string, date = "2026-08-10") => ({
  transactionId: id, accountId: 1, date, description: "Shop", amount, parentAmount: amount,
});
const expectInvalid = (value: unknown, request = base) =>
  expect(() => validateAskVaultSnapshot(value, request)).toThrowError(expect.objectContaining({ code: "invalid_response" }));

describe("a well-formed reply", () => {
  it("passes through for a total", () => {
    expect(validateAskVaultSnapshot(reply(), base).periods[0].total).toBe("1200.50");
  });
  it("passes for a ranking of categories, with a nullable name", () => {
    const request = { ...base, kind: "rank-categories" as const, limit: 3 };
    const value = reply({ kind: "rank-categories", periods: [period({ categoryCount: 3, categories: [category("Groceries", "300.25"), category(null, "20"), category("Rent", "10")] })] });
    expect(validateAskVaultSnapshot(value, request).periods[0].categories).toHaveLength(3);
  });
  it("passes for a ranking of purchases", () => {
    const request = { ...base, kind: "rank-purchases" as const, limit: 2 };
    const value = reply({ kind: "rank-purchases", periods: [period({ purchases: [purchase(9, "90"), purchase(4, "40")] })] });
    expect(validateAskVaultSnapshot(value, request).periods[0].purchases).toHaveLength(2);
  });
  it("passes for a comparison with the exact difference", () => {
    const request = { ...base, kind: "compare" as const, periods: [{ from: "2026-09-01", to: "2026-09-06" }, base.periods[0]] };
    const value = reply({
      kind: "compare",
      asOf: "2026-09-06",
      periods: [period({ from: "2026-09-01", to: "2026-09-06", dayCount: 6, endsToday: true, total: "100.10" }), period({ total: "400.30" })],
      difference: "-300.2",
    });
    expect(validateAskVaultSnapshot(value, request).difference).toBe("-300.2");
  });
});

describe("store names in a reply", () => {
  const withVendor: AskVaultRequest = { ...base, vendors: ["sams club"] };
  const names = (rows: [string, number][]) => rows.map(([description, purchaseCount]) => ({ description, purchaseCount }));
  it("passes with the names matched, most purchases first", () => {
    const value = reply({ periods: [period({ purchaseCount: 6, vendorNameCount: 2, vendors: names([["SAMS CLUB #6482", 5], ["SAMSCLUB.COM", 1]]), vendorTotals: totals([["sams club", "1200.50", 6]]) })] });
    expect(validateAskVaultSnapshot(value, withVendor).periods[0].vendors).toHaveLength(2);
  });
  it("passes when only some names are listed", () => {
    const value = reply({ periods: [period({ purchaseCount: 30, vendorNameCount: 12, vendors: names([["A", 3], ["B", 2]]), vendorTotals: totals([["sams club", "1200.50", 30]]) })] });
    expect(validateAskVaultSnapshot(value, withVendor).periods[0].vendorNameCount).toBe(12);
  });
  it("refuses names when the question named no store", () => {
    expectInvalid(reply({ periods: [period({ vendorNameCount: 1, vendors: names([["SAMS CLUB", 1]]) })] }));
  });
  it("refuses a list that is out of order, too long, or adds up to more than the purchases", () => {
    const bad = (over: Record<string, unknown>) => expectInvalid(reply({ periods: [period({ purchaseCount: 6, vendorTotals: totals([["sams club", "1200.50", 6]]), ...over })] }), withVendor);
    bad({ vendorNameCount: 2, vendors: names([["A", 1], ["B", 5]]) });
    bad({ vendorNameCount: 11, vendors: names(Array.from({ length: 11 }, (_, i) => [`N${i}`, 1] as [string, number])) });
    bad({ vendorNameCount: 2, vendors: names([["A", 5], ["B", 4]]) });
    bad({ vendorNameCount: 1, vendors: names([["A", 5], ["B", 1]]) });
  });
  it("refuses a full list whose counts do not add up to the purchases", () => {
    expectInvalid(reply({ periods: [period({ purchaseCount: 6, vendorNameCount: 2, vendors: names([["A", 3], ["B", 1]]), vendorTotals: totals([["sams club", "1200.50", 6]]) })] }), withVendor);
  });
});

describe("several stores and what was left out", () => {
  const many: AskVaultRequest = { ...base, vendors: ["meijer", "target"] };
  const names = (rows: [string, number][]) => rows.map(([description, purchaseCount]) => ({ description, purchaseCount }));
  const good = () => period({ total: "180.5", purchaseCount: 3, vendorNameCount: 2, vendors: names([["MEIJER #204", 2], ["Target T-1", 1]]), vendorTotals: totals([["meijer", "150.5", 2], ["target", "30", 1]]) });
  it("passes when the per-store totals add up exactly to the total", () => {
    expect(validateAskVaultSnapshot(reply({ periods: [good()] }), many).periods[0].vendorTotals).toHaveLength(2);
  });
  it("refuses totals that do not add up, the wrong terms or order, or the wrong number of lines", () => {
    const bad = (over: Record<string, unknown>) => expectInvalid(reply({ periods: [{ ...good(), ...over }] }), many);
    bad({ vendorTotals: totals([["meijer", "150.5", 2], ["target", "30.01", 1]]) });
    bad({ vendorTotals: totals([["target", "30", 1], ["meijer", "150.5", 2]]) });
    bad({ vendorTotals: totals([["meijer", "180.5", 3]]) });
    bad({ vendorTotals: totals([["meijer", "150.5", 2], ["target", "30", 2]]) });
  });
  it("refuses store lines when no store was asked about", () => {
    expectInvalid(reply({ periods: [period({ vendorTotals: totals([["meijer", "0", 0]]) })] }));
  });
  const leaving: AskVaultRequest = { ...base, excludeVendors: ["costco"], excludeCategories: ["Rent"] };
  const left = (over: Record<string, unknown>) => reply({ periods: [period({ leftOut: { total: "70", purchaseCount: 1, vendors: names([["Costco", 1]]), categories: [{ category: "Rent", amount: "900", purchaseCount: 1 }], ...over } })] });
  it("passes a left-out summary that matches what was asked to leave out", () => {
    expect(validateAskVaultSnapshot(left({}), leaving).periods[0].leftOut.purchaseCount).toBe(1);
  });
  it("refuses a left-out summary when nothing was left out, or one that names things that were not excluded", () => {
    expectInvalid(left({}));
    expectInvalid(left({ categories: [{ category: "Groceries", amount: "9", purchaseCount: 1 }] }), leaving);
    expectInvalid(left({ vendors: names([["A", 1], ["B", 5]]) }), leaving);
    expectInvalid(left({ total: "-1" }), leaving);
    expectInvalid(left({ total: "0", purchaseCount: 1 }), leaving);
  });
  it("accepts an empty left-out summary when the exclusions matched nothing", () => {
    const empty = reply({ periods: [period({ leftOut: { total: "0", purchaseCount: 0, vendors: [], categories: [] } })] });
    expect(validateAskVaultSnapshot(empty, leaving).periods[0].leftOut.total).toBe("0");
  });
});

describe("a reply that does not match the request is refused", () => {
  it("wrong kind, version, or basis", () => {
    expectInvalid(reply({ kind: "rank-categories" }));
    expectInvalid(reply({ contractVersion: 2 }));
    expectInvalid(reply({ spendingBasis: "net" }));
    expectInvalid(reply({ thresholdBasis: "selected-allocation" }));
  });
  it("different period dates or number of periods", () => {
    expectInvalid(reply({ periods: [period({ from: "2026-07-01" })] }));
    expectInvalid(reply({ periods: [period(), period()] }));
  });
  it("a day count that does not match the dates, or endsToday that disagrees with asOf", () => {
    expectInvalid(reply({ periods: [period({ dayCount: 30 })] }));
    expectInvalid(reply({ periods: [period({ endsToday: true })] }));
  });
  it("money that is not an exact non-negative decimal string", () => {
    for (const total of ["-5", "1e3", 12, "", "1,200", null]) expectInvalid(reply({ periods: [period({ total })] }));
  });
  it("counts that are negative or fractional", () => {
    expectInvalid(reply({ periods: [period({ purchaseCount: -1 })] }));
    expectInvalid(reply({ periods: [period({ categoryCount: 1.5 })] }));
  });
  it("history coverage other than unknown (the contract makes no completeness claim)", () => {
    expectInvalid(reply({ periods: [period({ historyCoverage: "complete" })] }));
  });
  it("rows for the wrong kind, or more rows than the limit", () => {
    expectInvalid(reply({ periods: [period({ categories: [category("Rent", "1")] })] }));
    const request = { ...base, kind: "rank-categories" as const, limit: 1 };
    expectInvalid(reply({ kind: "rank-categories", periods: [period({ categories: [category("A", "2"), category("B", "1")] })] }), request);
  });
  it("rows that are not in descending order of amount", () => {
    const request = { ...base, kind: "rank-categories" as const, limit: 3 };
    expectInvalid(reply({ kind: "rank-categories", periods: [period({ categories: [category("A", "1"), category("B", "2")] })] }), request);
  });
  it("a comparison difference that is not first minus second, or is missing", () => {
    const request = { ...base, kind: "compare" as const, periods: [base.periods[0], base.periods[0]] };
    const two = [period({ total: "10.10" }), period({ total: "0.30" })];
    expectInvalid(reply({ kind: "compare", periods: two, difference: "9.9" }), request);
    expectInvalid(reply({ kind: "compare", periods: two, difference: null }), request);
    expect(validateAskVaultSnapshot(reply({ kind: "compare", periods: two, difference: "9.8" }), request).difference).toBe("9.8");
  });
  it("a difference on something that is not a comparison", () => {
    expectInvalid(reply({ difference: "0" }));
  });
  it("missing fields and non-objects", () => {
    expectInvalid(null);
    expectInvalid("done");
    expectInvalid({ ...reply(), context: undefined });
    expectInvalid({ ...reply(), revision: { local: 1 } });
  });
});
