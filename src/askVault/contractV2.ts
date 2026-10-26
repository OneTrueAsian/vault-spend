import { array, boolean, date, integer, nullable, object, string } from "../contractChecks";
import { TransactionError } from "../transactionContracts";
import { alignedPrior, dayCount, monthsTouching } from "./calendar";
import { addMoney, averageToCents, compareMoney, isMoney, percentChangeTenths, subtractMoney } from "./money";
import type { AskAlignment, AskDataRevision, AskFamilyMember, AskKind, AskVaultRequestV2 } from "./types";
import type { AskPeriodResult } from "./contract";

/** Version 2 replies only add fields to version 1: everything a version 1 period carries is still there and still checked. */
export type AskCategoryTotal = { category: string; total: string; purchaseCount: number };
/** `memberId` null is the line for purchases with no family member. */
export type AskMemberTotal = { memberId: number | null; name: string | null; total: string; purchaseCount: number };
/**
 * Whether a calendar month can be trusted as a whole month of the person's spending; only "complete" months enter an average.
 * The labels follow from the evidence dates of the period, never from the first transaction date of the ledger.
 */
export type AskMonthCoverage = "complete" | "in-progress" | "partial-period" | "partly-recorded" | "before-records" | "no-records" | "records-end";
export type AskMonthRow = {
  month: string;
  from: string;
  to: string;
  dayCount: number;
  coverage: AskMonthCoverage;
  /** Records of any kind in the accounts the question covers, dated inside from..to, today at most. */
  recordCount: number;
  total: string;
  purchaseCount: number;
};
export type AskAverageLeftOut = { month: string; why: Exclude<AskMonthCoverage, "complete"> };
export type AskAverage = {
  basis: "per-purchase" | "per-month";
  numerator: string;
  denominator: number;
  /** Rounded half away from zero to the cent; null exactly when `unavailable` is set. */
  value: string | null;
  unavailable: null | "no-purchases" | "no-complete-months";
  monthsUsed: string[];
  monthsLeftOut: AskAverageLeftOut[];
};
export type AskPeriodResultV2 = AskPeriodResult & {
  categoryTotals: AskCategoryTotal[];
  /** Sum of the category lines' counts minus `purchaseCount`: the extra times a split purchase sits in a second chosen category. */
  sharedPurchaseCount: number;
  memberTotals: AskMemberTotal[];
  months: AskMonthRow[];
  /** The evidence dates behind the month labels; null unless months are present, and null when no account holds a match. */
  recordedFrom: string | null;
  recordedThrough: string | null;
  average: AskAverage | null;
};
export type AskComparison = {
  alignment: AskAlignment;
  comparable: boolean;
  notComparableReason: null | "unequal-lengths" | "clamped";
  elapsedDays: number;
  clamped: null | { requestedDays: number; usedDays: number };
  absoluteChange: string;
  percentChange: string | null;
  percentOutcome: "changed" | "no-change" | "from-zero" | "not-comparable";
};
export type AskVaultSnapshotV2 = {
  contractVersion: 2;
  context: { generation: number; sessionRevision: number };
  revision: AskDataRevision;
  asOf: string;
  /** First transaction date in the whole ledger. Informational: it is never proof that a month is recorded. */
  earliestRecord: string | null;
  kind: AskKind;
  spendingBasis: "gross-negative-allocations";
  thresholdBasis: "absolute-parent-amount";
  periods: AskPeriodResultV2[];
  difference: string | null;
  comparison: AskComparison | null;
};

const money = (v: unknown) => isMoney(v);
const exactMoney = (v: unknown) => typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v);
const positiveId = (v: unknown) => integer(v) && (v as number) > 0;
const COVERAGE = ["complete", "in-progress", "partial-period", "partly-recorded", "before-records", "no-records", "records-end"];
const coverage = (v: unknown) => typeof v === "string" && COVERAGE.includes(v);

/** The version 2 additions to a period, shape only. The shared period fields are checked by the version 1 shape. */
export const periodExtraShape = object({
  categoryTotals: array(object({ category: string, total: money, purchaseCount: integer })),
  sharedPurchaseCount: integer,
  memberTotals: array(object({ memberId: nullable(positiveId), name: nullable(string), total: money, purchaseCount: integer })),
  months: array(object({ month: string, from: date, to: date, dayCount: integer, coverage, recordCount: integer, total: money, purchaseCount: integer })),
  recordedFrom: nullable(date),
  recordedThrough: nullable(date),
  average: nullable(
    object({
      basis: (v) => v === "per-purchase" || v === "per-month",
      numerator: money,
      denominator: integer,
      value: nullable(money),
      unavailable: (v) => v === null || v === "no-purchases" || v === "no-complete-months",
      monthsUsed: array(string),
      monthsLeftOut: array(object({ month: string, why: (v) => coverage(v) && v !== "complete" })),
    }),
  ),
});

