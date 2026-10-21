import { describe, expect, it } from "vitest";
import { TransactionError } from "../transactionContracts";
import {
  RETIREMENT_COMMANDS, RETIREMENT_INVALIDATION_TRIGGERS, RETIREMENT_ROSTER_LIMIT, compareRetirementRosterRows, explainRetirementFailure, retirementContextFromReply, retirementFreshness,
  retirementSourceFromReply, retirementWireRequestFromSource, validateRetirementContextReply, validateRetirementContextWireRequest,
  validateRetirementRosterReply, validateRetirementRosterWireRequest,
} from "./retirementNativeContract";
import type { RetirementContextReply, RetirementContextWireRequest, RetirementRosterReply } from "./retirementNativeContract";
import { referenceRetirementContext, referenceRetirementRoster, retirementMutationScenarios, retirementNativeFixtures } from "./retirementNativeFixtures";
import type { NativeFixture } from "./retirementNativeFixtures";
import { validateConfirmedRetirementScenario, validateRetirementContext, validateRetirementInflationCandidate } from "./retirementScenarioContract";
import type { ConfirmedRetirementScenario, RetirementContextRead, RetirementContextResult, RetirementSource } from "./retirementScenarioContract";

const TODAY = "2026-10-17";
const request = (over: Partial<RetirementContextWireRequest> = {}): RetirementContextWireRequest => ({ contractVersion: 1, accountId: 5, expectedRevision: null, ...over });
const fixtures = retirementNativeFixtures();
const full = () => { const f = fixtures.find(x => x.id === "full-saved-plan-holdings")!; return structuredClone((f.expected as { reply: RetirementContextReply }).reply); };
const replyOf = (f: NativeFixture) => ("reply" in f.expected ? structuredClone(f.expected.reply) : null);
const set = (value: unknown, path: string, replacement: unknown) => {
  const copy = structuredClone(value) as Record<string, unknown>; const parts = path.split(".");
  let target = copy; for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
  if (replacement === undefined) delete target[parts[parts.length - 1]]; else target[parts[parts.length - 1]] = replacement;
  return copy;
};
const throwsCode = (fn: () => unknown, code: string) => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(TransactionError); expect((e as TransactionError).code).toBe(code); return; } throw new Error("expected a " + code + " failure"); };

describe("A4-1 strict request shapes", () => {
  it("names the two read-only commands", () => { expect(RETIREMENT_COMMANDS).toEqual({ roster: "get_ask_vault_retirement_accounts", context: "get_ask_vault_retirement_context" }); });
  it("accepts a first read and a re-read bound to a known revision", () => {
    expect(validateRetirementContextWireRequest(request())).toEqual(request());
    expect(validateRetirementContextWireRequest(request({ expectedRevision: { local: 0, external: 0 } }))).toEqual(request({ expectedRevision: { local: 0, external: 0 } }));
    expect(validateRetirementRosterWireRequest({ contractVersion: 1, expectedRevision: null })).toEqual({ contractVersion: 1, expectedRevision: null });
  });
  it("returns a copy, never the caller's object", () => { const input = request({ expectedRevision: { local: 1, external: 2 } }); const out = validateRetirementContextWireRequest(input); out.expectedRevision!.local = 99; expect(input.expectedRevision!.local).toBe(1); });
  for (const [label, bad] of [
    ["wrong version", { ...request(), contractVersion: 2 }], ["missing version", { accountId: 5, expectedRevision: null }], ["string id", request({ accountId: "5" as unknown as number })],
    ["zero id", request({ accountId: 0 })], ["negative id", request({ accountId: -1 })], ["fractional id", request({ accountId: 1.5 })], ["unsafe id", request({ accountId: 2 ** 53 })],
    ["NaN id", request({ accountId: NaN })], ["extra key", { ...request(), accountName: "Roth IRA" }], ["missing expectedRevision", { contractVersion: 1, accountId: 5 }],
    ["partial revision", request({ expectedRevision: { local: 1 } as never })], ["negative revision", request({ expectedRevision: { local: -1, external: 0 } })],
    ["fractional revision", request({ expectedRevision: { local: 1.5, external: 0 } })], ["extra revision key", request({ expectedRevision: { local: 1, external: 0, x: 1 } as never })],
    ["array", []], ["null", null], ["symbol key", { ...request(), [Symbol("x")]: 1 }], ["prototype", Object.assign(Object.create({ inherited: 1 }), request())],
  ] as const) it(`refuses ${label}`, () => { throwsCode(() => validateRetirementContextWireRequest(bad), "invalid_argument"); });
  for (const bad of [{ contractVersion: 1 }, { contractVersion: 1, expectedRevision: { local: 1 } }, { contractVersion: 1, accountId: 5, expectedRevision: null }])
    it(`refuses a roster request ${JSON.stringify(bad)}`, () => { throwsCode(() => validateRetirementRosterWireRequest(bad), "invalid_argument"); });
  it("builds a wire request from a domain source or from none", () => {
    const source: RetirementSource = { generation: 3, sessionRevision: 11, revision: { local: 40, external: 7 }, settingsRevision: 40, asOf: TODAY };
    expect(retirementWireRequestFromSource(5, source)).toEqual(request({ expectedRevision: { local: 40, external: 7 } }));
    expect(retirementWireRequestFromSource(5, null)).toEqual(request());
    const built = retirementWireRequestFromSource(5, source); built.expectedRevision!.local = 0; expect(source.revision.local).toBe(40);
    throwsCode(() => retirementWireRequestFromSource(0, null), "invalid_argument");
    throwsCode(() => retirementWireRequestFromSource(5, { ...source, asOf: "nope" }), "invalid_argument");
  });
});

