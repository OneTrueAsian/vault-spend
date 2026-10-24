import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonical } from "./counting";
import { answer, request as neutral } from "./referenceOracle";
import type { World } from "./referenceWorld";

/**
 * D-R3 (owner, 2026-10-21; Task5-Remediation-Completion/Decisions-Ledger.md): the separate reference calculation for the one actual request the card sends for
 * m1/202-0210 ("what did I spend at Shel or sam's club year to date"): vendors ["shel", "sams club"]. Test-only. The value is produced by the independent
 * oracle (referenceOracle.ts, the copied M2 oracle with the M1 leave-out extension), never by the application and never by copying the application's reply.
 * The oracle answers in the version 2 shape; the frozen ordinary references are the version 1 projection of the same fields, which is what is returned here
 * (verified against the stored gold reference in amendmentReferences.test.ts).
 */
const DIR = __dirname;
const json = <T,>(name: string): T => JSON.parse(readFileSync(`${DIR}/${name}`, "utf8")) as T;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const AMENDED_CASE = "m1/202-0210";
export const ALTERNATE_VENDORS: [string, string] = ["shel", "sams club"];
const V2_ONLY = ["recordedFrom", "recordedThrough", "sharedPurchaseCount", "categoryTotals", "memberTotals", "months", "average"];

type Request = { kind: "total"; periods: { from: string; to: string }[]; vendors: string[]; [k: string]: unknown };
type Contexts = { worlds: Record<string, World>; contexts: Record<string, { seed: number; worldId: string }> };

/** The version 1 reference value for a request over a world, from the independent oracle. */
export function v1ReferenceValue(world: World, req: Request) {
  const v2 = answer(world, neutral({ kind: req.kind, periods: req.periods, vendors: req.vendors, limit: req.limit as number })) as unknown as { asOf: string; kind: string; spendingBasis: string; thresholdBasis: string; periods: Record<string, unknown>[]; difference: unknown };
  return { contractVersion: 1, asOf: v2.asOf, kind: v2.kind, spendingBasis: v2.spendingBasis, thresholdBasis: v2.thresholdBasis,
    periods: v2.periods.map(p => Object.fromEntries(Object.entries(p).filter(([key]) => !V2_ONLY.includes(key)))), difference: v2.difference };
}

/** The alternate requests and references for the amended case, one per required seed, derived only from the original case, its gold request and the oracle. */
export function buildAlternateReferences() {
  const cases = json<{ id: string; required: { seed: number; contextId: string; requestId: string; referenceId: string }[] }[]>("cases.json");
  const gold = json<Record<string, Request>>("expectedRequests.json");
  const contexts = json<Contexts>("contexts.json");
  const c = cases.find(x => x.id === AMENDED_CASE)!;
  const requests: Record<string, unknown> = {}, references: Record<string, unknown> = {};
  const perSeed: { seed: number; contextId: string; requestId: string; referenceId: string }[] = [];
  for (const r of c.required) {
    const base = gold[r.requestId];
    const req: Request = { ...base, vendors: [ALTERNATE_VENDORS[0], ...base.vendors.slice(1)] };
    const requestId = `q-amend-${AMENDED_CASE.replace("/", "-")}`, referenceId = `r-amend-${AMENDED_CASE.replace("/", "-")}-s${r.seed}`;
    requests[requestId] = req;
    references[referenceId] = { value: v1ReferenceValue(contexts.worlds[contexts.contexts[r.contextId].worldId], req), seed: r.seed, contextId: r.contextId, requestId };
    perSeed.push({ seed: r.seed, contextId: r.contextId, requestId, referenceId });
  }
  return { requests, references, perSeed };
}
export const referenceFileSha = () => sha(readFileSync(`${DIR}/amendmentReferences.json`, "utf8"));
export { canonical };
