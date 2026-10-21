import type { ParseRetirementScenario, RetirementDraft, RetirementParseOutcome } from "./retirementScenarioContract";
import { validateRetirementDraft, validateRetirementRate } from "./retirementScenarioContract";
import { retirementUnsupportedMessage } from "./retirementScreenContract";
import type { UnsupportedCode } from "./retirementCorpus";
import { SAVING_LEAD, ordinaryOperatorStore, namesWholeName, wholeNamePattern } from "./savingLead";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthWords = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
const norm = (s: string) => s.normalize("NFC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
const refuse = (code: UnsupportedCode): RetirementParseOutcome => ({ kind: "retirement-unsupported", reason: retirementUnsupportedMessage(code) });
const unparsed = (): RetirementParseOutcome => ({ kind: "retirement-unsupported", reason: "I couldn't keep every part of that request. Ask about one extra monthly or one-time amount in one investment account, with a retirement month." });
function distance(a: string, b: string): number {
  const x = Array.from(norm(a)), y = Array.from(norm(b)); let row = y.map((_, i) => i + 1); row.unshift(0);
  for (let i = 0; i < x.length; i++) { const next = [i + 1]; for (let j = 0; j < y.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(x[i] !== y[j]))); row = next; }
  return row[y.length];
}

const MIXED_REASON = "That mixes spending in a category with adding money to an investment account. Ask about one at a time.";

/**
 * Bounded, consuming grammar. Every material span is interpreted, clarified or refused; no data reads or consent.
 *
 * A question that names both a recorded spending category and an investment account, and that this grammar would otherwise refuse, is
 * a clarification, never a silent choice of one of the two operations (M6 D-S3-01). Only a refusal is upgraded; every draft and every
 * other clarification is returned exactly as the grammar produced it.
 */
export const parseRetirementScenario: ParseRetirementScenario = (sourceText, context) => {
  const result = parseCore(sourceText, context, true);
  if (result?.kind !== "retirement-unsupported" || !mixesCategoryWithAccount(sourceText, context)) return result;
  return { kind: "retirement-clarify", clarification: { status: "clarify", reason: MIXED_REASON, choices: [], replacements: [] } };
};

function mixesCategoryWithAccount(sourceText: string, context: Parameters<ParseRetirementScenario>[1]): boolean {
  const accounts = Array.isArray(context?.investmentAccounts) ? context.investmentAccounts.filter(a => typeof a?.name === "string") : [];
  const categories = Array.isArray(context?.categories) ? context.categories.filter(c => typeof c === "string") : [];
  if (!accounts.length || !categories.length) return false;
  let text = norm(sourceText);
  if (!accounts.some(a => namesWholeName(text, a.name))) return false;
  // The account's own name may hold category words ("Roth" in "Roth IRA"); take the account names out first, longest first.
  for (const { name } of [...accounts].sort((a, b) => b.name.length - a.name.length)) {
    const pattern = wholeNamePattern(norm(name), "giu");
    if (pattern) text = text.replace(pattern, " ");
  }
  return categories.some(category => namesWholeName(text, category));
}

const AMOUNT_WORDS = /\$[^\s/?!]+/;
const REPLACEMENT_WORDS = /\b(?:instead|rather than|replac\w*|chang\w*|switch\w*|only|just|lower|raise|increase|decrease|reduce|cut)\b/i;
const MONTHLY_WORDS = /(?:\b(?:a|per|every|each)\s+month\b|\/month\b|\bmonthly\b)/i;
const ONCE_WORDS = /\b(?:one[ -]time|once|lump sum)\b/i;

/** The existing account slot grammar, shared by operator protection and consumption. */
function accountMention(text: string, context: Parameters<ParseRetirementScenario>[1]): RegExpExecArray | null {
  const accountPattern = /\b(?:into|to|in)\s+(?:(?:my|the)\s+)?("[^"\r\n]+"|.+?)(?=\s+(?:until|through|at|assuming|with|starting|on|now|retiring|when|using|in today's|and also|after|minus|without|add)\b|[,?!]|\.(?:\s|$)|$)/i;
  const endOfName = String.raw`(?=\s+(?:until|through|at|assuming|with|starting|on|now|retiring|when|using|in today's|and also|after|minus|without|add)\b|[,?!]|\.(?:\s|$)|$)`;
  const accounts = [...context.investmentAccounts].sort((a, b) => b.name.length - a.name.length);
  for (const connector of text.matchAll(/\b(?:into|to|in)\s+/gi)) {
    const tail = text.slice(connector.index);
    let named: RegExpExecArray | null = null;
    for (const { name } of accounts) {
      const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      named = new RegExp(String.raw`^(?:into|to|in)\s+(?:(?:my|the)\s+)?(` + escaped + `)` + endOfName, "i").exec(tail);
      if (named) break;
    }
    const candidate = named ?? accountPattern.exec(tail);
    if (candidate && candidate.index === 0 && (named !== null || !/^\$|^(?:\d+ years|retirement(?:\s|$)|retire\b|today|extra\b|add\b)/i.test(candidate[1]))) {
      candidate.index = connector.index;
      return candidate;
    }
  }
  return null;
}

