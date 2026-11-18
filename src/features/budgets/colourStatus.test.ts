import { describe, expect, it } from "vitest";
import { budgetGroupFillClass, incomeProgressTone, incomeTone, netTone, toneFillClass, usedInFull, viewedMonth } from "./colourStatus";

describe("incomeTone", () => {
  it("stays neutral early in the current month, even with little income in (the 4 October case)", () => {
    expect(incomeTone(30, 0.13, "current")).toBe("neutral");
  });

  it("is good once the income is in, in any month", () => {
    expect(incomeTone(99.5, 0.1, "current")).toBe("good");
    expect(incomeTone(100, 1, "past")).toBe("good");
    expect(incomeTone(120, 0, "future")).toBe("good");
  });

  it("is not good just below 99.5%", () => {
    expect(incomeTone(99.4, 0.5, "current")).toBe("neutral");
  });

  it("warns about a past month that fell short", () => {
    expect(incomeTone(98, 1, "past")).toBe("warn");
    expect(incomeTone(0, 1, "past")).toBe("warn");
  });

  it("warns late in the current month when under 80% has come in", () => {
    expect(incomeTone(79.9, 0.8, "current")).toBe("warn");
    expect(incomeTone(10, 0.95, "current")).toBe("warn");
  });

  it("does not warn late in the month at 80% or more", () => {
    expect(incomeTone(80, 0.9, "current")).toBe("neutral");
  });

  it("does not warn before 80% of the current month has gone", () => {
    expect(incomeTone(10, 0.79, "current")).toBe("neutral");
  });

  it("never warns about a future month", () => {
    expect(incomeTone(0, 0, "future")).toBe("neutral");
    expect(incomeTone(0, 1, "future")).toBe("neutral");
  });
});

describe("netTone", () => {
  it("stays neutral for a negative amount in the current month", () => {
    expect(netTone(-101.56, "current")).toBe("neutral");
  });

  it("stays neutral for a negative amount in a future month", () => {
    expect(netTone(-500, "future")).toBe("neutral");
  });

  it("is bad only for a negative amount in a past month", () => {
    expect(netTone(-0.01, "past")).toBe("bad");
  });

  it("is neutral for zero or more, even in a past month", () => {
    expect(netTone(0, "past")).toBe("neutral");
    expect(netTone(250, "past")).toBe("neutral");
  });
});

describe("incomeProgressTone", () => {
  it("works out the percentage received and uses incomeTone", () => {
    expect(incomeProgressTone(600, 2000, 0.13, "current")).toBe("neutral");
    expect(incomeProgressTone(2000, 2000, 0.13, "current")).toBe("good");
    expect(incomeProgressTone(600, 2000, 1, "past")).toBe("warn");
  });

  it("counts income with nothing budgeted as received in full", () => {
    expect(incomeProgressTone(40, 0, 0.5, "past")).toBe("good");
  });

  it("stays neutral with nothing budgeted and nothing received", () => {
    expect(incomeProgressTone(0, 0, 1, "past")).toBe("neutral");
  });
});

describe("toneFillClass", () => {
  it("maps each tone to its progress fill", () => {
    expect(toneFillClass("good")).toBe("progress-fill");
    expect(toneFillClass("neutral")).toBe("progress-fill neutral");
    expect(toneFillClass("warn")).toBe("progress-fill warn");
  });
});

describe("viewedMonth", () => {
  const today = new Date(2026, 9, 4); // 4 October 2026

  it("knows the current month", () => {
    expect(viewedMonth(2026, 10, today)).toBe("current");
  });

  it("knows an earlier month, including one in an earlier year", () => {
    expect(viewedMonth(2026, 9, today)).toBe("past");
    expect(viewedMonth(2025, 12, today)).toBe("past");
  });

  it("knows a later month, including one in a later year", () => {
    expect(viewedMonth(2026, 11, today)).toBe("future");
    expect(viewedMonth(2027, 1, today)).toBe("future");
  });
});

describe("usedInFull", () => {
  it("is true when what was spent equals what the month had, to the cent", () => {
    expect(usedInFull(400, 400)).toBe(true);
    expect(usedInFull("2140.00", "2140")).toBe(true);
  });

  it("ignores float noise from adding a budget and its rollover", () => {
    expect(usedInFull(300.1 + 99.9, "400.00")).toBe(true);
  });

  it("is false a cent either side", () => {
    expect(usedInFull(400, 399.99)).toBe(false);
    expect(usedInFull(400, 400.01)).toBe(false);
  });
});

// One rule for a budget group's bar, shared by the Budget page and the Dashboard's budget card.
describe("budgetGroupFillClass", () => {
  it("keeps income neutral while it is still arriving early in the month", () => {
    expect(budgetGroupFillClass("income", 4100, 8200, 6 / 31, "current")).toBe("progress-fill neutral");
  });
  it("shows income in full as good and warns only about a month that ended short", () => {
    expect(budgetGroupFillClass("income", 8200, 8200, 0.5, "current")).toBe("progress-fill");
    expect(budgetGroupFillClass("income", 4100, 8200, 1, "past")).toBe("progress-fill warn");
  });
  it("turns an expense group red only past 100%, amber from 80%", () => {
    expect(budgetGroupFillClass("fixed", 2300, 3607, 0.2, "current")).toBe("progress-fill");
    expect(budgetGroupFillClass("fixed", 3000, 3607, 0.2, "current")).toBe("progress-fill warn");
    expect(budgetGroupFillClass("fixed", 3607, 3607, 0.2, "current")).toBe("progress-fill warn");
    expect(budgetGroupFillClass("fixed", 3607.01, 3607, 0.2, "current")).toBe("progress-fill over");
    expect(budgetGroupFillClass("flexible", 10, 0, 0.2, "current")).toBe("progress-fill");
  });
});
