import type { RetirementChoice, RetirementDraft, RetirementParseContext } from "./retirementScenarioContract";

/**
 * M5 parser corpus (prerequisite 6): frozen, versioned expectations for the future retirement parser, with the grading units,
 * gates and ledger-interaction map that define acceptance. The parser does not exist yet; each case states what it must do.
 * Provenance: the 13 original-bank entries are owner-described, AI-derived development questions kept verbatim; the supplements
 * are same-author synthetic cases. Neither is independent or unseen evidence.
 */
export const CORPUS_VERSION = "m5-corpus-v1";
const TODAY = "2026-09-06";
export type CorpusContextId = "single" | "two" | "duplicate" | "none" | "operator-name" | "accent";
export const CORPUS_CONTEXTS: Readonly<Record<CorpusContextId, RetirementParseContext>> = {
  single: { today: TODAY, investmentAccounts: [{ id: 5, name: "Roth IRA" }] },
  two: { today: TODAY, investmentAccounts: [{ id: 8, name: "Brokerage" }, { id: 5, name: "Roth IRA" }] },
  duplicate: { today: TODAY, investmentAccounts: [{ id: 5, name: "Roth IRA" }, { id: 6, name: "Roth IRA" }] },
  none: { today: TODAY, investmentAccounts: [] },
  "operator-name": { today: TODAY, investmentAccounts: [{ id: 9, name: "Save in 2050" }] },
  accent: { today: TODAY, investmentAccounts: [{ id: 11, name: "Rothé IRA" }] },
};
export type UnsupportedCode = "income" | "advice" | "employer-match" | "tax" | "fees" | "contribution-limit" | "multi-account" | "account-not-found" | "no-investment-account" | "cadence" | "reduction"
  | "condition" | "rate-out-of-range" | "past-date" | "date-range" | "question-too-long" | "amount-precision";
export const UNSUPPORTED_CODES: readonly UnsupportedCode[] = ["income", "advice", "employer-match", "tax", "fees", "contribution-limit", "multi-account", "account-not-found", "no-investment-account",
  "cadence", "reduction", "condition", "rate-out-of-range", "past-date", "date-range", "question-too-long", "amount-precision"];
export type ClarifyChoice = { label: string; replacementQuestion: string; next: { kind: "retirement"; draft: Omit<RetirementDraft, "sourceText"> } };
export type CorpusOutcome =
  | { kind: "retirement"; draft: Omit<RetirementDraft, "sourceText"> }
  /** Each choice is a complete, ready replacement question that keeps every other clause of the original, with the draft it must re-parse to. */
  | { kind: "retirement-clarify"; why: string; originalQuestion: string; choices: ClarifyChoice[] }
  | { kind: "retirement-unsupported"; reasonCode: UnsupportedCode }
  | { kind: "route-elsewhere" };
export type CorpusFamily = "monthly-extra" | "once-extra" | "return-wording" | "inflation-wording" | "account-choice" | "close-name" | "quoted-name" | "missing-choice" | "date-wording" | "future-start"
  | "unsupported-scope" | "unsupported-advice" | "interacting-clause" | "boundary" | "route-elsewhere" | "negation" | "follow-up" | "original-clarify";
export type CorpusCase = {
  id: string; family: CorpusFamily; context: CorpusContextId; text: string; expected: CorpusOutcome; provenance: "original-bank" | "supplement"; note?: string;
  original?: { id: string; expectation: string; drift: string; knownGap: boolean };
};

// ---- Draft builder: spans come from the phrases, so every hint is correct by construction. -------------------------------------------------
type Spec = {
  account?: [number | null, string]; kind?: "monthly" | "once"; amount?: string; month?: [string | null, string]; futureStart?: string;
  ret?: [string, string]; infl?: [string | null, string];
};
function draftOf(text: string, spec: Spec): Omit<RetirementDraft, "sourceText"> {
  const hints: RetirementDraft["hints"] = [];
  const hint = (field: RetirementDraft["hints"][number]["field"], phrase: string) => {
    const start = text.indexOf(phrase); if (start < 0 || text.indexOf(phrase, start + 1) >= 0) throw new Error(`Corpus phrase must appear exactly once: ${phrase} in ${text}`);
    hints.push({ field, text: phrase, start, end: start + phrase.length });
  };
  if (spec.account) hint("account", spec.account[1]);
  if (spec.month) hint("retirement-month", spec.month[1]);
  if (spec.futureStart) hint("start-date", spec.futureStart);
  if (spec.ret) hint("return", spec.ret[1]);
  if (spec.infl) hint("inflation", spec.infl[1]);
  hints.sort((a, b) => a.start - b.start);
  const accountId = spec.account?.[0] ?? null, startDate = spec.futureStart ? null : TODAY, retirementMonth = spec.month?.[0] ?? null;
  const missing: RetirementChoice[] = [];
  if (accountId === null) missing.push("account");
  if (spec.amount === undefined) missing.push("extra-amount");
  if (spec.kind === undefined) missing.push("cadence");
  if (startDate === null) missing.push("start-date");
  if (retirementMonth === null) missing.push("retirement-month");
  return { accountId, extra: { kind: spec.kind ?? null, amount: spec.amount ?? null }, startDate, retirementMonth, assumptions: { annualReturnPct: spec.ret?.[0] ?? null, inflationPct: spec.infl?.[0] ?? null }, missing, hints };
}

