// Source-attributed test-only copy: M2/oracle/oracle.ts
// Original SHA256: 91692db08905d499db96093f137a40e4131223273a870e962db43b45029d7002
// M6 extension: M1 leave-out rules; no production imports or financial formula changes.
// Independent answer calculator for the M2 contract. It works from the plain fixture rows in integer cents, with BigInt for the
// divisions, and never imports the app. It is the written form of Financial-Rules.md: if the two disagree, fix this file or the rules,
// never the implementation to fit it. anchors.ts holds hand-added totals that this file is itself tested against.
import { addDays, daysIn, iso, parts } from "./referenceCalendar";
import type { AskAverage, AskComparison, AskVaultRequestV2, AskVaultSnapshotV2, CategoryRow, MemberTotal, MonthCoverage, MonthRow, PeriodRange, PeriodResultV2, PurchaseRow } from "./referenceContract";
import type { Tx, World } from "./referenceWorld";

export const dollars = (cents: number | bigint) => {
  const c = BigInt(cents);
  const n = c < 0n ? -c : c;
  return `${c < 0n ? "-" : ""}${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
};
export const dayCount = (r: PeriodRange) => Math.round((Date.parse(r.to + "T00:00:00Z") - Date.parse(r.from + "T00:00:00Z")) / 86_400_000) + 1;

/** Rounded half away from zero: the one rounding rule for averages and percentages. Works on a rational n/d, d > 0. */
export const roundHalfAway = (n: bigint, d: bigint): bigint => {
  const sign = n < 0n ? -1n : 1n;
  return sign * ((2n * (n < 0n ? -n : n) + d) / (2n * d));
};
export const tenths = (t: bigint) => `${t < 0n ? "-" : ""}${(t < 0n ? -t : t) / 10n}.${(t < 0n ? -t : t) % 10n}`;

type Allocation = { tx: Tx; category: string | null; cents: number };

// Store terms follow M1's rule (written again here, independently): lowercase words with apostrophes removed; a description matches a
// term when the term, spaces removed, starts at the beginning of any of its words read together.
const words = (s: string) => s.toLowerCase().replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const vendorMatches = (description: string, term: string) => {
  const want = words(term).join("");
  const ws = words(description);
  return ws.some((_, i) => ws.slice(i).join("").startsWith(want));
};
const creditedTerm = (description: string, terms: string[]) => terms.findIndex((t) => vendorMatches(description, t));
/** Every negative, non-Transfer allocation of a parent, split lines separately; an unsplit parent is one allocation. */
function allocations(tx: Tx): Allocation[] {
  const lines = tx.splits ?? [{ category: tx.category, cents: tx.cents }];
  return lines.filter((l) => l.cents < 0 && l.category !== "Transfer").map((l) => ({ tx, category: l.category, cents: -l.cents }));
}

const memberMatches = (tx: Tx, r: AskVaultRequestV2) => {
  const m = r.members;
  if (!m.ids.length && !m.unassigned) return true;
  return tx.memberId === null ? m.unassigned : m.ids.includes(tx.memberId);
};

/** Allocations that count for one period under the request's filters. */
function beforeExclusions(w: World, r: AskVaultRequestV2, p: PeriodRange): Allocation[] {
  const min = r.minimumPurchase ? BigInt(Math.round(Number(r.minimumPurchase.amount) * 100)) : null;
  const out: Allocation[] = [];
  for (const tx of w.ledger) {
    if (tx.date < p.from || tx.date > p.to || tx.date > w.today) continue;
    if (r.accountIds.length && !r.accountIds.includes(tx.accountId)) continue;
    if (!memberMatches(tx, r)) continue;
    if (r.vendors.length && creditedTerm(tx.description, r.vendors) < 0) continue;
    if (min !== null) {
      const mag = BigInt(Math.abs(tx.cents));
      if (r.minimumPurchase!.inclusive ? mag < min : mag <= min) continue;
    }
    for (const a of allocations(tx)) {
      if (r.categories.length && !(a.category !== null && r.categories.includes(a.category))) continue;
      out.push(a);
    }
  }
  return out;
}

// M1 Financial-Rules leave-outs, restated over the existing M2 allocations.
const leftByStore = (a: Allocation, r: AskVaultRequestV2) => r.excludeVendors.some(term => vendorMatches(a.tx.description, term));
const leftByCategory = (a: Allocation, r: AskVaultRequestV2) => a.category !== null && r.excludeCategories.includes(a.category);
function eligible(w: World, r: AskVaultRequestV2, p: PeriodRange): Allocation[] {
  return beforeExclusions(w,r,p).filter(a => !leftByStore(a,r) && !leftByCategory(a,r));
}
function leftOut(w: World, r: AskVaultRequestV2, p: PeriodRange) {
  const removed = beforeExclusions(w,r,p).filter(a=>leftByStore(a,r)||leftByCategory(a,r));
  const stores = new Map<string,Set<number>>(), categories = new Map<string,Allocation[]>();
  for (const a of removed) {
    if (leftByStore(a,r)) stores.set(a.tx.description,(stores.get(a.tx.description)??new Set()).add(a.tx.id));
    if (leftByCategory(a,r)) categories.set(a.category!,[...(categories.get(a.category!)??[]),a]);
  }
  return { total:dollars(sum(removed)), purchaseCount:distinct(removed),
    vendors:[...stores].map(([description,ids])=>({description,purchaseCount:ids.size})).sort((a,b)=>b.purchaseCount-a.purchaseCount||a.description.localeCompare(b.description)).slice(0,10),
    categories:[...categories].sort(([a],[b])=>a.localeCompare(b)).map(([category,xs])=>({category,amount:dollars(sum(xs)),purchaseCount:distinct(xs)})) };
}

const sum = (xs: Allocation[]) => xs.reduce((s, a) => s + BigInt(a.cents), 0n);
const distinct = (xs: Allocation[]) => new Set(xs.map((a) => a.tx.id)).size;

export function earliestRecord(w: World): string | null {
  const dates = w.ledger.map((t) => t.date).sort();
  return dates.length ? dates[0] : null;
}

/**
 * What the ledger itself can say about which months were recorded. The evidence accounts are those holding at least one purchase
 * (on or before today, any date) that matches every filter of the question; a first transaction date elsewhere proves nothing.
 * `records` are all records of the accounts the question covers, for the month-by-month "was anything recorded" test.
 */
export function evidence(w: World, r: AskVaultRequestV2) {
  const whole: PeriodRange = { from: "0000-01-01", to: w.today };
  const ids = new Set(eligible(w, r, whole).map((a) => a.tx.accountId));
  const held = w.ledger.filter((t) => ids.has(t.accountId) && t.date <= w.today);
  const firstByAccount = [...ids].map((id) => held.filter((t) => t.accountId === id).map((t) => t.date).sort()[0]);
  const recordedFrom = ids.size ? firstByAccount.sort()[firstByAccount.length - 1] : null;
  const lastByAccount = [...ids].map((id) => held.filter((t) => t.accountId === id).map((t) => t.date).sort().at(-1)!);
  // The shared evidence ends as soon as any matching account stops; another account cannot extend it.
  const recordedThrough = ids.size ? lastByAccount.sort()[0] : null;
  // A month with no records in the covered accounts has no evidence of recording; import history is unavailable. A month in which only
  // some accounts were quiet cannot be told apart from a missed import of just those accounts; that limit is documented.
  const records = w.ledger.filter((t) => (!r.accountIds.length || r.accountIds.includes(t.accountId)) && t.date <= w.today);
  return { records, recordedFrom, recordedThrough };
}

function months(w: World, r: AskVaultRequestV2, p: PeriodRange, allocs: Allocation[]): MonthRow[] {
  const first = parts(p.from), last = parts(p.to);
  const { records, recordedFrom, recordedThrough } = evidence(w, r);
  const rows: MonthRow[] = [];
  for (let y = first.y, m = first.m; y < last.y || (y === last.y && m <= last.m); m === 12 ? (y++, (m = 1)) : m++) {
    const start = iso(y, m, 1), end = iso(y, m, daysIn(y, m));
    const from = start < p.from ? p.from : start, to = end > p.to ? p.to : end;
    const recordCount = records.filter((t) => t.date >= from && t.date <= to).length;
    let coverage: MonthCoverage;
    if (recordedFrom === null || recordedThrough === null) coverage = "no-records";
    else if (end < recordedFrom) coverage = "before-records";
    else if (recordedFrom > start) coverage = "partly-recorded";
    else if (end >= w.today) coverage = "in-progress";
    else if (recordCount === 0) coverage = "no-records";
    else if (recordedThrough <= end) coverage = "records-end";
    else if (from > start || to < end) coverage = "partial-period";
    else coverage = "complete";
    const here = allocs.filter((a) => a.tx.date >= from && a.tx.date <= to);
    rows.push({ month: start.slice(0, 7), from, to, dayCount: dayCount({ from, to }), coverage, recordCount, total: dollars(sum(here)), purchaseCount: distinct(here) });
  }
  return rows;
}

function members(w: World, r: AskVaultRequestV2, allocs: Allocation[]): MemberTotal[] {
  const ids = r.members.ids.length || r.members.unassigned ? r.members.ids : w.members.map((m) => m.id);
  const wantUnassigned = r.members.ids.length || r.members.unassigned ? r.members.unassigned : true;
  const line = (memberId: number | null): MemberTotal => {
    const here = allocs.filter((a) => a.tx.memberId === memberId);
    return { memberId, name: memberId === null ? null : (w.members.find((m) => m.id === memberId)?.name ?? null), total: dollars(sum(here)), purchaseCount: distinct(here) };
  };
  const rows = ids.map(line);
  if (wantUnassigned) rows.push(line(null));
  const cents = (row: MemberTotal) => BigInt(row.total.replace(".", ""));
  return rows.sort((a, b) => (cents(b) > cents(a) ? 1 : cents(b) < cents(a) ? -1 : (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || (a.name ?? "").localeCompare(b.name ?? "")));
}

/** M1's store fields, computed from the same allocations: one line per term asked (first match credited), plus the matched names. */
function vendorBlock(r: AskVaultRequestV2, allocs: Allocation[]) {
  if (!r.vendors.length) return { vendors: [], vendorNameCount: 0, vendorTotals: [] };
  const names = new Map<string, Set<number>>();
  const lines = r.vendors.map(() => [] as Allocation[]);
  for (const a of allocs) {
    lines[creditedTerm(a.tx.description, r.vendors)].push(a);
    names.set(a.tx.description, (names.get(a.tx.description) ?? new Set()).add(a.tx.id));
  }
  const ranked = [...names.entries()].map(([description, ids]) => ({ description, purchaseCount: ids.size })).sort((x, y) => y.purchaseCount - x.purchaseCount || x.description.localeCompare(y.description));
  return {
    vendors: ranked.slice(0, 10),
    vendorNameCount: ranked.length,
    vendorTotals: r.vendors.map((term, i) => ({ term, total: dollars(sum(lines[i])), purchaseCount: distinct(lines[i]) })),
  };
}

function average(kind: "per-purchase" | "per-month", total: bigint, count: number, rows: MonthRow[]): AskAverage {
  if (kind === "per-purchase") {
    return { basis: kind, numerator: dollars(total), denominator: count, value: count ? dollars(roundHalfAway(total, BigInt(count))) : null, unavailable: count ? null : "no-purchases", monthsUsed: [], monthsLeftOut: [] };
  }
  const used = rows.filter((m) => m.coverage === "complete");
  const left = rows.filter((m) => m.coverage !== "complete").map((m) => ({ month: m.month, why: m.coverage as Exclude<MonthCoverage, "complete"> }));
  const numerator = used.reduce((s, m) => s + BigInt(m.total.replace(".", "")), 0n);
  return { basis: kind, numerator: dollars(numerator), denominator: used.length, value: used.length ? dollars(roundHalfAway(numerator, BigInt(used.length))) : null, unavailable: used.length ? null : "no-complete-months", monthsUsed: used.map((m) => m.month), monthsLeftOut: left };
}

/** The earlier range an alignment asks for, or null when `p` has the wrong shape for it (then the request is invalid). */
export function alignedPrior(p: PeriodRange, alignment: AskVaultRequestV2["alignment"]): { range: PeriodRange; clamped: null | { requestedDays: number; usedDays: number } } | null {
  const a = parts(p.from), b = parts(p.to);
  if (alignment === "same-days-previous-month") {
    if (!(a.y === b.y && a.m === b.m && a.d === 1)) return null;
    const prev = a.m === 1 ? { y: a.y - 1, m: 12 } : { y: a.y, m: a.m - 1 };
    const day = Math.min(b.d, daysIn(prev.y, prev.m));
    return { range: { from: iso(prev.y, prev.m, 1), to: iso(prev.y, prev.m, day) }, clamped: day < b.d ? { requestedDays: b.d, usedDays: day } : null };
  }
  if (alignment === "same-days-previous-year") {
    const back = (x: { y: number; m: number; d: number }) => iso(x.y - 1, x.m, Math.min(x.d, daysIn(x.y - 1, x.m)));
    const range = { from: back(a), to: back(b) };
    return { range, clamped: dayCount(range) < dayCount(p) ? { requestedDays: dayCount(p), usedDays: dayCount(range) } : null };
  }
  return null;
}

function comparison(r: AskVaultRequestV2, results: PeriodResultV2[]): AskComparison {
  const [cur, base] = results;
  const aligned = r.alignment === "as-requested" ? null : alignedPrior(r.periods[0], r.alignment);
  const equal = cur.dayCount === base.dayCount;
  const c = BigInt(cur.total.replace(".", "")), b = BigInt(base.total.replace(".", ""));
  const reason = equal ? null : aligned?.clamped ? "clamped" : "unequal-lengths";
  let percentChange: string | null = null;
  let percentOutcome: AskComparison["percentOutcome"];
  if (!equal) percentOutcome = "not-comparable";
  else if (c === b) { percentOutcome = "no-change"; percentChange = "0.0"; }
  else if (b === 0n) percentOutcome = "from-zero";
  else { percentOutcome = "changed"; percentChange = tenths(roundHalfAway((c - b) * 1000n, b < 0n ? -b : b)); }
  return { alignment: r.alignment, comparable: equal, notComparableReason: reason, elapsedDays: cur.dayCount, clamped: aligned?.clamped ?? null, absoluteChange: dollars(c - b), percentChange, percentOutcome };
}

export function answer(w: World, r: AskVaultRequestV2): AskVaultSnapshotV2 {
  const results: PeriodResultV2[] = r.periods.map((p) => {
    const allocs = eligible(w, r, p);
    const total = sum(allocs);
    const byCategory = new Map<string | null, Allocation[]>();
    for (const a of allocs) byCategory.set(a.category, [...(byCategory.get(a.category) ?? []), a]);
    const categories: CategoryRow[] = [...byCategory.entries()]
      .map(([category, xs]) => ({ category, amount: dollars(sum(xs)), purchaseCount: distinct(xs) }))
      .sort((x, y) => Number(BigInt(y.amount.replace(".", "")) - BigInt(x.amount.replace(".", ""))) || (x.category ?? "").localeCompare(y.category ?? ""));
    const byParent = new Map<number, Allocation[]>();
    for (const a of allocs) byParent.set(a.tx.id, [...(byParent.get(a.tx.id) ?? []), a]);
    const purchases: PurchaseRow[] = [...byParent.values()]
      .map((xs) => ({ transactionId: xs[0].tx.id, accountId: xs[0].tx.accountId, date: xs[0].tx.date, description: xs[0].tx.description, amount: dollars(sum(xs)), parentAmount: dollars(Math.abs(xs[0].tx.cents)) }))
      .sort((x, y) => Number(BigInt(y.amount.replace(".", "")) - BigInt(x.amount.replace(".", ""))) || x.date.localeCompare(y.date) || x.transactionId - y.transactionId);
    const monthRows = r.groupBy === "month" || r.average === "per-month" ? months(w, r, p, allocs) : [];
    return {
      from: p.from, to: p.to, dayCount: dayCount(p), endsToday: p.to === w.today, historyCoverage: "unknown", ...(monthRows.length ? { recordedFrom: evidence(w, r).recordedFrom, recordedThrough: evidence(w, r).recordedThrough } : { recordedFrom: null, recordedThrough: null }),
      total: dollars(total), purchaseCount: byParent.size, categoryCount: byCategory.size,
      categories: r.kind === "rank-categories" ? categories.slice(0, r.limit) : [],
      purchases: r.kind === "rank-purchases" ? purchases.slice(0, r.limit) : [],
      ...vendorBlock(r, allocs),
      leftOut: leftOut(w, r, p),
      sharedPurchaseCount: r.categories.length > 1 ? r.categories.reduce((n, c) => n + distinct(allocs.filter((a) => a.category === c)), 0) - byParent.size : 0,
      categoryTotals: r.categories.length > 1 ? r.categories.map((c) => { const xs = allocs.filter((a) => a.category === c); return { category: c, total: dollars(sum(xs)), purchaseCount: distinct(xs) }; }) : [],
      memberTotals: r.groupBy === "member" ? members(w, r, allocs) : [],
      months: monthRows,
      average: r.average === "none" ? null : average(r.average, total, byParent.size, monthRows),
    };
  });
  const diff = r.kind === "compare" ? dollars(BigInt(results[0].total.replace(".", "")) - BigInt(results[1].total.replace(".", ""))) : null;
  return {
    contractVersion: 2, context: { generation: 1, sessionRevision: 1 }, revision: { local: 1, external: 1 }, asOf: w.today,
    earliestRecord: earliestRecord(w), kind: r.kind, spendingBasis: "gross-negative-allocations", thresholdBasis: "absolute-parent-amount",
    periods: results, difference: diff, comparison: r.kind === "compare" ? comparison(r, results) : null,
  };
}

/** A request with every M2 field at its neutral value; cases override what they need. */
export function request(over: Partial<AskVaultRequestV2> & Pick<AskVaultRequestV2, "kind" | "periods">): AskVaultRequestV2 {
  return {
    contractVersion: 2, accountIds: [], categories: [], members: { ids: [], unassigned: false }, minimumPurchase: null, vendors: [],
    excludeVendors: [], excludeCategories: [], limit: 1, groupBy: "none", average: "none", alignment: "as-requested", expectedRevision: null, ...over,
  };
}
export { addDays };
