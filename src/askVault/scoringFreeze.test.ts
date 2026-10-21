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
  const current = JSON.parse(readFileSync(`${DIR}/scoringFreeze.json`, "utf8"));
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
    for (const [key, value] of Object.entries(actual)) expect(current[key], key).toEqual(value);
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
