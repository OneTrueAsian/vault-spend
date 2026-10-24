/** Pure M4 spread preview. Currency remains rational until capacity/allocation cents are required. */
import { dateParts, dayCount, daysInMonth, monthsTouching } from "./calendar";
import { sameScenarioSource } from "./spendingScenarioBaseline";
import { ScenarioInputError, scenarioBaselineProblem, scenarioMonthlyBaseline } from "./spendingScenarioMath";
import { validateCutPreviewIntent } from "./cutPreviewContract";
import type { CalculateCutPreview, ConfirmedCutPreview, CutPreviewAllocation } from "./cutPreviewContract";
import type { ScenarioExactMoney } from "./spendingScenarioContract";

type Rational = { n: bigint; d: bigint };
function fraction(n: bigint, d = 1n): Rational {
  let a = n, b = d;
  while (b) [a, b] = [b, a % b];
  return { n: n / (a || 1n), d: d / (a || 1n) };
}
const decimal = (s: string) => { const [whole, part = ""] = s.split("."); return fraction(BigInt(whole + part), 10n ** BigInt(part.length)); };
const add = (a: Rational, b: Rational) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const subtract = (a: Rational, b: Rational) => fraction(a.n * b.d - b.n * a.d, a.d * b.d);
const multiply = (a: Rational, b: Rational) => fraction(a.n * b.n, a.d * b.d);
const divide = (a: Rational, b: Rational) => fraction(a.n * b.d, a.d * b.n);
const less = (a: Rational, b: Rational) => a.n * b.d < b.n * a.d;
const exact = (a: Rational): ScenarioExactMoney => ({ numerator: String(a.n), denominator: String(a.d) });
const fromExact = (a: ScenarioExactMoney) => fraction(BigInt(a.numerator), BigInt(a.denominator));
const labelOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(k => Object.prototype.hasOwnProperty.call(v, k));
function freeze<T>(v: T): T {
  if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
}

/** Validate every entry before resolving missing history or invalid floors. No input can supply q or units. */
function checkedCopy(input: unknown): ConfirmedCutPreview {
  let v: unknown;
  try { v = structuredClone(input); } catch { throw new ScenarioInputError("The confirmed preview cannot be copied."); }
  const fail = (message: string): never => { throw new ScenarioInputError(message); };
  if (!record(v) || !keys(v, ["intent", "baselines", "source", "confirmed"]) || v.confirmed !== true) return fail("The preview was not confirmed or has unknown fields.");
  const problem = scenarioBaselineProblem({ kind: "manual", monthlyAmount: "0", source: v.source });
  if (problem) return fail(problem);
  const source = v.source as ConfirmedCutPreview["source"];
  const labels = record(v.intent) && Array.isArray(v.intent.categories)
    ? v.intent.categories.flatMap(row => record(row) && typeof row.category === "string" ? [row.category] : []) : [];
  const intent = validateCutPreviewIntent(v.intent, { asOf: source.asOf, categories: labels });
  if (!intent.ok) return fail(intent.reason);
  if (!Array.isArray(v.baselines) || v.baselines.length !== labels.length) return fail("Choose one baseline for every selected category.");
  const seen = new Set<string>();
  for (const row of v.baselines) {
    if (!record(row) || !keys(row, ["category", "baseline"]) || typeof row.category !== "string" || !labels.includes(row.category) || seen.has(row.category)) return fail("Each selected category needs exactly one baseline.");
    seen.add(row.category);
    const baselineProblem = scenarioBaselineProblem(row.baseline);
    if (baselineProblem) return fail(baselineProblem);
    if (!sameScenarioSource(source, (row.baseline as ConfirmedCutPreview["baselines"][number]["baseline"]).source)) return fail("Every baseline must match the confirmed source.");
  }
  return freeze(v as ConfirmedCutPreview);
}

