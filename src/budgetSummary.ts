import { formatAmount } from "./format";

/** The progress line in a Budget group's heading, e.g. "$2,300.00 of $3,607.00 · 64% used".
 * Income reads the other way round (coming in, not going out), so it says what was received.
 * With nothing budgeted there is no percentage to give, so it says that instead of "NaN%". */
export function groupProgressLabel(group: "income" | string, actual: number, budgeted: number): string {
  const isIncome = group === "income";
  if (!(budgeted > 0)) return `${formatAmount(actual)} ${isIncome ? "received" : "spent"}, no budget set`;
  const amounts = `${formatAmount(actual)} of ${formatAmount(budgeted)}`;
  if (isIncome) return `${amounts} received`;
  const pct = (actual / budgeted) * 100;
  // Same thresholds the old group tiles used: anything past 100% is over, and from 99.5% up to
  // exactly 100% reads as on target. Compared in cents so float noise can't tip 100% over.
  if (Math.round(actual * 100) > Math.round(budgeted * 100)) return `${amounts} · Over budget`;
  if (pct >= 99.5) return `${amounts} · On target`;
  return `${amounts} · ${pct.toFixed(0)}% used`;
}