function parseCore(sourceText: string, context: Parameters<ParseRetirementScenario>[1], allowLead: boolean): RetirementParseOutcome {
  if (ordinaryOperatorStore(sourceText, context)) return null;
  const outside = sourceText.replace(/"[^"\r\n]*"/g, q => " ".repeat(q.length));
  // Quoted names are protected from operator matching, but still identify this question's family.
  const investmentName = Array.isArray(context?.investmentAccounts) && context.investmentAccounts.some(a => typeof a?.name === "string" && namesWholeName(sourceText, a.name));
  const retirement = /\b(?:retire|retiring|retirement|401k|ira|brokerage|investment|employer match)\b/i.test(outside);
  const extra = /\b(?:extra|additional|add|saved?|saving|put|deposit|contribute|one[ -]time)\b/i.test(outside);
  const scenarioStart = /^\s*(?:an?\s+)?(?:extra|additional)\b/i.test(outside);
  if ((!retirement && !investmentName && !scenarioStart) || (!extra && !/\b(?:income|enough|should|smart)\b/i.test(outside))) return null;
  if ([...sourceText].length > 512) return refuse("question-too-long");
  if ((sourceText.match(/"/g)?.length ?? 0) % 2 !== 0) return unparsed();
  const empty: RetirementDraft = { sourceText, accountId: null, extra: { kind: null, amount: null }, startDate: context?.today, retirementMonth: null, assumptions: { annualReturnPct: null, inflationPct: null }, missing: ["account", "extra-amount", "cadence", "retirement-month"], hints: [] };
  if (!validateRetirementDraft(empty, context).ok) return unparsed();
  let work = sourceText;
  const erase = (start: number, end: number) => { work = work.slice(0, start) + " ".repeat(end - start) + work.slice(end); };
  const consume = (re: RegExp): RegExpExecArray | null => { const m = re.exec(work); if (m) erase(m.index, m.index + m[0].length); return m; };
  const hint = (field: RetirementDraft["hints"][number]["field"], start: number, end: number) => empty.hints.push({ field, text: sourceText.slice(start, end), start, end });
  const clarify = (reason: string, choices: { label: string; replacement: string }[]): RetirementParseOutcome => ({ kind: "retirement-clarify", clarification: { status: "clarify", reason, choices: choices.map(c => c.label), replacements: choices.map(c => c.replacement) } });
  // "Save $50 a month into my Roth IRA": saving is not necessarily extra money. Unless the money is stated to be extra or additional, ask once,
  // offering the same question with only the lead-in replaced, so account, amount, cadence and dates all carry through (M6 D-S3-01).
  const lead = allowLead ? SAVING_LEAD.exec(outside) : null;
  if (lead) {
    // Protect the actual account slot, not every occurrence of every roster name.
    // An unrelated account named Extra must not erase "an extra $50 ... into Roth IRA".
    let operators = outside;
    // Blank the lead first: "want TO save" is not an account connector.
    const slot = accountMention(" ".repeat(lead[0].length) + sourceText.slice(lead[0].length), context);
    const bare = slot ? null : [...context.investmentAccounts].sort((a, b) => b.name.length - a.name.length)
      .map(a => wholeNamePattern(a.name)?.exec(outside)).find(Boolean);
    const slotName = slot ? [...context.investmentAccounts].sort((a, b) => b.name.length - a.name.length)
      .map(a => wholeNamePattern(a.name)?.exec(slot[1])).find(m => m && (m.index === 0 || (m.index === 1 && slot[1].startsWith('"')))) : null;
    // Mask only the resolved name, retaining "instead", "only", etc. after it.
    const span = slotName && slot ? { index: slot.index + slot[0].indexOf(slot[1]) + slotName.index, 0: slotName[0] } : bare;
    if (span) operators = operators.slice(0, span.index) + " ".repeat(span[0].length) + operators.slice(span.index + span[0].length);
    const after = operators.slice(lead[0].length);
    if (/\b(?:extra|additional|add)\b/i.test(after)) erase(lead.index, lead[0].length);
    else {
      // Words that make this a replacement or a total, not an addition: refused in plain words, never turned into an "extra" question.
      if (REPLACEMENT_WORDS.test(after)) return unparsed();
      const rewritten = "Extra" + sourceText.slice(lead[0].length);
      const next = parseCore(rewritten, context, false);
      // A replacement ("instead of $100", "only $50") or anything else the extra-money grammar would refuse is refused here, not asked about.
      if (next === null || next.kind === "retirement-unsupported") return next ?? unparsed();
      const amount = AMOUNT_WORDS.exec(after)?.[0].replace(/[.,;]+$/, "");
      const cadence = MONTHLY_WORDS.test(after) ? " a month" : ONCE_WORDS.test(after) ? " one time" : "";
      const what = amount ? `an extra ${amount}${cadence}` : `extra money${cadence}`;
      return clarify(`Do you mean adding ${what} to this account?`, [{ label: `Yes, add ${what}`, replacement: rewritten }]);
    }
  }
  const account = accountMention(work, context);
  if (account) {
    const raw = account[1], phrase = raw.replace(/^"|"$/g, "").trim(), local = account[0].indexOf(raw), start = account.index + local + Number(raw.startsWith('"')), end = start + phrase.length;
    const exact = context.investmentAccounts.filter(a => norm(a.name) === norm(phrase));
    if (exact.length) { empty.accountId = exact.length === 1 ? exact[0].id : null; hint("account", start, end); erase(account.index, account.index + account[0].length); }
    else {
      const replace = (value: string) => sourceText.slice(0, start) + value + sourceText.slice(end);
      const alternatives = phrase.split(/\s+or\s+/i);
      if (alternatives.length > 1 && alternatives.every(name => context.investmentAccounts.some(a => norm(a.name) === norm(name))))
        return clarify("Which one account do you mean?", alternatives.map(name => ({ label: context.investmentAccounts.find(a => norm(a.name) === norm(name))!.name, replacement: replace(name) })));
      if (!context.investmentAccounts.length) return refuse("no-investment-account");
      const close = context.investmentAccounts.filter(a => Math.abs(a.name.length - phrase.length) <= 2 && distance(a.name, phrase) <= (phrase.length >= 8 ? 2 : 1)).slice(0, 3);
      if (close.length) return clarify("Did you mean this account?", close.map(a => ({ label: a.name, replacement: replace(a.name) })));
      return refuse("account-not-found");
    }
  } else {
    const hits = context.investmentAccounts.map(a => ({ a, hit: wholeNamePattern(a.name)?.exec(outside) ?? null })).filter(x => x.hit !== null);
    const named = hits.map(x => x.a);
    const names = [...new Set(named.map(a => norm(a.name)))];
    if (names.length > 1) return refuse("multi-account");
    if (named.length) {
      const start = hits[0].hit!.index, length = hits[0].hit![0].length;
      empty.accountId = named.length === 1 ? named[0].id : null;
      hint("account", start, start + length); erase(start, start + length);
    }
  }
  consume(/\b(?:don't count|do not count|without|excluding)\s+(?:my |the )?employer match\b/i);
  const scope: [RegExp, UnsupportedCode][] = [
    [/\b(?:income|pension|social security|withdrawal income)\b/i, "income"], [/\b(?:should|enough|smart|recommend)\b/i, "advice"],
    [/\bemployer match\b/i, "employer-match"], [/\btax(?:es)?\b/i, "tax"], [/\bfees?\b/i, "fees"], [/\bcontribution limit\b/i, "contribution-limit"],
    [/\band also\b/i, "multi-account"], [/\b(?:only if|unless|except|provided that)\b/i, "condition"], [/\b(?:less|reduce|reduction)\b/i, "reduction"],
    [/\b(?:a|per|every)\s+week\b|\b(?:weekly|yearly|fortnightly|daily)\b/i, "cadence"],
  ];
  for (const [re, code] of scope) if (re.test(work)) return refuse(code);
  const amountStart = work.indexOf("$");
  if ([...work.matchAll(/\bif\b/gi)].some(m => amountStart >= 0 && m.index > amountStart)) return refuse("condition");
  if (!context.investmentAccounts.length) return refuse("no-investment-account");
  const money = /\$[^\s/?!]+/.exec(work);
  if (money) {
    const raw = money[0].replace(/\.$/, "");
    if (!/^\$(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return unparsed();
    if ((raw.split(".")[1]?.length ?? 0) > 2) return refuse("amount-precision");
    empty.extra.amount = raw.slice(1).replace(/,/g, ""); erase(money.index, money.index + raw.length);
  }
  if (consume(/\b(?:one[ -]time|once|lump sum)\b/i)) empty.extra.kind = "once";
  if (consume(/(?:\b(?:a|per|every|each)\s+month\b|\/month\b|\bmonthly\b)/i)) { if (empty.extra.kind !== null) return unparsed(); empty.extra.kind = "monthly"; }
  const future = consume(new RegExp("\\b(?:starting next month|starting\\s+" + monthWords + "\\s+\\d{4}|on\\s+" + monthWords + "\\s+\\d{1,2}\\s+\\d{4})", "i"));
  if (future) {
    empty.startDate = null;
    const dated = /^on\s+([a-z]+)\s+(\d{1,2})\s+(\d{4})$/i.exec(future[0]);
    if (dated) {
      const month = MONTHS.findIndex(m => m.startsWith(dated[1].toLowerCase())) + 1;
      const date = `${dated[3]}-${String(month).padStart(2, "0")}-${dated[2].padStart(2, "0")}`;
      const time = new Date(date + "T00:00:00Z");
      if (Number.isNaN(time.getTime()) || time.toISOString().slice(0, 10) !== date || date < "1900-01-01" || date > "2100-12-31")
        return { kind: "retirement-unsupported", reason: "That start date is not a valid supported date. This preview can start today." };
      if (date < context.today) return { kind: "retirement-unsupported", reason: "That start date has already passed. This preview can start today." };
      if (date === context.today) empty.startDate = context.today;
    }
    hint("start-date", future.index, future.index + future[0].length);
  }
  const schedule = new RegExp("\\b(?:until|through|retiring|when I retire)\\s+(?:in\\s+)?(" + monthWords + "(?:\\s+\\d{4})?|\\d{4}-\\d{2}|\\d{4}|my retirement date|in \\d+ years)", "i").exec(work);
  if (schedule) {
    const phrase = schedule[1], start = schedule.index + schedule[0].lastIndexOf(phrase); let month: string | null = null;
    const named = new RegExp("^(" + monthWords + ")(?:\\s+(\\d{4}))?$", "i").exec(phrase);
    if (named) {
      const number = MONTHS.findIndex(m => m.startsWith(named[1].toLowerCase())) + 1;
      if (!named[2]) {
        let year = Number(context.today.slice(0, 4)) + Number(number < Number(context.today.slice(5, 7)));
        const choices: { label: string; replacement: string }[] = [];
        while (choices.length < 3 && year <= 2100) { const label = `${MONTHS[number - 1][0].toUpperCase()}${MONTHS[number - 1].slice(1)} ${year++}`; choices.push({ label, replacement: sourceText.slice(0, start) + label + sourceText.slice(start + phrase.length) }); }
        return choices.length ? clarify("Which year?", choices) : refuse("date-range");
      }
      month = `${named[2]}-${String(number).padStart(2, "0")}`;
    } else if (/^\d{4}-\d{2}$/.test(phrase)) month = phrase;
    if (month !== null) {
      const delta = (Number(month.slice(0, 4)) - Number(context.today.slice(0, 4))) * 12 + Number(month.slice(5)) - Number(context.today.slice(5, 7));
      if (delta < 0) return refuse("past-date");
      if (month > "2100-12" || delta > 1200 || !/-(?:0[1-9]|1[0-2])$/.test(month)) return refuse("date-range");
    }
    empty.retirementMonth = month; hint("retirement-month", start, start + phrase.length); erase(schedule.index, schedule.index + schedule[0].length);
  }
  const rates = [
    { regex: /(-?\d+(?:\.\d+)?%\s+inflation)\b/i, field: "inflation" as const, key: "inflationPct" as const },
    { regex: /(-?\d+(?:\.\d+)?%(?:\s+a year)?|no growth)/i, field: "return" as const, key: "annualReturnPct" as const },
  ];
  for (const { regex, field, key } of rates) {
    const m = consume(regex); if (!m) continue;
    const value = /^no growth$/i.test(m[0]) ? "0" : m[0].match(/^-?\d+(?:\.\d+)?/)![0];
    if (!validateRetirementRate(value, field === "inflation" ? "saved" : "preview").ok) return refuse("rate-out-of-range");
    empty.assumptions[key] = value; hint(field, m.index, m.index + m[0].length);
  }
  const todayDollars = consume(/today['’]s dollars/i);
  if (todayDollars) hint("inflation", todayDollars.index, todayDollars.index + todayDollars[0].length);
  consume(/\busing my saved plan\b/i);
  work = work.replace(/\b(?:how much would|what if|would|how much|my|the|an|a|i|if|balance|increase|saved|save|extra|additional|add|put|deposit|contribute|for|retirement|now|assuming|return|with|at|in)\b/gi, " ").replace(/\bfifty dollars\b/gi, " ").replace(/[\s,.?!]+/g, "");
  if (work) return unparsed();
  empty.missing = [];
  if (empty.accountId === null) empty.missing.push("account");
  if (empty.extra.amount === null) empty.missing.push("extra-amount");
  if (empty.extra.kind === null) empty.missing.push("cadence");
  if (empty.startDate === null) empty.missing.push("start-date");
  if (empty.retirementMonth === null) empty.missing.push("retirement-month");
  empty.hints.sort((a, b) => a.start - b.start);
  return validateRetirementDraft(empty, context).ok ? { kind: "retirement", draft: empty } : unparsed();
}
