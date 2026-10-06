// Fixture dates relative to today. A hard-coded calendar date drifts: views that show "the last 6 months",
// "this month" or "recent" activity read the same fixture differently as time passes (feature42/43 broke
// that way in October 2026). Describe a fixture date as "day D of the month N months ago" instead.

/** "YYYY-MM" for the calendar month `offset` months from `now` (negative = earlier). */
export function monthFromNow(offset, now = new Date()) {
  const total = now.getFullYear() * 12 + now.getMonth() + offset;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** "YYYY-MM-DD": day `day` (1-28, so it exists in every month) of the month `offset` months from `now`. */
export function dateInMonth(offset, day, now = new Date()) {
  if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error(`dateInMonth: day must be 1-28, got ${day}`);
  return `${monthFromNow(offset, now)}-${String(day).padStart(2, "0")}`;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "YYYY-MM-DD" for the day `offset` days from `now` (negative = earlier), by the local calendar. */
export function isoDaysFromNow(offset, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** How the app shows a stored "YYYY-MM-DD" in a list (src/format.ts formatDisplayDate): "Oct 4" in
 * `now`'s year, "Oct 4, 2025" in any other. */
export function displayDate(iso, now = new Date()) {
  const [y, m, d] = iso.split("-").map(Number);
  return y === now.getFullYear() ? `${MONTH_ABBR[m - 1]} ${d}` : `${MONTH_ABBR[m - 1]} ${d}, ${y}`;
}

/** How a date field shows a stored "YYYY-MM-DD" while it isn't being edited: always with the year. */
export function fieldDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]} ${d}, ${y}`;
}

/** The written-out date a list shows, as a pattern: "Oct 4" or "Oct 4, 2025". */
export const DISPLAY_DATE = /^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$/;
