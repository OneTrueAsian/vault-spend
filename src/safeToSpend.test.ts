import { describe, expect, it } from "vitest";
import { lowestPoint, safeToSpend } from "./safeToSpend";

const TODAY = "2026-09-18";

const ev = (date: string, label: string, amount: string) => ({ date, label, amount });

describe("safeToSpend", () => {
  it("is cash minus the bills due before the next paycheck", () => {
    const result = safeToSpend({
      cash: 3000,
      today: TODAY,
      buffer: 0,
      events: [
        ev("2026-09-20", "Geico Auto", "-175.00"),
        ev("2026-09-22", "Netflix", "-15.49"),
        ev("2026-09-26", "Payroll Deposit", "2000.00"),
        ev("2026-09-28", "Union Realty", "-1850.00"), // after payday: not counted
      ],
    });

    expect(result.amount).toBeCloseTo(3000 - 175 - 15.49, 2);
    expect(result.nextIncome).toEqual(ev("2026-09-26", "Payroll Deposit", "2000.00"));
    expect(result.bills.map((b) => b.label)).toEqual(["Geico Auto", "Netflix"]);
    expect(result.daysUntilPayday).toBe(8);
    expect(result.perDay).toBeCloseTo((3000 - 175 - 15.49) / 8, 2);
  });

  it("subtracts a buffer the user wants to keep", () => {
    const result = safeToSpend({
      cash: 1000,
      today: TODAY,
      buffer: 250,
      events: [ev("2026-09-20", "Geico Auto", "-175.00"), ev("2026-09-26", "Payroll Deposit", "2000.00")],
    });

    expect(result.amount).toBe(575);
  });

  it("counts a bill due today, and one due on payday itself", () => {
    const result = safeToSpend({
      cash: 1000,
      today: TODAY,
      buffer: 0,
      events: [
        ev("2026-09-18", "Rent Due Today", "-400.00"),
        ev("2026-09-26", "Same-day Bill", "-100.00"),
        ev("2026-09-26", "Payroll Deposit", "2000.00"),
      ],
    });

    expect(result.amount).toBe(500);
  });

  it("looks past a paycheck that lands today to the next one", () => {
    const result = safeToSpend({
      cash: 1000,
      today: TODAY,
      buffer: 0,
      events: [ev("2026-09-18", "Payroll Deposit", "2000.00"), ev("2026-10-02", "Payroll Deposit", "2000.00")],
    });

    expect(result.nextIncome?.date).toBe("2026-10-02");
    expect(result.daysUntilPayday).toBe(14);
  });

  it("can be negative — the bills before payday exceed what's in the bank", () => {
    const result = safeToSpend({
      cash: 100,
      today: TODAY,
      buffer: 0,
      events: [ev("2026-09-20", "Geico Auto", "-175.00"), ev("2026-09-26", "Payroll Deposit", "2000.00")],
    });

    expect(result.amount).toBe(-75);
    expect(result.perDay).toBeNull();
  });

  it("has no payday to count to when no income is on the calendar", () => {
    const result = safeToSpend({
      cash: 1000,
      today: TODAY,
      buffer: 0,
      events: [ev("2026-09-20", "Geico Auto", "-175.00"), ev("2026-10-05", "Union Realty", "-1850.00")],
    });

    expect(result.nextIncome).toBeNull();
    expect(result.daysUntilPayday).toBeNull();
    expect(result.perDay).toBeNull();
    expect(result.amount).toBe(1000 - 175 - 1850); // every bill in the window
  });

  it("is just cash minus the buffer when nothing is on the calendar", () => {
    expect(safeToSpend({ cash: 800, today: TODAY, buffer: 100, events: [] }).amount).toBe(700);
  });
});

describe("lowestPoint", () => {
  it("finds the day the balance bottoms out", () => {
    const points = [
      { date: "2026-09-18", balance: "3000" },
      { date: "2026-09-28", balance: "1200" },
      { date: "2026-09-29", balance: "1300" },
      { date: "2026-10-05", balance: "3300" },
    ];

    expect(lowestPoint(points)).toEqual({ date: "2026-09-28", balance: 1200 });
  });

  it("is null for no points", () => {
    expect(lowestPoint([])).toBeNull();
  });
});
