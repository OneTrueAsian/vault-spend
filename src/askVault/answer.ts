import type { AskPeriodResult, AskVaultSnapshot } from "./contract";
import { dayLabel } from "./dates";
import { compareMoney, formatMoney } from "./money";
import type { Interpretation } from "./types";

export type AnswerRow = { label: string; amount: string; detail: string };
export type AskVaultAnswer = {
  headline: string;
  /** One line under the headline: how many purchases and which dates. */
  detail: string;
  /** Ranked results, or one line per store when several were asked about. */
  rows: AnswerRow[];
  /** The recorded names a store question matched, e.g. "SAMS CLUB #6482 (5 purchases)". Empty otherwise. */
  matches: string[];
  notes: string[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const longDate = dayLabel;
const listNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

function rangeText(from: string, to: string): string {
  if (from === to) return longDate(from);
  const start = from.slice(0, 4) === to.slice(0, 4) ? longDate(from).replace(/, \d{4}$/, "") : longDate(from);
  return `${start} to ${longDate(to)}`;
}

/** " at Meijer and Target on Groceries from Rewards Card" */
function scopeOf(interpretation: Interpretation): string {
  return (
    (interpretation.vendors.length ? ` at ${listNames(interpretation.vendors)}` : "") +
    (interpretation.category ? ` on ${interpretation.category}` : "") +
    (interpretation.accountName ? ` from ${interpretation.accountName}` : "")
  );
}

function leftOutNames(interpretation: Interpretation): string[] {
  return [...interpretation.excludedVendors, ...interpretation.excludedCategories];
}

/** ", excluding Costco and Rent," or nothing. Commas included so it sits between the subject and the period. */
function excludingPhrase(interpretation: Interpretation): string {
  const names = leftOutNames(interpretation);
  return names.length ? `, excluding ${listNames(names)},` : "";
}

/** "in August 2026", or "since your records begin" when no period was named. */
function whenText(interpretation: Interpretation): string {
  const p = interpretation.periods[0];
  if (p.allRecords) return "since your records begin";
  if (p.label === "today" || p.label === "yesterday" || p.label.startsWith("since ")) return p.label;
  if (/^[A-Z][a-z]+ \d+ to /.test(p.label)) return `from ${p.label}`;
  if (/^[A-Z][a-z]+ \d+, \d{4}$/.test(p.label)) return `on ${p.label}`;
  return `in ${p.label}`;
}

function thresholdNote(interpretation: Interpretation): string[] {
  const t = interpretation.minimumPurchase;
  if (!t) return [];
  const word = t.inclusive ? `of at least ${formatMoney(t.amount)}` : `over ${formatMoney(t.amount)}`;
  return [`Only purchases ${word} are included. The whole purchase is tested, even when it is split across categories.`];
}

function leftOutNote(interpretation: Interpretation, result: AskPeriodResult): string[] {
  const names = leftOutNames(interpretation);
  if (names.length === 0) return [];
  const out = result.leftOut;
  if (out.purchaseCount === 0) return [`Nothing matched what you asked to leave out (${listNames(names)}).`];
  const items = [
    ...out.vendors.map((v) => `${v.description} (${plural(v.purchaseCount, "purchase")})`),
    ...out.categories.map((c) => `${c.category ?? "No category"} (${formatMoney(c.amount)})`),
  ];
  return [`Left out as you asked: ${items.join(", ")}. That was ${formatMoney(out.total)} across ${plural(out.purchaseCount, "purchase")}.`];
}

function matchLines(result: AskPeriodResult): string[] {
  if (result.vendors.length === 0) return [];
  const lines = result.vendors.map((v) => `${v.description} (${plural(v.purchaseCount, "purchase")})`);
  const more = result.vendorNameCount - result.vendors.length;
  return more > 0 ? [...lines, `and ${more} more ${more === 1 ? "name" : "names"}`] : lines;
}

const NOT_COUNTED = "Refunds and transfers between your accounts are not counted.";

function historyNote(interpretation: Interpretation, periods: AskPeriodResult[]): string[] {
  const start = interpretation.earliestRecord;
  if (!start || !periods.some((p) => p.from < start && p.to >= start)) return [];
  return [`Your records start on ${longDate(start)}, so the earlier part of this period has no data.`];
}

function storeRows(interpretation: Interpretation, result: AskPeriodResult): AnswerRow[] {
  if (interpretation.vendors.length < 2) return [];
  return result.vendorTotals.map((line, i) => ({
    label: interpretation.vendors[i] ?? line.term,
    amount: formatMoney(line.total),
    detail: line.purchaseCount === 0 ? "no purchases" : plural(line.purchaseCount, "purchase"),
  }));
}

function baseNotes(interpretation: Interpretation, result: AskPeriodResult): string[] {
  return [...thresholdNote(interpretation), ...leftOutNote(interpretation, result), NOT_COUNTED];
}

function totalAnswer(interpretation: Interpretation, result: AskPeriodResult): AskVaultAnswer {
  const empty = result.purchaseCount === 0;
  const excluding = excludingPhrase(interpretation);
  const subject = interpretation.vendors.length || interpretation.category ? scopeOf(interpretation) : ` on everything${scopeOf(interpretation)}`;
  const headline = empty
    ? `No spending found${scopeOf(interpretation)}${excluding} ${whenText(interpretation)}.`
    : `You spent ${formatMoney(result.total)}${subject}${excluding} ${whenText(interpretation)}.`;
  return {
    headline,
    detail: `${plural(result.purchaseCount, "purchase")} · ${rangeText(result.from, result.to)}`,
    rows: storeRows(interpretation, result),
    matches: matchLines(result),
    notes: baseNotes(interpretation, result),
  };
}

function categoryAnswer(interpretation: Interpretation, result: AskPeriodResult): AskVaultAnswer {
  const store = interpretation.vendors.length ? ` at ${listNames(interpretation.vendors)}` : "";
  const excluding = excludingPhrase(interpretation);
  if (result.purchaseCount === 0) {
    return {
      headline: `No spending found${scopeOf(interpretation)}${excluding} ${whenText(interpretation)}.`,
      detail: rangeText(result.from, result.to),
      rows: [],
      matches: [],
      notes: baseNotes(interpretation, result),
    };
  }
  const limit = interpretation.limit ?? result.categories.length;
  return {
    headline:
      limit === 1
        ? `Your biggest spending category${store}${excluding} ${whenText(interpretation)}`
        : `Your top ${limit} spending categories${store}${excluding} ${whenText(interpretation)}`,
    detail: `${result.categories.length} of ${plural(result.categoryCount, "category", "categories")} · ${rangeText(result.from, result.to)}`,
    rows: result.categories.map((row) => ({
      label: row.category ?? "No category",
      amount: formatMoney(row.amount),
      detail: plural(row.purchaseCount, "purchase"),
    })),
    matches: matchLines(result),
    notes: baseNotes(interpretation, result),
  };
}

function purchaseAnswer(interpretation: Interpretation, result: AskPeriodResult): AskVaultAnswer {
  const store = interpretation.vendors.length ? ` at ${listNames(interpretation.vendors)}` : "";
  const excluding = excludingPhrase(interpretation);
  if (result.purchaseCount === 0) {
    return {
      headline: `No spending found${scopeOf(interpretation)}${excluding} ${whenText(interpretation)}.`,
      detail: rangeText(result.from, result.to),
      rows: [],
      matches: [],
      notes: baseNotes(interpretation, result),
    };
  }
  const limit = interpretation.limit ?? result.purchases.length;
  return {
    headline:
      limit === 1
        ? `Your biggest purchase${store}${excluding} ${whenText(interpretation)}`
        : `Your ${limit} biggest purchases${store}${excluding} ${whenText(interpretation)}`,
    detail: `${plural(result.purchaseCount, "purchase")} · ${rangeText(result.from, result.to)}`,
    rows: result.purchases.map((row) => ({
      label: row.description,
      amount: formatMoney(row.amount),
      detail: longDate(row.date) + (compareMoney(row.amount, row.parentAmount) !== 0 ? ` · part of a ${formatMoney(row.parentAmount)} purchase` : ""),
    })),
    matches: matchLines(result),
    notes: baseNotes(interpretation, result),
  };
}

function compareAnswer(interpretation: Interpretation, snapshot: AskVaultSnapshot): AskVaultAnswer {
  const [first, second] = interpretation.periods;
  const [a, b] = snapshot.periods;
  const difference = snapshot.difference ?? "0";
  const size = formatMoney(difference.replace(/^-/, ""));
  const detail =
    compareMoney(difference, "0") > 0
      ? `That is ${size} more in ${first.label}.`
      : compareMoney(difference, "0") < 0
        ? `That is ${size} less in ${first.label}.`
        : "That is the same amount in both.";
  const notes = [...thresholdNote(interpretation), ...leftOutNote(interpretation, a)];
  if (a.dayCount !== b.dayCount) {
    notes.push(`${first.label} covers ${plural(a.dayCount, "day")} and ${second.label} covers ${plural(b.dayCount, "day")}, so this is not a like-for-like comparison.`);
  }
  notes.push(NOT_COUNTED);
  return {
    headline: `You spent ${formatMoney(a.total)}${scopeOf(interpretation)}${excludingPhrase(interpretation)} in ${first.label} and ${formatMoney(b.total)} in ${second.label}.`,
    detail,
    rows: storeRows(interpretation, a),
    matches: matchLines(a),
    notes,
  };
}

/** Words for the person asking. Money is formatted from exact strings; nothing is rounded except extra decimals for display. */
export function renderAnswer(interpretation: Interpretation, snapshot: AskVaultSnapshot): AskVaultAnswer {
  const answer = build(interpretation, snapshot);
  return { ...answer, notes: [...historyNote(interpretation, snapshot.periods), ...answer.notes] };
}

function build(interpretation: Interpretation, snapshot: AskVaultSnapshot): AskVaultAnswer {
  switch (interpretation.kind) {
    case "total":
      return totalAnswer(interpretation, snapshot.periods[0]);
    case "rank-categories":
      return categoryAnswer(interpretation, snapshot.periods[0]);
    case "rank-purchases":
      return purchaseAnswer(interpretation, snapshot.periods[0]);
    case "compare":
      return compareAnswer(interpretation, snapshot);
  }
}
