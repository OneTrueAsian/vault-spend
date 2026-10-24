import { readFileSync } from "node:fs";
import type { ConfirmedCutPreview, CutPreviewIntent } from "../../askVault/cutPreviewContract";

/** Test-only separate rational reference. Authority: M4 Financial-Rules, retained Python Fraction vectors.
 * No production calculator/calendar/parser is imported. The 120 original vectors remain unmodified arithmetic evidence,
 * separate from the 24 new native-baseline public-route questions. No unseen-language claim. */
class Q {
  readonly n: bigint; readonly d: bigint;
  constructor(n: bigint, d = 1n) { let a = n < 0n ? -n : n, b = d; while (b) [a, b] = [b, a % b]; this.n = n / (a || 1n); this.d = d / (a || 1n); }
  static decimal(s: string) { const [a, b = ""] = s.split("."); return new Q(BigInt(a + b), 10n ** BigInt(b.length)); }
  plus(q: Q) { return new Q(this.n * q.d + q.n * this.d, this.d * q.d); }
  minus(q: Q) { return new Q(this.n * q.d - q.n * this.d, this.d * q.d); }
  times(q: Q) { return new Q(this.n * q.n, this.d * q.d); }
  over(q: Q) { return new Q(this.n * q.d, this.d * q.n); }
  smaller(q: Q) { return this.n * q.d <= q.n * this.d ? this : q; }
  exact() { return { numerator: String(this.n), denominator: String(this.d) }; }
  cents() { return this.n * 100n / this.d; }
}
export type BaselineRow = { category: string; baseline: { kind: string; monthlyAmount?: string; months?: { month: string; total: string; coverage: string }[] } };
const monthBase = (b: BaselineRow["baseline"]) => {
  if (b.kind === "manual") return Q.decimal(b.monthlyAmount!);
  const used = b.months!.filter(m => m.coverage === "complete");
  if (!used.length) throw Error("Reference needs an explicit manual baseline for missing history");
  return used.reduce((q, m) => q.plus(Q.decimal(m.total)), new Q(0n)).over(new Q(BigInt(used.length)));
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const segments = (from: string, to: string) => {
  const rows: { from: string; to: string; q: Q }[] = [];
  const start = new Date(from + "T00:00:00Z"), end = new Date(to + "T00:00:00Z");
  let cursor = new Date(start);
  while (cursor <= end) {
    const last = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const stop = last < end ? last : end;
    rows.push({ from: iso(cursor), to: iso(stop), q: new Q(BigInt(Math.round((+stop - +cursor) / 86400000) + 1), BigInt(last.getUTCDate())) });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return rows;
};
export function m4Expected(intent: CutPreviewIntent, baselines: BaselineRow[]) {
  const parts = segments(intent.horizon.from, intent.horizon.to), factor = parts.reduce((q, p) => q.plus(p.q), new Q(0n));
  const unit = intent.target.kind === "monthly" ? "per-month" : "whole-period";
  const rows = [...intent.categories].sort((a, b) => a.category < b.category ? -1 : a.category > b.category ? 1 : 0).map(term => {
    const base = monthBase(baselines.find(b => b.category === term.category)!.baseline), floor = Q.decimal(term.monthlyFloor);
    if (base.minus(floor).n < 0n) throw Error("Reference floor exceeds baseline");
    const cap = Q.decimal(term.maximumReduction.amount).times(term.maximumReduction.kind === "percent" ? base.over(new Q(100n)) : new Q(1n));
    const monthly = base.minus(floor).smaller(cap), capacity = monthly.times(unit === "per-month" ? new Q(1n) : factor).cents();
    return { term, base, monthly, capacity, assigned: 0n, residue: 0n };
  });
  const maximum = rows.reduce((n, r) => n + r.capacity, 0n), target = Q.decimal(intent.target.amount).cents(), allocated = target < maximum ? target : maximum;
  for (const r of rows) if (maximum) { r.assigned = allocated * r.capacity / maximum; r.residue = allocated * r.capacity % maximum; }
  let left = allocated - rows.reduce((n, r) => n + r.assigned, 0n);
  for (const r of [...rows].sort((a, b) => a.residue === b.residue ? a.term.category < b.term.category ? -1 : 1 : a.residue > b.residue ? -1 : 1)) if (left > 0n) { r.assigned++; left--; }
  const allocations = rows.map(r => {
    const reduction = new Q(r.assigned, 100n).over(unit === "per-month" ? new Q(1n) : factor);
    return { category: r.term.category, unit, monthlyBaseline: r.base.exact(), monthlyCapacity: r.monthly.exact(), capacityCents: String(r.capacity), allocatedCents: String(r.assigned),
      monthlyReduction: reduction.exact(), monthlyLimit: r.base.minus(reduction).exact(), intervals: parts.map(p => ({ from: p.from, to: p.to, saving: reduction.times(p.q).exact() })), totalSaving: reduction.times(factor).exact() };
  });
  return { kind: "preview" as const, unit, monthFactor: factor.exact(), targetMet: target <= maximum, targetCents: String(target), maximumCents: String(maximum), allocatedCents: String(allocated), shortfallCents: String(target - allocated),
    totalSaving: new Q(allocated, 100n).times(unit === "per-month" ? factor : new Q(1n)).exact(), allocations };
}
export type M4Row = { id: string; basis: "monthly" | "total"; target: string; policy: "percent" | "floor-percent" | "floor-money"; text: string };
export function m4Rows(): M4Row[] {
  const rows: M4Row[] = [];
  for (const basis of ["monthly", "total"] as const) for (const target of ["0", "0.01", "50", "10000"]) for (const policy of ["percent", "floor-percent", "floor-money"] as const) {
    const floor = policy === "percent" ? "0" : "10", cap = policy === "percent" ? "100%" : policy === "floor-percent" ? "25%" : "$25";
    rows.push({ id: `m4/${basis}-${target}-${policy}`, basis, target, policy,
      text: `Save $${target} ${basis === "monthly" ? "monthly" : "in total"} across Dining and Groceries with Dining floor $${floor} and maximum cut ${cap} with Groceries floor $${floor} and maximum cut ${cap} from November through December 2026` });
  }
  return rows;
}
export const m4Intent = (r: Pick<M4Row, "basis" | "target" | "policy">): CutPreviewIntent => ({ version: 1, target: { kind: r.basis, amount: r.target }, allocationPolicy: "capacity-proportional",
  categories: ["Dining", "Groceries"].map(category => ({ category, monthlyFloor: r.policy === "percent" ? "0" : "10", maximumReduction: { kind: r.policy === "floor-money" ? "money" : "percent", amount: r.policy === "percent" ? "100" : "25" } })),
  horizon: { kind: "prospective", from: "2026-11-01", to: "2026-12-31" }, partialMonth: "exclude" });
export const SOURCE = { generation: 1, sessionRevision: 1, revision: { local: 1, external: 1 }, asOf: "2026-09-06" };
type NativeRef = { kind: string; worldId: string; label: string; requestId: string; value: { periods: { months: { month: string; total: string; coverage: string }[] }[] } };
export function nativeM4Input(row: M4Row, seed: number) {
  const refs = JSON.parse(readFileSync(`${__dirname}/scenarioNativeReferences.json`, "utf8")).references as Record<string, NativeRef>;
  const items = ["Dining", "Groceries"].map(category => Object.entries(refs).find(([, r]) => r.kind === "baseline" && r.worldId === `origin-101-seed-${seed}` && r.label === category)!);
  return { intent: m4Intent(row), source: SOURCE, confirmed: true as const, nativeItems: items.map(([id]) => id),
    baselines: items.map(([, r]) => ({ category: r.label, baseline: { kind: "recorded" as const, source: SOURCE, months: r.value.periods[0].months.map(({ month, total, coverage }) => ({ month, total, coverage: coverage as "complete" })), shortHistoryAccepted: true } })) };
}
export const retainedM4Vectors = (): { name: string; scenario: ConfirmedCutPreview; expected: ReturnType<typeof m4Expected> }[] => JSON.parse(readFileSync(`${__dirname}/m4RetainedVectors.json`, "utf8")).vectors;
export const m4DisplayMoney = (v: { numerator: string; denominator: string }) => {
  const n = BigInt(v.numerator), d = BigInt(v.denominator), cents = (n * 200n + d) / (2n * d);
  return `$${String(cents / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String(cents % 100n).padStart(2, "0")}`;
};
