import type { ContextBundle, EvidenceManifest } from "./nativeEvidence";
/** M6 test-only evidence types. Authority: Validation-Plan VP-03..08. Never imported by production. */
export type Population = "P-CORE" | "P-LT" | "P-NC" | "P-ID" | "P-UNSAFE" | "P-OOS" | "P-NR";
export type Requirement = { seed: number; contextId: string; requestId: string | null; referenceId: string | null;
  requiresConsent?: boolean; stop?: "refusal" | "clarification" | "history-choice"; choices?: string[] };
export type CorpusCase = { id: string; text: string; population: Population; family: string; cluster: string; tags: string[]; required: Requirement[] };
export type Reference = { value: unknown; seed: number; contextId: string; requestId: string; nativeReceipt?: string };
export type Observation = { caseId: string; seed: number; contextId: string; stage: "result" | "refusal" | "clarify" | "history-choice" | "draft" | "error";
  meaningChoices: number; offeredChoices?: string[]; accepted: { request: unknown; result: unknown }[];
  request?: unknown; result?: unknown; reviewed: boolean; consented: boolean };
/** "corpus" evidence is verified against real proof bytes; "unit-stand-in" is deliberately fabricated test evidence and can never pass acceptance. */
export type EvidenceMode = { kind: "unit-stand-in" } | { kind: "corpus"; proofs: Record<string,string>; manifest: EvidenceManifest; contexts: ContextBundle };
/** D-R2 (owner, 2026-10-21): the observation made AFTER the person clicked the approved choice of a store-typo clarification, for the separate family-resolution measure only. */
export type ResolutionObservation = Observation & { chosen: string; readsBeforeChoice: number };
/** D-R2: for ONE family, which original cases may be resolved by a click, and on which approved candidate; the direct metric never reads this. */
export type FamilyResolutionAmendment = { family: string; thresholdPercent: number; approvedChoices: Record<string, string> };
/** D-R3: an alternate request (with its own linked reference per seed) that is accepted for one original case beside the original gold. */
export type AlternateRequest = { caseId: string; perSeed: { seed: number; contextId: string; requestId: string; referenceId: string }[] };
export type Amendments = { familyResolution?: FamilyResolutionAmendment; alternates?: AlternateRequest[] };
/** Task 7 (D-8, CG-04): one individually reviewed realistic error, from realisticErrors.json. The floor counts these, never raw tags. */
export type ReviewedRealisticError = { id: string; text: string; class: string; rationale: string; justification?: string };
export type GradingInput = { cases: CorpusCase[]; requests: Record<string,unknown>; references: Record<string,Reference>;
  observations: Observation[]; requiredFamilies: string[]; evidence: EvidenceMode; routingObservations?: RoutingObservation[];
  amendments?: Amendments; resolutionObservations?: ResolutionObservation[]; reviewedRealisticErrors?: ReviewedRealisticError[] };
/** Nonfinancial M5 route-noninterference obligations; never supply either numeric corpus floor. */
export type RoutingObservation = { caseId: string; actualRoute: string; retirementReads: number };
