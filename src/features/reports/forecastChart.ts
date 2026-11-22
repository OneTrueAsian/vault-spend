import { shortMonthDay } from "../../shared/lib/format";

/** The Cash Flow forecast's chart points. LineChart draws one axis label per point with no thinning of
 * its own, and a forecast has 30-366 daily points, so only about 8 points are labelled ("Oct 4",
 * like every chart axis); every point still draws the line and the tooltip. */
/** The Forecast tab's choices. "6 months" and "12 months" are the days from `today` to the same date that many
 * months ahead (the last day of a shorter month), so a yearly bill due on today's date still lands (VS-45). */
export function forecastHorizons(today: Date): { label: string; days: number }[] {
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const monthsAhead = (n: number) => {
    const lastDay = new Date(Date.UTC(today.getFullYear(), today.getMonth() + n + 1, 0)).getUTCDate();
    return Math.round((Date.UTC(today.getFullYear(), today.getMonth() + n, Math.min(today.getDate(), lastDay)) - start) / 86_400_000);
  };
  return [
    ...[30, 60, 90].map((days) => ({ label: `${days} days`, days })),
    { label: "6 months", days: monthsAhead(6) },
    { label: "12 months", days: monthsAhead(12) },
  ];
}

export function forecastChartPoints(points: { date: string; balance: string }[]): { label: string; value: number }[] {
  const every = Math.max(1, Math.ceil(points.length / 8));
  return points.map((p, i) => ({ label: i % every === 0 ? shortMonthDay(p.date) : "", value: parseFloat(p.balance) }));
}