describe("A4-2 strict reply shapes", () => {
  const ok = (value: unknown, req = request()) => validateRetirementContextReply(value, req, TODAY);
  it("accepts every successful fixture reply", () => {
    for (const f of fixtures) { const reply = replyOf(f); if (reply) expect(validateRetirementContextReply(reply, request({ accountId: f.accountId, expectedRevision: f.expectedRevision ?? null }), f.today)).toEqual(reply); }
  });
  it("returns a copy", () => { const reply = full(); const out = ok(reply); out.worth.amount = "0"; expect(reply.worth.amount).toBe("6600.75"); });
  for (const [label, path, value] of [
    ["unknown version", "contractVersion", 2], ["missing account", "account", undefined], ["extra top-level key", "settingsRevision", 40], ["extra account key", "account.balance", "1"],
    ["account type", "account.type", "checking"], ["blank account name", "account.name", "  "], ["string generation", "context.generation", "3"], ["negative session", "context.sessionRevision", -1],
    ["fractional revision", "revision.local", 1.5], ["bad date", "asOf", "2026-02-30"], ["date out of range", "asOf", "1800-01-01"], ["unknown basis", "worth.basis", "cash"],
    ["amount with no basis", "worth", { amount: "5", basis: "none" }], ["basis with no amount", "worth", { amount: null, basis: "holdings" }], ["non-normalized amount", "worth.amount", "100.00"],
    ["exponent amount", "worth.amount", "1e3"], ["plus sign", "worth.amount", "+5"], ["29 decimal places", "worth.amount", "0.00000000000000000000000000001"],
    ["over 96-bit amount", "worth.amount", "79228162514264337593543950336"], ["negative zero", "worth.amount", "-0"], ["number amount", "worth.amount", 5],
    ["unknown contribution kind", "contribution", { kind: "average", monthlyAmount: "5" }], ["negative saved amount", "contribution", { kind: "saved", monthlyAmount: "-5" }],
    ["history with 7 months", "contribution", { kind: "history", monthlyAmount: "5", fromMonth: "2026-03", toMonth: "2026-09", monthCount: 7 }],
    ["history not ending last month", "contribution", { kind: "history", monthlyAmount: "5", fromMonth: "2026-07", toMonth: "2026-08", monthCount: 2 }],
    ["history count mismatch", "contribution", { kind: "history", monthlyAmount: "5", fromMonth: "2026-07", toMonth: "2026-09", monthCount: 2 }],
    ["rate over 100", "returnAssumption", { kind: "stored-plan", annualPct: "100.01" }], ["negative rate", "returnAssumption", { kind: "stored-plan", annualPct: "-1" }],
    ["rate with no kind", "returnAssumption", { annualPct: "5" }], ["inflation over 100", "inflation", { kind: "stored", pct: "101" }], ["bad retirement month", "retirementMonth", "2050-13"],
    ["retirement month with day", "retirementMonth", "2050-06-01"],
  ] as const) it(`refuses ${label}`, () => { throwsCode(() => ok(set(full(), path, value)), "invalid_response"); });
  it("refuses hidden, symbol and inherited fields and non-plain objects", () => {
    const hidden = full(); Object.defineProperty(hidden, "hidden", { value: 1 });
    for (const bad of [hidden, { ...full(), [Symbol("x")]: 1 }, Object.assign(Object.create({ inherited: 1 }), full()), null, [], "reply", 5]) throwsCode(() => ok(bad), "invalid_response");
  });
  it("accepts a missing return assumption and a missing inflation (never sent today, representable)", () => {
    const reply = set(set(full(), "returnAssumption", { kind: "missing" }), "inflation", { kind: "missing" });
    expect(ok(reply)).toEqual(reply);
  });
});

describe("A4-3 a reply must answer its own request", () => {
  const ok = (value: unknown, req: RetirementContextWireRequest, today = TODAY) => validateRetirementContextReply(value, req, today);
  it("refuses a reply for another account", () => { throwsCode(() => ok(full(), request({ accountId: 6 })), "invalid_response"); });
  it("refuses a reply whose revision differs from the revision the request expected", () => {
    throwsCode(() => ok(full(), request({ expectedRevision: { local: 39, external: 7 } })), "invalid_response");
    throwsCode(() => ok(full(), request({ expectedRevision: { local: 40, external: 8 } })), "invalid_response");
    expect(ok(full(), request({ expectedRevision: { local: 40, external: 7 } })).revision).toEqual({ local: 40, external: 7 });
  });
  it("refuses a reply for another day, including one that crossed midnight while waiting", () => {
    throwsCode(() => ok(full(), request(), "2026-10-18"), "invalid_response");
    throwsCode(() => ok(full(), request(), "2026-10-16"), "invalid_response");
  });
  it("applies the same rules to the roster", () => {
    const roster = referenceRetirementRoster(fixtures[0].seed, TODAY) as { reply: RetirementRosterReply };
    expect(validateRetirementRosterReply(roster.reply, { contractVersion: 1, expectedRevision: null }, TODAY)).toEqual(roster.reply);
    throwsCode(() => validateRetirementRosterReply(roster.reply, { contractVersion: 1, expectedRevision: { local: 1, external: 7 } }, TODAY), "invalid_response");
    throwsCode(() => validateRetirementRosterReply(roster.reply, { contractVersion: 1, expectedRevision: null }, "2026-10-18"), "invalid_response");
  });
});