const cases: CorpusCase[] = [];
const add = (family: CorpusFamily, context: CorpusContextId, text: string, expected: CorpusOutcome, extra: Partial<CorpusCase> = {}) => {
  cases.push({ id: `m5c-${String(cases.length + 1).padStart(3, "0")}`, family, context, text, expected, provenance: "supplement", ...extra });
};
const draft = (family: CorpusFamily, context: CorpusContextId, text: string, spec: Spec, extra: Partial<CorpusCase> = {}) => add(family, context, text, { kind: "retirement", draft: draftOf(text, spec) }, extra);
const unsupported = (family: CorpusFamily, context: CorpusContextId, text: string, reasonCode: UnsupportedCode, extra: Partial<CorpusCase> = {}) => add(family, context, text, { kind: "retirement-unsupported", reasonCode }, extra);
/** `replace` swaps the ambiguous phrase for the chosen one, so the replacement question keeps every other clause; `spec` describes the draft that question must re-parse to. */
const clarify = (family: CorpusFamily, context: CorpusContextId, text: string, why: string, choices: { label: string; replace: [string, string]; spec: Spec }[], extra: Partial<CorpusCase> = {}) => {
  const ready = choices.map(({ label, replace: [from, to], spec }): ClarifyChoice => {
    const start = text.indexOf(from); if (start < 0 || text.indexOf(from, start + 1) >= 0) throw new Error(`Clarification phrase must appear exactly once: ${from} in ${text}`);
    const replacementQuestion = text.replace(from, to);
    return { label, replacementQuestion, next: { kind: "retirement", draft: draftOf(replacementQuestion, spec) } };
  });
  add(family, context, text, { kind: "retirement-clarify", why, originalQuestion: text, choices: ready }, extra);
};
const elsewhere = (family: CorpusFamily, context: CorpusContextId, text: string, extra: Partial<CorpusCase> = {}) => add(family, context, text, { kind: "route-elsewhere" }, extra);
const original = (id: string, expectation: string, drift: string, knownGap = false) => ({ provenance: "original-bank" as const, original: { id, expectation, drift, knownGap } });
const ROTH: [number, string] = [5, "Roth IRA"], JUNE50: [string, string] = ["2050-06", "June 2050"];

// ---- The 13 original-bank entries, verbatim, with the drift between the 2026-10-14 expectation and the current scope. ----------------------------
draft("monthly-extra", "single", "How much would my Roth IRA balance increase if I saved an extra $50 per month until June 2050, assuming 6% a year",
  { account: ROTH, kind: "monthly", amount: "50", month: JUNE50, ret: ["6", "6% a year"] },
  original("m5-retire-01", "answer", "Originally an immediate answer. Now an interpretation that must pass the saved-plan review card and explicit consent before any result; the 6% is a candidate, not consent."));
elsewhere("follow-up", "single", "What about $100 instead?",
  { ...original("m5-retire-02", "answer", "Originally a follow-up that changes only the contribution. Retirement follow-ups are outside the first M5 scope, so the question falls through to the older routes. Counted as an original-bank miss, not relabelled unsupported.", true), note: "known scope gap" });
draft("return-wording", "single", "extra $100 per month into my Roth IRA until June 2050 at 7%", { account: ROTH, kind: "monthly", amount: "100", month: JUNE50, ret: ["7", "7%"] },
  original("m5-retire-03", "answer", "Originally an immediate answer. Now an interpretation plus review and consent; 7% is a typed candidate that must be confirmed as an explicit assumption."));
draft("once-extra", "single", "what if I add a one-time $5,000 to my Roth IRA now, retiring June 2050 at 6%", { account: ROTH, kind: "once", amount: "5000", month: JUNE50, ret: ["6", "6%"] },
  original("m5-retire-04", "answer", "Originally startMonth 2026-10 (next month). The supported start is today (month zero); 'now' agrees. Result still needs review and consent."));
