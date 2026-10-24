import { readFileSync } from "node:fs";
import { gradeCombinedCorpus } from "./grader";
import { REQUIRED_FAMILY_IDS } from "./registry";
import { m5StopCases } from "./scenarioPreparation";
import type { CorpusCase, GradingInput } from "./manifest";
import { validateManifest } from "./counting";

/** D-R2/D-R3: the frozen amendment data, merged into the ordinary package's own inputs (never another package's). Read fresh on every call; nothing is cached or mutated. */
function withAmendments(input: GradingInput): GradingInput {
  const registry = read("amendments.json"), extra = read("amendmentReferences.json"), ev = registry.nativeEvidence;
  const proofBytes = readFileSync(`${__dirname}/nativeProofs/${ev.proofFile}`, "utf8");
  const ev0 = input.evidence as Extract<GradingInput["evidence"], { kind: "corpus" }>;
  return { ...input,
    requests: { ...input.requests, ...extra.requests },
    references: { ...input.references, ...Object.fromEntries(Object.entries(extra.references as Record<string, object>).map(([id, ref]) => [id, { ...ref, nativeReceipt: ev.receipts[id] }])) } as GradingInput["references"],
    amendments: { familyResolution: registry.familyResolution, alternates: registry.alternates.map((a: { caseId: string; perSeed: unknown[] }) => ({ caseId: a.caseId, perSeed: a.perSeed })) },
    resolutionObservations: [],
    evidence: { ...ev0, proofs: { ...ev0.proofs, [ev.proofFile]: proofBytes }, manifest: { proofs: { ...ev0.manifest.proofs, [ev.proofFile]: { sha256: ev.proofSha256 } }, identities: { ...ev0.manifest.identities, ...ev.identities } } } };
}
export type AcceptancePackage = { id: "ordinary" | "m3" | "m4" | "m5" | "history"; input: GradingInput };
const read = (name: string) => JSON.parse(readFileSync(`${__dirname}/${name}`, "utf8"));
export function loadAcceptancePackages(): AcceptancePackage[] {
  const load = (id: AcceptancePackage["id"], prefix: string): AcceptancePackage => {
    const ordinary = id === "ordinary", proof = ordinary ? "native-proof-ordinary.json" : "native-proof-scenario-prerequisites.json";
    return { id, input: { cases: read(ordinary ? "cases.json" : `${prefix}Cases.json`), requests: read(ordinary ? "expectedRequests.json" : `${prefix}Requests.json`),
      references: ordinary ? read("referenceResults.json") : read(`${prefix}References.json`).references, observations: [], requiredFamilies: [...REQUIRED_FAMILY_IDS],
      evidence: { kind: "corpus", proofs: { [proof]: readFileSync(`${__dirname}/nativeProofs/${proof}`, "utf8") }, manifest: read(ordinary ? "nativeEvidenceManifest.json" : `${prefix}EvidenceManifest.json`), contexts: read(ordinary ? "contexts.json" : `${prefix}Contexts.json`) } } };
  };
  const m5 = load("m5","scenarioM5"); m5.input.cases.push(...m5StopCases());
  const ordinary = load("ordinary","");
  ordinary.input = withAmendments(ordinary.input);
  // Task 7 (D-8): the individually reviewed realistic-error membership, frozen with the other grading inputs.
  ordinary.input.reviewedRealisticErrors = read("realisticErrors.json").entries;
  const packages: AcceptancePackage[] = [ordinary,load("m3","scenarioM3"),load("m4","scenarioM4"),m5,
    { id: "history", input: { cases: read("historyCases.json"), observations: [], requests: {}, references: {}, requiredFamilies: [...REQUIRED_FAMILY_IDS],
      evidence: { kind: "corpus", proofs: {}, manifest: { proofs: {}, identities: {} }, contexts: { worlds: {}, contexts: {} } } } }];
  // Fail before any expensive UI observations if a frozen manifest is structurally incomplete.
  for (const p of packages) validateManifest(p.input.cases);
  return packages;
}

/** Required package membership cannot be reduced by a caller selecting a favourable subset. */
export function gradeAcceptancePackages(packages: AcceptancePackage[]) {
  const original = loadAcceptancePackages();
  if (packages.length !== original.length || new Set(packages.map(p=>p.id)).size !== original.length) throw Error("Missing or duplicate acceptance package");
  for (const p of original) {
    const supplied = packages.find(x=>x.id===p.id);
    if (!supplied) throw Error(`Missing package ${p.id}`);
    const membership = (xs: CorpusCase[]) => JSON.stringify(xs);
    if (membership(p.input.cases)!==membership(supplied.input.cases)) throw Error(`Frozen package membership changed: ${p.id}`);
  }
  return gradeCombinedCorpus(packages);
}
