import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { computeFreeze, FREEZE_V1_FILES } from "../testSupport/askVaultM6/freeze";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";

// VP-19 (Validation-Plan.md): the scoring contents are frozen BEFORE any grading run. This test fails if any frozen file, population label,
// family registry entry or seed/context requirement changes. A deliberate change needs a new freeze version, a new signature and a disclosure.
// Version 1 (scoringFreeze.v1.json) is preserved byte for byte; version 2 (scoringFreeze.json) supersedes it for the gap remediation.
const DIR = "src/testSupport/askVaultM6";
const FREEZE = `${DIR}/scoringFreeze.v2.json`, FREEZE_V1 = `${DIR}/scoringFreeze.v1.json`;
const V1_SHA256 = "d5d4e81ce93e0fa1ddaddc9c838f6a3d9268c9f465ac8bde64493a5b445ce586";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
if (process.env.M6_WRITE_FREEZE_V2 === "1") {
  // Writes version 2 over the v1 COPY at the live path, only while that path still holds the exact v1 bytes and the preserved copy exists.
  if (sha(readFileSync(FREEZE_V1, "utf8")) !== V1_SHA256 || sha(readFileSync(FREEZE, "utf8")) !== V1_SHA256) throw new Error("Version 2 is already written or v1 is not intact.");
  writeFileSync(FREEZE, JSON.stringify({ ...JSON.parse(readFileSync(process.env.M6_FREEZE_META_FILE ?? "", "utf8")), ...computeFreeze() }, null, 2) + "\n");
}
if (process.env.M6_WRITE_FREEZE_V8 === "1") {
  const old = readFileSync(`${DIR}/scoringFreeze.v7.json`, "utf8");
  if (sha(old) !== "4078fc82ba92a27843edef92850beaac9e1ec678a4e237a7331acfade564227f" || readFileSync(`${DIR}/scoringFreeze.json`,"utf8") !== old) throw Error("Cannot overwrite a successor or changed v7 signature");
  const prior = JSON.parse(old);
  writeFileSync(`${DIR}/scoringFreeze.json`, JSON.stringify({ ...prior, ...computeFreeze(), version:"m6-acceptance-scoring-freeze-8", signedOn:"2026-10-21", signedAt:new Date().toISOString(),
    preparedAndSignedBy:"Codex actual session 01a11bfa-3a3a-7c41-af31-b4b4b9dd7216",supersedes:{version:prior.version,file:"scoringFreeze.v7.json",sha256:sha(old)},
    scope:"Namespace-safe full combined acceptance adapter and corrected clarification exchange observations. Frozen before first combined grading; not a passing score.",
    reason:"Owner-authorized missing adapter and clarification-count correction. Original corpus, contexts, golds, proof bytes, populations, gates, typo labels and all v1-v7 signatures preserved. New integrity regressions are suite-resident.",
    disclosure:"Same-author preparation/signing is disclosed. Earlier package checks are retained; the first combined acceptance run occurs after this signature. No native projection, independent-author or broad passing-acceptance claim is made by this identity." },null,2)+"\n");
}
if (process.env.M6_WRITE_FREEZE_V9 === "1") {
  const old = readFileSync(`${DIR}/scoringFreeze.v8.json`, "utf8");
  if (JSON.parse(old).version !== "m6-acceptance-scoring-freeze-8" || readFileSync(`${DIR}/scoringFreeze.json`, "utf8") !== old) throw Error("Cannot overwrite a successor or changed v8 signature");
  const prior = JSON.parse(old);
  writeFileSync(`${DIR}/scoringFreeze.json`, JSON.stringify({ ...prior, ...computeFreeze(), version:"m6-acceptance-scoring-freeze-9", signedAt:new Date().toISOString(),
    supersedes:{version:prior.version,file:"scoringFreeze.v8.json",sha256:sha(old)},
    scope:"Combined acceptance retry after correcting M4 transparent-observer initialization; incremental partial-run evidence is retained.",
    reason:"The v8 full-unit run failed with the actual M4 preview visible but its observer uninitialized. Correct import order only; no app, corpus, gold, population, reference, proof or gate changes. Original v8 signature and failure remain immutable.",
    disclosure:"Same-author preparation/signing. v8 initial grading failed before a combined score was available; its log is retained. This successor is signed before corrected grading, and is not a passing score." },null,2)+"\n");
}
if (process.env.M6_WRITE_FREEZE_V10 === "1") {
  const old = readFileSync(`${DIR}/scoringFreeze.v9.json`, "utf8");
  if (JSON.parse(old).version !== "m6-acceptance-scoring-freeze-9" || readFileSync(`${DIR}/scoringFreeze.json`, "utf8") !== old) throw Error("Cannot overwrite a successor or changed v9 signature");
  const prior = JSON.parse(old);
  writeFileSync(`${DIR}/scoringFreeze.json`, JSON.stringify({ ...prior, ...computeFreeze(), version:"m6-acceptance-scoring-freeze-10", signedAt:new Date().toISOString(),
    supersedes:{version:prior.version,file:"scoringFreeze.v9.json",sha256:sha(old)},
    scope:"Combined grading after intentional-empty unsafe manifest correction. Frozen original cases and all v9 observations retained.",
    reason:"v9 executed all 8123 observations but validation rejected three authored empty unsafe-refusal fixtures. Permit only empty P-UNSAFE cases with explicit refusal/no financial links; reject empty core/financial/choice cases. Preflight all manifests before UI work. No population, case, gold, reference or gate changes.",
    disclosure:"Same-author signing before grading. v8/v9 failures retained. Regrading v9 observations is labelled retained UI evidence under corrected validation, not fresh UI; final normal tests execute UI again." },null,2)+"\n");
}
if (process.env.M6_WRITE_FREEZE_V11 === "1") {
  const old = readFileSync(`${DIR}/scoringFreeze.v10.json`, "utf8");
  if (JSON.parse(old).version !== "m6-acceptance-scoring-freeze-10" || readFileSync(`${DIR}/scoringFreeze.json`, "utf8") !== old) throw Error("Cannot overwrite a successor or changed v10 signature");
  const prior = JSON.parse(old);
  writeFileSync(`${DIR}/scoringFreeze.json`, JSON.stringify({ ...prior, ...computeFreeze(), version:"m6-acceptance-scoring-freeze-11", signedAt:new Date().toISOString(),
    supersedes:{version:prior.version,file:"scoringFreeze.v10.json",sha256:sha(old)},
    scope:"Corrected actual labelled M3 manual-history observer; all original corpus/golds/gates unchanged.",
    reason:"Grading v9 observations under v10 found the zero-history M3 observer missed the correctly wrapped-label manual input. History RED/GREEN covers all six actual controls. Refresh only this affected history package; reuse unchanged completed public-route observations.",
    disclosure:"Same-author signing before corrected grading. v8/v9/v10 failures remain. Mixed retained v9 financial/routes plus fresh six history observations are explicitly labelled, not a fresh complete UI run or a passing gate." },null,2)+"\n");
}
if (process.env.M6_WRITE_FREEZE_V12 === "1") {
  const old = readFileSync(`${DIR}/scoringFreeze.v11.json`, "utf8");
  if (JSON.parse(old).version !== "m6-acceptance-scoring-freeze-11" || readFileSync(`${DIR}/scoringFreeze.json`, "utf8") !== old) throw Error("Cannot overwrite a successor or changed v11 signature");
  const prior = JSON.parse(old);
  writeFileSync(`${DIR}/scoringFreeze.json`, JSON.stringify({ ...prior, ...computeFreeze(), version:"m6-acceptance-scoring-freeze-12", signedOn:"2026-10-21", signedAt:new Date().toISOString(),
    preparedAndSignedBy:"Claude actual session a3fdc854-0d17-4a58-80ba-13f242e6daf9",supersedes:{version:prior.version,file:"scoringFreeze.v11.json",sha256:sha(old)},
    scope:"Owner-recorded scoring amendments D-R2 (family-resolution measure for m1:several-stores only, beside the unchanged direct metric) and D-R3 (alternate request and natively proved reference for m1/202-0210), the 108-prompt legacy hand-off fixture, and the store-typo later-word regression. Frozen before the grading run that uses them. Not a passing score.",
    reason:"The grader, manifest types, native-evidence checker, harness, loader and combined acceptance test changed to read the amendments; new frozen data (amendments.json, amendmentReferences.json, native-proof-amendment.json, legacyHandoff.json) and new frozen regressions were added. Every original case, text, label, population, gold request, reference, proof, seed requirement, typo lock and counting rule is byte-identical to v11. The v11 signature is archived unchanged as scoringFreeze.v11.json; v1 to v10 and their failures are preserved.",
    disclosure:"Same-author preparation, implementation and signing (session a3fdc854 wrote the code, the tests and this signature); no independent reviewer. The amendments were recorded as owner decisions before implementation (Task5-Remediation-Completion/Decisions-Ledger.md). The earlier freeze chain was inspected: the successor of v11 is v12. A freeze is an identity, not a pass." },null,2)+"\n");
}
describe("M6 scoring freeze (VP-19), version 2", () => {
  const freeze = JSON.parse(readFileSync(FREEZE, "utf8"));
  it("is signed with an identity, a date and the same-session disclosure, and names the version it supersedes", () => {
    expect(freeze.version).toBe("m6-ordinary-scoring-freeze-2");
    expect(freeze.supersedes).toEqual({ version: "m6-ordinary-scoring-freeze-1", file: "scoringFreeze.v1.json", sha256: V1_SHA256 });
    expect(freeze.countingKey).toBe("count-key-v1");
    expect(freeze.preparedAndSignedBy).toContain("bec4530a-cba4-40c4-b585-ecb9aed91bfa");
    expect(freeze.disclosure).toMatch(/same session/i);
    expect(freeze.signedOn).toMatch(/^2026-10-\d\d$/);
  });
  it("matches the bytes, labels, registries and seed/context membership that exist now", () => {
    // Version 2 is immutable history. Current bytes/membership belong to version 3 below.
    expect(freeze.files["cases.json"]).toBe(JSON.parse(readFileSync(FREEZE_V1, "utf8")).files["cases.json"]);
  });
  it("freezes the complete required-family inventory, including families with zero cases", () => {
    expect(freeze.requiredFamilyRegistry.families).toBe(REQUIRED_FAMILY_IDS.length);
  });
  it("says plainly what it does not cover, so no report can present it as the whole corpus", () => {
    expect(freeze.status).toBe("PARTIAL");
    expect(freeze.typoClassificationLock).toBeNull();
    expect(freeze.notCovered.join(" ")).toMatch(/M3/); expect(freeze.notCovered.join(" ")).toMatch(/M4/); expect(freeze.notCovered.join(" ")).toMatch(/M5/);
    expect(freeze.notCovered.join(" ")).toMatch(/P-ID/);
  });
  it("every reference that is not a hand-worked anchor carries a native receipt", () => {
    const refs: Record<string, { evidenceKind?: string; nativeReceipt?: string | null }> = JSON.parse(readFileSync(`${DIR}/referenceResults.json`, "utf8"));
    const unlinked = Object.entries(refs).filter(([, r]) => !r.evidenceKind && !r.nativeReceipt).map(([id]) => id);
    expect(unlinked).toEqual([]);
    expect(Object.values(refs).filter(r => r.evidenceKind).every(r => !r.nativeReceipt)).toBe(true);
  });
});