describe("A4-4 authorization and minimal export", () => {
  it("lists only investment accounts, id and name, sorted by name then id, allowing duplicate names", () => {
    const seed = { profile: fixtures[0].seed.profile, accounts: [
      { id: 2, name: "Savings", type: "savings" as const, startingBalance: "1" }, { id: 9, name: "Roth IRA", type: "investment" as const, startingBalance: "0" },
      { id: 4, name: "Brokerage", type: "investment" as const, startingBalance: "0" }, { id: 7, name: "Roth IRA", type: "investment" as const, startingBalance: "0" },
      { id: 3, name: "Loan", type: "loan" as const, startingBalance: "5" }] };
    const result = referenceRetirementRoster(seed, TODAY);
    expect("reply" in result && result.reply.accounts).toEqual([{ id: 4, name: "Brokerage" }, { id: 7, name: "Roth IRA" }, { id: 9, name: "Roth IRA" }]);
    expect(validateRetirementRosterReply((result as { reply: unknown }).reply, { contractVersion: 1, expectedRevision: null }, TODAY)).toBeTruthy();
  });
  it("an empty roster is valid and means no selectable account, not an error", () => {
    const result = referenceRetirementRoster({ profile: fixtures[0].seed.profile, accounts: [{ id: 1, name: "Checking", type: "checking", startingBalance: "1" }] }, TODAY) as { reply: RetirementRosterReply };
    expect(result.reply.accounts).toEqual([]);
    expect(validateRetirementRosterReply(result.reply, { contractVersion: 1, expectedRevision: null }, TODAY).accounts).toEqual([]);
  });
  const roster = (accounts: unknown[]) => ({ contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { local: 40, external: 7 }, asOf: TODAY, accounts });
  const check = (accounts: unknown[]) => validateRetirementRosterReply(roster(accounts), { contractVersion: 1, expectedRevision: null }, TODAY);
  it("refuses a roster that exposes more than id and name", () => { throwsCode(() => check([{ id: 5, name: "Roth IRA", balance: "10" }]), "invalid_response"); throwsCode(() => check([{ id: 5, name: "Roth IRA", type: "investment" }]), "invalid_response"); });
  it("refuses duplicate ids, blank or overlong names, unsorted order and an oversize roster", () => {
    throwsCode(() => check([{ id: 5, name: "A" }, { id: 5, name: "B" }]), "invalid_response");
    throwsCode(() => check([{ id: 5, name: " " }]), "invalid_response");
    throwsCode(() => check([{ id: 5, name: "x".repeat(513) }]), "invalid_response");
    throwsCode(() => check([{ id: 5, name: "B" }, { id: 4, name: "A" }]), "invalid_response");
    throwsCode(() => check([{ id: 6, name: "A" }, { id: 5, name: "A" }]), "invalid_response");
    throwsCode(() => check(Array.from({ length: RETIREMENT_ROSTER_LIMIT + 1 }, (_, i) => ({ id: i + 1, name: "A" + String(i).padStart(4, "0") }))), "invalid_response");
    expect(check(Array.from({ length: RETIREMENT_ROSTER_LIMIT }, (_, i) => ({ id: i + 1, name: "A" + String(i).padStart(4, "0") }))).accounts).toHaveLength(RETIREMENT_ROSTER_LIMIT);
  });
  it("refuses a sparse roster", () => { const sparse = new Array(2); sparse[0] = { id: 1, name: "A" }; throwsCode(() => check(sparse), "invalid_response"); });
  it("the reference model refuses missing, deleted, non-investment, locked, switched and stale reads", () => {
    const refusals = Object.fromEntries(fixtures.filter(f => "error" in f.expected).map(f => [f.id, (f.expected as { error: string }).error]));
    expect(refusals).toEqual({
      "other-account-types-never-selectable": "account_unavailable", "deleted-account-is-unavailable": "account_unavailable", "profile-locked": "stale_profile",
      "profile-switched-generation": "stale_profile", "session-revision-moved": "stale_profile", "expected-revision-local-differs": "stale_data", "expected-revision-external-differs": "stale_data",
    });
  });
  it("a locked or switched profile also refuses the roster", () => {
    const seed = fixtures[0].seed;
    expect(referenceRetirementRoster({ ...seed, profile: { ...seed.profile, locked: true } }, TODAY)).toEqual({ error: "stale_profile" });
    expect(referenceRetirementRoster(seed, TODAY, { generation: 2, sessionRevision: 11 })).toEqual({ error: "stale_profile" });
    expect(referenceRetirementRoster(seed, TODAY, undefined, { local: 0, external: 0 })).toEqual({ error: "stale_data" });
  });
  it("a context read exposes nothing about other accounts: the account block is exactly id, name and type", () => {
    const reply = full(); expect(Object.keys(reply.account).sort()).toEqual(["id", "name", "type"]);
    expect(Object.keys(reply).sort()).toEqual(["account", "asOf", "context", "contractVersion", "contribution", "inflation", "retirementMonth", "returnAssumption", "revision", "worth"]);
  });
});

