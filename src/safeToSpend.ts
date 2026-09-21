import type { ForecastEvent, ForecastPoint } from "./types";

export type SafeToSpend = {
  /** Cash now, minus every bill due before the next paycheck, minus the
   * buffer the user wants to keep. Negative means the bills outrun the bank
   * balance before payday. */
  amount: number;
  /** The paycheck this counts down to — `null` if no income is on the
   * calendar, in which case `bills` covers everything in the forecast window. */
  nextIncome: ForecastEvent | null;
  /** The bills subtracted, in date order. */
  bills: ForecastEvent[];
  daysUntilPayday: number | null;
  /** `amount` spread over the days until payday; `null` when there's no
   * payday, no time left, or nothing left to spend. */
  perDay: number | null;
};

function toLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toLocalDate(toIso).getTime() - toLocalDate(fromIso).getTime()) / 86_400_000);
}

/** "How much can I spend on everyday things until I get paid?" — cash in the
 * bank now, less every recurring bill due between now and the next
 * paycheck, less an optional buffer. A bill due today, or on payday itself,
 * counts (conservatively — it may hit before the deposit does). A paycheck
 * landing *today* is treated as already in the balance, so the countdown
 * runs to the one after it. `events` are the bill-aware forecast's dated
 * recurring items (see the backend's `Store::bill_aware_forecast`). */
export function safeToSpend({
  cash,
  events,
  today,
  buffer,
}: {
  cash: number;
  events: ForecastEvent[];
  today: string;
  buffer: number;
}): SafeToSpend {
  const nextIncome = events.find((e) => parseFloat(e.amount) > 0 && e.date > today) ?? null;
  const bills = events.filter(
    (e) => parseFloat(e.amount) < 0 && e.date >= today && (nextIncome === null || e.date <= nextIncome.date),
  );
  const billsTotal = bills.reduce((sum, b) => sum + parseFloat(b.amount), 0);
  const amount = cash + billsTotal - buffer;
  const daysUntilPayday = nextIncome ? daysBetween(today, nextIncome.date) : null;
  const perDay = daysUntilPayday !== null && daysUntilPayday > 0 && amount > 0 ? amount / daysUntilPayday : null;
  return { amount, nextIncome, bills, daysUntilPayday, perDay };
}

/** The forecast's low point — the day balance bottoms out, so a coming
 * squeeze is visible even when the end of the window looks fine. */
export function lowestPoint(points: ForecastPoint[]): { date: string; balance: number } | null {
  let lowest: { date: string; balance: number } | null = null;
  for (const p of points) {
    const balance = parseFloat(p.balance);
    if (lowest === null || balance < lowest.balance) lowest = { date: p.date, balance };
  }
  return lowest;
}
