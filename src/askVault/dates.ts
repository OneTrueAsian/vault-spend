import type { ResolvedPeriod } from "./types";

/** Split a question into lowercase tokens. Quoted names, ISO dates, slash dates and dollar amounts stay whole. */
export function tokenize(question: string): string[] {
  const input = question.trim().replace(/[?!.]+$/, "");
  const pieces =
    input.match(
      /"[^"]*"|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:st|nd|rd|th)?|\p{L}+(?:'\p{L}+)?|[^\s]/gu,
    ) ?? [];
  return pieces.map((piece) => (piece.startsWith('"') ? piece.toLowerCase() : piece.toLowerCase().replace(/,(?=\d{3})/g, "")));
}

export type PeriodMatch =
  | { kind: "period"; period: ResolvedPeriod; consumed: number }
  | { kind: "clarify"; reason: string; choices: string[] }
  | { kind: "unsupported"; reason: string };

export const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTH_TITLE = MONTHS.map((m) => m[0].toUpperCase() + m.slice(1));
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const parts = (s: string) => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) });

function realDate(s: string): boolean {
  const { y, m, d } = parts(s);
  return y >= MIN_YEAR && y <= MAX_YEAR && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
}

function addDays(s: string, n: number): string {
  const { y, m, d } = parts(s);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Same day-of-month `n` months back, clamped to the end of a shorter month. */
function monthsBack(s: string, n: number): string {
  const { y, m, d } = parts(s);
  const total = y * 12 + (m - 1) - n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return iso(ny, nm, Math.min(d, daysIn(ny, nm)));
}

const unsupported = (reason: string): PeriodMatch => ({ kind: "unsupported", reason });

function span(from: string, end: string, today: string, label: string, calendar: boolean): PeriodMatch {
  if (from > today) return unsupported("That period has not started yet. Choose a period that has already begun.");
  const soFar = calendar && end > today;
  return { kind: "period", consumed: 0, period: { from, to: soFar ? today : end, soFar, label: soFar ? `${label} so far` : label } };
}

function monthSpan(y: number, m: number, today: string): PeriodMatch {
  if (y < MIN_YEAR || y > MAX_YEAR) return unsupported("That year is outside the dates I can use.");
  return span(iso(y, m, 1), iso(y, m, daysIn(y, m)), today, `${MONTH_TITLE[m - 1]} ${y}`, true);
}

function yearSpan(y: number, today: string): PeriodMatch {
  if (y < MIN_YEAR || y > MAX_YEAR) return unsupported("That year is outside the dates I can use.");
  return span(iso(y, 1, 1), iso(y, 12, 31), today, String(y), true);
}

function quarterSpan(y: number, q: number, today: string): PeriodMatch {
  const first = (q - 1) * 3 + 1;
  const last = first + 2;
  return span(iso(y, first, 1), iso(y, last, daysIn(y, last)), today, `${MONTH_TITLE[first - 1]} to ${MONTH_TITLE[last - 1]} ${y}`, true);
}

export function dayLabel(s: string): string {
  const { y, m, d } = parts(s);
  return `${MONTH_TITLE[m - 1]} ${d}, ${y}`;
}

function daySpan(s: string, today: string, label?: string): PeriodMatch {
  if (!realDate(s)) return unsupported("That is not a real calendar date.");
  if (s > today) return unsupported("That date has not happened yet. Choose a date on or before today.");
  return { kind: "period", consumed: 0, period: { from: s, to: s, soFar: false, label: label ?? dayLabel(s) } };
}

/** The most recent occurrence of a month that has begun, or a question when the history holds it twice. */
function bareMonthYear(m: number, today: string, historyStart?: string): number | PeriodMatch {
  const t = parts(today);
  const latest = m <= t.m ? t.y : t.y - 1;
  if (!historyStart) return latest;
  const h = parts(historyStart);
  const years: number[] = [];
  for (let y = Math.max(MIN_YEAR, h.y); y <= latest; y++) {
    if (iso(y, m, daysIn(y, m)) >= historyStart && iso(y, m, 1) <= today) years.push(y);
  }
  if (years.length > 1) {
    return { kind: "clarify", reason: "Which year did you mean?", choices: years.map((y) => `${MONTH_TITLE[m - 1]} ${y}`) };
  }
  return years.length === 1 ? years[0] : latest;
}

const isYear = (token: string | undefined) => !!token && /^\d{4}$/.test(token);
const isDayNumber = (token: string | undefined) => !!token && /^\d{1,2}(?:st|nd|rd|th)?$/.test(token);
const dayOf = (token: string) => Number(token.replace(/\D/g, ""));
const withConsumed = (m: PeriodMatch, consumed: number): PeriodMatch => (m.kind === "period" ? { ...m, consumed } : m);

/** One month-and-day written as words, e.g. "june 1" or "july 8th 2026". Returns its ISO date and token count. */
function monthDay(tokens: string[], j: number, today: string, historyStart?: string): { date: string; used: number } | PeriodMatch | null {
  const mi = MONTHS.indexOf(tokens[j] ?? "");
  if (mi < 0 || !isDayNumber(tokens[j + 1])) return null;
  const explicit = isYear(tokens[j + 2]);
  const year = explicit ? Number(tokens[j + 2]) : bareMonthYear(mi + 1, today, historyStart);
  if (typeof year !== "number") return year;
  return { date: iso(year, mi + 1, Math.min(dayOf(tokens[j + 1]), 31) > daysIn(year, mi + 1) ? 99 : dayOf(tokens[j + 1])), used: explicit ? 3 : 2 };
}

const ROLLING_UNITS: Record<string, { unit: "day" | "week" | "month" | "year"; max: number }> = {
  day: { unit: "day", max: 3660 }, days: { unit: "day", max: 3660 },
  week: { unit: "week", max: 520 }, weeks: { unit: "week", max: 520 },
  month: { unit: "month", max: 120 }, months: { unit: "month", max: 120 },
  year: { unit: "year", max: 10 }, years: { unit: "year", max: 10 },
};

/**
 * Try to read a period starting at tokens[i]. Returns null when the words are not a period.
 * Every range ends on or before `today`; a month or year still under way is "so far".
 */
export function matchPeriod(tokens: string[], i: number, today: string, historyStart?: string): PeriodMatch | null {
  let j = i;
  if (tokens[j] === "the" && ["past", "last", "month"].includes(tokens[j + 1] ?? "")) j++;
  const lead = j - i;
  const t = parts(today);
  const w = tokens[j];
  if (w === undefined) return null;

  if (w === "today") return withConsumed(daySpan(today, today, "today"), lead + 1);
  if (w === "yesterday") return withConsumed(daySpan(addDays(today, -1), today, "yesterday"), lead + 1);

  if (w === "month" && tokens[j + 1] === "before") {
    const total = t.y * 12 + (t.m - 1) - 2;
    return withConsumed(monthSpan(Math.floor(total / 12), (total % 12) + 1, today), lead + 2);
  }

  if (["year", "month", "quarter"].includes(w) && tokens[j + 1] === "to" && tokens[j + 2] === "date") {
    const match =
      w === "year"
        ? yearSpan(t.y, today)
        : w === "month"
          ? monthSpan(t.y, t.m, today)
          : quarterSpan(t.y, Math.floor((t.m - 1) / 3) + 1, today);
    return withConsumed(match, lead + 3);
  }

  if ((w === "this" || w === "last") && ["week", "month", "year", "quarter"].includes(tokens[j + 1] ?? "")) {
    const unit = tokens[j + 1];
    const back = w === "last" ? 1 : 0;
    let match: PeriodMatch;
    if (unit === "month") {
      const total = t.y * 12 + (t.m - 1) - back;
      match = monthSpan(Math.floor(total / 12), (total % 12) + 1, today);
    } else if (unit === "year") {
      match = yearSpan(t.y - back, today);
    } else if (unit === "quarter") {
      const index = t.y * 4 + Math.floor((t.m - 1) / 3) - back;
      match = quarterSpan(Math.floor(index / 4), (index % 4) + 1, today);
    } else {
      const weekday = new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay();
      const start = addDays(today, -weekday - back * 7);
      const end = addDays(start, 6);
      match = span(start, end, today, back ? `${dayLabel(start).replace(/, \d{4}$/, "")} to ${dayLabel(end)}` : "this week", true);
    }
    return withConsumed(match, lead + 2);
  }

  if ((w === "past" || w === "last") && /^\d+$/.test(tokens[j + 1] ?? "") && ROLLING_UNITS[tokens[j + 2] ?? ""]) {
    const n = Number(tokens[j + 1]);
    const { unit, max } = ROLLING_UNITS[tokens[j + 2]];
    if (n < 1 || n > max) return unsupported("Choose a recent range of at least one and no more than ten years.");
    const from = unit === "day" ? addDays(today, -n) : unit === "week" ? addDays(today, -n * 7) : monthsBack(today, unit === "month" ? n : n * 12);
    if (parts(from).y < MIN_YEAR) return unsupported("That range reaches outside the dates I can use.");
    return { kind: "period", consumed: lead + 3, period: { from, to: today, soFar: false, label: `the past ${n} ${unit}${n > 1 ? "s" : ""}` } };
  }

  if (w === "since") {
    const mi = MONTHS.indexOf(tokens[j + 1] ?? "");
    if (mi < 0) return null;
    const explicit = isYear(tokens[j + 2]);
    const year = explicit ? Number(tokens[j + 2]) : bareMonthYear(mi + 1, today, historyStart);
    if (typeof year !== "number") return year;
    const from = iso(year, mi + 1, 1);
    if (from > today) return unsupported("That month has not started yet.");
    return { kind: "period", consumed: lead + (explicit ? 3 : 2), period: { from, to: today, soFar: false, label: `since ${MONTH_TITLE[mi]} ${year}` } };
  }

  if (w === "from") {
    const first = /^\d{4}-\d{2}-\d{2}$/.test(tokens[j + 1] ?? "") ? { date: tokens[j + 1], used: 1 } : monthDay(tokens, j + 1, today, historyStart);
    if (first === null) return null;
    if ("kind" in first) return first;
    const toAt = j + 1 + first.used;
    if (tokens[toAt] !== "to") return null;
    const second = /^\d{4}-\d{2}-\d{2}$/.test(tokens[toAt + 1] ?? "") ? { date: tokens[toAt + 1], used: 1 } : monthDay(tokens, toAt + 1, today, historyStart);
    if (second === null) return null;
    if ("kind" in second) return second;
    if (!realDate(first.date) || !realDate(second.date)) return unsupported("That range includes a date that is not on the calendar.");
    if (second.date < first.date) return unsupported("The range ends before it starts.");
    if (second.date > today) return unsupported("That range ends after today.");
    const label = first.date.slice(0, 4) === second.date.slice(0, 4)
      ? `${dayLabel(first.date).replace(/, \d{4}$/, "")} to ${dayLabel(second.date)}`
      : `${dayLabel(first.date)} to ${dayLabel(second.date)}`;
    return { kind: "period", consumed: toAt + 1 + second.used - i, period: { from: first.date, to: second.date, soFar: false, label } };
  }

  if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(w)) return unsupported("I can't tell day from month in a slash date. Write it like July 8 or 2026-07-08.");
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return withConsumed(daySpan(w, today), lead + 1);

  const mi = MONTHS.indexOf(w);
  if (mi >= 0) {
    if (isDayNumber(tokens[j + 1]) && !isYear(tokens[j + 1])) {
      const day = monthDay(tokens, j, today, historyStart);
      if (day && "kind" in day) return day;
      if (day) return withConsumed(daySpan(day.date, today), lead + day.used);
    }
    if (isYear(tokens[j + 1])) return withConsumed(monthSpan(Number(tokens[j + 1]), mi + 1, today), lead + 2);
    const year = bareMonthYear(mi + 1, today, historyStart);
    if (typeof year !== "number") return year;
    return withConsumed(monthSpan(year, mi + 1, today), lead + 1);
  }

  if (w === "year" && isYear(tokens[j + 1])) return withConsumed(yearSpan(Number(tokens[j + 1]), today), lead + 2);
  if (isYear(w)) return withConsumed(yearSpan(Number(w), today), lead + 1);
  return null;
}