describe("M6 complete preparation freeze version 7 (prior signed checkpoints retained)", () => {
  const current = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v7.json`, "utf8"));
  it("is a new signed checkpoint, preserves v2 byte identity and carries the prior exploratory-run disclosure", () => {
    expect(current.version).toBe("m6-preparation-scoring-freeze-7");
    expect(current.status).toBe("FROZEN_FOR_ACCEPTANCE");
    expect(current.supersedes.sha256).toBe(sha(readFileSync(`${DIR}/scoringFreeze.v6.json`, "utf8")));
    expect(current.preparedAndSignedBy).toContain("01a11bfa-3a3a-7c41-af31-b4b4b9dd7216");
    expect(current.disclosure).toMatch(/exploratory/);
    expect(current.disclosure).toMatch(/same.author/i);
  });
  it("matches every prepared file, case population, family, seed and routing obligation", () => {
    const actual = computeFreeze();
    // v7 is immutable history; the live successor below binds current helper bytes.
    for (const key of ["populationLabels", "familyRegistry", "requiredFamilyRegistry", "seedContextMembership", "packageMembership", "routingObligations"]) expect(current[key], key).toEqual(actual[key as keyof typeof actual]);
    expect(current.populationLabels.cases).toBe(2739);
    expect(current.routingObligations.cases).toBe(7);
    expect(current.typoClassificationLock.sha256).toBe(actual.files["flaggedDispositions.json"]);
  });
  it("retains v3 and changes no question, label, request, gold result, counting rule or seed membership", () => {
    const v3 = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v3.json`, "utf8"));
    expect(v3.version).toBe("m6-preparation-scoring-freeze-3");
    for (const key of ["populationLabels", "familyRegistry", "requiredFamilyRegistry", "seedContextMembership", "packageMembership", "routingObligations", "typoClassificationLock"]) expect(current[key], key).toEqual(v3[key]);
    const v5 = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v5.json`, "utf8"));
    const changed = Object.keys(v3.files).filter(f => v3.files[f] !== v5.files[f]);
    expect(changed.sort()).toEqual(["../../askVault/m3Scenario.test.tsx", "../../askVault/m5Scenario.test.tsx", "m3Scenario.ts", "nativeEvidence.ts"]);
  });
  it("preserves v5 and changes only display verification and its regression inventory", () => {
    const v5 = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v5.json`, "utf8"));
    expect(v5.version).toBe("m6-preparation-scoring-freeze-5");
    for (const key of ["populationLabels", "familyRegistry", "requiredFamilyRegistry", "seedContextMembership", "packageMembership", "routingObligations", "typoClassificationLock"]) expect(current[key], key).toEqual(v5[key]);
    const v6 = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v6.json`, "utf8"));
    expect(Object.keys(v5.files).filter(f => v5.files[f] !== v6.files[f]).sort()).toEqual(["../../askVault/routeDisplayCheck.test.tsx", "displayCheck.ts", "freeze.ts"]);
    expect(Object.keys(v6.files).filter(f => !(f in v5.files))).toEqual(["../../askVault/combinedRouteHarness.test.tsx"]);
    expect(Object.keys(v6.files).filter(f => v6.files[f] !== current.files[f]).sort()).toEqual(["../../askVault/combinedCorpusGraderGaps.test.ts", "grader.ts"]);
    expect(Object.keys(current.files).filter(f => !(f in v6.files))).toEqual(["clarificationGolds.json"]);
  });
});

describe("M6 combined acceptance freeze version 11 (archived, immutable)", () => {
  it("is signed before grading, preserves v7 bytes and records the helpers and regressions it froze", () => {
    const live = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v11.json`, "utf8"));
    expect(live.version).toBe("m6-acceptance-scoring-freeze-11");
    expect(sha(readFileSync(`${DIR}/scoringFreeze.v11.json`, "utf8"))).toBe("e7bc366ce0e9f8ab12971ac3ba0e03980531b54be1c268dfcc2073b9705848ea");
    expect(live.preparedAndSignedBy).toContain("01a11bfa-3a3a-7c41-af31-b4b4b9dd7216");
    expect(live.supersedes).toEqual({version:"m6-acceptance-scoring-freeze-10",file:"scoringFreeze.v10.json",sha256:sha(readFileSync(`${DIR}/scoringFreeze.v10.json`,"utf8"))});
    const v8 = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v8.json`,"utf8"));
    expect(v8.supersedes.sha256).toBe(sha(readFileSync(`${DIR}/scoringFreeze.v7.json`,"utf8")));
    // v11 is immutable history: its helper bytes are not compared with today's (they changed on purpose in v12); its non-helper content must still equal today's.
    const today = computeFreeze();
    for (const key of ["packageMembership","routingObligations","populationLabels","familyRegistry","requiredFamilyRegistry","seedContextMembership"]) expect(live[key],key).toEqual(today[key as keyof typeof today]);
    for (const name of ["combinedAcceptance.test.tsx","combinedAcceptanceIntegrity.test.ts","clarificationExchanges.test.tsx"]) expect(live.files[`../../askVault/${name}`]).toMatch(/^[a-f0-9]{64}$/);
    const prior = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v7.json`,"utf8"));
    for (const key of ["populationLabels","familyRegistry","requiredFamilyRegistry","seedContextMembership","packageMembership","routingObligations","typoClassificationLock"]) expect(live[key],key).toEqual(prior[key]);
    for (const name of ["cases.json","contexts.json","expectedRequests.json","referenceResults.json","clarificationGolds.json","flaggedDispositions.json"]) expect(live.files[name],name).toBe(prior.files[name]);
  });
});

