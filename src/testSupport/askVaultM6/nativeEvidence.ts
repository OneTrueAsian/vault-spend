import { createHash } from "node:crypto";
import { canonical } from "./counting";

/**
 * VP-06/08 + CG-05/CG-12: a nonempty receipt string is only a claim. A reference earns native credit only when
 *   1. the receipt parses as `<proof file>#sha256:<hex>#<reference id>` and names the reference it is attached to,
 *   2. the proof file's actual bytes hash to the receipt's checksum AND to the checksum recorded in the identity manifest,
 *   3. the proof records the expected native test, zero failures, and lists the reference id exactly once,
 *   4. the request, context, world and seed it is bound to exist and still hash to the identity recorded for the proof, so
 *      a request/context/value changed after the native run (stale) or swapped (substituted) is detected.
 * Test-only. The identity manifest is written once by `nativeEvidenceManifest.test.ts` from inputs whose bytes match the signed freeze.
 */
export const NATIVE_PROOF_TEST = "ask_vault_m6_frozen_reference_worlds";
/** The focused scenario-prerequisites proof (owner decision Q5): it validates NATIVE CONTEXT only (store reads), never a JavaScript calculation. */
export const SCENARIO_PROOF_TEST = "ask_vault_m6_scenario_prerequisites";
/** Marker for deliberately fabricated unit-test evidence. It is never admissible as corpus evidence. */
export const UNIT_STAND_IN_RECEIPT = "deliberate-unit-stand-in-not-corpus-evidence";

export type EvidenceReference = { value: unknown; seed: number; contextId: string; requestId: string; nativeReceipt?: string | null; /** The native item a scenario receipt must name when it is not the context itself (for example a baseline-shaped read). */ nativeItem?: string };
export type ContextBundle = { worlds: Record<string, unknown>; contexts: Record<string, { seed: number; worldId: string } & Record<string, unknown>> };
export type EvidenceManifest = { proofs: Record<string, { sha256: string }>; identities: Record<string, string> };
export type EvidenceProblem = { referenceId: string; code: string; detail: string };
export type EvidenceInput = { references: Record<string, EvidenceReference>; requests: Record<string, unknown>; contexts: ContextBundle;
  proofs: Record<string, string>; manifest: EvidenceManifest };

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const RECEIPT = /^([^#\s]+)#sha256:([0-9a-f]{64})#(\S+)$/;
/** Hashes repeated across thousands of references are shared within ONE verification only; nothing is cached across calls. */
const hashOf = (cache: Map<string, string>, key: string, value: unknown) => {
  let h = cache.get(key);
  if (h === undefined) { h = sha(canonical(value)); cache.set(key, h); }
  return h;
};

/** Digest of everything a native result depends on: the full request, context (parse context and seed), world and the expected value. */
export function referenceIdentity(ref: EvidenceReference, requests: Record<string, unknown>, contexts: ContextBundle, cache: Map<string, string> = new Map()): string {
  const context = contexts.contexts[ref.contextId];
  const request = requests[ref.requestId];
  const parts = [
    request === undefined ? "no-request" : hashOf(cache, `q:${ref.requestId}`, request),
    context === undefined ? "no-context" : hashOf(cache, `c:${ref.contextId}`, context),
    context === undefined ? "no-world" : hashOf(cache, `w:${context.worldId}`, contexts.worlds[context.worldId] ?? null),
    sha(canonical(ref.value)),
    String(ref.seed),
  ];
  return sha(parts.join("|"));
}

export function verifyNativeEvidence(input: EvidenceInput): { verified: Set<string>; problems: EvidenceProblem[] } {
  const { references, requests, contexts, proofs, manifest } = input;
  const verified = new Set<string>(), problems: EvidenceProblem[] = [], cache = new Map<string, string>();
  type ParsedProof = { kind: "ordinary" | "scenario"; checked: Map<string, number>; successful: boolean; sha256: string };
  const parsedProofs = new Map<string, ParsedProof | null>();
  const proofOf = (file: string) => {
    if (parsedProofs.has(file)) return parsedProofs.get(file)!;
    let parsed: ParsedProof | null = null;
    try {
      const j = JSON.parse(proofs[file]) as { test?: unknown; checked?: unknown; failures?: unknown; baseline?: unknown; thresholdBoundary?: unknown; retirementContexts?: unknown };
      const list = (x: unknown) => (Array.isArray(x) ? x.map(String) : []);
      const scenario = j.test === SCENARIO_PROOF_TEST;
      const counts = new Map<string, number>();
      for (const id of scenario ? [...list(j.baseline), ...list(j.thresholdBoundary), ...list(j.retirementContexts)] : list(j.checked)) counts.set(id, (counts.get(id) ?? 0) + 1);
      parsed = { kind: scenario ? "scenario" : "ordinary", checked: counts, sha256: sha(proofs[file]),
        successful: j.failures === 0 && (scenario || j.test === NATIVE_PROOF_TEST && Array.isArray(j.checked)) };
    } catch { parsed = null; }
    parsedProofs.set(file, parsed);
    return parsed;
  };
  for (const [id, ref] of Object.entries(references)) {
    const bad = (code: string, detail: string) => problems.push({ referenceId: id, code, detail });
    const receipt = ref.nativeReceipt;
    if (receipt === UNIT_STAND_IN_RECEIPT) { bad("unit-stand-in-in-corpus", "fabricated unit-test evidence is not corpus evidence"); continue; }
    const m = typeof receipt === "string" ? RECEIPT.exec(receipt) : null;
    if (!m) { bad("malformed-receipt", "receipt is not <proof>#sha256:<hex>#<reference id>"); continue; }
    const [, file, checksum, receiptId] = m;
    const before = problems.length;
    if (proofs[file] === undefined) bad("unknown-proof", file);
    else {
      const proof = proofOf(file);
      const actual = proof?.sha256 ?? sha(proofs[file]);
      if (actual !== checksum || manifest.proofs[file]?.sha256 !== actual) bad("proof-checksum-mismatch", `${file} hashes to ${actual}`);
      if (!proof || !proof.successful) bad("proof-not-successful", `${file} is not a successful ${NATIVE_PROOF_TEST} proof`);
      else {
        // An ordinary receipt names the reference itself. A scenario receipt names the CONTEXT the reference was computed from (the proof validates the store read, not the calculation).
        const wanted = proof.kind === "scenario" ? (ref.nativeItem ?? ref.contextId) : id;
        if (receiptId !== wanted) bad(proof.kind === "scenario" ? "receipt-context-mismatch" : "receipt-id-mismatch", `receipt names ${receiptId}`);
        const n = proof.checked.get(receiptId) ?? 0;
        if (n === 0) bad("id-not-in-proof", receiptId);
        if (n > 1) bad("duplicate-id", receiptId);
      }
    }
    if (requests[ref.requestId] === undefined) bad("request-missing", ref.requestId);
    const context = contexts.contexts[ref.contextId];
    if (context === undefined) bad("context-missing", ref.contextId);
    else if (context.seed !== ref.seed) bad("seed-mismatch", `reference seed ${ref.seed}, context seed ${context.seed}`);
    const recorded = manifest.identities[id];
    if (recorded === undefined) bad("identity-missing", id);
    else if (recorded !== referenceIdentity(ref, requests, contexts, cache)) bad("identity-mismatch", "request, context, world, seed or value differs from the identity recorded for the proof");
    if (problems.length === before) verified.add(id);
  }
  return { verified, problems };
}
