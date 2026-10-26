import { CHANGED_BODY } from "./changedState";
import { monthsUntil } from "../accumulation";
import { dateOutOfRange } from "../dateRange";
import { calculateRetirementScenario } from "./retirementScenarioMath";
import {
  plainArray, validateConfirmedRetirementScenario, validateRetirementContext, validateRetirementDraft, validateRetirementInflationCandidate, validateRetirementIntent, validateRetirementRate,
} from "./retirementScenarioContract";
import type { UnsupportedCode } from "./retirementCorpus";
import type {
  ConfirmedRetirementScenario, RetirementCalculation, RetirementContext, RetirementContextRead, RetirementDraft, RetirementEstimate, RetirementInflationCandidate, RetirementIntent,
  RetirementParseContext, RetirementSensitivity, RetirementValidation,
} from "./retirementScenarioContract";

/**
 * M5 screen contract (prerequisite 5): the states the answer dialog can be in, how one state may follow another, the one
 * place consent is built, and every sentence the screen shows. No React here; the dialog (a later workstream) renders
 * these values and cannot add states, copy or consent of its own.
 */
/** Where the retirement month came from: the question, a month the person typed on the card, or the plan's saved month offered as a candidate. Every source is confirmed on the card. */
export type RetirementMonthSource = "question" | "typed" | "plan-candidate";
/** A return or inflation the person wrote in the question. It is a candidate to confirm, never consent and never a stored value. */
export type RetirementQuestionAssumptions = { annualReturnPct: string | null; inflationPct: string | null };
export type RetirementReview = {
  intent: RetirementIntent; context: RetirementContext; inflation: RetirementInflationCandidate; monthSource: RetirementMonthSource; questionAssumptions: RetirementQuestionAssumptions;
};
export type PreviewCalculation = Extract<RetirementCalculation, { kind: "preview" }>;
export type DepositsOnlyCalculation = Extract<RetirementCalculation, { kind: "extra-deposits-only" }>;
export type RefusedCalculation = Extract<RetirementCalculation, { kind: "refused" }>;
export type RetirementScreen =
  /** `monthCandidate` is the plan's saved month, offered only after the account was read and only while the question gave no month. */
  | { stage: "choices"; draft: RetirementDraft; accounts: readonly { id: number; name: string }[]; today: string; monthCandidate: string | null;
      /** The plan's saved month when it is well formed but beyond what can be calculated: explained, never offered. Null otherwise, and always null when there is a candidate. */
      savedMonthLimit: string | null }
  | { stage: "reading"; accountName: string | null }
  | { stage: "review"; review: RetirementReview }
  | { stage: "result"; calculation: PreviewCalculation }
  | { stage: "deposits-only"; calculation: DepositsOnlyCalculation }
  | { stage: "blocked"; calculation: RefusedCalculation }
  | { stage: "explore"; calculation: PreviewCalculation }
  | { stage: "unsupported"; reason: string }
  | { stage: "stale" | "error"; message: string };
export type RetirementStage = RetirementScreen["stage"];
export type RetirementChoices = {
  view: "balances" | "extra-deposits-only";
  contribution: { basis: "context" } | { basis: "manual"; amount: string } | null;
  returns: { kind: "no-growth" } | { kind: "stored-plan" } | { kind: "explicit"; annualPct: string };
  sensitivity: RetirementSensitivity | null;
  purchasingPower: { kind: "nominal" } | { kind: "today"; inflationPct: string };
};
/** What the choices card reports. `account`: an account was chosen while other terms may still be open, so the controller reads it (reading) and returns here with the plan's month as a candidate.
 *  `complete`: every term is settled; the controller already holds (or re-reads) the account context and builds the review with `buildRetirementReview`. Neither event is consent. */
export type RetirementChoicesEvent =
  | { step: "account"; draft: RetirementDraft }
  | { step: "complete"; intent: RetirementIntent; monthSource: RetirementMonthSource; questionAssumptions: RetirementQuestionAssumptions };
/** Contract with the owner of the flow: after onChoices, onConfirm, onExplore, onBack or onEdit the owner must show a different screen (or close the dialog). The dialog disables its confirming
 *  buttons after one use so a double click cannot confirm twice, and re-arms them only when the screen shown changes. */
/** Consent leaves the dialog only through onConfirm, carrying a scenario built by buildRetirementConfirmation (from the review plus the person's explicit choices). Exploring other returns confirms
 *  through the same callback with a scenario that carries a sensitivity. */
export type RetirementDialogProps = {
  screen: RetirementScreen;
  /** Today and the current roster. The dialog validates its screen against this before showing it, so an altered or stale screen is never displayed. */
  live: RetirementParseContext;
  /** Open the review with the return field already showing (coming back from exact deposits). */
  openReturnChoice?: boolean;
  onChoices: (event: RetirementChoicesEvent) => void;
  onConfirm: (scenario: ConfirmedRetirementScenario) => void;
  /** "Explore other returns" on a result: the owner of the flow shows the explore card. */
  onExplore: () => void;
  /** "Back to the result" on the explore card. */
  onBack: () => void;
  /** "Change the details"; from the exact-deposits card the request says the person wants to choose a return. */
  onEdit: (request?: { chooseReturn: true }) => void;
  onRestart: () => void;
  onClose: () => void;
};

export const RETIREMENT_STAGES: readonly RetirementStage[] = ["choices", "reading", "review", "result", "deposits-only", "blocked", "explore", "unsupported", "stale", "error"];
/** Every state can be retired by a change of profile, account, data or date; nothing reaches a result without the review. */
export const RETIREMENT_TRANSITIONS: Readonly<Record<RetirementStage, readonly RetirementStage[]>> = {
  choices: ["reading", "unsupported", "stale", "error"],
  reading: ["review", "choices", "stale", "error"],
  review: ["result", "deposits-only", "blocked", "choices", "stale", "error"],
  result: ["explore", "choices", "stale", "error"],
  "deposits-only": ["review", "choices", "stale", "error"],
  blocked: ["choices", "review", "stale", "error"],
  explore: ["result", "blocked", "choices", "stale", "error"],
  unsupported: ["choices", "stale", "error"],
  stale: ["choices", "reading"],
  error: ["choices", "reading"],
};
export const RETIREMENT_PRIMARY_ACTION: Readonly<Record<RetirementStage, string>> = {
  choices: "Continue", reading: "Cancel", review: "Use my saved plan", result: "Change the details", "deposits-only": "Choose a return assumption", blocked: "Change the details",
  explore: "Show these returns", unsupported: "Ask something else", stale: "Try again", error: "Try again",
};
export function canTransition(from: RetirementStage, to: RetirementStage): boolean { return RETIREMENT_TRANSITIONS[from]?.includes(to) ?? false; }

