import { RETIREMENT_CORPUS, retirementExecutionExpectation } from "../../askVault/retirementCorpus";
import type { CorpusCase } from "./manifest";
import { m5FixtureId } from "./m5Scenario";

/**
 * Task-4 item 6, scenario-family preparation that can be done without per-seed native fixtures. Test-only; derived from the frozen M5 corpus gold
 * (src/askVault/retirementCorpus.ts, owner-approved), never from parser output. Nothing here is stored in cases.json, so the frozen v1/v2 hashes are
 * unaffected; a later freeze version must add these cases deliberately.
 *
 *  - P-NC: a retirement question whose draft is missing choices, or a clarification with a frozen choice set (Validation-Plan VP-04).
 *  - P-UNSAFE: a retirement question the first scope refuses (income, advice, employer match, unknown account, and so on).
 *  - P-NR: `m5c-027`, the owner-approved numeric-boundary refusal. It must be a safe refusal on EVERY required seed and is never an estimate.
 *  Stop-only cases need only their applicable context (VP-06 "Not required"); m5c-027 needs the three seeds. Its contexts are the native retirement fixtures
 *  `m6-m5-seed-<seed>-account-5` (validated by the focused native test, Q5).
 */
const SEEDS = [101, 202, 303];
export function m5StopCases(): CorpusCase[] {
  const out: CorpusCase[] = [];
  for (const c of RETIREMENT_CORPUS) {
    const family = `m5:${c.family}`;
    const base = { id: `m5/${c.id}`, text: c.text, family, cluster: family, tags: [] as string[] };
    const one = (stop: "refusal" | "clarification", choices?: string[]) => [{ seed: 101, contextId: `m5-parse-${c.context}`, requestId: null, referenceId: null, stop, ...(choices ? { choices } : {}) }];
    switch (c.expected.kind) {
      case "retirement-clarify": out.push({ ...base, population: "P-NC", required: one("clarification", c.expected.choices.map(x => x.label)) }); break;
      case "retirement-unsupported": out.push({ ...base, population: "P-UNSAFE", required: one("refusal") }); break;
      case "retirement":
        // The choices screen asks the retirement month only once the account is known (RetirementScenarioDialog.tsx:127-129), so with no account the first card does not ask it.
        if (c.expected.draft.missing.length) out.push({ ...base, population: "P-NC", required: one("clarification", c.expected.draft.missing.filter(m => m !== "retirement-month" || c.expected.kind === "retirement" && c.expected.draft.accountId !== null)) });
        else if (retirementExecutionExpectation(c) === "numeric-boundary-refusal")
          out.push({ ...base, population: "P-NR", required: SEEDS.map(seed => ({ seed, contextId: m5FixtureId(seed, 5), requestId: null, referenceId: null, stop: "refusal" as const })) });
        break;
      case "route-elsewhere": break;
    }
  }
  return out;
}
/** Fully specified M5 drafts expected to COMPLETE (after review and consent). They need per-seed native context and an independent result, so they are not built here. */
export const m5PendingCompletions = (): string[] => RETIREMENT_CORPUS.filter(c => c.expected.kind === "retirement" && !c.expected.draft.missing.length && retirementExecutionExpectation(c) === "completed-estimate").map(c => `m5/${c.id}`);

/**
 * Scenario evidence links (task-4 item 6): for each prepared scenario reference, which proof is a NATIVE CONTEXT proof (the store's own read), which is a
 * JAVASCRIPT CALCULATION proof (the exact calculator), and what is still missing. `ref` names a Rust test function or a TS test title that must exist.
 */
export type EvidenceLink = { reference: string; nativeContext: { file: string; ref: string } | null; jsCalculation: { file: string; ref: string } | null; missing: string };
export const SCENARIO_EVIDENCE_LINKS: EvidenceLink[] = [
  { reference: "anchor.m3.monthly", nativeContext: { file: "core/src/store/tests/ask_vault_m6.rs", ref: "fn ask_vault_m6_scenario_prerequisites" },
    jsCalculation: { file: "src/askVault/spendingScenarioMath.test.ts", ref: "monthly-two: $50 a month for November and December saves $100 and leaves a $250 monthly limit" },
    missing: "native context is now proved per seed world (99 baseline-shaped reads); the review/consent flow and the exact calculation per seed are JavaScript projections not yet converted into M6 cases" },
  { reference: "anchor.m4.penny", nativeContext: { file: "core/src/store/tests/ask_vault_m6.rs", ref: "fn ask_vault_m6_scenario_prerequisites" },
    jsCalculation: { file: "src/askVault/spendingScenarioMath.test.ts", ref: "C4 largest-remainder penny tie is independent of input order" },
    missing: "native baseline reads exist per seed world; the savings-target allocation per seed is a JavaScript projection not yet converted into M6 cases" },
  { reference: "anchor.m5.one-month-monthly", nativeContext: { file: "core/src/store/tests/ask_vault_m6.rs", ref: "fn ask_vault_m6_scenario_prerequisites" },
    jsCalculation: { file: "src/askVault/retirementScenarioContractExamples.ts", ref: "one-month-monthly" },
    missing: "native retirement-account contexts exist for seeds 101, 202 and 303 (holdings, holdings, transactions); the projection per seed is a JavaScript calculation not yet converted into M6 cases" },
  { reference: "anchor.m5.zero-month-once", nativeContext: { file: "core/src/store/tests/ask_vault_m6.rs", ref: "fn ask_vault_m6_scenario_prerequisites" },
    jsCalculation: { file: "src/askVault/retirementScenarioContractExamples.ts", ref: "zero-month-once" },
    missing: "same as one-month-monthly" },
];
