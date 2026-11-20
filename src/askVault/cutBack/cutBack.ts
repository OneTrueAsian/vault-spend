import { addMoney, averageToCents, compareMoney, formatMoney, percentChangeTenths, subtractMoney } from "../common/money";
import type { ReportBudgetLine } from "../../shared/lib/types";

/**
 * "Where can I save money?" and "What can I cut back on?": an open question with no amount. The answer is a short set of
 * facts from the person's own records (over budget this month, higher than usual last month, the biggest flexible spending),
 * never a recommendation of what is safe to cut. Each flexible category offers a what-if the person can edit and ask.
 */

const normalize = (text: string) => text.normalize("NFC").toLocaleLowerCase("en-US").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

const WHO = "(?:i|we)";
/** Saving in general, never on one named thing: "save money", "cut back", "cut down", "cut costs", "spend less", "reduce my spending". */
const ACTION = "(?:save\\s+(?:some\\s+)?money|cut\\s+(?:back|down)|cut\\s+costs|spend\\s+less|reduce\\s+(?:my\\s+|our\\s+)?(?:spending|expenses))";
/** An optional general object: "on my spending", "on our expenses", "in my budget". A category or store name never matches. */
const TAIL = "(?:\\s+on\\s+(?:my\\s+|our\\s+)?(?:spending|expenses))?(?:\\s+(?:in|on|from|with)\\s+(?:my|our|the)\\s+budget)?";
const QUESTIONS = [
  // Where/how can I save money? How do we spend less? Where could I cut down on my spending?
  new RegExp(`^(?:where|how)\\s+(?:can|could|should|do)\\s+${WHO}\\s+${ACTION}${TAIL}$`),
  // What can I cut back on?
  new RegExp(`^what\\s+(?:can|could)\\s+${WHO}\\s+cut(?:\\s+(?:back|down))?(?:\\s+on)?${TAIL}$`),
  // What can I do to save money?
  new RegExp(`^what\\s+(?:can|could|should)\\s+${WHO}\\s+do\\s+to\\s+${ACTION}${TAIL}$`),
  // Help me spend less. Help us cut back on our spending.
  new RegExp(`^(?:can\\s+you\\s+)?help\\s+(?:me|us)\\s+${ACTION}${TAIL}$`),
  // Where am I overspending?
  /^where\s+(?:am\s+i|are\s+we)\s+overspending$/,
];

/** True only for a whole open question about where to cut back. Anything with an amount, a category or other conditions belongs to another reader. */
export function isCutBackQuestion(text: string): boolean {
  if (text.length > 200) return false;
  const question = normalize(text).replace(/^please[,\s]+/, "").replace(/[?.!\s]+$/, "");
  return QUESTIONS.some(pattern => pattern.test(question));
}

