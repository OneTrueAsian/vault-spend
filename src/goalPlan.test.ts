import { describe, expect, it } from "vitest";
import { goalPlan } from "./goalPlan";

const TODAY = new Date(2026, 8, 18); // 2026-09-18, local

function goal(over: Partial<{ saved_amount: string; target_amount: string | null; target_date: string | null; monthly_pace: string }> = {}) {
  return { saved_amount: "1200.00", target_amount: "3000.00", target_date: null as string | null, monthly_pace: "200", ...over };
}

describe("goalPlan", () => {
  it("has nothing to project for a goal with no target", () => {
    const plan = goalPlan(goal({ target_amount: null }), TODAY);

    expect(plan.status).toBe("no_target");
    expect(plan.remaining).toBeNull();
    expect(plan.projectedFinish).toBeNull();
    expect(plan.needsPerMonth).toBeNull();
  });

  it("is reached once saved covers the target", () => {
    const plan = goalPlan(goal({ saved_amount: "3000.00" }), TODAY);

    expect(plan.status).toBe("reached");
    expect(plan.remaining).toBe(0);
    expect(plan.needsPerMonth).toBeNull();
  });

  it("projects the finish date from the recent pace", () => {
    // $1,800 left at $200/month = 9 months.
    const plan = goalPlan(goal(), TODAY);

    expect(plan.remaining).toBe(1800);
    expect(plan.projectedFinish).toBe("2027-06-18");
    expect(plan.status).toBe("no_deadline");
  });

  it("is on track when the projected finish beats the target date, and says what it takes", () => {
    const plan = goalPlan(goal({ target_date: "2027-09-18" }), TODAY);

    expect(plan.status).toBe("on_track");
    expect(plan.needsPerMonth).toBeCloseTo(1800 / 12, 0);
  });

  it("is behind when the pace would finish after the target date", () => {
    const plan = goalPlan(goal({ target_date: "2026-12-18" }), TODAY);

    expect(plan.status).toBe("behind");
    // $1,800 over three months.
    expect(plan.needsPerMonth).toBeCloseTo(600, 0);
  });

  it("is behind, with no projected finish, when nothing has been saved recently", () => {
    const plan = goalPlan(goal({ target_date: "2027-09-18", monthly_pace: "0" }), TODAY);

    expect(plan.status).toBe("behind");
    expect(plan.projectedFinish).toBeNull();
    expect(plan.needsPerMonth).toBeCloseTo(150, 0);
  });

  it("without a deadline and without a pace, just says there's no recent progress", () => {
    const plan = goalPlan(goal({ monthly_pace: "-40" }), TODAY);

    expect(plan.status).toBe("no_pace");
    expect(plan.projectedFinish).toBeNull();
  });

  it("wants the whole remainder when the target date has passed", () => {
    const plan = goalPlan(goal({ target_date: "2026-08-01" }), TODAY);

    expect(plan.status).toBe("behind");
    expect(plan.needsPerMonth).toBe(1800);
  });

  it("wants the whole remainder when less than a month is left", () => {
    const plan = goalPlan(goal({ target_date: "2026-10-01" }), TODAY);

    expect(plan.needsPerMonth).toBe(1800);
  });

  it("won't project a finish date decades away", () => {
    const plan = goalPlan(goal({ monthly_pace: "1" }), TODAY);

    expect(plan.projectedFinish).toBeNull();
    expect(plan.status).toBe("no_pace");
  });
});
