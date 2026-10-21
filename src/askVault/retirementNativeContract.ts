import { CHANGED_BODY } from "./changedState";
import type { AskDataRevision } from "./types";
import { date as isDate, integer, id as isId } from "../contractChecks";
import { dateOutOfRange } from "../dateRange";
import { TransactionError, transactionError } from "../transactionContracts";
import { plainArray, validateRetirementContext, validateRetirementContextRequest, validateRetirementInflationCandidate } from "./retirementScenarioContract";
import type { RetirementContext, RetirementContribution, RetirementInflationCandidate, RetirementReturn, RetirementSource } from "./retirementScenarioContract";

/**
 * Native wire contract for the M5 retirement context (prerequisite 4). Two read-only commands, both bound to the open
 * profile by the financial client's origin check and answered from ONE database snapshot:
 *
 *  - roster:  the investment accounts a question may name (id and name only, no values);
 *  - context: one explicitly chosen investment account's recorded worth, contribution basis, saved plan and inflation.
 *
 * No native reader exists yet; this file and its fixtures are the specification a backend worker implements.
 * Money and rates are normalized plain decimals (no exponent, sign only when negative, no trailing fractional zeros).
 */
export const RETIREMENT_ROSTER_LIMIT = 200;
export const RETIREMENT_COMMANDS = { roster: "get_ask_vault_retirement_accounts", context: "get_ask_vault_retirement_context" } as const;
export type RetirementWireOrigin = { generation: number; sessionRevision: number };
export type RetirementContextWireRequest = { contractVersion: 1; accountId: number; expectedRevision: AskDataRevision | null };
export type RetirementRosterWireRequest = { contractVersion: 1; expectedRevision: AskDataRevision | null };
export type RetirementContextReply = {
  contractVersion: 1; context: RetirementWireOrigin; revision: AskDataRevision; asOf: string;
  account: { id: number; name: string; type: "investment" };
  /** Null exactly when basis is "none": no holdings, no usable transactions, no checkpoint and a zero starting balance. */
  worth: { amount: string | null; basis: "holdings" | "transactions" | "none" };
  contribution: RetirementContribution;
  returnAssumption: RetirementReturn;
  inflation: RetirementInflationCandidate;
  retirementMonth: string | null;
};
export type RetirementRosterReply = { contractVersion: 1; context: RetirementWireOrigin; revision: AskDataRevision; asOf: string; accounts: { id: number; name: string }[] };
export type RetirementFreshness = "current" | "date" | "data" | "session";
export type RetirementTrigger = { id: string; cause: string; detectedBy: "revision.local" | "revision.external" | "asOf" | "generation" | "sessionRevision" };

/** Every way a displayed review can go stale and the counter that exposes it. Settings writes are ordinary writes. */
export const RETIREMENT_INVALIDATION_TRIGGERS: readonly RetirementTrigger[] = [
  { id: "transaction-write", cause: "A transaction on any account is added, edited or deleted", detectedBy: "revision.local" },
  { id: "holding-write", cause: "A holding or its price is added, edited, refreshed or deleted", detectedBy: "revision.local" },
  { id: "plan-save", cause: "An investment plan (return, monthly amount, withdraw month) is saved", detectedBy: "revision.local" },
  { id: "inflation-save", cause: "The shared inflation setting is saved", detectedBy: "revision.local" },
  { id: "account-edit", cause: "An account is renamed, retyped or deleted", detectedBy: "revision.local" },
  { id: "external-write", cause: "Another window or process wrote to the same profile database", detectedBy: "revision.external" },
  { id: "date-rollover", cause: "The local date changed, moving the as-of date and the history window", detectedBy: "asOf" },
  { id: "profile-switch", cause: "A different profile was opened", detectedBy: "generation" },
  { id: "lock", cause: "The profile was locked and unlocked", detectedBy: "sessionRevision" },
];

