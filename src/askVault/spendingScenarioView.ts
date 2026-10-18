/**
 * M3 answer screen wording: turns the exact scenario terms and results into plain sentences and figures. Pure, no React.
 * Every dollar amount here comes from the exact calculator output; this module only rounds to cents for display.
 */
import { daysInMonth, dateParts, dayCount, isoDate, monthsTouching } from "./calendar";
import type { AskMonthCoverage } from "./contractV2";
import { formatMoney } from "./money";
import { scenarioMonthlyBaseline, scenarioMoneyToCents } from "./spendingScenarioMath";
import type { ScenarioBaseline, ScenarioExactMoney, SpendingScenarioCalculation, SpendingScenarioIntent } from "./spendingScenarioContract";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 15, 2026". Independent of the clock and the time zone. */
export function longDate(iso: string): string {
  const { y, m, d } = dateParts(iso);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "July 2026" from "2026-07". */
export function monthLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** An exact amount as "$1,234.50", rounded half away from zero to the cent. */
export const dollars = (money: ScenarioExactMoney): string => formatMoney(scenarioMoneyToCents(money));

/** A typed amount such as "50" or "12.5" as "$50.00". */
export const typedDollars = (amount: string): string => formatMoney(amount);

const LEFT_OUT: Record<Exclude<AskMonthCoverage, "complete">, string> = {
  "no-records": "no records",
  "before-records": "records start later",
  "partly-recorded": "records start part-way through",
  "records-end": "records stop before the month ends",
  "in-progress": "the month is not over",
  "partial-period": "only part of the month was asked",
};

export type BaselineRowView = { month: string; spent: string; counted: boolean; reason: string | null };

/** The three months as shown, every one of them, with the plain reason a month is not counted. Manual baselines have no months. */
export function baselineRows(baseline: ScenarioBaseline): BaselineRowView[] {
  if (baseline.kind === "manual") return [];
  return baseline.months.map((row) => ({
    month: monthLabel(row.month),
    spent: formatMoney(row.total),
    counted: row.coverage === "complete",
    reason: row.coverage === "complete" ? null : LEFT_OUT[row.coverage],
  }));
}

/** How many of the three months are counted (0 for a manual baseline, which has no months). */
export const countedMonths = (baseline: ScenarioBaseline): number => (baseline.kind === "manual" ? 0 : baseline.months.filter((row) => row.coverage === "complete").length);

/** "$300.00" for the usual month, or null when nothing can be counted. */
export function usualMonthText(baseline: ScenarioBaseline): string | null {
  const exact = scenarioMonthlyBaseline(baseline);
  return exact ? dollars(exact) : null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "$50.00 every month", "10% every month", "$25.00 once". */
export function reductionText(intent: SpendingScenarioIntent): string {
  const how = intent.cadence === "monthly" ? "every month" : "once";
  const amount = intent.reduction.kind === "money" ? typedDollars(intent.reduction.amount) : `${intent.reduction.amount}%`;
  return `${amount} ${how}`;
}

/** The dates in words, with the month count for a monthly schedule. */
export function datesText(intent: SpendingScenarioIntent): string {
  const { from, to } = intent.horizon;
  if (intent.cadence === "once") return longDate(from);
  const count = plural(monthsTouching({ from, to }).length, "month");
  if (intent.horizon.kind === "full-year-hypothetical") return `${longDate(from)} to ${longDate(to)} (${count}), a what-if that includes months that have already passed`;
  return `${longDate(from)} to ${longDate(to)} (${count})`;
}

/** What happens to a month that is only partly inside the dates; null for a one-time cut, which has no months. */
export function partMonthText(intent: SpendingScenarioIntent): string | null {
  if (intent.cadence === "once") return null;
  return intent.partialMonth === "prorate" ? "Counted by the day" : "Not counted, whole months only";
}

/** Whether a segment is only part of its month, and how many days of how many. */
function segmentDays(from: string, to: string): { days: number; of: number } {
  const { y, m } = dateParts(from);
  return { days: dayCount({ from, to }), of: daysInMonth(y, m) };
}

/** Said under a table of separately rounded lines. It claims no size for the difference. */
export const ROUNDING_NOTE = "Each amount is rounded to the cent on its own, so the lines may not add up exactly to the total.";

export type ResultView = {
  headline: string;
  /** Only for a whole-year what-if: the elapsed months are part of the sum. */
  hypothetical: string | null;
  /** Only for a percentage: what the percentage is of, in dollars. */
  basis: string | null;
  total: string;
  limit: string;
  rows: { label: string; saving: string }[];
  /** True when the rounded lines do not add up to the rounded total, so the screen explains the cent. */
  rowsNeedRoundingNote: boolean;
  usualMonth: string;
};

const centsOf = (money: ScenarioExactMoney) => BigInt(scenarioMoneyToCents(money).replace(".", ""));

/** The result screen's sentences and rows from a calculated preview. */
export function resultView(calculation: Extract<SpendingScenarioCalculation, { kind: "preview" }>): ResultView {
  const { intent } = calculation.scenario;
  const category = intent.category;
  const once = intent.cadence === "once";
  const less = intent.reduction.kind === "money" ? `${typedDollars(intent.reduction.amount)} less` : `${intent.reduction.amount}% less`;
  const headline = once
    ? `Spending ${less} on ${category} once, on ${longDate(intent.horizon.from)}, would save`
    : `Spending ${less} on ${category} each month from ${longDate(intent.horizon.from)} to ${longDate(intent.horizon.to)} would save`;
  const usualMonth = dollars(calculation.monthlyBaseline);
  const limit = once
    ? `A one-time cut does not set a monthly limit. A usual month of ${category} is ${usualMonth}, so ${dollars(calculation.totalSaving)} fits inside it.`
    : `Your ${category} limit would be ${dollars(calculation.monthlyLimit!)} a month instead of a usual ${usualMonth}.`;
  const rows = once
    ? []
    : calculation.intervals.map((interval) => {
        const part = segmentDays(interval.from, interval.to);
        const label = monthLabel(interval.from.slice(0, 7)) + (part.days < part.of ? ` (${part.days} of ${part.of} days)` : "");
        return { label, saving: dollars(interval.saving) };
      });
  const rowCents = calculation.intervals.reduce((sum, interval) => sum + centsOf(interval.saving), 0n);
  const hypothetical =
    intent.horizon.kind === "full-year-hypothetical"
      ? `This is a what-if for the whole of ${intent.horizon.from.slice(0, 4)}. It includes months that have already passed, so it is not money you have already saved.`
      : null;
  const basis =
    intent.reduction.kind === "percent" && calculation.monthlyReduction
      ? `${intent.reduction.amount}% of a usual month of ${category} (${usualMonth}) is ${dollars(calculation.monthlyReduction)} a month.`
      : null;
  return {
    headline,
    hypothetical,
    basis,
    total: dollars(calculation.totalSaving),
    limit,
    rows,
    rowsNeedRoundingNote: !once && rowCents !== centsOf(calculation.totalSaving),
    usualMonth,
  };
}

// ---- the person's own schedule: which months are only partly inside it ----

export type PartMonth = { month: string; from: string; to: string; days: number; of: number; where: "start" | "end" | "only" };

/** The first and last month of a range when the range covers only part of them. A complete-month range has none. */
export function partMonths(range: { from: string; to: string }): PartMonth[] {
  const segments = monthsTouching(range);
  const partial = (segment: (typeof segments)[number]) => segment.from !== segment.start || segment.to !== segment.end;
  const make = (segment: (typeof segments)[number], where: PartMonth["where"]): PartMonth => ({
    month: monthLabel(segment.month).split(" ")[0],
    from: segment.from,
    to: segment.to,
    days: dayCount({ from: segment.from, to: segment.to }),
    of: daysInMonth(dateParts(segment.start).y, dateParts(segment.start).m),
    where,
  });
  if (segments.length === 1) return partial(segments[0]) ? [make(segments[0], "only")] : [];
  const out: PartMonth[] = [];
  if (partial(segments[0])) out.push(make(segments[0], "start"));
  if (partial(segments[segments.length - 1])) out.push(make(segments[segments.length - 1], "end"));
  return out;
}

/** The same range with any part month at either end dropped, or null when no whole month is left. */
export function wholeMonthsOnly(range: { from: string; to: string }): { from: string; to: string } | null {
  const first = dateParts(range.from);
  const last = dateParts(range.to);
  let from = range.from;
  let to = range.to;
  if (first.d !== 1) {
    const index = first.y * 12 + first.m;
    from = isoDate(Math.floor(index / 12), (index % 12) + 1, 1);
  }
  if (last.d !== daysInMonth(last.y, last.m)) {
    const index = last.y * 12 + (last.m - 1) - 1;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    to = isoDate(y, m, daysInMonth(y, m));
  }
  return from > to ? null : { from, to };
}

/** How many calendar months a range touches. */
export const monthCount = (range: { from: string; to: string }): number => monthsTouching(range).length;

/** "October 15 to 31 is 17 of 31 days, so October counts 17/31 of a month." */
export function partMonthHint(part: PartMonth): string {
  const { d: fromDay } = dateParts(part.from);
  const { d: toDay } = dateParts(part.to);
  return `${part.month} ${fromDay} to ${toDay} is ${part.days} of ${part.of} days, so ${part.month} counts ${part.days}/${part.of} of a month.`;
}

/** "Your schedule starts part-way through October." and its variants. */
export function partMonthLegend(parts: PartMonth[]): string {
  if (parts.length === 1 && parts[0].where === "only") return `Your schedule covers only part of ${parts[0].month}.`;
  const start = parts.find((part) => part.where === "start");
  const end = parts.find((part) => part.where === "end");
  if (start && end) return `Your schedule starts part-way through ${start.month} and ends part-way through ${end.month}.`;
  return start ? `Your schedule starts part-way through ${start.month}.` : `Your schedule ends part-way through ${end!.month}.`;
}
