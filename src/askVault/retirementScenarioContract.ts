import { CHANGED_BODY } from "./changedState";
import type { Projection, ProjectionInput } from "../accumulation";
import type { AskClarification } from "./types";
import { date as isDate } from "../contractChecks";
import { dateOutOfRange } from "../dateRange";

/** M5 domain contracts only. Native transport, parser, calculator and controller are separate workers. */
export type RetirementParseContext = {
  today: string;
  investmentAccounts: readonly { id: number; name: string }[];
  /** The Dashboard's spending categories. Used only to notice an instruction that mixes a category with an account; never authorization. */
  categories?: readonly string[];
  /** Store names the profile already knows; a question that begins with one is an ordinary spending question. */
  merchants?: readonly string[];
};
export type RetirementExtra = { kind: "monthly" | "once"; amount: string };
export type RetirementIntent = {
  version: 1;
  accountId: number;
  extra: RetirementExtra;
  /** Month zero is the confirmed app-owned as-of date, not a future scheduled deposit. */
  startDate: string;
  retirementMonth: string;
};
export type RetirementChoice = "account" | "extra-amount" | "cadence" | "start-date" | "retirement-month";
export type RetirementDraft = {
  sourceText: string;
  accountId: number | null;
  extra: { kind: RetirementExtra["kind"] | null; amount: string | null };
  startDate: string | null;
  retirementMonth: string | null;
  assumptions: { annualReturnPct: string | null; inflationPct: string | null };
  missing: RetirementChoice[];
  /** UTF-16 spans into sourceText; evidence, never consent or a guessed date. */
  hints: { field: "account" | "start-date" | "retirement-month" | "return" | "inflation"; text: string; start: number; end: number }[];
};
export type RetirementParseOutcome =
  | { kind: "retirement"; draft: RetirementDraft }
  | { kind: "retirement-clarify"; clarification: AskClarification }
  | { kind: "retirement-unsupported"; reason: string }
  | null;
export type ParseRetirementScenario = (text: string, context: RetirementParseContext) => RetirementParseOutcome;

/** The native-context worker must define how settings changes participate in this identity. */
export type RetirementSource = {
  generation: number;
  sessionRevision: number;
  revision: { local: number; external: number };
  settingsRevision: number;
  asOf: string;
};
export type RetirementContribution =
  | { kind: "saved"; monthlyAmount: string }
  | { kind: "history"; monthlyAmount: string; fromMonth: string; toMonth: string; monthCount: number }
  | { kind: "missing" };
export type RetirementReturn =
  /** A persisted value, not proof that a person explicitly chose that field in the past. */
  | { kind: "stored-plan"; annualPct: string }
  | { kind: "application-default"; annualPct: string }
  | { kind: "missing" };
/** The saved inflation setting offered as a candidate for today's-dollar figures; never a confirmation. */
export type RetirementInflationCandidate =
  | { kind: "stored"; pct: string }
  | { kind: "application-default"; pct: string }
  | { kind: "missing" };
export type RetirementContext = {
  version: 1;
  account: { id: number; name: string; type: "investment" };
  source: RetirementSource;
  /** Recorded account worth, not cash balance. Null and a recorded zero are distinct. */
  currentValue: string | null;
  contribution: RetirementContribution;
  returnAssumption: RetirementReturn;
  /** Candidate only; the person must confirm the retirement month. */
  retirementMonth: string | null;
};
export type RetirementContextRequest = { version: 1; accountId: number; expectedSource: RetirementSource | null };
/** One authorized read: the account context plus the saved-inflation candidate. */
export type RetirementContextRead = { context: RetirementContext; inflation: RetirementInflationCandidate };
export type RetirementContextClient = { readRetirementContext: (request: RetirementContextRequest) => Promise<RetirementContextRead> };
export type ReadRetirementContextArgs = {
  accountId: number;
  client: RetirementContextClient;
  currentSource: () => RetirementSource | null;
  signal?: AbortSignal;
};
export type RetirementContextResult =
  | ({ status: "context" } & RetirementContextRead)
  | { status: "stale"; message: string }
  | { status: "error"; message: string };
export type ReadRetirementContext = (args: ReadRetirementContextArgs) => Promise<RetirementContextResult>;