export const FORBIDDEN_RETIREMENT_WORDING = /expected (range|return|outcome)|confidence|guarantee|probab|worst[- ]case|best[- ]case|you will (have|end up)|will grow to|safe withdrawal/i;
export const RETIREMENT_COPY = {
  noGrowth: "No investment growth", noGrowthBalance: "Show the balance with no investment growth", confirmedReturn: "Using your confirmed plan return", acrossTwo: "Across these two assumptions", usePlan: "Use my saved plan",
  depositsOnly: "Show extra deposits with no investment growth", chooseReturn: "Choose a return assumption", explore: "Explore other returns", pickAnotherMonth: "Pick another month", backToResult: "Back to the result", nothingCalculated: "Nothing was calculated.", detailsSummary: "What this includes and leaves out",
} as const;

type Row = Record<string, unknown>;
const record = (v: unknown): v is Row => !!v && typeof v === "object" && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const keys = (v: Row, names: readonly string[]) => Reflect.ownKeys(v).length === names.length && names.every(n => Object.prototype.hasOwnProperty.call(v, n));
const fail = (reason: string): RetirementValidation => ({ ok: false, code: "invalid-shape", reason });
const text = (v: unknown, max = 300): v is string => typeof v === "string" && !!v.trim() && [...v].length <= max;
const liveOf = (context: RetirementContext) => ({ today: context.source.asOf, source: context.source, investmentAccounts: [{ id: context.account.id, name: context.account.name }] });
const positiveId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
/** A list of accounts exactly as it arrived: a plain array of { id, name } rows with a positive integer id, a non-blank name and no extra, hidden or symbol fields; ids unique. */
function accountList(v: unknown): v is { id: number; name: string }[] {
  return plainArray(v) && v.every(row => record(row) && keys(row, ["id", "name"]) && positiveId(row.id) && text(row.name, 512)) && new Set(v.map(row => (row as { id: number }).id)).size === v.length;
}
/** The live context the screen is judged against: exact keys, a real calendar date and a well-formed roster. A malformed one fails validation; it never throws and never passes. */
function liveContextOk(parse: unknown): parse is RetirementParseContext {
  return record(parse) && keys(parse, ["today", "investmentAccounts"]) && typeof parse.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parse.today) && !dateOutOfRange(parse.today) &&
    !Number.isNaN(Date.parse(parse.today + "T00:00:00Z")) && new Date(parse.today + "T00:00:00Z").toISOString().slice(0, 10) === parse.today && accountList(parse.investmentAccounts);
}
const sameRoster = (a: unknown, b: readonly { id: number; name: string }[]) => accountList(a) && a.length === b.length && a.every((x, i) => x.id === b[i].id && x.name === b[i].name);

const MONTH_SOURCES: readonly string[] = ["question", "typed", "plan-candidate"];
const MONTH_TEXT = /^\d{4}-(0[1-9]|1[0-2])$/;
function questionAssumptionsOk(v: unknown): v is RetirementQuestionAssumptions {
  return record(v) && keys(v, ["annualReturnPct", "inflationPct"]) && (v.annualReturnPct === null || validateRetirementRate(v.annualReturnPct, "preview").ok) &&
    (v.inflationPct === null || validateRetirementRate(v.inflationPct, "saved").ok);
}
/** Structural equality of two plain values, own keys included (so hidden and symbol fields count). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const arrays = Array.isArray(a);
  if (arrays !== Array.isArray(b)) return false;
  // Arrays are compared by every own key (indices, length and any extra, hidden or symbol field), not by length and items alone.
  if (arrays ? Object.getPrototypeOf(a) !== Array.prototype || Object.getPrototypeOf(b) !== Array.prototype : !record(a) || !record(b)) return false;
  const ka = Reflect.ownKeys(a);
  return ka.length === Reflect.ownKeys(b).length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && sameValue((a as Row)[k as string], (b as Row)[k as string]));
}

function checkReview(review: unknown, parse: RetirementParseContext): RetirementValidation {
  if (!record(review) || !keys(review, ["intent", "context", "inflation", "monthSource", "questionAssumptions"]) || !MONTH_SOURCES.includes(review.monthSource as string) || !questionAssumptionsOk(review.questionAssumptions)) return fail("Keep the reviewed details together.");
  const context = review.context as RetirementContext, intent = review.intent as RetirementIntent;
  const contextCheck = validateRetirementContext(context); if (!contextCheck.ok) return contextCheck;
  const inflation = validateRetirementInflationCandidate(review.inflation); if (!inflation.ok) return inflation;
  const intentCheck = validateRetirementIntent(intent, { today: context.source.asOf, investmentAccounts: [{ id: context.account.id, name: context.account.name }] }); if (!intentCheck.ok) return intentCheck;
  if (intent.accountId !== context.account.id) return fail("The details belong to a different account.");
  if (review.monthSource === "plan-candidate" && (context.retirementMonth === null || context.retirementMonth !== intent.retirementMonth)) return fail("The retirement month must be the one saved in your plan.");
  if (parse.today !== context.source.asOf || !parse.investmentAccounts.some(a => a.id === context.account.id && a.name === context.account.name)) return fail("The account or date changed. Start again.");
  return { ok: true };
}
function checkCalculation(screen: Row, expected: "preview" | "extra-deposits-only" | "refused", parse: RetirementParseContext): RetirementValidation {
  const calc = screen.calculation;
  if (!record(calc) || calc.kind !== expected) return fail("This result does not match this screen.");
  if (expected === "refused") return text(calc.message) && ["invalid-input", "unsupported-number"].includes(calc.code as string) && keys(calc, ["kind", "code", "message"]) ? { ok: true } : fail("Keep a plain reason for the refusal.");
  const scenario = calc.scenario as ConfirmedRetirementScenario;
  // Nothing below may throw on a malformed value: the context must prove its own shape before anything reads inside it.
  if (!record(scenario) || !record(scenario.context) || !validateRetirementContext(scenario.context).ok) return fail("Keep the confirmed details with the result.");
  const base = validateConfirmedRetirementScenario(scenario, liveOf(scenario.context));
  if (!base.ok) return base;
  if (parse.today !== scenario.context.source.asOf || !parse.investmentAccounts.some(a => a.id === scenario.context.account.id && a.name === scenario.context.account.name)) return fail("The account or date changed. Start again.");
  // Trusted-result boundary: a displayed result is accepted only if it is exactly what the calculator makes from the confirmed terms it carries.
  // Every figure, label, unit and series is therefore checked, not just the discriminants; an altered or forged result is refused, never repaired.
  const again = calculateRetirementScenario(scenario);
  return again.kind === expected && sameValue(again, calc) ? { ok: true } : fail("The result does not match its confirmed details.");
}

/**
 * Static snapshot validation of what the dialog is about to show. For a result it proves one thing exactly: the calculation equals what the calculator makes from the confirmed terms it carries,
 * for an account in the given roster on the given day. It does NOT prove that those terms are still current, that the person consented to them, or that the profile is unchanged: the controller
 * binds consent to the live source and re-reads before every calculation (prerequisite 4). A passing result must be validated once when it is set, not on every render, because it re-runs the calculator.
 */
