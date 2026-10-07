import { shortMonthDay } from "./format";

/** The Cash Flow forecast's chart points. LineChart draws one axis label per point with no thinning of
 * its own, and a forecast has 30-90 daily points, so only about every 8th point is labelled ("Oct 4",
 * like every chart axis); every point still draws the line and the tooltip. */
export function forecastChartPoints(points: { date: string; balance: string }[]): { label: string; value: number }[] {
  const every = Math.max(1, Math.ceil(points.length / 8));
  return points.map((p, i) => ({ label: i % every === 0 ? shortMonthDay(p.date) : "", value: parseFloat(p.balance) }));
}
