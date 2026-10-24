// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { writeFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { useRetirementScenario } from "./useRetirementScenario";
import { calculateRetirementScenario } from "./retirementScenarioMath";
import { CORPUS_CONTEXTS, RETIREMENT_CORPUS, RETIREMENT_GATES, RETIREMENT_EXECUTION_POLICY_VERSION, retirementCorpusDenominators, retirementExecutionExpectation, retirementScoringPlan } from "./retirementCorpus";
import type { CorpusCase, CorpusFamily } from "./retirementCorpus";
import { buildRetirementConfirmation, retirementReviewChoices, retirementUnsupportedMessage, validateRetirementScreen } from "./retirementScreenContract";
import type { RetirementScreen } from "./retirementScreenContract";
import { validateRetirementContextReply, validateRetirementRosterReply } from "./retirementNativeContract";
import type { RetirementContextReply, RetirementContextWireRequest, RetirementRosterReply, RetirementRosterWireRequest } from "./retirementNativeContract";
import type { ParseContext } from "./types";

/**
 * V1: integrated grading of the frozen corpus (m5-corpus-v1) through the real parser, controller and screen contract, with a fictional native world
 * standing in for the two read commands. Populations are counted separately, as the corpus freezes them: completed results (through the review and an explicit
 * confirmation), necessary choices, semantic clarifications with their re-parsed replacements, refusals, route-elsewhere and unsafe outcomes.
 * This is integrated-in-jsdom evidence. The compiled-app completion observation on three ledger seeds is a separate run (completion-2026-10-19).
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("./retirementScenarioMath", async importOriginal => { const real = await importOriginal<typeof import("./retirementScenarioMath")>(); return { ...real, calculateRetirementScenario: vi.fn(real.calculateRetirementScenario) }; });

const TODAY = "2026-09-06";
type Hook = ReturnType<typeof useRetirementScenario>;
let root: Root, host: HTMLElement, out: { current: Hook }, reads: string[], accounts: { id: number; name: string }[], dashboard: { id: number; name: string }[], invalid: string[];
const REVISION = { local: 40, external: 7 };
const order = (a: { id: number; name: string }, b: { id: number; name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id);
const client = {
  askVault: vi.fn(), dispose: vi.fn(),
  askVaultRetirementAccounts: vi.fn(async (request: RetirementRosterWireRequest) => {
    reads.push("roster");
    const raw: RetirementRosterReply = { contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { ...REVISION }, asOf: TODAY, accounts: [...accounts].sort(order) };
    return validateRetirementRosterReply(raw, request, TODAY);
  }),
  askVaultRetirementContext: vi.fn(async (request: RetirementContextWireRequest) => {
    reads.push("context");
    const account = accounts.find(a => a.id === request.accountId)!;
    const raw: RetirementContextReply = {
      contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { ...REVISION }, asOf: TODAY, account: { id: account.id, name: account.name, type: "investment" },
      worth: { amount: "10000", basis: "holdings" }, contribution: { kind: "saved", monthlyAmount: "200" }, returnAssumption: { kind: "stored-plan", annualPct: "7" },
      inflation: { kind: "stored", pct: "3" }, retirementMonth: "2056-01",
    };
    return validateRetirementContextReply(raw, request, TODAY);
  }),
};
function Harness() {
  const hook = useRetirementScenario({ getContext: () => ({ today: TODAY, categories: [], accounts: [], investmentAccounts: dashboard } as ParseContext), dataKey: "k", reloadKey: "r", createClient: () => client as never });
  out.current = hook;
  if (hook.screen) { const verdict = validateRetirementScreen(hook.screen, hook.live); if (!verdict.ok) invalid.push(verdict.reason); }
  return null;
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function ask(text: string) { let claimed = false; await act(async () => { claimed = out.current.ask(text); }); await settle(); return claimed; }
const stage = () => out.current.screen?.stage ?? null;
const FORM = { amount: "", chooseReturn: false, returnPct: "", todays: false, inflation: null };
const calculations = () => vi.mocked(calculateRetirementScenario).mock.calls.length;

type Observation = { id: string; family: CorpusFamily; expected: CorpusCase["expected"]["kind"]; observed: string; ok: boolean; unsafe: boolean; detail?: string };
const stripSource = (draft: Record<string, unknown>) => { const { sourceText: _ignored, ...rest } = draft; void _ignored; return rest; };

async function grade(c: CorpusCase): Promise<Observation[]> {
  const context = CORPUS_CONTEXTS[c.context]; accounts = context.investmentAccounts.map(a => ({ ...a })); dashboard = context.investmentAccounts.map(a => ({ ...a })); reads = [];
  vi.mocked(calculateRetirementScenario).mockClear();
  await act(async () => { out.current.cancel(); });
  const base = { id: c.id, family: c.family, expected: c.expected.kind };
  const claimed = await ask(c.text);
  switch (c.expected.kind) {
    case "route-elsewhere": {
      const ok = !claimed && reads.length === 0 && calculations() === 0;
      return [{ ...base, observed: claimed ? "claimed" : "left to other routes", ok, unsafe: claimed && (stage() === "result" || calculations() > 0) }];
    }
    case "retirement-unsupported": {
      const screen = out.current.screen as (RetirementScreen & { stage: "unsupported" }) | null;
      const ok = claimed && screen?.stage === "unsupported" && screen.reason === retirementUnsupportedMessage(c.expected.reasonCode) && reads.length === 0 && calculations() === 0;
      return [{ ...base, observed: screen ? screen.stage : "nothing", ok, unsafe: calculations() > 0 || stage() === "result" || stage() === "review", detail: screen && "reason" in screen ? screen.reason : undefined }];
    }
    case "retirement-clarify": {
      const clarification = out.current.clarification, expected = c.expected;
      const shown = !!clarification && stage() === null && reads.length === 0 && calculations() === 0
        && JSON.stringify(clarification.choices) === JSON.stringify(expected.choices.map(x => x.label)) && JSON.stringify(clarification.replacements) === JSON.stringify(expected.choices.map(x => x.replacementQuestion));
      const results: Observation[] = [{ ...base, observed: clarification ? "clarification" : stage() ?? "nothing", ok: claimed && shown, unsafe: calculations() > 0 || stage() === "result" }];
      for (const choice of expected.choices) {
        await act(async () => { out.current.cancel(); }); reads = [];
        const again = await ask(choice.replacementQuestion), screen = out.current.screen;
        const draft = screen && (screen.stage === "choices" ? screen.draft : screen.stage === "review" ? null : null);
        const reviewOk = screen?.stage === "review" && JSON.stringify(stripSource(choice.next.draft as unknown as Record<string, unknown>).missing) === "[]";
        const choicesOk = !!draft && JSON.stringify(stripSource(draft as unknown as Record<string, unknown>)) === JSON.stringify(stripSource(choice.next.draft as unknown as Record<string, unknown>));
        results.push({ ...base, id: `${c.id}/${choice.label}`, observed: `re-parse -> ${screen?.stage ?? "nothing"}`, ok: again && (choicesOk || reviewOk) && calculations() === 0, unsafe: calculations() > 0 });
      }
      return results;
    }
    case "retirement": {
      const draft = c.expected.draft, screen = out.current.screen;
      if (draft.missing.length) {
        const shown = screen?.stage === "choices" ? stripSource(screen.draft as unknown as Record<string, unknown>) : null;
        const ok = claimed && screen?.stage === "choices" && JSON.stringify(shown) === JSON.stringify(stripSource(draft as unknown as Record<string, unknown>)) && calculations() === 0;
        return [{ ...base, observed: screen ? screen.stage : "nothing", ok, unsafe: calculations() > 0 || screen?.stage === "result" }];
      }
      // Fully specified: the review (consent) must appear first, nothing is calculated before it, and an explicit confirmation completes it.
      if (!claimed || screen?.stage !== "review") return [{ ...base, observed: screen ? screen.stage : "nothing", ok: false, unsafe: calculations() > 0 }];
      const beforeConsent = calculations(), review = screen.review;
      const interpretationOk = review.intent.accountId === draft.accountId && review.intent.extra.kind === draft.extra.kind && review.intent.extra.amount === draft.extra.amount && review.intent.retirementMonth === draft.retirementMonth
        && JSON.stringify(review.questionAssumptions) === JSON.stringify(draft.assumptions);
      const built = buildRetirementConfirmation(review, retirementReviewChoices(review, FORM, "primary"));
      if (!built.ok) return [{ ...base, observed: "review", ok: false, unsafe: false, detail: built.reason }];
      await act(async () => { await out.current.confirm(built.scenario); }); await settle();
      if (retirementExecutionExpectation(c) === "numeric-boundary-refusal") {
        const blocked = out.current.screen;
        const refused = blocked?.stage === "blocked" && blocked.calculation.kind === "refused" && blocked.calculation.code === "unsupported-number";
        return [{ ...base, observed: refused ? "numeric refusal after consent" : stage() ?? "nothing", ok: interpretationOk && beforeConsent === 0 && refused && calculations() >= 1, unsafe: beforeConsent > 0 || stage() === "result" }];
      }
      const done = stage() === "result";
      return [{ ...base, observed: done ? "result after consent" : stage() ?? "nothing", ok: interpretationOk && beforeConsent === 0 && done && calculations() >= 1, unsafe: beforeConsent > 0 }];
    }
  }
}

beforeEach(async () => { invalid = []; out = { current: null as never }; host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => { root.render(<Harness />); }); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("M5 V1 integrated corpus grading (jsdom, fictional native world)", () => {
  it("grades every frozen case through the real parser, controller and screen contract, with populations counted separately", async () => {
    const observations: Observation[] = [];
    for (const c of RETIREMENT_CORPUS) observations.push(...await grade(c));
    expect(invalid, "every screen shown validates against the live roster").toEqual([]);
    const d = retirementCorpusDenominators(), plan = retirementScoringPlan();
    const byKind = (kind: Observation["expected"]) => observations.filter(o => o.expected === kind);
    const failed = observations.filter(o => !o.ok);
    const completions = RETIREMENT_CORPUS.filter(c => c.expected.kind === "retirement" && !c.expected.draft.missing.length && !c.original?.knownGap && retirementExecutionExpectation(c) === "completed-estimate");
    const completed = completions.filter(c => observations.find(o => o.id === c.id)!.ok);
    const report = {
      corpus: "m5-corpus-v1", executionPolicy: RETIREMENT_EXECUTION_POLICY_VERSION, scope: "integrated in jsdom: real parser + controller + screen contract; fictional native world; not the compiled app",
      denominators: d,
      populations: {
        completedResults: { denominator: completions.length, passed: completed.length, requiredPassing: plan.populations.completion.requiredPassing },
        numericBoundaryRefusals: { denominator: d.numericBoundaryRefusals, passed: observations.filter(o => o.observed === "numeric refusal after consent" && o.ok).length },
        draftsNeedingChoices: { denominator: d.draftsNeedingChoices, passed: observations.filter(o => o.expected === "retirement" && RETIREMENT_CORPUS.find(c => c.id === o.id && c.expected.kind === "retirement" && c.expected.draft.missing.length)).filter(o => o.ok).length },
        semanticClarifications: { denominator: d.necessaryClarifications, passed: byKind("retirement-clarify").filter(o => !o.id.includes("/") && o.ok).length, reparsedReplacements: { denominator: d.reparseDrafts, passed: byKind("retirement-clarify").filter(o => o.id.includes("/") && o.ok).length } },
        requiredConsent: { reviewsShownBeforeAnyCalculation: observations.filter(o => ["result after consent", "numeric refusal after consent"].includes(o.observed)).length, calculationsBeforeConsent: observations.filter(o => o.unsafe).length },
        refusals: { denominator: d.refusals, passed: byKind("retirement-unsupported").filter(o => o.ok).length },
        routeElsewhere: { denominator: d.routeElsewhere, passed: byKind("route-elsewhere").filter(o => o.ok).length },
        unsafeOutcomes: observations.filter(o => o.unsafe).map(o => o.id),
      },
      knownGaps: RETIREMENT_CORPUS.filter(c => c.original?.knownGap).map(c => ({ id: c.id, observed: observations.find(o => o.id === c.id)?.observed })),
      failures: failed.map(o => ({ id: o.id, expected: o.expected, observed: o.observed, detail: o.detail })),
    };
    if (process.env.M5_GRADING_REPORT) writeFileSync(process.env.M5_GRADING_REPORT, JSON.stringify({ ...report, observations }, null, 2));
    expect(report.populations.unsafeOutcomes, "no unsafe outcome").toEqual([]);
    expect(report.failures, "every case is graded as the frozen corpus expects").toEqual([]);
    expect(report.populations.completedResults.denominator).toBe(28);
    expect(report.populations.numericBoundaryRefusals).toEqual({ denominator: 1, passed: 1 });
    expect(report.populations.completedResults.passed).toBeGreaterThanOrEqual(report.populations.completedResults.requiredPassing - (d.knownGaps ? 0 : 0));
    expect(RETIREMENT_GATES.section3.minimumLedgerSeeds).toBe(3);
  }, 120_000);
});