describe("M6 scoring freeze version 1 is preserved, and version 2 changed no frozen membership or gate", () => {
  const v1 = JSON.parse(readFileSync(FREEZE_V1, "utf8")), v2 = JSON.parse(readFileSync(FREEZE, "utf8"));
  it("keeps the signed partial freeze byte for byte", () => {
    expect(sha(readFileSync(FREEZE_V1, "utf8"))).toBe(V1_SHA256);
    expect(v1.version).toBe("m6-ordinary-scoring-freeze-1"); expect(v1.status).toBe("PARTIAL");
    expect(v1.preparedAndSignedBy).toContain("6f95b5d0-956e-407b-8a5e-83695020d02c");
  });
  it("preserves every original corpus text, gold, label, amendment, receipt, membership and the counting key", () => {
    const unchanged = FREEZE_V1_FILES.filter(f => f !== "grader.ts" && f !== "manifest.ts");
    expect(unchanged.length).toBe(10);
    for (const f of unchanged) expect(v2.files[f], f).toBe(v1.files[f]);
    expect(v2.populationLabels).toEqual(v1.populationLabels);
    expect(v2.familyRegistry).toEqual(v1.familyRegistry);
    expect(v2.seedContextMembership).toEqual(v1.seedContextMembership);
    expect(v2.countingKey).toBe(v1.countingKey);
  });
  it("records that only the grader and its input types changed among the v1 files, which is why a new version was required", () => {
    expect(v2.files["grader.ts"]).not.toBe(v1.files["grader.ts"]);
    expect(v2.files["manifest.ts"]).not.toBe(v1.files["manifest.ts"]);
  });
});

