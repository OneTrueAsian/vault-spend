import { date as isDate } from "../contractChecks";
import { validateScenarioIntent } from "./spendingScenarioContract";
import { distance } from "./distance";
import type { SpendingScenarioDraft, SpendingScenarioParseOutcome } from "./spendingScenarioContract";
import type { ParseContext } from "./types";

const MONTHS = "january february march april may june july august september october november december".split(" ");
const MONTH = `(?:${MONTHS.join("|")})`;
const ISO = "\\d{4}-\\d{2}-\\d{2}";
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalize = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const scenarioLanguage = (text: string) => /\b(?:what if|if (?:i|we)|cut|cutting|reduce|reduced|reducing|(?:would|could) (?:i|we) (?:save|spend))\b/.test(text)
  || /^save\s+(?:\$|\d)/.test(text) || /\b(?:spend|spent|spending)\b.*\bless\b/.test(text);
const day = (year: number, month: number, date: number) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
function monthEnd(year: number, month: number): string {
  const date = new Date("2000-01-01T00:00:00Z");
  date.setUTCFullYear(year, month, 0);
  return day(year, month, date.getUTCDate());
}

/**
 * Isolated M3 parser. Every recognized clause is consumed once; remaining material words stop
 * the scenario rather than silently weakening it. No baseline read, calculation or confirmation.
 */