draft("return-wording", "single", "extra $50 a month into the Roth IRA until June 2050 with no growth", { account: ROTH, kind: "monthly", amount: "50", month: JUNE50, ret: ["0", "no growth"] },
  original("m5-retire-05", "answer", "Originally a zero-return answer. Now an interpretation with a 0% candidate; the no-growth illustration is always shown, and consent is still required."));
draft("monthly-extra", "single", "an extra $200 per month in my Roth IRA until June 2050 at 5%", { account: ROTH, kind: "monthly", amount: "200", month: JUNE50, ret: ["5", "5%"] },
  original("m5-retire-06", "answer", "Originally an immediate answer. Now an interpretation plus review and consent."));
draft("original-clarify", "single", "how much would my retirement increase if I saved an extra $50", { amount: "50" },
  original("m5-retire-07", "clarify", "Originally clarify cadence. Now a draft whose missing account, cadence and retirement month are separate explicit choices; nothing is assumed."));
draft("original-clarify", "single", "how much would my retirement balance increase if I saved an extra $50 per month", { kind: "monthly", amount: "50" },
  original("m5-retire-08", "clarify", "Originally clarify saved-plan assumptions. Now choices for account and retirement month, then the 'Use my saved plan' card (or the no-growth deposits path)."));
draft("original-clarify", "single", "what if I saved an extra $200 a month for retirement", { kind: "monthly", amount: "200" },
  original("m5-retire-09", "clarify", "Originally clarify saved-plan assumptions. Now the same account and month choices, then the saved-plan card."));
unsupported("unsupported-scope", "single", "how much income will I have in retirement", "income", original("m5-retire-10", "unsupported", "Unchanged: retirement income is not offered in the first scope."));
unsupported("unsupported-advice", "single", "will I have enough to retire", "advice", original("m5-retire-11", "refuse", "Unchanged: advice is refused."));
unsupported("unsupported-scope", "single", "what if I saved an extra $50 a month in my 401k", "account-not-found", original("m5-retire-12", "not-found", "Unchanged: no investment account with that name."));
unsupported("unsupported-scope", "single", "include my employer match in the extra $50 a month", "employer-match", original("m5-retire-13", "unsupported", "Unchanged: employer match is not modelled."));