if (process.env.M6_WRITE_FREEZE_V13 === "1") {
  // Task 7: signs version 13 only while the live path still holds the exact v12 bytes and the archived copy exists. It does not sign for anyone else.
  const old = readFileSync(`${DIR}/scoringFreeze.v12.json`, "utf8");
  if (sha(old) !== "fa8d39ef2b92836d300e44aaf2f40fc266c8f103fea72e755800f750be55997a" || readFileSync(`${DIR}/scoringFreeze.json`, "utf8") !== old) throw Error("Cannot overwrite a successor or changed v12 signature");
  const prior = JSON.parse(old);
  writeFileSync(`${DIR}/scoringFreeze.json`, JSON.stringify({ ...prior, ...computeFreeze(), version: "m6-acceptance-scoring-freeze-13", signedOn: "2026-10-22", signedAt: new Date().toISOString(),
    preparedAndSignedBy: "Claude Code actual session 47bd1362-2501-4ab1-8959-f696c4b5bc0f", supersedes: { version: prior.version, file: "scoringFreeze.v12.json", sha256: sha(old) },
    scope: "Owner direction D-8 (approved 22 October 2026): the realistic-error floor counts the individually reviewed membership in realisticErrors.json (300 P-CORE cases read one by one) instead of raw typo or noise tags; the raw tag count is reported separately. Frozen before the grading run that uses it. Not a passing score.",
    reason: "The grader, manifest types, loader and freeze list changed so that the floor reads reviewed membership; realisticErrors.json and its regression test were added. Every original case, text, label, population, gold request, reference, proof, seed requirement, typo lock, amendment and counting rule is byte-identical to v12. The v12 signature is archived unchanged as scoringFreeze.v12.json; v1 to v11 and their failures are preserved.",
    disclosure: "Same-author review, implementation and signing (session 47bd1362 read the 300 cases, wrote the list, the grader change and this signature); no independent reviewer. Signed before the grading run. A freeze is an identity, not a pass. No person's acknowledgement is claimed." }, null, 2) + "\n");
}
describe("M6 combined acceptance freeze version 12 (archived, immutable; owner amendments D-R2 and D-R3)", () => {
  const live = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v12.json`, "utf8"));
  const v11 = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v11.json`, "utf8"));
  it("is signed before the grading run that uses it, names v11 as its predecessor and matches every frozen byte that exists now", () => {
    expect(live.version).toBe("m6-acceptance-scoring-freeze-12");
    expect(live.status).toBe("FROZEN_FOR_ACCEPTANCE");
    expect(live.preparedAndSignedBy).toContain("a3fdc854-0d17-4a58-80ba-13f242e6daf9");
    expect(live.disclosure).toMatch(/Same-author/);
    expect(live.supersedes).toEqual({ version: "m6-acceptance-scoring-freeze-11", file: "scoringFreeze.v11.json", sha256: sha(readFileSync(`${DIR}/scoringFreeze.v11.json`, "utf8")) });
    // v12 is immutable history: its helper bytes changed on purpose in v13 (reviewed realistic errors). Its non-helper content must still equal today's.
    expect(sha(readFileSync(`${DIR}/scoringFreeze.v12.json`, "utf8"))).toBe("fa8d39ef2b92836d300e44aaf2f40fc266c8f103fea72e755800f750be55997a");
    const today = computeFreeze();
    for (const key of ["packageMembership", "routingObligations", "populationLabels", "familyRegistry", "requiredFamilyRegistry", "seedContextMembership"]) expect(live[key], key).toEqual(today[key as keyof typeof today]);
  });
  it("changes no original case, text, label, population, gold, reference, proof, seed requirement, typo lock or counting rule", () => {
    for (const key of ["populationLabels", "familyRegistry", "requiredFamilyRegistry", "seedContextMembership", "packageMembership", "routingObligations", "typoClassificationLock", "countingKey"]) expect(live[key], key).toEqual(v11[key]);
    for (const name of ["cases.json", "contexts.json", "expectedRequests.json", "referenceResults.json", "clarificationGolds.json", "flaggedDispositions.json", "typoRules.json", "requiredFamilies.json", "nativeEvidenceManifest.json", "nativeProofs/native-proof-ordinary.json", "nativeProofs/native-proof-scenario-prerequisites.json", "routingCases.json", "historyCases.json"])
      expect(live.files[name], name).toBe(v11.files[name]);
  });
  it("lists exactly which frozen files changed or were added since v11, so no change can hide", () => {
    // This file freezes its own bytes, so it cannot also list itself: scoringFreeze.test.ts is the one frozen file excluded from this comparison.
    const changed = Object.keys(live.files).filter(f => f in v11.files && live.files[f] !== v11.files[f] && f !== "../../askVault/scoringFreeze.test.ts").sort();
    const added = Object.keys(live.files).filter(f => !(f in v11.files)).sort();
    expect(Object.keys(v11.files).filter(f => !(f in live.files))).toEqual([]);
    expect(changed).toEqual(["../../askVault/combinedAcceptance.test.tsx","combinedAcceptance.ts","combinedAcceptanceRoutes.tsx","freeze.ts","grader.ts","manifest.ts","nativeEvidence.ts","routeHarness.tsx"]);
    expect(added).toEqual(["../../askVault/amendmentReferences.test.ts","../../askVault/familyResolution.test.ts","../../askVault/familyResolutionRoute.test.tsx","../../askVault/legacyHandoffRoute.test.tsx","../../askVault/storeTypoLaterWord.test.tsx","amendmentReference.ts","amendmentReferences.json","amendments.json","legacyHandoff.json","nativeProofs/native-proof-amendment.json"]);
  });
  it("keeps v1 to v11 in the chain with their original supersedes links", () => {
    const hashes = ["v7", "v8", "v9", "v10", "v11"].map(v => JSON.parse(readFileSync(`${DIR}/scoringFreeze.${v}.json`, "utf8")));
    for (let i = 1; i < hashes.length; i++) expect(hashes[i].supersedes.sha256, hashes[i].version).toBe(sha(readFileSync(`${DIR}/scoringFreeze.v${6 + i}.json`, "utf8")));
  });
});

