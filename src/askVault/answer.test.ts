import { describe, expect, it } from "vitest";
import { renderAnswer } from "./answer";
import type { AskVaultSnapshot } from "./contract";
import type { AskPeriodResultV2, AskVaultSnapshotV2 } from "./contractV2";
import type { Interpretation, ResolvedPeriod } from "./types";

const aug: ResolvedPeriod = { from: "2026-08-01", to: "2026-08-31", label: "August 2026", soFar: false };
const sep: ResolvedPeriod = { from: "2026-09-01", to: "2026-09-06", label: "September 2026 so far", soFar: true };
const interp = (over: Partial<Interpretation> = {}): Interpretation => ({
  kind: "total", category: "Groceries", accountName: null, vendors: [], excludedVendors: [], excludedCategories: [], periods: [aug], minimumPurchase: null, limit: null, ...over,
});
const period = (over: Record<string, unknown> = {}) => ({
  from: "2026-08-01", to: "2026-08-31", dayCount: 31, endsToday: false, historyCoverage: "unknown" as const,
  total: "1234.5", purchaseCount: 3, categoryCount: 1, categories: [], purchases: [], vendors: [], vendorNameCount: 0, vendorTotals: [], leftOut: { total: "0", purchaseCount: 0, vendors: [], categories: [] }, ...over,
});
const snap = (over: Partial<AskVaultSnapshot> = {}): AskVaultSnapshot => ({
  contractVersion: 1, context: { generation: 1, sessionRevision: 1 }, revision: { local: 1, external: 1 }, asOf: "2026-09-06",
  kind: "total", spendingBasis: "gross-negative-allocations", thresholdBasis: "absolute-parent-amount",
  periods: [period()], difference: null, ...over,
});

const m2Period = (over: Partial<AskPeriodResultV2> = {}): AskPeriodResultV2 => ({
  ...period(), categoryTotals: [], sharedPurchaseCount: 0, memberTotals: [], months: [], recordedFrom: null, recordedThrough: null, average: null, ...over,
});
const m2Snap = (p = m2Period(), over: Partial<AskVaultSnapshotV2> = {}): AskVaultSnapshotV2 => ({
  ...snap(), contractVersion: 2, earliestRecord: "2026-01-01", periods: [p], comparison: null, ...over,
});

