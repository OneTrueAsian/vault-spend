import { CORPUS_CONTEXTS, RETIREMENT_CORPUS, retirementExecutionExpectation, type CorpusCase as M5Case } from "../../askVault/retirementCorpus";
import type { CorpusCase } from "./manifest";
import { m5Result } from "./m5Model";

/**
 * Task-4 item 6, M5 conversion (owner instruction of 21 October 2026): the 28 completing cases of the frozen M5 corpus (src/askVault/retirementCorpus.ts, owner-approved gold)
 * become M6 P-CORE cases with
 *  - a FULL intended request, fixed from the gold draft and the consent path the review offers (not from parser output);
 *  - a separate exact expected result per seed, computed by the independent exact model (m5Model.ts, JavaScript) from the seed's native retirement context;
 *  - a native context link per seed: the focused native test validated that context (scenarioNativeFixtures.json, native-proof-scenario-prerequisites.json).
 * The native proof validates the CONTEXT (what the store reads); the model validates the PROJECTION. They are separate links and are never conflated.
 * m5c-027 is not here: it is the P-NR required refusal (scenarioPreparation.ts).
 */
export const M5_TODAY = "2026-09-06";
export const M5_SEEDS = [101, 202, 303];
export const m5FixtureId = (seed: number, accountId: number) => `m6-m5-seed-${seed}-account-${accountId}`;
export type M5Fixture = { id: string; worldSeed: number; today: string; accountId: number; seed: unknown;
  expected: { reply: { account: { id: number; name: string }; worth: { amount: string }; contribution: { kind: string; monthlyAmount?: string }; returnAssumption: { annualPct: string }; inflation: unknown; retirementMonth: string | null } } };

const completing = (): M5Case[] => RETIREMENT_CORPUS.filter(c => c.expected.kind === "retirement" && !c.expected.draft.missing.length && retirementExecutionExpectation(c) === "completed-estimate");
const draftOf = (c: M5Case) => { if (c.expected.kind !== "retirement") throw new Error("not a draft"); return c.expected.draft; };

/** The full intended request of a completing case. `returnChoice` is the consent path the review offers: the return stated in the question, else the saved plan's. */
export function m5IntendedRequest(c: M5Case): Record<string, unknown> {
  const d = draftOf(c), account = CORPUS_CONTEXTS[c.context].investmentAccounts.find(a => a.id === d.accountId)!;
  const stated = d.assumptions.annualReturnPct;
  return { family: "m5-extra-money", accountName: account.name, extra: { kind: d.extra.kind, amount: d.extra.amount }, startDate: "today", retirementMonth: d.retirementMonth,
    returnChoice: stated !== null ? { source: "question", annualPct: stated } : { source: "saved-plan" }, displayUnit: "future-dollars" };
}
export const m5RequestId = (c: M5Case) => `m5q-${c.id}`;
export const m5ReferenceId = (c: M5Case, seed: number) => `m5r-${c.id}-${seed}`;

export function m5Cases(): CorpusCase[] {
  return completing().map(c => ({ id: `m5/${c.id}`, text: c.text, population: "P-CORE" as const, family: `m5:${c.family}`, cluster: `m5:${c.family}`, tags: [],
    required: M5_SEEDS.map(seed => ({ seed, contextId: m5FixtureId(seed, draftOf(c).accountId!), requestId: m5RequestId(c), referenceId: m5ReferenceId(c, seed), requiresConsent: true })) }));
}
export function m5Requests(): Record<string, unknown> {
  return Object.fromEntries(completing().map(c => [m5RequestId(c), m5IntendedRequest(c)]));
}
/** The expected result for one case on one seed, from that seed's native context and the independent model. */
export function m5ExpectedResult(c: M5Case, fixture: M5Fixture) {
  const d = draftOf(c), reply = fixture.expected.reply;
  return m5Result({ openingDollars: reply.worth.amount, baselineMonthly: reply.contribution.kind === "saved" ? reply.contribution.monthlyAmount! : "0",
    extra: { kind: d.extra.kind!, amount: d.extra.amount! }, today: M5_TODAY, retirementMonth: d.retirementMonth!, annualPct: d.assumptions.annualReturnPct ?? reply.returnAssumption.annualPct });
}
export function m5References(fixtures: M5Fixture[], receiptFor: (fixtureId: string) => string): Record<string, { value: unknown; seed: number; contextId: string; requestId: string; nativeReceipt: string; calculation: string }> {
  const out: Record<string, { value: unknown; seed: number; contextId: string; requestId: string; nativeReceipt: string; calculation: string }> = {};
  for (const c of completing()) for (const seed of M5_SEEDS) {
    const id = m5FixtureId(seed, draftOf(c).accountId!), fixture = fixtures.find(f => f.id === id);
    if (!fixture) throw new Error(`no native fixture ${id}`);
    out[m5ReferenceId(c, seed)] = { value: m5ExpectedResult(c, fixture), seed, contextId: id, requestId: m5RequestId(c), nativeReceipt: receiptFor(id),
      calculation: "independent exact model (src/testSupport/askVaultM6/m5Model.ts): JavaScript projection, not native" };
  }
  return out;
}
export const m5CompletingIds = () => completing().map(c => c.id);