// ---- Supplements ---------------------------------------------------------------------------------------------------------------------------
draft("monthly-extra", "single", "what if I add $75 a month to my Roth IRA until March 2040", { account: ROTH, kind: "monthly", amount: "75", month: ["2040-03", "March 2040"] });
draft("monthly-extra", "single", "extra $50.50 per month to the Roth IRA until June 2050", { account: ROTH, kind: "monthly", amount: "50.50", month: JUNE50 }, { note: "typed cents are kept as typed" });
draft("monthly-extra", "single", "extra $0 a month into my Roth IRA until June 2050", { account: ROTH, kind: "monthly", amount: "0", month: JUNE50 }, { note: "an explicit zero is a valid amount" });
draft("monthly-extra", "single", "an extra $50 every month into Roth IRA through 2050-06", { account: ROTH, kind: "monthly", amount: "50", month: ["2050-06", "2050-06"] });
draft("monthly-extra", "single", "Add $50/month to my Roth IRA until Jun 2050", { account: ROTH, kind: "monthly", amount: "50", month: ["2050-06", "Jun 2050"] });
draft("monthly-extra", "single", "EXTRA $50 A MONTH INTO MY ROTH IRA UNTIL JUNE 2050", { account: [5, "ROTH IRA"], kind: "monthly", amount: "50", month: ["2050-06", "JUNE 2050"] }, { note: "case-insensitive" });
draft("monthly-extra", "accent", "extra $50 a month into my Rothé IRA until June 2050", { account: [11, "Rothé IRA"], kind: "monthly", amount: "50", month: JUNE50 }, { note: "accented account name" });
draft("once-extra", "single", "if I put in $1,000 once into my Roth IRA now, retiring December 2045", { account: ROTH, kind: "once", amount: "1000", month: ["2045-12", "December 2045"] }, { note: "grouping comma removed" });
draft("once-extra", "single", "a one-time $500 deposit to my Roth IRA now, retiring September 2026", { account: ROTH, kind: "once", amount: "500", month: ["2026-09", "September 2026"] }, { note: "zero-month horizon: the current month" });
draft("once-extra", "single", "one time $250 into my Roth IRA until June 2050", { account: ROTH, kind: "once", amount: "250", month: JUNE50 });
draft("return-wording", "single", "extra $100 a month into my Roth IRA until June 2050 at 0%", { account: ROTH, kind: "monthly", amount: "100", month: JUNE50, ret: ["0", "0%"] });
draft("return-wording", "single", "extra $100 a month into my Roth IRA until June 2050 at 6.5% a year", { account: ROTH, kind: "monthly", amount: "100", month: JUNE50, ret: ["6.5", "6.5% a year"] });
draft("return-wording", "single", "extra $100 a month into my Roth IRA until June 2050 at -2% a year", { account: ROTH, kind: "monthly", amount: "100", month: JUNE50, ret: ["-2", "-2% a year"] }, { note: "preview-only negative rate" });
draft("return-wording", "single", "extra $100 a month into my Roth IRA until October 2100 at 100%", { account: ROTH, kind: "monthly", amount: "100", month: ["2100-10", "October 2100"], ret: ["100", "100%"] }, { note: "extreme rate with a long horizon (889 months)" });
unsupported("return-wording", "single", "extra $100 a month into my Roth IRA until June 2050 assuming a 150% return", "rate-out-of-range");
draft("return-wording", "single", "extra $100 a month into my Roth IRA until June 2050 using my saved plan", { account: ROTH, kind: "monthly", amount: "100", month: JUNE50 }, { note: "no number given; the saved plan is offered on the review card" });
draft("inflation-wording", "single", "extra $50 a month into my Roth IRA until June 2050 in today's dollars", { account: ROTH, kind: "monthly", amount: "50", month: JUNE50, infl: [null, "today's dollars"] });
draft("inflation-wording", "single", "extra $50 a month into my Roth IRA until June 2050 at 2.5% inflation", { account: ROTH, kind: "monthly", amount: "50", month: JUNE50, infl: ["2.5", "2.5% inflation"] });
draft("account-choice", "two", "extra $50 a month into my Brokerage until June 2050", { account: [8, "Brokerage"], kind: "monthly", amount: "50", month: JUNE50 });
draft("account-choice", "two", "extra $50 a month for retirement until June 2050", { kind: "monthly", amount: "50", month: JUNE50 }, { note: "two accounts and none named" });
draft("account-choice", "duplicate", "extra $50 a month into my Roth IRA until June 2050", { account: [null, "Roth IRA"], kind: "monthly", amount: "50", month: JUNE50 }, { note: "duplicate names: the choice list shows both accounts" });
const MONTHLY50 = { kind: "monthly", amount: "50" } as const;
clarify("account-choice", "two", "extra $50 a month into my Roth IRA or Brokerage until June 2050", "Which one account do you mean?", [
  { label: "Roth IRA", replace: ["Roth IRA or Brokerage", "Roth IRA"], spec: { account: ROTH, ...MONTHLY50, month: JUNE50 } },
  { label: "Brokerage", replace: ["Roth IRA or Brokerage", "Brokerage"], spec: { account: [8, "Brokerage"], ...MONTHLY50, month: JUNE50 } }]);
clarify("close-name", "single", "extra $50 a month into my Roth IRAA until June 2050", "Did you mean this account?", [{ label: "Roth IRA", replace: ["Roth IRAA", "Roth IRA"], spec: { account: ROTH, ...MONTHLY50, month: JUNE50 } }]);
clarify("close-name", "single", "extra $50 a month into my Roth IR until June 2050", "Did you mean this account?", [{ label: "Roth IRA", replace: ["Roth IR", "Roth IRA"], spec: { account: ROTH, ...MONTHLY50, month: JUNE50 } }]);
draft("quoted-name", "single", 'extra $50 a month into "Roth IRA" until June 2050', { account: ROTH, kind: "monthly", amount: "50", month: JUNE50 });
draft("quoted-name", "operator-name", 'extra $50 a month into "Save in 2050" until June 2055', { account: [9, "Save in 2050"], kind: "monthly", amount: "50", month: ["2055-06", "June 2055"] }, { note: "words inside the quotes are the name, not a date" });
draft("missing-choice", "single", "extra $50 into my Roth IRA until June 2050", { account: ROTH, amount: "50", month: JUNE50 });
draft("missing-choice", "single", "extra a month into my Roth IRA until June 2050", { account: ROTH, kind: "monthly", month: JUNE50 });
draft("missing-choice", "single", "extra $50 a month until June 2050", { kind: "monthly", amount: "50", month: JUNE50 });
draft("missing-choice", "single", "extra $50 a month into my Roth IRA", { account: ROTH, kind: "monthly", amount: "50" });
draft("missing-choice", "single", "extra fifty dollars a month into my Roth IRA until June 2050", { account: ROTH, kind: "monthly", month: JUNE50 }, { note: "number words are not read as amounts" });
clarify("date-wording", "single", "extra $50 a month into my Roth IRA until June", "Which year?", ["2027", "2028", "2029"].map(year => (
  { label: `June ${year}`, replace: ["until June", `until June ${year}`] as [string, string], spec: { account: ROTH, ...MONTHLY50, month: [`${year}-06`, `June ${year}`] as [string, string] } })));
