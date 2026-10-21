import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileHash } from "../testSupport/askVaultM6/freeze";
import { UNIT_STAND_IN_RECEIPT, referenceIdentity, verifyNativeEvidence } from "../testSupport/askVaultM6/nativeEvidence";

// VP-06/08 (Validation-Plan.md:109-112, :129-134), CG-05/CG-12 (Requirements-Checklist.md:96, :103): a receipt string is only a claim.
// The first half builds a tiny, deliberately SYNTHETIC world and proof so the verifier's failure modes can be provoked one at a time.
// Nothing here is corpus evidence. The second half checks the real retained proof and the real 3,291 references.
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const DIR = "src/testSupport/askVaultM6";

function synthetic() {
  const requests: Record<string, unknown> = { q1: { kind: "total", periods: [{ from: "2026-09-01", to: "2026-09-30" }] } };
  const contexts = { worlds: { w1: { today: "2026-09-06", accounts: [1] } }, contexts: { c1: { seed: 101, worldId: "w1", parseContext: { today: "2026-09-06" } } } };
  const proofText = JSON.stringify({ test: "ask_vault_m6_frozen_reference_worlds", checked: ["r1"], failures: 0 });
  const references = { r1: { value: { total: "1.00" }, seed: 101, contextId: "c1", requestId: "q1", nativeReceipt: `synthetic-proof.json#sha256:${sha(proofText)}#r1` } };
  const manifest = { proofs: { "synthetic-proof.json": { sha256: sha(proofText) } }, identities: { r1: referenceIdentity(references.r1, requests, contexts) } };
  return { requests, contexts, references, proofs: { "synthetic-proof.json": proofText }, manifest };
}
const codes = (input: ReturnType<typeof synthetic>) => verifyNativeEvidence(input).problems.map(p => p.code);

// One-time writer (never overwrites): records the identity of every ordinary reference as it exists now. It refuses to run unless the four input
// files still hash to the values signed in the preserved v1 freeze, i.e. unless they are the bytes the retained native proof was issued against.
if (process.env.M6_WRITE_EVIDENCE_MANIFEST === "1") {
  const target = `${DIR}/nativeEvidenceManifest.json`;
  if (existsSync(target)) throw new Error("The evidence manifest already exists; a change needs a new, disclosed version.");
  const v1 = JSON.parse(readFileSync(`${DIR}/scoringFreeze.v1.json`, "utf8")) as { files: Record<string, string> };
  for (const f of ["contexts.json", "expectedRequests.json", "referenceResults.json"]) if (fileHash(f) !== v1.files[f]) throw new Error(`${f} no longer matches the signed v1 freeze`);
  const refs = JSON.parse(readFileSync(`${DIR}/referenceResults.json`, "utf8")) as Record<string, { evidenceKind?: string; nativeReceipt?: string }>;
  const requests = JSON.parse(readFileSync(`${DIR}/expectedRequests.json`, "utf8")), contexts = JSON.parse(readFileSync(`${DIR}/contexts.json`, "utf8"));
  const proofText = readFileSync(`${DIR}/nativeProofs/native-proof-ordinary.json`, "utf8");
  const cache = new Map<string, string>();
  const identities = Object.fromEntries(Object.entries(refs).filter(([, r]) => !r.evidenceKind).map(([id, r]) => [id, referenceIdentity(r as never, requests, contexts, cache)]));
  writeFileSync(target, JSON.stringify({ version: "m6-native-evidence-manifest-1", writtenBy: "session bec4530a-cba4-40c4-b585-ecb9aed91bfa, 2026-10-21",
    basis: "Identity digests computed post hoc from input files whose SHA-256 equal the signed v1 freeze, paired with the retained native proof (SHA-256 17f4d55b...). The native test itself records no input hashes; see the gap-remediation report for this limit.",
    proofs: { "native-proof-ordinary.json": { sha256: sha(proofText) } }, identities }, null, 1) + "\n");
}

