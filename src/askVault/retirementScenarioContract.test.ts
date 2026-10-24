import { describe, expect, it } from "vitest";
import { projectAccount } from "../accumulation";
import {
  retirementProjectionNumber, validateConfirmedRetirementScenario, validateRetirementContext,
  validateRetirementContextRequest, validateRetirementDraft, validateRetirementIntent, validateRetirementRate,
} from "./retirementScenarioContract";
import type {
  CalculateRetirementScenario, ConfirmedRetirementScenario, FormatRetirementEstimate, ParseRetirementScenario,
  ReadRetirementContext, ProjectRetirementAccount, RetirementContext, RetirementDraft, RetirementIntent, RetirementLiveContext,
  RetirementParseContext, RetirementSource,
} from "./retirementScenarioContract";
import { retirementContractExamples } from "./retirementScenarioContractExamples";

const source = (): RetirementSource => ({ generation: 1, sessionRevision: 2, revision: { local: 3, external: 4 }, settingsRevision: 5, asOf: "2026-10-17" });
const parse: RetirementParseContext = { today: "2026-10-17", investmentAccounts: [{ id: 7, name: "Fictional IRA" }, { id: 8, name: "Other IRA" }] };
const live = (): RetirementLiveContext => ({ ...parse, source: source() });
const intent = (): RetirementIntent => ({ version: 1, accountId: 7, extra: { kind: "monthly", amount: "50" }, startDate: "2026-10-17", retirementMonth: "2050-06" });
const context = (): RetirementContext => ({ version: 1, account: { id: 7, name: "Fictional IRA", type: "investment" }, source: source(), currentValue: "1000",
  contribution: { kind: "saved", monthlyAmount: "100" }, returnAssumption: { kind: "stored-plan", annualPct: "6" }, retirementMonth: "2050-06" });
const confirmed = (): ConfirmedRetirementScenario => ({ intent: intent(), context: context(), confirmed: true,
  assumptions: { view: "balances", monthlyContribution: { basis: "context", amount: "100" }, returns: { kind: "confirmed-return", annualPct: "6", basis: "stored-plan", sensitivity: null }, purchasingPower: { kind: "nominal" } } });
const draft = (): RetirementDraft => ({ sourceText: "How much extra if I save $50?", accountId: null, extra: { kind: null, amount: "50" }, startDate: null, retirementMonth: null,
  assumptions: { annualReturnPct: null, inflationPct: null }, missing: ["account", "cadence", "start-date", "retirement-month"], hints: [] });
function change<T>(value: T, path: string, replacement: unknown): T {
  const parts = path.split("."); let row = value as Record<string, unknown>;
  for (const key of parts.slice(0, -1)) row = row[key] as Record<string, unknown>;
  row[parts.at(-1)!] = replacement; return value;
}