export const snapshotExtraShape = object({
  earliestRecord: nullable(date),
  comparison: nullable(
    object({
      alignment: (v) => v === "as-requested" || v === "same-days-previous-month" || v === "same-days-previous-year",
      comparable: boolean,
      notComparableReason: (v) => v === null || v === "unequal-lengths" || v === "clamped",
      elapsedDays: integer,
      clamped: nullable(object({ requestedDays: integer, usedDays: integer })),
      absoluteChange: exactMoney,
      percentChange: nullable((v) => typeof v === "string" && /^-?\d+\.\d$/.test(v)),
      percentOutcome: (v) => v === "changed" || v === "no-change" || v === "from-zero" || v === "not-comparable",
    }),
  ),
});

function invalid(): never {
  throw new TransactionError("invalid_response", "The app received an incomplete answer. Ask again.");
}

const sumMoney = (rows: { total: string }[]) => rows.reduce((sum, row) => addMoney(sum, row.total), "0");
const sameMoney = (a: string, b: string) => compareMoney(a, b) === 0;

function checkCategoryTotals(result: AskPeriodResultV2, request: AskVaultRequestV2): void {
  const lines = result.categoryTotals;
  if (request.categories.length < 2) {
    if (lines.length || result.sharedPurchaseCount !== 0) invalid();
    return;
  }
  if (lines.length !== request.categories.length || lines.some((line, i) => line.category !== request.categories[i])) invalid();
  if (!sameMoney(sumMoney(lines), result.total)) invalid();
  // A split purchase can sit in two chosen categories, so the lines may count it twice: the lines add up to the distinct purchases
  // plus exactly the number the reply says are shared, and no single line can exceed the whole.
  const counts = lines.map((line) => line.purchaseCount);
  if (counts.some((n) => n > result.purchaseCount)) invalid();
  if (counts.reduce((a, b) => a + b, 0) - result.sharedPurchaseCount !== result.purchaseCount) invalid();
}

function checkMemberTotals(result: AskPeriodResultV2, request: AskVaultRequestV2, roster: AskFamilyMember[] | undefined): void {
  const lines = result.memberTotals;
  if (request.groupBy !== "member") {
    if (lines.length) invalid();
    return;
  }
  const ids = lines.filter((line) => line.memberId !== null).map((line) => line.memberId as number);
  const unassigned = lines.filter((line) => line.memberId === null);
  if (new Set(ids).size !== ids.length || unassigned.length > 1) invalid();
  if (unassigned.length === 1 && unassigned[0].name !== null) invalid();
  if (lines.some((line) => line.memberId !== null && line.name === null)) invalid();
  const chosen = request.members.ids.length > 0 || request.members.unassigned;
  if (chosen) {
    if (ids.length !== request.members.ids.length || !request.members.ids.every((id) => ids.includes(id))) invalid();
    if (unassigned.length !== (request.members.unassigned ? 1 : 0)) invalid();
  } else {
    if (unassigned.length !== 1) invalid();
    // Everyone: one line per person the Dashboard knows, none missing, none invented. The reply cannot vouch for its own roster.
    if (roster) {
      const known = new Map(roster.map((member) => [member.id, member.name]));
      if (ids.length !== known.size || lines.some((line) => line.memberId !== null && known.get(line.memberId) !== line.name)) invalid();
    }
  }
  if (!sameMoney(sumMoney(lines), result.total)) invalid();
  if (lines.reduce((sum, line) => sum + line.purchaseCount, 0) !== result.purchaseCount) invalid();
  // Largest total first; on a tie the people by name, and the unassigned line last.
  for (let i = 1; i < lines.length; i++) {
    const before = lines[i - 1];
    const line = lines[i];
    const order = compareMoney(before.total, line.total);
    if (order < 0) invalid();
    if (order === 0) {
      if (before.name === null) invalid();
      else if (line.name !== null && before.name.localeCompare(line.name) > 0) invalid();
    }
  }
}

/** The one place the label of a month is decided; the native side must give exactly this label for the same evidence. */
export function monthCoverage(args: {
  start: string;
  end: string;
  from: string;
  to: string;
  recordCount: number;
  recordedFrom: string | null;
  recordedThrough: string | null;
  asOf: string;
}): AskMonthCoverage {
  const { start, end, from, to, recordCount, recordedFrom, recordedThrough, asOf } = args;
  if (recordedFrom === null || recordedThrough === null) return "no-records";
  if (end < recordedFrom) return "before-records";
  if (recordedFrom > start) return "partly-recorded";
  if (end >= asOf) return "in-progress";
  if (recordCount === 0) return "no-records";
  if (recordedThrough <= end) return "records-end";
  if (from > start || to < end) return "partial-period";
  return "complete";
}

