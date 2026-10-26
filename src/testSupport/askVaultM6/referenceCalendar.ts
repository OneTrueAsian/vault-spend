// Source-attributed test-only copy: M1/acceptance/calendar.ts
// Original SHA256: 1079bcc2b3180f96121ed23099704ed59461f2a6ce2d909b0e8b57c2b57db3c1
// M6 extension: M1 leave-out rules; no production imports or financial formula changes.
// Independent calendar arithmetic for the acceptance corpus.
// It must NOT import anything from the app: the production date reader is graded against these rules,
// which come from the plan's contract (calendar periods run through today when still under way; a bare
// month is its most recent occurrence unless the records hold it twice; "the past N months" runs from the
// same day N months back through today; weeks run Sunday to Saturday as the existing matcher does).

export type Range = { from: string; to: string };

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const parts = (s: string) => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) });
export const addDays = (s: string, n: number) => {
  const { y, m, d } = parts(s);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A calendar span ending at `end`, clipped to today when it is still under way. */
export function clip(from: string, end: string, today: string): Range {
  return { from, to: end > today ? today : end };
}

export function monthRange(y: number, m: number, today: string): Range {
  return clip(iso(y, m, 1), iso(y, m, daysIn(y, m)), today);
}

export function shiftMonth(y: number, m: number, back: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) - back;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

export function lastMonth(today: string): Range {
  const t = parts(today);
  const s = shiftMonth(t.y, t.m, 1);
  return monthRange(s.y, s.m, today);
}

export function thisMonth(today: string): Range {
  const t = parts(today);
  return monthRange(t.y, t.m, today);
}

export function yearRange(y: number, today: string): Range {
  return clip(iso(y, 1, 1), iso(y, 12, 31), today);
}

export function quarterRange(today: string, back: number): Range {
  const t = parts(today);
  const index = t.y * 4 + Math.floor((t.m - 1) / 3) - back;
  const y = Math.floor(index / 4);
  const first = (index % 4) * 3 + 1;
  return clip(iso(y, first, 1), iso(y, first + 2, daysIn(y, first + 2)), today);
}

export function weekRange(today: string, back: number): Range {
  const t = parts(today);
  const weekday = new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay();
  const start = addDays(today, -weekday - back * 7);
  return clip(start, addDays(start, 6), today);
}

export function pastMonths(today: string, n: number): Range {
  const t = parts(today);
  const s = shiftMonth(t.y, t.m, n);
  return { from: iso(s.y, s.m, Math.min(t.d, daysIn(s.y, s.m))), to: today };
}

/** Years in which `month` falls inside the records [historyStart, today]. */
export function yearsHolding(month: number, today: string, historyStart: string): number[] {
  const out: number[] = [];
  const t = parts(today);
  for (let y = parts(historyStart).y; y <= t.y; y++) {
    if (iso(y, month, daysIn(y, month)) >= historyStart && iso(y, month, 1) <= today) out.push(y);
  }
  return out;
}

export function overlapsHistory(r: Range, historyStart: string): boolean {
  return r.to >= historyStart;
}