describe("M5 prerequisite 2: strict intent and draft boundary (F1/S1/P2/P3/E3)", () => {
  it("accepts monthly and once with explicit current start and does not mutate terms", () => {
    for (const kind of ["monthly", "once"] as const) { const value = intent(); value.extra.kind = kind; const copy = structuredClone(value);
      expect(validateRetirementIntent(value, parse)).toEqual({ ok: true }); expect(value).toEqual(copy); }
  });
  for (const [path, value] of [
    ["version", "1"], ["accountId", [7]], ["accountId", 8.5], ["accountId", 99], ["extra.kind", "weekly"], ["extra.amount", 50],
    ["extra.amount", "-1"], ["extra.amount", "1.001"], ["extra.amount", "1,000"], ["extra.amount", "1e3"], ["extra.amount", " 50"],
    ["extra.amount", "79228162514264337593543950336"], ["extra", { kind: "monthly", amount: "50", inferred: true }],
    ["startDate", "2026-10-18"], ["startDate", "2026-10-16"], ["startDate", "2026-02-30"], ["retirementMonth", "2026-09"],
    ["retirementMonth", "2050-13"], ["retirementMonth", "2050-06-01"], ["retirementMonth", "2101-01"], ["confirmed", true],
  ] as const) it(`rejects changed intent ${path}=${JSON.stringify(value)}`, () => {
    expect(validateRetirementIntent(change(intent(), path, value), parse).ok).toBe(false);
  });
  for (const amount of ["0", "0.01", "50.00"]) it(`preserves canonical extra dollars ${amount}`, () => {
    const value = change(intent(), "extra.amount", amount); expect(validateRetirementIntent(value, parse).ok).toBe(true); expect(value.extra.amount).toBe(amount);
  });
  it("supports zero horizon and exactly1200 months, but refuses1201 without truncating", () => {
    expect(validateRetirementIntent(change(intent(), "retirementMonth", "2026-10"), parse).ok).toBe(true);
    const p = { ...parse, today: "2000-02-29" }, value = { ...intent(), startDate: p.today, retirementMonth: "2100-02" };
    expect(validateRetirementIntent(value, p).ok).toBe(true);
    expect(validateRetirementIntent({ ...value, retirementMonth: "2100-03" }, p).ok).toBe(false);
  });
  it("rejects duplicate roster IDs but permits distinct accounts with ambiguous names", () => {
    expect(validateRetirementIntent(intent(), { ...parse, investmentAccounts: [parse.investmentAccounts[0], parse.investmentAccounts[0]] }).ok).toBe(false);
    expect(validateRetirementIntent(intent(), { ...parse, investmentAccounts: [{ id: 7, name: "IRA" }, { id: 8, name: "IRA" }] }).ok).toBe(true);
  });
  it("asks to refresh an invalid app-owned date instead of blaming the selected account", () => {
    expect(validateRetirementIntent(intent(), { ...parse, today: "2026-02-30" })).toMatchObject({ ok: false, code: "invalid-schedule", reason: expect.stringMatching(/refresh/i) });
  });
  it("validates an incomplete draft without filling missing account/date/cadence/return", () => {
    const value = draft(); expect(validateRetirementDraft(value, parse)).toEqual({ ok: true }); expect(value).toEqual(draft());
  });
  for (const [path, value] of [["missing", []], ["missing", ["account", "account"]], ["accountId", 99], ["extra.kind", "weekly"], ["assumptions.annualReturnPct", "-101"], ["confirmed", true]] as const)
    it(`rejects an inconsistent or unauthorized draft ${path}`, () => { expect(validateRetirementDraft(change(draft(), path, value), parse).ok).toBe(false); });
  it("bounds source by Unicode code points and validates exact UTF16 evidence spans", () => {
    const value = { ...draft(), sourceText: "😀".repeat(512), hints: [{ field: "account" as const, text: "😀", start: 0, end: 2 }] };
    expect(validateRetirementDraft(value, parse).ok).toBe(true);
    expect(validateRetirementDraft({ ...value, sourceText: value.sourceText + "x" }, parse).ok).toBe(false);
    expect(validateRetirementDraft(change(structuredClone(value), "hints.0.text", "wrong"), parse).ok).toBe(false);
    expect(validateRetirementDraft(change(structuredClone(value), "hints.0.end", 1), parse).ok).toBe(false);
  });
  it("rejects sparse evidence arrays instead of silently skipping unknown entries", () => {
    const hints = new Array<RetirementDraft["hints"][number]>(1);
    expect(validateRetirementDraft({ ...draft(), hints }, parse).ok).toBe(false);
  });
  it("rejects sparse account rosters even when the requested account exists", () => {
    const accounts = new Array<{ id: number; name: string }>(2); accounts[0] = { id: 7, name: "IRA" };
    expect(validateRetirementIntent(intent(), { ...parse, investmentAccounts: accounts }).ok).toBe(false);
  });
  it("rejects inherited and hidden extra fields rather than trusting shape coercion", () => {
    expect(validateRetirementIntent(Object.assign(Object.create({ version: 1 }), intent()), parse).ok).toBe(false);
    const value = intent(); Object.defineProperty(value, "hidden", { value: true });
    expect(validateRetirementIntent(value, parse).ok).toBe(false);
  });
});

