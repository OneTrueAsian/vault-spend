import * as chrono from "chrono-node";
import type { Bucket, Recurring } from "./types";
import { groupOf, netWorthContribution, owedAmount } from "./accountGroups";
import { formatAmount, formatDisplayDate } from "./format";
import {
  compareQuery,
  findAccount,
  fuzzyFind,
  resolveSubject,
  runQuery,
  type DateRange,
  type Metric,
  type QaContext,
} from "./ledgerQuery";

// Re-exported so existing imports of `QaContext` from this module (e.g.
// ledgerQa.test.ts) keep working — the type itself now lives in
// ledgerQuery.ts alongside the engine that operates on it.
export type { QaContext };

export type QaResult = {
  answer: string;
  /** false means no template matched at all — `answer` is then the
   * fallback "try asking it like this" message. A question whose *shape*
   * was recognized but whose subject (category/account/bucket/period)
   * couldn't be resolved still counts as matched — a specific "I couldn't
   * find X" is more useful than the generic fallback, since the question
   * itself was understood. */
  matched: boolean;
};

export const LEDGER_QA_EXAMPLES = [
  "how much did I spend on dining out in July",
  "how much did I spend at Whole Foods",
  "what's my runway if rent goes up by $200",
  "how much do I have in checking",
  "what's my net worth",
  "what's my total debt",
  "how much do I owe on car loan",
  "how much are my subscriptions",
  "when is my next bill due",
  "how much have I saved toward vacation",
  "what's my savings rate this month",
  "compare this month to last month",
];

function match(result: RegExpMatchArray | null): RegExpMatchArray | null {
  return result;
}

// ---------------------------------------------------------------------------
// Bucket lookup — the one fuzzy-find consumer not part of the transaction
// query engine (bucket progress isn't a transaction-aggregate question),
// so it stays here reusing the shared `fuzzyFind` from ledgerQuery.ts.
function findBucket(phrase: string, buckets: Bucket[]): Bucket | null {
  return fuzzyFind(phrase, buckets, (b) => b.name);
}

const ACCOUNT_GROUP_WORDS: Record<string, string> = {
  cash: "cash",
  checking: "cash",
  savings: "cash",
  investments: "investment",
  investment: "investment",
};

// ---------------------------------------------------------------------------
// Period parsing — chrono-node handles the actual date-language understanding
// (specific dates, month names, "this/last month", relative days), but three
// common phrasings need help chrono doesn't give out of the box (verified
// empirically, not assumed): a bare 4-digit year isn't parsed as a date at
// all; "last week" resolves to a single day (same weekday, one week back)
// rather than the 7-day week; and "the past N months"/"since X" resolve to
// a single reference point rather than a range running through today.

function monthRange(year: number, month1to12: number): DateRange {
  return { from: new Date(year, month1to12 - 1, 1), to: new Date(year, month1to12, 0) };
}

function yearRange(year: number): DateRange {
  return { from: new Date(year, 0, 1), to: new Date(year, 11, 31) };
}

/** Builds a range from one chrono `start` component, at whatever
 * granularity it actually specified (day beats month beats year) — a bare
 * "July" only pins down month+year, so it becomes the whole month; "August
 * 5th" pins down a day, so it becomes that single day. */
function rangeFromComponent(component: chrono.ParsedComponents): DateRange {
  const year = component.get("year")!;
  if (component.isCertain("day")) {
    const d = component.date();
    return { from: d, to: d };
  }
  if (component.isCertain("month")) {
    return monthRange(year, component.get("month")!);
  }
  return yearRange(year);
}