export function parseSpendingScenario(text: string, context: ParseContext): SpendingScenarioParseOutcome {
  let rest = normalize(text).replace(/\.$/, "");
  const unsupported = (reason: string): SpendingScenarioParseOutcome => ({ kind: "scenario-unsupported", reason });
  const retrospective = () => unsupported("Retrospective scenarios are not supported. Try an explicitly chosen current-year what-if instead.");
  if (/\b(?:would|could)\b.*\b(?:have saved|had saved)\b/.test(rest)) return retrospective();
  if (/\b(?:did|have)\b.*\b(?:spend|spent)\b.*\bless\b/.test(rest) && /\b(?:than|compare|compared)\b/.test(rest) && !/\b(?:if|cut|reduce)\b/.test(rest)) return null;
  if (!scenarioLanguage(rest)) return null;
  if (text.length > 512) return unsupported("Keep the scenario to 512 characters or fewer.");
  if (!isDate(context.today)) return unsupported("Refresh the current date before starting a scenario.");
  if (/^(?:cut|reduce|cutting|reducing)$/.test(rest)) return unsupported("Name a category and an amount, then choose monthly or one-time savings and dates.");
  const draft: SpendingScenarioDraft = {
    sourceText: text, category: null, reduction: null, cadence: null,
    horizon: null, partialMonth: null, missing: [],
  };
  const take = (pattern: RegExp): RegExpExecArray | null => {
    const match = pattern.exec(rest);
    if (match) rest = rest.slice(0, match.index) + " " + rest.slice(match.index + match[0].length);
    return match;
  };
  const remember = (kind: "month" | "single-date" | "end-month", phrase: string, detail: { month?: number; date?: string; year?: number }) => {
    const original = new RegExp(escape(phrase).replace(/ /g, "\\s+"), "iu").exec(text);
    if (original) (draft.scheduleHints ??= []).push({ kind, text: original[0], start: original.index, end: original.index + original[0].length, ...detail });
  };
  // Date slots are recognized before unknown entity slots. A month after "in" is
  // temporal evidence, never a category typo; quoted category names remain entities.
  const namedMonth = take(new RegExp(`\\b(?:in|on) (${MONTH})(?: (\\d{4}))?\\b(?=\\s*(?:[?!.]|$)|\\s+(?:from|through|to|for|monthly|each|per|a month|once|starting)\\b)`));
  if (namedMonth) remember("month", namedMonth[0], { month: MONTHS.indexOf(namedMonth[1]) + 1, ...(namedMonth[2] ? { year: Number(namedMonth[2]) } : {}) });

  // Longest exact names first, before words such as "daily" or "retirement" are operators.
  // Duplicate normalized names cannot be resolved safely to one category.
  let ambiguousCategory = false;
  for (const category of [...context.categories].sort((a, b) => b.length - a.length)) {
    const name = normalize(category);
    if (!name) continue;
    const match = take(new RegExp(`(?<![\\p{L}\\p{N}])(?:"${escape(name)}"|${escape(name)})(?![\\p{L}\\p{N}])`, "u"));
    if (match) {
      if (draft.category !== null || context.categories.filter((c) => normalize(c) === name).length !== 1) {
        ambiguousCategory = true;
      }
      draft.category = category;
    }
  }
  if (!scenarioLanguage(rest.trim())) return null;
  if (ambiguousCategory) return unsupported("Choose one unambiguous category for this scenario.");
  if (/\bbudgets?\b|\bbudget limits?\b/.test(rest)) return unsupported("Budget limits and spending are different. This preview models lower spending, not a change to your budget limit. Ask explicitly about spending instead.");
  let unknownCategory: { raw: string; start: number; end: number } | null = null;
  if (!draft.category) {
    // Recognize a subject slot, not arbitrary leftover words. The remainder still has
    // to pass every scope/amount/date check before any replacements are offered.
    const subjectMatch = (input: string) => /\b(?:cut|reduce|reduced|reducing)\s+([\p{L}][\p{L}' -]*?)\s+by\b/iu.exec(input)
      ?? /\b(?:on|in)\s+([\p{L}][\p{L}' -]*?)(?=\s+(?:from|starting|for|monthly|each|per|a month)\b|$)/iu.exec(input);
    const subject = subjectMatch(rest);
    if (subject) {
      const raw = subject[1].trim();
      if (/\b(?:for|on|at|and|or|not|without|except|excluding|before|after|unless|if)\b/.test(raw)) return unsupported(`Choose one category without the condition "${raw}". Member, account and store filters are not supported for scenarios.`);
      const original = subjectMatch(text.replace(/[‘’]/g, "'"));
      if (!original) return unsupported("Choose an existing category and ask again with the full schedule.");
      const prefix = /^\S+\s+/u.exec(original[0])![0].length;
      const originalStart = original.index + prefix;
      unknownCategory = { raw, start: originalStart, end: originalStart + original[1].length };
      const start = subject.index + /^\S+\s+/u.exec(subject[0])![0].length;
      rest = rest.slice(0, start) + " " + rest.slice(start + subject[1].length);
    }
  }
  if (!/\b(?:cut|cutting|reduce|reduced|reducing|save)\b/.test(rest) && !/\b(?:spend|spent|spending)\b.*\bless\b/.test(rest)) {
    return unsupported("State how much less you would spend, rather than a new spending total.");
  }
  if (/\b(?:weekly|daily|week|weeks|day)\b/.test(rest)) return unsupported("Weekly and daily scenarios are not supported yet. Choose a monthly or one-time cut.");
  if (/\b(?:retrospective|yesterday|last year|last month|ago)\b/.test(rest)) return retrospective();
  const scope = /\b(?:(?:at\s+[\p{L}][\p{L}\p{N}' -]*?|on\s+(?:card|account)\s+[\p{L}\p{N}' -]+?)(?=\s+(?:by|monthly|from|starting)\b|\s+\$|[?!.]?$)|for\s+[\p{L}][\p{L}' -]*?(?=\s+by\b))/iu.exec(rest);
  const knownScope = [...(context.familyMembers?.map(m => m.name) ?? context.members ?? []), ...context.accounts.map(a => a.name)]
    .map(name => new RegExp(`\\b(?:for|on|at)\\s+${escape(normalize(name))}(?![\\p{L}\\p{N}])`, "u").exec(rest)).find(Boolean);
  const scopeMatch = knownScope ?? scope;
  if (scopeMatch) {
    const label = new RegExp(escape(scopeMatch[0]).replace(/ /g, "\\s+"), "iu").exec(text)?.[0] ?? scopeMatch[0];
    return unsupported(`The scope "${label}" is not supported for scenarios yet. Choose one category across the household.`);
  }
  if (/\b(?:not|never|don't|dont|without|except|excluding|unless|instead|invest|investment|retire|retirement|apply|update|set|delete|transfer)\b/.test(rest)) {
    return unsupported("This preview cannot apply changes, model investments or ignore conditions. Ask about one category's spending cut.");
  }

  // Amounts must be explicit money or percentages, never inferred from bare date/count numbers.
  const number = "(?:[1-9]\\d{0,2}(?:,\\d{3})+|0|[1-9]\\d*)(?:\\.\\d{1,2})?";
  const amount = take(new RegExp(`(?:\\$\\s*(${number})(?![\\d,.eE])|\\b(${number})\\s*(dollars?|\\$|%|percent)(?![\\p{L}\\p{N}.]))`, "u"));
  if (amount) draft.reduction = { kind: amount[3] === "%" || amount[3] === "percent" ? "percent" : "money", amount: (amount[1] ?? amount[2]).replace(/,/g, "") };

  if (take(/\b(?:monthly|(?:each|every|per|a) month)\b/)) draft.cadence = "monthly";
  if (take(/\b(?:once|one[- ]time)\b/)) {
    if (draft.cadence) return unsupported("Choose either a monthly or a one-time cut.");
    draft.cadence = "once";
  }
  if (take(/\b(?:prorated by calendar days|prorate by calendar days|prorated|prorate)\b/)) draft.partialMonth = "prorate";

  const setRange = (from: string, to: string, hypothetical = false) => {
    draft.horizon = { kind: hypothetical ? "full-year-hypothetical" : "prospective", from, to };
  };
  const year = Number(context.today.slice(0, 4));
  let singleOnDate = false;
  let match: RegExpExecArray | null;
  if (namedMonth) {
    if (namedMonth[2]) setRange(day(Number(namedMonth[2]), MONTHS.indexOf(namedMonth[1]) + 1, 1), monthEnd(Number(namedMonth[2]), MONTHS.indexOf(namedMonth[1]) + 1));
  } else if ((match = take(/\b(?:for )?(?:all of|the full year|the whole year) (\d{4})\b/))) {
    setRange(`${match[1]}-01-01`, `${match[1]}-12-31`, Number(match[1]) <= year);
  } else if ((match = take(/\b(?:for )?(?:the )?full[- ]year hypothetical(?: for)? (\d{4})\b/))) {
    setRange(`${match[1]}-01-01`, `${match[1]}-12-31`, true);
  } else if ((match = take(new RegExp(`\\bfrom (${ISO}) (?:to|through|until) (${ISO})\\b`)))) {
    setRange(match[1], match[2]);
  } else if ((match = take(new RegExp(`\\bfrom (${MONTH}) (?:to|through|until) (${MONTH}) (\\d{4})\\b`)))) {
    setRange(day(Number(match[3]), MONTHS.indexOf(match[1]) + 1, 1), monthEnd(Number(match[3]), MONTHS.indexOf(match[2]) + 1));
  } else if ((match = take(new RegExp(`\\b(?:starting|from) (today|next month) (?:to|through|until) (${MONTH})(?: (\\d{1,2}),?)?(?: (\\d{4}))?\\b`)))) {
    const nextIndex = year * 12 + Number(context.today.slice(5, 7));
    const from = match[1] === "today" ? context.today : day(Math.floor(nextIndex / 12), nextIndex % 12 + 1, 1);
    const endYear = match[4] ? Number(match[4]) : year;
    const endMonth = MONTHS.indexOf(match[2]) + 1;
    const to = match[3] ? day(endYear, endMonth, Number(match[3])) : monthEnd(endYear, endMonth);
    if (match[4] || to >= from) setRange(from, to);
    else remember("end-month", match[0], { month: endMonth });
  } else if ((match = take(new RegExp(`\\bfrom (${ISO}) for (\\d{1,2}|six) months\\b`)))) {
    const count = match[2] === "six" ? 6 : Number(match[2]);
    if (!count || !match[1].endsWith("-01")) return unsupported("Start a counted monthly schedule on the first day of a month.");
    const index = Number(match[1].slice(0, 4)) * 12 + Number(match[1].slice(5, 7)) - 1 + count - 1;
    setRange(match[1], monthEnd(Math.floor(index / 12), index % 12 + 1));
  } else if ((match = take(new RegExp(`\\bon (${ISO}|today)\\b`)))) {
    singleOnDate = true;
    const date = match[1] === "today" ? context.today : match[1];
    setRange(date, date);
  } else if ((match = take(new RegExp(`\\bon (${MONTH}) (\\d{1,2}),? (\\d{4})\\b`)))) {
    singleOnDate = true;
    const date = day(Number(match[3]), MONTHS.indexOf(match[1]) + 1, Number(match[2]));
    setRange(date, date);
  } else if ((match = take(/\bin (\d{4})\b/))) {
    const explicitYear = Number(match[1]);
    // Current year remains ambiguous; a complete future calendar year is explicit.
    if (explicitYear > year) setRange(`${match[1]}-01-01`, `${match[1]}-12-31`);
    else if (explicitYear < year) return unsupported("Retrospective scenarios are not supported yet.");
  } else {
    // Recognize these as incomplete choices, not as a licence to guess a year or schedule.
    if (!take(/\b(?:for )?(?:(?:the rest of |the remainder of )?this year|the rest of the year)\b/) && !take(new RegExp(`\\bfrom ${MONTH} (?:to|through|until) ${MONTH}\\b`))) {
      const duration = take(/\b(?:for|over) (?:(\d{1,2}|six) months|a year)\b/);
      if (duration) {
        const count = duration[1] === undefined ? 12 : duration[1] === "six" ? 6 : Number(duration[1]);
        if (count < 1 || count > 12) return unsupported("Choose a schedule of 1 to 12 calendar months.");
        const start = take(new RegExp(`\\bstarting (next month|${MONTH})(?: (\\d{4}))?\\b`));
        if (start) {
          let startIndex: number | null = null;
          if (start[1] === "next month" && !start[2]) startIndex = year * 12 + Number(context.today.slice(5, 7));
          else if (start[1] !== "next month" && start[2]) startIndex = Number(start[2]) * 12 + MONTHS.indexOf(start[1]);
          if (startIndex !== null) {
            const endIndex = startIndex + count - 1;
            setRange(day(Math.floor(startIndex / 12), startIndex % 12 + 1, 1), monthEnd(Math.floor(endIndex / 12), endIndex % 12 + 1));
          }
        }
      }
    }
  }

  if (singleOnDate && draft.horizon && !isDate(draft.horizon.from)) return unsupported("Choose a valid calendar date.");
  if (singleOnDate && draft.cadence === "monthly" && draft.horizon && !draft.partialMonth) {
    const phrase = new RegExp(`\\bon (${ISO}|${MONTH} \\d{1,2},? \\d{4}|today)\\b`, "iu").exec(text)?.[0];
    if (phrase) remember("single-date", phrase, { date: draft.horizon.from });
    draft.horizon = null;
  }

  if (draft.cadence === "once") {
    if (draft.partialMonth || draft.reduction?.kind === "percent") return unsupported("Use one date and a fixed amount for a one-time cut.");
    draft.partialMonth = "none";
  } else if (draft.cadence === "monthly" && draft.horizon && draft.partialMonth === null) {
    const { from, to } = draft.horizon;
    if (from.endsWith("-01") && isDate(to) && to === monthEnd(Number(to.slice(0, 4)), Number(to.slice(5, 7)))) draft.partialMonth = "exclude";
  }

  // Only explicitly audited grammatical words can remain. Negation, dates, amounts, scope
  // qualifiers and unknown trailing clauses never disappear through this list.
  rest = rest.replace(/\b(?:how|much|money|would|could|will|i|we|you|save|savings|if|what|cut|cutting|reduce|reduced|reducing|spend|spent|spending|less|back|on|in|by|a|the|my|please|tell|me|category|for)\b/g, " ");
  rest = rest.replace(/[?!,"]/g, " ").replace(/\s+/g, " ").trim();
  // A final sentence period is punctuation only after all numbers have been consumed.
  if (rest === ".") rest = "";
  if (rest) return unsupported(`I couldn't account for the condition "${rest}". Use one category, a monthly or one-time amount, and explicit dates.`);
  if (!draft.category && !unknownCategory && !draft.reduction && !draft.cadence && !draft.horizon && !draft.scheduleHints?.length) return unsupported("Name a category and an amount, then choose monthly or one-time savings and dates.");

  // Validate supplied fields even while other choices are unresolved. Placeholder values
  // are used only locally to check the boundary and never escape as a completed intent.
  const candidate = {
    version: 1, category: draft.category ?? "__missing__",
    reduction: draft.reduction ?? { kind: "money", amount: "0" },
    cadence: draft.cadence ?? "monthly",
    horizon: draft.horizon ?? { kind: "prospective", from: context.today, to: context.today },
    partialMonth: draft.partialMonth ?? "prorate",
  };
  const validation = validateScenarioIntent(candidate, { asOf: context.today, categories: draft.category ? context.categories : ["__missing__"] });
  // One-time drafts without a date still need the date choice, not an invalid monthly placeholder.
  if (!validation.ok) return unsupported(validation.reason);
  if (unknownCategory) {
    // Same bounded edit-distance primitive used by ordinary entity clarification.
    // A missing close match is not permission to substitute the entire roster.
    const raw = normalize(unknownCategory.raw);
    const nameCounts = new Map<string, number>();
    for (const name of context.categories) nameCounts.set(normalize(name), (nameCounts.get(normalize(name)) ?? 0) + 1);
    const categories = raw.length < 3 ? [] : [...new Set(context.categories)]
      .filter(name => nameCounts.get(normalize(name)) === 1 && distance(raw, normalize(name), 1) <= 1)
      .sort((a, b) => normalize(a).localeCompare(normalize(b))).slice(0, 3);
    const { start, end } = unknownCategory;
    return { kind: "scenario-clarify", clarification: { status: "clarify", reason: categories.length ? `Choose the category you mean by "${unknownCategory.raw}".` : `I couldn't find a close category for "${unknownCategory.raw}". Ask again with an exact category name.`, choices: categories, replacements: categories.map(category => text.slice(0, start) + `"${category}"` + text.slice(end)) } };
  }
  if (!draft.category) draft.missing.push("category");
  if (!draft.reduction) draft.missing.push("reduction");
  if (!draft.cadence) draft.missing.push("cadence");
  if (!draft.horizon) draft.missing.push("horizon");
  if (!draft.partialMonth) draft.missing.push("partial-month");
  return { kind: "scenario", draft };
}
