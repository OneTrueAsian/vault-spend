/** The one shared "$1,234.56" / "-$1,234.56" formatter used everywhere a
 * full (non-abbreviated) dollar amount is displayed — thousands get a
 * comma separator via the locale formatter rather than a hand-rolled
 * regex. For the abbreviated "$1.2k" / "$3.4M" style, see
 * `fmtMoneyShort` in charts.tsx instead. */
export function formatAmount(amount: string | number): string {
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${s}` : `$${s}`;
}

/** `d`'s calendar date (default: right now) as a "YYYY-MM-DD" string, built
 * from local getFullYear/getMonth/getDate — NOT `d.toISOString().slice(0, 9)`,
 * which reads the UTC calendar date and silently shifts by a day for any
 * viewer whose local time and UTC currently fall on different dates (every
 * timezone west of UTC, for part of every day). Use this anywhere a
 * "today" or arbitrary date needs to become the plain date string this
 * app stores/compares elsewhere (`next_date`, `valued_on`, etc). */
export function toLocalIsoDate(d: Date = new Date()): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** A plain decimal number in the shape Rust's `rust_decimal::Decimal`
 * (this app's one money/quantity type end to end) actually accepts: an
 * optional sign, digits, an optional decimal point, an optional exponent.
 * Deliberately stricter than `!isNaN(parseFloat(s))`, which treats
 * "150abc" or "1,500.00" as valid — it only reads a leading numeric
 * prefix and silently ignores the rest. An input that passes this check
 * should never fail server-side with a confusing "invalid amount" error
 * after clearing client-side validation. */
const DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
export function isValidDecimalString(s: string): boolean {
  return DECIMAL_PATTERN.test(s.trim());
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-18" as "Sep 18" — a compact chart-axis label. Anything that isn't a
 * stored date comes back unchanged. */
export function shortMonthDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${MONTH_ABBR[Number(match[2]) - 1]} ${Number(match[3])}`;
}

const STORED_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseStoredDate(iso: string): { year: number; month: number; day: number } | null {
  const match = STORED_DATE.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // A day the month doesn't have (2026-02-30) isn't a stored date.
  if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return null;
  return { year, month, day };
}

/** The one way a date is shown on screen: "Oct 4" for a date in `today`'s year, "Oct 4, 2025" for any
 * other year. Anything that isn't a stored "YYYY-MM-DD" date comes back unchanged. Files the app writes
 * (exports, backups) keep the stored form; this is only for what people read. */
export function formatDisplayDate(iso: string, today: Date = new Date()): string {
  const d = parseStoredDate(iso);
  if (!d) return iso;
  const monthDay = `${MONTH_ABBR[d.month - 1]} ${d.day}`;
  return d.year === today.getFullYear() ? monthDay : `${monthDay}, ${d.year}`;
}

/** "Oct 4, 2026": the date with its year always named, for a date field's resting text (a field is
 * read on its own, without the list around it that tells you which year you're in). */
export function formatFullDate(iso: string): string {
  const d = parseStoredDate(iso);
  if (!d) return iso;
  return `${MONTH_ABBR[d.month - 1]} ${d.day}, ${d.year}`;
}

/** "Jun 2027" from a stored "YYYY-MM-DD" (or "YYYY-MM"). Anything else comes back unchanged. */
export function formatMonthYear(iso: string): string {
  const match = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(iso);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return iso;
  return `${MONTH_ABBR[Number(match[2]) - 1]} ${match[1]}`;
}

/** A stored "YYYY-MM-DD HH:MM" moment as "Oct 4, 2:05 PM" (the date as `formatDisplayDate` shows it,
 * then the time on a 12-hour clock). Anything else comes back unchanged. */
export function formatDisplayDateTime(stamp: string, today: Date = new Date()): string {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(stamp);
  if (!match || !parseStoredDate(match[1])) return stamp;
  const hour24 = Number(match[2]);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${formatDisplayDate(match[1], today)}, ${hour12}:${match[3]} ${hour24 < 12 ? "AM" : "PM"}`;
}
