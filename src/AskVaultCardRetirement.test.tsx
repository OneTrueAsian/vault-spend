// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AskVaultCard } from "./AskVaultCard";
import { notifyDataWrite } from "./askVault/dataWriteEvents";
import { retirementIllustrativeBalance } from "./askVault/retirementScreenContract";
import { validateRetirementContextReply, validateRetirementRosterReply } from "./askVault/retirementNativeContract";
import type { RetirementContextReply, RetirementContextWireRequest, RetirementRosterReply, RetirementRosterWireRequest } from "./askVault/retirementNativeContract";
import type { ParseContext } from "./askVault/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-10-17";
const context: ParseContext = {
  today: TODAY, categories: ["Dining", "Groceries"], accounts: [{ id: 1, name: "Everyday Checking" }, { id: 5, name: "Roth IRA" }, { id: 6, name: "Brokerage" }],
  investmentAccounts: [{ id: 6, name: "Brokerage" }, { id: 5, name: "Roth IRA" }], merchants: [], members: [], historyStart: "2025-09-01",
};
const REVISION = { local: 40, external: 7 };
const contextReply = (id: number): RetirementContextReply => ({
  contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { ...REVISION }, asOf: TODAY, account: { id, name: id === 5 ? "Roth IRA" : "Brokerage", type: "investment" },
  worth: { amount: "10000", basis: "holdings" }, contribution: { kind: "saved", monthlyAmount: "200" }, returnAssumption: { kind: "stored-plan", annualPct: "7" }, inflation: { kind: "stored", pct: "3" }, retirementMonth: "2056-01",
});
function makeClient() {
  return {
    askVault: vi.fn(async () => { throw new Error("the spending read must not be used"); }),
    askVaultBaselines: vi.fn(async () => { throw new Error("the savings-target read must not be used"); }),
    dispose: vi.fn(),
    askVaultRetirementAccounts: vi.fn(async (request: RetirementRosterWireRequest) => {
      const raw: RetirementRosterReply = { contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { ...REVISION }, asOf: TODAY, accounts: [{ id: 6, name: "Brokerage" }, { id: 5, name: "Roth IRA" }] };
      return validateRetirementRosterReply(raw, request, TODAY);
    }),
    askVaultRetirementContext: vi.fn(async (request: RetirementContextWireRequest) => validateRetirementContextReply(contextReply(request.accountId), request, TODAY)),
  };
}
let container: HTMLDivElement, root: Root, client: ReturnType<typeof makeClient>;
const legacy = vi.fn(() => ({ matched: false, answer: "I couldn't match that." }));
function mount(over: { ctx?: ParseContext; dataKey?: unknown } = {}) {
  const element = (key: unknown) => <AskVaultCard getContext={() => over.ctx ?? context} legacyAsk={legacy} dataKey={key} reloadKey="r1" accountNames={new Map([[1, "Everyday Checking"]])} createClient={() => client as never} />;
  act(() => root.render(element(over.dataKey ?? "v1")));
  return { rerender: (key: unknown) => act(() => root.render(element(key))) };
}
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
async function ask(question: string, focusAskButton = false) {
  const input = container.querySelector<HTMLInputElement>(".ledger-qa-card input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, question); input.dispatchEvent(new Event("input", { bubbles: true })); });
  if (focusAskButton) container.querySelector<HTMLButtonElement>(".ledger-qa-card button[type='submit']")!.focus();
  await act(async () => { container.querySelector<HTMLFormElement>(".ledger-qa-card form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await settle();
}
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === label);
  if (!button) throw new Error(`no button "${label}" in: ${document.body.textContent}`);
  await act(async () => button.click()); await settle();
};
const dialog = () => document.querySelector('[role="dialog"]');
const dialogText = () => dialog()?.textContent ?? "";
const Q = "How much would an extra $50 a month into Roth IRA until January 2056 add?";

beforeEach(() => { client = makeClient(); legacy.mockClear(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("M5 in the Ask the Vault card: retirement flow (J1)", () => {
  it("goes from the question to a confirmed result, and focus returns to the question on close", async () => {
    mount(); await ask(Q, true); // the dialog's own focus restore goes back to the Ask button, a tick after it closes
    expect(dialog()).not.toBeNull(); expect(dialogText()).toContain("Roth IRA"); expect(dialogText()).not.toContain("Illustrative balance");
    expect(client.askVault).not.toHaveBeenCalled();
    await click("Use my saved plan");
    expect(dialogText()).toContain(retirementIllustrativeBalance("2056-01"));
    expect(client.askVaultRetirementContext).toHaveBeenCalledTimes(2);
    await click("Close");
    expect(dialog()).toBeNull(); expect(document.activeElement).toBe(container.querySelector(".ledger-qa-card input"));
  });
  it("shows the choices for a question without an account, then reviews, then shows a result", async () => {
    mount(); await ask("extra $50 a month for retirement");
    expect(dialogText()).toContain("Nothing has been calculated yet");
    await act(async () => { document.querySelector<HTMLInputElement>('input[type="radio"]')!.click(); }); await click("Continue");
    expect(client.askVaultRetirementContext).toHaveBeenCalled();
  });
  it("a Brokerage typo offers the account and a click asks the corrected question", async () => {
    mount(); await ask("extra $50 a month into Brokerge until 2056-01");
    expect(container.textContent).toContain("Nothing has been calculated yet"); expect(dialog()).toBeNull();
    await click("Brokerage"); expect(dialogText()).toContain("Brokerage");
  });
  it("retires an open result the moment a plan is saved elsewhere in the app", async () => {
    mount(); await ask(Q); await click("Use my saved plan"); expect(dialogText()).toContain("Illustrative balance");
    await act(async () => { notifyDataWrite("set_investment_plan"); });
    expect(dialogText()).not.toContain("Illustrative balance"); expect(dialogText()).toContain("Ask again");
  });
  it("retires an open review when the ledger changes", async () => {
    const view = mount(); await ask(Q); expect(dialogText()).toContain("Roth IRA"); view.rerender("changed");
    expect(dialogText()).toContain("Ask again"); expect(dialogText()).not.toContain("Use my saved plan");
  });
  it("a refusal for an unsupported request is shown plainly with nothing read", async () => {
    mount(); await ask("Should I save more for retirement"); expect(dialogText()).toContain("I can't tell you"); expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled();
  });
  it("without any investment account the question gets a plain answer and nothing is read", async () => {
    mount({ ctx: { ...context, investmentAccounts: [] } }); await ask(Q); expect(dialogText()).toMatch(/investment account/i); expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled();
  });
});

describe("M5 in the Ask the Vault card: routing precedence (B2)", () => {
  it("an ordinary spending question never touches the retirement reads", async () => {
    client.askVault.mockImplementation((async () => { throw new Error("stop"); }) as never);
    mount(); await ask("how much did I spend on groceries last month");
    expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled(); expect(client.askVault).toHaveBeenCalled(); expect(dialog()).toBeNull();
  });
  it("a savings-target question (M4) is claimed before M5 and never reads the retirement roster", async () => {
    mount(); await ask("Save $40 monthly across Dining with Dining floor $0 and maximum cut 100% from November through December 2026");
    expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled(); expect(dialogText()).toContain("Dining");
  });
  it("a spending-cut question (M3) is not taken by M5", async () => {
    mount(); await ask("Cut Dining by $50 monthly from November to December 2026");
    expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled(); expect(client.askVault).toHaveBeenCalled(); expect(dialog()).not.toBeNull();
  });
  it("a retirement question is claimed before M3 and before the ordinary reader", async () => {
    mount(); await ask(Q); expect(client.askVault).not.toHaveBeenCalled(); expect(client.askVaultBaselines).not.toHaveBeenCalled(); expect(dialogText()).toContain("Roth IRA");
  });
  it("a question that names an investment account without a retirement word is still claimed", async () => {
    mount({ ctx: { ...context, investmentAccounts: [{ id: 5, name: "Vanguard Fund" }, { id: 6, name: "Brokerage" }] } });
    client.askVaultRetirementAccounts.mockImplementationOnce((async (request: RetirementRosterWireRequest) => validateRetirementRosterReply({ contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { ...REVISION }, asOf: TODAY, accounts: [{ id: 6, name: "Brokerage" }, { id: 5, name: "Vanguard Fund" }] }, request, TODAY)) as never);
    await ask("put $50 a month into Vanguard Fund until January 2056");
    expect(client.askVault).not.toHaveBeenCalled(); expect(client.askVaultRetirementAccounts).toHaveBeenCalled();
  });
  it("starting a new question closes the retirement dialog", async () => {
    mount(); await ask(Q); expect(dialog()).not.toBeNull(); await click("Close"); await ask("how much did I spend on groceries last month"); expect(dialog()).toBeNull();
  });
});
