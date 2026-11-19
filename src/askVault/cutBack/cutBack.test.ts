import { describe, expect, it } from "vitest";
import { buildCutBackAnswer, cutBackMonths, isCutBackQuestion, suggestedCut } from "./cutBack";

describe("which questions ask where to cut back", () => {
  it.each([
    "Where can I save money in my budget?",
    "What can I cut back on?",
    "where can we save money",
    "How can I save money?",
    "How could I spend less?",
    "Where can I cut back?",
    "Where should I cut back?",
    "What could we cut back on",
    "Where am I overspending?",
    "Please, where can I save some money on my budget?",
    "How can I reduce my spending?",
    "Where can I cut costs?",
    "where can i cut back on my spending?",
    "How can we cut down on our expenses?",
    "Help me spend less",
    "help me save money",
    "Help us cut back on our spending.",
    "What can I do to save money?",
    "How do I spend less?",
    "Where could I cut down?",
  ])("claims %s", text => expect(isCutBackQuestion(text)).toBe(true));

  it.each([
    "Where can I cut back to save $200 a month?",
    "How can I save $50",
    "How can I save money on Dining",
    "Which categories can I cut?",
    "Which categories should I cut first?",
    "Which spending should I cut to save the most with the least change?",
    "What if I cut Groceries by $50 a month?",
    "did I overspend my budget in june",
    "should I cut back on dining out",
    "How can I save",
    "Help me with my budget",
    "Save $200 in total this year",
    "Help me save $50 on Dining at Costco each month",
    "where can i cut back on dining out",
    "Help me spend less on Groceries",
    "What can I do to save $100?",
  ])("leaves %s to the other readers", text => expect(isCutBackQuestion(text)).toBe(false));
});

describe("the months it reads", () => {
  it("uses the four full months before the current one", () => {
    expect(cutBackMonths("2026-11-19")).toEqual({ from: { year: 2026, month: 7 }, to: { year: 2026, month: 10 }, labels: ["2026-07", "2026-08", "2026-09", "2026-10"] });
    expect(cutBackMonths("2026-02-01")).toEqual({ from: { year: 2025, month: 10 }, to: { year: 2026, month: 1 }, labels: ["2025-10", "2025-11", "2025-12", "2026-01"] });
  });
});

describe("a what-if amount to start from", () => {
  it("is a tenth of the usual month, to the nearest $5 and at least $5", () => {
    expect(suggestedCut("612.40")).toBe("60");
    expect(suggestedCut("640")).toBe("65");
    expect(suggestedCut("12")).toBe("5");
    expect(suggestedCut("0.5")).toBe("5");
  });
});

const line = (category: string, budget_group: string, budgeted: string, actual: string, rollover = "0") =>
  ({ category, budget_group, budgeted, actual, cap_enabled: false, rollover, rollover_enabled: rollover !== "0" });
const cells = (rows: [string, string, string][]) => rows.map(([month, category, amount]) => ({ month, category, amount }));
const recordedMonths = (amount = "1") => cells([["2026-07", "Misc", amount], ["2026-08", "Misc", amount], ["2026-09", "Misc", amount], ["2026-10", "Misc", amount]]);