describe("A4-5 source identity and freshness", () => {
  const source = (): RetirementSource => retirementSourceFromReply(full());
  it("derives one complete source from a reply; settings changes ride the data revision", () => {
    expect(source()).toEqual({ generation: 3, sessionRevision: 11, revision: { local: 40, external: 7 }, settingsRevision: 40, asOf: TODAY });
    const reply = full(); const s = retirementSourceFromReply(reply); s.revision.local = 0; expect(reply.revision.local).toBe(40);
  });
  for (const [label, liveSource, today, expected] of [
    ["identical", {}, TODAY, "current"], ["day rolled over", {}, "2026-10-18", "date"], ["live source day differs", { asOf: "2026-10-18" }, TODAY, "date"],
    ["local data changed", { revision: { local: 41, external: 7 } }, TODAY, "data"], ["other window wrote", { revision: { local: 40, external: 8 } }, TODAY, "data"],
    ["settings counter moved", { settingsRevision: 41 }, TODAY, "data"], ["profile switched", { generation: 4 }, TODAY, "session"], ["session moved (lock/unlock)", { sessionRevision: 12 }, TODAY, "session"],
    ["switch and data both changed", { generation: 4, revision: { local: 99, external: 7 } }, TODAY, "session"], ["day and data both changed", { revision: { local: 41, external: 7 } }, "2026-10-18", "date"],
    ["session and day both changed", { sessionRevision: 12 }, "2026-10-18", "session"],
  ] as const) it(`classifies ${label} as ${expected}`, () => { expect(retirementFreshness(source(), { source: { ...source(), ...liveSource } as RetirementSource, today })).toBe(expected); });
  it("treats no open profile as a session change", () => { expect(retirementFreshness(source(), { source: null, today: TODAY })).toBe("session"); });
  it("never reports current for a malformed live source", () => { expect(retirementFreshness(source(), { source: { ...source(), asOf: "bad" }, today: TODAY })).not.toBe("current"); });
  it("every listed trigger names the counter that exposes it and every mutation scenario maps to a listed trigger", () => {
    const ids = RETIREMENT_INVALIDATION_TRIGGERS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(["account-edit", "date-rollover", "external-write", "holding-write", "inflation-save", "lock", "plan-save", "profile-switch", "transaction-write"]);
    for (const t of RETIREMENT_INVALIDATION_TRIGGERS) expect(["revision.local", "revision.external", "asOf", "generation", "sessionRevision"]).toContain(t.detectedBy);
    for (const m of retirementMutationScenarios()) expect(ids).toContain(m.trigger);
  });
  for (const scenario of retirementMutationScenarios()) it(`trigger scenario ${scenario.id} retires a review through ${scenario.trigger}`, () => {
    const base = fixtures.find(f => f.id === "full-saved-plan-holdings")!;
    const before = referenceRetirementContext(base) as { reply: RetirementContextReply };
    const mutatedSeed = scenario.mutate(base.seed);
    const livePeek = { seed: mutatedSeed, today: base.today, accountId: 5 };
    const trigger = RETIREMENT_INVALIDATION_TRIGGERS.find(t => t.id === scenario.trigger)!;
    const liveSource = retirementSourceFromReply({ context: { generation: mutatedSeed.profile.generation, sessionRevision: mutatedSeed.profile.sessionRevision }, revision: mutatedSeed.profile.revision, asOf: base.today });
    const verdict = retirementFreshness(retirementSourceFromReply(before.reply), { source: liveSource, today: base.today });
    expect(verdict).not.toBe("current");
    expect(verdict).toBe(trigger.detectedBy === "generation" || trigger.detectedBy === "sessionRevision" ? "session" : "data");
    const after = referenceRetirementContext(livePeek);
    if (scenario.changesContent && "reply" in after) expect(after.reply).not.toEqual(before.reply);
    // A re-read bound to the reviewed revision is refused instead of returning changed terms.
    expect(referenceRetirementContext({ ...livePeek, expectedRevision: base.seed.profile.revision, origin: { generation: base.seed.profile.generation, sessionRevision: base.seed.profile.sessionRevision } }))
      .toMatchObject({ error: expect.stringMatching(/^stale_(data|profile)$/) });
  });
  it("a date rollover is exposed by the as-of date alone", () => { expect(RETIREMENT_INVALIDATION_TRIGGERS.find(t => t.id === "date-rollover")!.detectedBy).toBe("asOf"); });
});

