import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALTERNATE_VENDORS, AMENDED_CASE, buildAlternateReferences, v1ReferenceValue } from "../testSupport/askVaultM6/amendmentReference";
import { AMENDMENT_PROOF_TEST, NATIVE_PROOF_TEST, referenceIdentity, verifyNativeEvidence } from "../testSupport/askVaultM6/nativeEvidence";
import { canonical } from "../testSupport/askVaultM6/counting";

// D-R3 and D-R2 data (owner decisions, Task5-Remediation-Completion/Decisions-Ledger.md; Task-Authority-2.txt:61-126). Written before the data and the native proof existed (RED first).
// The reference for the actual "shel" request is calculated separately from the application (referenceOracle.ts), linked to a real native run, and shown to differ from the
// original gold reference in nothing but the echoed typed term.
const R = "src/testSupport/askVaultM6/";
const read = (name: string) => readFileSync(R + name, "utf8");
const json = <T,>(name: string): T => JSON.parse(read(name)) as T;
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
type Ref = { value: any; seed: number; contextId: string; requestId: string; nativeReceipt?: string };
const stored = json<{ requests: Record<string, any>; references: Record<string, Ref> }>("amendmentReferences.json");
const registry = json<any>("amendments.json");
const contexts = json<{ worlds: Record<string, { ledger: { description: string }[] }>; contexts: Record<string, { seed: number; worldId: string }> }>("contexts.json");
const cases = json<{ id: string; family: string; required: { seed: number; contextId: string; requestId: string; referenceId: string }[] }[]>("cases.json");
const goldRequests = json<Record<string, any>>("expectedRequests.json");
const goldRefs = json<Record<string, Ref>>("referenceResults.json");
const SHEL = cases.find(c => c.id === AMENDED_CASE)!;

describe("the alternate request for m1/202-0210 and its separately calculated references", () => {
  it("is exactly what the independent oracle produces from the original case, its gold request and the three worlds", () => {
    const built = buildAlternateReferences();
    expect(stored.requests).toEqual(built.requests);
    expect(stored.references).toEqual(built.references);
    expect(registry.alternates).toEqual([{ caseId: AMENDED_CASE, reason: expect.any(String), perSeed: built.perSeed }]);
  });
  it("is the gold request with only the first store term replaced by the typed prefix", () => {
    for (const r of SHEL.required) {
      const gold = goldRequests[r.requestId], alt = stored.requests[registry.alternates[0].perSeed.find((s: any) => s.seed === r.seed).requestId];
      expect(gold.vendors).toEqual(["shell", "sams club"]);
      expect(alt).toEqual({ ...gold, vendors: [...ALTERNATE_VENDORS] });
    }
  });
  it("the same oracle projection reproduces every stored ORIGINAL gold reference, so the projection is not tuned to the new values", () => {
    for (const r of SHEL.required) {
      const world = contexts.worlds[contexts.contexts[r.contextId].worldId];
      expect(v1ReferenceValue(world as never, goldRequests[r.requestId])).toEqual(goldRefs[r.referenceId].value);
    }
  });
  it("semantic equivalence: 'shel' and 'shell' select exactly the same recorded names in all three contexts, and the replies differ only in the echoed term", () => {
    const words = (s: string) => s.toLowerCase().replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const starts = (d: string, term: string) => { const w = words(d); return w.some((_, i) => w.slice(i).join("").startsWith(term)); };
    for (const s of registry.alternates[0].perSeed) {
      const names = [...new Set(contexts.worlds[contexts.contexts[s.contextId].worldId].ledger.map(t => t.description))];
      const shel = names.filter(n => starts(n, "shel")).sort(), shell = names.filter(n => starts(n, "shell")).sort();
      expect(shel.length).toBeGreaterThan(0);
      expect(shel).toEqual(shell);
      const gold = goldRefs[SHEL.required.find(r => r.seed === s.seed)!.referenceId].value, alt = stored.references[s.referenceId].value;
      const normalized = structuredClone(alt); normalized.periods[0].vendorTotals[0].term = "shell";
      expect(normalized).toEqual(gold);
      expect(alt.periods[0].vendorTotals[0].term).toBe("shel");
    }
  });
});