describe("M5 context domain boundary, not a native reader (F1/N1/N2/N4/E1/E7)", () => {
  it("keeps recorded zero, missing value and saved-zero contribution distinct", () => {
    for (const currentValue of ["0", null]) for (const contribution of [{ kind: "missing" as const }, { kind: "saved" as const, monthlyAmount: "0" }]) {
      const value = { ...context(), currentValue, contribution }; expect(validateRetirementContext(value).ok).toBe(true); expect(value.currentValue).toBe(currentValue); expect(value.contribution).toEqual(contribution);
    }
  });
  it("accepts a native-precision context for labelled fallback without pretending it is projection-safe", () => {
    expect(validateRetirementContext(change(context(), "currentValue", "0.1234567890123456789012345678")).ok).toBe(true);
    expect(validateRetirementContext(change(context(), "returnAssumption", { kind: "application-default", annualPct: "7" })).ok).toBe(true);
  });
  for (const [path, value] of [
    ["version", 2], ["account.type", "checking"], ["account.id", 0], ["account.name", ""], ["account.extra", true], ["source.settingsRevision", -1],
    ["source.revision.local", 0.5], ["source.asOf", "2026-02-30"], ["source.profileData", {}], ["currentValue", "NaN"], ["currentValue", "1e3"],
    ["contribution", { kind: "missing", monthlyAmount: "0" }], ["contribution", { kind: "saved", monthlyAmount: "-1" }],
    ["returnAssumption", { kind: "stored-plan", annualPct: "-1" }], ["returnAssumption", { kind: "missing", annualPct: "7" }], ["retirementMonth", "2050-13"],
  ] as const) it(`refuses malformed context ${path}`, () => { expect(validateRetirementContext(change(context(), path, value)).ok).toBe(false); });
  it("keeps a well-formed saved retirement month beyond the supported range as saved evidence, unchanged", () => {
    for (const saved of ["2101-01", "2200-12", "9999-12"]) {
      const value = change(context(), "retirementMonth", saved);
      expect(validateRetirementContext(value).ok, saved).toBe(true);
      expect(value.retirementMonth, `${saved} is neither clamped nor replaced`).toBe(saved);
    }
  });
  it("still refuses a malformed saved month, and every month the person chooses or confirms beyond the range", () => {
    for (const saved of ["2101-13", "2101-00", "21-01", "2101-1", "2101-01-01", "June 2101", 2101, "", " 2101-01"]) expect(validateRetirementContext(change(context(), "retirementMonth", saved)).ok, String(saved)).toBe(false);
    expect(validateRetirementIntent({ ...intent(), retirementMonth: "2101-01" }, parse).ok).toBe(false);
    expect(validateConfirmedRetirementScenario(change(confirmed(), "intent.retirementMonth", "2101-01"), live()).ok).toBe(false);
    expect(validateRetirementDraft({ ...draft(), retirementMonth: "2101-01", missing: ["account", "cadence", "start-date"] }, parse).ok).toBe(false);
  });
  it("does not relax any other month in the context: history months stay inside the supported range", () => {
    const history = { kind: "history", monthlyAmount: "75.50", fromMonth: "2026-07", toMonth: "2026-09", monthCount: 3 };
    expect(validateRetirementContext(change(change(context(), "contribution", { ...history }), "source.asOf", "2026-10-17")).ok).toBe(true);
    expect(validateRetirementContext(change(context(), "contribution", { ...history, fromMonth: "2101-01", toMonth: "2101-03" })).ok).toBe(false);
  });
  it("requires a contiguous prior complete-month history summary of at most6 months", () => {
    const value = change(context(), "contribution", { kind: "history", monthlyAmount: "75.50", fromMonth: "2026-07", toMonth: "2026-09", monthCount: 3 });
    expect(validateRetirementContext(value).ok).toBe(true);
    for (const [path, next] of [["contribution.monthCount", 2], ["contribution.toMonth", "2026-10"], ["contribution.fromMonth", "2026-03"]] as const)
      expect(validateRetirementContext(change(structuredClone(value), path, next)).ok).toBe(false);
  });
  it("defines an exact request including expected source, without claiming a native command exists", () => {
    expect(validateRetirementContextRequest({ version: 1, accountId: 7, expectedSource: null }).ok).toBe(true);
    expect(validateRetirementContextRequest({ version: 1, accountId: 7, expectedSource: source() }).ok).toBe(true);
    expect(validateRetirementContextRequest({ version: 1, accountId: 7 }).ok).toBe(false);
    expect(validateRetirementContextRequest({ version: 1, accountId: 7, expectedSource: null, sql: "SELECT" }).ok).toBe(false);
  });
});

