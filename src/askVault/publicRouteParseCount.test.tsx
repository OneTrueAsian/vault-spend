// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AskVaultRequest, AskVaultRequestV2, ParseContext } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Task-4 gap F5 (Requirements-Checklist PF-02; Task4-Overnight-Validation F5). savingLeadParseOnce.test.ts proves readers handed IDENTICAL context share
 * one parse. This file counts parses along the REAL public route: the card asks the savings-target, extra-money and spending-scenario readers in
 * claim order (AskVaultCard.tsx runQuestion) and only then calls the ordinary controller (useAskVault.ts -> controller.ts askVault), which parses again.
 *
 * Disclosure: these are CHARACTERIZATION tests; they passed once the expected counts were corrected and there was no RED run. My first expectation
 * (two parses, as the review probe suggested) was wrong: the probe called the readers with one shared context, but the card gives the retirement
 * reader a reduced one, so the real route parses three times for an operator-word store question. The tests pin the real counts so a change cannot
 * silently add a parse or silently remove one.
 *
 * M6 F-T5-01 update (this session, same author, tests first: scenarioOrdinaryCheckOrder.test.ts was RED before the change): the extra-money reader no
 * longer reads a question as an ordinary store question until its own cheap wording gate says the question could be its. The spending-scenario reader no
 * longer reads one it will not claim. The counts below were changed from 3/2/3 to 2/1/1 for exactly that reason; the retained cross-context point
 * still holds (no reading is shared between different contexts). Original note: nothing is removed here: reusing a reading across different contexts, or reusing it in the ordinary
 * controller (which parses with the context and member selection read at ask time, useAskVault.ts:148), would couple it to interpretation, freshness and
 * consent timing, which this task must not change. The 206 ms retained diagnostic is not a protocol pass and no benchmark was run.
 */
const calls = vi.hoisted(() => ({ parse: 0 }));
vi.mock("./parser", async importOriginal => {
  const actual = await importOriginal<typeof import("./parser")>();
  return { ...actual, parseQuestion: (...args: Parameters<typeof actual.parseQuestion>) => { calls.parse += 1; return actual.parseQuestion(...args); } };
});
import { AskVaultCard } from "../AskVaultCard";

const TODAY = "2026-10-20";
const ctx: ParseContext = {
  today: TODAY, categories: ["Dining Out", "Dining", "Groceries", "Rent"], accounts: [{ id: 1, name: "Everyday Checking" }, { id: 5, name: "Roth IRA" }],
  investmentAccounts: [{ id: 5, name: "Roth IRA" }], merchants: ["WHOLE FOODS MARKET #12", "COSTCO WHSE", "MEIJER #55", "TARGET T-1204", "CUT ABOVE SALON"],
  members: ["Sam", "Robin"], familyMembers: [{ id: 1, name: "Sam" }, { id: 2, name: "Robin" }], historyStart: "2025-09-01",
};
type Spend = (request: AskVaultRequest | AskVaultRequestV2) => Promise<unknown>;
let container: HTMLDivElement, root: Root;
const askVault = vi.fn<Spend>(async () => { throw new Error("stop"); });
const retirementAccounts = vi.fn(async () => { throw new Error("stop"); }), retirementContext = vi.fn(async () => { throw new Error("stop"); });
const client = () => ({ askVault, askVaultBaselines: vi.fn(async () => { throw new Error("stop"); }), dispose: vi.fn(),
  askVaultRetirementAccounts: retirementAccounts, askVaultRetirementContext: retirementContext });
const legacy = vi.fn((_q: string) => ({ matched: true, answer: "Older answer." }));
// One merchant list for the whole file, as the card's memoized context hands over: the parse memo is keyed by that list.
async function ask(question: string, over: ParseContext = ctx) {
  act(() => root.render(<AskVaultCard getContext={() => over} legacyAsk={legacy} dataKey="v1" reloadKey="r1" accountNames={new Map([[1, "Everyday Checking"]])} createClient={() => client() as never} />));
  const box = container.querySelector<HTMLInputElement>(".ledger-qa-card input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, question); box.dispatchEvent(new Event("input", { bubbles: true })); });
  calls.parse = 0; // typing is not part of the claim; only the submit's reads are counted
  await act(async () => { container.querySelector<HTMLFormElement>(".ledger-qa-card form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}
beforeEach(() => { askVault.mockClear(); retirementAccounts.mockClear(); retirementContext.mockClear(); legacy.mockClear(); calls.parse = 0; container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("parse count along the real public dispatch order (F5)", () => {
  it("a store whose name holds an operator word is parsed twice: the spending-scenario reader (the extra-money reader's wording gate leaves first), then the ordinary controller", async () => {
    await ask("spending at Cut Above over $20 last month");
    // It reached the ordinary route with the store as a vendor, so none of the three scenario readers claimed it.
    expect(askVault).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((askVault.mock.calls[0][0] as AskVaultRequest).vendors).toLowerCase()).toContain("cut above");
    expect(legacy).not.toHaveBeenCalled();
    // The savings-target reader leaves before parsing (no savings lead). The extra-money reader leaves at its own wording gate (no retirement or extra
    // words), before any ordinary reading. Its context is a REDUCED one (useRetirementScenario.ts:146), which is why its reading is never shared with the
    // spending reader's full context (savingLead.ts:60-63): when it does read, it reads for itself.
    expect(calls.parse).toBe(2);
  });
  it("an ordinary question with no operator word is parsed once, by the controller alone (the shared check exits before parsing)", async () => {
    await ask("how much did I spend at Costco last month");
    expect(askVault).toHaveBeenCalledTimes(1);
    expect(calls.parse).toBe(1);
  });
  it("a spending what-if is parsed once: only the spending-scenario reader that claims it; the controller is never reached", async () => {
    await ask("What if I cut Dining by $50 a month from November through December 2026?");
    expect(legacy).not.toHaveBeenCalled();
    expect(calls.parse).toBe(1);
  });
  it("a spending what-if never reads the retirement profile and its one native read is the scenario's own baseline (F-T5-01 privacy and lifecycle boundary)", async () => {
    await ask("What if I cut Dining by $50 a month from November through December 2026?");
    expect(retirementAccounts).not.toHaveBeenCalled();
    expect(retirementContext).not.toHaveBeenCalled();
    expect(askVault).toHaveBeenCalledTimes(1);
    expect(askVault.mock.calls[0][0]).toMatchObject({ categories: ["Dining"], vendors: [] });
  });
  it("asking the same operator-word question again reuses the spending reader's remembered reading (same question, same context); the controller still parses", async () => {
    await ask("spending at Cut Above over $20 last month");
    await ask("spending at Cut Above over $20 last month");
    expect(calls.parse).toBe(1);
  });
});
