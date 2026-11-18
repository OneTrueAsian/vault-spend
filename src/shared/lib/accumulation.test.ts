import { describe, expect, it } from "vitest";
import {
  averageMonthlyContribution,
  combineProjections,
  cumulativeNet,
  dateX,
  deflatePoints,
  monthIndex,
  monthsUntil,
  projectAccount,
  summarizeAccumulation,
  toTodaysDollars,
  validatePlanForm,
  type MonthFlow,
  type PlanFormFields,
  type SummaryInput,
} from "./accumulation";

const inMonth = (month: string, moneyIn: number, moneyOut = 0): MonthFlow => ({ month, moneyIn, moneyOut });

describe("monthIndex / monthsUntil", () => {
  it("counts whole calendar months, ignoring the day", () => {
    expect(monthIndex("2026-09")).toBe(2026 * 12 + 8);
    expect(monthsUntil("2026-09-20", "2031-06")).toBe(57);
    expect(monthsUntil("2026-09-30", "2026-10")).toBe(1);
  });

  it("is 0 for this month and negative for a month that has passed", () => {
    expect(monthsUntil("2026-09-20", "2026-09")).toBe(0);
    expect(monthsUntil("2026-09-20", "2026-06")).toBe(-3);
  });
});

describe("averageMonthlyContribution", () => {
  const steady = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].map((m) => inMonth(m, 500));

  it("averages the last six complete months of money in", () => {
    expect(averageMonthlyContribution(steady, "2026-09-20")).toBe(500);
  });

  it("leaves out the month in progress", () => {
    expect(averageMonthlyContribution([...steady, inMonth("2026-09", 9999)], "2026-09-20")).toBe(500);
  });

  it("leaves out anything older than six complete months", () => {
    const months = [inMonth("2026-01", 5000), inMonth("2026-02", 5000), ...steady];
    expect(averageMonthlyContribution(months, "2026-09-20")).toBe(500);
  });

  it("counts a missed month as zero", () => {
    const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].map((m) => inMonth(m, m === "2026-05" ? 0 : 500));
    expect(averageMonthlyContribution(months, "2026-09-20")).toBe(416.67);
  });

  it("uses fewer months when the first deposit is newer than six months", () => {
    const months = [inMonth("2026-07", 400), inMonth("2026-08", 600)];
    expect(averageMonthlyContribution(months, "2026-09-20")).toBe(500);
  });

  it("counts the quiet months since the last deposit", () => {
    // April-June deposits, then nothing in July or August: 1500 over April..August.
    const months = [inMonth("2026-04", 500), inMonth("2026-05", 500), inMonth("2026-06", 500)];
    expect(averageMonthlyContribution(months, "2026-09-20")).toBe(300);
  });

  it("ignores money out and a withdrawal-only month before the first deposit", () => {
    const months = [inMonth("2026-06", 0, 40), inMonth("2026-07", 500, 250), inMonth("2026-08", 500)];
    expect(averageMonthlyContribution(months, "2026-09-20")).toBe(500);
  });

  it("is null with no deposits, or when the only deposits are this month's", () => {
    expect(averageMonthlyContribution([], "2026-09-20")).toBeNull();
    expect(averageMonthlyContribution([inMonth("2026-08", 0, 20)], "2026-09-20")).toBeNull();
    expect(averageMonthlyContribution([inMonth("2026-09", 500)], "2026-09-20")).toBeNull();
  });

  it("works across a year boundary", () => {
    const months = ["2026-01", "2026-02"].map((m) => inMonth(m, 300));
    expect(averageMonthlyContribution(months, "2026-03-05")).toBe(300);
    const wrapped = ["2025-10", "2025-11", "2025-12", "2026-01"].map((m) => inMonth(m, 200));
    expect(averageMonthlyContribution(wrapped, "2026-02-01")).toBe(200);
  });
});