describe("M5 explicit confirmed assumptions boundary (F1/U2–U5/I1/E1–E7)", () => {
  it("accepts a copied stored-plan review without treating that as proof of fresh consent", () => {
    const value = confirmed(), copy = structuredClone(value); expect(validateConfirmedRetirementScenario(value, live())).toEqual({ ok: true }); expect(value).toEqual(copy);
  });
  for (const [path, value] of [
    ["confirmed", false], ["confirmed", "true"], ["consentFromParser", true], ["intent.accountId", 8], ["context.account.name", "Renamed IRA"],
    ["context.source.generation", 9], ["context.source.sessionRevision", 9], ["context.source.revision.local", 9], ["context.source.revision.external", 9], ["context.source.settingsRevision", 9],
    ["assumptions.monthlyContribution", null], ["assumptions.monthlyContribution.amount", "101"], ["assumptions.monthlyContribution.basis", "guessed"],
    ["assumptions.returns.annualPct", "7"], ["assumptions.returns.basis", "default"], ["assumptions.returns.confirmed", true],
    ["assumptions.purchasingPower", { kind: "today" }], ["assumptions.purchasingPower", { kind: "nominal", inflationPct: "3" }],
    ["assumptions.purchasingPower", { kind: "today", inflationPct: "-1" }],
  ] as const) it(`refuses forged/stale/incomplete review ${path}`, () => { expect(validateConfirmedRetirementScenario(change(confirmed(), path, value), live()).ok).toBe(false); });
  it("distinguishes a stored zero return from an unchosen default7%", () => {
    const value = confirmed(); value.context.returnAssumption = { kind: "stored-plan", annualPct: "0" };
    value.assumptions.returns = { kind: "confirmed-return", annualPct: "0.00", basis: "stored-plan", sensitivity: null };
    expect(validateConfirmedRetirementScenario(value, live()).ok).toBe(true);
    value.context.returnAssumption = { kind: "application-default", annualPct: "0" };
    expect(validateConfirmedRetirementScenario(value, live()).ok).toBe(false);
    value.assumptions.returns.basis = "explicit";
    expect(validateConfirmedRetirementScenario(value, live()).ok).toBe(true);
  });
  it("allows no-growth with missing/default return, but no fabricated missing contribution", () => {
    const value = confirmed(); value.context.returnAssumption = { kind: "missing" }; value.assumptions.returns = { kind: "no-growth" };
    expect(validateConfirmedRetirementScenario(value, live()).ok).toBe(true);
    value.context.contribution = { kind: "missing" };
    expect(validateConfirmedRetirementScenario(value, live()).ok).toBe(false);
    value.assumptions.monthlyContribution = { basis: "manual", amount: "0" };
    expect(validateConfirmedRetirementScenario(value, live()).ok).toBe(true);
  });
  it("has an explicit exact-deposits-only fallback without balance/contribution/rate guesses", () => {
    const value = confirmed(); value.context.currentValue = null; value.context.contribution = { kind: "missing" }; value.context.returnAssumption = { kind: "application-default", annualPct: "7" };
    value.assumptions = { view: "extra-deposits-only", monthlyContribution: null, returns: { kind: "no-growth" }, purchasingPower: { kind: "nominal" } };
    expect(validateConfirmedRetirementScenario(value, live()).ok).toBe(true);
    for (const [path, next] of [["assumptions.view", "balances"], ["assumptions.monthlyContribution", { basis: "manual", amount: "0" }], ["assumptions.purchasingPower", { kind: "today", inflationPct: "3" }]] as const)
      expect(validateConfirmedRetirementScenario(change(structuredClone(value), path, next), live()).ok).toBe(false);
  });
  it("keeps advanced negative sensitivities separate from saved-setting acceptance", () => {
    expect(validateRetirementRate("-100", "preview").ok).toBe(true); expect(validateRetirementRate("-100", "saved").ok).toBe(false);
    const value = confirmed(); if (value.assumptions.returns.kind !== "confirmed-return") throw Error("Expected rates");
    value.assumptions.returns.sensitivity = { lower: "-10", base: "6", higher: "100" };
    expect(validateConfirmedRetirementScenario(value, live()).ok).toBe(true);
    for (const [path, next] of [["assumptions.returns.sensitivity.lower", "7"], ["assumptions.returns.sensitivity.base", "5"], ["assumptions.returns.sensitivity.higher", "101"], ["assumptions.returns.sensitivity.extra", "9"]] as const)
      expect(validateConfirmedRetirementScenario(change(structuredClone(value), path, next), live()).ok).toBe(false);
    value.assumptions.returns.sensitivity = { lower: "6", base: "6.00", higher: "6" };
    expect(validateConfirmedRetirementScenario(value, live()).ok).toBe(true);
  });
  it("requires source/day/intent validation even for a no-growth deposit-only fallback", () => {
    const value = confirmed(); value.assumptions = { view: "extra-deposits-only", monthlyContribution: null, returns: { kind: "no-growth" }, purchasingPower: { kind: "nominal" } };
    const current = live(); current.today = "2026-10-18";
    expect(validateConfirmedRetirementScenario(value, current).ok).toBe(false);
    expect(validateConfirmedRetirementScenario(change(value, "intent.extra.amount", "-1"), live()).ok).toBe(false);
  });
  it("classifies a formerly valid review after midnight as stale before inspecting its assumptions", () => {
    const current = live(); current.today = "2026-10-18"; current.source.asOf = current.today;
    const value = change(confirmed(), "assumptions.returns", { kind: "guessed" });
    expect(validateConfirmedRetirementScenario(value, current)).toMatchObject({ ok: false, code: "stale" });
  });
  it("makes error precedence explicit: outer shape, context, intent, live binding, assumptions, numeric conversion", () => {
    const value = change(change(confirmed(), "assumptions.returns", { kind: "guessed" }), "context.source.settingsRevision", 99);
    expect(validateConfirmedRetirementScenario({ ...value, confirmed: false }, live())).toMatchObject({ ok: false, code: "invalid-shape" });
    expect(validateConfirmedRetirementScenario(value, live())).toMatchObject({ ok: false, code: "stale" });
  });
});

