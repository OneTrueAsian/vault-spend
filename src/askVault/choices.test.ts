import { describe, expect, it } from "vitest";
import { parseQuestion } from "./parser";
import type { ParseContext } from "./types";

// Every clarification should be answerable by one click: each choice comes with the question to ask next.
const context: ParseContext = {
  today: "2026-09-06",
  categories: ["Groceries", "Dining", "Dining Out", "Shopping"],
  accounts: [{ id: 1, name: "Everyday Checking" }],
  merchants: ["SAMS CLUB #6482", "Samantha's Bakery"],
  members: [],
  historyStart: "2025-09-01",
};

function clarify(question: string) {
  const result = parseQuestion(question, context);
  if (result.status !== "clarify") throw new Error(`${question} -> ${JSON.stringify(result)}`);
  return result;
}

describe("a clarification comes with a question for each choice", () => {
  it("two categories that fit a typed name", () => {
    const r = clarify("total spending on din last month");
    expect(r.choices).toEqual(["Dining", "Dining Out"]);
    expect(r.replacements).toEqual(['total spending on "dining" last month', 'total spending on "dining out" last month']);
    for (const q of r.replacements!) expect(parseQuestion(q, context).status).toBe("query");
  });

  it("a missing period offers three common ones", () => {
    const r = clarify("how much did I spend on groceries");
    expect(r.choices).toEqual(["Last month", "This month so far", "This year so far"]);
    expect(r.replacements!.map((q) => parseQuestion(q, context).status)).toEqual(["query", "query", "query"]);
    expect(r.replacements![0]).toBe("how much did i spend on groceries last month");
  });

  it("a month the history holds twice", () => {
    const r = clarify("groceries in september");
    expect(r.choices).toEqual(["September 2025", "September 2026"]);
    expect(r.replacements).toEqual(["groceries in september 2025", "groceries in september 2026"]);
    expect(r.replacements!.map((q) => parseQuestion(q, context).status)).toEqual(["query", "query"]);
  });

  it("categories or purchases", () => {
    const r = clarify("top 3 spending last month");
    expect(r.choices).toEqual(["Categories", "Purchases"]);
    expect(r.replacements!.map((q) => (parseQuestion(q, context) as { request?: { kind: string } }).request?.kind)).toEqual(["rank-categories", "rank-purchases"]);
  });

  it("how many results", () => {
    const r = clarify("top spending categories last month");
    expect(r.choices).toEqual(["3", "5", "10"]);
    expect(r.replacements!.map((q) => (parseQuestion(q, context) as { request?: { limit: number } }).request?.limit)).toEqual([3, 5, 10]);
  });

  it("a store name that fits two different stores still works (already covered), and a quoted choice is final", () => {
    const r = clarify("how much did I spend at sam last month");
    expect(r.replacements!.map((q) => parseQuestion(q, context).status)).toEqual(["query", "query", "query"]);
  });

  it("a clarification with nothing to click has no replacements", () => {
    const r = clarify('total spending on "Boats" last month');
    expect(r.replacements).toBeUndefined();
  });
});