describe("projectAccount", () => {
  it("at 0% return is the start plus the monthly amount times the months", () => {
    const p = projectAccount({ startValue: 8000, monthlyContribution: 500, annualReturnPct: 0, monthsToWithdraw: 57, withdrawYears: null });
    expect(p.balanceAtWithdraw).toBeCloseTo(8000 + 500 * 57, 6);
    expect(p.contributions).toBe(500 * 57);
    expect(p.growth).toBeCloseTo(0, 6);
    expect(p.points).toHaveLength(58);
    expect(p.points[0]).toEqual({ month: 0, balance: 8000 });
    expect(p.points[57].month).toBe(57);
    expect(p.withdrawals).toEqual([]);
  });

  it("matches the compound-growth formula at a real return", () => {
    const r = 0.07 / 12;
    const n = 120;
    const expected = 10000 * (1 + r) ** n + 500 * (((1 + r) ** n - 1) / r);
    const p = projectAccount({ startValue: 10000, monthlyContribution: 500, annualReturnPct: 7, monthsToWithdraw: n, withdrawYears: null });
    expect(p.balanceAtWithdraw).toBeCloseTo(expected, 4);
    expect(p.growth).toBeCloseTo(expected - 10000 - 500 * n, 4);
  });

  it("a lower return projects a lower number", () => {
    const at = (pct: number) =>
      projectAccount({ startValue: 10000, monthlyContribution: 500, annualReturnPct: pct, monthsToWithdraw: 120, withdrawYears: null }).balanceAtWithdraw;
    expect(at(5)).toBeLessThan(at(7));
  });

  it("with the withdraw month this month, the projection is just today's value", () => {
    const p = projectAccount({ startValue: 1234.5, monthlyContribution: 500, annualReturnPct: 7, monthsToWithdraw: 0, withdrawYears: null });
    expect(p.balanceAtWithdraw).toBe(1234.5);
    expect(p.points).toEqual([{ month: 0, balance: 1234.5 }]);
    expect(p.contributions).toBe(0);
  });

  it("taking everything in one year leaves nothing, and lists that one withdrawal", () => {
    const p = projectAccount({ startValue: 1000, monthlyContribution: 0, annualReturnPct: 0, monthsToWithdraw: 0, withdrawYears: 1 });
    expect(p.withdrawals).toEqual([{ year: 1, month: 0, amount: 1000, balanceAfter: 0 }]);
    expect(p.balanceAtWithdraw).toBe(1000);
  });

  it("spreads over N years: each year takes the balance divided by the years left, and the last leaves $0", () => {
    const p = projectAccount({ startValue: 1000, monthlyContribution: 0, annualReturnPct: 0, monthsToWithdraw: 6, withdrawYears: 4 });
    expect(p.withdrawals.map((w) => w.amount)).toEqual([250, 250, 250, 250]);
    expect(p.withdrawals.map((w) => w.month)).toEqual([6, 18, 30, 42]);
    expect(p.withdrawals.map((w) => w.balanceAfter)).toEqual([750, 500, 250, 0]);
  });

  it("keeps growing between withdrawals", () => {
    const p = projectAccount({ startValue: 1000, monthlyContribution: 0, annualReturnPct: 12, monthsToWithdraw: 0, withdrawYears: 2 });
    const grown = 500 * 1.01 ** 12;
    expect(p.withdrawals[0].amount).toBe(500);
    expect(p.withdrawals[1].amount).toBeCloseTo(grown, 6);
    expect(p.withdrawals[1].balanceAfter).toBe(0);
  });

  it("contributions stop once withdrawals start", () => {
    const p = projectAccount({ startValue: 0, monthlyContribution: 100, annualReturnPct: 0, monthsToWithdraw: 12, withdrawYears: 2 });
    expect(p.balanceAtWithdraw).toBe(1200);
    expect(p.withdrawals.map((w) => w.amount)).toEqual([600, 600]);
  });

  it("the chart points run through the last withdrawal", () => {
    const p = projectAccount({ startValue: 1000, monthlyContribution: 0, annualReturnPct: 0, monthsToWithdraw: 6, withdrawYears: 3 });
    expect(p.points[p.points.length - 1]).toEqual({ month: 30, balance: 0 });
  });
});

describe("toTodaysDollars / deflatePoints", () => {
  it("shrinks a future amount by the inflation compounded over the years", () => {
    expect(toTodaysDollars(1000, 3, 10)).toBeCloseTo(744.09, 2);
    expect(toTodaysDollars(1000, 3, 0)).toBe(1000);
    expect(toTodaysDollars(1000, 0, 25)).toBe(1000);
  });

  it("deflates a month-indexed series by its own distance from now", () => {
    const points = deflatePoints(
      [
        { month: 0, balance: 1000 },
        { month: 120, balance: 1000 },
      ],
      3,
    );
    expect(points[0].balance).toBe(1000);
    expect(points[1].balance).toBeCloseTo(744.09, 2);
  });
});

