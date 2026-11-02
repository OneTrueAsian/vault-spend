import { describe, expect, it } from "vitest";
import { forecastHint, NOT_ENOUGH_HISTORY } from "./forecastNotes";
import type { BillAwareForecast } from "./types";

// QA-FUNC-003: with under two weeks of transactions the forecast leaves everyday spending out, and says so.
const forecast = (over: Partial<BillAwareForecast> = {}): BillAwareForecast => ({
  uses_recurring: true,
  start_balance: "1000.00",
  points: [],
  events: [],
  daily_baseline: "-30",
  enough_history: true,
  ...over,
});

describe("forecastHint", () => {
  it("says there is not enough history yet, in plain words, when everyday spending was left out", () => {
    const hint = forecastHint(forecast({ enough_history: false, daily_baseline: "0" }));
    expect(hint).toContain(NOT_ENOUGH_HISTORY);
    expect(NOT_ENOUGH_HISTORY).toBe(
      "Not enough history yet. Everyday spending is left out until you have 2 weeks of transactions, so this line shows only your bills and paychecks.",
    );
  });

  it("does the same for the plain trend forecast (nothing active in Recurring)", () => {
    const hint = forecastHint(forecast({ uses_recurring: false, enough_history: false, daily_baseline: "0" }));
    expect(hint).toContain(NOT_ENOUGH_HISTORY);
    expect(hint).toContain("Add your bills and paycheck to Recurring");
  });

  it("keeps the existing sentences, with the daily average, once there is enough history", () => {
    expect(forecastHint(forecast())).toContain("Everyday spending carries on at your recent average ($30.00 a day out");
    expect(forecastHint(forecast())).not.toContain("Not enough history");
    expect(forecastHint(forecast({ uses_recurring: false }))).toContain("smooth trend");
  });

  it("calls income an 'in' day when the average is positive", () => {
    expect(forecastHint(forecast({ daily_baseline: "12.5" }))).toContain("$12.50 a day in");
  });

  it("shows no forecast hint text before the forecast has loaded", () => {
    expect(forecastHint(null)).toContain("smooth trend");
    expect(forecastHint(null)).not.toContain("Not enough history");
  });
});
