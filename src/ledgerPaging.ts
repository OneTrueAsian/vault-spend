/** The Transactions tab shows its matching rows a step at a time ("Show 50 more") instead of in
 * numbered pages. Counts always cover every matching row, never only the ones shown. */

/** The "at a time" choices. */
export const LEDGER_STEPS = [25, 50, 100] as const;

const n = (value: number) => value.toLocaleString("en-US");

/** "Showing 50 of 1,200 transactions", or "Showing all 1,200 transactions". */
export function ledgerShownLabel(shown: number, total: number): string {
  if (total === 1) return "Showing 1 transaction";
  return shown >= total ? `Showing all ${n(total)} transactions` : `Showing ${n(shown)} of ${n(total)} transactions`;
}

/** The "Show N more" button's label, or `null` once every matching row shows. */
export function showMoreLabel(shown: number, total: number, step: number): string | null {
  if (shown >= total) return null;
  return `Show ${n(Math.min(step, total - shown))} more`;
}

/** How many rows to show so the row at `index` is among them: whole steps, never fewer than now. */
export function rowsToShowFor(index: number, shown: number, step: number): number {
  return Math.max(shown, Math.ceil((index + 1) / step) * step);
}