describe("M2 answers", () => {
  it("names every selected category and member, including on rankings", () => {
    const i = interp({ categories: ["Groceries", "Shopping"], members: ["Sam", "Robin"] });
    expect(renderAnswer(i, m2Snap()).headline).toContain("on Groceries and Shopping for Sam and Robin");
    expect(renderAnswer({ ...i, kind: "rank-purchases", limit: 1 }, m2Snap(m2Period({ purchases: [{ transactionId: 1, accountId: 1, date: "2026-08-01", description: "Store", amount: "50", parentAmount: "50" }] }), { kind: "rank-purchases" })).headline).toContain("for Sam and Robin");
  });
  it("keeps zero-spend members and unassigned purchases in a labeled breakdown", () => {
    const a = renderAnswer(interp({ category: null, groupBy: "member" }), m2Snap(m2Period({ memberTotals: [
      {memberId:1,name:"Sam",total:"1234.5",purchaseCount:3}, {memberId:2,name:"Robin",total:"0",purchaseCount:0}, {memberId:null,name:null,total:"0",purchaseCount:0},
    ] })));
    expect(a.rowsLabel).toBe("Spending by family member");
    expect(a.rows.map(r => [r.label,r.amount])).toEqual([["Sam","$1,234.50"],["Robin","$0.00"],["Not assigned to anyone","$0.00"]]);
    expect(a.notes.join(" ")).toContain("recorded against each person");
  });
  it("lists all selected categories and explains overlapping split counts", () => {
    const a = renderAnswer(interp({ categories: ["Groceries","Shopping"] }), m2Snap(m2Period({ categoryTotals:[{category:"Groceries",total:"1000",purchaseCount:3},{category:"Shopping",total:"234.5",purchaseCount:1}], sharedPurchaseCount:1 })));
    expect(a.rowsLabel).toBe("Spending by category");
    expect(a.rows).toHaveLength(2);
    expect(a.notes.join(" ")).toContain("split purchase can appear in more than one category");
    expect(a.detail).toContain("3 purchases");
  });
  const months: AskPeriodResultV2["months"] = [
    {month:"2026-07",from:"2026-07-01",to:"2026-07-31",dayCount:31,coverage:"complete",recordCount:2,total:"100",purchaseCount:2},
    {month:"2026-08",from:"2026-08-01",to:"2026-08-31",dayCount:31,coverage:"no-records",recordCount:0,total:"0",purchaseCount:0},
  ];
  it("shows missing records as unknown spending beside the recorded zero", () => {
    const a = renderAnswer(interp({ groupBy:"month" }), m2Snap(m2Period({months})));
    expect(a.rowsLabel).toBe("Spending by month");
    expect(a.rows[1]).toMatchObject({label:"August 2026",amount:"$0.00"});
    expect(a.rows[1].detail).toContain("spending unknown");
    expect(a.warnings?.join(" ")).toContain("missing import");
  });
  it.each([
    ["complete", "Records support a full month"], ["in-progress", "Month still in progress"],
    ["partial-period", "Only part of this month"], ["partly-recorded", "Recording started partway"],
    ["before-records", "spending unknown"], ["no-records", "spending unknown"], ["records-end", "spending may be incomplete"],
  ] as const)("explains %s month coverage without claiming certified import history", (coverage, expected) => {
    const a=renderAnswer(interp({groupBy:"month"}),m2Snap(m2Period({months:[{...months[0],coverage}]})));
    expect(a.rows[0].detail).toContain(expected);
  });
  it("uses the average numerator rather than the whole-range total and explains omitted months", () => {
    const a = renderAnswer(interp({average:"per-month"}), m2Snap(m2Period({total:"500",months,average:{basis:"per-month",numerator:"100",denominator:1,value:"100.00",unavailable:null,monthsUsed:["2026-07"],monthsLeftOut:[{month:"2026-08",why:"no-records"}]}})));
    expect(a.headline).toContain("averaged $100.00 per month");
    expect(a.detail).toContain("$100.00 ÷ 1 month");
    expect(a.notes.join(" ")).toContain("Total recorded across the whole range: $500.00");
    expect(a.notes.join(" ")).toContain("Used: July 2026");
    expect(a.rows[1].detail).toContain("Left out of average");
  });
  it("never presents an unavailable monthly average as zero", () => {
    const a=renderAnswer(interp({average:"per-month"}),m2Snap(m2Period({months,average:{basis:"per-month",numerator:"0",denominator:0,value:null,unavailable:"no-complete-months",monthsUsed:[],monthsLeftOut:[{month:"2026-07",why:"records-end"},{month:"2026-08",why:"no-records"}]}})));
    expect(a.headline).toContain("No monthly average available");
    expect(a.headline).not.toContain("$0.00");
    expect(a.detail).toContain("$1,234.50 recorded");
  });
  it("shows a per-purchase average and its exact basis; no purchases gives no average", () => {
    const p=m2Period({average:{basis:"per-purchase",numerator:"450.50",denominator:4,value:"112.63",unavailable:null,monthsUsed:[],monthsLeftOut:[]}});
    const a=renderAnswer(interp({average:"per-purchase",members:["Sam"]}),m2Snap(p));
    expect(a.headline).toContain("averaged $112.63 per purchase");
    expect(a.headline).toContain("for Sam");
    expect(a.detail).toContain("$450.50 ÷ 4 purchases");
    expect(renderAnswer(interp({average:"per-purchase"}),m2Snap(m2Period({total:"0",purchaseCount:0,average:{...p.average!,numerator:"0",denominator:0,value:null,unavailable:"no-purchases"}}))).headline).toContain("No purchases to average");
  });
  const compared = (over: Partial<NonNullable<AskVaultSnapshotV2["comparison"]>> = {}) => m2Snap(m2Period({total:"150",dayCount:31}), {kind:"compare",periods:[m2Period({total:"150",dayCount:31}),m2Period({total:"100",dayCount:31})],difference:"50",comparison:{alignment:"as-requested",comparable:true,notComparableReason:null,elapsedDays:31,clamped:null,absoluteChange:"50",percentChange:"50.0",percentOutcome:"changed",...over}});
  const comparisonI=interp({kind:"compare",periods:[aug,{...aug,label:"July 2026"}]});
  it("shows validated percent change with both real ranges", () => {
    const a=renderAnswer(comparisonI,compared());
    expect(a.detail).toContain("50.0% more");
    expect(a.rowsLabel).toBe("Compared periods");
    expect(a.rows[0].detail).toContain("31 days");
  });
  it("shows dollars only for clamped unequal periods, with a visible warning", () => {
    const a=renderAnswer(comparisonI,compared({comparable:false,notComparableReason:"clamped",clamped:{requestedDays:31,usedDays:28},percentChange:null,percentOutcome:"not-comparable"}));
    expect([a.headline,a.detail,...a.notes].join(" ")).not.toContain("%");
    expect(a.warnings?.join(" ")).toContain("shortened");
    expect(a.warnings?.join(" ")).toContain("not a like-for-like comparison");
  });
  it("explains a zero baseline without an infinite percentage", () => {
    const a=renderAnswer(comparisonI,compared({percentChange:null,percentOutcome:"from-zero"}));
    expect(a.detail).toContain("up from nothing");
    expect(a.detail).not.toContain("%");
  });
  it("shows negative changes as less and both zero as no change", () => {
    const lower=compared({absoluteChange:"-50",percentChange:"-50.0"});
    lower.difference="-50";
    lower.periods[0].total="50";
    expect(renderAnswer(comparisonI,lower).detail).toContain("50.0% less");
    const zero=compared({absoluteChange:"0",percentChange:"0.0",percentOutcome:"no-change"});
    zero.difference="0";zero.periods.forEach(p => {p.total="0";});
    expect(renderAnswer(comparisonI,zero).detail).toContain("No change (0.0%)");
  });
});