draft("date-wording", "single", "extra $50 a month into my Roth IRA until 2050", { account: ROTH, kind: "monthly", amount: "50", month: [null, "2050"] }, { note: "a year alone is not a month" });
draft("date-wording", "single", "extra $50 a month into my Roth IRA when I retire in 24 years", { account: ROTH, kind: "monthly", amount: "50", month: [null, "in 24 years"] }, { note: "relative durations are not turned into a month" });
draft("date-wording", "single", "extra $50 a month into my Roth IRA until my retirement date", { account: ROTH, kind: "monthly", amount: "50", month: [null, "my retirement date"] }, { note: "the saved withdrawal month is only a candidate on the review card" });
unsupported("date-wording", "single", "extra $50 a month into my Roth IRA until March 2020", "past-date");
unsupported("date-wording", "single", "extra $50 a month into my Roth IRA until January 2200", "date-range");
draft("future-start", "single", "extra $50 a month into my Roth IRA starting next month until June 2050", { account: ROTH, kind: "monthly", amount: "50", month: JUNE50, futureStart: "starting next month" });
draft("future-start", "single", "a one-time $500 into my Roth IRA on December 1 2026, retiring June 2050", { account: ROTH, kind: "once", amount: "500", month: JUNE50, futureStart: "on December 1 2026" }, { note: "a future one-time deposit is never moved or made monthly" });
unsupported("unsupported-scope", "two", "extra $50 a month into my Roth IRA until June 2050 and also $20 into my Brokerage", "multi-account");
unsupported("unsupported-scope", "single", "extra $50 a month into my Roth IRA until June 2050 with a 50% employer match", "employer-match");
unsupported("unsupported-scope", "single", "extra $50 a month into my Roth IRA until June 2050 after taxes", "tax");
unsupported("unsupported-scope", "single", "extra $50 a month into my Roth IRA until June 2050 minus 1% fees", "fees");
unsupported("unsupported-scope", "single", "can I contribute an extra $50 a month to my Roth IRA without hitting the contribution limit", "contribution-limit");
unsupported("unsupported-scope", "single", "extra $50 a week into my Roth IRA until June 2050", "cadence");
unsupported("unsupported-scope", "single", "if I saved $50 less a month into my Roth IRA until June 2050", "reduction");
unsupported("unsupported-scope", "single", "extra $50 a month into my savings account until June 2050", "account-not-found");
unsupported("unsupported-scope", "none", "extra $50 a month into my Roth IRA until June 2050", "no-investment-account");
unsupported("unsupported-advice", "single", "should I put an extra $50 a month into my Roth IRA", "advice");
unsupported("unsupported-advice", "single", "is it smart to add $50 a month to my Roth IRA until June 2050", "advice");
unsupported("interacting-clause", "single", "extra $50 a month into my Roth IRA until June 2050 and how much monthly income would that give me", "income");
unsupported("interacting-clause", "single", "extra $50 a month into my Roth IRA until June 2050 but only if I get a raise", "condition");
draft("negation", "single", "don't count my employer match, extra $50 a month into my Roth IRA until June 2050", { account: ROTH, kind: "monthly", amount: "50", month: JUNE50 }, { note: "the match is never modelled, so excluding it changes nothing" });
draft("negation", "single", "extra $50 a month into my Roth IRA until June 2050 without my employer match", { account: ROTH, kind: "monthly", amount: "50", month: JUNE50 });
draft("boundary", "single", "extra $1,000,000 a month into my Roth IRA until June 2050", { account: ROTH, kind: "monthly", amount: "1000000", month: JUNE50 });
const BASE = "extra $50 a month into my Roth IRA until June 2050";
draft("boundary", "single", BASE.padEnd(512, " "), { account: ROTH, kind: "monthly", amount: "50", month: JUNE50 }, { note: "exactly 512 code points is accepted" });
unsupported("boundary", "single", BASE.padEnd(513, " "), "question-too-long");
unsupported("boundary", "single", "extra $50.123 a month into my Roth IRA until June 2050", "amount-precision");
elsewhere("route-elsewhere", "single", "how much did I spend on dining last month");
elsewhere("route-elsewhere", "single", "what if I spent $50 less on dining each month");
elsewhere("route-elsewhere", "single", "save $300 a month across dining and shopping");
elsewhere("route-elsewhere", "single", "how much did I spend on retirement gifts last month", { note: "the word retirement alone does not claim a question" });
elsewhere("route-elsewhere", "single", "what is my Roth IRA worth");
elsewhere("follow-up", "single", "and what about $100 instead", { note: "retirement follow-ups are outside the first scope" });

