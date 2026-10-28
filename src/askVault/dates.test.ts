import { describe, expect, it } from "vitest";
import { matchPeriod, tokenize } from "./dates";

const TODAY = "2026-09-06"; // a Sunday

function period(text: string, historyStart?: string) {
  return matchPeriod(tokenize(text), 0, TODAY, historyStart);
}

describe("tokenize", () => {
  it("keeps ISO dates, dollar amounts and quoted names whole", () => {
    expect(tokenize('spend on "Last Year" over $1,250.50 on 2026-07-15 8th')).toEqual([
      "spend", "on", '"last year"', "over", "$1250.50", "on", "2026-07-15", "8th",
    ]);
  });
  it("drops a trailing question mark but keeps other punctuation as tokens", () => {
    expect(tokenize("how much, exactly?")).toEqual(["how", "much", ",", "exactly"]);
  });
});

describe("calendar periods end today, never in the future", () => {
  it("this month runs from the first through today and is still under way", () => {
    expect(period("this month")).toMatchObject({ kind: "period", consumed: 2, period: { from: "2026-09-01", to: "2026-09-06", soFar: true } });
  });
  it("last month is the whole previous month", () => {
    expect(period("last month")).toMatchObject({ period: { from: "2026-08-01", to: "2026-08-31", soFar: false } });
  });
  it("last month across a year boundary", () => {
    expect(matchPeriod(tokenize("last month"), 0, "2026-01-15")).toMatchObject({ period: { from: "2025-12-01", to: "2025-12-31" } });
  });
  it("this year to date and last year whole", () => {
    expect(period("this year")).toMatchObject({ period: { from: "2026-01-01", to: "2026-09-06", soFar: true } });
    expect(period("last year")).toMatchObject({ period: { from: "2025-01-01", to: "2025-12-31", soFar: false } });
  });
  it("this quarter to date and last quarter whole", () => {
    expect(period("this quarter")).toMatchObject({ period: { from: "2026-07-01", to: "2026-09-06", soFar: true } });
    expect(period("last quarter")).toMatchObject({ period: { from: "2026-04-01", to: "2026-06-30", soFar: false } });
  });
  it("last quarter in the first quarter reaches back to the previous year", () => {
    expect(matchPeriod(tokenize("last quarter"), 0, "2026-02-10")).toMatchObject({ period: { from: "2025-10-01", to: "2025-12-31" } });
  });
  it("this week starts on Sunday; last week is the whole previous Sunday to Saturday", () => {
    expect(period("this week")).toMatchObject({ period: { from: "2026-09-06", to: "2026-09-06", soFar: true } });
    expect(period("last week")).toMatchObject({ period: { from: "2026-08-30", to: "2026-09-05", soFar: false } });
  });
  it("the month before means two months back", () => {
    expect(period("the month before")).toMatchObject({ period: { from: "2026-07-01", to: "2026-07-31" } });
  });
  it("today and yesterday are single days", () => {
    expect(period("today")).toMatchObject({ period: { from: "2026-09-06", to: "2026-09-06" } });
    expect(period("yesterday")).toMatchObject({ period: { from: "2026-09-05", to: "2026-09-05" } });
  });
});

describe("rolling periods", () => {
  it("the past N months runs from the same day N months back through today", () => {
    expect(period("the past 3 months")).toMatchObject({ consumed: 4, period: { from: "2026-06-06", to: "2026-09-06", soFar: false } });
    expect(period("past 2 months")).toMatchObject({ period: { from: "2026-07-06", to: "2026-09-06" } });
  });
  it("clamps to the end of a shorter month", () => {
    expect(matchPeriod(tokenize("last 1 month"), 0, "2026-03-31")).toMatchObject({ period: { from: "2026-02-28", to: "2026-03-31" } });
  });
  it("days and weeks", () => {
    expect(period("the last 30 days")).toMatchObject({ period: { from: "2026-08-07", to: "2026-09-06" } });
    expect(period("past 2 weeks")).toMatchObject({ period: { from: "2026-08-23", to: "2026-09-06" } });
  });
  it("refuses a rolling range of zero or an absurd length", () => {
    expect(period("past 0 months")).toMatchObject({ kind: "unsupported" });
    expect(period("past 500 months")).toMatchObject({ kind: "unsupported" });
  });
});

describe("month names mean the most recent one that has happened", () => {
  it("a past month this year", () => {
    expect(period("july")).toMatchObject({ period: { from: "2026-07-01", to: "2026-07-31", soFar: false } });
  });
  it("a month later in the calendar than today means last year, never next year", () => {
    expect(period("march")).toMatchObject({ period: { from: "2026-03-01", to: "2026-03-31" } });
    expect(period("december")).toMatchObject({ period: { from: "2025-12-01", to: "2025-12-31" } });
  });
  it("the current month is to date", () => {
    expect(period("september")).toMatchObject({ period: { from: "2026-09-01", to: "2026-09-06", soFar: true } });
  });
  it("a month with a year", () => {
    expect(period("august 2026")).toMatchObject({ consumed: 2, period: { from: "2026-08-01", to: "2026-08-31" } });
    expect(period("december 2025")).toMatchObject({ period: { from: "2025-12-01", to: "2025-12-31" } });
  });
  it("February in a leap year", () => {
    expect(matchPeriod(tokenize("february 2024"), 0, TODAY)).toMatchObject({ period: { to: "2024-02-29" } });
  });
  it("refuses a month that has not started", () => {
    expect(period("october 2026")).toMatchObject({ kind: "unsupported" });
  });
  it("asks which year when the history holds the month twice", () => {
    expect(period("september", "2025-09-01")).toMatchObject({ kind: "clarify", choices: ["September 2025", "September 2026"] });
  });
  it("does not ask when only one year of history holds the month", () => {
    expect(period("march", "2025-09-01")).toMatchObject({ kind: "period", period: { from: "2026-03-01" } });
  });
  it("an explicit year never triggers a question", () => {
    expect(period("september 2025", "2025-09-01")).toMatchObject({ kind: "period", period: { from: "2025-09-01", to: "2025-09-30" } });
  });
});