describe("A4-6..A4-9 provenance, contribution, worth and candidates (hand expectation equals reference model)", () => {
  for (const f of fixtures) it(`fixture ${f.id}: hand-written expectation equals the reference model`, () => { expect(referenceRetirementContext(f)).toEqual(f.expected); });
  it("fixture ids are unique and every one names the requirements it covers", () => {
    expect(new Set(fixtures.map(f => f.id)).size).toBe(fixtures.length);
    for (const f of fixtures) { expect(f.covers.length).toBeGreaterThan(0); expect(f.note.length).toBeGreaterThan(10); }
  });
  it("covers every scenario the ledger lists for N1-N4, E1, E7 and E8", () => {
    const covered = new Set(fixtures.flatMap(f => f.covers));
    for (const id of ["N1", "N2", "N3", "N4", "E1", "E7", "E8", "I2", "S1"]) expect(covered.has(id)).toBe(true);
    const ids = new Set(fixtures.map(f => f.id));
    for (const needed of ["no-plan-row-default-return", "saved-zero-return", "saved-seven-is-only-a-candidate", "saved-zero-contribution-beats-history", "only-current-month-deposit", "no-deposits-at-all",
      "empty-account-worth-is-missing", "recorded-zero-is-not-missing", "other-account-types-never-selectable", "deleted-account-is-unavailable", "profile-locked", "expected-revision-local-differs",
      "duplicate-names-are-different-accounts", "holdings-replace-transaction-balance", "year-boundary-window", "leap-day-as-of"]) expect(ids.has(needed)).toBe(true);
  });
  it("a default return is never labelled stored-plan, and no row never yields a stored-plan", () => {
    for (const f of fixtures) {
      const reply = replyOf(f); if (!reply) continue;
      const hasPlan = (f.seed.plans ?? []).some(p => p.accountId === f.accountId);
      expect(reply.returnAssumption.kind === "stored-plan").toBe(hasPlan);
    }
  });
  it("a saved contribution (even 0) wins over history; history never appears with a saved amount", () => {
    for (const f of fixtures) {
      const reply = replyOf(f); if (!reply) continue;
      const saved = (f.seed.plans ?? []).some(p => p.accountId === f.accountId && p.monthly !== null);
      expect(reply.contribution.kind === "saved").toBe(saved);
    }
  });
  it("worth basis is none exactly when the amount is null", () => { for (const f of fixtures) { const r = replyOf(f); if (r) expect(r.worth.basis === "none").toBe(r.worth.amount === null); } });
  it("a missing worth is never rewritten as zero by the mapping", () => {
    const empty = replyOf(fixtures.find(f => f.id === "empty-account-worth-is-missing")!)!;
    expect(retirementContextFromReply(empty).context.currentValue).toBeNull();
    const zero = replyOf(fixtures.find(f => f.id === "recorded-zero-is-not-missing")!)!;
    expect(retirementContextFromReply(zero).context.currentValue).toBe("0");
  });
  it("a well-formed saved month beyond the supported range is read as saved evidence and reaches the domain context unchanged", () => {
    for (const saved of ["2101-01", "2200-12"]) {
      const reply = set(full(), "retirementMonth", saved) as RetirementContextReply;
      expect(validateRetirementContextReply(reply, request(), TODAY)).toEqual(reply);
      const read = retirementContextFromReply(reply);
      expect(read.context.retirementMonth).toBe(saved);
      expect(validateRetirementContext(read.context)).toEqual({ ok: true });
    }
  });
  it("maps a reply into a valid domain context plus an inflation candidate, deriving the source", () => {
    for (const f of fixtures) {
      const reply = replyOf(f); if (!reply) continue;
      const read: RetirementContextRead = retirementContextFromReply(reply);
      expect(validateRetirementContext(read.context)).toEqual({ ok: true });
      expect(validateRetirementInflationCandidate(read.inflation)).toEqual({ ok: true });
      expect(read.context.source).toEqual(retirementSourceFromReply(reply));
      expect(read.context.account).toEqual(reply.account);
      expect(read.context.retirementMonth).toBe(reply.retirementMonth);
      expect(read.context.contribution).toEqual(reply.contribution);
      expect(read.context.returnAssumption).toEqual(reply.returnAssumption);
    }
  });
  it("refuses to map a reply whose history summary contradicts itself (client-side validation, not trust)", () => {
    const reply = replyOf(fixtures.find(f => f.id === "history-three-months")!)!;
    (reply.contribution as { monthCount: number }).monthCount = 5;
    throwsCode(() => retirementContextFromReply(reply), "invalid_response");
  });
});