function checkMonths(result: AskPeriodResultV2, request: AskVaultRequestV2, asOf: string): void {
  const wanted = request.groupBy === "month" || request.average === "per-month";
  const { months, recordedFrom, recordedThrough } = result;
  if (!wanted) {
    if (months.length || recordedFrom !== null || recordedThrough !== null) invalid();
    return;
  }
  if ((recordedFrom === null) !== (recordedThrough === null)) invalid();
  // Shared account spans can be disjoint: the latest first record may follow the earliest last record.
  // The coverage rules then leave every month out; both boundaries must still be real evidence as of today.
  if (recordedFrom !== null && recordedThrough !== null && (recordedFrom > asOf || recordedThrough > asOf)) invalid();
  const expected = monthsTouching({ from: result.from, to: result.to });
  if (months.length !== expected.length) invalid();
  expected.forEach((span, i) => {
    const row = months[i];
    if (row.month !== span.month || row.from !== span.from || row.to !== span.to || row.dayCount !== dayCount(span)) invalid();
    if (row.purchaseCount > row.recordCount) invalid();
    const label = monthCoverage({ start: span.start, end: span.end, from: span.from, to: span.to, recordCount: row.recordCount, recordedFrom, recordedThrough, asOf });
    if (row.coverage !== label) invalid();
  });
  if (!sameMoney(sumMoney(months), result.total)) invalid();
  if (months.reduce((sum, row) => sum + row.purchaseCount, 0) !== result.purchaseCount) invalid();
}

function checkAverage(result: AskPeriodResultV2, request: AskVaultRequestV2): void {
  const average = result.average;
  if (request.average === "none") {
    if (average !== null) invalid();
    return;
  }
  if (average === null || average.basis !== request.average) invalid();
  if ((average.value === null) !== (average.unavailable !== null)) invalid();
  if (average.basis === "per-purchase") {
    if (!sameMoney(average.numerator, result.total) || average.denominator !== result.purchaseCount) invalid();
    if (average.monthsUsed.length || average.monthsLeftOut.length) invalid();
    if (result.purchaseCount === 0) {
      if (average.unavailable !== "no-purchases") invalid();
    } else if (average.unavailable !== null || !sameMoney(average.value as string, averageToCents(result.total, result.purchaseCount))) {
      invalid();
    }
    return;
  }
  const used = result.months.filter((row) => row.coverage === "complete");
  const left = result.months.filter((row) => row.coverage !== "complete");
  if (average.monthsUsed.length !== used.length || average.monthsUsed.some((month, i) => month !== used[i].month)) invalid();
  if (average.monthsLeftOut.length !== left.length || average.monthsLeftOut.some((row, i) => row.month !== left[i].month || row.why !== left[i].coverage)) invalid();
  const numerator = sumMoney(used);
  if (!sameMoney(average.numerator, numerator) || average.denominator !== used.length) invalid();
  if (used.length === 0) {
    if (average.unavailable !== "no-complete-months") invalid();
  } else if (average.unavailable !== null || !sameMoney(average.value as string, averageToCents(numerator, used.length))) {
    invalid();
  }
}

function checkComparison(reply: AskVaultSnapshotV2, request: AskVaultRequestV2): void {
  if (request.kind !== "compare") {
    if (reply.comparison !== null) invalid();
    return;
  }
  const comparison = reply.comparison;
  if (comparison === null || comparison.alignment !== request.alignment) invalid();
  const [current, earlier] = reply.periods;
  const aligned = request.alignment === "as-requested" ? null : alignedPrior(request.periods[0], request.alignment);
  if (request.alignment !== "as-requested") {
    if (aligned === null || aligned.range.from !== request.periods[1].from || aligned.range.to !== request.periods[1].to) invalid();
  }
  const equalLengths = current.dayCount === earlier.dayCount;
  if (comparison.elapsedDays !== current.dayCount || comparison.comparable !== equalLengths) invalid();
  const reason = equalLengths ? null : aligned?.clamped ? "clamped" : "unequal-lengths";
  if (comparison.notComparableReason !== reason) invalid();
  const clamped = aligned?.clamped ?? null;
  if (JSON.stringify(comparison.clamped) !== JSON.stringify(clamped)) invalid();
  const change = subtractMoney(current.total, earlier.total);
  if (!sameMoney(comparison.absoluteChange, change) || reply.difference === null || !sameMoney(reply.difference, change)) invalid();
  if (!equalLengths) {
    if (comparison.percentOutcome !== "not-comparable" || comparison.percentChange !== null) invalid();
  } else if (sameMoney(current.total, earlier.total)) {
    if (comparison.percentOutcome !== "no-change" || comparison.percentChange !== "0.0") invalid();
  } else if (sameMoney(earlier.total, "0")) {
    if (comparison.percentOutcome !== "from-zero" || comparison.percentChange !== null) invalid();
  } else if (comparison.percentOutcome !== "changed" || comparison.percentChange !== percentChangeTenths(current.total, earlier.total)) {
    invalid();
  }
}

/** The version 2 checks on a reply whose shared (version 1) fields have already passed. */
export function checkVersion2(reply: AskVaultSnapshotV2, request: AskVaultRequestV2, roster?: AskFamilyMember[]): void {
  reply.periods.forEach((result) => {
    checkCategoryTotals(result, request);
    checkMemberTotals(result, request, roster);
    checkMonths(result, request, reply.asOf);
    checkAverage(result, request);
  });
  if (reply.earliestRecord !== null && reply.earliestRecord > reply.asOf) invalid();
  checkComparison(reply, request);
}
