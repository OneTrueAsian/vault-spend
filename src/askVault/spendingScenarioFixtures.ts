/**
 * Fictional data for the M3 answer screen: the same figures as the hand-derived anchors in M3/Worked-Examples.md, with results
 * produced by the real calculator. Used by the screen's tests and by previews before the scenario controller exists.
 */
import { calculateSpendingScenario } from "./spendingScenarioMath";
import type { AskMonthCoverage } from "./contractV2";
import type {
  ConfirmedSpendingScenario,
  ScenarioBaseline,
  ScenarioSource,
  SpendingScenarioDraft,
  SpendingScenarioIntent,
} from "./spendingScenarioContract";

export const FIXTURE_TODAY = "2026-10-15";
export const fixtureSource: ScenarioSource = { generation: 1, sessionRevision: 1, revision: { local: 1, external: 1 }, asOf: FIXTURE_TODAY };

export function fixtureBaseline(rows: [string, AskMonthCoverage][] = [["300", "complete"], ["330", "complete"], ["270", "complete"]]): ScenarioBaseline {
  const months = ["2026-07", "2026-08", "2026-09"];
  return { kind: "recorded", source: fixtureSource, months: rows.map(([total, coverage], i) => ({ month: months[i], total, coverage })) as never };
}

export const shortHistoryBaseline = () => fixtureBaseline([["120", "complete"], ["0", "no-records"], ["180", "complete"]]);
export const noHistoryBaseline = () => fixtureBaseline([["0", "no-records"], ["0", "no-records"], ["0", "no-records"]]);

export function fixtureIntent(over: Partial<SpendingScenarioIntent> = {}): SpendingScenarioIntent {
  return {
    version: 1,
    category: "Dining",
    reduction: { kind: "money", amount: "50" },
    cadence: "monthly",
    horizon: { kind: "prospective", from: "2026-11-01", to: "2026-12-31" },
    partialMonth: "exclude",
    ...over,
  };
}

/** "Save $50 on Dining this year": cadence, dates and the part-month rule are all still open. */
export function fixtureDraft(over: Partial<SpendingScenarioDraft> = {}): SpendingScenarioDraft {
  return {
    sourceText: "how much would I save this year if I spent $50 less on Dining",
    category: "Dining",
    reduction: { kind: "money", amount: "50" },
    cadence: null,
    horizon: null,
    partialMonth: null,
    missing: ["cadence", "horizon", "partial-month"],
    ...over,
  };
}

export function fixtureConfirmed(intent = fixtureIntent(), baseline: ScenarioBaseline = fixtureBaseline()): ConfirmedSpendingScenario {
  return { intent, baseline, confirmed: true };
}

export function fixturePreview(intent = fixtureIntent(), baseline: ScenarioBaseline = fixtureBaseline()) {
  const result = calculateSpendingScenario(fixtureConfirmed(intent, baseline));
  if (result.kind !== "preview") throw new Error("The fixture does not produce a preview.");
  return result;
}

export const fixtureOnce = () => fixtureIntent({ cadence: "once", reduction: { kind: "money", amount: "25" }, horizon: { kind: "prospective", from: "2026-10-20", to: "2026-10-20" }, partialMonth: "none" });
export const fixturePartMonth = () => fixtureIntent({ horizon: { kind: "prospective", from: "2026-10-15", to: "2026-12-31" }, partialMonth: "prorate" });
