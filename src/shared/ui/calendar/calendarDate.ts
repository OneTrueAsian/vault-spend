/** Pure Gregorian date arithmetic for the date and month pickers. Dates are plain {year, month, day}
 * records and are never converted through a local-midnight `Date`, so a time zone or a daylight-saving
 * change cannot move a stored date. Nothing here mutates its input. */

export type DateRecord = { year: number; month: number; day: number };
export type MonthRecord = { year: number; month: number };

/** The dates the app accepts anywhere a date is entered (the backend refuses the same range). */
export const MIN_DATE: DateRecord = { year: 1900, month: 1, day: 1 };
export const MAX_DATE: DateRecord = { year: 2100, month: 12, day: 31 };

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** A strict "YYYY-MM-DD" naming a real Gregorian date, or null. */
export function parseIso(iso: string): DateRecord | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const record = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (record.year < 1 || record.month < 1 || record.month > 12) return null;
  if (record.day < 1 || record.day > daysInMonth(record.year, record.month)) return null;
  return record;
}

export function formatIso(r: DateRecord): string {
  return `${pad(r.year, 4)}-${pad(r.month, 2)}-${pad(r.day, 2)}`;
}

export function parseIsoMonth(iso: string): MonthRecord | null {
  const m = /^(\d{4})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const record = { year: Number(m[1]), month: Number(m[2]) };
  return record.year < 1 || record.month < 1 || record.month > 12 ? null : record;
}

export function formatIsoMonth(r: MonthRecord): string {
  return `${pad(r.year, 4)}-${pad(r.month, 2)}`;
}

export function compareDates(a: DateRecord, b: DateRecord): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function compareMonths(a: MonthRecord, b: MonthRecord): number {
  return a.year - b.year || a.month - b.month;
}

/** Days since 1970-01-01 (proleptic Gregorian; Howard Hinnant's days_from_civil). */
function toDayNumber({ year, month, day }: DateRecord): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDayNumber(days: number): DateRecord {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

export function addDays(r: DateRecord, days: number): DateRecord {
  return fromDayNumber(toDayNumber(r) + days);
}

/** Moves by whole months; a day that does not exist in the target month becomes its last day. */
export function addMonths(r: DateRecord, months: number): DateRecord {
  const index = r.year * 12 + (r.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12 + 12) % 12 + 1;
  return { year, month, day: Math.min(r.day, daysInMonth(year, month)) };
}

export function addYears(r: DateRecord, years: number): DateRecord {
  return addMonths(r, years * 12);
}

export function addMonthRecords(r: MonthRecord, months: number): MonthRecord {
  const { year, month } = addMonths({ ...r, day: 1 }, months);
  return { year, month };
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(r: DateRecord): number {
  return (((toDayNumber(r) + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

/** The first and last day of the week containing `r`, for a week that starts on `firstDay` (0 = Sunday). */
export function startOfWeek(r: DateRecord, firstDay: number): DateRecord {
  return addDays(r, -((weekdayOf(r) - firstDay + 7) % 7));
}

export function endOfWeek(r: DateRecord, firstDay: number): DateRecord {
  return addDays(startOfWeek(r, firstDay), 6);
}

export type DateBounds = { min: DateRecord; max: DateRecord; empty: boolean };
export type MonthBounds = { min: MonthRecord; max: MonthRecord; empty: boolean };

/** The caller's min/max intersected with the app's 1900-2100 range. A bound that is not a real date, or
 * bounds that leave nothing selectable, give `empty: true`; bounds are never swapped or guessed. */
export function resolveBounds(min: string | undefined, max: string | undefined): DateBounds {
  const lo = min === undefined || min === "" ? MIN_DATE : parseIso(min);
  const hi = max === undefined || max === "" ? MAX_DATE : parseIso(max);
  if (!lo || !hi) return { min: MIN_DATE, max: MAX_DATE, empty: true };
  const bounds = { min: compareDates(lo, MIN_DATE) < 0 ? MIN_DATE : lo, max: compareDates(hi, MAX_DATE) > 0 ? MAX_DATE : hi };
  return { ...bounds, empty: compareDates(bounds.min, bounds.max) > 0 };
}

export function dateInBounds(r: DateRecord, bounds: DateBounds): boolean {
  return !bounds.empty && compareDates(r, bounds.min) >= 0 && compareDates(r, bounds.max) <= 0;
}

/** The nearest date inside the bounds, or null when nothing is selectable. */
export function clampDate(r: DateRecord, bounds: DateBounds): DateRecord | null {
  if (bounds.empty) return null;
  if (compareDates(r, bounds.min) < 0) return bounds.min;
  if (compareDates(r, bounds.max) > 0) return bounds.max;
  return r;
}

const FIRST_MONTH: MonthRecord = { year: 1, month: 1 };
const LAST_MONTH: MonthRecord = { year: 9999, month: 12 };

/** Month bounds are the caller's own (a month field has no global cap beyond four-digit years). */
export function resolveMonthBounds(min: string | undefined, max: string | undefined): MonthBounds {
  const lo = min === undefined || min === "" ? FIRST_MONTH : parseIsoMonth(min);
  const hi = max === undefined || max === "" ? LAST_MONTH : parseIsoMonth(max);
  if (!lo || !hi) return { min: FIRST_MONTH, max: LAST_MONTH, empty: true };
  return { min: lo, max: hi, empty: compareMonths(lo, hi) > 0 };
}

export function monthInBounds(r: MonthRecord, bounds: MonthBounds): boolean {
  return !bounds.empty && compareMonths(r, bounds.min) >= 0 && compareMonths(r, bounds.max) <= 0;
}

export function clampMonth(r: MonthRecord, bounds: MonthBounds): MonthRecord | null {
  if (bounds.empty) return null;
  if (compareMonths(r, bounds.min) < 0) return bounds.min;
  if (compareMonths(r, bounds.max) > 0) return bounds.max;
  return r;
}

/** Today's date on the local calendar. */
export function localToday(now: Date = new Date()): DateRecord {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}
