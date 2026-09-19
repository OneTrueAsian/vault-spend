/** Pure goal-projection math for the Goals page: when a goal will finish at
 * its recent pace, and what it would take to make its target date. Kept out
 * of the component so it can be unit tested without rendering anything. */

import { toLocalIsoDate } from "./format";

const DAYS_PER_MONTH = 30.4375;
/** A finish date further out than this many months isn't a projection worth
 * showing — at that pace the goal is effectively stalled. */
const MAX_PROJECTED_MONTHS = 600;

export type GoalStatus =
  /** No target amount — nothing to measure against. */
  | "no_target"
  | "reached"
  /** Target date set and the recent pace finishes on or before it. */
  | "on_track"
  /** Target date set and the recent pace misses it (or there is no pace). */
  | "behind"
  /** No target date; the recent pace gives a finish date. */
  | "no_deadline"
  /** No target date and no usable pace. */
  | "no_pace";

export type GoalPlan = {
  status: GoalStatus;
  /** Dollars still to go, `null` without a target. */
  remaining: number | null;
  /** Per-month saving needed to land on the target date; `null` when there
   * is no target date or the goal is already reached. */
  needsPerMonth: number | null;
  /** "YYYY-MM-DD" the recent pace finishes the goal, `null` when there is no
   * positive pace (or it is absurdly far out). */
  projectedFinish: string | null;
};

type GoalInput = {
  saved_amount: string;
  target_amount: string | null;
  target_date: string | null;
  /** Net dollars per month over the recent past (see `StoredBucket::monthly_pace`). */
  monthly_pace: string;
};

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** `from` shifted by `months` calendar months, the day clamped into the
 * target month (Jan 31 + 1 month = Feb 28, not Mar 3). */
function addMonths(from: Date, months: number): Date {
  const total = from.getFullYear() * 12 + from.getMonth() + months;
  const year = Math.floor(total / 12);
  const monthIndex = total - year * 12;
  return new Date(year, monthIndex, Math.min(from.getDate(), daysInMonth(year, monthIndex)));
}

/** Calendar months from `from` to `to` — whole months first, then the
 * leftover days as a fraction. Negative or zero when `to` isn't after `from`. */
function monthsBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  let whole = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (addMonths(from, whole).getTime() > to.getTime()) whole -= 1;
  const leftoverDays = Math.round((to.getTime() - addMonths(from, whole).getTime()) / 86_400_000);
  return whole + leftoverDays / DAYS_PER_MONTH;
}

export function goalPlan(goal: GoalInput, today: Date): GoalPlan {
  const target = goal.target_amount ? parseFloat(goal.target_amount) : NaN;
  if (!(target > 0)) return { status: "no_target", remaining: null, needsPerMonth: null, projectedFinish: null };

  const saved = parseFloat(goal.saved_amount) || 0;
  if (saved >= target) return { status: "reached", remaining: 0, needsPerMonth: null, projectedFinish: null };

  const remaining = target - saved;
  const pace = parseFloat(goal.monthly_pace) || 0;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  let projectedFinish: string | null = null;
  if (pace > 0) {
    const months = remaining / pace;
    if (months <= MAX_PROJECTED_MONTHS) {
      const whole = Math.floor(months);
      const finish = addMonths(startOfToday, whole);
      finish.setDate(finish.getDate() + Math.round((months - whole) * DAYS_PER_MONTH));
      projectedFinish = toLocalIsoDate(finish);
    }
  }

  if (!goal.target_date) {
    return { status: projectedFinish ? "no_deadline" : "no_pace", remaining, needsPerMonth: null, projectedFinish };
  }

  const deadline = new Date(goal.target_date + "T00:00:00");
  const monthsLeft = monthsBetween(startOfToday, deadline);
  const needsPerMonth = remaining / Math.max(monthsLeft, 1);
  const onTrack = projectedFinish !== null && projectedFinish <= goal.target_date;
  return { status: onTrack ? "on_track" : "behind", remaining, needsPerMonth, projectedFinish };
}