type YearMonth = { year: number; month: number };
const key = ({ year, month }: YearMonth) => `${year}-${String(month).padStart(2, "0")}`;
const back = (from: YearMonth, months: number): YearMonth => {
  const index = from.year * 12 + (from.month - 1) - months;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

/** The four full calendar months before the month of `today`, oldest first. */
export function cutBackMonths(today: string) {
  const current = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const months = [4, 3, 2, 1].map(n => back(current, n));
  return { from: months[0], to: months[3], labels: months.map(key) };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (label: string) => MONTH_NAMES[Number(label.slice(5, 7)) - 1];
const span = (labels: string[]) => `${monthName(labels[0])} to ${monthName(labels[labels.length - 1])}`;

/** A tenth of a usual month, to the nearest $5 and at least $5: a starting point the person edits, not a recommendation. */
export function suggestedCut(usual: string): string {
  const cents = BigInt(averageToCents(usual, 10).replace(".", ""));
  const fives = (cents + 250n) / 500n;
  return String((fives < 1n ? 1n : fives) * 5n);
}

export type CutBackRow = { category: string; amount: string; detail: string; tryQuestion: string | null };
export type CutBackSection = { id: "over-budget" | "above-usual" | "biggest"; heading: string; rows: CutBackRow[] };
export type CutBackAnswer = { headline: string; sections: CutBackSection[]; notes: string[] };

/** Groups whose spending is not something a person trims month to month. */
const NOT_FLEXIBLE = new Set(["fixed", "income", "nonmonthly"]);
const LIST_LIMIT = 5;
const UNCATEGORIZED = "Uncategorized";

export function buildCutBackAnswer({ today, cells, actuals }: {
  today: string;
  /** Spending per category per month (positive amounts) for the four months from `cutBackMonths`. */
  cells: { month: string; category: string; amount: string }[];
  /** This month's budget lines. */
  actuals: ReportBudgetLine[];
}): CutBackAnswer {
  const { labels } = cutBackMonths(today);
  const groupOf = new Map(actuals.map(line => [line.category, line.budget_group]));
  const flexible = (category: string) => !NOT_FLEXIBLE.has(groupOf.get(category) ?? "flexible");
  const spent = new Map<string, Map<string, string>>();
  for (const cell of cells) {
    if (!labels.includes(cell.month) || compareMoney(cell.amount, "0") <= 0) continue;
    const months = spent.get(cell.category) ?? new Map<string, string>();
    months.set(cell.month, addMoney(months.get(cell.month) ?? "0", cell.amount));
    spent.set(cell.category, months);
  }
  const recorded = labels.every(month => [...spent.values()].some(months => months.has(month)));
  const total = (category: string, months: string[]) => months.reduce((sum, month) => addMoney(sum, spent.get(category)?.get(month) ?? "0"), "0");
  const sections: CutBackSection[] = [];

  const over = actuals
    .filter(line => line.budget_group !== "income" && line.budget_group !== "fixed" && compareMoney(line.budgeted, "0") > 0)
    .map(line => ({ line, limit: addMoney(line.budgeted, line.rollover_enabled ? line.rollover : "0") }))
    .filter(({ line, limit }) => compareMoney(line.actual, limit) > 0)
    .map(({ line, limit }) => ({ line, overage: subtractMoney(line.actual, limit), limit }))
    .sort((a, b) => compareMoney(b.overage, a.overage) || a.line.category.localeCompare(b.line.category));
  if (over.length) sections.push({ id: "over-budget", heading: "Over budget this month", rows: over.map(({ line, overage, limit }) => ({
    category: line.category, amount: formatMoney(line.actual), detail: `${formatMoney(overage)} over its ${formatMoney(limit)} budget so far`, tryQuestion: null,
  })) });

  if (recorded) {
    const earlier = labels.slice(0, 3), last = labels[3];
    const above = [...spent.keys()].filter(flexible).flatMap(category => {
      const latest = total(category, [last]), usual = averageToCents(total(category, earlier), 3);
      const increase = subtractMoney(latest, usual);
      // A category with nothing in the usual months is a one-off, not a habit that grew.
      if (compareMoney(usual, "0") <= 0 || compareMoney(increase, "25") < 0 || Number(percentChangeTenths(latest, usual)) < 20) return [];
      return [{ category, increase, row: {
        category, amount: formatMoney(latest), tryQuestion: null, detail: `About ${formatMoney(usual)} in a usual month (${span(earlier)})`,
      } }];
    }).sort((a, b) => compareMoney(b.increase, a.increase) || a.category.localeCompare(b.category)).slice(0, LIST_LIMIT);
    if (above.length) sections.push({ id: "above-usual", heading: `Higher than usual in ${monthName(last)}`, rows: above.map(a => a.row) });

    const recent = labels.slice(1);
    const biggest = [...spent.keys()].filter(flexible)
      .map(category => ({ category, usual: averageToCents(total(category, recent), 3) }))
      .filter(({ usual }) => compareMoney(usual, "0") > 0)
      .sort((a, b) => compareMoney(b.usual, a.usual) || a.category.localeCompare(b.category))
      .slice(0, LIST_LIMIT);
    if (biggest.length) sections.push({ id: "biggest", heading: "Your biggest flexible spending", rows: biggest.map(({ category, usual }) => ({
      category, amount: formatMoney(usual),
      detail: `A month on average, ${span(recent)}${groupOf.has(category) ? "" : ". No budget line"}`,
      tryQuestion: category === UNCATEGORIZED ? null : `What if I cut ${category} by $${suggestedCut(usual)} a month?`,
    })) });
  }

  const notes = [
    "These are facts from your own records, not advice. Only you know which of these you can change.",
    "Categories in the Fixed and Income budget groups are left out, and non-monthly categories are left out of the month-to-month comparisons.",
    "For subscriptions and other regular bills, Recurring lists what you pay and flags price changes.",
  ];
  if (!recorded) notes.push("Record at least four full months of spending to see what was higher than usual and your biggest flexible spending.");
  return { headline: sections.length ? "Places you could look, from your own records" : "Nothing to point to yet", sections, notes };
}
