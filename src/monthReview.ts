/** Pure helpers behind the month-end review: when to offer it, and how to
 * word a month's movement against the one before. */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** How many days into a new month the Dashboard keeps offering last month's
 * review — long enough to get to it, short enough that an ignored offer goes
 * away by itself instead of nagging for good. */
export const REVIEW_OFFER_DAYS = 14;

export function previousMonth(today: Date): { year: number; month: number } {
  const month = today.getMonth(); // 0-11, so this is already last month's 1-12 number
  return month === 0 ? { year: today.getFullYear() - 1, month: 12 } : { year: today.getFullYear(), month };
}

export function monthName(_year: number, month: number): string {
  return MONTH_NAMES[month - 1];
}

/** The month to offer a review of on the Dashboard, or `null`: only in the
 * first two weeks of a month, only for last month, only if it had any
 * transactions, and only until it has been reviewed. */
export function monthReviewDue({
  today,
  reviewedMonths,
  transactions,
}: {
  today: Date;
  reviewedMonths: string[];
  transactions: { date: string }[];
}): { year: number; month: number; label: string } | null {
  if (today.getDate() > REVIEW_OFFER_DAYS) return null;
  const { year, month } = previousMonth(today);
  const period = `${year}-${String(month).padStart(2, "0")}`;
  if (reviewedMonths.includes(period)) return null;
  if (!transactions.some((t) => t.date.startsWith(period))) return null;
  return { year, month, label: monthName(year, month) };
}

/** `current` against `previous` — a difference under half a cent is "same". */
export function monthDelta(current: number, previous: number): { direction: "up" | "down" | "same"; amount: number } {
  const diff = current - previous;
  if (Math.abs(diff) < 0.005) return { direction: "same", amount: 0 };
  return { direction: diff > 0 ? "up" : "down", amount: Math.abs(diff) };
}