export type RetirementSensitivity = { lower: string; base: string; higher: string };
export type RetirementAssumptions = {
  view: "balances" | "extra-deposits-only";
  monthlyContribution: { basis: "context" | "manual"; amount: string } | null;
  returns:
    | { kind: "no-growth" }
    | { kind: "confirmed-return"; annualPct: string; basis: "stored-plan" | "explicit"; sensitivity: RetirementSensitivity | null };
  purchasingPower: { kind: "nominal" } | { kind: "today"; inflationPct: string };
};
/** Static validation is not fresh consent. The controller must bind this to its current review. */
export type ConfirmedRetirementScenario = {
  intent: RetirementIntent;
  context: RetirementContext;
  assumptions: RetirementAssumptions;
  confirmed: true;
};
export type RetirementLiveContext = RetirementParseContext & { source: RetirementSource };
export type RetirementEstimate = {
  /** Rounded dollars, not cents; negative zero must be normalized to zero. */
  roundedDollars: number;
  roundingStepDollars: 10 | 100 | 1000;
  /** Preserve direction when a nonzero raw estimate would round to zero. */
  sign: "positive" | "negative" | "zero";
  lessThanTen: boolean;
};
export type RetirementIllustration = {
  annualReturnPct: string;
  /** Full authoritative outputs remain NOMINAL; user-facing amounts below carry their own unit. */
  baseline: Projection;
  scenario: Projection;
  display: { baseline: RetirementEstimate; scenario: RetirementEstimate; difference: RetirementEstimate };
};
export type RetirementCalculation =
  | { kind: "refused"; code: "invalid-input" | "unsupported-number"; message: string }
  | { kind: "extra-deposits-only"; scenario: ConfirmedRetirementScenario; months: number; extraDeposits: string; unit: "nominal-dollars"; growthForecastMade: false }
  | {
      kind: "preview";
      scenario: ConfirmedRetirementScenario;
      months: number;
      extraDeposits: string;
      seriesUnit: "nominal-dollars";
      displayUnit: "nominal-dollars" | "today-dollars";
      noGrowth: RetirementIllustration;
      confirmedReturn: RetirementIllustration | null;
      sensitivity: [] | [RetirementIllustration, RetirementIllustration, RetirementIllustration];
    };
export type CalculateRetirementScenario = (confirmed: ConfirmedRetirementScenario) => RetirementCalculation;
/** Same inputs/outputs as the existing authority; implementation/parity belongs to prerequisite3. */
export type ProjectRetirementAccount = (input: ProjectionInput) => Projection;
export type FormatRetirementEstimate = (value: number) => RetirementEstimate;
export type RetirementValidation = { ok: true } | {
  ok: false;
  code: "invalid-shape" | "invalid-account" | "invalid-money" | "invalid-schedule" | "invalid-source" | "invalid-assumptions" | "unsupported-number" | "stale";
  reason: string;
};

type Row = Record<string, unknown>;
const success = (): RetirementValidation => ({ ok: true });
const fail = (code: Exclude<RetirementValidation, { ok: true }>["code"], reason: string): RetirementValidation => ({ ok: false, code, reason });
const record = (v: unknown): v is Row => !!v && typeof v === "object" && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const keys = (v: Row, names: readonly string[]) => Reflect.ownKeys(v).length === names.length && names.every(n => Object.prototype.hasOwnProperty.call(v, n));
/** A plain array exactly as it arrived: Array.prototype, no holes, and no extra, hidden or symbol own properties (an array's own keys are its indices plus length). */
export const plainArray = (v: unknown): v is unknown[] => Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype && Reflect.ownKeys(v).length === v.length + 1;
const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const counter = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const label = (v: unknown): v is string => typeof v === "string" && !!v.trim();
const day = (v: unknown): v is string => isDate(v) && !dateOutOfRange(v as string);
const month = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}$/.test(v) && day(v + "-01");
const monthIndex = (v: string) => Number(v.slice(0, 4)) * 12 + Number(v.slice(5, 7)) - 1;
const MAX_DECIMAL = 79228162514264337593543950335n;
type Decimal = { coefficient: bigint; scale: number };

