/** Pure allocation math for the Investments page: where the portfolio sits
 * against the mix the user wants. Kept out of the component so it can be unit
 * tested without rendering anything. */

/** A class this many percentage points off its target is worth a nudge. */
export const DRIFT_ALERT_POINTS = 5;

export type AllocationRow = {
  assetClass: string;
  /** Dollars held in the class. */
  value: number;
  /** Share of the whole portfolio, 0-100. */
  currentPct: number;
  /** The wanted share, `null` when no target was set for the class. */
  targetPct: number | null;
  /** Current minus target in percentage points (positive = overweight);
   * `null` when there's no target to drift from. */
  driftPoints: number | null;
};

/** One row per asset class held or targeted, biggest holding first
 * (targeted-but-empty classes last). Holdings with no class count as "Other". */
export function allocationRows(
  holdings: { asset_class: string | null; value: string }[],
  targets: { asset_class: string; percent: string }[],
): AllocationRow[] {
  const valueByClass = new Map<string, number>();
  for (const holding of holdings) {
    const key = holding.asset_class ?? "Other";
    valueByClass.set(key, (valueByClass.get(key) ?? 0) + (parseFloat(holding.value) || 0));
  }
  const total = [...valueByClass.values()].reduce((sum, v) => sum + v, 0);
  const targetByClass = new Map(targets.map((tgt) => [tgt.asset_class, parseFloat(tgt.percent) || 0]));

  const classes = new Set([...valueByClass.keys(), ...targetByClass.keys()]);
  const rows: AllocationRow[] = [...classes].map((assetClass) => {
    const value = valueByClass.get(assetClass) ?? 0;
    const currentPct = total > 0 ? (value / total) * 100 : 0;
    const targetPct = targetByClass.get(assetClass) ?? null;
    return { assetClass, value, currentPct, targetPct, driftPoints: targetPct === null ? null : currentPct - targetPct };
  });
  rows.sort((a, b) => b.value - a.value || a.assetClass.localeCompare(b.assetClass));
  return rows;
}

export type DriftStatus = "none" | "ok" | "over" | "under";

export function driftStatus(driftPoints: number | null): DriftStatus {
  if (driftPoints === null) return "none";
  if (driftPoints >= DRIFT_ALERT_POINTS) return "over";
  if (driftPoints <= -DRIFT_ALERT_POINTS) return "under";
  return "ok";
}

/** What the targets add up to — anything other than 100 means the mix isn't fully spoken for. */
export function targetsTotal(targets: { percent: string }[]): number {
  return targets.reduce((sum, tgt) => sum + (parseFloat(tgt.percent) || 0), 0);
}
