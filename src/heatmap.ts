/** Pure layout math for the Reports page's daily-spend heatmap: lays a
 * list of (date, amount) totals out as whole Sunday–Saturday weeks
 * covering a range, and buckets an amount into a color-intensity step.
 * Kept free of React/DOM so both can be unit tested directly. */

export type DailyAmount = { date: string; amount: number };

export type HeatmapDay = {
  /** "YYYY-MM-DD". */
  date: string;
  /** Spending that day, as a positive number — 0 for a day with none, and
   * for any padding day outside the requested range. */
  amount: number;
  /** False for a padding day added to fill out a partial week at either
   * end of the range (the grid always draws whole weeks). */
  inRange: boolean;
};

export type HeatmapWeek = HeatmapDay[];

// Calendar-date arithmetic done entirely in UTC-day-index space so it never
// drifts with the viewer's timezone or DST — the same reasoning
// `toLocalIsoDate` documents for wall-clock "today", except here the dates
// are already plain calendar strings, not a `Date` read from the clock.
function dayIndex(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}
function isoOfDayIndex(idx: number): string {
  const d = new Date(idx * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function weekdayOfDayIndex(idx: number): number {
  return new Date(idx * 86400000).getUTCDay(); // 0 = Sunday .. 6 = Saturday
}

/** Lays `daily` out as full Sunday-first weeks spanning `from`..`to`
 * (inclusive, both "YYYY-MM-DD"), padded at both ends so every week has
 * exactly 7 days. Returns `[]` if `to` is before `from`. */
export function buildHeatmapWeeks(daily: DailyAmount[], from: string, to: string): HeatmapWeek[] {
  const fromIdx = dayIndex(from);
  const toIdx = dayIndex(to);
  if (toIdx < fromIdx) return [];

  const amountByDate = new Map(daily.map((d) => [d.date, d.amount]));
  const startIdx = fromIdx - weekdayOfDayIndex(fromIdx);
  const endIdx = toIdx + (6 - weekdayOfDayIndex(toIdx));

  const weeks: HeatmapWeek[] = [];
  for (let weekStart = startIdx; weekStart <= endIdx; weekStart += 7) {
    const week: HeatmapDay[] = [];
    for (let i = 0; i < 7; i++) {
      const idx = weekStart + i;
      const date = isoOfDayIndex(idx);
      const inRange = idx >= fromIdx && idx <= toIdx;
      week.push({ date, amount: inRange ? (amountByDate.get(date) ?? 0) : 0, inRange });
    }
    weeks.push(week);
  }
  return weeks;
}

/** Which of `bucketCount` color steps `amount` falls into, relative to
 * `max` (the biggest single day in the range being shown) — 0 always means
 * "no spending" (kept as its own step rather than the bottom of the
 * proportional scale, so a $0.01 day and a $0 day don't render
 * identically). Steps 1..bucketCount-1 divide `(0, max]` evenly. */
export function heatmapBucket(amount: number, max: number, bucketCount = 5): number {
  if (amount <= 0 || max <= 0) return 0;
  const frac = Math.min(amount / max, 1);
  return Math.max(1, Math.min(bucketCount - 1, Math.ceil(frac * (bucketCount - 1))));
}
