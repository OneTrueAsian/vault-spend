import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { canonical } from "./counting";
import type { CorpusCase } from "./manifest";
import { preparedCaseGroups, preparedRoutingCases } from "./preparedPackages";

/**
 * VP-19 scoring-freeze contents (Validation-Plan.md). Test-only. A freeze fixes WHICH bytes are scored: every file below, the population labels,
 * the family registry and the seed/context membership. Any later edit to them changes a hash and fails freeze.test.ts, so a gold, label or
 * expectation cannot change after grading starts without a new, signed freeze version.
 */
const ORIGINAL_FREEZE_FILES = [
  "cases.json", "contexts.json", "expectedRequests.json", "referenceResults.json", "provenance.json",
  "manifest.ts", "counting.ts", "grader.ts", "referenceCalendar.ts", "referenceContract.ts", "referenceOracle.ts", "referenceWorld.ts",
  // Added by freeze version 2 (gap remediation). Version 1 (scoringFreeze.v1.json) is preserved byte for byte and lists only the first twelve.
  "nativeEvidence.ts", "registry.ts", "requiredFamilies.json", "nativeEvidenceManifest.json", "nativeProofs/native-proof-ordinary.json",
] as const;
/** Files version 1 froze. Their v1 hashes are history; every one except the grader and its manifest types must still match today. */
export const FREEZE_V1_FILES = ORIGINAL_FREEZE_FILES.slice(0, 12);
const DIR = __dirname;
/** Version 3 freezes all test-support inputs, including native proof bytes and scenario/typo harnesses.
 * Signed freeze records are excluded to avoid self-reference and remain immutable history. */
const inventory = (relative = ""): string[] => readdirSync(`${DIR}/${relative}`, { withFileTypes: true }).flatMap(entry => {
  const name = relative + entry.name;
  if (entry.isDirectory()) return inventory(name + "/");
  return /\.(?:json|ts|tsx)$/.test(name) && !/^scoringFreeze(?:\.v\d+)?\.json$/.test(name) ? [name] : [];
});
export const FREEZE_FILES = [...inventory(), ...[
  "m3Scenario.test.tsx", "m4Scenario.test.tsx", "m5Scenario.test.tsx", "m5Model.test.ts", "insufficientHistoryCorpus.test.tsx", "m5RouteElsewhere.test.tsx", "m6PreparedPackages.test.ts",
  "combinedCorpusGrader.test.ts", "combinedCorpusGraderGaps.test.ts", "combinedCorpusGraderMutation.test.ts", "combinedRouteHarness.test.tsx", "routeDisplayCheck.test.tsx", "exampleEvidence.test.tsx", "typoDispositions.test.tsx", "scenarioNativeProof.test.ts",
  "combinedAcceptance.test.tsx", "combinedAcceptanceIntegrity.test.ts", "clarificationExchanges.test.tsx", "scoringFreeze.test.ts",
  // Added by freeze version 12 (owner decisions D-R2, D-R3 and the N-1 fixture, 21 October 2026).
  "familyResolution.test.ts", "familyResolutionRoute.test.tsx", "amendmentReferences.test.ts", "legacyHandoffRoute.test.tsx", "storeTypoLaterWord.test.tsx",
  // Added by freeze version 13 (Task 7, owner direction D-8, 22 October 2026): the reviewed realistic-error list is counted instead of raw tags.
  "realisticErrors.test.ts",
].map(name => `../../askVault/${name}`)].sort();
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export const fileHash = (name: string) => sha(readFileSync(`${DIR}/${name}`));

/** Gate per population, from Validation-Plan.md VP-04. A family's own gate is the P-CORE 90% rule (CG-03). */
const GATE: Record<string, string> = { "P-CORE": ">=90% direct per family, >=95% overall", "P-LT": ">=80% direct, >=90% within one clarification", "P-NC": "100% required clarification", "P-UNSAFE": "100% safe refusal" };

export function computeFreeze() {
  const groups = preparedCaseGroups();
  const cases: CorpusCase[] = Object.values(groups).flat();
  const labels = Object.fromEntries([...cases].sort((a, b) => (a.id < b.id ? -1 : 1)).map(c => [c.id, c.population]));
  const families = new Map<string, { id: string; populations: Record<string, number>; cases: number }>();
  for (const c of cases) {
    const f = families.get(c.family) ?? { id: c.family, populations: {}, cases: 0 };
    f.cases += 1; f.populations[c.population] = (f.populations[c.population] ?? 0) + 1; families.set(c.family, f);
  }
  const registry = [...families.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map(f => ({ ...f, gates: Object.keys(f.populations).sort().map(p => `${p}: ${GATE[p] ?? "reported only"}`) }));
  const membership = [...cases].sort((a, b) => (a.id < b.id ? -1 : 1)).map(c => [c.id, c.required.map(r => [r.seed, r.contextId, r.requestId, r.referenceId, r.stop ?? null, r.requiresConsent ?? false, r.choices ?? null])]);
  const required = JSON.parse(readFileSync(`${DIR}/requiredFamilies.json`, "utf8")) as { families: unknown[] };
  return {
    files: Object.fromEntries(FREEZE_FILES.map(name => [name, fileHash(name)])),
    packageMembership: Object.fromEntries(Object.entries(groups).map(([name, rows]) => [name, { cases: rows.length, sha256: sha(canonical(rows)) }])),
    routingObligations: { cases: preparedRoutingCases().length, sha256: sha(canonical(preparedRoutingCases())) },
    populationLabels: { cases: cases.length, sha256: sha(canonical(labels)) },
    /** Families that have cases today (the v1 registry, unchanged). Not the required inventory. */
    familyRegistry: { families: registry.length, sha256: sha(canonical(registry)) },
    /** Version 2: the authority-backed required inventory the grader is bound to, including zero-case families. */
    requiredFamilyRegistry: { families: required.families.length, sha256: sha(canonical(required.families)) },
    seedContextMembership: { cases: membership.length, requirements: membership.reduce((n, [, r]) => n + (r as unknown[]).length, 0), sha256: sha(canonical(membership)) },
  };
}