describe("A4-6/E7 interacting with the confirmed-scenario validator", () => {
  const scenarioFor = (f: NativeFixture, patch: (s: ConfirmedRetirementScenario) => void = () => {}): { scenario: ConfirmedRetirementScenario; live: Parameters<typeof validateConfirmedRetirementScenario>[1] } => {
    const reply = replyOf(f)!; const { context } = retirementContextFromReply(reply);
    const monthly = context.contribution.kind === "missing" ? null : { basis: "context" as const, amount: context.contribution.monthlyAmount };
    const scenario: ConfirmedRetirementScenario = { intent: { version: 1, accountId: 5, extra: { kind: "monthly", amount: "50" }, startDate: f.today, retirementMonth: "2030-06" }, context,
      assumptions: { view: "balances", monthlyContribution: monthly, returns: { kind: "no-growth" }, purchasingPower: { kind: "nominal" } }, confirmed: true };
    patch(scenario);
    return { scenario, live: { today: f.today, investmentAccounts: [{ id: 5, name: "Roth IRA" }], source: context.source } };
  };
  const by = (id: string) => fixtures.find(f => f.id === id)!;
  it("a complete saved plan validates with its stored return as the basis", () => {
    const { scenario, live } = scenarioFor(by("full-saved-plan-holdings"), s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: "6", basis: "stored-plan", sensitivity: null }; });
    expect(validateConfirmedRetirementScenario(scenario, live)).toEqual({ ok: true });
  });
  it("an untouched default return cannot be confirmed as a stored-plan return, but can be confirmed explicitly", () => {
    const { scenario, live } = scenarioFor(by("no-plan-row-default-return"), s => { s.assumptions.returns = { kind: "confirmed-return", annualPct: "7", basis: "stored-plan", sensitivity: null }; s.assumptions.monthlyContribution = { basis: "manual", amount: "100" }; });
    expect(validateConfirmedRetirementScenario(scenario, live)).toMatchObject({ ok: false, code: "invalid-assumptions" });
    scenario.assumptions.returns = { kind: "confirmed-return", annualPct: "7", basis: "explicit", sensitivity: null };
    expect(validateConfirmedRetirementScenario(scenario, live)).toEqual({ ok: true });
  });
  it("a missing contribution cannot be silently treated as a confirmed zero, but an explicit manual zero is allowed", () => {
    const { scenario, live } = scenarioFor(by("no-deposits-at-all"), s => { s.assumptions.monthlyContribution = { basis: "context", amount: "0" }; });
    expect(validateConfirmedRetirementScenario(scenario, live)).toMatchObject({ ok: false, code: "invalid-assumptions" });
    scenario.assumptions.monthlyContribution = { basis: "manual", amount: "0" };
    expect(validateConfirmedRetirementScenario(scenario, live)).toEqual({ ok: true });
  });
  it("a missing worth allows only the exact-deposits-only view", () => {
    const { scenario, live } = scenarioFor(by("empty-account-worth-is-missing"), s => { s.assumptions.monthlyContribution = { basis: "manual", amount: "10" }; });
    expect(validateConfirmedRetirementScenario(scenario, live)).toMatchObject({ ok: false, code: "invalid-assumptions" });
    scenario.assumptions = { view: "extra-deposits-only", monthlyContribution: null, returns: { kind: "no-growth" }, purchasingPower: { kind: "nominal" } };
    expect(validateConfirmedRetirementScenario(scenario, live)).toEqual({ ok: true });
  });
  it("a saved zero return is a real stored return that can be confirmed", () => {
    const { scenario, live } = scenarioFor(by("saved-zero-return"), s => { s.assumptions.monthlyContribution = { basis: "manual", amount: "10" }; s.assumptions.returns = { kind: "confirmed-return", annualPct: "0", basis: "stored-plan", sensitivity: null }; });
    expect(validateConfirmedRetirementScenario(scenario, live)).toEqual({ ok: true });
  });
  it("a review made before the data or settings changed is stale against the new source", () => {
    const f = by("full-saved-plan-holdings"); const { scenario } = scenarioFor(f);
    const changed = retirementMutationScenarios().find(m => m.id === "save-plan-return")!.mutate(f.seed);
    const live = { today: f.today, investmentAccounts: [{ id: 5, name: "Roth IRA" }], source: retirementSourceFromReply({ context: { generation: 3, sessionRevision: 11 }, revision: changed.profile.revision, asOf: f.today }) };
    expect(validateConfirmedRetirementScenario(scenario, live)).toMatchObject({ ok: false, code: "stale" });
  });
  it("a renamed account makes the review stale", () => {
    const f = by("full-saved-plan-holdings"); const { scenario, live } = scenarioFor(f);
    expect(validateConfirmedRetirementScenario(scenario, { ...live, investmentAccounts: [{ id: 5, name: "Retirement IRA" }] })).toMatchObject({ ok: false, code: "stale" });
  });
  it("ambiguous duplicate names remain separate selectable accounts in the roster", () => {
    const f = by("duplicate-names-are-different-accounts"); const roster = referenceRetirementRoster(f.seed, f.today) as { reply: RetirementRosterReply };
    expect(roster.reply.accounts).toEqual([{ id: 5, name: "Roth IRA" }, { id: 6, name: "Roth IRA" }]);
  });
});

describe("A4-9 inflation candidate", () => {
  for (const ok of [{ kind: "stored", pct: "0" }, { kind: "stored", pct: "100" }, { kind: "application-default", pct: "3" }, { kind: "missing" }, { kind: "stored", pct: "2.5" }])
    it(`accepts ${JSON.stringify(ok)}`, () => { expect(validateRetirementInflationCandidate(ok)).toEqual({ ok: true }); });
  for (const bad of [{ kind: "stored", pct: "-0.1" }, { kind: "stored", pct: "100.01" }, { kind: "stored" }, { kind: "missing", pct: "3" }, { kind: "manual", pct: "3" }, { kind: "stored", pct: 3 }, { kind: "stored", pct: "3", extra: 1 }, null, "3", []])
    it(`refuses ${JSON.stringify(bad)}`, () => { expect(validateRetirementInflationCandidate(bad)).toMatchObject({ ok: false }); });
});

