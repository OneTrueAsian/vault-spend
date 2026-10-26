// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AskVaultCard } from "../AskVaultCard";
import { checkDisplay } from "../testSupport/askVaultM6/routeHarness";
import { summaryProblems } from "../testSupport/askVaultM6/displayCheck";
import type { ReplyValue } from "../testSupport/askVaultM6/displayCheck";
import { EXAMPLE_PARSE_CONTEXT, EXAMPLE_WORLD } from "../testSupport/askVaultM6/exampleMap";
import { answer, request as oracleRequest } from "../testSupport/askVaultM6/referenceOracle";
import type { ParseContext } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Owner instruction of 21 October 2026: the harness must not grant full-result credit because one expected amount appears. The display check must catch a wrong
 * row order, label, amount, detail, count and headline. Each negative case below renders a real answer, then verifies it against a deliberately altered expectation
 * (the card is correct; the expectation is wrong), and the check must report a problem. The unaltered expectation must report none.
 * Replies are the independent M2 oracle's over the provisioned example profile (hand-worked in exampleMap.ts). Written after the checker existed (characterization),
 * with the negatives as its detection-power evidence.
 */
let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

async function render(question: string): Promise<{ value: ReplyValue; card: Element }> {
  let value: ReplyValue | undefined;
  const client = { askVault: vi.fn(async (req: Record<string, unknown>) => {
    const { contractVersion: _v, ...rest } = req;
    value = answer(EXAMPLE_WORLD, oracleRequest({ ...(rest as unknown as Parameters<typeof oracleRequest>[0]), members: (req.members as never) ?? { ids: [], unassigned: false } })) as unknown as ReplyValue;
    return { ...value, revision: { local: 1, external: 1 } };
  }), askVaultBaselines: vi.fn(), dispose: vi.fn(), askVaultRetirementAccounts: vi.fn(), askVaultRetirementContext: vi.fn() };
  act(() => root.render(<AskVaultCard getContext={() => EXAMPLE_PARSE_CONTEXT as unknown as ParseContext} legacyAsk={() => ({ matched: false, answer: "no" })} dataKey="d" reloadKey="d" accountNames={new Map()} createClient={() => client as never} />));
  const box = container.querySelector<HTMLInputElement>(".ledger-qa-card input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, question); box.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { container.querySelector<HTMLFormElement>(".ledger-qa-card form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  return { value: value!, card: container.querySelector(".ledger-qa-card")! };
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const mutate = (value: ReplyValue, change: (v: ReplyValue) => void) => { const v = clone(value); change(v); return v; };

describe("display check: a faithful display passes, for every kind and for lists longer than the inline rows", () => {
  it.each([
    ["top 3 spending categories this year"],
    ["my three biggest expenses last month"],
    ["top 10 purchases this year"],
    ["what did each family member spend last month"],
    ["how much did I spend on groceries last month"],
    ["compare this month to last month"],
    ["how much did I spend at Meijer and Target last month"],
    ["average purchase on groceries last month"],
    ["average groceries per month this year"],
    ["compare groceries so far this month to the same days last month"],
  ])("%s", async question => {
    const { value, card } = await render(question);
    expect(await checkDisplay(value, card)).toEqual([]);
  });
  it("a long ranking is verified in full: the inline five and then all ten rows in the opened list", async () => {
    const { value, card } = await render("top 10 purchases this year");
    expect(value.periods[0].purchases).toHaveLength(10);
    expect(await checkDisplay(value, card)).toEqual([]);
    expect(document.querySelectorAll('[role="dialog"] .ledger-qa-rows li').length).toBe(10);
  });
});

describe("task-4 final review: null averages and missing recording evidence", () => {
  it.each(["per-month", "per-purchase"] as const)("%s unavailable never earns a numeric display pass", basis => {
    const value = { kind: "total", difference: null, periods: [{ total: "300.00", purchaseCount: 2,
      average: { basis, value: null, numerator: "0.00", denominator: 0 } }] };
    const card = document.createElement("div");
    card.innerHTML = '<p class="ledger-qa-headline"></p><p class="ledger-qa-detail">$300.00 recorded</p>';
    const headline = card.querySelector(".ledger-qa-headline")!;
    headline.textContent = basis === "per-month" ? "No monthly average available on Groceries." : "No purchases to average on Groceries.";
    expect(summaryProblems(value, card)).toEqual([]);
    headline.textContent = "You averaged $0.00 per month.";
    expect(summaryProblems(value, card).join(" | ")).toMatch(/average headline/);
    headline.textContent = basis === "per-month" ? "No monthly average available." : "No purchases to average.";
    card.querySelector(".ledger-qa-detail")!.textContent = "$0.00 recorded";
    expect(summaryProblems(value, card).join(" | ")).toMatch(/average detail/);
  });
});

describe("task-4 final review: comparison percentages and month evidence are financial display obligations", () => {
  it.each<[string, string, string, string, RegExp]>([
    ["a wrong percentage", "compare groceries so far this month to the same days last month", ".ledger-qa-detail", "That is $288.50 less. That is 99.9% less.", /percentage/],
    ["an invented percentage on unequal periods", "compare this month to last month", ".ledger-qa-detail", "That is $1,781.50 less. That is 95.0% less.", /percentage/],
    ["a wrong comparison date range", "compare this month to last month", "table.ledger-qa-breakdown tbody tr td:last-child", "January 1 to January 31, 1999 · 31 days", /row 1 detail/],
    ["a missing comparison label", "compare this month to last month", "table.ledger-qa-breakdown tbody tr th", "", /row 1 label/],
    ["wrong monthly recording coverage", "average groceries per month this year", "table.ledger-qa-breakdown tbody tr td:last-child", "999 purchases · Records support a full month · Included in average", /row 1 detail/],
  ])("rejects %s", async (_label, question, selector, wrongText, expected) => {
    const { value, card } = await render(question);
    expect(await checkDisplay(value, card)).toEqual([]);
    const field = card.querySelector(selector as string);
    expect(field).not.toBeNull();
    field!.textContent = wrongText as string;
    expect((await checkDisplay(value, card)).join(" | ")).toMatch(expected as RegExp);
  });
});

describe("display check: errors that one matching amount would hide are caught before full-result credit", () => {
  const categories = "top 3 spending categories this year", purchasesQ = "my three biggest expenses last month", longQ = "top 10 purchases this year";
  const cases: [string, string, (v: ReplyValue) => void, RegExp][] = [
    ["ranked categories in the wrong order", categories, v => { const c = v.periods[0].categories!; [c[1], c[2]] = [c[2], c[1]]; }, /row 2/],
    ["a wrong label on a later row", categories, v => { v.periods[0].categories![2].category = "Entertainment"; }, /row 3 label/],
    ["a wrong amount on a later row", categories, v => { v.periods[0].categories![1].amount = "413.51"; }, /row 2 amount/],
    ["a wrong purchase count on a row", categories, v => { v.periods[0].categories![0].purchaseCount = 2; }, /row 1 detail/],
    ["a missing last row", categories, v => { v.periods[0].categories!.pop(); }, /expected 2/],
    ["an extra row", categories, v => { v.periods[0].categories!.push({ category: "Pets", amount: "1.00", purchaseCount: 1 }); }, /expected 4/],
    ["ranked purchases in the wrong order", purchasesQ, v => { const p = v.periods[0].purchases!; [p[0], p[1]] = [p[1], p[0]]; }, /row 1/],
    ["a wrong store name on a purchase", purchasesQ, v => { v.periods[0].purchases![2].description = "TARGET T-1204"; }, /row 3 label/],
    ["a wrong date on a purchase", purchasesQ, v => { v.periods[0].purchases![1].date = "2026-09-06"; }, /row 2 detail/],
    ["a wrong amount on the last of ten ranked purchases (only visible in the full list)", longQ, v => { v.periods[0].purchases![9].amount = "1.00"; }, /full list row 10 amount/],
    ["a wrong store on the sixth of ten ranked purchases (beyond the inline rows)", longQ, v => { v.periods[0].purchases![5].description = "NOT A STORE"; }, /full list row 6 label/],
    ["a wrong member amount", "what did each family member spend last month", v => { v.periods[0].memberTotals![1].total = "97.51"; }, /row 3 amount|row 2 amount/],
    ["a wrong headline total", "how much did I spend on groceries last month", v => { v.periods[0].total = "338.51"; }, /headline lacks/],
    ["a wrong purchase count", "how much did I spend on groceries last month", v => { v.periods[0].purchaseCount = 5; }, /detail lacks/],
    ["a comparison whose second total is wrong", "compare this month to last month", v => { v.periods[1].total = "1856.51"; }, /headline lacks/],
    ["a comparison whose difference is the wrong direction", "compare this month to last month", v => { v.difference = "1781.50"; }, /detail lacks/],
    ["store rows with a wrong amount", "how much did I spend at Meijer and Target last month", v => { v.periods[0].vendorTotals![1].total = "41.01"; }, /row 2 amount/],
    ["store rows with a wrong name", "how much did I spend at Meijer and Target last month", v => { v.periods[0].vendorTotals![1].term = "another store"; }, /row 2 label/],
  ];
  it.each(cases)("%s", async (_name, question, change, expected) => {
    const { value, card } = await render(question);
    const problems = await checkDisplay(mutate(value, change), card);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" | ")).toMatch(expected);
  });
});