describe("combineProjections", () => {
  const run = (start: number, months: number, years: number | null) =>
    projectAccount({ startValue: start, monthlyContribution: 0, annualReturnPct: 0, monthsToWithdraw: months, withdrawYears: years });

  it("adds every account's balance at each point in time", () => {
    const combined = combineProjections([run(1000, 24, null), run(500, 36, null)], 12);
    expect(combined.map((p) => p.month)).toEqual([0, 12, 24, 36]);
    expect(combined.map((p) => p.balance)).toEqual([1500, 1500, 1500, 500]);
  });

  it("an account with a drawdown falls to zero after its last year", () => {
    const combined = combineProjections([run(1200, 0, 2)], 12);
    expect(combined.map((p) => p.balance)).toEqual([600, 0]);
  });

  it("always ends on the last month of the longest projection", () => {
    const combined = combineProjections([run(100, 30, null)], 12);
    expect(combined.map((p) => p.month)).toEqual([0, 12, 24, 30]);
  });

  it("is empty for no projections", () => {
    expect(combineProjections([], 12)).toEqual([]);
  });
});

describe("cumulativeNet", () => {
  it("runs the net contributions up month by month", () => {
    const months = [inMonth("2026-05", 600), inMonth("2026-06", 0), inMonth("2026-07", 500, 200)];
    expect(cumulativeNet(months)).toEqual([
      { month: "2026-05", net: 600 },
      { month: "2026-06", net: 600 },
      { month: "2026-07", net: 900 },
    ]);
  });
});

describe("summarizeAccumulation", () => {
  const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].map((m) => inMonth(m, 500));
  const base: SummaryInput = {
    worthNow: 4000,
    months,
    totalIn: 3000,
    totalOut: 0,
    plan: { monthlyContribution: null, annualReturnPct: 0, withdrawMonth: null, withdrawYears: null },
    today: "2026-09-20",
    inflationPct: 3,
    todaysDollars: false,
  };

  it("reports net invested and growth as worth now minus net invested", () => {
    const s = summarizeAccumulation({ ...base, totalOut: 400 });
    expect(s.netInvested).toBe(2600);
    expect(s.growth).toBe(1400);
    const down = summarizeAccumulation({ ...base, worthNow: 2500 });
    expect(down.growth).toBe(-500);
  });

  it("uses the recent average until an amount is saved, and says which it used", () => {
    expect(summarizeAccumulation(base)).toMatchObject({ monthly: 500, monthlySource: "average", averageMonthly: 500 });
    expect(summarizeAccumulation({ ...base, plan: { ...base.plan, monthlyContribution: 650 } })).toMatchObject({
      monthly: 650,
      monthlySource: "saved",
      averageMonthly: 500,
    });
    expect(summarizeAccumulation({ ...base, months: [], totalIn: 0 })).toMatchObject({ monthly: 0, monthlySource: "none", averageMonthly: null });
  });

  it("has no projection until there is a withdraw month", () => {
    const s = summarizeAccumulation(base);
    expect(s).toMatchObject({ status: "no-date", projection: null, projectedFinal: null, monthsToWithdraw: null, withdrawals: [] });
  });

  it("flags a withdraw month that has passed instead of projecting it", () => {
    const s = summarizeAccumulation({ ...base, plan: { ...base.plan, withdrawMonth: "2026-06" } });
    expect(s).toMatchObject({ status: "passed", projection: null, projectedFinal: null });
  });

  it("at 0% the projected number is worth now plus the monthly amount times the months left", () => {
    const s = summarizeAccumulation({ ...base, plan: { ...base.plan, withdrawMonth: "2027-09" } });
    expect(s.status).toBe("ok");
    expect(s.monthsToWithdraw).toBe(12);
    expect(s.projectedFinal).toBeCloseTo(4000 + 500 * 12, 6);
  });

  it("a different return changes the projection but not what is invested or worth now", () => {
    const at = (pct: number) => summarizeAccumulation({ ...base, plan: { ...base.plan, annualReturnPct: pct, withdrawMonth: "2036-09" } });
    expect(at(5).projectedFinal!).toBeLessThan(at(7).projectedFinal!);
    expect(at(5).netInvested).toBe(at(7).netInvested);
    expect(at(5).worthNow).toBe(at(7).worthNow);
  });

  it("in today's dollars only the projected figures shrink", () => {
    const plan = { ...base.plan, withdrawMonth: "2036-09", withdrawYears: 2 };
    const nominal = summarizeAccumulation({ ...base, plan });
    const real = summarizeAccumulation({ ...base, plan, todaysDollars: true });
    expect(real.projectedFinal!).toBeCloseTo(toTodaysDollars(nominal.projectedFinal!, 3, 10), 6);
    expect(real.withdrawals[1].amount).toBeCloseTo(toTodaysDollars(nominal.withdrawals[1].amount, 3, 11), 6);
    expect(real.netInvested).toBe(nominal.netInvested);
    expect(real.worthNow).toBe(nominal.worthNow);
    expect(real.growth).toBe(nominal.growth);
  });

  it("lists the yearly withdrawals when spread over years", () => {
    const s = summarizeAccumulation({ ...base, plan: { ...base.plan, withdrawMonth: "2026-09", withdrawYears: 4, monthlyContribution: 0 } });
    expect(s.withdrawals.map((w) => w.amount)).toEqual([1000, 1000, 1000, 1000]);
  });
});

