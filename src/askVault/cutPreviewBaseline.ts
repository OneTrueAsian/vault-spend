import type { ReadCutPreviewBaselines } from "./cutPreviewContract";
import { readScenarioBaseline, sameScenarioSource, baselineFromSnapshot, baselineRequest } from "./spendingScenarioBaseline";
import { validateBaselineBatchSnapshot } from "./cutPreviewBatch";
import { explainFailure } from "./controller";
import { scenarioBaselineProblem } from "./spendingScenarioMath";
import type { ScenarioSource } from "./spendingScenarioContract";
import { dateOutOfRange } from "../dateRange";

/** Abort the wait, not the native command. Its late settlement is always observed and discarded. */
function cancellable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); resolve(null); };
    signal.addEventListener("abort", abort, { once: true });
    work.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

/** Baseline evidence only: never computes means, accepts short history or confirms a scenario. */
export const readCutPreviewBaselines: ReadCutPreviewBaselines = async ({ categories, client, currentSource, signal }) => {
  const live = currentSource();
  if (!live || signal?.aborted) return { status: "stale" };
  if (!Array.isArray(categories) || categories.length < 1 || categories.length > 20 || categories.some(c => typeof c !== "string" || !c.trim()) || new Set(categories).size !== categories.length) {
    return { status: "error", message: "Choose between 1 and 20 distinct existing categories." };
  }
  const labels = [...categories];
  const started: ScenarioSource = structuredClone(live);
  if (scenarioBaselineProblem({ kind: "manual", monthlyAmount: "0", source: started }, false) || dateOutOfRange(started.asOf)) return { status: "error", message: "Refresh the profile and current date before reading baselines." };
  const fresh = () => !signal?.aborted && sameScenarioSource(started, currentSource());
  if (client.askVaultBaselines) {
    const request = { contractVersion: 1 as const, categories: labels, expectedRevision: { ...started.revision } };
    try {
      const raw = await cancellable(client.askVaultBaselines(request), signal);
      if (!fresh() || raw === null) return { status: "stale" };
      const result = validateBaselineBatchSnapshot(raw, request);
      const baselines = result.baselines.map(row => ({ category: row.category, baseline: baselineFromSnapshot(row.snapshot, baselineRequest(row.category, started.asOf, started.revision)) }));
      if (!fresh() || baselines.some(row => !sameScenarioSource(row.baseline.source, started))) return { status: "stale" };
      return { status: "baseline", baselines, source: structuredClone(started) };
    } catch (failure) {
      return fresh() ? explainFailure(failure) : { status: "stale" };
    }
  }
  const baselines = [];
  for (const category of labels) {
    if (!fresh()) return { status: "stale" };
    const result = await cancellable(readScenarioBaseline({ category, client, currentSource: () => fresh() ? started : null, signal }), signal);
    if (!fresh() || result === null) return { status: "stale" };
    if (result.status !== "baseline") return result;
    if (!sameScenarioSource(started, result.baseline.source)) return { status: "stale" };
    baselines.push({ category, baseline: structuredClone(result.baseline) });
  }
  return { status: "baseline", baselines, source: structuredClone(started) };
};