export function validateRetirementScreen(screen: unknown, parse: RetirementParseContext): RetirementValidation {
  if (!liveContextOk(parse)) return fail("The accounts or the date aren't available. Start again.");
  if (!record(screen) || typeof screen.stage !== "string" || !RETIREMENT_STAGES.includes(screen.stage as RetirementStage)) return fail("Choose one of the supported screens.");
  switch (screen.stage as RetirementStage) {
    case "choices": {
      if (!keys(screen, ["stage", "draft", "accounts", "today", "monthCandidate", "savedMonthLimit"]) || screen.today !== parse.today || !sameRoster(screen.accounts, parse.investmentAccounts)) return fail("The choices must match the current accounts and date.");
      const draft = validateRetirementDraft(screen.draft, parse); if (!draft.ok) return draft;
      const candidate = screen.monthCandidate, steps = typeof candidate === "string" && MONTH_TEXT.test(candidate) && !dateOutOfRange(candidate + "-01") ? monthsUntil(parse.today, candidate) : -1;
      if (candidate !== null && (steps < 0 || steps > 1200 || (screen.draft as RetirementDraft).retirementMonth !== null)) return fail("Offer the plan's month only when it is this month or later and the question gave none.");
      if (screen.savedMonthLimit !== null && (candidate !== null || (screen.draft as RetirementDraft).retirementMonth !== null || !retirementSavedMonthBeyondLimit(screen.savedMonthLimit, parse.today))) return fail("Explain a saved month only when it is beyond what can be calculated and the question gave none, and never offer it.");
      return (screen.draft as RetirementDraft).missing.length ? { ok: true } : fail("There is nothing left to choose.");
    }
    case "reading": return keys(screen, ["stage", "accountName"]) && (screen.accountName === null || text(screen.accountName, 512)) ? { ok: true } : fail("Keep an account name or none.");
    case "review": return keys(screen, ["stage", "review"]) ? checkReview(screen.review, parse) : fail("Keep the reviewed details.");
    case "result": case "explore": return keys(screen, ["stage", "calculation"]) ? checkCalculation(screen, "preview", parse) : fail("Keep the result.");
    case "deposits-only": return keys(screen, ["stage", "calculation"]) ? checkCalculation(screen, "extra-deposits-only", parse) : fail("Keep the result.");
    case "blocked": return keys(screen, ["stage", "calculation"]) ? checkCalculation(screen, "refused", parse) : fail("Keep the reason.");
    case "unsupported": return keys(screen, ["stage", "reason"]) && text(screen.reason) ? { ok: true } : fail("Say plainly what is not supported.");
    case "stale": case "error": return keys(screen, ["stage", "message"]) && text(screen.message) ? { ok: true } : fail("Say plainly what happened.");
  }
}

const MANUAL_AMOUNT = /^(0|[1-9]\d*)(\.\d{1,2})?$/;
const UNSAFE = "Those choices don't fit together. Check them and try again.";
export const RETIREMENT_TABLE_HEADERS = { assumption: "Assumption", without: "Without the extra", with: "With the extra", difference: "Difference" } as const;
/** Every sentence that explains why a typed value cannot be used. The consent builder and the dialog both use these. */
export const RETIREMENT_PROBLEMS = {
  extraAmount: "Enter the amount as dollars and cents, like 50 or 50.25.", manualAmount: "Enter the amount as dollars and cents, like 100 or 100.50.", return: "Enter a yearly return from -100% to 100%.",
  inflation: "Enter yearly inflation from 0% to 100%.", otherReturns: "Enter returns from -100 to 100, lowest first.", month: "Choose a retirement month from this month on, within the next 100 years.",
} as const;
const BAD_RETURN = RETIREMENT_PROBLEMS.return, BAD_INFLATION = RETIREMENT_PROBLEMS.inflation, BAD_OTHER_RETURNS = RETIREMENT_PROBLEMS.otherReturns;
/** Shown instead of any screen the contract refuses to validate against the live context. */
export const RETIREMENT_INVALID_SCREEN_MESSAGE = "I couldn't show that. Nothing was calculated.";
/** Labels for the controls on the choices card. The questions themselves come from retirementChoicePrompts. */
export const RETIREMENT_CHOICE_COPY = { extraAmount: "Extra amount (dollars)", monthly: "Every month", once: "Just once", startToday: "Start today instead" } as const;
export const retirementUsePlanMonth = (month: string): string => `Use ${retirementMonthText(month)}, from your plan`;
/** Accounts with the same name are told apart by their place in the list; unique names stay as they are. */
export function retirementAccountLabels(accounts: readonly { id: number; name: string }[]): { id: number; label: string }[] {
  const total = new Map<string, number>(), seen = new Map<string, number>();
  for (const a of accounts) total.set(a.name, (total.get(a.name) ?? 0) + 1);
  return accounts.map(a => { const n = total.get(a.name)!, i = (seen.get(a.name) ?? 0) + 1; seen.set(a.name, i); return { id: a.id, label: n > 1 ? `${a.name} (${i} of ${n})` : a.name }; });
}