/** Native decimal wire bounds. Forecast conversion is a distinct, stricter boundary. */
function decimal(v: unknown, signed = false, maxScale = 28): Decimal | null {
  if (typeof v !== "string" || v.length > 64 || !/^-?(0|[1-9]\d*)(?:\.\d+)?$/.test(v) || (!signed && v.startsWith("-"))) return null;
  const [whole, fraction = ""] = v.split(".");
  if (fraction.length > maxScale) return null;
  let coefficient = BigInt(whole.replace("-", "") + fraction), scale = fraction.length;
  while (scale && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
  if (coefficient > MAX_DECIMAL) return null;
  return { coefficient: v.startsWith("-") ? -coefficient : coefficient, scale };
}
function decimalText({ coefficient, scale }: Decimal): string {
  const sign = coefficient < 0n ? "-" : "", digits = (coefficient < 0n ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  return sign + (scale ? digits.slice(0, -scale) + "." + digits.slice(-scale) : digits);
}
function compare(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale), difference = a.coefficient * 10n ** BigInt(scale - a.scale) - b.coefficient * 10n ** BigInt(scale - b.scale);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
const sameAmount = (a: string, b: string) => compare(decimal(a, true)!, decimal(b, true)!) === 0;
function add(a: string, b: string): string {
  const x = decimal(a, true)!, y = decimal(b, true)!, scale = Math.max(x.scale, y.scale);
  return decimalText({ coefficient: x.coefficient * 10n ** BigInt(scale - x.scale) + y.coefficient * 10n ** BigInt(scale - y.scale), scale });
}

/** Shown on the refusal card when a balance cannot be calculated accurately. It names only what the card offers (Close, Change the details); owner decision, 20 Oct 2026. */
export const RETIREMENT_REFUSAL_MESSAGE = "I couldn't calculate a balance accurately with these details. Choose \"Change the details\" to revise them.";

/** Reject a changed decimal round-trip; binary projection arithmetic itself remains approximate. */
export function retirementProjectionNumber(value: string): number {
  const input = decimal(value, true), result = Number(value);
  if (!input || !Number.isFinite(result)) throw new Error("This value cannot be represented by the retirement projection.");
  const [mantissa, exponent = "0"] = result.toString().split("e");
  const negative = mantissa.startsWith("-"), unsigned = negative ? mantissa.slice(1) : mantissa;
  const [whole, fraction = ""] = unsigned.split("."), digits = whole + fraction, position = whole.length + Number(exponent);
  const expanded = (negative ? "-" : "") + (position <= 0 ? "0." + "0".repeat(-position) + digits
    : position >= digits.length ? digits + "0".repeat(position - digits.length) : digits.slice(0, position) + "." + digits.slice(position));
  const roundTrip = decimal(expanded, true);
  if (!roundTrip || compare(input, roundTrip) !== 0) throw new Error("This value loses decimal precision in the retirement projection.");
  return Object.is(result, -0) ? 0 : result;
}

export function validateRetirementRate(value: unknown, mode: "saved" | "preview"): RetirementValidation {
  const v = decimal(value, mode === "preview");
  if ((mode !== "saved" && mode !== "preview") || !v || compare(v, { coefficient: mode === "saved" ? 0n : -100n, scale: 0 }) < 0 || compare(v, { coefficient: 100n, scale: 0 }) > 0)
    return fail("invalid-assumptions", mode === "saved" ? "Use a saved rate between 0 and 100%." : "Use a preview rate between -100 and 100%.");
  return success();
}
function roster(context: RetirementParseContext): boolean {
  return !!context && day(context.today) && plainArray(context.investmentAccounts) &&
    context.investmentAccounts.every(v => record(v) && keys(v, ["id", "name"]) && id(v.id) && label(v.name)) &&
    new Set(context.investmentAccounts.map(v => v.id)).size === context.investmentAccounts.length;
}
function validSource(v: unknown): v is RetirementSource {
  return record(v) && keys(v, ["generation", "sessionRevision", "revision", "settingsRevision", "asOf"]) && counter(v.generation) && counter(v.sessionRevision) &&
    counter(v.settingsRevision) && day(v.asOf) && record(v.revision) && keys(v.revision, ["local", "external"]) && counter(v.revision.local) && counter(v.revision.external);
}
function sameSource(a: RetirementSource, b: RetirementSource): boolean {
  return a.generation === b.generation && a.sessionRevision === b.sessionRevision && a.settingsRevision === b.settingsRevision && a.asOf === b.asOf &&
    a.revision.local === b.revision.local && a.revision.external === b.revision.external;
}

export function validateRetirementIntent(value: unknown, context: RetirementParseContext): RetirementValidation {
  if (!record(value) || !keys(value, ["version", "accountId", "extra", "startDate", "retirementMonth"]) || value.version !== 1)
    return fail("invalid-shape", "Choose a supported retirement contribution preview.");
  if (!context || !day(context.today)) return fail("invalid-schedule", "Refresh the current app date before reviewing retirement assumptions.");
  if (!roster(context) || !id(value.accountId) || !context.investmentAccounts.some(a => a.id === value.accountId)) return fail("invalid-account", "Choose one current investment account.");
  if (!record(value.extra) || !keys(value.extra, ["kind", "amount"]) || (value.extra.kind !== "monthly" && value.extra.kind !== "once") || !decimal(value.extra.amount, false, 2))
    return fail("invalid-money", "Choose monthly or once, with a nonnegative dollar amount of at most two decimals.");
  if (!day(value.startDate) || value.startDate !== context.today || !month(value.retirementMonth) ||
    monthIndex(value.retirementMonth) < monthIndex(value.startDate) || monthIndex(value.retirementMonth) - monthIndex(value.startDate) > 1200)
    return fail("invalid-schedule", "Confirm today's start and a retirement month within 1,200 monthly steps and the supported date range.");
  return success();
}

export function validateRetirementDraft(value: unknown, context: RetirementParseContext): RetirementValidation {
  if (!record(value) || !keys(value, ["sourceText", "accountId", "extra", "startDate", "retirementMonth", "assumptions", "missing", "hints"]) ||
    !label(value.sourceText) || [...value.sourceText].length > 512 || !roster(context)) return fail("invalid-shape", "Keep a supported draft and the original question, up to 512 characters.");
  if (value.accountId !== null && (!id(value.accountId) || !context.investmentAccounts.some(a => a.id === value.accountId))) return fail("invalid-account", "Choose a current investment account.");
  if (!record(value.extra) || !keys(value.extra, ["kind", "amount"]) || (value.extra.kind !== null && value.extra.kind !== "monthly" && value.extra.kind !== "once") ||
    (value.extra.amount !== null && !decimal(value.extra.amount, false, 2))) return fail("invalid-money", "Keep missing contribution terms unresolved.");
  if ((value.startDate !== null && (!day(value.startDate) || value.startDate !== context.today)) ||
    (value.retirementMonth !== null && (!month(value.retirementMonth) || monthIndex(value.retirementMonth) < monthIndex(context.today) || monthIndex(value.retirementMonth) - monthIndex(context.today) > 1200)))
    return fail("invalid-schedule", "Keep a valid current start and prospective retirement month, or leave them unresolved.");
  if (!record(value.assumptions) || !keys(value.assumptions, ["annualReturnPct", "inflationPct"]) ||
    (value.assumptions.annualReturnPct !== null && !validateRetirementRate(value.assumptions.annualReturnPct, "preview").ok) ||
    (value.assumptions.inflationPct !== null && !validateRetirementRate(value.assumptions.inflationPct, "saved").ok)) return fail("invalid-assumptions", "Keep assumption candidates explicit or unresolved.");
  const missing: RetirementChoice[] = [];
  if (value.accountId === null) missing.push("account");
  if (value.extra.amount === null) missing.push("extra-amount");
  if (value.extra.kind === null) missing.push("cadence");
  if (value.startDate === null) missing.push("start-date");
  if (value.retirementMonth === null) missing.push("retirement-month");
  const actualMissing = value.missing;
  if (!plainArray(actualMissing) || actualMissing.length !== missing.length || !missing.every((v, i) => actualMissing[i] === v)) return fail("invalid-shape", "Keep every missing choice explicitly listed.");
  const text = value.sourceText;
  const boundary = (n: number) => !(n > 0 && n < text.length && /[\uD800-\uDBFF]/.test(text[n - 1]) && /[\uDC00-\uDFFF]/.test(text[n]));
  if (!plainArray(value.hints) || !value.hints.every(v => record(v) && keys(v, ["field", "text", "start", "end"]) &&
    ["account", "start-date", "retirement-month", "return", "inflation"].includes(v.field as string) && label(v.text) && counter(v.start) && counter(v.end) &&
    (v.start as number) < (v.end as number) && (v.end as number) <= text.length && boundary(v.start as number) && boundary(v.end as number) && text.slice(v.start as number, v.end as number) === v.text))
    return fail("invalid-shape", "Keep date and account evidence tied to the original question.");
  return success();
}

/** Snapshot shape/provenance only, not native authorization, history recomputation or freshness. */
export function validateRetirementContext(value: unknown): RetirementValidation {
  if (!record(value) || !keys(value, ["version", "account", "source", "currentValue", "contribution", "returnAssumption", "retirementMonth"]) || value.version !== 1)
    return fail("invalid-shape", "The retirement context has an unsupported shape.");
  if (!record(value.account) || !keys(value.account, ["id", "name", "type"]) || !id(value.account.id) || !label(value.account.name) || value.account.type !== "investment") return fail("invalid-account", "The context must belong to one investment account.");
  if (!validSource(value.source)) return fail("invalid-source", "The context source is incomplete.");
  if (value.currentValue !== null && !decimal(value.currentValue, true)) return fail("invalid-money", "The recorded account value is invalid.");
  const c = value.contribution;
  if (!record(c)) return fail("invalid-shape", "Keep the contribution source explicit.");
  const prior = monthIndex(value.source.asOf.slice(0, 7)) - 1;
  if (!(c.kind === "missing" && keys(c, ["kind"])) && !(c.kind === "saved" && keys(c, ["kind", "monthlyAmount"]) && decimal(c.monthlyAmount)) &&
    !(c.kind === "history" && keys(c, ["kind", "monthlyAmount", "fromMonth", "toMonth", "monthCount"]) && decimal(c.monthlyAmount) && month(c.fromMonth) && month(c.toMonth) &&
      id(c.monthCount) && c.monthCount <= 6 && monthIndex(c.toMonth) === prior && monthIndex(c.toMonth) - monthIndex(c.fromMonth) + 1 === c.monthCount))
    return fail("invalid-money", "Keep a saved amount, a bounded complete-month history summary, or an explicitly missing contribution.");
  const rate = value.returnAssumption;
  if (!record(rate) || !(rate.kind === "missing" && keys(rate, ["kind"])) &&
    !(["stored-plan", "application-default"].includes(rate.kind as string) && keys(rate, ["kind", "annualPct"]) && validateRetirementRate(rate.annualPct, "saved").ok))
    return fail("invalid-assumptions", "Keep a stored return separate from a default or missing return.");
  // The saved month is evidence about the plan, not a date anyone confirmed: a well-formed month beyond the supported range (after December 2100, or more than
  // 1,200 months ahead) is kept exactly as saved. It can never become a candidate or a confirmed date; intents, drafts and every other month stay range-checked.
  if (value.retirementMonth !== null && !(typeof value.retirementMonth === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.retirementMonth))) return fail("invalid-schedule", "The saved retirement month is invalid.");
  return success();
}

export function validateRetirementContextRequest(value: unknown): RetirementValidation {
  if (!record(value) || !keys(value, ["version", "accountId", "expectedSource"]) || value.version !== 1 || !id(value.accountId) ||
    (value.expectedSource !== null && !validSource(value.expectedSource))) return fail("invalid-shape", "Use one account and an explicit expected source or null.");
  return success();
}

/** Static input checks only. Current native authorization and live review consent remain controller gates. */
export function validateConfirmedRetirementScenario(value: unknown, live: RetirementLiveContext): RetirementValidation {
  if (!record(value) || !keys(value, ["intent", "context", "assumptions", "confirmed"]) || value.confirmed !== true) return fail("invalid-shape", "Confirm the current reviewed scenario explicitly.");
  const contextCheck = validateRetirementContext(value.context); if (!contextCheck.ok) return contextCheck;
  const snapshot = value.context as RetirementContext, intent = value.intent as RetirementIntent;
  // Validate the captured terms against their captured day, then diagnose live changes as stale.
  // This is structural self-consistency, never an authorization substitute for the native reader.
  const intentCheck = validateRetirementIntent(value.intent, { today: snapshot.source.asOf, investmentAccounts: [{ id: snapshot.account.id, name: snapshot.account.name }] });
  if (!intentCheck.ok) return intentCheck;
  if (!roster(live) || !validSource(live.source) || live.source.asOf !== live.today || !sameSource(snapshot.source, live.source) || snapshot.account.id !== intent.accountId ||
    !live.investmentAccounts.some(a => a.id === snapshot.account.id && a.name === snapshot.account.name)) return fail("stale", CHANGED_BODY);
  const a = value.assumptions;
  if (!record(a) || !keys(a, ["view", "monthlyContribution", "returns", "purchasingPower"]) || (a.view !== "balances" && a.view !== "extra-deposits-only")) return fail("invalid-assumptions", "Review each assumption without extra fields.");
  const monthly = a.monthlyContribution;
  if (monthly !== null && (!record(monthly) || !keys(monthly, ["basis", "amount"]) || !["context", "manual"].includes(monthly.basis as string) || !decimal(monthly.amount) ||
    (monthly.basis === "context" && (snapshot.contribution.kind === "missing" || !sameAmount(monthly.amount as string, snapshot.contribution.monthlyAmount)))))
    return fail("invalid-assumptions", "Confirm the recorded contribution basis or an explicit manual amount.");
  const rates = a.returns;
  if (!record(rates) || !(rates.kind === "no-growth" && keys(rates, ["kind"])) && !(rates.kind === "confirmed-return" && keys(rates, ["kind", "annualPct", "basis", "sensitivity"]) &&
    ["stored-plan", "explicit"].includes(rates.basis as string) && validateRetirementRate(rates.annualPct, rates.basis === "stored-plan" ? "saved" : "preview").ok))
    return fail("invalid-assumptions", "Choose no growth or confirm an explicit return assumption.");
  if (rates.kind === "confirmed-return" && rates.basis === "stored-plan" && (snapshot.returnAssumption.kind !== "stored-plan" || !sameAmount(rates.annualPct as string, snapshot.returnAssumption.annualPct)))
    return fail("invalid-assumptions", "A default is not a stored-plan return. Confirm your chosen assumption.");
  if (rates.kind === "confirmed-return" && rates.sensitivity !== null) {
    const s = rates.sensitivity;
    if (!record(s) || !keys(s, ["lower", "base", "higher"]) || ![s.lower, s.base, s.higher].every(v => validateRetirementRate(v, "preview").ok) ||
      !sameAmount(s.base as string, rates.annualPct as string) || compare(decimal(s.lower, true)!, decimal(s.base, true)!) > 0 || compare(decimal(s.base, true)!, decimal(s.higher, true)!) > 0)
      return fail("invalid-assumptions", "Keep lower, confirmed base and higher assumptions in order; equal values are allowed.");
  }
  const power = a.purchasingPower;
  if (!record(power) || !(power.kind === "nominal" && keys(power, ["kind"])) && !(power.kind === "today" && keys(power, ["kind", "inflationPct"]) && validateRetirementRate(power.inflationPct, "saved").ok))
    return fail("invalid-assumptions", "Use nominal dollars or explicitly confirm inflation.");
  if (a.view === "extra-deposits-only") return monthly === null && rates.kind === "no-growth" && power.kind === "nominal" ? success() : fail("invalid-assumptions", "Extra-deposits-only uses no invented balance, contribution or growth assumption.");
  if (snapshot.currentValue === null || monthly === null) return fail("invalid-assumptions", "A balance illustration needs recorded worth and an explicit contribution basis.");
  try {
    for (const amount of [snapshot.currentValue, (monthly as Row).amount as string, intent.extra.amount]) retirementProjectionNumber(amount);
    retirementProjectionNumber(add(intent.extra.kind === "once" ? snapshot.currentValue : (monthly as Row).amount as string, intent.extra.amount));
    if (rates.kind === "confirmed-return") {
      retirementProjectionNumber(rates.annualPct as string);
      if (rates.sensitivity !== null) for (const rate of Object.values(rates.sensitivity as Row)) retirementProjectionNumber(rate as string);
    }
    if (power.kind === "today") retirementProjectionNumber(power.inflationPct as string);
  } catch { return fail("unsupported-number", RETIREMENT_REFUSAL_MESSAGE); }
  return success();
}

/** The saved-inflation candidate offered for today's-dollar figures. A candidate is never a confirmation. */
export function validateRetirementInflationCandidate(value: unknown): RetirementValidation {
  const bad = () => fail("invalid-assumptions", "Keep a stored inflation separate from a default or missing one.");
  if (!record(value)) return bad();
  if (value.kind === "missing") return keys(value, ["kind"]) ? success() : bad();
  return (value.kind === "stored" || value.kind === "application-default") && keys(value, ["kind", "pct"]) && validateRetirementRate(value.pct, "saved").ok ? success() : bad();
}