describe("years, since, days and ranges", () => {
  it("a bare four-digit year; the current year is to date", () => {
    expect(period("2025")).toMatchObject({ period: { from: "2025-01-01", to: "2025-12-31" } });
    expect(period("2026")).toMatchObject({ period: { from: "2026-01-01", to: "2026-09-06", soFar: true } });
    expect(period("year 2025")).toMatchObject({ consumed: 2 });
  });
  it("refuses a year in the future or outside the supported span", () => {
    expect(period("2027")).toMatchObject({ kind: "unsupported" });
    expect(period("1850")).toMatchObject({ kind: "unsupported" });
  });
  it("since a month runs through today", () => {
    expect(period("since june")).toMatchObject({ period: { from: "2026-06-01", to: "2026-09-06", soFar: false } });
  });
  it("a single calendar day, written three ways", () => {
    expect(period("july 8th")).toMatchObject({ consumed: 2, period: { from: "2026-07-08", to: "2026-07-08" } });
    expect(period("march 14")).toMatchObject({ period: { from: "2026-03-14", to: "2026-03-14" } });
    expect(period("2026-07-15")).toMatchObject({ consumed: 1, period: { from: "2026-07-15", to: "2026-07-15" } });
  });
  it("refuses an impossible day", () => {
    expect(period("february 30")).toMatchObject({ kind: "unsupported" });
    expect(period("2026-02-30")).toMatchObject({ kind: "unsupported" });
  });
  it("from one day to another", () => {
    expect(period("from june 1 to june 30")).toMatchObject({ consumed: 6, period: { from: "2026-06-01", to: "2026-06-30" } });
    expect(period("from 2026-06-01 to 2026-06-30")).toMatchObject({ period: { from: "2026-06-01", to: "2026-06-30" } });
  });
  it("refuses a reversed or future-ending range", () => {
    expect(period("from june 30 to june 1")).toMatchObject({ kind: "unsupported" });
    expect(period("from 2026-09-01 to 2026-09-30")).toMatchObject({ kind: "unsupported" });
  });
  it("does not guess at day/month order in a slash date", () => {
    expect(period("09/06/2026")).toMatchObject({ kind: "unsupported" });
  });
  it("returns null when the words are not a period", () => {
    expect(period("groceries")).toBeNull();
  });
});

describe("labels", () => {
  it("names periods in plain words, marking one still under way", () => {
    expect(period("this month")).toMatchObject({ period: { label: "September 2026 so far" } });
    expect(period("last month")).toMatchObject({ period: { label: "August 2026" } });
    expect(period("this year")).toMatchObject({ period: { label: "2026 so far" } });
    expect(period("the past 3 months")).toMatchObject({ period: { label: "the past 3 months" } });
    expect(period("july 8th")).toMatchObject({ period: { label: "July 8, 2026" } });
    expect(period("last quarter")).toMatchObject({ period: { label: "April to June 2026" } });
  });
});

describe("year boundaries and leap days with the date supplied (no real clock)", () => {
  const at = (text: string, today: string) => matchPeriod(tokenize(text), 0, today);
  it("this year on 1 January is that single day, still under way", () => {
    expect(at("this year", "2027-01-01")).toMatchObject({ period: { from: "2027-01-01", to: "2027-01-01", soFar: true } });
  });
  it("this year in mid-January runs from 1 January through today", () => {
    expect(at("this year", "2027-01-15")).toMatchObject({ period: { from: "2027-01-01", to: "2027-01-15", soFar: true } });
  });
  it("last year in January is the whole previous year", () => {
    expect(at("last year", "2027-01-15")).toMatchObject({ period: { from: "2026-01-01", to: "2026-12-31", soFar: false } });
  });
  it("last month on 1 March of a leap year ends on 29 February", () => {
    expect(at("last month", "2028-03-01")).toMatchObject({ period: { from: "2028-02-01", to: "2028-02-29", soFar: false } });
  });
  it("this month on its last day (29 February) is the complete month, not so far (dates.ts span: soFar only while the end is after today)", () => {
    expect(at("this month", "2028-02-29")).toMatchObject({ period: { from: "2028-02-01", to: "2028-02-29", soFar: false } });
  });
  it("last month on 31 December is November, not a December date", () => {
    expect(at("last month", "2026-12-31")).toMatchObject({ period: { from: "2026-11-01", to: "2026-11-30", soFar: false } });
  });
});