export const calculateCutPreview: CalculateCutPreview = (input) => {
  const scenario = checkedCopy(input);
  const { intent } = scenario;
  const baselineByCategory = new Map(scenario.baselines.map(row => [row.category, scenarioMonthlyBaseline(row.baseline)]));
  const selected = [...intent.categories].sort((a, b) => labelOrder(a.category, b.category));
  const missing = selected.filter(row => baselineByCategory.get(row.category) === null).map(row => row.category);
  if (missing.length) return { kind: "needs-baseline", categories: missing };
  const rows = selected.map(row => ({ ...row, base: fromExact(baselineByCategory.get(row.category)!) }));
  const violations = rows.filter(row => less(row.base, decimal(row.monthlyFloor))).map(row => ({
    category: row.category, monthlyFloor: row.monthlyFloor, monthlyBaseline: exact(row.base), reason: "floor-above-baseline" as const,
  }));
  if (violations.length) return { kind: "constraints-invalid", violations };

  const segments = monthsTouching(intent.horizon).map(segment => {
    const { y, m } = dateParts(segment.start);
    return { from: segment.from, to: segment.to, factor: fraction(BigInt(dayCount(segment)), BigInt(daysInMonth(y, m))) };
  });
  const q = segments.reduce((sum, segment) => add(sum, segment.factor), fraction(0n));
  const unit = intent.target.kind === "monthly" ? "per-month" : "whole-period";
  const capacities = rows.map(row => {
    const headroom = subtract(row.base, decimal(row.monthlyFloor));
    const cap = row.maximumReduction.kind === "money" ? decimal(row.maximumReduction.amount)
      : multiply(row.base, divide(decimal(row.maximumReduction.amount), fraction(100n)));
    const monthly = less(headroom, cap) ? headroom : cap;
    const period = multiply(monthly, unit === "per-month" ? fraction(1n) : q);
    return { monthly, cents: period.n * 100n / period.d };
  });
  const maximum = capacities.reduce((sum, c) => sum + c.cents, 0n);
  const goal = decimal(intent.target.amount);
  const target = goal.n * 100n / goal.d;
  const allocated = target < maximum ? target : maximum;
  const shares = capacities.map((c, i) => ({ i, cents: maximum ? allocated * c.cents / maximum : 0n, remainder: maximum ? allocated * c.cents % maximum : 0n }));
  let pennies = allocated - shares.reduce((sum, s) => sum + s.cents, 0n);
  const ranked = [...shares].sort((a, b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : labelOrder(rows[a.i].category, rows[b.i].category));
  for (const share of ranked) { if (!pennies) break; share.cents++; pennies--; }
  const allocations: CutPreviewAllocation[] = rows.map((row, i) => {
    const period = fraction(shares[i].cents, 100n);
    const cut = unit === "per-month" ? period : divide(period, q);
    const intervals = segments.map(segment => ({ from: segment.from, to: segment.to, saving: exact(multiply(cut, segment.factor)) }));
    return { category: row.category, unit, monthlyBaseline: exact(row.base), monthlyCapacity: exact(capacities[i].monthly),
      capacityCents: String(capacities[i].cents), allocatedCents: String(shares[i].cents), monthlyReduction: exact(cut),
      monthlyLimit: exact(subtract(row.base, cut)), intervals, totalSaving: exact(multiply(cut, q)) };
  });
  const amounts = { kind: "preview" as const, scenario, monthFactor: exact(q), targetMet: target <= maximum,
    targetCents: String(target), maximumCents: String(maximum), allocatedCents: String(allocated), shortfallCents: String(target - allocated),
    totalSaving: exact(allocations.reduce((sum, a) => add(sum, fromExact(a.totalSaving)), fraction(0n))) };
  // Every row and the discriminated result share the derived target unit.
  return unit === "per-month"
    ? { ...amounts, unit, allocations: allocations.map(a => ({ ...a, unit })) }
    : { ...amounts, unit, allocations: allocations.map(a => ({ ...a, unit })) };
};