export const RETIREMENT_CORPUS: readonly CorpusCase[] = cases;

/** Execution policy is separate from the unchanged frozen parser drafts. */
export const RETIREMENT_EXECUTION_POLICY_VERSION = "m5-execution-v2-exact-rounded-number";
export function retirementExecutionExpectation(c: CorpusCase): "completed-estimate" | "numeric-boundary-refusal" {
  if (c.id !== "m5c-027") return "completed-estimate";
  const frozen = RETIREMENT_CORPUS.find(entry => entry.id === c.id);
  if (!frozen || JSON.stringify(c) !== JSON.stringify(frozen)) throw new Error("Review changes to the approved numeric-boundary execution case explicitly.");
  return "numeric-boundary-refusal";
}

export type Denominators = Record<string, number>;
/** Explicit counts for E9. A draft is an interpretation that still needs choices and consent; it is never counted as a completed answer. */
export function retirementCorpusDenominators(): Denominators {
  const d: Denominators = { total: cases.length, originals: 0, supplements: 0, interpretationDrafts: 0, fullySpecifiedDrafts: 0, draftsNeedingChoices: 0, necessaryClarifications: 0, refusals: 0, routeElsewhere: 0,
    knownGaps: 0, consentActions: 0, choiceActions: 0, completedWithoutConsent: 0, clarificationChoices: 0, reparseDrafts: 0, balanceCompletionDrafts: 0, numericBoundaryRefusals: 0 };
  for (const c of cases) {
    d[c.provenance === "original-bank" ? "originals" : "supplements"]++;
    d[`family:${c.family}`] = (d[`family:${c.family}`] ?? 0) + 1;
    if (c.original?.knownGap) d.knownGaps++;
    switch (c.expected.kind) {
      case "retirement":
        d.interpretationDrafts++; d.consentActions++; d.choiceActions += c.expected.draft.missing.length; d[c.expected.draft.missing.length ? "draftsNeedingChoices" : "fullySpecifiedDrafts"]++;
        if (!c.expected.draft.missing.length) d[retirementExecutionExpectation(c) === "numeric-boundary-refusal" ? "numericBoundaryRefusals" : "balanceCompletionDrafts"]++;
        break;
      case "retirement-clarify": d.necessaryClarifications++; d.clarificationChoices += c.expected.choices.length; d.reparseDrafts += c.expected.choices.length; break;
      case "retirement-unsupported": d.refusals++; break;
      case "route-elsewhere": d.routeElsewhere++; break;
    }
  }
  return d;
}

