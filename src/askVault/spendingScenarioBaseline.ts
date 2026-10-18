/**
 * M3 baseline read: the three whole calendar months before this month, for one category across the household, read through the
 * existing validated version 2 Ask the Vault snapshot. The native engine stays the authority for what counts as spending and for
 * which months are complete; this module only asks, checks that the reply is exactly what was asked, and keeps all three months.
 * It never uses the reply's rounded average, and it hands nothing back that is not for the source the app is on right now.
 */
import { dateParts, daysInMonth, isoDate } from "./calendar";
import { explainFailure } from "./controller";
import type { AskVaultSnapshotV2 } from "./contractV2";
import type { AskVaultSnapshot } from "./contract";
import { baselineMonths, scenarioBaselineProblem, ScenarioInputError } from "./spendingScenarioMath";
import type { ScenarioBaseline, ScenarioBaselineMonth, ScenarioSource } from "./spendingScenarioContract";
import type { AskDataRevision, AskVaultRequest, AskVaultRequestV2 } from "./types";

export const BASELINE_UNREADABLE = "The app received an incomplete answer. Ask again.";

/**
 * A small, existing v1 read establishes global source freshness without repeating month-coverage work.
 * Its amount is never used or displayed. Native expectedRevision still guards the reviewed financial data.
 */
export function scenarioSourceRequest(category: string, asOf: string, expectedRevision: AskDataRevision): AskVaultRequest {
  return {
    kind: "total", periods: [{ from: asOf, to: asOf }], accountIds: [], categories: [category],
    minimumPurchase: null, vendors: [], excludeVendors: [], excludeCategories: [], limit: 1, expectedRevision,
  };
}

/** Only call with a financial-client-validated reply; keep a copy of its global source identity. */
export function scenarioSourceFromSnapshot(reply: AskVaultSnapshot | AskVaultSnapshotV2): ScenarioSource {
  return { generation: reply.context.generation, sessionRevision: reply.context.sessionRevision, revision: { ...reply.revision }, asOf: reply.asOf };
}

/** The exact request for the baseline: neutral household-wide filters, one category, month rows. No question text is in it. */
export function baselineRequest(category: string, asOf: string, expectedRevision: AskDataRevision | null): AskVaultRequestV2 {
  const months = baselineMonths(asOf);
  const last = dateParts(`${months[2]}-01`);
  return {
    contractVersion: 2,
    kind: "total",
    periods: [{ from: `${months[0]}-01`, to: isoDate(last.y, last.m, daysInMonth(last.y, last.m)) }],
    accountIds: [],
    categories: [category],
    members: { ids: [], unassigned: false },
    minimumPurchase: null,
    vendors: [],
    excludeVendors: [],
    excludeCategories: [],
    limit: 1,
    groupBy: "month",
    average: "per-month",
    alignment: "as-requested",
    expectedRevision,
  };
}

const sameDay = (a: string, b: string) => a === b;

/**
 * The baseline a reply carries. All three month rows are kept, complete or not, so the screen can show every month and why one was
 * left out. Throws when the reply is not the version 2 total for exactly the three months asked.
 */
export function baselineFromSnapshot(reply: AskVaultSnapshotV2 | AskVaultSnapshot, request: AskVaultRequestV2): ScenarioBaseline {
  const bad = (why: string): never => {
    throw new ScenarioInputError(why);
  };
  if (!reply || typeof reply !== "object" || reply.contractVersion !== 2 || reply.kind !== "total") return bad("The baseline reply is not a version 2 total.");
  if (!Array.isArray(reply.periods) || reply.periods.length !== 1) return bad("The baseline reply must have one period.");
  const [period] = reply.periods;
  const asked = request.periods[0];
  if (!sameDay(period.from, asked.from) || !sameDay(period.to, asked.to)) return bad("The baseline reply is for a different range.");
  if (!Array.isArray(period.months) || period.months.length !== 3) return bad("The baseline reply must have three months.");
  const baseline: ScenarioBaseline = {
    kind: "recorded",
    months: period.months.map((row) => ({ month: row.month, total: row.total, coverage: row.coverage })) as [ScenarioBaselineMonth, ScenarioBaselineMonth, ScenarioBaselineMonth],
    source: scenarioSourceFromSnapshot(reply),
  };
  const problem = scenarioBaselineProblem(baseline, false);
  if (problem) return bad(problem);
  // The range asked for must be the three months before the reply's own date, so a reply that crossed midnight is not accepted.
  const expected = baselineRequest("x", reply.asOf, null).periods[0];
  if (!sameDay(expected.from, asked.from) || !sameDay(expected.to, asked.to)) return bad("The baseline reply is for another date.");
  return baseline;
}

/** True only when every part of the source is identical: session, both data revisions and the date. */
export function sameScenarioSource(a: ScenarioSource | null, b: ScenarioSource | null): boolean {
  return (
    !!a &&
    !!b &&
    a.generation === b.generation &&
    a.sessionRevision === b.sessionRevision &&
    a.revision.local === b.revision.local &&
    a.revision.external === b.revision.external &&
    a.asOf === b.asOf
  );
}

export type ScenarioBaselineResult =
  | { status: "baseline"; baseline: ScenarioBaseline }
  /** The profile, data, date or request moved on; nothing is shown. A message is present when the person should be told why. */
  | { status: "stale"; message?: string }
  | { status: "error"; message: string };

export type ScenarioBaselineClient = { askVault: (request: AskVaultRequestV2) => Promise<AskVaultSnapshotV2 | AskVaultSnapshot> };

/**
 * Read the baseline for one category. `currentSource` is the app's live session, revisions and date; it is read before and after
 * the await and the result is dropped if anything differs, if the read was cancelled, or if the reply is for another source.
 */
export async function readScenarioBaseline(args: {
  category: string;
  client: ScenarioBaselineClient;
  currentSource: () => ScenarioSource | null;
  signal?: AbortSignal;
}): Promise<ScenarioBaselineResult> {
  const { category, client, currentSource, signal } = args;
  // A copy, not the provider's own object: an update made in place during the await must not move this reference point.
  const live = currentSource();
  const started = live && { ...live, revision: { ...live.revision } };
  if (!started || signal?.aborted) return { status: "stale" };
  const request = baselineRequest(category, started.asOf, started.revision);
  let reply: AskVaultSnapshotV2 | AskVaultSnapshot;
  try {
    reply = await client.askVault(request);
  } catch (failure) {
    if (signal?.aborted || !sameScenarioSource(started, currentSource())) return { status: "stale" };
    return explainFailure(failure);
  }
  if (signal?.aborted) return { status: "stale" };
  let baseline: ScenarioBaseline;
  try {
    baseline = baselineFromSnapshot(reply, request);
  } catch {
    return sameScenarioSource(started, currentSource()) ? { status: "error", message: BASELINE_UNREADABLE } : { status: "stale" };
  }
  const now = currentSource();
  if (!sameScenarioSource(started, now) || !sameScenarioSource(baseline.source, now)) return { status: "stale" };
  return { status: "baseline", baseline };
}