describe("M6 combined acceptance freeze version 13 (reviewed realistic errors, owner direction D-8)", () => {
  const live = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v13.json`, "utf8"));
  const v12 = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v12.json`, "utf8"));
  it("is signed by the session that made the change, before the grading run, naming v12 as its predecessor, and matches every frozen byte that exists now", () => {
    expect(live.version).toBe("m6-acceptance-scoring-freeze-13");
    expect(live.status).toBe("FROZEN_FOR_ACCEPTANCE");
    expect(live.preparedAndSignedBy).toBe("Claude Code actual session 47bd1362-2501-4ab1-8959-f696c4b5bc0f");
    expect(live.disclosure).toMatch(/Same-author/); expect(live.disclosure).toMatch(/No person's acknowledgement is claimed/);
    expect(live.supersedes).toEqual({ version: "m6-acceptance-scoring-freeze-12", file: "scoringFreeze.v12.json", sha256: sha(readFileSync(`${DIR}/scoringFreeze.v12.json`, "utf8")) });
    // Immutable v13 identity is retained; current namespace-only integration bytes are bound by v14 below.
    expect(sha(readFileSync(`${DIR}/scoringFreeze.v13.json`, "utf8"))).toBe("1e3afcca9f27ff7eb0517fcbc7280239519a87300dce94831420b2be7417eac9");
  });
  it("changes no original case, text, label, population, gold, reference, proof, seed requirement, typo lock, amendment or counting rule", () => {
    for (const key of ["populationLabels", "familyRegistry", "requiredFamilyRegistry", "seedContextMembership", "packageMembership", "routingObligations", "typoClassificationLock", "countingKey"]) expect(live[key], key).toEqual(v12[key]);
    for (const name of ["cases.json", "contexts.json", "expectedRequests.json", "referenceResults.json", "clarificationGolds.json", "flaggedDispositions.json", "typoRules.json", "requiredFamilies.json", "nativeEvidenceManifest.json", "amendments.json", "amendmentReferences.json", "legacyHandoff.json", "nativeProofs/native-proof-ordinary.json", "nativeProofs/native-proof-scenario-prerequisites.json", "nativeProofs/native-proof-amendment.json"]) expect(live.files[name], name).toBe(v12.files[name]);
  });
  it("lists exactly which frozen files changed or were added since v12, so no change can hide", () => {
    const changed = Object.keys(live.files).filter(f => f in v12.files && live.files[f] !== v12.files[f] && f !== "../../askVault/scoringFreeze.test.ts").sort();
    const added = Object.keys(live.files).filter(f => !(f in v12.files)).sort();
    expect(Object.keys(v12.files).filter(f => !(f in live.files))).toEqual([]);
    expect(changed).toEqual(["../../askVault/combinedAcceptance.test.tsx", "combinedAcceptance.ts", "freeze.ts", "grader.ts", "manifest.ts"]);
    expect(added).toEqual(["../../askVault/realisticErrors.test.ts", "realisticErrors.json"]);
  });
  it("keeps v1 to v12 in the chain with their original supersedes links", () => {
    const chain = ["v7", "v8", "v9", "v10", "v11", "v12"].map(v => JSON.parse(readFileSync(`${DIR}/scoringFreeze.${v}.json`, "utf8")));
    for (let i = 1; i < chain.length; i++) expect(chain[i].supersedes.sha256, chain[i].version).toBe(sha(readFileSync(`${DIR}/scoringFreeze.v${6 + i}.json`, "utf8")));
  });
});