// ---- Scoring plan ------------------------------------------------------------------------------------------------------------------------------
export type FamilyScoring = {
  family: CorpusFamily; cases: number; fullySpecifiedDrafts: number; draftsNeedingChoices: number; necessaryClarifications: number; refusals: number; routeElsewhere: number; knownGaps: number;
  /** Fully specified estimate candidates, excluding the owner-approved numeric-boundary refusal. Other outcomes have separate populations. */
  completionDenominator: number; completionApplicable: boolean; completionRequiredPassing: number | null; numericBoundaryRefusals: number;
};
/** Frozen parser populations plus the explicit owner-approved execution amendment. Each denominator is asserted against a hand-written table. */
export function retirementScoringPlan() {
  const families = {} as Record<CorpusFamily, FamilyScoring>;
  for (const c of cases) {
    const f = (families[c.family] ??= { family: c.family, cases: 0, fullySpecifiedDrafts: 0, draftsNeedingChoices: 0, necessaryClarifications: 0, refusals: 0, routeElsewhere: 0, knownGaps: 0,
      completionDenominator: 0, completionApplicable: false, completionRequiredPassing: null, numericBoundaryRefusals: 0 });
    f.cases++;
    if (c.original?.knownGap) f.knownGaps++;
    if (c.expected.kind === "retirement") f[c.expected.draft.missing.length ? "draftsNeedingChoices" : "fullySpecifiedDrafts"]++;
    else if (c.expected.kind === "retirement-clarify") f.necessaryClarifications++;
    else if (c.expected.kind === "retirement-unsupported") f.refusals++;
    else f.routeElsewhere++;
    if (c.expected.kind === "retirement" && !c.expected.draft.missing.length && retirementExecutionExpectation(c) === "numeric-boundary-refusal") f.numericBoundaryRefusals++;
  }
  const d = retirementCorpusDenominators(), gate = RETIREMENT_GATES.section3;
  for (const f of Object.values(families)) {
    f.completionDenominator = f.fullySpecifiedDrafts - f.numericBoundaryRefusals;
    f.completionApplicable = f.completionDenominator > 0;
    f.completionRequiredPassing = f.completionApplicable ? Math.ceil(gate.perFamilyCoverage * f.completionDenominator) : null;
  }
  return {
    families,
    populations: {
      completion: { denominator: d.balanceCompletionDrafts, requiredPassing: Math.ceil(gate.directAnswerCoverage * d.balanceCompletionDrafts), fraction: gate.directAnswerCoverage,
        observed: "through the review card and consent in the compiled app, three ledger seeds" },
      unnecessaryClarification: { denominator: d.balanceCompletionDrafts, allowedAtMost: Math.floor(gate.unnecessaryClarification * d.balanceCompletionDrafts), fraction: gate.unnecessaryClarification },
      numericBoundaryRefusals: { denominator: d.numericBoundaryRefusals, requiredFraction: 1 },
      interpretation: { denominator: d.interpretationDrafts, wrongAcceptanceAllowed: 0 },
      necessaryChoice: { draftsNeedingChoices: d.draftsNeedingChoices, choiceActions: d.choiceActions, clarifications: d.necessaryClarifications, clarificationChoices: d.clarificationChoices, requiredFraction: 1 },
      refusals: { denominator: d.refusals, requiredFraction: 1 },
      routeNonInterference: { denominator: d.routeElsewhere, requiredFraction: 1 },
      wrongAcceptance: { denominator: d.total, allowed: 0 },
      originalBank: { entries: d.originals, knownGaps: d.knownGaps },
    },
    rules: {
      zeroDenominator: "not-applicable" as const,
      knownGap: { originalBankReport: "miss", routeNonInterference: "pass-when-left-to-older-routes", completion: "excluded", otherReports: "excluded" } as const,
      separateReports: ["completion", "unnecessaryClarification", "interpretation", "necessaryChoice", "refusals", "numericBoundaryRefusals", "routeNonInterference", "wrongAcceptance", "originalBank"] as const,
      draftsAreNotCompletions: true, consentNeverRemoved: true,
    },
  };
}

// ---- Gates -------------------------------------------------------------------------------------------------------------------------------------
export const RETIREMENT_GATES = {
  section3: {
    directAnswerCoverage: 0.95, perFamilyCoverage: 0.9, unnecessaryClarification: 0.05, wrongAcceptance: 0, necessaryAmbiguityCorrect: 1, unsupportedUnsafeCorrect: 1,
    longTail: { minCases: 100, direct: 0.8, withinOneClarification: 0.9 }, outOfScope: { minCases: 100 }, minimumLedgerSeeds: 3,
    releaseWide: { prompts: 650, acceptedCases: 600, appliesToM5Only: false },
  },
  parser: { normalP95Ms: 50, stressP95Ms: 100 },
  confirmationToResultP95Ms: 500, inputAndCancelP95Ms: 100, longTaskMs: 50,
  samples: { warmups: 5, warm: 30, freshStarts: 10 },
  shapes: { rows: [1000, 10000, 50000], layouts: ["concentrated", "spread"], names: ["long", "near-duplicate"] },
  matchedQuery: { toleranceMs: 50, toleranceFraction: 0.1 },
  memory: { investigationTriggerMiB: 100, hardCapMiB: null },
  /** Recorded here (prerequisite 6) because section 9 gives the 500 ms gate only "after context loads". These numbers are this document's own; M4's approval is not extended. */
  contextLoad: {
    recordedBy: "M5 prerequisite 6, 18 October 2026",
    inheritsM4: false,
    commandRoundTripWarmP95Ms: { 1000: 300, 10000: 300, 50000: 300 } as Record<number, number>,
    submitToReviewReadyWarmP95Ms: 500,
    firstAfterLaunchMs: 2000,
    excludedFrom500msGate: true,
    stages: ["parse", "ipc-dispatch", "native-read", "reply-validation", "review-render"],
  },
} as const;