export function parsePeriod(phrase: string, today: Date): DateRange | null {
  const lower = phrase.trim().toLowerCase();
  if (!lower) return null;

  const bareYear = lower.match(/^(\d{4})$/);
  if (bareYear) return yearRange(Number(bareYear[1]));

  if (lower === "this year") return yearRange(today.getFullYear());
  if (lower === "last year") return yearRange(today.getFullYear() - 1);

  if (lower === "this week" || lower === "last week") {
    const weeksBack = lower === "last week" ? 1 : 0;
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() - weeksBack * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: start, to: end };
  }

  const rolling = lower.match(/^(?:the )?(?:past|last) (\d+) (day|week|month|year)s?$/);
  if (rolling) {
    const n = Number(rolling[1]);
    const unit = rolling[2];
    const from = new Date(today);
    if (unit === "day") from.setDate(from.getDate() - n);
    else if (unit === "week") from.setDate(from.getDate() - n * 7);
    else if (unit === "month") from.setMonth(from.getMonth() - n);
    else from.setFullYear(from.getFullYear() - n);
    return { from, to: today };
  }

  const since = lower.match(/^since (.+)$/);
  if (since) {
    const parsed = chrono.parse(since[1], today, { forwardDate: false });
    if (parsed.length === 0) return null;
    return { from: rangeFromComponent(parsed[0].start).from, to: today };
  }

  const parsed = chrono.parse(phrase, today, { forwardDate: false });
  if (parsed.length === 0) return null;
  const r = parsed[0];
  if (r.end) return { from: r.start.date(), to: r.end.date() };
  return rangeFromComponent(r.start);
}

function periodLabel(phrase: string): string {
  return phrase.trim();
}

// ---------------------------------------------------------------------------
// Recurring/subscription helpers — same monthly-equivalent convention as
// the backend's own `recurring_totals` (see core/src/store.rs): a small
// mirrored multiplier table, duplicated client-side deliberately (same
// precedent as `next_occurrence`/`stepDate` elsewhere in this app) since
// this is a display-only estimate, not the source of truth.
const CADENCE_MONTHLY_MULTIPLIER: Record<string, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  annual: 1 / 12,
};

function monthlyEquivalent(r: Recurring): number {
  return Math.abs(parseFloat(r.amount)) * (CADENCE_MONTHLY_MULTIPLIER[r.cadence] ?? 1);
}

// ---------------------------------------------------------------------------
// Intents — tried in order; the first pattern to match commits to that
// intent (see QaResult.matched above for why a resolution failure still
// returns a specific message rather than falling through to the next one).

type Intent = {
  pattern: RegExp;
  handle: (m: RegExpMatchArray, ctx: QaContext) => string;
};