describe("a total", () => {
  it("states the exact amount as a positive figure, the scope and the purchase count", () => {
    const a = renderAnswer(interp(), snap());
    expect(a.headline).toBe("You spent $1,234.50 on Groceries in August 2026.");
    expect(a.headline).not.toMatch(/-\$/);
    expect(a.detail).toBe("3 purchases · August 1 to August 31, 2026");
  });
  it("says so plainly when nothing was spent, rather than $0.00", () => {
    const a = renderAnswer(interp(), snap({ periods: [period({ total: "0", purchaseCount: 0, categoryCount: 0 })] }));
    expect(a.headline).toBe("No spending found on Groceries in August 2026.");
  });
  it("names all spending, an account and an amount filter", () => {
    const a = renderAnswer(
      interp({ category: null, accountName: "Rewards Card", minimumPurchase: { amount: "100.01", inclusive: false } }),
      snap(),
    );
    expect(a.headline).toBe("You spent $1,234.50 on everything from Rewards Card in August 2026.");
    expect(a.notes).toContain("Only purchases over $100.01 are included. The whole purchase is tested, even when it is split across categories.");
  });
  it("says 'at least' for an inclusive threshold", () => {
    const a = renderAnswer(interp({ minimumPurchase: { amount: "1000.00", inclusive: true } }), snap());
    expect(a.notes.join(" ")).toContain("Only purchases of at least $1,000.00 are included.");
  });
  it("marks a period still under way and uses a singular purchase", () => {
    const a = renderAnswer(interp({ periods: [sep] }), snap({ periods: [period({ from: "2026-09-01", to: "2026-09-06", dayCount: 6, endsToday: true, purchaseCount: 1 })] }));
    expect(a.headline).toBe("You spent $1,234.50 on Groceries in September 2026 so far.");
    expect(a.detail).toBe("1 purchase · September 1 to September 6, 2026");
  });
  it("always says what is not counted", () => {
    expect(renderAnswer(interp(), snap()).notes).toContain("Refunds and transfers between your accounts are not counted.");
  });
});

describe("ranked categories", () => {
  const ranked = (rows: { category: string | null; amount: string; purchaseCount: number }[]) =>
    snap({ kind: "rank-categories", periods: [period({ categoryCount: 5, categories: rows })] });
  it("lists rows in order with exact amounts, and shows no category plainly", () => {
    const a = renderAnswer(interp({ kind: "rank-categories", category: null, limit: 3 }), ranked([
      { category: "Rent", amount: "1500", purchaseCount: 1 },
      { category: null, amount: "20.5", purchaseCount: 2 },
    ]));
    expect(a.headline).toBe("Your top 3 spending categories in August 2026");
    expect(a.rows).toEqual([
      { label: "Rent", amount: "$1,500.00", detail: "1 purchase" },
      { label: "No category", amount: "$20.50", detail: "2 purchases" },
    ]);
  });
  it("says how many categories there were when the list is shorter than the total", () => {
    const a = renderAnswer(interp({ kind: "rank-categories", category: null, limit: 1 }), ranked([{ category: "Rent", amount: "1500", purchaseCount: 1 }]));
    expect(a.headline).toBe("Your biggest spending category in August 2026");
    expect(a.detail).toContain("1 of 5 categories");
  });
  it("handles an empty period", () => {
    const a = renderAnswer(interp({ kind: "rank-categories", category: null, limit: 3 }), snap({ kind: "rank-categories", periods: [period({ total: "0", purchaseCount: 0, categoryCount: 0 })] }));
    expect(a.headline).toBe("No spending found in August 2026.");
    expect(a.rows).toEqual([]);
  });
});