/** The exact shape of the person's choices, judged as it arrived: every nested object has exactly its own keys and string values. Nothing is repaired or defaulted. */
function choicesShapeOk(c: unknown): c is RetirementChoices {
  if (!record(c) || !keys(c, ["view", "contribution", "returns", "sensitivity", "purchasingPower"]) || (c.view !== "balances" && c.view !== "extra-deposits-only")) return false;
  const { contribution, returns, sensitivity, purchasingPower } = c;
  const contributionOk = contribution === null || (record(contribution) && ((contribution.basis === "context" && keys(contribution, ["basis"])) ||
    (contribution.basis === "manual" && keys(contribution, ["basis", "amount"]) && typeof contribution.amount === "string")));
  const returnsOk = record(returns) && ((returns.kind === "no-growth" && keys(returns, ["kind"])) || (returns.kind === "stored-plan" && keys(returns, ["kind"])) ||
    (returns.kind === "explicit" && keys(returns, ["kind", "annualPct"]) && typeof returns.annualPct === "string"));
  const sensitivityOk = sensitivity === null || (record(sensitivity) && keys(sensitivity, ["lower", "base", "higher"]) && [sensitivity.lower, sensitivity.base, sensitivity.higher].every(v => typeof v === "string"));
  const powerOk = record(purchasingPower) && ((purchasingPower.kind === "nominal" && keys(purchasingPower, ["kind"])) ||
    (purchasingPower.kind === "today" && keys(purchasingPower, ["kind", "inflationPct"]) && typeof purchasingPower.inflationPct === "string"));
  return contributionOk && returnsOk && sensitivityOk && powerOk;
}

/** The only way to make a ConfirmedRetirementScenario for the screen: reviewed terms plus explicit choices, then the shared validator. */
export function buildRetirementConfirmation(review: RetirementReview, choices: RetirementChoices): { ok: true; scenario: ConfirmedRetirementScenario } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  if (!record(review) || !keys(review, ["intent", "context", "inflation", "monthSource", "questionAssumptions"]) || !record(review.context) || !record(review.context.source)) return no("These details are out of date. Start again.");
  if (!choicesShapeOk(choices)) return no(UNSAFE);
  const asOf = review.context.source.asOf;
  const reviewed = checkReview(review, { today: asOf, investmentAccounts: [{ id: review.context.account?.id, name: review.context.account?.name }] });
  if (!reviewed.ok) return no("These details are out of date. Start again.");
  const context = structuredClone(review.context), intent = structuredClone(review.intent);
  const { returns, contribution, sensitivity, purchasingPower } = choices;
  let assumptions: ConfirmedRetirementScenario["assumptions"];
  if (choices.view === "extra-deposits-only") {
    if (contribution !== null || returns.kind !== "no-growth" || sensitivity !== null || purchasingPower.kind !== "nominal") return no("Extra deposits alone don't use a balance, a return or today's dollars.");
    assumptions = { view: "extra-deposits-only", monthlyContribution: null, returns: { kind: "no-growth" }, purchasingPower: { kind: "nominal" } };
  } else {
    if (context.currentValue === null) return no("There is no recorded value for this account, so I can only show the extra deposits.");
    if (contribution === null) return no("Choose the amount you add now, or enter your own.");
    let monthly: { basis: "context" | "manual"; amount: string };
    if (contribution.basis === "context") {
      if (context.contribution.kind === "missing") return no("There is no recorded amount to use. Enter your own, even if it is $0.");
      monthly = { basis: "context", amount: context.contribution.monthlyAmount };
    } else {
      if (typeof contribution.amount !== "string" || !MANUAL_AMOUNT.test(contribution.amount)) return no(RETIREMENT_PROBLEMS.manualAmount);
      monthly = { basis: "manual", amount: contribution.amount };
    }
    let confirmedReturns: ConfirmedRetirementScenario["assumptions"]["returns"];
    if (returns.kind === "no-growth") {
      if (sensitivity !== null) return no("Other returns need a confirmed return first.");
      confirmedReturns = { kind: "no-growth" };
    } else if (returns.kind === "stored-plan") {
      if (context.returnAssumption.kind !== "stored-plan") return no("Your plan has no saved return. Pick no growth or enter a return.");
      confirmedReturns = { kind: "confirmed-return", annualPct: context.returnAssumption.annualPct, basis: "stored-plan", sensitivity: sensitivity ? { ...sensitivity } : null };
    } else if (returns.kind === "explicit" && typeof returns.annualPct === "string") {
      if (!validateRetirementRate(returns.annualPct, "preview").ok) return no(BAD_RETURN);
      confirmedReturns = { kind: "confirmed-return", annualPct: returns.annualPct, basis: "explicit", sensitivity: sensitivity ? { ...sensitivity } : null };
    } else return no(UNSAFE);
    if (purchasingPower.kind === "today" && !validateRetirementRate(purchasingPower.inflationPct, "saved").ok) return no(BAD_INFLATION);
    assumptions = { view: "balances", monthlyContribution: monthly, returns: confirmedReturns, purchasingPower: purchasingPower.kind === "today" ? { kind: "today", inflationPct: purchasingPower.inflationPct } : { kind: "nominal" } };
  }
  const scenario: ConfirmedRetirementScenario = { intent, context, assumptions, confirmed: true };
  const check = validateConfirmedRetirementScenario(scenario, liveOf(context));
  if (!check.ok) return no(check.code === "unsupported-number" ? "One of these values is too precise to use. Choose simpler numbers, or show the extra deposits only." : check.code === "invalid-assumptions" ? (sensitivity ? BAD_OTHER_RETURNS : UNSAFE) : "These details are out of date. Start again.");
  return { ok: true, scenario };
}

// ---- Choices events and the review ---------------------------------------------------------------------------------------------------------------------------
/** Strict shape of what the choices card reports. A partial `account` step is allowed to leave the amount, cadence and month open; a `complete` step is a full, valid intent. */
export function validateRetirementChoicesEvent(event: unknown, parse: RetirementParseContext): RetirementValidation {
  if (!liveContextOk(parse)) return fail("The accounts or the date aren't available. Start again.");
  if (!record(event)) return fail("Report one of the supported choice steps.");
  if (event.step === "account") {
    if (!keys(event, ["step", "draft"])) return fail("Report the account with the question's details.");
    const draft = validateRetirementDraft(event.draft, parse); if (!draft.ok) return draft;
    return (event.draft as RetirementDraft).accountId === null ? { ok: false, code: "invalid-account", reason: "Choose one current investment account." } : { ok: true };
  }
  if (event.step === "complete") {
    if (!keys(event, ["step", "intent", "monthSource", "questionAssumptions"]) || !MONTH_SOURCES.includes(event.monthSource as string) || !questionAssumptionsOk(event.questionAssumptions)) return fail("Report every choice together.");
    return validateRetirementIntent(event.intent, parse);
  }
  return fail("Report one of the supported choice steps.");
}

