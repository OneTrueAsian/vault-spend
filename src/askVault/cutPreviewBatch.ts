import type { AskDataRevision } from "./types";
import type { AskVaultSnapshotV2 } from "./contractV2";
import { TransactionError } from "../transactionContracts";
import { date, integer } from "../contractChecks";
import { dateOutOfRange } from "../dateRange";
import { validateAskVaultSnapshot } from "./contract";
import { baselineRequest, sameScenarioSource, scenarioSourceFromSnapshot } from "./spendingScenarioBaseline";

export type AskBaselineBatchRequest = { contractVersion: 1; categories: string[]; expectedRevision: AskDataRevision | null };
export type AskBaselineBatchSnapshot = {
  contractVersion: 1;
  context: { generation: number; sessionRevision: number };
  revision: AskDataRevision;
  asOf: string;
  baselines: { category: string; snapshot: AskVaultSnapshotV2 }[];
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(k => Object.prototype.hasOwnProperty.call(v, k));
const revision = (v: unknown) => record(v) && keys(v, ["local", "external"]) && integer(v.local) && integer(v.external);
export function validateBaselineBatchRequest(value: unknown): AskBaselineBatchRequest {
  if (!record(value) || !keys(value, ["contractVersion", "categories", "expectedRevision"]) || value.contractVersion !== 1 ||
      !Array.isArray(value.categories) || value.categories.length < 1 || value.categories.length > 20 ||
      value.categories.some(c => typeof c !== "string" || !c.trim() || [...c].length > 512) || new Set(value.categories).size !== value.categories.length ||
      (value.expectedRevision !== null && !revision(value.expectedRevision))) {
    throw new TransactionError("invalid_argument", "Choose between 1 and 20 distinct existing categories and a valid data revision.");
  }
  return structuredClone(value) as AskBaselineBatchRequest;
}
export function validateBaselineBatchSnapshot(value: unknown, request: AskBaselineBatchRequest): AskBaselineBatchSnapshot {
  const bad = (): never => { throw new TransactionError("invalid_response", "The app received an incomplete baseline bundle. Ask again."); };
  if (!record(value) || !keys(value, ["contractVersion", "context", "revision", "asOf", "baselines"]) || value.contractVersion !== 1 ||
      !record(value.context) || !keys(value.context, ["generation", "sessionRevision"]) || !integer(value.context.generation) || !integer(value.context.sessionRevision) ||
      !revision(value.revision) || !date(value.asOf) || dateOutOfRange(value.asOf as string) ||
      !Array.isArray(value.baselines) || value.baselines.length !== request.categories.length) return bad();
  const common = { ...(value.context as AskBaselineBatchSnapshot["context"]), revision: value.revision as AskDataRevision, asOf: value.asOf as string };
  if (request.expectedRevision && (common.revision.local !== request.expectedRevision.local || common.revision.external !== request.expectedRevision.external)) return bad();
  for (const [i, row] of value.baselines.entries()) {
    if (!record(row) || !keys(row, ["category", "snapshot"]) || row.category !== request.categories[i]) return bad();
    const snapshot = validateAskVaultSnapshot(row.snapshot, baselineRequest(row.category as string, common.asOf, request.expectedRevision));
    if (snapshot.contractVersion !== 2 || !sameScenarioSource(common, scenarioSourceFromSnapshot(snapshot))) return bad();
  }
  return structuredClone(value) as AskBaselineBatchSnapshot;
}