describe("ranked purchases", () => {
  it("shows description, date and amount, and notes a split purchase", () => {
    const a = renderAnswer(interp({ kind: "rank-purchases", category: null, limit: 2 }), snap({
      kind: "rank-purchases",
      periods: [period({ purchaseCount: 9, purchases: [
        { transactionId: 4, accountId: 1, date: "2026-08-10", description: "Big Screen TV", amount: "899", parentAmount: "899" },
        { transactionId: 7, accountId: 1, date: "2026-08-02", description: "Costco", amount: "120.25", parentAmount: "300" },
      ] })],
    }));
    expect(a.headline).toBe("Your 2 biggest purchases in August 2026");
    expect(a.rows).toEqual([
      { label: "Big Screen TV", amount: "$899.00", detail: "August 10, 2026" },
      { label: "Costco", amount: "$120.25", detail: "August 2, 2026 · part of a $300.00 purchase" },
    ]);
  });
  it("a single biggest purchase", () => {
    const a = renderAnswer(interp({ kind: "rank-purchases", category: null, limit: 1 }), snap({ kind: "rank-purchases", periods: [period({ purchases: [{ transactionId: 1, accountId: 1, date: "2026-08-10", description: "Rent", amount: "1504", parentAmount: "1504" }] })] }));
    expect(a.headline).toBe("Your biggest purchase in August 2026");
  });
});

describe("a comparison", () => {
  const compare = (a: string, b: string, difference: string, first = period(), second = period()) =>
    snap({ kind: "compare", periods: [{ ...first, total: a }, { ...second, total: b }], difference });
  it("states both totals and the dollar difference, first minus second", () => {
    const r = renderAnswer(interp({ kind: "compare", periods: [aug, { ...aug, label: "July 2026" }] }), compare("100", "40.5", "59.5"));
    expect(r.headline).toBe("You spent $100.00 on Groceries in August 2026 and $40.50 in July 2026.");
    expect(r.detail).toBe("That is $59.50 more in August 2026.");
  });
  it("less, and the same", () => {
    const i = interp({ kind: "compare", periods: [aug, { ...aug, label: "July 2026" }] });
    expect(renderAnswer(i, compare("10", "40.5", "-30.5")).detail).toBe("That is $30.50 less in August 2026.");
    expect(renderAnswer(i, compare("10", "10.00", "0")).detail).toBe("That is the same amount in both.");
  });
  it("discloses unequal lengths and never gives a percentage or an extrapolation", () => {
    const r = renderAnswer(
      interp({ kind: "compare", periods: [sep, aug] }),
      compare("100", "400", "-300", period({ dayCount: 6, endsToday: true, from: "2026-09-01", to: "2026-09-06" }), period()),
    );
    expect(r.notes).toContain("September 2026 so far covers 6 days and August 2026 covers 31 days, so this is not a like-for-like comparison.");
    expect([r.headline, r.detail, ...r.notes].join(" ")).not.toMatch(/%|percent|per day|projected|on pace/i);
  });
  it("says nothing about lengths when they match", () => {
    const i = interp({ kind: "compare", periods: [aug, { ...aug, label: "July 2026" }] });
    expect(renderAnswer(i, compare("1", "2", "-1")).notes.join(" ")).not.toContain("like-for-like");
  });
});

describe("history that starts part-way through the period", () => {
  it("says when the records start, and says nothing when the period is fully covered", () => {
    const year: ResolvedPeriod = { from: "2025-01-01", to: "2025-12-31", label: "2025", soFar: false };
    const partial = renderAnswer(interp({ periods: [year], earliestRecord: "2025-09-01" }), snap({ periods: [period({ from: "2025-01-01", to: "2025-12-31", dayCount: 365 })] }));
    expect(partial.notes).toContain("Your records start on September 1, 2025, so the earlier part of this period has no data.");
    const covered = renderAnswer(interp({ earliestRecord: "2025-09-01" }), snap());
    expect(covered.notes.join(" ")).not.toContain("Your records start");
  });
});

