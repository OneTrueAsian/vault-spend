// Expected month counts and monthly equivalents for the Ask the Vault savings-target spec (feature348), worked from the calendar
// so the spec does not depend on the day it runs. Amounts are integer cents; halves round up.

const daysInMonthOf = (year, month) => new Date(year, month, 0).getDate(); // month is 1-12

/**
 * "From now until December 31": the whole months counted without a question, and this month's remaining days (today
 * included). A schedule that starts on the 1st has no part month: this month counts whole and the app does not ask
 * how to count part months (asksPartMonth false, partDays 0).
 */
export function monthsLeftInYear(today) {
  const daysInMonth = daysInMonthOf(today.getFullYear(), today.getMonth() + 1);
  const startsOnFirst = today.getDate() === 1;
  return {
    whole: 11 - today.getMonth() + (startsOnFirst ? 1 : 0),
    partDays: startsOnFirst ? 0 : daysInMonth - today.getDate() + 1,
    daysInMonth,
    asksPartMonth: !startsOnFirst,
  };
}

/**
 * The months a schedule from `from` to `to` (inclusive "YYYY-MM-DD") covers, counted from the calendar: `startPart` and
 * `endPart` are the days of a first or last month the schedule covers only part of (null when it covers all of it),
 * `whole` the complete months, and `byDay` / `wholeOnly` the month counts as { num, den } for the by-the-day and
 * whole-months-only choices.
 */
export function scheduleMonths(from, to) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const touched = ty * 12 + tm - (fy * 12 + fm) + 1;
  const part = (year, month, first, last) => (first === 1 && last === daysInMonthOf(year, month) ? null : { days: last - first + 1, of: daysInMonthOf(year, month) });
  const parts = touched === 1 ? [part(fy, fm, fd, td)] : [part(fy, fm, fd, daysInMonthOf(fy, fm)), part(ty, tm, 1, td)];
  const partial = parts.filter(Boolean);
  const whole = touched - partial.length;
  let num = BigInt(whole), den = 1n;
  for (const p of partial) {
    num = num * BigInt(p.of) + BigInt(p.days) * den;
    den *= BigInt(p.of);
  }
  return { startPart: touched === 1 ? null : parts[0], endPart: touched === 1 ? null : parts[1], onlyPart: touched === 1 ? parts[0] : null, whole, byDay: { num, den }, wholeOnly: { num: BigInt(whole), den: 1n } };
}

/** The last day of the month `offset` months from `now`, as "YYYY-MM-DD". */
export function lastDayOfMonth(offset, now = new Date()) {
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const y = first.getFullYear(), m = first.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}-${String(daysInMonthOf(y, m)).padStart(2, "0")}`;
}

const roundHalfUp = (num, den) => (2n * num + den) / (2n * den);

/** The approximate monthly cut and limit for a category that was allocated `allocatedCents` over `months` ({ num, den } months). */
export function monthlyEquivalent(allocatedCents, usualCents, months) {
  const cut = roundHalfUp(allocatedCents * months.den, months.num);
  const limit = roundHalfUp(usualCents * months.num - allocatedCents * months.den, months.num);
  return { cut, limit };
}
