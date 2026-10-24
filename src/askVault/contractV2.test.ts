import { describe, expect, it } from "vitest";
import { validateAskVaultSnapshot } from "./contract";
import { monthCoverage } from "./contractV2";
import type { AskVaultRequestV2 } from "./types";

// A small household written out by hand, not taken from any other source: groceries only, today is 10 July 2026.
// Everyday records from 5 January to 3 June, Card from 12 February to 10 June, nothing at all in March.
// Month totals: Jan 100.00, Feb 150.00, Mar 0.00, Apr 110.00, May 135.00, Jun 95.00; 9 purchases, 590.00 in all.
const request: AskVaultRequestV2 = {
  contractVersion: 2,
  kind: "total",
  periods: [{ from: "2026-01-01", to: "2026-06-30" }],
  accountIds: [],
  categories: ["Groceries"],
  members: { ids: [], unassigned: false },
  minimumPurchase: null,
  vendors: [],
  excludeVendors: [],
  excludeCategories: [],
  limit: 1,
  groupBy: "month",
  average: "per-month",
  alignment: "as-requested",
  expectedRevision: null,
};

const row = (month: string, to: string, coverage: string, recordCount: number, total: string, purchaseCount: number) => ({
  month,
  from: `${month}-01`,
  to,
  dayCount: Number(to.slice(8)),
  coverage,
  recordCount,
  total,
  purchaseCount,
});

function goodReply(): any {
  return {
    contractVersion: 2,
    context: { generation: 1, sessionRevision: 1 },
    revision: { local: 1, external: 1 },
    asOf: "2026-07-10",
    earliestRecord: "2026-01-05",
    kind: "total",
    spendingBasis: "gross-negative-allocations",
    thresholdBasis: "absolute-parent-amount",
    difference: null,
    comparison: null,
    periods: [
      {
        from: "2026-01-01",
        to: "2026-06-30",
        dayCount: 181,
        endsToday: false,
        historyCoverage: "unknown",
        total: "590.00",
        purchaseCount: 9,
        categoryCount: 1,
        categories: [],
        purchases: [],
        vendors: [],
        vendorNameCount: 0,
        vendorTotals: [],
        leftOut: { total: "0.00", purchaseCount: 0, vendors: [], categories: [] },
        categoryTotals: [],
        sharedPurchaseCount: 0,
        memberTotals: [],
        recordedFrom: "2026-02-12",
        recordedThrough: "2026-06-03",
        months: [
          row("2026-01", "2026-01-31", "before-records", 1, "100.00", 1),
          row("2026-02", "2026-02-28", "partly-recorded", 2, "150.00", 2),
          row("2026-03", "2026-03-31", "no-records", 0, "0.00", 0),
          row("2026-04", "2026-04-30", "complete", 2, "110.00", 2),
          row("2026-05", "2026-05-31", "complete", 2, "135.00", 2),
          row("2026-06", "2026-06-30", "records-end", 3, "95.00", 2),
        ],
        average: {
          basis: "per-month",
          numerator: "245.00",
          denominator: 2,
          value: "122.50",
          unavailable: null,
          monthsUsed: ["2026-04", "2026-05"],
          monthsLeftOut: [
            { month: "2026-01", why: "before-records" },
            { month: "2026-02", why: "partly-recorded" },
            { month: "2026-03", why: "no-records" },
            { month: "2026-06", why: "records-end" },
          ],
        },
      },
    ],
  };
}

const refused = (mutate: (reply: any) => void) => {
  const reply = goodReply();
  mutate(reply);
  expect(() => validateAskVaultSnapshot(reply, request)).toThrow();
};