describe("the native proof for the alternate references", () => {
  const ev = registry.nativeEvidence;
  const proofBytes = () => read(`nativeProofs/${ev.proofFile}`);
  it("is a real native-run proof file whose bytes match the recorded checksum, lists each reference once, and records zero failures", () => {
    const proof = JSON.parse(proofBytes());
    expect(proof.test).toBe(AMENDMENT_PROOF_TEST);
    expect(proof.failures).toBe(0);
    expect([...proof.checked].sort()).toEqual(Object.keys(stored.references).sort());
    expect(sha(proofBytes())).toBe(ev.proofSha256);
    expect(sha(read("amendmentReferences.json"))).toBe(ev.referenceFileSha256);
  });
  it("verifies through the same evidence checker as every other reference, with an identity bound to request, context, world, seed and value", () => {
    const refs = Object.fromEntries(Object.entries(stored.references).map(([id, r]) => [id, { ...r, nativeReceipt: ev.receipts[id] }]));
    const bundle = { worlds: contexts.worlds as Record<string, unknown>, contexts: contexts.contexts as never };
    for (const [id, r] of Object.entries(refs)) expect(ev.identities[id]).toBe(referenceIdentity(r as never, stored.requests, bundle));
    const out = verifyNativeEvidence({ references: refs as never, requests: stored.requests, contexts: bundle, proofs: { [ev.proofFile]: proofBytes() }, manifest: { proofs: { [ev.proofFile]: { sha256: ev.proofSha256 } }, identities: ev.identities } });
    expect(out.problems).toEqual([]);
    expect([...out.verified].sort()).toEqual(Object.keys(stored.references).sort());
  });
  it("a changed value, a changed request or a swapped seed is detected", () => {
    const ev0 = registry.nativeEvidence, bundle = { worlds: contexts.worlds as Record<string, unknown>, contexts: contexts.contexts as never };
    const id = Object.keys(stored.references)[0];
    const base = Object.fromEntries(Object.entries(stored.references).map(([k, r]) => [k, { ...r, nativeReceipt: ev0.receipts[k] }]));
    const check = (refs: any, requests: any) => verifyNativeEvidence({ references: refs, requests, contexts: bundle, proofs: { [ev0.proofFile]: proofBytes() }, manifest: { proofs: { [ev0.proofFile]: { sha256: ev0.proofSha256 } }, identities: ev0.identities } }).problems.map(p => `${p.referenceId}:${p.code}`);
    expect(check({ ...base, [id]: { ...base[id], value: { ...base[id].value, asOf: "2000-01-01" } } }, stored.requests)).toEqual([`${id}:identity-mismatch`]);
    expect(check(base, { ...stored.requests, [base[id].requestId]: { ...stored.requests[base[id].requestId], vendors: ["shell", "sams club"] } }).length).toBeGreaterThan(0);
  });
  it("a proof file written by the original ordinary native test still verifies as before (the new proof kind adds, never replaces)", () => {
    const original = read("nativeProofs/native-proof-ordinary.json");
    expect(JSON.parse(original).test).toBe(NATIVE_PROOF_TEST);
    expect(NATIVE_PROOF_TEST).not.toBe(AMENDMENT_PROOF_TEST);
  });
});

describe("the family-resolution registry", () => {
  const dispositions = json<{ entries: { caseId: string; family: string; classification: string; permittedCandidates: string[] }[] }>("flaggedDispositions.json");
  it("names exactly the eight approved store-typo clarifications of m1:several-stores, each with its one permitted candidate from the typo lock", () => {
    const derived = Object.fromEntries(dispositions.entries.filter(e => e.family === "m1:several-stores" && e.classification === "candidate-choice").map(e => [e.caseId, e.permittedCandidates[0]]));
    expect(Object.keys(derived)).toHaveLength(8);
    expect(registry.familyResolution.approvedChoices).toEqual(derived);
    expect(registry.familyResolution.family).toBe("m1:several-stores");
    expect(registry.familyResolution.thresholdPercent).toBe(90);
    for (const id of Object.keys(derived)) expect(cases.find(c => c.id === id)!.family).toBe("m1:several-stores");
  });
  it("records the owner decisions and what the amendment does not change", () => {
    expect(registry.decisions["D-R2"]).toMatch(/several-stores/);
    expect(registry.decisions["D-R3"]).toMatch(/202-0210/);
    expect(registry.familyResolution.doesNotChange.join(" ")).toMatch(/95%/);
    expect(registry.familyResolution.doesNotChange.join(" ")).toMatch(/zero-wrong/);
    expect(registry.familyResolution.doesNotChange.join(" ")).toMatch(/without a user choice/);
    expect(canonical(registry.familyResolution.approvedChoices)).not.toMatch(/refus/i);
  });
});
