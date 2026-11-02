import { formatAmount } from "./format";
import type { BillAwareForecast } from "./types";

/** Shown under the forecast while there are fewer than 14 days of transactions: the everyday part of
 * the forecast is left out then, because a few days of spending repeated for months is not a forecast. */
export const NOT_ENOUGH_HISTORY =
  "Not enough history yet. Everyday spending is left out until you have 2 weeks of transactions, so this line shows only your bills and paychecks.";

const TREND_HINT =
  "Projects your cash balance (checking/savings) forward as a smooth trend, based on your actual net cash flow (income minus spending) over roughly the last 90 days. Add your bills and paycheck to Recurring for a forecast that shows each one landing on its due date.";

/** The explanatory sentence under the Cash Flow forecast chart. */
export function forecastHint(forecast: BillAwareForecast | null): string {
  const recurringHint = (f: BillAwareForecast) =>
    `Every bill and paycheck on your Recurring list lands on the day it's due. Everyday spending carries on at your recent average (${formatAmount(
      Math.abs(parseFloat(f.daily_baseline)).toFixed(2),
    )} a day ${parseFloat(f.daily_baseline) <= 0 ? "out" : "in"}, with recurring items and transfers left out so nothing is counted twice).`;
  if (forecast && !forecast.enough_history) {
    return forecast.uses_recurring ? NOT_ENOUGH_HISTORY : `${NOT_ENOUGH_HISTORY} ${TREND_HINT}`;
  }
  return forecast?.uses_recurring ? recurringHint(forecast) : TREND_HINT;
}