/** Turns a question's draft plus, when the question gave no month, the month the person typed or accepted from the plan into the complete step. Nothing is guessed. An unstated start is today; a LATER start the question stated (a null start in the draft) is refused until the person has acknowledged the notice that the start is today, and is never replaced silently. */
export function retirementCompleteEvent(draft: RetirementDraft, parse: RetirementParseContext, resolution: { value: string; source: "typed" | "plan-candidate" } | null, acknowledgedStartToday = false):
  { ok: true; event: Extract<RetirementChoicesEvent, { step: "complete" }> } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  if (!liveContextOk(parse) || !validateRetirementDraft(draft, parse).ok) return no("These details are out of date. Start again.");
  if (draft.accountId === null || draft.extra.kind === null || draft.extra.amount === null) return no("Choose the account, the amount and whether it is monthly or once.");
  if (draft.startDate === null && !acknowledgedStartToday) return no("This starts today. Starting on a later date isn't supported yet.");
  let month: string, monthSource: RetirementMonthSource;
  if (draft.retirementMonth !== null) {
    if (resolution !== null) return no("Your question already gave a retirement month.");
    month = draft.retirementMonth; monthSource = "question";
  } else {
    if (!record(resolution) || !keys(resolution, ["value", "source"]) || (resolution.source !== "typed" && resolution.source !== "plan-candidate") || typeof resolution.value !== "string") return no("Choose a retirement month.");
    month = resolution.value; monthSource = resolution.source;
  }
  const event: Extract<RetirementChoicesEvent, { step: "complete" }> = {
    step: "complete", intent: { version: 1, accountId: draft.accountId, extra: { kind: draft.extra.kind, amount: draft.extra.amount }, startDate: parse.today, retirementMonth: month },
    monthSource, questionAssumptions: { annualReturnPct: draft.assumptions.annualReturnPct, inflationPct: draft.assumptions.inflationPct },
  };
  return validateRetirementChoicesEvent(event, parse).ok ? { ok: true, event } : no(RETIREMENT_PROBLEMS.month);
}

/** The review the card shows: the complete step plus what was read for that account. Copies everything; a plan-candidate month must be exactly the plan's saved month. */
export function buildRetirementReview(event: RetirementChoicesEvent, read: RetirementContextRead, parse: RetirementParseContext): { ok: true; review: RetirementReview } | { ok: false; reason: string } {
  const no = () => ({ ok: false as const, reason: "These details are out of date. Start again." });
  if (!liveContextOk(parse) || !record(event) || event.step !== "complete" || !validateRetirementChoicesEvent(event, parse).ok || !record(read) || !keys(read, ["context", "inflation"])) return no();
  const review: RetirementReview = { intent: structuredClone(event.intent), context: structuredClone(read.context), inflation: structuredClone(read.inflation), monthSource: event.monthSource, questionAssumptions: structuredClone(event.questionAssumptions) };
  return checkReview(review, parse).ok ? { ok: true, review } : no();
}

// ---- Content -----------------------------------------------------------------------------------------------------
export type ResultRow = { label: string; baseline: string; scenario: string; difference: string };
export type ResultContent = {
  heading: string; dateLine: string; unitLine: string; rows: (ResultRow & { id: "no-growth" | "confirmed-return" })[]; across: string | null;
  sensitivity: { heading: string; rows: ResultRow[] } | null; exactDeposits: string; fallback: string | null; details: string[]; caution: string; canExplore: boolean;
};
/** `primary` is the one action on the card: choosing a return, but only when a recorded value lets a balance be shown; otherwise Change the details. */
export type DepositsOnlyContent = { heading: string; exactDeposits: string; fallback: string; details: string[]; caution: string; offers: string[]; primary: string };
/** `candidates` prefill the card's return and inflation fields: the question's own numbers first, then the saved inflation. A default return is never prefilled and nothing here is confirmed. */
export type ReviewContent = {
  heading: string; facts: { label: string; value: string }[]; primary: string; secondary: string[]; needs: ("contribution" | "worth")[]; candidates: { returnPct: string | null; inflationPct: string | null };
  /** Why the offer looks the way it does when the plan cannot supply a usable value or return. */
  notice: { tone: "warn"; text: string } | null;
  /** What the figures leave out, shown in a disclosure. */
  details: string[];
};
const NO_VALUE_NOTICE = "There is no recorded value for this account, so I can only show the extra deposits.";
const NO_RETURN_NOTICE = "No saved return was found, and I haven't picked one for you. You can see the balance with no investment growth, or choose a return.";
export const retirementUseQuestionReturn = (annualPct: string): string => `Use ${annualPct}% a year, as you asked`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const retirementMonthText = (month: string): string => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
export const retirementIllustrativeBalance = (month: string): string => `Illustrative balance at ${retirementMonthText(month)}`;
const whole = (n: number) => group(BigInt(Math.abs(n)).toString());
export const retirementMoneyText = (e: RetirementEstimate): string => (e.lessThanTen ? "less than $10" : e.roundedDollars < 0 ? `-$${whole(e.roundedDollars)}` : `$${whole(e.roundedDollars)}`);
export const retirementDifferenceText = (e: RetirementEstimate): string => {
  if (e.lessThanTen) return `less than $10 ${e.sign === "negative" ? "less" : "more"}`;
  if (e.sign === "zero" || e.roundedDollars === 0) return "no change";
  return `$${whole(e.roundedDollars)} ${e.sign === "negative" ? "less" : "more"}`;
};
export function retirementExactMoneyText(amount: string): string {
  const negative = amount.startsWith("-"), [integer, fraction = ""] = amount.replace("-", "").split(".");
  return `${negative ? "-" : ""}$${group(integer)}.${fraction.padEnd(2, "0")}`;
}
const dollarsText = (amount: string) => (amount.includes(".") ? retirementExactMoneyText(amount) : `$${group(amount.replace("-", ""))}`.replace(/^\$/, amount.startsWith("-") ? "-$" : "$"));
const extraText = (intent: RetirementIntent) => `${dollarsText(intent.extra.amount)} ${intent.extra.kind === "monthly" ? "each month" : "once"}`;
const ROW = (label: string, d: PreviewCalculation["noGrowth"]["display"]): ResultRow => ({ label, baseline: retirementMoneyText(d.baseline), scenario: retirementMoneyText(d.scenario), difference: retirementDifferenceText(d.difference) });
const OMITTED = "Taxes, fees, an employer match and contribution limits are not included.";
const UNCHANGED = "Nothing in your accounts was changed.";