describe("dateX", () => {
  it("places a date on the month axis, with the day as a fraction of its month", () => {
    expect(dateX("2026-09-01")).toBe(monthIndex("2026-09"));
    expect(dateX("2026-09-16")).toBeCloseTo(monthIndex("2026-09") + 15 / 30, 6);
    expect(dateX("2026-02-15")).toBeCloseTo(monthIndex("2026-02") + 14 / 28, 6);
  });
});

describe("validatePlanForm", () => {
  const ok: PlanFormFields = { monthly: "500", returnPct: "7", withdrawMonth: "2031-06", withdrawYears: "4", inflation: "3" };
  const check = (change: Partial<PlanFormFields>, saved: string | null = null) => validatePlanForm({ ...ok, ...change }, "2026-09-20", saved);

  it("accepts a good plan, and blanks where blanks are allowed", () => {
    expect(check({})).toBeNull();
    expect(check({ monthly: "", withdrawMonth: "", withdrawYears: "" })).toBeNull();
    expect(check({ withdrawMonth: "2026-09" })).toBeNull();
  });

  it("refuses a monthly amount that isn't a number or is negative", () => {
    expect(check({ monthly: "abc" })).toMatch(/monthly amount/i);
    expect(check({ monthly: "1,500" })).toMatch(/monthly amount/i);
    expect(check({ monthly: "-5" })).toMatch(/monthly amount/i);
    expect(check({ monthly: "0" })).toBeNull();
  });

  it("needs a return between 0 and 100", () => {
    expect(check({ returnPct: "" })).toMatch(/return/i);
    expect(check({ returnPct: "101" })).toMatch(/return/i);
    expect(check({ returnPct: "-1" })).toMatch(/return/i);
    expect(check({ returnPct: "0" })).toBeNull();
    expect(check({ returnPct: "100" })).toBeNull();
  });

  it("refuses a withdraw month in the past unless it is the one already saved", () => {
    expect(check({ withdrawMonth: "2026-08" })).toMatch(/in the past/i);
    expect(check({ withdrawMonth: "2026-08" }, "2026-08")).toBeNull();
  });

  it("needs whole withdrawal years from 1 to 50", () => {
    for (const bad of ["0", "51", "2.5", "x", "-3"]) expect(check({ withdrawYears: bad })).toMatch(/1 to 50/);
    expect(check({ withdrawYears: "50" })).toBeNull();
  });

  it("needs inflation between 0 and 100", () => {
    expect(check({ inflation: "" })).toMatch(/inflation/i);
    expect(check({ inflation: "101" })).toMatch(/inflation/i);
    expect(check({ inflation: "2.5" })).toBeNull();
  });
});
