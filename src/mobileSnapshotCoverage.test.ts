import { describe, expect, it } from "vitest";
import fixture from "../core/tests/fixtures/mobile_snapshot_v1.json";
import { parseMobileSnapshot } from "./mobileSnapshot";
import { goalPlan } from "./goalPlan";
import { projectGoal } from "./projections";
import { projectAccount, summarizeAccumulation } from "./accumulation";

describe("snapshot aggregate inputs support existing offline calculations", () => {
  it("supplies all accumulation inputs including saved-date and nullable contribution semantics", () => {
    const s = parseMobileSnapshot(JSON.stringify(fixture));
    const a = s.calculators.accumulation[0];
    const value = s.accounts.find(account => account.id === a.accountId)!.balance;
    const summary = summarizeAccumulation({
      worthNow: Number(value), totalIn: Number(a.totalIn), totalOut: Number(a.totalOut),
      months: a.months.map(m => ({ month: m.month, moneyIn: Number(m.moneyIn), moneyOut: Number(m.moneyOut) })),
      plan: { monthlyContribution: a.plan.monthlyContribution === null ? null : Number(a.plan.monthlyContribution), annualReturnPct: Number(a.plan.annualReturnPct), withdrawMonth: a.plan.withdrawMonth, withdrawYears: a.plan.withdrawYears },
      today: s.asOfDate, inflationPct: Number(s.calculators.inflationPct), todaysDollars: false,
    });
    expect(summary.monthsToWithdraw).toBe(120);
    expect(summary.monthlySource).toBe("average");
    expect(summary.monthly).toBe(200);
    expect(summary.projection).not.toBeNull();
    // Contribution growth differs from unrealized holding gain; neither replaces the other.
    expect(summary.growth).toBe(14800);
    expect(s.investments.unrealizedGain).toBe("1000.00");
  });
  it("supplies refund-aware budget trends even before a category had a budget", () => {
    const s = parseMobileSnapshot(JSON.stringify(fixture));
    expect(s.history.categories.find(c => c.category === "Groceries" && c.month === "2026-09")!.spending).toBe("350.00");
    expect(-Number(s.history.budgetCategoryNet.find(c => c.category === "Groceries" && c.month === "2026-09")!.signedAmount)).toBe(250);
  });
  it("supplies nullable goal assumptions and observed pace to the desktop pure helper", () => {
    const s = parseMobileSnapshot(JSON.stringify(fixture)); const g = s.calculators.goals[0];
    const result = goalPlan({ saved_amount: g.saved, target_amount: g.target, target_date: g.targetDate, monthly_pace: g.monthlyPace }, new Date(`${s.asOfDate}T00:00:00`));
    expect(result).toMatchObject({ status: "on_track", needsPerMonth: 100, remaining: 1000, projectedFinish: "2027-08-04" });
  });
  it("locks the approved growth and withdrawal oracles before mobile UI implementation", () => {
    expect(projectGoal(1000, 100, 0, 1)[1].balance).toBe(2200);
    expect(projectGoal(1000, 0, 12, 1)[1].balance).toBeCloseTo(1126.8250301319698, 8);
    const p = projectAccount({ startValue: 1000, monthlyContribution: 100, annualReturnPct: 0, monthsToWithdraw: 12, withdrawYears: 2 });
    expect(p.balanceAtWithdraw).toBe(2200);
    expect(p.withdrawals.map(w => w.amount)).toEqual([1100, 1100]);
    expect(p.points[p.points.length - 1].balance).toBe(0);
  });
});
