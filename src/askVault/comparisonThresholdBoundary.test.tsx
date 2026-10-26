// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AskVaultCard } from "../AskVaultCard";
import { answer, request as oracleRequest } from "../testSupport/askVaultM6/referenceOracle";
import type { World } from "../testSupport/askVaultM6/referenceWorld";
import type { ParseContext } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Owner instruction Q3: strict versus inclusive thresholds and parent-amount filtering, with exact results for BOTH periods, on a world that actually has purchases on
 * the boundary (the frozen corpus worlds have none; see comparisonThreshold.test.tsx). Real card, app-shaped context (a family list, DashboardView.tsx:321-322).
 * The replies are the independent M2 oracle's; every figure below is worked by hand from the ledger. Written after the behavior existed (characterization).
 *
 *   October 1-20 (this month so far)            September (last month)
 *   #1 100.00 Clothing  (on the boundary)       #5  99.99 Clothing
 *   #2 100.01 Clothing                          #6 200.00 Clothing
 *   #3  99.99 Clothing                          #7  50.00 Clothing
 *   #4 150.00 split: Clothing 60.00 + Groceries 90.00 (parent 150.00 qualifies; its 60.00 allocation alone would not)
 *
 *   over 100.00:        Oct 100.01 + 60.00 = 160.01 (2)   Sep 200.00 (1)   difference -39.99
 *   at least 100.00:    Oct 100.00 + 100.01 + 60.00 = 260.01 (3)   Sep 200.00 (1)   difference +60.01
 *   over 100.01:        Oct 60.00 (1)   Sep 200.00 (1)   difference -140.00
 *   at least 100.01:    Oct 100.01 + 60.00 = 160.01 (2)   Sep 200.00 (1)   difference -39.99
 */
const TODAY = "2026-10-20";
const world: World = { name: "boundary", today: TODAY, members: [], accounts: [{ id: 1, name: "Checking", memberId: null }], categories: ["Clothing", "Groceries"], ledger: [
  { id: 1, accountId: 1, date: "2026-10-03", description: "SHOP A", cents: -10000, category: "Clothing", memberId: null },
  { id: 2, accountId: 1, date: "2026-10-04", description: "SHOP B", cents: -10001, category: "Clothing", memberId: null },
  { id: 3, accountId: 1, date: "2026-10-05", description: "SHOP C", cents: -9999, category: "Clothing", memberId: null },
  { id: 4, accountId: 1, date: "2026-10-06", description: "BIG STORE", cents: -15000, category: null, memberId: null, splits: [{ category: "Clothing", cents: -6000 }, { category: "Groceries", cents: -9000 }] },
  { id: 5, accountId: 1, date: "2026-09-02", description: "SHOP A", cents: -9999, category: "Clothing", memberId: null },
  { id: 6, accountId: 1, date: "2026-09-03", description: "SHOP D", cents: -20000, category: "Clothing", memberId: null },
  { id: 7, accountId: 1, date: "2026-09-04", description: "SHOP E", cents: -5000, category: "Clothing", memberId: null },
] };
const ctx: ParseContext = { today: TODAY, categories: ["Clothing", "Groceries"], accounts: [{ id: 1, name: "Checking" }], merchants: ["SHOP A", "SHOP B", "SHOP C", "SHOP D", "SHOP E", "BIG STORE"], members: [], familyMembers: [], historyStart: "2026-01-01" };
const periods = [{ from: "2026-10-01", to: TODAY }, { from: "2026-09-01", to: "2026-09-30" }];
const full = (amount: string, inclusive: boolean) => ({ kind: "compare", periods, accountIds: [], categories: ["Clothing"], minimumPurchase: { amount, inclusive }, vendors: [], excludeVendors: [], excludeCategories: [], limit: 1, expectedRevision: null });

const CASES: [string, string, boolean, string[], [string, number][]][] = [
  ["compare clothing over $100 this month to last month", "100.00", false, ["$160.01", "$200.00", "$39.99 less"], [["160.01", 2], ["200.00", 1]]],
  ["compare clothing at least $100 this month to last month", "100.00", true, ["$260.01", "$200.00", "$60.01 more"], [["260.01", 3], ["200.00", 1]]],
  ["compare clothing over $100.01 this month to last month", "100.01", false, ["$60.00", "$200.00", "$140.00 less"], [["60.00", 1], ["200.00", 1]]],
  ["compare clothing at least $100.01 this month to last month", "100.01", true, ["$160.01", "$200.00", "$39.99 less"], [["160.01", 2], ["200.00", 1]]],
];
let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });
async function ask(question: string) {
  const askVault = vi.fn(async (req: Record<string, unknown>) => {
    const { contractVersion: _v, ...rest } = req;
    return { ...answer(world, oracleRequest({ ...(rest as unknown as Parameters<typeof oracleRequest>[0]), members: { ids: [], unassigned: false } })), revision: { local: 1, external: 1 } };
  });
  const client = { askVault, askVaultBaselines: vi.fn(), dispose: vi.fn(), askVaultRetirementAccounts: vi.fn(), askVaultRetirementContext: vi.fn() };
  act(() => root.render(<AskVaultCard getContext={() => ctx} legacyAsk={() => ({ matched: false, answer: "no" })} dataKey="b" reloadKey="b" accountNames={new Map()} createClient={() => client as never} />));
  const box = container.querySelector<HTMLInputElement>(".ledger-qa-card input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, question); box.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { container.querySelector<HTMLFormElement>(".ledger-qa-card form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  return { askVault, text: container.querySelector(".ledger-qa-card")?.textContent ?? "" };
}

describe("comparison thresholds on the boundary: strict versus inclusive, parent amount, both periods", () => {
  it.each(CASES)("%s", async (question, amount, inclusive, figures, totals) => {
    const { askVault, text } = await ask(question);
    expect(askVault).toHaveBeenCalledTimes(1);
    expect(askVault.mock.calls[0][0]).toEqual(full(amount, inclusive));
    for (const figure of figures) expect(text).toContain(figure);
    const snapshot = answer(world, oracleRequest({ ...(full(amount, inclusive) as unknown as Parameters<typeof oracleRequest>[0]), members: { ids: [], unassigned: false } }));
    expect(snapshot.periods.map(p => [p.total, p.purchaseCount])).toEqual(totals);
    expect(snapshot.thresholdBasis).toBe("absolute-parent-amount");
  });
  it("the four thresholds give four different outcomes, so a swapped flag or a rounded amount would be caught", async () => {
    const seen = new Set<string>();
    for (const [question] of CASES) { const { text } = await ask(question); seen.add(text.replace(/\s+/g, " ")); }
    expect(seen.size).toBe(4);
  });
  it("the parent qualifies the split: its 60.00 Clothing allocation is counted although 60.00 is under the threshold", async () => {
    const { text } = await ask("compare clothing over $100.01 this month to last month");
    expect(text).toContain("$60.00");
  });
});