describe("a store or payee", () => {
  const sams = (over: Partial<Interpretation> = {}) => interp({ category: null, vendors: ["Sam's Club"], ...over });
  const vendorPeriod = (over: Record<string, unknown> = {}) =>
    period({ total: "412.9", purchaseCount: 6, vendorNameCount: 2, vendorTotals: [{ term: "sams club", total: "412.9", purchaseCount: 6 }], vendors: [{ description: "SAMS CLUB #6482", purchaseCount: 5 }, { description: "SAMSCLUB.COM", purchaseCount: 1 }], ...over });
  it("names the store in the headline and lists the names that were matched", () => {
    const a = renderAnswer(sams(), snap({ periods: [vendorPeriod()] }));
    expect(a.headline).toBe("You spent $412.90 at Sam's Club in August 2026.");
    expect(a.matches).toEqual(["SAMS CLUB #6482 (5 purchases)", "SAMSCLUB.COM (1 purchase)"]);
  });
  it("says 'since your records begin' when no period was named", () => {
    const all: ResolvedPeriod = { from: "2025-09-01", to: "2026-09-06", label: "all your records", soFar: false, allRecords: true };
    const a = renderAnswer(sams({ periods: [all] }), snap({ periods: [vendorPeriod({ from: "2025-09-01", to: "2026-09-06", dayCount: 371, endsToday: true })] }));
    expect(a.headline).toBe("You spent $412.90 at Sam's Club since your records begin.");
    expect(a.detail).toBe("6 purchases · September 1, 2025 to September 6, 2026");
  });
  it("combines a store with a category and an account", () => {
    const a = renderAnswer(sams({ category: "Groceries", accountName: "Rewards Card" }), snap({ periods: [vendorPeriod()] }));
    expect(a.headline).toBe("You spent $412.90 at Sam's Club on Groceries from Rewards Card in August 2026.");
  });
  it("says so plainly when the store has no spending in the period", () => {
    const a = renderAnswer(sams(), snap({ periods: [vendorPeriod({ total: "0", purchaseCount: 0, vendorNameCount: 0, vendors: [] })] }));
    expect(a.headline).toBe("No spending found at Sam's Club in August 2026.");
    expect(a.matches).toEqual([]);
  });
  it("says how many more names were matched than shown", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ description: `STORE ${i}`, purchaseCount: 2 }));
    const a = renderAnswer(sams(), snap({ periods: [vendorPeriod({ purchaseCount: 40, vendorNameCount: 14, vendors: many })] }));
    expect(a.matches).toHaveLength(11);
    expect(a.matches[10]).toBe("and 4 more names");
  });
  it("a comparison and a ranking keep the store in view", () => {
    const first: ResolvedPeriod = aug;
    const second: ResolvedPeriod = { ...aug, label: "July 2026" };
    const c = renderAnswer(sams({ kind: "compare", periods: [first, second] }), snap({ kind: "compare", periods: [vendorPeriod(), vendorPeriod({ total: "100" })], difference: "312.9" }));
    expect(c.headline).toBe("You spent $412.90 at Sam's Club in August 2026 and $100.00 in July 2026.");
    const r = renderAnswer(sams({ kind: "rank-purchases", limit: 2 }), snap({ kind: "rank-purchases", periods: [vendorPeriod({ purchases: [{ transactionId: 1, accountId: 1, date: "2026-08-02", description: "SAMS CLUB #6482", amount: "200", parentAmount: "200" }] })] }));
    expect(r.headline).toBe("Your 2 biggest purchases at Sam's Club in August 2026");
  });
});

