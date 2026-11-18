import type { ForecastPoint } from "../../shared/lib/types";

/** The forecast's low point — the day balance bottoms out, so a coming
 * squeeze is visible even when the end of the window looks fine. */
export function lowestPoint(points: ForecastPoint[]): { date: string; balance: number } | null {
  let lowest: { date: string; balance: number } | null = null;
  for (const p of points) {
    const balance = parseFloat(p.balance);
    if (lowest === null || balance < lowest.balance) lowest = { date: p.date, balance };
  }
  return lowest;
}
