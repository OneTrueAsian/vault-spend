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
