import { describe, expect, it } from "vitest";
import { fixtureBaseline, fixtureIntent, fixtureOnce, fixturePartMonth, fixturePreview, noHistoryBaseline, shortHistoryBaseline } from "./spendingScenarioFixtures";
import { ROUNDING_NOTE, baselineRows, countedMonths, datesText, longDate, monthLabel, partMonthText, reductionText, resultView, usualMonthText } from "./spendingScenarioView";

// Expected sentences and figures are the hand-derived anchors in M3/Worked-Examples.md, written out here, not read from the module.

describe("scenario wording helpers", () => {
  it("writes dates and months in words, independent of the clock", () => {
    expect(longDate("2026-10-15")).toBe("October 15, 2026");
    expect(longDate("2028-02-29")).toBe("February 29, 2028");
    expect(monthLabel("2026-07")).toBe("July 2026");
  });

  it("describes the cut in plain words", () => {
    expect(reductionText(fixtureIntent())).toBe("$50.00 every month");
    expect(reductionText(fixtureIntent({ reduction: { kind: "percent", amount: "10" } }))).toBe("10% every month");
    expect(reductionText(fixtureOnce())).toBe("$25.00 once");
  });

  it("describes the dates with the number of months, and says plainly when a year is a what-if", () => {
    expect(datesText(fixtureIntent())).toBe("November 1, 2026 to December 31, 2026 (2 months)");
    expect(datesText(fixtureIntent({ horizon: { kind: "prospective", from: "2026-11-01", to: "2026-11-30" } }))).toBe("November 1, 2026 to November 30, 2026 (1 month)");
    expect(datesText(fixtureIntent({ horizon: { kind: "full-year-hypothetical", from: "2026-01-01", to: "2026-12-31" } }))).toBe(
      "January 1, 2026 to December 31, 2026 (12 months), a what-if that includes months that have already passed",
    );
    expect(datesText(fixtureOnce())).toBe("October 20, 2026");
  });

  it("says what happens to a part month, and nothing for a one-time cut", () => {
    expect(partMonthText(fixtureIntent())).toBe("Not counted, whole months only");
    expect(partMonthText(fixturePartMonth())).toBe("Counted by the day");
    expect(partMonthText(fixtureOnce())).toBeNull();
  });
});

describe("the baseline as shown", () => {
  it("lists all three months, each counted", () => {
    expect(baselineRows(fixtureBaseline())).toEqual([
      { month: "July 2026", spent: "$300.00", counted: true, reason: null },
      { month: "August 2026", spent: "$330.00", counted: true, reason: null },
      { month: "September 2026", spent: "$270.00", counted: true, reason: null },
    ]);
    expect(countedMonths(fixtureBaseline())).toBe(3);
    expect(usualMonthText(fixtureBaseline())).toBe("$300.00");
  });

  it("keeps a month that cannot be counted in the list, with its plain reason, and does not count it", () => {
    expect(baselineRows(shortHistoryBaseline())[1]).toEqual({ month: "August 2026", spent: "$0.00", counted: false, reason: "no records" });
    expect(countedMonths(shortHistoryBaseline())).toBe(2);
    expect(usualMonthText(shortHistoryBaseline())).toBe("$150.00");
  });

  it("has a plain reason for every kind of month that is left out", () => {
    const reasons = (["no-records", "before-records", "partly-recorded", "records-end", "in-progress", "partial-period"] as const).map(
      (coverage) => baselineRows(fixtureBaseline([["1", coverage], ["1", "complete"], ["1", "complete"]]))[0].reason,
    );
    expect(reasons).toEqual(["no records", "records start later", "records start part-way through", "records stop before the month ends", "the month is not over", "only part of the month was asked"]);
  });

  it("offers no usual month when nothing can be counted, and no months for a manual baseline", () => {
    expect(usualMonthText(noHistoryBaseline())).toBeNull();
    expect(countedMonths(noHistoryBaseline())).toBe(0);
    expect(usualMonthText({ kind: "manual", monthlyAmount: "123.45", source: noHistoryBaseline().source })).toBe("$123.45");
    expect(baselineRows({ kind: "manual", monthlyAmount: "1", source: noHistoryBaseline().source })).toEqual([]);
  });
});