describe("the answer", () => {
  it("lists categories over budget this month, largest overage first, counting rollover and leaving income out", () => {
    const answer = buildCutBackAnswer({
      today: "2026-11-19",
      cells: recordedMonths(),
      actuals: [
        line("Dining", "flexible", "200", "260"),
        line("Groceries", "flexible", "500", "640"),
        line("Fun", "flexible", "100", "120", "50"),
        line("Salary", "income", "3000", "3500"),
        line("Rent", "fixed", "1500", "1500"),
      ],
    });
    const over = answer.sections.find(s => s.id === "over-budget")!;
    expect(over.heading).toBe("Over budget this month");
    expect(over.rows.map(r => [r.category, r.amount, r.detail])).toEqual([
      ["Groceries", "$640.00", "$140.00 over its $500.00 budget so far"],
      ["Dining", "$260.00", "$60.00 over its $200.00 budget so far"],
    ]);
  });

  it("names flexible categories that were well above their usual month last month, and leaves fixed bills out", () => {
    const answer = buildCutBackAnswer({
      today: "2026-11-19",
      cells: cells([
        ["2026-07", "Dining", "200"], ["2026-08", "Dining", "220"], ["2026-09", "Dining", "180"], ["2026-10", "Dining", "320"],
        ["2026-07", "Groceries", "500"], ["2026-08", "Groceries", "500"], ["2026-09", "Groceries", "500"], ["2026-10", "Groceries", "540"],
        ["2026-07", "Rent", "1500"], ["2026-08", "Rent", "1500"], ["2026-09", "Rent", "1500"], ["2026-10", "Rent", "1900"],
        ["2026-10", "Hobbies", "90"],
      ]),
      actuals: [line("Rent", "fixed", "1500", "0"), line("Dining", "flexible", "250", "0")],
    });
    const up = answer.sections.find(s => s.id === "above-usual")!;
    expect(up.heading).toBe("Higher than usual in October");
    expect(up.rows.map(r => [r.category, r.amount, r.detail])).toEqual([
      ["Dining", "$320.00", "About $200.00 in a usual month (July to September)"],
    ]);
  });

  it("leaves out a category that only appeared last month: one new expense is not a habit", () => {
    const answer = buildCutBackAnswer({ today: "2026-11-19", cells: [...recordedMonths(), ...cells([["2026-10", "Hobbies", "90"]])], actuals: [] });
    expect(answer.sections.find(s => s.id === "above-usual")).toBeUndefined();
  });

  it("keeps the higher-than-usual list to five, biggest increase first", () => {
    const rows = ["A", "B", "C", "D", "E", "F"].flatMap((c, i) => [["2026-07", c, "100"], ["2026-08", c, "100"], ["2026-09", c, "100"], ["2026-10", c, String(200 + i * 10)]] as [string, string, string][]);
    const answer = buildCutBackAnswer({ today: "2026-11-19", cells: cells(rows), actuals: [] });
    expect(answer.sections.find(s => s.id === "above-usual")!.rows.map(r => r.category)).toEqual(["F", "E", "D", "C", "B"]);
  });

  it("ranks the biggest flexible spending over the last three full months with a what-if to try", () => {
    const answer = buildCutBackAnswer({
      today: "2026-11-19",
      cells: cells([
        ["2026-07", "Misc", "1"],
        ["2026-08", "Dining", "300"], ["2026-09", "Dining", "300"], ["2026-10", "Dining", "300"],
        ["2026-08", "Groceries", "600"], ["2026-09", "Groceries", "600"], ["2026-10", "Groceries", "637.30"],
        ["2026-08", "Rent", "1500"], ["2026-09", "Rent", "1500"], ["2026-10", "Rent", "1500"],
        ["2026-08", "Car insurance", "900"],
        ["2026-10", "Uncategorized", "400"],
      ]),
      actuals: [line("Rent", "fixed", "1500", "0"), line("Car insurance", "nonmonthly", "75", "0"), line("Groceries", "flexible", "600", "0")],
    });
    const big = answer.sections.find(s => s.id === "biggest")!;
    expect(big.heading).toBe("Your biggest flexible spending");
    expect(big.rows.map(r => [r.category, r.amount, r.detail, r.tryQuestion])).toEqual([
      ["Groceries", "$612.43", "A month on average, August to October", "What if I cut Groceries by $60 a month?"],
      ["Dining", "$300.00", "A month on average, August to October. No budget line", "What if I cut Dining by $30 a month?"],
      ["Uncategorized", "$133.33", "A month on average, August to October. No budget line", null],
    ]);
  });

  it("keeps the biggest list to five", () => {
    const many = ["A", "B", "C", "D", "E", "F", "G"].flatMap((c, i) => (["2026-08", "2026-09", "2026-10"] as const).map(m => [m, c, String(100 + i)] as [string, string, string]));
    const answer = buildCutBackAnswer({ today: "2026-11-19", cells: cells([["2026-07", "Misc", "1"], ...many]), actuals: [] });
    expect(answer.sections.find(s => s.id === "biggest")!.rows.map(r => r.category)).toEqual(["G", "F", "E", "D", "C"]);
  });

  it("says it needs more history instead of comparing months that have nothing recorded", () => {
    const answer = buildCutBackAnswer({ today: "2026-11-19", cells: cells([["2026-10", "Dining", "320"]]), actuals: [line("Dining", "flexible", "100", "150")] });
    expect(answer.sections.map(s => s.id)).toEqual(["over-budget"]);
    expect(answer.notes).toContain("Record at least four full months of spending to see what was higher than usual and your biggest flexible spending.");
  });

  it("says plainly when nothing stands out", () => {
    const answer = buildCutBackAnswer({ today: "2026-11-19", cells: [], actuals: [] });
    expect(answer.sections).toEqual([]);
    expect(answer.headline).toBe("Nothing to point to yet");
  });

  it("is a set of facts from the person's own records, not advice", () => {
    const answer = buildCutBackAnswer({ today: "2026-11-19", cells: recordedMonths("50"), actuals: [] });
    expect(answer.headline).toBe("Places you could look, from your own records");
    expect(answer.notes.join(" ")).toMatch(/not advice/);
    expect(answer.notes.join(" ")).toMatch(/Fixed and Income budget groups are left out/);
    expect(answer.notes.join(" ")).toMatch(/Recurring/);
  });
});
