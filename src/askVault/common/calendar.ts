/** Calendar arithmetic on "YYYY-MM-DD" strings for the Ask the Vault answer checks. Pure; no clock, no time zones. */

import type { AskAlignment, PeriodRange } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const dateParts = (s: string) => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) });

/** Inclusive number of days in a range. */
export const dayCount = (r: PeriodRange) => Math.round((Date.parse(r.to + "T00:00:00Z") - Date.parse(r.from + "T00:00:00Z")) / 86_400_000) + 1;

/** Every calendar month a range touches, in date order, with the part of the month that lies inside the range. */
export function monthsTouching(range: PeriodRange): { month: string; start: string; end: string; from: string; to: string }[] {
  const first = dateParts(range.from);
  const last = dateParts(range.to);
  const out: { month: string; start: string; end: string; from: string; to: string }[] = [];
  for (let y = first.y, m = first.m; y < last.y || (y === last.y && m <= last.m); m === 12 ? (y++, (m = 1)) : m++) {
    const start = isoDate(y, m, 1);
    const end = isoDate(y, m, daysInMonth(y, m));
    out.push({ month: start.slice(0, 7), start, end, from: start < range.from ? range.from : start, to: end > range.to ? range.to : end });
  }
  return out;
}

export type Clamp = { requestedDays: number; usedDays: number };

/**
 * The earlier range an alignment asks for, or null when `range` has the wrong shape for it.
 * "same-days-previous-month" needs a range that starts on the 1st and stays inside its month; it maps to the same day numbers of the
 * month before, stopping at that month's last day. "same-days-previous-year" moves both ends back one calendar year (29 February
 * becomes 28 February).
 */
export function alignedPrior(range: PeriodRange, alignment: AskAlignment): { range: PeriodRange; clamped: Clamp | null } | null {
  const a = dateParts(range.from);
  const b = dateParts(range.to);
  if (alignment === "same-days-previous-month") {
    if (!(a.y === b.y && a.m === b.m && a.d === 1)) return null;
    const prev = a.m === 1 ? { y: a.y - 1, m: 12 } : { y: a.y, m: a.m - 1 };
    const day = Math.min(b.d, daysInMonth(prev.y, prev.m));
    return { range: { from: isoDate(prev.y, prev.m, 1), to: isoDate(prev.y, prev.m, day) }, clamped: day < b.d ? { requestedDays: b.d, usedDays: day } : null };
  }
  if (alignment === "same-days-previous-year") {
    const back = (x: { y: number; m: number; d: number }) => isoDate(x.y - 1, x.m, Math.min(x.d, daysInMonth(x.y - 1, x.m)));
    const earlier = { from: back(a), to: back(b) };
    return { range: earlier, clamped: dayCount(earlier) < dayCount(range) ? { requestedDays: dayCount(range), usedDays: dayCount(earlier) } : null };
  }
  return null;
}