describe("A4-10 failures are plain, and stale is distinguished from error", () => {
  const explain = (code: string, message = "internal wording") => explainRetirementFailure(new TransactionError(code, message));
  for (const code of ["stale_profile", "profile_locked", "no_profile_open", "superseded"]) it(`${code} retires the review`, () => { expect(explain(code).status).toBe("stale"); });
  it("changed data and an unavailable account retire the review", () => { expect(explain("stale_data").status).toBe("stale"); expect(explain("account_unavailable").status).toBe("stale"); });
  it("a refused request or malformed reply is an error that keeps its authored message", () => {
    expect(explain("invalid_argument", "Choose one investment account.")).toEqual({ status: "error", message: "Choose one investment account." });
    expect(explain("invalid_response", "The app received an incomplete retirement account. Ask again.")).toEqual({ status: "error", message: "The app received an incomplete retirement account. Ask again." });
  });
  it("anything else, including non-errors, becomes a generic error without internal wording", () => {
    for (const failure of [new TransactionError("internal_error", "SQLITE_BUSY at line 42"), new Error("boom"), "boom", null, undefined, 42, { code: 7 }]) {
      const out = explainRetirementFailure(failure); expect(out.status).toBe("error"); expect(out.message).not.toMatch(/sqlite|line 42|boom/i);
    }
  });
  it("never uses engineering words in user-facing text", () => {
    const messages = ["stale_profile", "stale_data", "account_unavailable", "internal_error", "mystery"].map(c => explain(c).message);
    for (const m of messages) expect(m).not.toMatch(/revision|generation|contract|payload|snapshot|session|counter|DTO/i);
    expect(new Set(messages).size).toBeGreaterThan(2);
  });
  it("validator failures are authored in plain language", () => {
    for (const bad of [() => validateRetirementContextWireRequest({}), () => validateRetirementContextReply({}, request(), TODAY), () => validateRetirementRosterReply({}, { contractVersion: 1, expectedRevision: null }, TODAY)])
      try { bad(); } catch (e) { expect((e as Error).message).not.toMatch(/revision|generation|contract|payload|snapshot|DTO|undefined/i); expect((e as Error).message.length).toBeGreaterThan(10); }
  });
});

describe("A4-12 the reader result carries the inflation candidate", () => {
  it("a context result requires both the context and the candidate", () => {
    const read = retirementContextFromReply(full());
    const result: RetirementContextResult = { status: "context", ...read };
    expect(result.inflation).toEqual({ kind: "stored", pct: "2.5" });
    expect(result.context.account.id).toBe(5);
  });
});

describe("A4-4 roster order is code-point order, then id (identical in the native language)", () => {
  it("orders by Unicode code point, not UTF-16 unit, then prefix, then id", () => {
    expect(compareRetirementRosterRows({ id: 1, name: "\uFF5E" }, { id: 2, name: "\u{1F600}" })).toBe(-1);
    expect(compareRetirementRosterRows({ id: 2, name: "\u{1F600}" }, { id: 1, name: "\uFF5E" })).toBe(1);
    expect(compareRetirementRosterRows({ id: 1, name: "Roth" }, { id: 2, name: "Roth IRA" })).toBe(-1);
    expect(compareRetirementRosterRows({ id: 7, name: "A" }, { id: 3, name: "A" })).toBe(1);
    expect(compareRetirementRosterRows({ id: 3, name: "A" }, { id: 3, name: "A" })).toBe(0);
    expect(compareRetirementRosterRows({ id: 1, name: "B" }, { id: 2, name: "a" })).toBe(-1);
  });
});