// ---- Ledger interactions ------------------------------------------------------------------------------------------------------------------------
const idOf = (text: string): string => { const found = cases.find(c => c.text === text); if (!found) throw new Error("Unknown corpus text: " + text); return found.id; };
export type LedgerInteraction = { id: string; description: string; cases: string[]; fixtures: string[]; tests: string[]; owner: string; status: "contract-proven" | "specified-only" | "assigned-to-workstream" };
export const LEDGER_INTERACTIONS: readonly LedgerInteraction[] = [
  { id: "I-01", description: "No saved plan plus the default 7% return: the default is never labelled as something the person chose", cases: [], fixtures: ["no-plan-row-default-return"],
    tests: ["retirementNativeContract.test.ts A4-6", "retirementScreenContract.test.ts review content: untouched default"], owner: "native context + screen", status: "contract-proven" },
  { id: "I-02", description: "Saved 0% return versus a missing return stay distinct all the way to the confirmed scenario", cases: [], fixtures: ["saved-zero-return", "no-plan-row-default-return"],
    tests: ["retirementScreenContract.test.ts: a saved 0% return is a real saved return"], owner: "native context + screen", status: "contract-proven" },
  { id: "I-03", description: "Absent contribution plus an explicit extra $50: the extra is kept and the missing basis is never treated as a confirmed zero", cases: [],
    fixtures: ["no-deposits-at-all"], tests: ["retirementScreenContract.test.ts: missing contribution is never zero"], owner: "native context + screen", status: "contract-proven" },
  { id: "I-04", description: "Multiple accounts plus an ambiguous or duplicate name: the person chooses one account explicitly", cases: [idOf("extra $50 a month for retirement until June 2050"), idOf("extra $50 a month into my Roth IRA or Brokerage until June 2050")],
    fixtures: ["duplicate-names-are-different-accounts"], tests: [], owner: "parser + native context", status: "specified-only" },
  { id: "I-05", description: "Date or assumption edited while the context read is waiting: the late reply is dropped", cases: [], fixtures: [],
    tests: ["retirementNativeContract.test.ts A4-3 midnight crossing and A4-5 freshness", "controller acceptance I1/I2 (assigned)"], owner: "controller", status: "assigned-to-workstream" },
  { id: "I-06", description: "A saved consent callback is never accepted for a new, identical-looking review", cases: [], fixtures: [], tests: ["controller acceptance I1: forged, duplicate and old consent (assigned)"], owner: "controller", status: "assigned-to-workstream" },
  { id: "I-07", description: "Lock or profile switch during the read or the confirmation", cases: [], fixtures: ["profile-locked", "profile-switched-generation", "session-revision-moved"], tests: ["controller and compiled lock acceptance I2/I3 (assigned)"], owner: "controller + verification", status: "assigned-to-workstream" },
  { id: "I-08", description: "Account value or saved plan changes between review and confirmation", cases: [], fixtures: ["expected-revision-local-differs"], tests: ["retirementNativeContract.test.ts trigger scenarios"], owner: "native context + controller", status: "contract-proven" },
  { id: "I-09", description: "Zero horizon plus a one-time addition counts the deposit exactly once", cases: [idOf("a one-time $500 deposit to my Roth IRA now, retiring September 2026")], fixtures: [],
    tests: ["retirementScenarioMath.test.ts zero-month-once example"], owner: "parser + engine", status: "contract-proven" },
  { id: "I-10", description: "An extreme return with a long horizon and a large balance stays finite or is refused plainly", cases: [idOf("extra $100 a month into my Roth IRA until October 2100 at 100%")], fixtures: [],
    tests: ["retirementScenarioMath.test.ts R7 cost and exactness"], owner: "engine", status: "contract-proven" },
  { id: "I-11", description: "An inflation setting applies to both plans and their difference, never to one", cases: [idOf("extra $50 a month into my Roth IRA until June 2050 in today's dollars")], fixtures: [],
    tests: ["retirementScenarioMath.test.ts paired deflation", "retirementScreenContract.test.ts today's dollars"], owner: "engine + screen", status: "contract-proven" },
  { id: "I-12", description: "An unsupported match or retirement-income clause appended to a supported request yields no financial result", cases: [idOf("extra $50 a month into my Roth IRA until June 2050 and how much monthly income would that give me"), idOf("extra $50 a month into my Roth IRA until June 2050 with a 50% employer match")],
    fixtures: [], tests: [], owner: "parser", status: "specified-only" },
];