describe("the result as shown", () => {
  it("monthly-two: $100.00 saved over two months and a $250.00 monthly limit", () => {
    const view = resultView(fixturePreview());
    expect(view.headline).toBe("Spending $50.00 less on Dining each month from November 1, 2026 to December 31, 2026 would save");
    expect(view.total).toBe("$100.00");
    expect(view.limit).toBe("Your Dining limit would be $250.00 a month instead of a usual $300.00.");
    expect(view.rows).toEqual([{ label: "November 2026", saving: "$50.00" }, { label: "December 2026", saving: "$50.00" }]);
    expect(view.rowsNeedRoundingNote).toBe(false);
  });

  it("inclusive-october: $127.42, with the part month shown as 17 of 31 days", () => {
    const view = resultView(fixturePreview(fixturePartMonth()));
    expect(view.total).toBe("$127.42");
    expect(view.rows[0]).toEqual({ label: "October 2026 (17 of 31 days)", saving: "$27.42" });
    expect(view.limit).toContain("$250.00 a month");
  });

  it("percent: states the percentage and still shows the dollar limit", () => {
    const view = resultView(fixturePreview(fixtureIntent({ reduction: { kind: "percent", amount: "10" } })));
    expect(view.headline).toContain("10% less on Dining");
    expect(view.total).toBe("$60.00");
    expect(view.limit).toContain("$270.00 a month");
  });

  it("once: no monthly limit, no month rows, and the sentence says so", () => {
    const view = resultView(fixturePreview(fixtureOnce()));
    expect(view.headline).toBe("Spending $25.00 less on Dining once, on October 20, 2026, would save");
    expect(view.total).toBe("$25.00");
    expect(view.limit).toBe("A one-time cut does not set a monthly limit. A usual month of Dining is $300.00, so $25.00 fits inside it.");
    expect(view.rows).toEqual([]);
  });

  it("tiny-mean: the total is $0.04 although the monthly limit shows $0.00", () => {
    const intent = fixtureIntent({ reduction: { kind: "percent", amount: "100" }, horizon: { kind: "full-year-hypothetical", from: "2026-01-01", to: "2026-12-31" } });
    const view = resultView(fixturePreview(intent, fixtureBaseline([["0.01", "complete"], ["0", "complete"], ["0", "complete"]])));
    expect(view.total).toBe("$0.04");
    expect(view.limit).toContain("$0.00 a month");
    expect(view.rows).toHaveLength(12);
    // Twelve lines of 1/300 dollar each show $0.00, but the total is $0.04: the screen must explain the difference.
    expect(view.rows.every((row) => row.saving === "$0.00")).toBe(true);
    expect(view.rowsNeedRoundingNote).toBe(true);
  });

  it("a manual baseline reads the same way as a recorded one", () => {
    const view = resultView(fixturePreview(fixtureIntent(), { kind: "manual", monthlyAmount: "300", source: fixtureBaseline().source }));
    expect(view.total).toBe("$100.00");
    expect(view.usualMonth).toBe("$300.00");
  });

  it("a whole-year what-if says in the result that it includes months that have already passed", () => {
    const intent = fixtureIntent({ horizon: { kind: "full-year-hypothetical", from: "2026-01-01", to: "2026-12-31" } });
    expect(resultView(fixturePreview(intent)).hypothetical).toBe("This is a what-if for the whole of 2026. It includes months that have already passed, so it is not money you have already saved.");
    expect(resultView(fixturePreview()).hypothetical).toBeNull();
    expect(resultView(fixturePreview(fixtureOnce())).hypothetical).toBeNull();
  });

  it("a percentage result shows its basis in dollars; a dollar result has no basis line", () => {
    expect(resultView(fixturePreview(fixtureIntent({ reduction: { kind: "percent", amount: "10" } }))).basis).toBe("10% of a usual month of Dining ($300.00) is $30.00 a month.");
    expect(resultView(fixturePreview(fixtureIntent({ reduction: { kind: "percent", amount: "12.5" } }))).basis).toBe("12.5% of a usual month of Dining ($300.00) is $37.50 a month.");
    expect(resultView(fixturePreview()).basis).toBeNull();
  });

  it("the rounding note does not claim a size for the difference", () => {
    expect(ROUNDING_NOTE).toBe("Each amount is rounded to the cent on its own, so the lines may not add up exactly to the total.");
  });
});