type Row = Record<string, unknown>;
const record = (v: unknown): v is Row => !!v && typeof v === "object" && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const keys = (v: Row, names: readonly string[]) => Reflect.ownKeys(v).length === names.length && names.every(n => Object.prototype.hasOwnProperty.call(v, n));
const revisionOk = (v: unknown): v is AskDataRevision => record(v) && keys(v, ["local", "external"]) && integer(v.local) && integer(v.external);
const label = (v: unknown): v is string => typeof v === "string" && !!v.trim() && [...v].length <= 512;
const MAX_DECIMAL = 79228162514264337593543950335n;
/** A normalized plain decimal within the native bounds (28 places, 96-bit coefficient). */
function normalized(v: unknown, signed: boolean): v is string {
  if (typeof v !== "string" || v.length > 64 || !/^-?(0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(v) || v === "-0" || (!signed && v.startsWith("-"))) return false;
  const [whole, fraction = ""] = v.replace("-", "").split(".");
  return fraction.length <= 28 && BigInt(whole + fraction) <= MAX_DECIMAL;
}

/** Code-point order of the name, then the id: stable across languages and identical in Rust's string order. */
export function compareRetirementRosterRows(a: { id: number; name: string }, b: { id: number; name: string }): number {
  const x = Array.from(a.name), y = Array.from(b.name);
  for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!; if (d) return d < 0 ? -1 : 1; }
  return x.length !== y.length ? (x.length < y.length ? -1 : 1) : Math.sign(a.id - b.id);
}

const badRequest = (): never => { throw new TransactionError("invalid_argument", "Choose one existing investment account."); };
const badReply = (): never => { throw new TransactionError("invalid_response", "The app received an incomplete account. Ask again."); };
const anotherDay = (): never => { throw new TransactionError("invalid_response", "The account details belong to another date. Ask again."); };

export function validateRetirementContextWireRequest(value: unknown): RetirementContextWireRequest {
  if (!record(value) || !keys(value, ["contractVersion", "accountId", "expectedRevision"]) || value.contractVersion !== 1 || !isId(value.accountId) ||
    (value.expectedRevision !== null && !revisionOk(value.expectedRevision))) return badRequest();
  return structuredClone(value) as RetirementContextWireRequest;
}
export function validateRetirementRosterWireRequest(value: unknown): RetirementRosterWireRequest {
  if (!record(value) || !keys(value, ["contractVersion", "expectedRevision"]) || value.contractVersion !== 1 || (value.expectedRevision !== null && !revisionOk(value.expectedRevision)))
    throw new TransactionError("invalid_argument", "Ask for the investment accounts with a valid data version.");
  return structuredClone(value) as RetirementRosterWireRequest;
}

function header(value: Row, today: string): void {
  if (value.contractVersion !== 1 || !record(value.context) || !keys(value.context, ["generation", "sessionRevision"]) || !integer(value.context.generation) || !integer(value.context.sessionRevision) ||
    !revisionOk(value.revision) || !isDate(value.asOf) || dateOutOfRange(value.asOf as string)) badReply();
  if (value.asOf !== today) anotherDay();
}
function sameRevision(a: AskDataRevision, b: AskDataRevision) { return a.local === b.local && a.external === b.external; }

export function validateRetirementContextReply(value: unknown, request: RetirementContextWireRequest, today: string): RetirementContextReply {
  const names = ["contractVersion", "context", "revision", "asOf", "account", "worth", "contribution", "returnAssumption", "inflation", "retirementMonth"];
  if (!record(value) || !keys(value, names)) return badReply();
  header(value, today);
  const account = value.account, worth = value.worth;
  if (!record(account) || !keys(account, ["id", "name", "type"]) || !isId(account.id) || !label(account.name) || account.type !== "investment") return badReply();
  if (!record(worth) || !keys(worth, ["amount", "basis"]) || !["holdings", "transactions", "none"].includes(worth.basis as string) ||
    (worth.basis === "none" ? worth.amount !== null : !normalized(worth.amount, true))) return badReply();
  const c = value.contribution, r = value.returnAssumption, i = value.inflation;
  if (!record(c) || (c.kind !== "missing" && !normalized(c.monthlyAmount, false))) return badReply();
  if (!record(r) || (r.kind !== "missing" && !normalized(r.annualPct, false))) return badReply();
  if (!record(i) || (i.kind !== "missing" && !normalized(i.pct, false)) || !validateRetirementInflationCandidate(i).ok) return badReply();
  if (value.retirementMonth !== null && (typeof value.retirementMonth !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.retirementMonth))) return badReply();
  // Judge the shape that actually arrived: the domain validator checks exact keys of every nested object, so nothing may be cloned (and thereby repaired) first.
  const arrived = value as unknown as RetirementContextReply;
  if (!validateRetirementContext(buildContext(arrived)).ok) return badReply();
  const reply = structuredClone(arrived);
  if (reply.account.id !== request.accountId) return badReply();
  if (request.expectedRevision && !sameRevision(request.expectedRevision, reply.revision)) return badReply();
  return reply;
}