export function retirementResultContent(calc: PreviewCalculation): ResultContent {
  const { intent, context, assumptions } = calc.scenario, power = assumptions.purchasingPower;
  const none = calc.noGrowth, plan = calc.confirmedReturn;
  const rows: ResultContent["rows"] = [{ id: "no-growth", ...ROW(RETIREMENT_COPY.noGrowth, none.display) }];
  let across: string | null = null;
  if (plan) {
    rows.push({ id: "confirmed-return", ...ROW(`${RETIREMENT_COPY.confirmedReturn} (${plan.annualReturnPct}% a year)`, plan.display) });
    const pair = [none.display.scenario, plan.display.scenario].sort((a, b) => a.roundedDollars - b.roundedDollars);
    across = pair[0].roundedDollars === pair[1].roundedDollars
      ? `${RETIREMENT_COPY.acrossTwo}, the balance with the extra rounds to the same amount: ${retirementMoneyText(pair[0])}.`
      : `${RETIREMENT_COPY.acrossTwo}, the balance with the extra is about ${retirementMoneyText(pair[0])} to ${retirementMoneyText(pair[1])}.`;
  }
  const sensitivity = calc.sensitivity.length === 3
    ? { heading: "Other returns, based on the rates you entered", rows: calc.sensitivity.map(s => ROW(`At ${s.annualReturnPct}% a year`, s.display)) } : null;
  return {
    heading: `Adding ${extraText(intent)} to ${context.account.name}`,
    dateLine: retirementIllustrativeBalance(intent.retirementMonth),
    unitLine: power.kind === "today" ? `Shown in today's dollars, using ${power.inflationPct}% inflation a year for both figures.` : "Shown in future dollars, not adjusted for inflation.",
    rows, across, sensitivity,
    exactDeposits: `Extra deposits: ${retirementExactMoneyText(calc.extraDeposits)} in total (exact, before any growth).`,
    fallback: plan ? null : "No investment growth forecast was made.",
    details: ["Growth is worked out each month, then your deposit is added at the end of that month.", "Both figures use the same assumptions; only the extra deposit differs.", OMITTED, UNCHANGED],
    caution: "These are illustrations, not predictions. Real results could be lower than both or higher than both.",
    canExplore: plan !== null && sensitivity === null,
  };
}
export function retirementDepositsOnlyContent(calc: DepositsOnlyCalculation): DepositsOnlyContent {
  const { intent, context } = calc.scenario, canChoose = context.currentValue !== null;
  return {
    heading: `Extra deposits of ${extraText(intent)} into ${context.account.name}`,
    exactDeposits: `Extra deposits: ${retirementExactMoneyText(calc.extraDeposits)} in total (exact).`,
    fallback: "No investment growth forecast was made.",
    details: [OMITTED, UNCHANGED],
    caution: "This is the exact sum of the money you would add, not a forecast of what it would become.",
    // With no recorded value there is nothing to grow, and no baseline may be invented, so a return cannot be chosen.
    offers: canChoose ? [RETIREMENT_COPY.chooseReturn] : [], primary: canChoose ? RETIREMENT_COPY.chooseReturn : RETIREMENT_PRIMARY_ACTION.result,
  };
}
export function retirementReviewContent(review: RetirementReview): ReviewContent {
  const { intent, context, inflation, questionAssumptions: asked } = review, c = context.contribution, r = context.returnAssumption;
  const monthsAway = monthsUntil(intent.startDate, intent.retirementMonth);
  const monthNote = review.monthSource === "plan-candidate" ? ", from your plan" : review.monthSource === "typed" ? ", the month you picked" : "";
  const facts = [
    { label: "Account", value: context.account.name },
    { label: "Account value", value: context.currentValue === null ? "No recorded value" : `${dollarsText(context.currentValue)} (recorded)` },
    { label: "Extra", value: `${extraText(intent)}, starting today` },
    { label: "Retirement month", value: `${retirementMonthText(intent.retirementMonth)} (${monthsAway === 0 ? "this month" : monthsAway === 1 ? "1 month from now" : `${monthsAway} months from now`})${monthNote}` },
    ...(context.retirementMonth !== null && context.retirementMonth !== intent.retirementMonth ? [{ label: "Month in your plan", value: `${retirementMonthText(context.retirementMonth)}${retirementSavedMonthBeyondLimit(context.retirementMonth, context.source.asOf) ? " (later than this illustration can calculate)" : ""}` }] : []),
    { label: "Adding now", value: c.kind === "saved" ? `${dollarsText(c.monthlyAmount)} each month (saved in your plan)`
      : c.kind === "history" ? `${dollarsText(c.monthlyAmount)} each month (average of your last ${c.monthCount} full months from your records)` : "No recorded amount. Enter your own, even if it is $0." },
    { label: "Return", value: r.kind === "stored-plan" ? `${r.annualPct}% a year (saved in your plan)` : r.kind === "application-default" ? `${r.annualPct}% a year is the app's starting value, not a return you chose` : "No return assumption" },
    ...(asked.annualReturnPct !== null ? [{ label: "Return in your question", value: `${asked.annualReturnPct}% a year` }] : []),
    { label: "Inflation", value: inflation.kind === "stored" ? `${inflation.pct}% a year (saved)` : inflation.kind === "application-default" ? `${inflation.pct}% a year is the app's starting value, not a choice you made` : "No inflation assumption" },
    ...(asked.inflationPct !== null ? [{ label: "Inflation in your question", value: `${asked.inflationPct}% a year` }] : []),
  ];
  const needs: ReviewContent["needs"] = [];
  if (context.currentValue === null) needs.push("worth"); else if (c.kind === "missing") needs.push("contribution");
  const hasValue = context.currentValue !== null, savedReturn = r.kind === "stored-plan" && hasValue, askedReturn = asked.annualReturnPct !== null && hasValue;
  const others = [...(askedReturn && savedReturn ? [RETIREMENT_COPY.usePlan] : []), ...(hasValue ? [RETIREMENT_COPY.depositsOnly] : []), ...(hasValue ? [RETIREMENT_COPY.chooseReturn] : [])];
  return {
    heading: savedReturn && !askedReturn ? "Use your saved plan?" : "What would you like to see?", facts, needs,
    // Checklist U4: without a usable return but with a recorded value, the no-growth BALANCE is the primary; exact deposits only is the fallback when there is no value.
    primary: askedReturn ? retirementUseQuestionReturn(asked.annualReturnPct!) : savedReturn ? RETIREMENT_COPY.usePlan : hasValue ? RETIREMENT_COPY.noGrowthBalance : RETIREMENT_COPY.depositsOnly,
    // The primary is never repeated among the other choices; without a recorded value only the exact deposits path remains.
    secondary: !hasValue ? [] : askedReturn ? others : [RETIREMENT_COPY.depositsOnly, RETIREMENT_COPY.chooseReturn],
    candidates: { returnPct: asked.annualReturnPct, inflationPct: asked.inflationPct ?? (inflation.kind === "missing" ? null : inflation.pct) },
    details: [OMITTED, "Nothing in your accounts is changed."],
    notice: !hasValue ? { tone: "warn", text: NO_VALUE_NOTICE } : !savedReturn && !askedReturn ? { tone: "warn", text: NO_RETURN_NOTICE } : null,
  };
}
const PROMPTS: Record<RetirementDraft["missing"][number], string> = {
  account: "Which investment account is this for?", "extra-amount": "How much extra would you add?", cadence: "Would that be each month, or just once?",
  "start-date": "This starts today. Starting on a later date isn't supported yet.", "retirement-month": "Which month do you plan to stop adding?",
};
export function retirementChoicePrompts(draft: RetirementDraft): { choice: RetirementDraft["missing"][number]; prompt: string }[] {
  return draft.missing.map(choice => ({ choice, prompt: PROMPTS[choice] }));
}