describe("A4-11 review defects F1-F3: the reference model follows the native rules", () => {
  it("has hand-written fixtures for exact decimal history, backdated checkpoints and same-date ties", () => {
    for (const id of ["backdated-checkpoint-latest-date-wins", "same-date-checkpoints-later-insertion-wins", "same-date-checkpoints-reverse-order", "sub-cent-deposits-sum-before-rounding",
      "decimal-tie-rounds-away-from-zero", "deposit-beyond-float-precision-stays-exact", "many-small-deposits-across-months-exact-mean"]) expect(fixtures.some(f => f.id === id), id).toBe(true);
  });
  const named = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Account ${String(i + 1).padStart(3, "0")}`, type: "investment" as const, startingBalance: "0" }));
  const seed = (n: number) => ({ profile: fixtures[0].seed.profile, accounts: [...named(n), { id: 900, name: "Checking", type: "checking" as const, startingBalance: "5" }] });
  it("lists exactly 200 investment accounts (and ignores other types when counting)", () => {
    const out = referenceRetirementRoster(seed(RETIREMENT_ROSTER_LIMIT), TODAY);
    expect("reply" in out && out.reply.accounts.length).toBe(RETIREMENT_ROSTER_LIMIT);
    expect("reply" in out && out.reply.accounts[0]).toEqual({ id: 1, name: "Account 001" });
    expect("reply" in out && out.reply.accounts[199]).toEqual({ id: 200, name: "Account 200" });
  });
  it("answers 201 investment accounts with too_many_accounts and no partial list", () => {
    expect(referenceRetirementRoster(seed(RETIREMENT_ROSTER_LIMIT + 1), TODAY)).toEqual({ error: "too_many_accounts" });
  });
  it("still reports a profile or data problem before the size problem", () => {
    expect(referenceRetirementRoster({ ...seed(201), profile: { ...fixtures[0].seed.profile, locked: true } }, TODAY)).toEqual({ error: "stale_profile" });
    expect(referenceRetirementRoster(seed(201), TODAY, undefined, { local: 0, external: 0 })).toEqual({ error: "stale_data" });
  });
  it("does not limit reading one account's context in a large profile", () => {
    const out = referenceRetirementContext({ seed: seed(201), today: TODAY, accountId: 7 });
    expect("reply" in out && out.reply.account).toEqual({ id: 7, name: "Account 007", type: "investment" });
  });
  it("keeps a trailing checkpoint after the as-of date out of the balance", () => {
    const seedWith = { profile: fixtures[0].seed.profile, accounts: [{ id: 5, name: "Roth IRA", type: "investment" as const, startingBalance: "7", resets: [{ date: "2026-12-31", balance: "999" }, { date: "2026-03-31", balance: "100" }], transactions: [{ date: "2026-05-01", amount: "1" }] }] };
    const out = referenceRetirementContext({ seed: seedWith, today: TODAY, accountId: 5 });
    expect("reply" in out && out.reply.worth).toEqual({ amount: "101", basis: "transactions" });
  });
});

describe("A4-2 review defect F4: nested hidden fields are refused, not repaired by cloning", () => {
  const ok = (value: unknown) => validateRetirementContextReply(value, request(), TODAY);
  const withHidden = (path: "contribution" | "returnAssumption" | "inflation" | "worth" | "account" | "context" | "revision", how: "nonenumerable" | "symbol" | "extra" | "inherited") => {
    const reply = full() as unknown as Record<string, Record<string, unknown>>;
    const nested = reply[path];
    if (how === "nonenumerable") Object.defineProperty(nested, "hidden", { value: 1, enumerable: false });
    else if (how === "symbol") nested[Symbol("hidden") as unknown as string] = 1;
    else if (how === "extra") nested.extra = 1;
    else reply[path] = Object.assign(Object.create({ inherited: 1 }), nested);
    return reply;
  };
  for (const path of ["contribution", "returnAssumption", "inflation", "worth", "account", "context", "revision"] as const)
    for (const how of ["nonenumerable", "symbol", "extra", "inherited"] as const)
      it(`refuses a ${how} field on ${path}`, () => { throwsCode(() => ok(withHidden(path, how)), "invalid_response"); });
  it("refuses a hidden field on a history contribution and on a missing one", () => {
    const history = { ...full(), contribution: { kind: "history", monthlyAmount: "5", fromMonth: "2026-07", toMonth: "2026-09", monthCount: 3 } } as unknown as Record<string, Record<string, unknown>>;
    Object.defineProperty(history.contribution, "hidden", { value: 1 }); throwsCode(() => ok(history), "invalid_response");
    const missing = { ...full(), contribution: { kind: "missing" } } as unknown as Record<string, Record<string, unknown>>;
    Object.defineProperty(missing.contribution, "hidden", { value: 1 }); throwsCode(() => ok(missing), "invalid_response");
  });
  it("refuses a hidden field on a nested object reached through the roster", () => {
    const roster = referenceRetirementRoster(fixtures[0].seed, TODAY) as { reply: RetirementRosterReply };
    const copy = structuredClone(roster.reply) as unknown as { accounts: Record<string, unknown>[] };
    Object.defineProperty(copy.accounts[0], "hidden", { value: 1 });
    throwsCode(() => validateRetirementRosterReply(copy, { contractVersion: 1, expectedRevision: null }, TODAY), "invalid_response");
  });
  it("converts a validated reply with the same strictness and still returns independent copies", () => {
    const reply = full(); const read = retirementContextFromReply(reply); read.context.contribution = { kind: "missing" };
    expect(reply.contribution).toEqual({ kind: "saved", monthlyAmount: "300" });
    const tampered = full(); Object.defineProperty(tampered.returnAssumption, "hidden", { value: 1 });
    throwsCode(() => retirementContextFromReply(tampered), "invalid_response");
  });
});

describe("A4-10 more investment accounts than the list can hold is an explicit, plain refusal", () => {
  it("is an error (not a stale review) that names the limit instead of truncating the list", () => {
    const out = explainRetirementFailure(new TransactionError("too_many_accounts", "internal"));
    expect(out.status).toBe("error"); expect(out.message).toContain(String(RETIREMENT_ROSTER_LIMIT)); expect(out.message).not.toMatch(/revision|generation|internal/i);
  });
});

describe("second review: the roster reply's account array is judged as it arrived", () => {
  const roster = () => structuredClone((referenceRetirementRoster(fixtures[0].seed, TODAY) as { reply: RetirementRosterReply }).reply);
  const check = (value: unknown) => validateRetirementRosterReply(value, { contractVersion: 1, expectedRevision: null }, TODAY);
  it("accepts the plain reply", () => { expect(check(roster()).accounts.length).toBeGreaterThan(0); });
  for (const how of ["nonenumerable", "symbol", "extra", "prototype", "hole"] as const) it(`refuses a ${how} field or shape on the accounts array`, () => {
    const reply = roster() as unknown as { accounts: unknown[] };
    if (how === "nonenumerable") Object.defineProperty(reply.accounts, "hidden", { value: 1 });
    else if (how === "symbol") (reply.accounts as unknown as Record<symbol, number>)[Symbol("x")] = 1;
    else if (how === "extra") (reply.accounts as unknown as Record<string, number>).extra = 1;
    else if (how === "prototype") Object.setPrototypeOf(reply.accounts, class extends Array {}.prototype);
    else delete reply.accounts[0];
    throwsCode(() => check(reply), "invalid_response");
  });
});
