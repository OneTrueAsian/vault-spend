import { describe, expect, it } from "vitest";
import { incomeProgressTone, incomeTone, netTone, toneFillClass, viewedMonth } from "./colourStatus";

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