/** A typed month can be used when it is a real year and month, this month or later, and within 100 years of the given day. */
export function retirementMonthUsable(month: unknown, today: string): boolean {
  if (typeof month !== "string" || !MONTH_TEXT.test(month) || dateOutOfRange(month + "-01") || typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today) || dateOutOfRange(today)) return false;
  const steps = monthsUntil(today, month);
  return steps >= 0 && steps <= 1200;
}
/** A saved month that is well formed but cannot be calculated: after December 2100, or more than 1,200 months from today. Passed, usable and malformed months are not. */
export function retirementSavedMonthBeyondLimit(month: unknown, today: string): boolean {
  if (typeof month !== "string" || !MONTH_TEXT.test(month) || typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today) || dateOutOfRange(today)) return false;
  if (month <= today.slice(0, 7)) return false;
  return dateOutOfRange(month + "-01") || monthsUntil(today, month) > 1200;
}
/** Plain words for the choices card: what the plan has saved, why it cannot be used, and what to do. */
export const retirementSavedMonthLimitMessage = (month: string): string =>
  `Your plan has a saved retirement month of ${retirementMonthText(month)}. This illustration can only reach December 2100, and no more than 1,200 months from now, so choose a month in that range.`;
/** The answers given on the choices card for the items the question left open. */
export type RetirementChoiceAnswers = { accountId: number | null; amount: string | null; cadence: "monthly" | "once" | null; startToday: boolean };
/** The draft with the person's answers filled in where the question left them open, and the list of what is still missing recomputed. What the question already said is never overridden, and a later start the question stated stays open until the person agrees it starts today. */
export function retirementDraftWithAnswers(draft: RetirementDraft, answers: RetirementChoiceAnswers, today: string): RetirementDraft {
  const next: RetirementDraft = structuredClone(draft);
  if (next.accountId === null && answers.accountId !== null) next.accountId = answers.accountId;
  if (next.extra.amount === null && answers.amount !== null) next.extra.amount = answers.amount;
  if (next.extra.kind === null && answers.cadence !== null) next.extra.kind = answers.cadence;
  if (next.startDate === null && answers.startToday) next.startDate = today;
  const missing: RetirementDraft["missing"] = [];
  if (next.accountId === null) missing.push("account");
  if (next.extra.amount === null) missing.push("extra-amount");
  if (next.extra.kind === null) missing.push("cadence");
  if (next.startDate === null) missing.push("start-date");
  if (next.retirementMonth === null) missing.push("retirement-month");
  next.missing = missing;
  return next;
}

/** What the card says first: nothing is calculated, what was understood from the question, and what happens next. */
export function retirementChoicesIntro(draft: RetirementDraft): string {
  const { kind, amount } = draft.extra;
  const understood = amount === null ? "" : ` I understood: ${kind === "monthly" ? `an extra ${dollarsText(amount)} each month` : kind === "once" ? `a one-time ${dollarsText(amount)}` : `an extra ${dollarsText(amount)}`}, starting today.`;
  return `Nothing has been calculated yet.${understood} I will ${draft.accountId === null ? "read the account you pick, then " : ""}show you the details to confirm.`;
}

// ---- The review form ------------------------------------------------------------------------------------------------------------------------------------------
/** What the person has typed or picked on the review card. Text is kept as typed; the consent builder judges it. */
export type RetirementReviewForm = { amount: string; chooseReturn: boolean; returnPct: string; todays: boolean; inflation: string | null };
/** Which button was pressed: the primary one, "Use my saved plan" as a secondary, or exact deposits only. */
export type RetirementReviewAction = "primary" | "plan" | "deposits";
const DEPOSITS_ONLY_CHOICES: RetirementChoices = { view: "extra-deposits-only", contribution: null, returns: { kind: "no-growth" }, sensitivity: null, purchasingPower: { kind: "nominal" } };
/** The choices a button stands for, built only from what the card shows. It may produce values the builder refuses (an empty or out-of-range number); it never repairs them and is never consent. */
export function retirementReviewChoices(review: RetirementReview, form: RetirementReviewForm, action: RetirementReviewAction): RetirementChoices {
  const content = retirementReviewContent(review);
  if (action === "deposits" || review.context.currentValue === null) return structuredClone(DEPOSITS_ONLY_CHOICES);
  const kind = action === "plan" ? "plan" : form.chooseReturn ? "typed" : content.primary === RETIREMENT_COPY.usePlan ? "plan" : content.primary === RETIREMENT_COPY.noGrowthBalance ? "none" : "asked";
  const returns: RetirementChoices["returns"] = kind === "plan" ? { kind: "stored-plan" } : kind === "none" ? { kind: "no-growth" } : { kind: "explicit", annualPct: kind === "asked" ? content.candidates.returnPct ?? "" : form.returnPct };
  return {
    view: "balances", returns, sensitivity: null,
    contribution: review.context.contribution.kind === "missing" ? { basis: "manual", amount: form.amount } : { basis: "context" },
    purchasingPower: form.todays ? { kind: "today", inflationPct: form.inflation ?? content.candidates.inflationPct ?? "" } : { kind: "nominal" },
  };
}