describe("several stores and exclusions in the answer", () => {
  const trio = interp({ category: null, vendors: ["Meijer", "Sam's Club", "Target"] });
  const trioPeriod = period({
    total: "180.5", purchaseCount: 4, vendorNameCount: 3,
    vendors: [{ description: "MEIJER #204", purchaseCount: 2 }, { description: "SAMS CLUB #6482", purchaseCount: 1 }, { description: "Target T-1", purchaseCount: 1 }],
    vendorTotals: [{ term: "meijer", total: "50.5", purchaseCount: 2 }, { term: "sams club", total: "100", purchaseCount: 1 }, { term: "target", total: "30", purchaseCount: 1 }],
  });
  it("names the stores in the headline and gives each one its own line", () => {
    const a = renderAnswer(trio, snap({ periods: [trioPeriod] }));
    expect(a.headline).toBe("You spent $180.50 at Meijer, Sam's Club and Target in August 2026.");
    expect(a.rows).toEqual([
      { label: "Meijer", amount: "$50.50", detail: "2 purchases" },
      { label: "Sam's Club", amount: "$100.00", detail: "1 purchase" },
      { label: "Target", amount: "$30.00", detail: "1 purchase" },
    ]);
    expect(a.matches).toHaveLength(3);
  });
  it("a store with no spending still has its line", () => {
    const a = renderAnswer(
      interp({ category: null, vendors: ["Meijer", "Walmart"] }),
      snap({ periods: [period({ total: "50", purchaseCount: 1, vendorNameCount: 1, vendors: [{ description: "MEIJER", purchaseCount: 1 }], vendorTotals: [{ term: "meijer", total: "50", purchaseCount: 1 }, { term: "walmart", total: "0", purchaseCount: 0 }] })] }),
    );
    expect(a.headline).toBe("You spent $50.00 at Meijer and Walmart in August 2026.");
    expect(a.rows[1]).toEqual({ label: "Walmart", amount: "$0.00", detail: "no purchases" });
  });
  const leaving = (over: Record<string, unknown> = {}) =>
    period({ total: "150", purchaseCount: 2, leftOut: { total: "970", purchaseCount: 2, vendors: [{ description: "Costco", purchaseCount: 1 }], categories: [{ category: "Rent", amount: "900", purchaseCount: 1 }] }, ...over });
  it("says what was left out in the headline and in a note with the amounts", () => {
    const a = renderAnswer(interp({ category: "Groceries", excludedVendors: ["Costco"], excludedCategories: ["Rent"] }), snap({ periods: [leaving()] }));
    expect(a.headline).toBe("You spent $150.00 on Groceries, excluding Costco and Rent, in August 2026.");
    expect(a.notes).toContain("Left out as you asked: Costco (1 purchase), Rent ($900.00). That was $970.00 across 2 purchases.");
  });
  it("says so when nothing matched what was to be left out", () => {
    const a = renderAnswer(interp({ category: null, excludedVendors: ["Costco"] }), snap({ periods: [leaving({ leftOut: { total: "0", purchaseCount: 0, vendors: [], categories: [] } })] }));
    expect(a.headline).toBe("You spent $150.00 on everything, excluding Costco, in August 2026.");
    expect(a.notes).toContain("Nothing matched what you asked to leave out (Costco).");
  });
  it("nothing found still says what was left out", () => {
    const a = renderAnswer(interp({ category: "Groceries", excludedVendors: ["Costco"] }), snap({ periods: [leaving({ total: "0", purchaseCount: 0 })] }));
    expect(a.headline).toBe("No spending found on Groceries, excluding Costco, in August 2026.");
  });
  it("rankings keep the exclusion in view", () => {
    const a = renderAnswer(interp({ kind: "rank-categories", category: null, limit: 3, excludedCategories: ["Rent"] }), snap({ kind: "rank-categories", periods: [leaving({ categoryCount: 2, categories: [{ category: "Groceries", amount: "150", purchaseCount: 2 }] })] }));
    expect(a.headline).toBe("Your top 3 spending categories, excluding Rent, in August 2026");
  });
});

describe("how a period reads in a sentence", () => {
  const withLabel = (label: string, over: Partial<ResolvedPeriod> = {}): ResolvedPeriod => ({ from: "2026-08-30", to: "2026-09-05", label, soFar: false, ...over });
  const say = (label: string, over: Partial<ResolvedPeriod> = {}) =>
    renderAnswer(interp({ periods: [withLabel(label, over)] }), snap({ periods: [period({ from: "2026-08-30", to: "2026-09-05" })] })).headline;
  it("a month or year reads 'in', a range reads 'from', one day reads 'on'", () => {
    expect(say("August 2026")).toBe("You spent $1,234.50 on Groceries in August 2026.");
    expect(say("August 30 to September 5, 2026")).toBe("You spent $1,234.50 on Groceries from August 30 to September 5, 2026.");
    expect(say("July 8, 2026")).toBe("You spent $1,234.50 on Groceries on July 8, 2026.");
  });
  it("today, yesterday and 'since' stand on their own", () => {
    expect(say("today")).toBe("You spent $1,234.50 on Groceries today.");
    expect(say("yesterday")).toBe("You spent $1,234.50 on Groceries yesterday.");
    expect(say("since March 2026")).toBe("You spent $1,234.50 on Groceries since March 2026.");
  });
  it("rolling periods keep 'in'", () => {
    expect(say("the past 3 months")).toBe("You spent $1,234.50 on Groceries in the past 3 months.");
  });
});