describe("a version 2 reply with months and an average", () => {
  it("is accepted when every number can be reproduced from the reply itself", () => {
    expect(validateAskVaultSnapshot(goodReply(), request).periods[0].average?.value).toBe("122.50");
  });
  it("never counts a month with nothing recorded as a month of zero spending", () => {
    refused((r) => {
      r.periods[0].months[2].coverage = "complete";
      r.periods[0].average = { ...r.periods[0].average, denominator: 3, monthsUsed: ["2026-03", "2026-04", "2026-05"], monthsLeftOut: r.periods[0].average.monthsLeftOut.filter((m: any) => m.month !== "2026-03"), value: "81.67" };
    });
  });
  it("refuses a month marked complete when records stop before it ends", () => {
    refused((r) => (r.periods[0].months[5].coverage = "complete"));
  });
  it("refuses a month marked complete before every account was recording", () => {
    refused((r) => (r.periods[0].months[1].coverage = "complete"));
  });
  it("refuses evidence dates that no longer explain the labels", () => {
    refused((r) => (r.periods[0].recordedFrom = "2026-01-05"));
    refused((r) => (r.periods[0].recordedThrough = "2026-07-05"));
  });
  it("refuses more purchases in a month than records", () => {
    refused((r) => (r.periods[0].months[1].recordCount = 1));
  });
  it("refuses an average that is a cent off, or whose reasons were changed", () => {
    refused((r) => (r.periods[0].average.value = "122.51"));
    refused((r) => (r.periods[0].average.monthsLeftOut[2].why = "partial-period"));
  });
  it("refuses evidence dates when there are no months", () => {
    refused((r) => {
      r.periods[0].months = [];
      r.periods[0].average = null;
    });
  });
  it("accepts no evidence at all when no account holds a match, and calls every month unrecorded", () => {
    const reply = goodReply();
    const p = reply.periods[0];
    p.total = "0.00";
    p.purchaseCount = 0;
    p.recordedFrom = null;
    p.recordedThrough = null;
    p.months = p.months.map((m: any) => ({ ...m, coverage: "no-records", total: "0.00", purchaseCount: 0 }));
    p.average = { basis: "per-month", numerator: "0.00", denominator: 0, value: null, unavailable: "no-complete-months", monthsUsed: [], monthsLeftOut: p.months.map((m: any) => ({ month: m.month, why: "no-records" })) };
    expect(() => validateAskVaultSnapshot(reply, request)).not.toThrow();
  });
});

describe("evidence dates that cross", () => {
  it("accepts a reply whose matching accounts never recorded at the same time, and still refuses a date after today", () => {
    const reply = goodReply();
    const p = reply.periods[0];
    p.recordedFrom = "2026-05-18";
    p.recordedThrough = "2026-01-05";
    p.months = p.months.map((m: any, i: number) => ({ ...m, coverage: i < 4 ? "before-records" : i === 4 ? "partly-recorded" : "records-end" }));
    p.average = { basis: "per-month", numerator: "0.00", denominator: 0, value: null, unavailable: "no-complete-months", monthsUsed: [], monthsLeftOut: p.months.map((m: any) => ({ month: m.month, why: m.coverage })) };
    expect(() => validateAskVaultSnapshot(reply, request)).not.toThrow();
    p.recordedFrom = "2026-07-11";
    expect(() => validateAskVaultSnapshot(reply, request)).toThrow();
  });
});

describe("the labels of a month", () => {
  const base = { start: "2026-04-01", end: "2026-04-30", from: "2026-04-01", to: "2026-04-30", recordCount: 3, recordedFrom: "2026-01-05", recordedThrough: "2026-06-10", asOf: "2026-07-10" };
  it("is complete only with evidence on both sides", () => {
    expect(monthCoverage(base)).toBe("complete");
  });
  it("decides in the documented order", () => {
    expect(monthCoverage({ ...base, recordedFrom: "2026-05-01" })).toBe("before-records");
    expect(monthCoverage({ ...base, recordedFrom: "2026-04-10" })).toBe("partly-recorded");
    expect(monthCoverage({ ...base, asOf: "2026-04-20" })).toBe("in-progress");
    expect(monthCoverage({ ...base, recordCount: 0 })).toBe("no-records");
    expect(monthCoverage({ ...base, recordedThrough: "2026-04-30" })).toBe("records-end");
    expect(monthCoverage({ ...base, to: "2026-04-20" })).toBe("partial-period");
    expect(monthCoverage({ ...base, recordedFrom: null, recordedThrough: null })).toBe("no-records");
  });
});

describe("version pairing and the family roster", () => {
  it("refuses a version 1 reply to a version 2 request, and the reverse", () => {
    const { contractVersion: _ignored, ...asVersion1 } = request;
    expect(() => validateAskVaultSnapshot({ ...goodReply(), contractVersion: 1 }, request)).toThrow();
    expect(() => validateAskVaultSnapshot(goodReply(), asVersion1 as never)).toThrow();
  });
  it("refuses a by-member answer that leaves out a person the Dashboard knows", () => {
    const byMember: AskVaultRequestV2 = { ...request, categories: [], groupBy: "member", average: "none" };
    const reply = goodReply();
    const p = reply.periods[0];
    p.categoryTotals = [];
    p.months = [];
    p.average = null;
    p.recordedFrom = null;
    p.recordedThrough = null;
    p.total = "50.00";
    p.purchaseCount = 2;
    p.memberTotals = [
      { memberId: 1, name: "Sam", total: "50.00", purchaseCount: 2 },
      { memberId: null, name: null, total: "0.00", purchaseCount: 0 },
    ];
    const roster = [{ id: 1, name: "Sam" }, { id: 2, name: "Robin" }];
    expect(() => validateAskVaultSnapshot(reply, byMember, { familyMembers: [{ id: 1, name: "Sam" }] })).not.toThrow();
    expect(() => validateAskVaultSnapshot(reply, byMember, { familyMembers: roster })).toThrow();
  });
});