describe("task-4 final review: the actual displayed average and its arithmetic must be checked", () => {
  // Validation-Plan VP-06/08/11; guide step 4: full displayed financial outputs, not just a correct mocked reply.
  // Characterization plus deliberate DOM faults against an independently computed example reply.
  it.each<[string, string, string, string, RegExp]>([
    ["per-purchase amount", "average purchase on groceries last month", ".ledger-qa-headline", "You averaged $999.99 per purchase last month.", /average headline/],
    ["per-purchase divisor", "average purchase on groceries last month", ".ledger-qa-detail", "$338.50 ÷ 999 purchases", /average detail/],
    ["monthly amount", "average groceries per month this year", ".ledger-qa-headline", "You averaged $999.99 per month this year.", /average headline/],
    ["monthly basis", "average groceries per month this year", ".ledger-qa-headline", "You averaged $56.42 per purchase this year.", /average headline/],
    ["a total relabelled as an average", "how much did I spend on groceries last month", ".ledger-qa-headline", "You averaged $999.99 per purchase last month.", /headline lacks/],
  ])("rejects a wrong %s even when the returned financial snapshot is right", async (_label, question, selector, wrongText, expected) => {
    const { value, card } = await render(question);
    expect(await checkDisplay(value, card)).toEqual([]);
    const field = card.querySelector(selector);
    expect(field).not.toBeNull();
    field!.textContent = wrongText as string;
    expect((await checkDisplay(value, card)).join(" | ")).toMatch(expected as RegExp);
  });
});