// Owner attachment 19df3401: preserve release-1.3.1 transaction renames and existing scoring rules.
if (process.env.M6_WRITE_FREEZE_V14 === "1") {
  const old = readFileSync(`${DIR}/scoringFreeze.v13.json`, "utf8");
  if (sha(old) !== "1e3afcca9f27ff7eb0517fcbc7280239519a87300dce94831420b2be7417eac9" || readFileSync(`${DIR}/scoringFreeze.json`,"utf8") !== old) throw Error("Cannot overwrite a successor or altered v13");
  const prior = JSON.parse(old);
  writeFileSync(`${DIR}/scoringFreeze.json`, JSON.stringify({ ...prior, ...computeFreeze(), version:"m6-acceptance-scoring-freeze-14", signedOn:"2026-10-24", signedAt:new Date().toISOString(),
    preparedAndSignedBy:"Codex actual session 01a11bfa-3a3a-7c41-af31-b4b4b9dd7216",
    supersedes:{version:prior.version,file:"scoringFreeze.v13.json",sha256:sha(old)},
    scope:"Release integration namespace and checkout-byte identity only; no scoring-policy or financial expectation changes.",
    reason:"Preserve release branch transactionQa rename in imports, symbols and comments; record line-ending changes from the integrated gitattributes. Archive v13 byte for byte. Original corpora, requests, references, gates, population/family/seed membership and amendments are unchanged.",
    disclosure:"Same-author integration and signing before merged-candidate grading. A freeze is an identity, not a score. Historical v1-v13 receipts and failures remain preserved." },null,2)+"\n");
}
describe("M6 release integration freeze version 14", () => {
  const live = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v14.json`,"utf8"));
  const prior = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v13.json`,"utf8"));
  it("binds the actual integrated bytes before grading with a disclosed session identity", () => {
    expect(live.version).toBe("m6-acceptance-scoring-freeze-14");
    expect(live.preparedAndSignedBy).toBe("Codex actual session 01a11bfa-3a3a-7c41-af31-b4b4b9dd7216");
    expect(live.supersedes).toEqual({version:prior.version,file:"scoringFreeze.v13.json",sha256:sha(readFileSync(`${DIR}/scoringFreeze.v13.json`,"utf8"))});
    expect(sha(readFileSync(`${DIR}/scoringFreeze.v14.json`,"utf8"))).toBe("0774fb4d56d89d65aedce1a1e3808a0d0188e4ab7332016fc1c77887fa151318");
  });
  it("preserves all populations, requirements, seeds and every frozen financial data file", () => {
    for(const key of ["populationLabels","familyRegistry","requiredFamilyRegistry","seedContextMembership","packageMembership","routingObligations","typoClassificationLock","countingKey"]) expect(live[key],key).toEqual(prior[key]);
    expect(Object.keys(live.files)).toEqual(Object.keys(prior.files));
    for(const name of Object.keys(prior.files).filter(f=>f.endsWith(".json"))) expect(live.files[name],name).toBe(prior.files[name]);
    const allowed=["../../askVault/amendmentReferences.test.ts","../../askVault/exampleEvidence.test.tsx","../../askVault/familyResolution.test.ts","../../askVault/familyResolutionRoute.test.tsx","../../askVault/legacyHandoffRoute.test.tsx","../../askVault/m5RouteElsewhere.test.tsx","../../askVault/realisticErrors.test.ts","../../askVault/scoringFreeze.test.ts","../../askVault/storeTypoLaterWord.test.tsx","exampleMap.ts","routingRoute.tsx"];
    expect(Object.keys(prior.files).filter(f=>prior.files[f]!==live.files[f]).sort()).toEqual(allowed.sort());
  });
});