describe("native evidence verification, synthetic proof (verifier failure modes only)", () => {
  it("accepts a receipt whose proof, checksum, membership, outcome and input identity all agree", () => {
    const r = verifyNativeEvidence(synthetic());
    expect(r.problems).toEqual([]);
    expect([...r.verified]).toEqual(["r1"]);
  });
  it("rejects a missing proof file", () => {
    const s = synthetic(); s.proofs = {} as typeof s.proofs;
    expect(codes(s)).toContain("unknown-proof");
  });
  it("rejects a forged receipt whose checksum does not match the proof bytes", () => {
    const s = synthetic(); s.references.r1.nativeReceipt = `synthetic-proof.json#sha256:${"0".repeat(64)}#r1`;
    expect(codes(s)).toContain("proof-checksum-mismatch");
  });
  it("rejects a proof whose bytes changed after the receipt and manifest were issued", () => {
    const s = synthetic(); s.proofs["synthetic-proof.json"] = s.proofs["synthetic-proof.json"].replace('"failures":0', '"failures": 0');
    expect(codes(s)).toContain("proof-checksum-mismatch");
  });
  it("rejects a receipt that does not point at a checked reference ID", () => {
    const text = JSON.stringify({ test: "ask_vault_m6_frozen_reference_worlds", checked: ["other"], failures: 0 });
    const s = synthetic(); s.proofs["synthetic-proof.json"] = text; s.references.r1.nativeReceipt = `synthetic-proof.json#sha256:${sha(text)}#r1`;
    s.manifest.proofs["synthetic-proof.json"].sha256 = sha(text);
    expect(codes(s)).toContain("id-not-in-proof");
  });
  it("rejects a proof that lists the same ID twice", () => {
    const text = JSON.stringify({ test: "ask_vault_m6_frozen_reference_worlds", checked: ["r1", "r1"], failures: 0 });
    const s = synthetic(); s.proofs["synthetic-proof.json"] = text; s.references.r1.nativeReceipt = `synthetic-proof.json#sha256:${sha(text)}#r1`;
    s.manifest.proofs["synthetic-proof.json"].sha256 = sha(text);
    expect(codes(s)).toContain("duplicate-id");
  });
  it.each([["failures", { failures: 2 }], ["the wrong native test", { test: "some_other_test" }]])("rejects a proof of %s", (_name, change) => {
    const text = JSON.stringify({ test: "ask_vault_m6_frozen_reference_worlds", checked: ["r1"], failures: 0, ...change });
    const s = synthetic(); s.proofs["synthetic-proof.json"] = text; s.references.r1.nativeReceipt = `synthetic-proof.json#sha256:${sha(text)}#r1`;
    s.manifest.proofs["synthetic-proof.json"].sha256 = sha(text);
    expect(codes(s)).toContain("proof-not-successful");
  });
  it("rejects a receipt copied from another reference (substituted proof pointer)", () => {
    const s = synthetic(); s.references.r1.nativeReceipt = s.references.r1.nativeReceipt.replace(/#r1$/, "#r2");
    expect(codes(s)).toContain("receipt-id-mismatch");
  });
  it.each([
    ["request", (s: ReturnType<typeof synthetic>) => { s.requests.q1 = { kind: "total", periods: [{ from: "2026-08-01", to: "2026-08-31" }] }; }],
    ["context", (s: ReturnType<typeof synthetic>) => { s.contexts.worlds.w1.today = "2026-09-07"; }],
    ["parse context", (s: ReturnType<typeof synthetic>) => { s.contexts.contexts.c1.parseContext.today = "2026-09-07"; }],
    ["result value", (s: ReturnType<typeof synthetic>) => { s.references.r1.value = { total: "1.01" }; }],
  ])("rejects stale evidence when the %s changed after the native run", (_name, change) => {
    const s = synthetic(); change(s);
    expect(codes(s)).toContain("identity-mismatch");
  });
  it("rejects a reference missing from the identity manifest, a missing request and a missing context", () => {
    const a = synthetic(); a.manifest.identities = {} as typeof a.manifest.identities; expect(codes(a)).toContain("identity-missing");
    const b = synthetic(); delete b.requests.q1; expect(codes(b)).toContain("request-missing");
    const c = synthetic(); c.references.r1.contextId = "nope"; expect(codes(c)).toContain("context-missing");
  });
  it("rejects a reference whose seed is not the seed of its context", () => {
    const s = synthetic(); s.references.r1.seed = 202;
    expect(codes(s)).toContain("seed-mismatch");
  });
  it("never lets a deliberately fabricated unit-test stand-in count as corpus evidence, and rejects a null or empty receipt", () => {
    const a = synthetic(); a.references.r1.nativeReceipt = UNIT_STAND_IN_RECEIPT; expect(codes(a)).toContain("unit-stand-in-in-corpus");
    const b = synthetic(); (b.references.r1 as { nativeReceipt: unknown }).nativeReceipt = null; expect(codes(b)).toContain("malformed-receipt");
    const c = synthetic(); c.references.r1.nativeReceipt = ""; expect(codes(c)).toContain("malformed-receipt");
    const d = synthetic(); d.references.r1.nativeReceipt = "does-not-exist.json#fake"; expect(codes(d)).toContain("malformed-receipt");
  });
});

describe("native evidence verification, the real retained ordinary-spending proof (reused evidence, not a rerun)", () => {
  const read = (name: string) => readFileSync(`${DIR}/${name}`, "utf8");
  const references = JSON.parse(read("referenceResults.json")) as Record<string, { nativeReceipt?: string | null; evidenceKind?: string; value: unknown; seed: number; contextId: string; requestId: string }>;
  const input = () => ({ requests: JSON.parse(read("expectedRequests.json")), contexts: JSON.parse(read("contexts.json")), references,
    proofs: { "native-proof-ordinary.json": read("nativeProofs/native-proof-ordinary.json") }, manifest: JSON.parse(read("nativeEvidenceManifest.json")) });
  const ordinary = Object.entries(references).filter(([, r]) => !r.evidenceKind);
  it("keeps the retained proof byte-identical to the one the references name (SHA-256 17f4d55b...)", () => {
    expect(sha(read("nativeProofs/native-proof-ordinary.json"))).toBe("17f4d55bf53c7d4c78336ae25389b3039e61ce340405d8b832bb23eb6b30fd4d");
  });
  it("verifies every one of the 3,291 ordinary references and none of the hand-worked anchors", () => {
    const r = verifyNativeEvidence({ ...input(), references: Object.fromEntries(ordinary) });
    expect(r.problems).toEqual([]);
    expect(r.verified.size).toBe(3291);
    const withAnchors = verifyNativeEvidence(input());
    expect(withAnchors.verified.size).toBe(3291);
    expect(withAnchors.problems.map(p => p.referenceId).sort()).toEqual(Object.keys(references).filter(id => references[id].evidenceKind).sort());
  });
  it("detects a forged, substituted and stale real reference", () => {
    const i = input();
    const [id, ref] = ordinary[0], [other] = ordinary[1];
    const forged = { ...i.references, [id]: { ...ref, nativeReceipt: "does-not-exist.json#fake" } };
    expect(verifyNativeEvidence({ ...i, references: forged }).verified.has(id)).toBe(false);
    const substituted = { ...i.references, [id]: { ...ref, nativeReceipt: ref.nativeReceipt!.replace(/#[^#]+$/, `#${other}`) } };
    expect(verifyNativeEvidence({ ...i, references: substituted }).problems.map(p => p.code)).toContain("receipt-id-mismatch");
    const stale = { ...i.references, [id]: { ...ref, value: { ...(ref.value as object), asOf: "1999-01-01" } } };
    expect(verifyNativeEvidence({ ...i, references: stale }).problems.map(p => p.code)).toContain("identity-mismatch");
  });
});

// ---- Scenario references: the native proof covers the CONTEXT (what the store reads); the calculation is separate JavaScript (Q5, task-4 item 6) ----------------------------
describe("native evidence verification, scenario context proof (synthetic)", () => {
  const SCENARIO_TEST = "ask_vault_m6_scenario_prerequisites";
  function scenario() {
    const requests: Record<string, unknown> = { q1: { family: "m5-extra-money", extra: { kind: "monthly", amount: "50" } } };
    const contexts = { worlds: { "fx-1": { accounts: [5], today: "2026-09-06" } }, contexts: { "fx-1": { seed: 101, worldId: "fx-1", parseContext: {} } } };
    const proofText = JSON.stringify({ test: SCENARIO_TEST, failures: 0, baseline: ["b1"], thresholdBoundary: ["t1"], retirementContexts: ["fx-1", "fx-2"] });
    const references = { r1: { value: { months: 285 }, seed: 101, contextId: "fx-1", requestId: "q1", nativeReceipt: `scenario-proof.json#sha256:${sha(proofText)}#fx-1` } };
    const manifest = { proofs: { "scenario-proof.json": { sha256: sha(proofText) } }, identities: { r1: referenceIdentity(references.r1, requests, contexts) } };
    return { requests, contexts, references, proofs: { "scenario-proof.json": proofText }, manifest };
  }
  it("accepts a reference whose context the native scenario proof names, and keeps the context proof separate from any calculation", () => {
    const r = verifyNativeEvidence(scenario());
    expect(r.problems).toEqual([]); expect([...r.verified]).toEqual(["r1"]);
  });
  it("rejects a receipt that names a different context than the reference was computed from", () => {
    const s = scenario(); s.references.r1.nativeReceipt = s.references.r1.nativeReceipt.replace(/#fx-1$/, "#fx-2");
    expect(verifyNativeEvidence(s).problems.map(p => p.code)).toContain("receipt-context-mismatch");
  });
  it("rejects a context the proof does not list, a failed proof and a stale context", () => {
    const missing = scenario(); missing.contexts.contexts["fx-1"].worldId = "fx-1"; missing.references.r1.contextId = "fx-9";
    Object.assign(missing.contexts.contexts, { "fx-9": { seed: 101, worldId: "fx-1", parseContext: {} } });
    missing.references.r1.nativeReceipt = missing.references.r1.nativeReceipt.replace(/#fx-1$/, "#fx-9");
    expect(verifyNativeEvidence(missing).problems.map(p => p.code)).toContain("id-not-in-proof");
    const failed = scenario(); const text = JSON.stringify({ test: SCENARIO_TEST, failures: 1, retirementContexts: ["fx-1"] });
    failed.proofs["scenario-proof.json"] = text; failed.references.r1.nativeReceipt = `scenario-proof.json#sha256:${sha(text)}#fx-1`; failed.manifest.proofs["scenario-proof.json"].sha256 = sha(text);
    expect(verifyNativeEvidence(failed).problems.map(p => p.code)).toContain("proof-not-successful");
    const stale = scenario(); stale.contexts.worlds["fx-1"].today = "2026-09-07";
    expect(verifyNativeEvidence(stale).problems.map(p => p.code)).toContain("identity-mismatch");
  });
});

describe("native evidence verification, a scenario reference that names a specific native item (a baseline read) rather than a context", () => {
  const SCENARIO_TEST = "ask_vault_m6_scenario_prerequisites";
  function item() {
    const requests: Record<string, unknown> = { q1: { intent: "m3" } };
    const contexts = { worlds: { w1: { today: "2026-09-06" } }, contexts: { w1: { seed: 101, worldId: "w1", parseContext: {} } } };
    const proofText = JSON.stringify({ test: SCENARIO_TEST, failures: 0, baseline: ["sr-w1-a", "sr-w1-b"], thresholdBoundary: [], retirementContexts: [] });
    const references = { r1: { value: { totalSaving: "100.00" }, seed: 101, contextId: "w1", requestId: "q1", nativeItem: "sr-w1-a", nativeReceipt: `scenario-proof.json#sha256:${sha(proofText)}#sr-w1-a` } };
    const manifest = { proofs: { "scenario-proof.json": { sha256: sha(proofText) } }, identities: { r1: referenceIdentity(references.r1, requests, contexts) } };
    return { requests, contexts, references, proofs: { "scenario-proof.json": proofText }, manifest };
  }
  it("accepts a receipt that names the declared native item, which the proof lists", () => { expect(verifyNativeEvidence(item()).problems).toEqual([]); });
  it("rejects a receipt for another listed item, and an item the proof does not list", () => {
    const other = item(); other.references.r1.nativeReceipt = other.references.r1.nativeReceipt.replace(/#sr-w1-a$/, "#sr-w1-b");
    expect(verifyNativeEvidence(other).problems.map(p => p.code)).toContain("receipt-context-mismatch");
    const missing = item(); missing.references.r1.nativeItem = "sr-w1-z"; missing.references.r1.nativeReceipt = missing.references.r1.nativeReceipt.replace(/#sr-w1-a$/, "#sr-w1-z");
    expect(verifyNativeEvidence(missing).problems.map(p => p.code)).toContain("id-not-in-proof");
  });
});