/** The same review with another retirement month the person typed. The original is untouched; the month counts as typed. Refused in plain words when the contract refuses it. */
export function withRetirementMonth(review: RetirementReview, month: string): { ok: true; review: RetirementReview } | { ok: false; reason: string } {
  if (!record(review) || !record(review.context) || !record(review.context.source) || !record(review.context.account)) return { ok: false, reason: "These details are out of date. Start again." };
  if (typeof month !== "string") return { ok: false, reason: RETIREMENT_PROBLEMS.month };
  const next: RetirementReview = { ...structuredClone(review), monthSource: "typed" };
  next.intent.retirementMonth = month;
  const parse = { today: review.context.source.asOf, investmentAccounts: [{ id: review.context.account.id, name: review.context.account.name }] };
  return validateRetirementScreen({ stage: "review", review: next }, parse).ok ? { ok: true, review: next } : { ok: false, reason: RETIREMENT_PROBLEMS.month };
}

/** Exploring other returns is a new consent. There is no review at that point, only the shown result, so the confirmed scenario it carries is copied and the three rates are added to its confirmed return. */
export function buildExploreConfirmation(calculation: PreviewCalculation, sensitivity: RetirementSensitivity): { ok: true; scenario: ConfirmedRetirementScenario } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  const stale = "These details are out of date. Start again.";
  if (!record(calculation) || calculation.kind !== "preview" || !record(calculation.scenario) || !record(calculation.scenario.context) || !validateRetirementContext(calculation.scenario.context).ok) return no(stale);
  if (!validateConfirmedRetirementScenario(calculation.scenario, liveOf(calculation.scenario.context)).ok) return no(stale);
  const returns = calculation.scenario.assumptions.returns;
  if (returns.kind !== "confirmed-return") return no("Other returns need a confirmed return first.");
  if (returns.sensitivity !== null) return no("Other returns are already shown.");
  if (!record(sensitivity) || !keys(sensitivity, ["lower", "base", "higher"]) || ![sensitivity.lower, sensitivity.base, sensitivity.higher].every(v => typeof v === "string")) return no(RETIREMENT_PROBLEMS.otherReturns);
  const scenario = structuredClone(calculation.scenario);
  (scenario.assumptions.returns as { sensitivity: RetirementSensitivity | null }).sensitivity = { lower: sensitivity.lower, base: sensitivity.base, higher: sensitivity.higher };
  const check = validateConfirmedRetirementScenario(scenario, liveOf(scenario.context));
  return check.ok ? { ok: true, scenario } : no(check.code === "unsupported-number" ? "One of these values is too precise to use. Choose simpler numbers." : RETIREMENT_PROBLEMS.otherReturns);
}

// ---- Flow copy ----------------------------------------------------------------------------------------------------------------------------------
export const RETIREMENT_CHANGED_MESSAGE = CHANGED_BODY;
const ALTERNATIVE = "I can show how extra money added to one investment account could change its balance by a retirement month.";
const UNSUPPORTED_MESSAGES: Record<UnsupportedCode, string> = {
  income: "I can't estimate income in retirement yet. " + ALTERNATIVE,
  advice: "I can't tell you whether that is enough, or whether to do it. " + ALTERNATIVE,
  "employer-match": "I don't include an employer match. I can show only what you add yourself to one investment account by a retirement month.",
  tax: "I don't work out taxes. I can show the extra money you add to one investment account, before taxes.",
  fees: "I don't include fees. I can show the extra money you add to one investment account, before fees.",
  "contribution-limit": "I can't check contribution limits. I can show what an extra amount could add to one investment account.",
  "multi-account": "I look at one investment account at a time. I can show one account now, and you can ask about the other afterward.",
  "account-not-found": "I couldn't find an investment account with that name. I can show any investment account in your list if you name it.",
  "no-investment-account": "You don't have an investment account yet. Once you add one, I can show how extra money added to it could change its balance.",
  cadence: "I can work out an extra amount each month or a one-time amount. Weekly and yearly amounts aren't available yet.",
  reduction: "I can estimate extra money added to an investment account, not less. For spending cuts, ask about a spending category instead.",
  condition: "I can't include \"only if\" conditions. I can show the numbers for a fixed amount that you choose.",
  "rate-out-of-range": "I can use a yearly return from -100% to 100%. Choose a number in that range, or leave it out and I'll offer your saved plan.",
  "past-date": "That month has already passed. Choose this month or later.",
  "date-range": "I can look ahead only to the year 2100. Choose an earlier retirement month.",
  "question-too-long": "That question is longer than 512 characters. Please shorten it.",
  "amount-precision": "Amounts can have at most two decimal places, like $50.25, so they stay in whole cents.",
};
export const retirementUnsupportedMessage = (code: UnsupportedCode): string => UNSUPPORTED_MESSAGES[code] ?? "I can't help with that question yet.";
export const retirementExploreContent = () => ({
  heading: RETIREMENT_COPY.explore,
  intro: "These are rates you choose. They show how the numbers change with those rates, not what is likely to happen.",
  labels: ["Lower return (% a year)", "Your confirmed return (% a year)", "Higher return (% a year)"],
  problem: RETIREMENT_PROBLEMS.otherReturns,
  primary: RETIREMENT_PRIMARY_ACTION.explore,
});
export const retirementReadingMessage = (name: string | null): string => `Reading ${name ?? "your investment account"}… Nothing has been calculated yet.`;
/** What assistive technology hears when a state appears. "alert" interrupts; "status" waits for a pause; focus moves to the dialog. A null heading means the title comes from the state's content builder (it names the account or amount). */
export const RETIREMENT_ANNOUNCEMENTS: Readonly<Record<RetirementStage, { heading: string | null; live: "alert" | "status" | "none" }>> = {
  choices: { heading: "A few details to confirm", live: "none" }, reading: { heading: "Reading your account", live: "status" }, review: { heading: null, live: "none" },
  result: { heading: null, live: "status" }, "deposits-only": { heading: null, live: "status" }, blocked: { heading: "A few details need attention", live: "alert" },
  explore: { heading: "Explore other returns", live: "none" }, unsupported: { heading: "I can't do that yet", live: "status" }, stale: { heading: "Your details changed", live: "alert" }, error: { heading: "I couldn't read that account", live: "alert" },
};
/** Labels of the controls the review card and choices need. */
export const RETIREMENT_FIELDS = {
  manualAmount: "Amount you add now (dollars a month)", explicitReturn: "Return you choose (% a year)", purchasingPower: "Show amounts in",
  futureDollars: "Future dollars (not adjusted for inflation)", todaysDollars: "Today's dollars", inflation: "Inflation (% a year)", useReturn: "Use this return",
  retirementMonth: "Retirement month", account: "Investment account",
} as const;
