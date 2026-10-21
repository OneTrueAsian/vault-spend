import { beforeEach, describe, expect, it, vi } from "vitest";

// M6 R4-04 (Requirements-Checklist PF-02/PF-06; guide: dependency-scoped reuse). The card asks the savings-target, extra-money and
// spending-cut readers in turn; each asks ordinaryOperatorStore whether the same question is an ordinary store question. That is one
// parse of one question, not three: the ordinary parser walks the whole roster for an unknown store name.
const calls = vi.hoisted(() => ({ parse: 0 }));
vi.mock("./parser", async importOriginal => {
  const actual = await importOriginal<typeof import("./parser")>();
  return { ...actual, parseQuestion: (...args: Parameters<typeof actual.parseQuestion>) => { calls.parse += 1; return actual.parseQuestion(...args); } };
});
import { ordinaryOperatorStore } from "./savingLead";
import { parseCutPreview } from "./cutPreviewParser";
import { parseRetirementScenario } from "./retirementParser";
import { parseSpendingScenario } from "./spendingScenarioParser";

// A new list per test, as a newly loaded ledger gives a new list: the reading is remembered per list.
let merchants: string[];
// The card's getContext builds a fresh object each time but hands over the same memoized merchant list.
const context = (over: Record<string, unknown> = {}) => ({ today: "2026-10-20", categories: ["Dining", "Groceries"], accounts: [{ id: 1, name: "Checking" }], merchants, members: [], familyMembers: [], historyStart: "2025-01-01", ...over });
const QUESTION = "spending at Cut Above over $20 last month";

beforeEach(() => { calls.parse = 0; merchants = ["WHOLE FOODS MARKET #12", "CUT ABOVE SALON", "COSTCO WHSE"]; });

describe("the ordinary-store check reads one question once", () => {
  it("three readers asking about the same question in the same context parse it once", () => {
    ordinaryOperatorStore(QUESTION, context()); ordinaryOperatorStore(QUESTION, context()); ordinaryOperatorStore(QUESTION, context());
    expect(calls.parse).toBe(1);
  });
  it("the card's three real readers in claim order share that one parse", () => {
    const text = "Cut Dining by $50 a month from November through December 2026";
    parseCutPreview(text, context()); parseRetirementScenario(text, context() as never); parseSpendingScenario(text, context() as never);
    expect(calls.parse).toBe(1);
  });
  it("the answer is the same as without sharing", () => {
    const first = ordinaryOperatorStore(QUESTION, context()), again = ordinaryOperatorStore(QUESTION, context());
    expect(first).not.toBeNull(); expect(again).toEqual(first);
    expect(ordinaryOperatorStore("Cut Dining by $50 a month from November through December 2026", context())).toBeNull();
  });
  it.each<[string, () => Record<string, unknown>]>([
    ["a different day", () => ({ today: "2026-10-21" })],
    ["a changed category list", () => ({ categories: ["Dining"] })],
    ["a changed account list", () => ({ accounts: [] })],
    ["a changed family list", () => ({ familyMembers: [{ id: 1, name: "Sam" }], members: ["Sam"] })],
    ["a different history start", () => ({ historyStart: "2026-01-01" })],
    ["a different roster of stores (a new list)", () => ({ merchants: [...merchants] })],
  ])("%s is read again, never answered from the earlier parse", (_name, over) => {
    ordinaryOperatorStore(QUESTION, context()); ordinaryOperatorStore(QUESTION, context(over()));
    expect(calls.parse).toBe(2);
  });
  it("a different question is read again, and a store that is no longer recorded is not remembered as one", () => {
    ordinaryOperatorStore(QUESTION, context()); ordinaryOperatorStore("spending at Cut Above last month", context());
    expect(calls.parse).toBe(2);
    expect(ordinaryOperatorStore(QUESTION, context({ merchants: ["COSTCO WHSE"] }))).toBeNull();
  });
});
