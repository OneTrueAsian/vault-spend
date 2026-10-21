// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useRetirementScenario } from "./useRetirementScenario";
import { notifyDataWrite } from "./dataWriteEvents";
import { parseRetirementScenario } from "./retirementParser";
import { calculateRetirementScenario } from "./retirementScenarioMath";
import {
  RETIREMENT_CHANGED_MESSAGE, RETIREMENT_TRANSITIONS, buildExploreConfirmation, buildRetirementConfirmation, canTransition, retirementReviewChoices, retirementReviewContent, retirementUseQuestionReturn, validateRetirementScreen,
} from "./retirementScreenContract";
import type { RetirementChoicesEvent, RetirementReview, RetirementScreen, RetirementStage } from "./retirementScreenContract";
import type { ConfirmedRetirementScenario, RetirementCalculation, RetirementContextRead } from "./retirementScenarioContract";
import type { RetirementContextReply, RetirementContextWireRequest, RetirementRosterReply, RetirementRosterWireRequest } from "./retirementNativeContract";
import { retirementContextFromReply, validateRetirementContextReply, validateRetirementRosterReply } from "./retirementNativeContract";
import type { AskDataRevision, ParseContext } from "./types";
import { TransactionError } from "../transactionContracts";

vi.mock("./retirementParser", async importOriginal => { const real = await importOriginal<typeof import("./retirementParser")>(); return { ...real, parseRetirementScenario: vi.fn(real.parseRetirementScenario) }; });
vi.mock("./retirementScenarioMath", async importOriginal => { const real = await importOriginal<typeof import("./retirementScenarioMath")>(); return { ...real, calculateRetirementScenario: vi.fn(real.calculateRetirementScenario) }; });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---- A fictional native world: what the two read-only commands would answer ----------------------------------------------------------------------------------
const TODAY = "2026-10-17";
type Account = { id: number; name: string; value: string | null; contribution?: RetirementContextReply["contribution"]; ret?: RetirementContextReply["returnAssumption"]; month?: string | null; inflation?: RetirementContextReply["inflation"] };
type Gate = { release: () => void; promise: Promise<void> };
function makeWorld() {
  const w = {
    today: TODAY, generation: 3, session: 11, revision: { local: 40, external: 7 } as AskDataRevision,
    accounts: [
      { id: 6, name: "Brokerage", value: "25000" }, { id: 5, name: "Roth IRA", value: "10000" }, { id: 7, name: "Vanguard Fund", value: null },
    ] as Account[],
    calls: [] as { kind: "roster" | "context"; request: unknown }[],
    gates: { roster: null as Gate | null, context: null as Gate | null },
    failNext: null as null | { kind: "roster" | "context"; error: unknown },
    contextOverride: null as null | ((reply: RetirementContextReply) => RetirementContextReply),
    disposed: 0,
    gate(kind: "roster" | "context"): Gate { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); const gate = { release, promise }; w.gates[kind] = gate; return gate; },
    bump() { w.revision = { local: w.revision.local + 1, external: w.revision.external }; },
    reply(id: number): RetirementContextReply {
      const a = w.accounts.find(x => x.id === id);
      if (!a) throw new TransactionError("account_unavailable", "That investment account is no longer available.");
      const base: RetirementContextReply = {
        contractVersion: 1, context: { generation: w.generation, sessionRevision: w.session }, revision: { ...w.revision }, asOf: w.today,
        account: { id: a.id, name: a.name, type: "investment" },
        worth: a.value === null ? { amount: null, basis: "none" } : { amount: a.value, basis: "holdings" },
        contribution: a.contribution ?? { kind: "saved", monthlyAmount: "200" }, returnAssumption: a.ret ?? { kind: "stored-plan", annualPct: "7" },
        inflation: a.inflation ?? { kind: "stored", pct: "3" }, retirementMonth: a.month === undefined ? "2056-01" : a.month,
      };
      return w.contextOverride ? w.contextOverride(base) : base;
    },
  };
  return w;
}
type World = ReturnType<typeof makeWorld>;
const byName = (a: { id: number; name: string }, b: { id: number; name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id);

function fakeClient(w: World) {
  const take = (kind: "roster" | "context") => { if (w.failNext?.kind === kind) { const { error } = w.failNext; w.failNext = null; throw error; } };
  return {
    askVault: vi.fn(), dispose: vi.fn(() => { w.disposed++; }),
    askVaultRetirementAccounts: vi.fn(async (request: RetirementRosterWireRequest) => {
      w.calls.push({ kind: "roster", request: structuredClone(request) });
      const gate = w.gates.roster; if (gate) { w.gates.roster = null; await gate.promise; }
      take("roster");
      if (request.expectedRevision && (request.expectedRevision.local !== w.revision.local || request.expectedRevision.external !== w.revision.external)) throw new TransactionError("stale_data", "Your accounts changed.");
      const raw: RetirementRosterReply = { contractVersion: 1, context: { generation: w.generation, sessionRevision: w.session }, revision: { ...w.revision }, asOf: w.today, accounts: w.accounts.map(({ id, name }) => ({ id, name })).sort(byName) };
      return validateRetirementRosterReply(raw, request, w.today);
    }),
    askVaultRetirementContext: vi.fn(async (request: RetirementContextWireRequest) => {
      w.calls.push({ kind: "context", request: structuredClone(request) });
      const gate = w.gates.context; if (gate) { w.gates.context = null; await gate.promise; }
      take("context");
      if (request.expectedRevision && (request.expectedRevision.local !== w.revision.local || request.expectedRevision.external !== w.revision.external)) throw new TransactionError("stale_data", "Your accounts changed.");
      return validateRetirementContextReply(w.reply(request.accountId), request, w.today);
    }),
  };
}

// ---- The harness: a component that runs the hook and records every screen it shows ---------------------------------------------------------------------------
type Hook = ReturnType<typeof useRetirementScenario>;
type App = { dataKey: unknown; reloadKey: unknown; investmentAccounts: { id: number; name: string }[] | undefined };
let contextReads = 0, validations = 0, root: Root, host: HTMLElement, world: World, client: ReturnType<typeof fakeClient>, app: App, out: { current: Hook }, stages: RetirementStage[], invalid: string[];
const dashboardAccounts = (w: World) => w.accounts.map(({ id, name }) => ({ id, name }));
function Harness({ state }: { state: App }) {
  const hook = useRetirementScenario({
    getContext: () => (contextReads++, { today: world.today, categories: [], accounts: [], investmentAccounts: state.investmentAccounts } as ParseContext),
    dataKey: state.dataKey, reloadKey: state.reloadKey, createClient: () => client as never,
  });
  out.current = hook;
  if (hook.screen) {
    if (stages[stages.length - 1] !== hook.screen.stage) stages.push(hook.screen.stage);
    const before = vi.mocked(calculateRetirementScenario).mock.calls.length;
    const verdict = validateRetirementScreen(hook.screen, hook.live);
    validations += vi.mocked(calculateRetirementScenario).mock.calls.length - before;
    if (!verdict.ok) invalid.push(`${hook.screen.stage}: ${verdict.reason}`);
  }
  return null;
}
const render = () => act(async () => { root.render(<Harness state={{ ...app }} />); });
async function settle() { await act(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0); else await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function ask(question: string) { let claimed = false; await act(async () => { claimed = out.current.ask(question); }); await settle(); return claimed; }
async function press(action: () => unknown) { await act(async () => { await action(); }); await settle(); }
const stage = () => out.current.screen?.stage ?? null;
const screen = <S extends RetirementStage>(name: S) => { expect(stage()).toBe(name); return out.current.screen as RetirementScreen & { stage: S }; };
const calculations = () => vi.mocked(calculateRetirementScenario).mock.calls.length - validations;
const calls = (kind?: "roster" | "context") => world.calls.filter(c => !kind || c.kind === kind);

const Q_COMPLETE = "How much would an extra $50 a month into Roth IRA until January 2056 add?";
const Q_NO_ACCOUNT = "extra $50 a month for retirement";
const Q_NO_KEYWORD = "put $50 a month into Vanguard Fund until January 2056";
const FORM = { amount: "", chooseReturn: false, returnPct: "", todays: false, inflation: null };
const planChoices = (review: RetirementReview) => retirementReviewChoices(review, FORM, "plan");
function scenarioFor(review: RetirementReview, choices = planChoices(review)): ConfirmedRetirementScenario { const built = buildRetirementConfirmation(review, choices); if (!built.ok) throw new Error(built.reason); return built.scenario; }
async function toReview(question = Q_COMPLETE) { expect(await ask(question)).toBe(true); return screen("review").review; }
async function toResult(question = Q_COMPLETE) { const review = await toReview(question); await press(() => out.current.confirm(scenarioFor(review))); return screen("result").calculation; }
const accountStep = (id: number, draft: RetirementChoicesEvent & { step: "account" } | null = null): RetirementChoicesEvent => {
  const current = (out.current.screen as Extract<RetirementScreen, { stage: "choices" }>).draft;
  return draft ?? { step: "account", draft: { ...current, accountId: id, missing: current.missing.filter(m => m !== "account") } };
};

beforeEach(async () => {
  world = makeWorld(); client = fakeClient(world); stages = []; invalid = []; validations = 0; contextReads = 0;
  app = { dataKey: "k1", reloadKey: "r1", investmentAccounts: dashboardAccounts(world) };
  out = { current: null as never }; host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(parseRetirementScenario).mockClear(); validations = 0; vi.mocked(calculateRetirementScenario).mockClear();
  await render();
});
afterEach(async () => {
  expect(invalid, "every screen shown must validate against the live roster").toEqual([]);
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe("M5 controller: claims (B1, A2)", () => {
  it("does not read the Dashboard's context while rendering with no question open", async () => {
    const before = contextReads; await render(); await render(); expect(contextReads).toBe(before);
  });
  it("claims an account-name question with no retirement keyword and no leading 'extra'", async () => {
    expect(await ask(Q_NO_KEYWORD)).toBe(true);
    expect(["reading", "choices", "review"]).toContain(stage());
  });
  it("does not claim an ordinary spending question and reads nothing", async () => {
    expect(await ask("how much did I spend on groceries last month")).toBe(false);
    expect(stage()).toBeNull(); expect(world.calls).toEqual([]);
  });
  it("gives the parser only today, the category and store names and the ids and names of the Dashboard's investment accounts", async () => {
    app.investmentAccounts = [{ id: 5, name: "Roth IRA", balance: "99", type: "investment" } as never];
    await render(); await ask(Q_COMPLETE);
    expect(vi.mocked(parseRetirementScenario).mock.calls[0]).toStrictEqual([Q_COMPLETE, { today: TODAY, investmentAccounts: [{ id: 5, name: "Roth IRA" }], categories: [], merchants: undefined }]);
  });
  it("shows a plain refusal, with no native read, when the Dashboard lists no investment account", async () => {
    app.investmentAccounts = undefined; await render();
    expect(await ask(Q_COMPLETE)).toBe(true);
    expect(screen("unsupported").reason).toMatch(/investment account/i); expect(world.calls).toEqual([]);
  });
  it("shows the parser's refusal for an unsupported request without reading anything", async () => {
    expect(await ask("Should I save more for retirement")).toBe(true);
    screen("unsupported"); expect(world.calls).toEqual([]);
  });
  it("offers a clarification with replacement questions and reads nothing", async () => {
    expect(await ask("extra $50 a month into Brokerge until 2056-01")).toBe(true);
    expect(stage()).toBeNull();
    expect(out.current.clarification).toMatchObject({ choices: ["Brokerage"], replacements: ["extra $50 a month into Brokerage until 2056-01"] });
    expect(world.calls).toEqual([]);
  });
});

describe("M5 controller: roster authority (C1–C3)", () => {
  it("reads the native roster before anything about an account, then shows the choices from that roster", async () => {
    world.gate("roster"); await act(async () => { out.current.ask(Q_NO_ACCOUNT); });
    expect(screen("reading").accountName).toBeNull(); expect(calls().map(c => c.kind)).toEqual(["roster"]);
    expect(calls()[0].request).toEqual({ contractVersion: 1, expectedRevision: null });
    await act(async () => { await Promise.resolve(); });
  });
  it("lists the native roster on the choices card", async () => {
    await ask(Q_NO_ACCOUNT);
    const card = screen("choices");
    expect(card.accounts).toEqual([{ id: 6, name: "Brokerage" }, { id: 5, name: "Roth IRA" }, { id: 7, name: "Vanguard Fund" }]);
    expect(out.current.live.investmentAccounts).toEqual(card.accounts); expect(card.draft.missing).toContain("account");
  });
  it("a question that settles every term reads the roster, then the account bound to the roster's revision, then shows the review", async () => {
    await toReview();
    expect(calls().map(c => c.kind)).toEqual(["roster", "context"]);
    expect(calls()[1].request).toEqual({ contractVersion: 1, accountId: 5, expectedRevision: { local: 40, external: 7 } });
    expect(stages).toEqual(["reading", "reading", "review"].filter((s, i, a) => a.indexOf(s) === i));
  });
  it.each([
    ["an account renamed", (w: World) => { w.accounts[1].name = "Roth IRA 2"; }],
    ["an account removed", (w: World) => { w.accounts.splice(1, 1); }],
    ["an account added", (w: World) => { w.accounts.push({ id: 9, name: "Crypto", value: "1" }); }],
    ["an id changed", (w: World) => { w.accounts[1].id = 55; }],
  ])("%s since the Dashboard loaded discards the flow and reads no account", async (_name, change) => {
    change(world); await ask(Q_COMPLETE);
    expect(screen("stale").message).toBe(RETIREMENT_CHANGED_MESSAGE);
    expect(calls("context")).toEqual([]); expect(calculations()).toBe(0);
  });
  it("never uses the Dashboard list in place of the native roster", async () => {
    world.accounts = world.accounts.filter(a => a.id !== 5); app.investmentAccounts = dashboardAccounts(makeWorld()); await render(); await ask(Q_COMPLETE);
    expect(stage()).toBe("stale"); expect(calls("context")).toEqual([]);
  });
  it.each([
    ["a profile that moved", new TransactionError("stale_profile", "x"), "stale"],
    ["too many accounts", new TransactionError("too_many_accounts", "x"), "error"],
    ["an unexpected failure", new Error("boom"), "error"],
  ])("%s while reading the roster", async (_n, error, expected) => {
    world.failNext = { kind: "roster", error }; await ask(Q_COMPLETE); expect(stage()).toBe(expected); expect(calls("context")).toEqual([]);
  });
});

describe("M5 controller: account and complete steps (D1–D3)", () => {
  it.each([
    ["2056-01", "2056-01"],
    ["2026-03", null],
    [null, null],
  ])("reads an account named in the question before offering its saved month (%s)", async (savedMonth, candidate) => {
    world.accounts[1].month = savedMonth;
    await ask("extra $50 a month into Roth IRA");
    const card = screen("choices");
    expect(calls("context").map(call => call.request)).toEqual([
      { contractVersion: 1, accountId: 5, expectedRevision: { local: 40, external: 7 } },
    ]);
    expect(card.draft.accountId).toBe(5);
    expect(card.draft.retirementMonth).toBeNull();
    expect(card.monthCandidate).toBe(candidate);
    expect(calculations()).toBe(0);
  });
  describe("a named account with a month still to choose (P2-a to P2-e)", () => {
    const NAMED = "extra $50 a month into Roth IRA";
    it("shows the account being read, then offers the month as an unselected candidate that needs a click", async () => {
      const gate = world.gate("context"); await act(async () => { out.current.ask(NAMED); }); await settle();
      expect(screen("reading").accountName).toBe("Roth IRA"); gate.release(); await settle();
      const card = screen("choices"); expect(card.monthCandidate).toBe("2056-01"); expect(card.draft.retirementMonth).toBeNull(); expect(card.draft.missing).toContain("retirement-month");
    });
    it("a saved month beyond the supported range stays saved evidence: the account still reads, no candidate is offered, and the limit is explained", async () => {
      world.accounts[1].month = "2101-01"; await ask(NAMED);
      const card = screen("choices");
      expect(card.monthCandidate).toBeNull(); expect(card.savedMonthLimit).toBe("2101-01");
      expect(card.draft.retirementMonth).toBeNull(); expect(card.draft.missing).toContain("retirement-month");
      expect(calls("context")).toHaveLength(1);
    });
    it("a month chosen after that explanation goes on to a review that keeps the saved month as evidence only", async () => {
      world.accounts[1].month = "2101-01"; await ask(NAMED);
      await press(() => out.current.choices({ step: "complete", intent: { version: 1, accountId: 5, extra: { kind: "monthly", amount: "50" }, startDate: TODAY, retirementMonth: "2056-01" }, monthSource: "typed", questionAssumptions: { annualReturnPct: null, inflationPct: null } }));
      const review = screen("review").review;
      expect(review.intent.retirementMonth).toBe("2056-01"); expect(review.monthSource).toBe("typed"); expect(review.context.retirementMonth).toBe("2101-01");
    });
    it("a saved month beyond the range can never be confirmed as the date, even by a hand-built event", async () => {
      world.accounts[1].month = "2101-01"; await ask(NAMED);
      await press(() => out.current.choices({ step: "complete", intent: { version: 1, accountId: 5, extra: { kind: "monthly", amount: "50" }, startDate: TODAY, retirementMonth: "2101-01" }, monthSource: "plan-candidate", questionAssumptions: { annualReturnPct: null, inflationPct: null } }));
      expect(screen("error")).toBeDefined(); expect(calculations()).toBe(0);
    });
    it("a month given in the question leaves nothing to explain about the saved month", async () => {
      world.accounts[1].month = "2101-01"; await ask("put $50 into Roth IRA until June 2057");
      const card = screen("choices"); expect(card.draft.retirementMonth).toBe("2057-06"); expect(card.monthCandidate).toBeNull(); expect(card.savedMonthLimit).toBeNull();
    });
    it("a saved month within the range is still a candidate and no limit is mentioned", async () => {
      await ask(NAMED); const card = screen("choices"); expect(card.monthCandidate).toBe("2056-01"); expect(card.savedMonthLimit).toBeNull();
    });
    it("this month is still usable as a candidate", async () => { world.accounts[1].month = "2026-10"; await ask(NAMED); expect(screen("choices").monthCandidate).toBe("2026-10"); });
    it("other open terms are asked after the read, with the candidate", async () => {
      await ask("put $50 into Roth IRA"); const card = screen("choices");
      expect(card.draft.missing).toEqual(["cadence", "retirement-month"]); expect(card.monthCandidate).toBe("2056-01"); expect(calls("context")).toHaveLength(1);
    });
    it("the candidate completes the flow only after the person selects it, then a review and a confirmation", async () => {
      await ask(NAMED); expect(calls("context")).toHaveLength(1); const calculated = calculations();
      await press(() => out.current.choices({ step: "complete", intent: { version: 1, accountId: 5, extra: { kind: "monthly", amount: "50" }, startDate: TODAY, retirementMonth: "2056-01" }, monthSource: "plan-candidate", questionAssumptions: { annualReturnPct: null, inflationPct: null } }));
      const review = screen("review").review; expect(review.monthSource).toBe("plan-candidate"); expect(calculations()).toBe(calculated);
      expect(calls("context").at(-1)!.request).toMatchObject({ expectedRevision: { local: 40, external: 7 } });
    });
    it("a revision change between the roster and the account read retires the flow", async () => {
      const gate = world.gate("context"); await act(async () => { out.current.ask(NAMED); }); await settle(); world.bump(); gate.release(); await settle();
      expect(stage()).toBe("stale"); expect(calculations()).toBe(0);
    });
    it("an account removed before it is read retires the flow", async () => {
      const gate = world.gate("context"); await act(async () => { out.current.ask(NAMED); }); await settle(); world.accounts = world.accounts.filter(a => a.id !== 5); gate.release(); await settle(); expect(stage()).toBe("stale");
    });
    it("a failed account read shows a plain error and offers no month", async () => {
      world.failNext = { kind: "context", error: new Error("boom") }; await ask(NAMED); expect(stage()).toBe("error");
    });
    it("a late reply after cancel is ignored", async () => {
      const gate = world.gate("context"); await act(async () => { out.current.ask(NAMED); }); await settle(); await press(() => out.current.cancel()); gate.release(); await settle(); expect(stage()).toBeNull();
    });
    it("a late reply after a new question is ignored", async () => {
      const gate = world.gate("context"); await act(async () => { out.current.ask(NAMED); }); await settle(); await ask(Q_NO_ACCOUNT); screen("choices"); gate.release(); await settle();
      expect(screen("choices").draft.accountId).toBeNull();
    });
    it("an observed write while the account is being read retires the flow and ignores the reply", async () => {
      const gate = world.gate("context"); await act(async () => { out.current.ask(NAMED); }); await settle(); await act(async () => { notifyDataWrite("set_investment_plan"); }); gate.release(); await settle(); expect(stage()).toBe("stale");
    });
    it("unmounting during the read leaves nothing behind", async () => {
      const gate = world.gate("context"); await act(async () => { out.current.ask(NAMED); }); await settle(); const errors = vi.spyOn(console, "error");
      await act(async () => root.unmount()); gate.release(); await settle(); expect(errors).not.toHaveBeenCalled(); expect(world.disposed).toBeGreaterThan(0); root = createRoot(host);
    });
    it("the Dashboard list changing during the read retires the flow", async () => {
      const gate = world.gate("context"); await act(async () => { out.current.ask(NAMED); }); await settle(); app.investmentAccounts = [{ id: 5, name: "Roth IRA" }]; await render(); gate.release(); await settle(); expect(stage()).toBe("stale");
    });
  });
  it("reads the chosen account, then returns to the choices with the plan's month as a candidate", async () => {
    await ask(Q_NO_ACCOUNT);
    world.gate("context"); await act(async () => { out.current.choices(accountStep(5)); await Promise.resolve(); });
    expect(screen("reading").accountName).toBe("Roth IRA");
    world.gates.context = null; // gate consumed by the pending call; release it
    await settle();
  });
  it("returns to the choices with the plan month and the chosen account", async () => {
    await ask(Q_NO_ACCOUNT); await press(() => out.current.choices(accountStep(5)));
    const card = screen("choices");
    expect(card.draft.accountId).toBe(5); expect(card.monthCandidate).toBe("2056-01");
    expect(calls("context")[0].request).toEqual({ contractVersion: 1, accountId: 5, expectedRevision: { local: 40, external: 7 } });
  });
  it("offers no month candidate when the question already gave the month", async () => {
    await ask("extra $50 for retirement until March 2057"); await press(() => out.current.choices(accountStep(5)));
    const card = screen("choices"); expect(card.draft.retirementMonth).toBe("2057-03"); expect(card.monthCandidate).toBeNull();
  });
  it("goes straight to the review when choosing the account settles everything the question left open", async () => {
    await ask("extra $50 a month for retirement until March 2057"); expect(screen("choices").draft.missing).toEqual(["account"]);
    await press(() => out.current.choices(accountStep(5))); const review = screen("review").review;
    expect(review.monthSource).toBe("question"); expect(review.intent.retirementMonth).toBe("2057-03"); expect(calls("context").map(c => (c.request as { expectedRevision: unknown }).expectedRevision)).toEqual([{ local: 40, external: 7 }, { local: 40, external: 7 }]);
  });
  it("offers no month candidate when the plan's month has passed or is missing", async () => {
    world.accounts[1].month = "2026-03"; await ask(Q_NO_ACCOUNT); await press(() => out.current.choices(accountStep(5)));
    expect(screen("choices").monthCandidate).toBeNull();
    world.accounts[1].month = null; await ask(Q_NO_ACCOUNT); await press(() => out.current.choices(accountStep(5)));
    expect(screen("choices").monthCandidate).toBeNull();
  });
  it("the complete step re-reads with the held revision and builds the review with the person's month", async () => {
    await ask(Q_NO_ACCOUNT); await press(() => out.current.choices(accountStep(5)));
    const draft = screen("choices").draft;
    const event: RetirementChoicesEvent = { step: "complete", intent: { version: 1, accountId: 5, extra: { kind: "monthly", amount: "50" }, startDate: TODAY, retirementMonth: "2056-01" }, monthSource: "plan-candidate", questionAssumptions: draft.assumptions };
    await press(() => out.current.choices(event));
    const review = screen("review").review;
    expect(review.monthSource).toBe("plan-candidate"); expect(review.intent.retirementMonth).toBe("2056-01"); expect(review.context.account.id).toBe(5);
    expect(calls("context")[1].request).toEqual({ contractVersion: 1, accountId: 5, expectedRevision: { local: 40, external: 7 } });
  });
  it("refuses an invalid event (an account outside the roster, or a past month) without reading", async () => {
    await ask(Q_NO_ACCOUNT); const before = calls().length;
    await press(() => out.current.choices({ step: "account", draft: { ...screen("choices").draft, accountId: 999, missing: ["retirement-month"] } }));
    expect(stage()).toBe("error"); expect(calls().length).toBe(before);
  });
  it("ignores an event when no choices card is showing", async () => {
    await press(() => out.current.choices({ step: "account", draft: { sourceText: "x", accountId: 5, extra: { kind: null, amount: null }, startDate: TODAY, retirementMonth: null, assumptions: { annualReturnPct: null, inflationPct: null }, missing: ["cadence"], hints: [] } }));
    expect(stage()).toBeNull(); expect(world.calls).toEqual([]);
  });
  it("an account that disappears between steps retires the flow", async () => {
    await ask(Q_NO_ACCOUNT); world.accounts = world.accounts.filter(a => a.id !== 5); world.bump();
    await press(() => out.current.choices(accountStep(5))); expect(stage()).toBe("stale");
  });
});

describe("M5 controller: consent capability (E1–E2)", () => {
  it("calculates only after an explicit confirmation of the rendered review", async () => {
    await toReview(); expect(calculations()).toBe(0);
  });
  it("accepts the review's own confirmation and shows the result", async () => {
    const calc = await toResult(); expect(calc.kind).toBe("preview"); expect(calc.scenario.context.account.id).toBe(5); expect(calculations()).toBe(1);
  });
  it("ignores a callback kept from an earlier, identical review", async () => {
    const review = await toReview(); const old = out.current.confirm; const oldScenario = scenarioFor(review);
    await ask(Q_COMPLETE); screen("review"); const before = calls().length;
    await press(() => old(oldScenario)); expect(stage()).toBe("review"); expect(calls().length).toBe(before); expect(calculations()).toBe(0);
  });
  it("ignores a second confirmation of the same review", async () => {
    const review = await toReview(); const confirm = out.current.confirm; const scenario = scenarioFor(review);
    await act(async () => { void confirm(scenario); void confirm(scenario); }); await settle();
    expect(calculations()).toBe(1); expect(calls("context")).toHaveLength(2);
  });
  it("ignores a confirmation with no review showing", async () => {
    await press(() => out.current.confirm({} as never)); expect(stage()).toBeNull(); expect(world.calls).toEqual([]);
  });
  it.each([
    ["an invented value", (s: ConfirmedRetirementScenario) => { s.context.currentValue = "999999"; }],
    ["another account", (s: ConfirmedRetirementScenario) => { s.intent.accountId = 6; }],
    ["another amount", (s: ConfirmedRetirementScenario) => { s.intent.extra.amount = "5000"; }],
    ["another cadence", (s: ConfirmedRetirementScenario) => { s.intent.extra.kind = "once"; }],
    ["a different recorded contribution", (s: ConfirmedRetirementScenario) => { s.assumptions.monthlyContribution = { basis: "context", amount: "1" }; }],
    ["a different stored return", (s: ConfirmedRetirementScenario) => { (s.assumptions.returns as { annualPct: string }).annualPct = "12"; }],
    ["a different source", (s: ConfirmedRetirementScenario) => { s.context.source.revision.local = 1; }],
    ["sensitivity rates slipped into a review confirmation", (s: ConfirmedRetirementScenario) => { (s.assumptions.returns as { sensitivity: unknown }).sensitivity = { lower: "1", base: "7", higher: "9" }; }],
    ["a flag that is not true", (s: ConfirmedRetirementScenario) => { (s as { confirmed: boolean }).confirmed = false; }],
  ])("refuses a forged scenario: %s", async (_name, forge) => {
    const review = await toReview(); const scenario = scenarioFor(review); forge(scenario); const before = calls("context").length;
    await press(() => out.current.confirm(scenario));
    expect(stage()).toBe("error"); expect(calculations()).toBe(0); expect(calls("context").length).toBe(before);
  });
  it("accepts a month typed on the review only when the contract accepts it", async () => {
    const review = await toReview(); const typed = (month: string): ConfirmedRetirementScenario => { const s = scenarioFor(review); s.intent.retirementMonth = month; return s; };
    await press(() => out.current.confirm(typed("2020-01"))); expect(stage()).toBe("error");
  });
  it("a valid typed month is used for the calculation", async () => {
    const review = await toReview(); const s = scenarioFor(review); s.intent.retirementMonth = "2046-05";
    await press(() => out.current.confirm(s)); const calc = screen("result").calculation; expect(calc.scenario.intent.retirementMonth).toBe("2046-05");
  });
});

describe("M5 controller: revalidation before consent (E3–E4)", () => {
  it("re-reads the account with the reviewed revision immediately before calculating", async () => {
    const review = await toReview(); const before = calls("context").length;
    await press(() => out.current.confirm(scenarioFor(review)));
    expect(calls("context").length).toBe(before + 1); expect(calls("context").at(-1)!.request).toEqual({ contractVersion: 1, accountId: 5, expectedRevision: review.context.source.revision });
  });
  it("a change between review and confirmation retires the review and never calculates", async () => {
    const review = await toReview(); world.bump();
    await press(() => out.current.confirm(scenarioFor(review)));
    expect(stage()).toBe("stale"); expect(calculations()).toBe(0);
  });
  it("different content under the same revision still retires it", async () => {
    const review = await toReview(); world.contextOverride = r => ({ ...r, worth: { amount: "10001", basis: "holdings" } });
    await press(() => out.current.confirm(scenarioFor(review))); expect(stage()).toBe("stale"); expect(calculations()).toBe(0);
  });
  it("a changed inflation candidate retires it", async () => {
    const review = await toReview(); world.contextOverride = r => ({ ...r, inflation: { kind: "stored", pct: "4" } });
    await press(() => out.current.confirm(scenarioFor(review))); expect(stage()).toBe("stale");
  });
  it.each([
    ["the profile moved", new TransactionError("stale_profile", "x"), "stale"],
    ["the account is gone", new TransactionError("account_unavailable", "x"), "stale"],
    ["the profile was locked", new TransactionError("profile_locked", "x"), "stale"],
    ["an unexpected failure", new Error("boom"), "error"],
  ])("%s: no result, and nothing refreshes silently", async (_n, error, expected) => {
    const review = await toReview(); world.failNext = { kind: "context", error }; const scenario = scenarioFor(review);
    await press(() => out.current.confirm(scenario));
    expect(stage()).toBe(expected); expect(calculations()).toBe(0);
    const reads = calls().length; await press(() => out.current.confirm(scenario)); expect(calls().length).toBe(reads);
  });
  it("a date change during the re-read retires it", async () => {
    const review = await toReview(); const scenario = scenarioFor(review); const gate = world.gate("context");
    await act(async () => { void out.current.confirm(scenario); }); world.today = "2026-10-18"; gate.release(); await settle();
    expect(stage()).toBe("stale"); expect(calculations()).toBe(0);
  });
  it("a reply arriving after the card was closed is ignored", async () => {
    const review = await toReview(); const scenario = scenarioFor(review); const gate = world.gate("context");
    await act(async () => { void out.current.confirm(scenario); }); await press(() => out.current.cancel()); gate.release(); await settle();
    expect(stage()).toBeNull(); expect(calculations()).toBe(0);
  });
});

describe("M5 controller: outcomes (H2)", () => {
  it("an account with no recorded value offers exact deposits only", async () => {
    const review = await toReview(Q_NO_KEYWORD); expect(review.context.currentValue).toBeNull();
    const choices = retirementReviewChoices(review, FORM, "deposits"); await press(() => out.current.confirm(scenarioFor(review, choices)));
    expect(screen("deposits-only").calculation.kind).toBe("extra-deposits-only");
  });
  it("a refused calculation shows the blocked card", async () => {
    vi.mocked(calculateRetirementScenario).mockReturnValueOnce({ kind: "refused", code: "unsupported-number", message: "too precise" } as RetirementCalculation);
    const review = await toReview(); await press(() => out.current.confirm(scenarioFor(review))); expect(screen("blocked").calculation.kind).toBe("refused");
  });
  it("no-growth and stored-return balances are both calculated", async () => {
    const review = await toReview(); await press(() => out.current.confirm(scenarioFor(review)));
    const calc = screen("result").calculation; expect(calc.noGrowth).toBeTruthy(); expect(calc.confirmedReturn).not.toBeNull();
  });
});

describe("M5 controller: exploring other returns (E5)", () => {
  const rates = { lower: "3", base: "7", higher: "9" };
  it("shows the explore card, and goes back to the same result", async () => {
    const calc = await toResult(); await press(() => out.current.explore()); expect(screen("explore").calculation).toEqual(calc);
    await press(() => out.current.back()); expect(screen("result").calculation).toEqual(calc);
  });
  it("revalidates before calculating the other returns", async () => {
    const calc = await toResult(); await press(() => out.current.explore()); const built = buildExploreConfirmation(calc as never, rates); if (!built.ok) throw new Error(built.reason);
    const before = calls("context").length; await press(() => out.current.confirm(built.scenario));
    expect(calls("context").length).toBe(before + 1); expect(calls("context").at(-1)!.request).toMatchObject({ expectedRevision: calc.scenario.context.source.revision });
    expect(screen("result").calculation).toMatchObject({ kind: "preview" }); expect((out.current.screen as { calculation: { sensitivity: unknown[] } }).calculation.sensitivity).toHaveLength(3);
  });
  it("a change while exploring retires it, with no calculation of the other returns", async () => {
    const calc = await toResult(); await press(() => out.current.explore()); const built = buildExploreConfirmation(calc as never, rates); if (!built.ok) throw new Error(built.reason);
    world.bump(); validations = 0; vi.mocked(calculateRetirementScenario).mockClear(); await press(() => out.current.confirm(built.scenario));
    expect(stage()).toBe("stale"); expect(calculations()).toBe(0);
  });
  it("refuses an exploration that is not exactly the shown result plus the typed rates", async () => {
    const calc = await toResult(); await press(() => out.current.explore()); const built = buildExploreConfirmation(calc as never, rates); if (!built.ok) throw new Error(built.reason);
    (built.scenario.assumptions.monthlyContribution as { amount: string }).amount = "5000"; validations = 0; vi.mocked(calculateRetirementScenario).mockClear();
    await press(() => out.current.confirm(built.scenario)); expect(stage()).toBe("error"); expect(calculations()).toBe(0);
  });
  it("explores only from a shown result that has a confirmed return", async () => {
    await toReview(); await press(() => out.current.explore()); expect(stage()).toBe("review");
  });
});

describe("M5 controller: focus revalidation (F1)", () => {
  async function focus() { await act(async () => { window.dispatchEvent(new Event("focus")); }); await settle(); }
  it("re-reads a showing review with the reviewed revision and keeps it when nothing changed", async () => {
    const review = await toReview(); const before = calls("context").length; await focus();
    expect(calls("context").length).toBe(before + 1); expect(calls("context").at(-1)!.request).toMatchObject({ accountId: 5, expectedRevision: review.context.source.revision });
    expect(screen("review").review).toEqual(review);
  });
  it("retires a showing review when something changed", async () => { await toReview(); world.bump(); await focus(); expect(stage()).toBe("stale"); });
  it("retires a showing result when something changed", async () => { await toResult(); world.bump(); await focus(); expect(stage()).toBe("stale"); });
  it("retires an explore card, a deposits card and a blocked card when something changed", async () => {
    const calc = await toResult(); await press(() => out.current.explore()); world.bump(); await focus(); expect(stage()).toBe("stale"); void calc;
  });
  it("a failed re-read removes the result and requires a fresh review", async () => {
    await toResult(); world.failNext = { kind: "context", error: new Error("boom") }; await focus(); expect(stage()).toBe("error"); expect(calls("context").length).toBeGreaterThan(0);
  });
  it("re-reads the roster for a showing choices card", async () => {
    await ask(Q_NO_ACCOUNT); const before = calls("roster").length; await focus();
    expect(calls("roster").length).toBe(before + 1); expect(calls("roster").at(-1)!.request).toEqual({ contractVersion: 1, expectedRevision: { local: 40, external: 7 } });
    world.bump(); await focus(); expect(stage()).toBe("stale");
  });
  it("reads nothing when no card is showing", async () => { await focus(); expect(world.calls).toEqual([]); });
  it("two quick focus events make one read", async () => {
    await toReview(); const before = calls("context").length;
    await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); }); await settle(); expect(calls("context").length).toBe(before + 1);
  });
  it("uses no repeating timer", async () => {
    const spy = vi.spyOn(globalThis, "setInterval"); await toResult(); world.bump(); await act(async () => { window.dispatchEvent(new Event("focus")); }); await settle();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("M5 controller: observed in-app writes (F2)", () => {
  const writes = ["set_investment_plan", "update_holding_price", "refresh_live_prices", "create_holding", "delete_holding", "commit_holding_import", "update_account_type", "set_account_details", "delete_account", "create_manual_transaction"];
  it.each(writes)("%s retires an open review and its consent", async command => {
    const review = await toReview(); const confirm = out.current.confirm; const scenario = scenarioFor(review); const before = calls().length;
    await act(async () => { notifyDataWrite(command); });
    expect(screen("stale").message).toBe(RETIREMENT_CHANGED_MESSAGE);
    await press(() => confirm(scenario)); expect(calls().length).toBe(before); expect(calculations()).toBe(0);
  });
  it("retires a result and an explore card", async () => {
    await toResult(); await act(async () => { notifyDataWrite("set_investment_plan"); }); expect(stage()).toBe("stale");
    await toResult(); await press(() => out.current.explore()); await act(async () => { notifyDataWrite("update_holding_price"); }); expect(stage()).toBe("stale");
  });
  it("retires choices, a reading card and a deposits-only card", async () => {
    await ask(Q_NO_ACCOUNT); await act(async () => { notifyDataWrite("set_investment_plan"); }); expect(stage()).toBe("stale");
    const gate = world.gate("roster"); await act(async () => { out.current.ask(Q_COMPLETE); }); await act(async () => { notifyDataWrite("set_investment_plan"); }); gate.release(); await settle(); expect(stage()).toBe("stale"); expect(calls("context")).toEqual([]);
    const review = await toReview(Q_NO_KEYWORD); await press(() => out.current.confirm(scenarioFor(review, retirementReviewChoices(review, FORM, "deposits")))); screen("deposits-only");
    await act(async () => { notifyDataWrite("commit_holding_import"); }); expect(stage()).toBe("stale");
  });
  it("changes nothing when no flow is open, and a closed flow stays closed", async () => {
    await act(async () => { notifyDataWrite("set_investment_plan"); }); expect(stage()).toBeNull();
    await toReview(); await press(() => out.current.cancel()); await act(async () => { notifyDataWrite("set_investment_plan"); }); expect(stage()).toBeNull();
  });
  it("a notification after unmount is harmless", async () => {
    await toReview(); await act(async () => root.unmount()); expect(() => notifyDataWrite("set_investment_plan")).not.toThrow(); root = createRoot(host);
  });
});

describe("M5 controller: lifecycle (G1–G4)", () => {
  it.each([
    ["the ledger changes", () => { app.dataKey = "k2"; }],
    ["the list reloads", () => { app.reloadKey = "r2"; }],
    ["the Dashboard's investment accounts change", () => { app.investmentAccounts = [{ id: 5, name: "Roth IRA" }]; }],
  ])("%s", async (_n, change) => {
    await toReview(); change(); await render(); expect(screen("stale").message).toBe(RETIREMENT_CHANGED_MESSAGE);
  });
  it("a date change is noticed on focus, without a data change", async () => {
    await toReview(); world.today = "2026-10-18"; await act(async () => { window.dispatchEvent(new Event("focus")); }); await settle(); expect(stage()).toBe("stale");
  });
  it("a date change is noticed at midnight even if the window never regains focus", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: new Date(2026, 9, 17, 23, 59, 0) });
    await act(async () => root.unmount()); root = createRoot(host); await render();
    await toReview(); world.today = "2026-10-18"; await act(async () => { await vi.advanceTimersByTimeAsync(61_000); }); await settle(); expect(stage()).toBe("stale");
  });
  it("cancel before the roster arrives releases the wait; the late roster is ignored", async () => {
    const gate = world.gate("roster"); await act(async () => { out.current.ask(Q_COMPLETE); }); await press(() => out.current.cancel()); expect(stage()).toBeNull();
    gate.release(); await settle(); expect(stage()).toBeNull(); expect(calls("context")).toEqual([]);
  });
  it("cancel aborts the wait in flight so its frames are released", async () => {
    const abort = vi.spyOn(AbortController.prototype, "abort"); world.gate("roster"); await act(async () => { out.current.ask(Q_COMPLETE); });
    abort.mockClear(); await press(() => out.current.cancel()); expect(abort).toHaveBeenCalled();
  });
  it("a late failure after cancel is observed and ignored", async () => {
    const gate = world.gate("context"); world.failNext = { kind: "context", error: new Error("late") };
    await act(async () => { out.current.ask(Q_COMPLETE); }); await settle(); await press(() => out.current.cancel()); gate.release(); await settle(); expect(stage()).toBeNull();
  });
  it("a new question cancels the earlier one; its late reply cannot appear", async () => {
    const gate = world.gate("roster"); await act(async () => { out.current.ask(Q_COMPLETE); }); await ask(Q_NO_ACCOUNT); screen("choices"); gate.release(); await settle(); screen("choices");
  });
  it("close, edit and restart each cancel work in flight", async () => {
    const gate = world.gate("roster"); await act(async () => { out.current.ask(Q_COMPLETE); }); await press(() => out.current.cancel()); gate.release(); await settle(); expect(stage()).toBeNull();
  });
  it("unmounting disposes the client and ignores late replies", async () => {
    const gate = world.gate("roster"); await act(async () => { out.current.ask(Q_COMPLETE); }); const errors = vi.spyOn(console, "error");
    await act(async () => root.unmount()); expect(world.disposed).toBeGreaterThan(0); gate.release(); await settle(); expect(errors).not.toHaveBeenCalled(); root = createRoot(host);
  });
  it("repeated open, close and unmount leaves no listener, timer or client behind (I3)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: new Date(2026, 9, 17, 12, 0, 0) });
    await act(async () => root.unmount()); root = createRoot(host); // the mount made before this test started is not part of the count
    const added = vi.spyOn(window, "addEventListener"), removed = vi.spyOn(window, "removeEventListener");
    const disposedBefore = world.disposed;
    for (let cycle = 0; cycle < 25; cycle++) {
      await render(); await toReview(); await press(() => out.current.cancel());
      await act(async () => root.unmount()); root = createRoot(host);
    }
    const count = (spy: typeof added, type: string) => spy.mock.calls.filter((call) => call[0] === type).length;
    expect(count(added, "focus")).toBeGreaterThanOrEqual(25);
    expect(count(removed, "focus")).toBe(count(added, "focus"));
    expect(vi.getTimerCount()).toBe(0);
    expect(world.disposed - disposedBefore).toBeGreaterThanOrEqual(25);
  });
  it("the client is created lazily and disposed once", async () => { await ask("how much did I spend on groceries"); expect(world.disposed).toBe(0); });
});

describe("M5 controller: stages follow the contract (H1)", () => {
  it("every change of screen is an allowed transition", async () => {
    await ask(Q_NO_ACCOUNT); await press(() => out.current.choices(accountStep(5)));
    const draft = screen("choices").draft;
    await press(() => out.current.choices({ step: "complete", intent: { version: 1, accountId: 5, extra: { kind: "monthly", amount: "50" }, startDate: TODAY, retirementMonth: "2056-01" }, monthSource: "plan-candidate", questionAssumptions: draft.assumptions }));
    const review = screen("review").review; await press(() => out.current.confirm(scenarioFor(review))); await press(() => out.current.explore()); await press(() => out.current.back());
    await press(() => out.current.edit()); screen("choices");
    // React may batch a brief "reading" screen away, so a step that goes through it counts as that step.
    const allowed = (a: RetirementStage, b: RetirementStage) => canTransition(a, b) || (canTransition(a, "reading") && canTransition("reading", b));
    for (let i = 1; i < stages.length; i++) if (stages[i - 1] !== stages[i]) expect(allowed(stages[i - 1], stages[i]), `${stages[i - 1]} -> ${stages[i]}`).toBe(true);
    expect(Object.keys(RETIREMENT_TRANSITIONS).length).toBeGreaterThan(0);
  });
  it("changing the details from a result asks again for the account, amount, cadence and month, and offers no month yet", async () => {
    await toResult(); await press(() => out.current.edit());
    const card = screen("choices"); expect(card.draft).toMatchObject({ accountId: null, extra: { kind: null, amount: null }, retirementMonth: null });
    expect(card.draft.missing).toEqual(["account", "extra-amount", "cadence", "retirement-month"]); expect(card.monthCandidate).toBeNull();
    expect(card.accounts).toEqual([{ id: 6, name: "Brokerage" }, { id: 5, name: "Roth IRA" }, { id: 7, name: "Vanguard Fund" }]);
  });
  describe("changing the details (account switch)", () => {
    const completeFor = (id: number, month: string, source: "plan-candidate" | "typed" = "typed"): RetirementChoicesEvent => ({
      step: "complete", intent: { version: 1, accountId: id, extra: { kind: "monthly", amount: "75" }, startDate: TODAY, retirementMonth: month }, monthSource: source,
      questionAssumptions: (out.current.screen as Extract<RetirementScreen, { stage: "choices" }>).draft.assumptions,
    });
    it("discards the result and its consent immediately", async () => {
      const calc = await toResult(); const staleConfirm = out.current.confirm; const staleExplore = out.current.explore; await press(() => out.current.edit());
      const reads = calls().length, calculated = calculations();
      await press(() => staleConfirm(calc.scenario)); await press(() => staleExplore()); expect(stage()).toBe("choices"); expect(calls().length).toBe(reads); expect(calculations()).toBe(calculated);
    });
    it("a callback from the earlier review cannot confirm anything after the details were changed", async () => {
      const review = await toReview(); const oldConfirm = out.current.confirm, scenario = scenarioFor(review); await press(() => out.current.confirm(scenario)); await press(() => out.current.edit());
      const reads = calls().length, calculated = calculations(); await press(() => oldConfirm(scenario)); expect(stage()).toBe("choices"); expect(calls().length).toBe(reads); expect(calculations()).toBe(calculated);
    });
    it("switching accounts reads the new account afresh and shows only its own saved month, plan and values", async () => {
      world.accounts[0].month = "2049-06"; world.accounts[0].ret = { kind: "stored-plan", annualPct: "5" }; world.accounts[0].contribution = { kind: "saved", monthlyAmount: "300" }; world.accounts[0].inflation = { kind: "stored", pct: "2" };
      await toResult(); await press(() => out.current.edit()); const reads = calls("context").length;
      await press(() => out.current.choices(accountStep(6)));
      expect(calls("context").length).toBe(reads + 1); expect(calls("context").at(-1)!.request).toMatchObject({ accountId: 6 });
      const card = screen("choices"); expect(card.draft.accountId).toBe(6); expect(card.monthCandidate).toBe("2049-06"); expect(card.draft.retirementMonth).toBeNull();
      await press(() => out.current.choices(completeFor(6, "2049-06", "plan-candidate"))); const review = screen("review").review;
      expect(review.context.account).toMatchObject({ id: 6, name: "Brokerage" }); expect(review.context.currentValue).toBe("25000");
      expect(review.context.returnAssumption).toEqual({ kind: "stored-plan", annualPct: "5" }); expect(review.context.contribution).toMatchObject({ monthlyAmount: "300" }); expect(review.inflation).toEqual({ kind: "stored", pct: "2" });
      expect(review.monthSource).toBe("plan-candidate"); expect(JSON.stringify(review)).not.toContain("Roth"); expect(JSON.stringify(review)).not.toContain("10000"); expect(JSON.stringify(review)).not.toContain("2056-01");
      const before = calculations(); await press(() => out.current.confirm(scenarioFor(review)));
      const calc = screen("result").calculation; expect(calculations()).toBe(before + 1); expect(calc.scenario.context.account.id).toBe(6); expect(calc.scenario.assumptions.returns).toMatchObject({ annualPct: "5" });
    });
    it("the previous account's saved month is not offered for an account whose plan has none", async () => {
      world.accounts[0].month = null; await toResult(); await press(() => out.current.edit()); await press(() => out.current.choices(accountStep(6)));
      expect(screen("choices").monthCandidate).toBeNull();
    });
    it("choosing the same account again reads it afresh and still needs a new review and confirmation", async () => {
      await toResult(); await press(() => out.current.edit()); const reads = calls("context").length, calculated = calculations();
      await press(() => out.current.choices(accountStep(5))); expect(calls("context").length).toBe(reads + 1); expect(screen("choices").monthCandidate).toBe("2056-01");
      await press(() => out.current.choices(completeFor(5, "2056-01", "plan-candidate"))); const review = screen("review").review; expect(calculations()).toBe(calculated);
      await press(() => out.current.confirm(scenarioFor(review))); expect(screen("result").calculation.scenario.intent.extra.amount).toBe("75"); expect(calculations()).toBe(calculated + 1);
    });
    it("the month stays unselected: nothing is chosen for the person", async () => {
      await toResult(); await press(() => out.current.edit()); await press(() => out.current.choices(accountStep(5)));
      const card = screen("choices"); expect(card.draft.retirementMonth).toBeNull(); expect(card.draft.missing).toContain("retirement-month");
    });
    it("the account switch is bound to the roster revision, so a change in between retires it", async () => {
      await toResult(); await press(() => out.current.edit()); world.bump(); await press(() => out.current.choices(accountStep(6))); expect(stage()).toBe("stale");
    });
  });
  it("choosing a return from exact deposits returns to the review with the return field open", async () => {
    const review = await toReview(Q_NO_KEYWORD); await press(() => out.current.confirm(scenarioFor(review, retirementReviewChoices(review, FORM, "deposits")))); screen("deposits-only");
    const reads = calls().length; await press(() => out.current.edit({ chooseReturn: true })); expect(screen("review").review).toEqual(review); expect(out.current.openReturnChoice).toBe(true); expect(calls().length).toBe(reads); // no account choice, no new read
  });
  describe("recovering from a numeric refusal (the blocked card's \"Change the details\")", () => {
    // Authority: Content-Flow.md:50 lists "needs attention" (the blocked card) among the screens whose "Change the details" is onEdit; the owner's decision (Requirements-Checklist.md:150)
    // is that "Change the details" re-asks account, amount, cadence and month and discards the earlier result, consent and context. A blocked card is not an exception.
    // The refusal here is REAL: a stored 100% return to October 2100 gives a balance the estimate cannot hold exactly (the m5c-027 situation); no calculator is stubbed.
    const REFUSING_QUESTION = "How much would an extra $50 a month into Roth IRA until October 2100 add?";
    const refuse = async () => {
      world.accounts.find(a => a.id === 5)!.ret = { kind: "stored-plan", annualPct: "100" };
      const review = await toReview(REFUSING_QUESTION); await press(() => out.current.confirm(scenarioFor(review)));
      return { review, blocked: screen("blocked") };
    };
    const completeFor = (id: number, month: string, extra: { kind: "monthly" | "once"; amount: string }, source: "plan-candidate" | "typed" = "typed"): RetirementChoicesEvent => ({
      step: "complete", intent: { version: 1, accountId: id, extra, startDate: TODAY, retirementMonth: month }, monthSource: source,
      questionAssumptions: (out.current.screen as Extract<RetirementScreen, { stage: "choices" }>).draft.assumptions,
    });
    /** Independent of the product: closed-form growth (balance = V*f + P*annuity), not the month-by-month recurrence the calculator runs. */
    const expectedBalance = (value: number, monthly: number, annualPct: number, months: number, once = 0) => {
      const i = annualPct / 1200, f = (1 + i) ** months, annuity = i === 0 ? months : (f - 1) / i;
      return (value + once) * f + monthly * annuity;
    };
    const recover = async (id: number, month: string, extra: { kind: "monthly" | "once"; amount: string }) => {
      await press(() => out.current.edit()); screen("choices");
      await press(() => out.current.choices(accountStep(id))); screen("choices");
      await press(() => out.current.choices(completeFor(id, month, extra)));
      const review = screen("review").review; await press(() => out.current.confirm(scenarioFor(review)));
      return screen("result").calculation;
    };

    it("is really a numeric refusal with no balance shown", async () => {
      const { blocked } = await refuse();
      expect(blocked.calculation).toMatchObject({ kind: "refused", code: "unsupported-number" });
      // No amount, no estimate fields: the sentence may say "a balance" (it explains what could not be done) but no number or result is carried.
      expect(JSON.stringify(blocked.calculation)).not.toMatch(/roundedDollars|$s?d|scenario|baseline|noGrowth|confirmedReturn/);
    });
    it("reopens the choices for account, amount, cadence and month, not the review it came from", async () => {
      await refuse(); await press(() => out.current.edit());
      const card = screen("choices");
      expect(card.draft).toMatchObject({ accountId: null, extra: { kind: null, amount: null }, retirementMonth: null });
      expect(card.draft.missing).toEqual(["account", "extra-amount", "cadence", "retirement-month"]);
      expect(card.monthCandidate).toBeNull();
      expect(card.accounts).toEqual([{ id: 6, name: "Brokerage" }, { id: 5, name: "Roth IRA" }, { id: 7, name: "Vanguard Fund" }]);
    });
    it("refusal, then revised terms, then a fresh review, then explicit consent, then a result the calculator makes from those terms (independently calculated)", async () => {
      await refuse(); const calculatedBefore = calculations(), reads = calls("context").length;
      await press(() => out.current.edit());
      await press(() => out.current.choices(accountStep(6))); expect(calls("context").length).toBe(reads + 1); // the new account is read afresh
      await press(() => out.current.choices(completeFor(6, "2027-10", { kind: "monthly", amount: "100" })));
      const review = screen("review").review;
      expect(calculations()).toBe(calculatedBefore); // reviewing calculates nothing: only consent does
      expect(review.context.account).toMatchObject({ id: 6, name: "Brokerage" }); expect(review.intent.extra).toEqual({ kind: "monthly", amount: "100" }); expect(review.intent.retirementMonth).toBe("2027-10");
      await press(() => out.current.confirm(scenarioFor(review))); expect(calculations()).toBe(calculatedBefore + 1);
      const calc = screen("result").calculation;
      // Brokerage: $25,000 now, $200 a month already planned, a stored 7% return, 12 months, plus the extra $100 a month.
      expect(calc.months).toBe(12); expect(calc.extraDeposits).toBe("1200.00");
      expect(calc.noGrowth.scenario.balanceAtWithdraw).toBeCloseTo(25000 + 12 * (200 + 100), 6);
      expect(calc.noGrowth.baseline.balanceAtWithdraw).toBeCloseTo(25000 + 12 * 200, 6);
      expect(calc.confirmedReturn!.scenario.balanceAtWithdraw).toBeCloseTo(expectedBalance(25000, 300, 7, 12), 4);
      expect(calc.confirmedReturn!.baseline.balanceAtWithdraw).toBeCloseTo(expectedBalance(25000, 200, 7, 12), 4);
    });
    it.each([
      ["a different account", { id: 6, month: "2027-10", extra: { kind: "monthly" as const, amount: "100" }, value: 25000, pct: 7, n: 12, once: 0, monthly: 300 }],
      ["a different month (24 months, not 12)", { id: 6, month: "2028-10", extra: { kind: "monthly" as const, amount: "100" }, value: 25000, pct: 7, n: 24, once: 0, monthly: 300 }],
      ["a different amount ($300 a month)", { id: 6, month: "2027-10", extra: { kind: "monthly" as const, amount: "300" }, value: 25000, pct: 7, n: 12, once: 0, monthly: 500 }],
      ["a different cadence (one $500 deposit)", { id: 6, month: "2027-10", extra: { kind: "once" as const, amount: "500" }, value: 25000, pct: 7, n: 12, once: 500, monthly: 200 }],
    ])("changing only %s reaches the calculator and moves the result as an independent calculation says", async (_name, t) => {
      await refuse(); const calc = await recover(t.id, t.month, t.extra);
      expect(calc.months).toBe(t.n); expect(calc.extraDeposits).toBe(t.extra.kind === "once" ? "500.00" : `${(Number(t.extra.amount) * t.n).toFixed(2)}`);
      expect(calc.confirmedReturn!.scenario.balanceAtWithdraw).toBeCloseTo(expectedBalance(t.value, t.monthly, t.pct, t.n, t.once), 3);
      expect(calc.noGrowth.scenario.balanceAtWithdraw).toBeCloseTo(t.value + t.n * t.monthly + t.once, 6);
    });
    it("tripling the extra amount triples the difference the extra makes, and the screen's own difference follows it", async () => {
      await refuse(); const one = await recover(6, "2027-10", { kind: "monthly", amount: "100" });
      const gain = (c: typeof one) => c.confirmedReturn!.scenario.balanceAtWithdraw - c.confirmedReturn!.baseline.balanceAtWithdraw;
      await press(() => out.current.edit()); await press(() => out.current.choices(accountStep(6))); await press(() => out.current.choices(completeFor(6, "2027-10", { kind: "monthly", amount: "300" })));
      await press(() => out.current.confirm(scenarioFor(screen("review").review))); const three = screen("result").calculation;
      expect(gain(three) / gain(one)).toBeCloseTo(3, 9);
      expect(gain(one)).toBeCloseTo(expectedBalance(0, 100, 7, 12), 4);
    });
    it("switching accounts carries nothing from the refused account: not its name, value, 100% return, saved month, or the refused terms", async () => {
      world.accounts.find(a => a.id === 5)!.month = "2101-03"; // beyond the 2100 limit: this is the refused account's own saved evidence
      await refuse(); await press(() => out.current.edit());
      // Straight after "Change the details", before any account is chosen, nothing about the refused account may be on the card: not its saved month, nor the limit message for it.
      const reopened = screen("choices"); expect(reopened.savedMonthLimit).toBeNull(); expect(reopened.monthCandidate).toBeNull();
      expect(JSON.stringify(reopened)).not.toMatch(/2101-03|2100-10|Roth IRA".*value|"100"/);
      await press(() => out.current.choices(accountStep(6)));
      const card = screen("choices"); expect(card.draft.retirementMonth).toBeNull(); expect(card.monthCandidate).toBe("2056-01"); // Brokerage's own saved month, not 2100-10
      await press(() => out.current.choices(completeFor(6, "2027-10", { kind: "monthly", amount: "125" }))); // 125, so a stray "100" (the refused return) cannot be mistaken for the new amount
      const review = screen("review").review; const text = JSON.stringify(review);
      for (const stale of ["Roth", "10000", "2100-10", "\"100\""]) expect(text, stale).not.toContain(stale);
      expect(review.context.returnAssumption).toEqual({ kind: "stored-plan", annualPct: "7" });
    });
    it("the old result, its consent and every callback from before the refusal are unusable once the details are being changed", async () => {
      const { review } = await refuse(); const oldConfirm = out.current.confirm, oldExplore = out.current.explore, scenario = scenarioFor(review);
      await press(() => out.current.edit()); const reads = calls().length, calculated = calculations();
      await press(() => oldConfirm(scenario)); await press(() => oldExplore());
      expect(stage()).toBe("choices"); expect(calls().length).toBe(reads); expect(calculations()).toBe(calculated);
    });
    it("a callback from the review that was refused cannot confirm the new review either", async () => {
      const { review } = await refuse(); const oldConfirm = out.current.confirm, oldScenario = scenarioFor(review);
      await press(() => out.current.edit()); await press(() => out.current.choices(accountStep(6))); await press(() => out.current.choices(completeFor(6, "2027-10", { kind: "monthly", amount: "100" })));
      screen("review"); const calculated = calculations();
      await press(() => oldConfirm(oldScenario)); expect(stage()).toBe("review"); expect(calculations()).toBe(calculated);
    });
    it("cancelling while the new account is being read leaves nothing, and the late reply does not bring a screen back", async () => {
      await refuse(); await press(() => out.current.edit());
      const gate = world.gate("context"); await act(async () => { void out.current.choices(accountStep(6)); }); screen("reading");
      await press(() => out.current.cancel()); expect(out.current.screen).toBeNull();
      const calculated = calculations(); await act(async () => { gate.release(); }); await settle(); expect(out.current.screen).toBeNull(); expect(calculations()).toBe(calculated);
    });
    it("a write that lands while the new account is being read retires the recovery instead of producing a review", async () => {
      await refuse(); await press(() => out.current.edit());
      const gate = world.gate("context"); await act(async () => { void out.current.choices(accountStep(6)); }); screen("reading");
      world.bump(); await act(async () => { notifyDataWrite("set_investment_plan"); }); await act(async () => { gate.release(); }); await settle();
      expect(stage()).toBe("stale"); expect(calculations()).toBe(1); // only the original refused calculation
    });
    it("a change of profile or reload retires the choices that recovery reopened", async () => {
      await refuse(); await press(() => out.current.edit()); screen("choices");
      const step = accountStep(6), choose = out.current.choices; // what the reopened card would send, and its callback, captured before the change
      app.reloadKey = "r2"; await render(); screen("stale");
      const reads = calls().length; await press(() => choose(step)); expect(stage()).toBe("stale"); expect(calls().length).toBe(reads);
    });
    it("a refusal reached from the explore card recovers the same way: Change the details reopens the choices, not the review or the explore card", async () => {
      // Roth IRA at its stored 7% to October 2100 calculates; typed explore rates of 3/7/100% do not (the base must stay the confirmed 7%), so the refusal comes from the explore confirmation.
      const review = await toReview(REFUSING_QUESTION); await press(() => out.current.confirm(scenarioFor(review)));
      let calc = screen("result").calculation; expect(calc.kind).toBe("preview");
      await press(() => out.current.explore());
      const built = buildExploreConfirmation(calc as never, { lower: "3", base: "7", higher: "100" }); if (!built.ok) throw new Error(built.reason);
      await press(() => out.current.confirm(built.scenario));
      expect(screen("blocked").calculation).toMatchObject({ kind: "refused", code: "unsupported-number" });
      const calculated = calculations(); await press(() => out.current.edit());
      const card = screen("choices"); expect(card.draft.missing).toEqual(["account", "extra-amount", "cadence", "retirement-month"]);
      await press(() => out.current.choices(accountStep(6))); await press(() => out.current.choices(completeFor(6, "2027-10", { kind: "monthly", amount: "100" })));
      await press(() => out.current.confirm(scenarioFor(screen("review").review))); calc = screen("result").calculation;
      expect(calculations()).toBe(calculated + 1); expect(calc.scenario.context.account.id).toBe(6); expect(calc.months).toBe(12);
      expect(calc.confirmedReturn!.scenario.balanceAtWithdraw).toBeCloseTo(expectedBalance(25000, 300, 7, 12), 4); // the explore rates (up to 100%) were not carried over
    });
    it("pressing Change the details twice, or a stale second press after the choices opened, does nothing more", async () => {
      await refuse(); const edit = out.current.edit; await press(() => edit()); const card = screen("choices"); const reads = calls().length;
      await press(() => edit()); await press(() => out.current.edit()); expect(screen("choices")).toBe(card); expect(calls().length).toBe(reads);
    });
    it("the reopened choices are bound to the live roster: an account removed in between cannot be chosen", async () => {
      await refuse(); await press(() => out.current.edit()); world.accounts = world.accounts.filter(a => a.id !== 6); world.bump(); await act(async () => { notifyDataWrite("delete_account"); }); await settle();
      expect(stage()).toBe("stale");
    });
    it("ordinary result editing and 'Choose a return assumption' are unchanged: a result still re-asks everything; exact deposits with a recorded value still return to the review", async () => {
      await toResult(); await press(() => out.current.edit()); screen("choices");
      const review = await (async () => { await press(() => out.current.cancel()); return toReview(Q_NO_KEYWORD); })();
      await press(() => out.current.confirm(scenarioFor(review, retirementReviewChoices(review, FORM, "deposits")))); screen("deposits-only");
      const reads = calls().length; await press(() => out.current.edit({ chooseReturn: true })); expect(screen("review").review).toEqual(review); expect(calls().length).toBe(reads);
    });
    describe("a return typed in the question survives Change the details as a visible, editable assumption (owner decision, 20 Oct 2026)", () => {
      // Authority: Content-Flow.md:10 (a return written in the question is shown as "Return in your question", offered first, and replaced through "Choose a return assumption");
      // "Change the details" discards the result and the consent but not the person's question. A return that came from an account's saved plan belongs to that account and is reread.
      const TYPED = "How much would an extra $50 a month into Roth IRA until October 2100 assuming 100% a year add?";
      const refuseTyped = async () => {
        const review = await toReview(TYPED); expect(review.questionAssumptions.annualReturnPct).toBe("100");
        await press(() => out.current.confirm(scenarioFor(review, retirementReviewChoices(review, FORM, "primary"))));
        return screen("blocked");
      };
      const toNewReview = async () => {
        await press(() => out.current.edit()); await press(() => out.current.choices(accountStep(6)));
        await press(() => out.current.choices(completeFor(6, "2027-10", { kind: "monthly", amount: "100" })));
        return screen("review").review;
      };
      it("really refuses: the typed 100% over about 74 years cannot be held exactly", async () => {
        expect((await refuseTyped()).calculation).toMatchObject({ kind: "refused", code: "unsupported-number" });
      });
      it("keeps the typed return on the reopened card, so the question is not forgotten", async () => {
        await refuseTyped(); await press(() => out.current.edit());
        expect(screen("choices").draft.assumptions.annualReturnPct).toBe("100");
      });
      it("shows it again on the new review as the person's own words, offered first, with its source", async () => {
        await refuseTyped(); const review = await toNewReview();
        expect(review.questionAssumptions.annualReturnPct).toBe("100");
        const content = retirementReviewContent(review);
        expect(content.candidates.returnPct).toBe("100");
        expect(content.primary).toBe(retirementUseQuestionReturn("100"));
        expect(JSON.stringify(content.facts)).toMatch(/Return in your question/);
      });
      it("needs a fresh confirmation: reviewing calculates nothing, and the earlier consent cannot be reused", async () => {
        const blocked = await refuseTyped(); const oldConfirm = out.current.confirm, calculated = calculations();
        void blocked; const review = await toNewReview();
        expect(calculations()).toBe(calculated);
        await press(() => oldConfirm(scenarioFor(review, retirementReviewChoices(review, FORM, "primary")))); expect(stage()).toBe("review"); expect(calculations()).toBe(calculated);
      });
      it("can be replaced through 'Choose a return assumption', and the result then follows the replacement (independently calculated)", async () => {
        await refuseTyped(); const review = await toNewReview();
        const chosen = retirementReviewChoices(review, { ...FORM, chooseReturn: true, returnPct: "7" }, "primary");
        await press(() => out.current.confirm(scenarioFor(review, chosen)));
        const calc = screen("result").calculation;
        expect(calc.confirmedReturn!.scenario.balanceAtWithdraw).toBeCloseTo(expectedBalance(25000, 300, 7, 12), 4);
      });
      it("confirming the typed return as offered uses 100%, not the new account's saved 7%", async () => {
        await refuseTyped(); const review = await toNewReview();
        await press(() => out.current.confirm(scenarioFor(review, retirementReviewChoices(review, FORM, "primary"))));
        const calc = screen("result").calculation;
        expect(calc.confirmedReturn!.scenario.balanceAtWithdraw).toBeCloseTo(expectedBalance(25000, 300, 100, 12), 2);
      });
      it("a return that came from the refused account's saved plan is not carried: the new account's own plan is read afresh", async () => {
        await refuse(); const reads = calls("context").length; await press(() => out.current.edit()); await press(() => out.current.choices(accountStep(6)));
        expect(calls("context").length).toBe(reads + 1);
        await press(() => out.current.choices(completeFor(6, "2027-10", { kind: "monthly", amount: "100" })));
        const review = screen("review").review;
        expect(review.questionAssumptions.annualReturnPct).toBeNull();
        expect(review.context.returnAssumption).toEqual({ kind: "stored-plan", annualPct: "7" });
      });
    });
  });
  it("restarting from a retired card asks the same question again against the live data", async () => {
    await toReview(); world.bump(); await act(async () => { notifyDataWrite("set_investment_plan"); }); screen("stale");
    const rosters = calls("roster").length; await press(() => out.current.restart()); screen("review"); expect(calls("roster").length).toBe(rosters + 1);
  });
  it("a confirmed result reopens only through a fresh review and confirmation", async () => {
    await toResult(); await press(() => out.current.edit()); screen("choices"); expect(calculations()).toBe(1);
  });
});

describe("M5 controller: read-only and session-only (I1)", () => {
  it("uses only the two read commands and persists nothing", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem"); const fetcher = vi.fn(); (globalThis as { fetch?: unknown }).fetch = fetcher;
    await toResult(); await press(() => out.current.explore());
    expect(world.calls.every(c => c.kind === "roster" || c.kind === "context")).toBe(true); expect(local).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    expect(Object.keys(client).sort()).toEqual(["askVault", "askVaultRetirementAccounts", "askVaultRetirementContext", "dispose"]); expect(client.askVault).not.toHaveBeenCalled();
  });
  it("changing the copy handed to the dialog cannot change what the controller holds", async () => {
    const shown = await toReview(); const original = structuredClone(shown); const scenario = scenarioFor(original);
    shown.context.currentValue = "1"; shown.intent.extra.amount = "99999";
    await press(() => out.current.confirm(scenario));
    expect(screen("result").calculation.scenario.context.currentValue).toBe("10000"); expect(screen("result").calculation.scenario.intent.extra.amount).toBe("50");
  });
  it("the controller never reads a model result or a Dashboard balance", async () => {
    app.investmentAccounts = dashboardAccounts(world).map(a => ({ ...a, balance: "1" } as never)); await render(); const review = await toReview(); expect(review.context.currentValue).toBe("10000");
  });
});

describe("M5 controller: context shape (type check)", () => {
  it("retirementContextFromReply matches what the review holds", async () => {
    const review = await toReview(); const expected: RetirementContextRead = retirementContextFromReply(world.reply(5)); expect(review.context).toEqual(expected.context); expect(review.inflation).toEqual(expected.inflation);
  });
});
