/** What colours mean (s4): red only for things that need you: over budget, a bill past due, a
 * negative balance, a transaction that needs a category. Everything else stays neutral, and a
 * change is coloured on its own change line while the amount itself stays plain. */

export type ViewedMonth = "past" | "current" | "future";
export type IncomeTone = "neutral" | "good" | "warn";
export type NetTone = "neutral" | "bad";

/** Whether the month being viewed has ended, is this month, or hasn't started. `month` is 1-12. */
export function viewedMonth(year: number, month: number, today: Date): ViewedMonth {
  const viewed = year * 12 + month;
  const current = today.getFullYear() * 12 + today.getMonth() + 1;
  return viewed < current ? "past" : viewed > current ? "future" : "current";
}

/** How a month's income progress should look. Income that hasn't arrived yet early in the month
 * is normal, so it stays neutral. It is good once (nearly) all of it is in. It warns only about a
 * month that has ended short, or the last fifth of this month with under 80% in.
 * `monthElapsed` is the fraction of the month gone (0-1). */
export function incomeTone(pctReceived: number, monthElapsed: number, viewed: ViewedMonth): IncomeTone {
  if (pctReceived >= 99.5) return "good";
  if (viewed === "past") return "warn";
  if (viewed === "current" && monthElapsed >= 0.8 && pctReceived < 80) return "warn";
  return "neutral";
}

/** `incomeTone` from the amounts. With nothing budgeted, any income counts as received in full,
 * and none at all has nothing to say, so it stays neutral. */
export function incomeProgressTone(actual: number, budgeted: number, monthElapsed: number, viewed: ViewedMonth): IncomeTone {
  if (!(budgeted > 0)) return actual > 0 ? "good" : "neutral";
  return incomeTone((actual / budgeted) * 100, monthElapsed, viewed);
}

/** Money left after income: a negative figure only needs you once the month is over. Before then
 * it usually means income hasn't arrived yet. */
export function netTone(amount: number, viewed: ViewedMonth): NetTone {
  return amount < 0 && viewed === "past" ? "bad" : "neutral";
}

/** A budget used exactly in full: what was spent equals what the month had to spend (the budget plus
 * any rollover), compared in whole cents so float noise can't matter. The Budget row's "Used in full"
 * badge and the Dashboard banner both use this, so they always agree. */
export function usedInFull(available: number | string, actual: number | string): boolean {
  const cents = (v: number | string) => Math.round((typeof v === "number" ? v : parseFloat(v)) * 100);
  return cents(available) === cents(actual);
}

/** The progress-bar fill class for an income tone. `good` uses the normal fill. */
export function toneFillClass(tone: IncomeTone): string {
  return tone === "good" ? "progress-fill" : `progress-fill ${tone}`;
}