describe("M5 decimal→projection boundary, not a new projection formula (E2/C5)", () => {
  for (const [mode, value, accepted] of [
    ["saved", "0", true], ["saved", "100", true], ["saved", "100.01", false], ["saved", "-0.01", false],
    ["preview", "-100", true], ["preview", "-100.01", false], ["preview", "100", true], ["preview", "100.01", false],
    ["preview", "NaN", false], ["preview", "1e1", false],
  ] as const) it(`checks separate ${mode} rate boundary ${value}`, () => { expect(validateRetirementRate(value, mode).ok).toBe(accepted); });
  for (const text of ["0", "-10.25", "0.29", "10000000000000000000000000000", "0.0000000000000000000000000001"])
    it(`preserves finite canonical decimal round-trip ${text}`, () => { expect(retirementProjectionNumber(text)).toBe(Number(text)); });
  for (const text of ["NaN", "Infinity", "1e3", "0.1234567890123456789012345678", "9007199254740993", "79228162514264337593543950336", "0.00000000000000000000000000001"])
    it(`refuses unsupported input instead of silently rounding ${text}`, () => { expect(() => retirementProjectionNumber(text)).toThrow(); });
  it("rejects a balance preview when a requested addition disappears in numeric conversion", () => {
    const value = confirmed(); value.intent.extra = { kind: "once", amount: "0.01" }; value.context.currentValue = "10000000000000000";
    expect(validateConfirmedRetirementScenario(value, live())).toMatchObject({ ok: false, code: "unsupported-number" });
    value.assumptions = { view: "extra-deposits-only", monthlyContribution: null, returns: { kind: "no-growth" }, purchasingPower: { kind: "nominal" } };
    expect(validateConfirmedRetirementScenario(value, live()).ok).toBe(true);
  });
  it("checks baseline plus extra monthly contribution independently of account worth", () => {
    const value = confirmed(); value.context.contribution = { kind: "saved", monthlyAmount: "10000000000000000" }; value.assumptions.monthlyContribution = { basis: "context", amount: "10000000000000000" }; value.intent.extra.amount = "0.01";
    expect(validateConfirmedRetirementScenario(value, live())).toMatchObject({ ok: false, code: "unsupported-number" });
  });
});