export function validateRetirementRosterReply(value: unknown, request: RetirementRosterWireRequest, today: string): RetirementRosterReply {
  if (!record(value) || !keys(value, ["contractVersion", "context", "revision", "asOf", "accounts"])) return badReply();
  header(value, today);
  const accounts = value.accounts;
  if (!plainArray(accounts) || accounts.length > RETIREMENT_ROSTER_LIMIT) return badReply();
  const rows: { id: number; name: string }[] = [];
  for (let n = 0; n < accounts.length; n++) {
    const row = accounts[n]; // a hole reads as undefined and fails the record check
    if (!record(row) || !keys(row, ["id", "name"]) || !isId(row.id) || !label(row.name)) return badReply();
    rows.push({ id: row.id as number, name: row.name as string });
  }
  for (let n = 1; n < rows.length; n++) if (compareRetirementRosterRows(rows[n - 1], rows[n]) >= 0) return badReply();
  if (new Set(rows.map(row => row.id)).size !== rows.length) return badReply();
  if (request.expectedRevision && !sameRevision(request.expectedRevision, value.revision as AskDataRevision)) return badReply();
  return structuredClone(value) as RetirementRosterReply;
}

/** Settings are ordinary writes, so they already move revision.local; the domain's settings counter follows it. */
export function retirementSourceFromReply(reply: Pick<RetirementContextReply, "context" | "revision" | "asOf">): RetirementSource {
  return { generation: reply.context.generation, sessionRevision: reply.context.sessionRevision, revision: { local: reply.revision.local, external: reply.revision.external },
    settingsRevision: reply.revision.local, asOf: reply.asOf };
}
function buildContext(reply: RetirementContextReply): RetirementContext {
  // References, never copies: the domain validator must judge the real shape, and callers clone only after it passes.
  return { version: 1, account: reply.account, source: retirementSourceFromReply(reply), currentValue: reply.worth.amount,
    contribution: reply.contribution, returnAssumption: reply.returnAssumption, retirementMonth: reply.retirementMonth };
}
export function retirementContextFromReply(reply: RetirementContextReply): { context: RetirementContext; inflation: RetirementInflationCandidate } {
  const context = buildContext(reply);
  if (!validateRetirementContext(context).ok || !validateRetirementInflationCandidate(reply.inflation).ok) return badReply();
  return { context: structuredClone(context), inflation: structuredClone(reply.inflation) };
}

export function retirementWireRequestFromSource(accountId: number, expected: RetirementSource | null): RetirementContextWireRequest {
  if (!isId(accountId) || !validateRetirementContextRequest({ version: 1, accountId, expectedSource: expected }).ok) return badRequest();
  return { contractVersion: 1, accountId, expectedRevision: expected ? { local: expected.revision.local, external: expected.revision.external } : null };
}

/** Compare a reviewed source with what is live now. Order: another profile or session, then another day, then changed data. */
export function retirementFreshness(source: RetirementSource, live: { source: RetirementSource | null; today: string }): RetirementFreshness {
  const now = live.source;
  if (!now || !validateRetirementContextRequest({ version: 1, accountId: 1, expectedSource: now }).ok) return "session";
  if (now.generation !== source.generation || now.sessionRevision !== source.sessionRevision) return "session";
  if (source.asOf !== live.today || now.asOf !== source.asOf) return "date";
  if (now.revision.local !== source.revision.local || now.revision.external !== source.revision.external || now.settingsRevision !== source.settingsRevision) return "data";
  return "current";
}

const PROFILE_MOVED = new Set(["stale_profile", "profile_locked", "no_profile_open", "superseded"]);
/** Plain-language outcome for any failure; says whether it retires the review. */
export function explainRetirementFailure(failure: unknown): { status: "stale" | "error"; message: string } {
  const error = transactionError(failure);
  if (PROFILE_MOVED.has(error.code)) return { status: "stale", message: CHANGED_BODY };
  if (error.code === "stale_data") return { status: "stale", message: CHANGED_BODY };
  if (error.code === "account_unavailable") return { status: "stale", message: `${CHANGED_BODY} That investment account is no longer available. Choose an account when you ask again.` };
  if (error.code === "invalid_argument" || error.code === "invalid_response") return { status: "error", message: error.message };
  if (error.code === "too_many_accounts") return { status: "error", message: `You have more investment accounts than I can list (${RETIREMENT_ROSTER_LIMIT}), so I can't pick one yet.` };
  return { status: "error", message: "I couldn't read that account right now. Try again in a moment." };
}