if (process.env.M6_WRITE_FREEZE_V15 === "1") {
  const old = readFileSync(`${DIR}/scoringFreeze.v14.json`,"utf8");
  if (sha(old) !== "0774fb4d56d89d65aedce1a1e3808a0d0188e4ab7332016fc1c77887fa151318" || readFileSync(`${DIR}/scoringFreeze.json`,"utf8") !== old) throw Error("Cannot overwrite a successor or changed v14");
  const prior = JSON.parse(old);
  writeFileSync(`${DIR}/scoringFreeze.json`,JSON.stringify({...prior,...computeFreeze(),version:"m6-acceptance-scoring-freeze-15",signedAt:new Date().toISOString(),
    supersedes:{version:prior.version,file:"scoringFreeze.v14.json",sha256:sha(old)},
    reason:"Finish namespace-only test-source cross-references and require the current signed freeze at combined grading. Preserve v14 and its failed preflight. No corpus, gold amount, request, gate, population or seed changes. Complete gitattributes coverage for frozen test files prevents checkout conversion.",
    disclosure:"Same-author signing before corrected merged-candidate grading. v14 grading stopped at version preflight; no score from that failed attempt. Original failures and freeze chain retained."},null,2)+"\n");
}
describe("M6 final release integration freeze version 15",()=>{
 const live=JSON.parse(readFileSync(`${DIR}/scoringFreeze.json`,"utf8")),prior=JSON.parse(readFileSync(`${DIR}/scoringFreeze.v14.json`,"utf8"));
 it("matches every actual byte and keeps every scored population, financial data and rule unchanged",()=>{
   expect(live.version).toBe("m6-acceptance-scoring-freeze-15");
   expect(live.preparedAndSignedBy).toBe("Codex actual session 01a11bfa-3a3a-7c41-af31-b4b4b9dd7216");
   expect(live.supersedes).toEqual({version:prior.version,file:"scoringFreeze.v14.json",sha256:sha(readFileSync(`${DIR}/scoringFreeze.v14.json`,"utf8"))});
   for(const [key,value] of Object.entries(computeFreeze()))expect(live[key],key).toEqual(value);
   for(const key of ["populationLabels","familyRegistry","requiredFamilyRegistry","seedContextMembership","packageMembership","routingObligations","typoClassificationLock","countingKey"])expect(live[key],key).toEqual(prior[key]);
   for(const name of Object.keys(prior.files).filter(f=>f.endsWith(".json")))expect(live.files[name],name).toBe(prior.files[name]);
   expect(Object.keys(prior.files).filter(f=>prior.files[f]!==live.files[f]).sort()).toEqual(["../../askVault/combinedAcceptance.test.tsx","../../askVault/exampleEvidence.test.tsx","../../askVault/scoringFreeze.test.ts","exampleMap.ts"]);
 });
});