describe("M5 worker signatures exist in code; workers remain unimplemented", () => {
  it("type-checks parser/reader/calculator/formatter contracts without invoking stand-ins as production", () => {
    const parser: ParseRetirementScenario = (_text, ctx) => ctx.investmentAccounts.length ? null : { kind: "retirement-unsupported", reason: "No account" };
    const reader: ReadRetirementContext = async ({ client, accountId, currentSource, signal }) => signal?.aborted || !currentSource()
      ? { status: "stale", message: "Closed" } : { status: "context", ...await client.readRetirementContext({ version: 1, accountId, expectedSource: currentSource() }) };
    const calculator: CalculateRetirementScenario = () => ({ kind: "refused", code: "invalid-input", message: "Test signature only" });
    const project: ProjectRetirementAccount = projectAccount;
    const formatter: FormatRetirementEstimate = () => ({ roundedDollars: 0, roundingStepDollars: 10, sign: "zero", lessThanTen: false });
    expect([parser, reader, calculator, project, formatter].every(v => typeof v === "function")).toBe(true);
  });
});

describe("M5 typed full-input/full-output hand examples, not calculator execution", () => {
  for (const example of retirementContractExamples()) it(`validates the complete terms for ${example.id}`, () => {
    expect(validateConfirmedRetirementScenario(example.input, example.live)).toEqual({ ok: true });
    expect(example.expected.kind).not.toBe("refused");
    if (example.expected.kind === "refused") throw Error("Expected a complete example");
    expect(example.expected.scenario).toEqual(example.input);
    expect(example.expected.extraDeposits).toBe(example.extraDeposits);
  });
});

it("does not let a caller's annotation of one validation result poison later decisions", () => {
  const first = validateRetirementIntent(intent(), parse);
  expect(first).toEqual({ ok: true });
  change(first, "ok", false);
  expect(validateRetirementIntent(intent(), parse)).toEqual({ ok: true });
  expect(validateRetirementContext(context())).toEqual({ ok: true });
});

describe("second review: arrays judged as they arrived (rosters, missing lists, hints)", () => {
  const withHiddenArray = <T extends unknown[]>(array: T, how: "hidden" | "symbol" | "extra"): T => {
    if (how === "hidden") Object.defineProperty(array, "hidden", { value: 1 }); else if (how === "symbol") (array as unknown as Record<symbol, number>)[Symbol("x")] = 1; else (array as unknown as Record<string, number>).extra = 1;
    return array;
  };
  for (const how of ["hidden", "symbol", "extra"] as const) {
    it(`refuses a ${how} field on the roster for an intent, a draft and a confirmed scenario`, () => {
      const roster = withHiddenArray([{ id: 7, name: "Fictional IRA" }], how), context = { today: "2026-10-17", investmentAccounts: roster };
      expect(validateRetirementIntent(intent(), context).ok).toBe(false);
      expect(validateRetirementDraft(draft(), context).ok).toBe(false);
      expect(validateConfirmedRetirementScenario(confirmed(), { ...context, source: source() }).ok).toBe(false);
    });
    it(`refuses a ${how} field on a draft's missing list and hints`, () => {
      const missing = draft(); withHiddenArray(missing.missing, how); expect(validateRetirementDraft(missing, parse).ok).toBe(false);
      const text = "extra $50 into my Fictional IRA", hints = { ...draft(), sourceText: text, accountId: 7, missing: ["start-date", "retirement-month"] as RetirementDraft["missing"], hints: withHiddenArray([{ field: "account" as const, text: "Fictional IRA", start: 14, end: 26 }], how) };
      expect(validateRetirementDraft(hints, parse).ok).toBe(false);
    });
  }
  it("still accepts plain arrays, and a sparse roster or missing list is refused", () => {
    expect(validateRetirementDraft(draft(), parse).ok).toBe(true);
    expect(validateRetirementIntent(intent(), { today: "2026-10-17", investmentAccounts: [, { id: 7, name: "Fictional IRA" }] as never }).ok).toBe(false);
    const sparse = draft(); sparse.missing = [, "cadence", "start-date", "retirement-month"] as never; expect(validateRetirementDraft(sparse, parse).ok).toBe(false);
  });
});
