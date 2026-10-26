import { beforeEach, describe, expect, it, vi } from "vitest";

// M6 F-T5-01 (Requirements-Checklist PF-05/PF-11). The approved cold run failed (review p95 1209.5 ms against 542.8 ms) after the extra-money and
// spending-scenario readers began asking "is this an ordinary store question?" BEFORE they knew whether the question was theirs at all. That check
// reads the whole question with the ordinary parser, which walks the store roster. Each test below counts ordinary parses along the real claim order
// (publicRouteParseCount.test.tsx pins the same order through the card). This file asserts only WHICH readers parse, never how long a parse takes.
const calls = vi.hoisted(() => ({ parse: 0 }));
vi.mock("./parser", async importOriginal => {
  const actual = await importOriginal<typeof import("./parser")>();
  return { ...actual, parseQuestion: (...args: Parameters<typeof actual.parseQuestion>) => { calls.parse += 1; return actual.parseQuestion(...args); } };
});
import { parseCutPreview } from "./cutPreviewParser";
import { parseRetirementScenario } from "./retirementParser";
import { parseSpendingScenario } from "./spendingScenarioParser";

let merchants: string[];
const base = () => ({ today: "2026-10-20", categories: ["Dining", "Groceries", "Retirement Gifts"], accounts: [{ id: 1, name: "Checking" }, { id: 5, name: "Roth IRA" }],
  investmentAccounts: [{ id: 5, name: "Roth IRA" }], merchants, members: [] as string[], familyMembers: [] as { id: number; name: string }[], historyStart: "2025-01-01" });
// The card hands the extra-money reader a reduced context (useRetirementScenario.ts ask): same roster list, fewer fields.
const reduced = (over: Record<string, unknown> = {}) => { const { today, categories, investmentAccounts, merchants: roster } = { ...base(), ...over }; return { today, categories, investmentAccounts, merchants: roster }; };
const WHAT_IF = "Cut Groceries by $5 monthly from January to December 2027";

beforeEach(() => { calls.parse = 0; merchants = ["WHOLE FOODS MARKET #12", "CUT ABOVE SALON", "COSTCO WHSE", "EXTRA RETIREMENT CAFE #4", "CUT DINING SALON #3"]; });

describe("a reader reads the question as an ordinary store question only after the question could be its own", () => {
  it("the extra-money reader leaves a spending what-if alone without reading it as an ordinary question", () => {
    expect(parseRetirementScenario(WHAT_IF, reduced() as never)).toBeNull();
    expect(calls.parse).toBe(0);
  });
  it("the spending reader does not read a question it will not claim", () => {
    expect(parseSpendingScenario("how much did I spend at Cut Above in July", base())).toBeNull();
    expect(calls.parse).toBe(0);
  });
  it("in the card's claim order a spending what-if is read as an ordinary question once, by the reader that claims it", () => {
    expect(parseCutPreview(WHAT_IF, base() as never)).toBeNull();
    expect(parseRetirementScenario(WHAT_IF, reduced() as never)).toBeNull();
    const parsed = parseSpendingScenario(WHAT_IF, base());
    expect(parsed?.kind).toBe("scenario");
    expect(calls.parse).toBe(1);
  });
});

// Guards: these hold before and after the change. Reading later must never let a reader claim what an ordinary store name should keep.
describe("the ordinary store reading still keeps its questions", () => {
  it("a store whose name holds the extra-money words stays an ordinary question, not an investment scenario", () => {
    expect(parseRetirementScenario("spending at Extra Retirement Cafe over $20 last month", reduced() as never)).toBeNull();
  });
  it("the same words with no such store recorded are still the extra-money reader's", () => {
    merchants = ["WHOLE FOODS MARKET #12"];
    expect(parseRetirementScenario("Extra $50 a month into my Roth IRA until January 2060", reduced() as never)).not.toBeNull();
  });
  it("a store named like the cut keeps the question ambiguous instead of silently choosing either meaning", () => {
    expect(parseSpendingScenario("Cut Dining", base())).toMatchObject({ kind: "scenario-clarify" });
  });
  it("a new roster list is read again, never answered from an earlier list", () => {
    const first = parseSpendingScenario("Cut Dining", base());
    merchants = ["WHOLE FOODS MARKET #12"];
    const second = parseSpendingScenario("Cut Dining", base());
    expect(first?.kind).toBe("scenario-clarify");
    expect(second?.kind).toBe("scenario");
  });
});