const INTENTS: Intent[] = [
  {
    // "how much did I spend on/in/at <subject> [in/during/since <period>]",
    // plus a handful of relative periods ("last week", "the past 3
    // months") that read naturally with no connector word at all. "in" is
    // deliberately accepted both as the subject preposition ("spend in
    // groceries") and the period connector ("in the past 2 months") — the
    // lazy subject match plus the anchored trailing clause resolve the
    // overlap correctly (verified in ledgerQa.test.ts), since there's
    // always a unique split that lets the rest of the pattern match.
    pattern:
      /how much (?:did i|have i) spen[dt] (?:on|in|at) (.+?)(?: (in|during|since) (.+)|(this week|last week|this month|last month|this year|last year|the past \d+ (?:day|week|month|year)s?|\d{4}))?$/,
    handle: (m, ctx) => {
      const subjectPhrase = m[1].trim();
      const periodPhrase = m[4] ?? (m[3] ? (m[2] === "since" ? `since ${m[3]}` : m[3]) : undefined);

      const lookup = resolveSpendQuery(subjectPhrase, periodPhrase, "sum", ctx);
      if (!lookup.ok) {
        // "how much did I spend in the past 3 months" has no real subject at
        // all — the lazy match above swallows "the past 3 months" whole as
        // `subjectPhrase` (it's a valid split point too, from the regex's
        // point of view), so category/merchant lookup fails here even
        // though the question is perfectly sensible. Once a genuine subject
        // lookup has already failed, check whether the "subject" is itself
        // a parseable period — if so, this was actually a no-subject
        // total-spend question with an "in/during/since" connector, not an
        // unrecognized category. Only tried when no *separate* period was
        // already captured, so "how much did I spend on typo this month"
        // still reports the typo, not a period reinterpretation.
        if (!periodPhrase) {
          const asPeriod = parsePeriod(subjectPhrase, ctx.today);
          if (asPeriod) {
            const result = runQuery({ metric: "sum", sign: "expense", period: asPeriod }, ctx);
            const when = periodLabel(subjectPhrase);
            return result.count > 0
              ? `You spent ${formatAmount(-result.value)} (${when}), across ${result.count} transaction${result.count === 1 ? "" : "s"}.`
              : `No spending found (${when}).`;
          }
        }
        return lookup.error;
      }
      const { subject, when, result } = lookup;
      return result.count > 0
        ? `You spent ${formatAmount(-result.value)} on ${subject.value} (${when}), across ${result.count} transaction${result.count === 1 ? "" : "s"}.`
        : `No ${subject.value} spending found (${when}).`;
    },
  },
  {
    // "how much did I spend [this month/last year/total/...]" — no
    // "on/in/at <subject>" at all, contrasting with the intent above. Kept
    // to the bare relative-period keywords (not a general chrono phrase, no
    // "in/during/since" connector) specifically so this can never swallow a
    // legitimate "spend on/in/at <category>" question — there's no wildcard
    // here that could absorb " on groceries" the way the intent above's
    // lazy subject match can, so the two patterns never compete for the
    // same input.
    pattern:
      /how much (?:did i|have i) spen[dt](?: in total| total| overall)?(?: (this week|last week|this month|last month|this year|last year|the past \d+ (?:day|week|month|year)s?|\d{4}))?$/,
    handle: (m, ctx) => {
      const periodPhrase = m[1];
      let range: DateRange | null = null;
      if (periodPhrase) {
        range = parsePeriod(periodPhrase, ctx.today);
        if (!range) return `I couldn't figure out what time period "${periodPhrase}" means.`;
      }
      const result = runQuery({ metric: "sum", sign: "expense", period: range ?? undefined }, ctx);
      const when = periodPhrase ? periodLabel(periodPhrase) : "all time";
      return result.count > 0
        ? `You spent ${formatAmount(-result.value)} in total (${when}), across ${result.count} transaction${result.count === 1 ? "" : "s"}.`
        : `No spending found (${when}).`;
    },
  },
  {
    pattern:
      /(?:what'?s|what is|what was) my average spend (?:on|for|in|at) (.+?)(?: (in|during|since) (.+)|(this week|last week|this month|last month|this year|last year|the past \d+ (?:day|week|month|year)s?|\d{4}))?$/,
    handle: (m, ctx) => {
      const subjectPhrase = m[1].trim();
      const periodPhrase = m[4] ?? (m[3] ? (m[2] === "since" ? `since ${m[3]}` : m[3]) : undefined);
      const lookup = resolveSpendQuery(subjectPhrase, periodPhrase, "avg", ctx);
      if (!lookup.ok) return lookup.error;
      const { subject, when, result } = lookup;
      return result.count > 0
        ? `Your average spend on ${subject.value} (${when}) was ${formatAmount(-result.value)}, across ${result.count} transaction${result.count === 1 ? "" : "s"}.`
        : `No ${subject.value} spending found (${when}).`;
    },
  },
  {
    pattern:
      /(?:(?:what'?s|what is|what was) my income|what my income (?:is|was)|how much income did i (?:make|have|earn))(?: (?:in|during|for|since) (.+)| (this week|last week|this month|last month|this year|last year|the past \d+ (?:day|week|month|year)s?|\d{4}))?$/,
    handle: (m, ctx) => {
      const periodPhrase = (m[1] ?? m[2])?.trim();
      const range = periodPhrase ? parsePeriod(periodPhrase, ctx.today) : monthRange(ctx.today.getFullYear(), ctx.today.getMonth() + 1);
      if (!range) return `I couldn't figure out what time period "${periodPhrase}" means.`;
      const result = runQuery({ metric: "sum", sign: "income", period: range }, ctx);
      const when = periodPhrase ? periodLabel(periodPhrase) : "this month";
      return result.count > 0
        ? `Your income for ${when} was ${formatAmount(result.value)}, across ${result.count} transaction${result.count === 1 ? "" : "s"}.`
        : `No income found for ${when}.`;
    },
  },
  {
    pattern: /runway if .+? (?:goes up|increases|were to go up|rises)(?: by)? \$?([\d,]+(?:\.\d+)?)/,
    handle: (m, ctx) => {
      const delta = parseFloat(m[1].replace(/,/g, ""));
      const avgSpend = parseFloat(ctx.avgMonthlySpend);
      const cash = ctx.accounts
        .filter((a) => groupOf(a.account_type) === "cash")
        .reduce((s, a) => s + netWorthContribution(a), 0);
      const currentRunway = avgSpend > 0 ? cash / avgSpend : null;
      const newRunway = avgSpend + delta > 0 ? cash / (avgSpend + delta) : null;
      if (currentRunway === null || newRunway === null) {
        return "I don't have enough spending history yet to estimate a runway.";
      }
      return `Right now your runway is ${currentRunway.toFixed(1)} months. If spending goes up by ${formatAmount(delta)}/mo, it'd drop to ${newRunway.toFixed(1)} months.`;
    },
  },
  {
    pattern: /how much (?:do i have|is there|is) in (.+?)$/,
    handle: (m, ctx) => {
      const phrase = m[1].trim();
      const group = ACCOUNT_GROUP_WORDS[phrase.toLowerCase()];
      if (group) {
        const total = ctx.accounts
          .filter((a) => groupOf(a.account_type) === group)
          .reduce((s, a) => s + netWorthContribution(a), 0);
        return `You have ${formatAmount(total)} in ${phrase}.`;
      }
      const account = findAccount(phrase, ctx.accounts);
      if (!account) return `I couldn't find an account matching "${phrase}".`;
      return `${account.name} has a balance of ${formatAmount(netWorthContribution(account))}.`;
    },
  },
  {
    pattern: /(?:what'?s|what is) my net worth/,
    handle: (_m, ctx) => {
      const total = ctx.accounts.reduce((s, a) => s + netWorthContribution(a), 0);
      return `Your net worth is ${formatAmount(total)}.`;
    },
  },
  {
    pattern: /(?:what'?s|what is) my (?:total )?debt|how much debt do i have/,
    handle: (_m, ctx) => {
      const total = ctx.accounts
        .filter((a) => groupOf(a.account_type) === "credit" || groupOf(a.account_type) === "loan")
        .reduce((s, a) => s + owedAmount(a), 0);
      return total > 0 ? `You owe ${formatAmount(total)} in total.` : "You have no debt in Vault Spend — nice.";
    },
  },
  {
    pattern: /how much do i owe on (.+?)$/,
    handle: (m, ctx) => {
      const account = findAccount(m[1], ctx.accounts);
      if (!account || !(groupOf(account.account_type) === "credit" || groupOf(account.account_type) === "loan")) {
        return `I couldn't find a debt account matching "${m[1].trim()}".`;
      }
      return `You owe ${formatAmount(owedAmount(account))} on ${account.name}.`;
    },
  },
  {
    pattern: /(?:how much (?:are|is)|what (?:are|is)) my (?:subscriptions|recurring bills|recurring)|how much do i spend on (?:subscriptions|recurring bills)/,
    handle: (_m, ctx) => {
      const bills = ctx.recurring.filter((r) => parseFloat(r.amount) < 0);
      if (bills.length === 0) return "No recurring bills set up yet.";
      const total = bills.reduce((s, r) => s + monthlyEquivalent(r), 0);
      return `Your recurring bills add up to about ${formatAmount(total)}/mo, across ${bills.length} recurring bill${bills.length === 1 ? "" : "s"}.`;
    },
  },
  {
    pattern: /when is my next bill due|what'?s due soon|when'?s my next bill/,
    handle: (_m, ctx) => {
      const bills = ctx.recurring.filter((r) => parseFloat(r.amount) < 0).sort((a, b) => (a.next_date < b.next_date ? -1 : 1));
      if (bills.length === 0) return "No recurring bills set up yet.";
      const next = bills[0];
      return `Your next bill is ${next.merchant} for ${formatAmount(next.amount)} on ${formatDisplayDate(next.next_date, ctx.today)}.`;
    },
  },
  {
    pattern: /how much (?:have i saved|do i have saved) (?:for|toward|towards) (.+?)$/,
    handle: (m, ctx) => bucketProgressAnswer(m[1], ctx),
  },
  {
    pattern: /how close am i to (?:my )?(.+?)$/,
    handle: (m, ctx) => bucketProgressAnswer(m[1], ctx),
  },
  {
    pattern:
      /(?:what'?s|what is) my savings rate(?: (?:in|during|for) (.+)| (this week|last week|this month|last month|this year|last year|the past \d+ (?:day|week|month|year)s?|\d{4}))?$/,
    handle: (m, ctx) => {
      const periodPhrase = (m[1] ?? m[2])?.trim();
      const range = periodPhrase ? parsePeriod(periodPhrase, ctx.today) : monthRange(ctx.today.getFullYear(), ctx.today.getMonth() + 1);
      if (!range) return `I couldn't figure out what time period "${periodPhrase}" means.`;
      const income = runQuery({ metric: "sum", sign: "income", period: range }, ctx).value;
      const expense = runQuery({ metric: "sum", sign: "expense", period: range }, ctx).value;
      if (income <= 0) return `No income found for ${periodPhrase ? periodLabel(periodPhrase) : "this month"}, so a savings rate isn't meaningful yet.`;
      const rate = ((income - expense) / income) * 100;
      return `Your savings rate for ${periodPhrase ? periodLabel(periodPhrase) : "this month"} is ${rate.toFixed(0)}% (${formatAmount(income)} income, ${formatAmount(expense)} spent).`;
    },
  },
  {
    pattern: /how does (.+?) compare (?:to|with) (.+?)$/,
    handle: (m, ctx) => compareSpendAnswer(m[1], m[2], ctx),
  },
  {
    pattern: /compare (.+?) (?:to|with|and) (.+?)$/,
    handle: (m, ctx) => compareSpendAnswer(m[1], m[2], ctx),
  },
  {
    // Same trailing period clause (preposition-led or a bare relative
    // keyword) as the main spend intent above — needed here too, since
    // "what did I spend the most on this month" has no preposition at all
    // before "this month" (the "on" belongs to the fixed "spend the most
    // on" idiom, not to the period).
    pattern:
      /(?:what(?:'?s| is| was) my (?:biggest|top|highest) spending category|what did i spend the most (?:money )?on|where did i spend the most(?: money)?)(?: (in|during|for|since) (.+)| (this week|last week|this month|last month|this year|last year|the past \d+ (?:day|week|month|year)s?|\d{4}))?$/,
    handle: (m, ctx) => {
      const periodPhrase = m[3] ?? (m[2] ? (m[1] === "since" ? `since ${m[2]}` : m[2]) : undefined);
      const range = periodPhrase ? parsePeriod(periodPhrase, ctx.today) : monthRange(ctx.today.getFullYear(), ctx.today.getMonth() + 1);
      if (!range) return `I couldn't figure out what time period "${periodPhrase}" means.`;
      const result = runQuery({ metric: "sum", sign: "expense", period: range, groupBy: "category" }, ctx);
      const when = periodPhrase ? periodLabel(periodPhrase) : "this month";
      if (!result.groups || result.groups.length === 0) return `No spending found for ${when}.`;
      const top = result.groups[0];
      return `Your biggest spending category for ${when} was ${top.label} at ${formatAmount(top.value)}, across ${top.count} transaction${top.count === 1 ? "" : "s"}.`;
    },
  },
  {
    pattern:
      /what(?:'?s| was| is) my (?:biggest|largest) (?:purchase|transaction|expense)(?: (in|during|for|since) (.+)| (this week|last week|this month|last month|this year|last year|the past \d+ (?:day|week|month|year)s?|\d{4}))?$/,
    handle: (m, ctx) => {
      const periodPhrase = m[3] ?? (m[2] ? (m[1] === "since" ? `since ${m[2]}` : m[2]) : undefined);
      let range: DateRange | null = null;
      if (periodPhrase) {
        range = parsePeriod(periodPhrase, ctx.today);
        if (!range) return `I couldn't figure out what time period "${periodPhrase}" means.`;
      }
      const result = runQuery({ metric: "max", sign: "expense", period: range ?? undefined }, ctx);
      const when = periodPhrase ? periodLabel(periodPhrase) : "all time";
      if (result.count === 0) return `No spending found (${when}).`;
      const biggest = result.matches.reduce((a, b) => (Math.abs(parseFloat(a.amount)) >= Math.abs(parseFloat(b.amount)) ? a : b));
      return `Your biggest expense (${when}) was ${biggest.description} for ${formatAmount(-Math.abs(parseFloat(biggest.amount)))} on ${formatDisplayDate(biggest.date, ctx.today)}.`;
    },
  },
  {
    pattern:
      /how many transactions (?:do i have |were there )?(?:in|for) (.+?)(?: (in|during|since) (.+)|(this week|last week|this month|last month|this year|last year|the past \d+ (?:day|week|month|year)s?|\d{4}))?$/,
    handle: (m, ctx) => {
      const subjectPhrase = m[1].trim();
      const periodPhrase = m[4] ?? (m[3] ? (m[2] === "since" ? `since ${m[3]}` : m[3]) : undefined);
      const lookup = resolveSpendQuery(subjectPhrase, periodPhrase, "count", ctx);
      if (!lookup.ok) return lookup.error;
      const { subject, when, result } = lookup;
      return `You had ${result.count} ${subject.value} transaction${result.count === 1 ? "" : "s"} (${when}).`;
    },
  },
  {
    // "did (?!i|we|you)" excludes the pronouns already owned by the main
    // spend intent above ("how much did I/have I spend...") — without this
    // guard, "how much did I spend on groceries" would also syntactically
    // match here (with "I" mistaken for a family member's name) and, if
    // this intent were ever tried first, would shadow the far more common
    // question it's not meant to touch.
    pattern:
      /how much did (?!i\b|we\b|you\b)(.+?) spen[dt](?: (in|during|since) (.+)|(this week|last week|this month|last month|this year|last year|the past \d+ (?:day|week|month|year)s?|\d{4}))?$/,
    handle: (m, ctx) => {
      const memberPhrase = m[1].trim();
      const periodPhrase = m[4] ?? (m[3] ? (m[2] === "since" ? `since ${m[3]}` : m[3]) : undefined);
      let range: DateRange | null = null;
      if (periodPhrase) {
        range = parsePeriod(periodPhrase, ctx.today);
        if (!range) return `I couldn't figure out what time period "${periodPhrase}" means.`;
      }
      const subject = resolveSubject("member", memberPhrase, ctx);
      if (!subject) return `I couldn't find a family member matching "${memberPhrase}".`;
      const result = runQuery({ metric: "sum", sign: "expense", subject, period: range ?? undefined }, ctx);
      const when = periodPhrase ? periodLabel(periodPhrase) : "all time";
      return result.count > 0
        ? `${subject.value} spent ${formatAmount(-result.value)} (${when}), across ${result.count} transaction${result.count === 1 ? "" : "s"}.`
        : `No spending found for ${subject.value} (${when}).`;
    },
  },
];

/** Shared subject/period resolution behind every "spend on/for/in/at
 * <subject> [period]" style question (total spend, average spend, and any
 * future metric of the same shape) — resolves the category/merchant and
 * the optional period once, runs the query, and hands back either the
 * result or a ready-to-return error message, so each intent's handler only
 * has to decide how to *phrase* its answer. */
type SpendLookup = { ok: true; subject: NonNullable<ReturnType<typeof resolveSubject>>; when: string; result: ReturnType<typeof runQuery> } | { ok: false; error: string };

function resolveSpendQuery(subjectPhrase: string, periodPhrase: string | undefined, metric: Metric, ctx: QaContext): SpendLookup {
  let range: DateRange | null = null;
  if (periodPhrase) {
    range = parsePeriod(periodPhrase, ctx.today);
    if (!range) return { ok: false, error: `I couldn't figure out what time period "${periodPhrase}" means.` };
  }
  const subject = resolveSubject("category", subjectPhrase, ctx) ?? resolveSubject("merchant", subjectPhrase, ctx);
  if (!subject) return { ok: false, error: `I couldn't find a category or merchant matching "${subjectPhrase}".` };
  const result = runQuery({ metric, sign: "expense", subject, period: range ?? undefined }, ctx);
  const when = periodPhrase ? periodLabel(periodPhrase) : "all time";
  return { ok: true, subject, when, result };
}

function bucketProgressAnswer(phrase: string, ctx: QaContext): string {
  const b = findBucket(phrase, ctx.buckets);
  if (!b) return `I couldn't find a goal matching "${phrase.trim()}".`;
  if (!b.target_amount) return `${b.name} has ${formatAmount(b.saved_amount)} saved (no target set).`;
  const pct = Math.min(100, Math.max(0, (parseFloat(b.saved_amount) / parseFloat(b.target_amount)) * 100));
  return `${b.name} has ${formatAmount(b.saved_amount)} saved of its ${formatAmount(b.target_amount)} target (${pct.toFixed(0)}%).`;
}

function compareSpendAnswer(phraseA: string, phraseB: string, ctx: QaContext): string {
  const rangeA = parsePeriod(phraseA, ctx.today);
  const rangeB = parsePeriod(phraseB, ctx.today);
  if (!rangeA) return `I couldn't figure out what time period "${phraseA.trim()}" means.`;
  if (!rangeB) return `I couldn't figure out what time period "${phraseB.trim()}" means.`;
  const { a, b } = compareQuery({ metric: "sum", sign: "expense" }, rangeA, rangeB, ctx);
  const diff = a.value - b.value;
  const direction = diff > 0 ? "more" : diff < 0 ? "less" : "the same amount";
  return (
    `You spent ${formatAmount(a.value)} during ${periodLabel(phraseA)} and ${formatAmount(b.value)} during ${periodLabel(phraseB)}` +
    (diff === 0 ? " — " : ` — that's ${formatAmount(Math.abs(diff))} ${direction} `) +
    `during ${periodLabel(phraseA)}.`
  );
}

/** Template-matches `question` against the shapes in `INTENTS` above, each
 * answered from data the app already has on hand — no hosted LLM call, no
 * new backend query, no network at all. An unmatched question gets a
 * fallback pointing at an example, rather than a bare "I don't understand." */
export function answerLedgerQuestion(question: string, ctx: QaContext): QaResult {
  const q = question.trim().toLowerCase().replace(/[?.!]+$/, "");

  for (const intent of INTENTS) {
    const m = match(q.match(intent.pattern));
    if (m) return { matched: true, answer: intent.handle(m, ctx) };
  }

  const example = LEDGER_QA_EXAMPLES[Math.floor(Math.random() * LEDGER_QA_EXAMPLES.length)];
  return {
    matched: false,
    answer: `I couldn't match that to a question I understand yet. Try something like: "${example}"`,
  };
}
