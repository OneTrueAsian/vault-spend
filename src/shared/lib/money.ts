/** Adds money amounts (the backend's decimal strings, or numbers) in whole cents, so a page-side total
 * matches what exact decimal arithmetic gives instead of drifting like summed floats. A blank or
 * non-numeric value counts as zero. */
export function sumMoney(values: Iterable<string | number>): number {
  let cents = 0;
  for (const value of values) {
    const n = typeof value === "number" ? value : parseFloat(value.replace(/[$,]/g, ""));
    if (Number.isFinite(n)) cents += Math.round(n * 100);
  }
  return cents / 100;
}
