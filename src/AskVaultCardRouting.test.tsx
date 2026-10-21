// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AskVaultCard, MORE_EXAMPLES, SUGGESTIONS } from "./AskVaultCard";
import { LEDGER_QA_EXAMPLES } from "./ledgerQa";
import { retirementIllustrativeBalance } from "./askVault/retirementScreenContract";
import { validateRetirementContextReply, validateRetirementRosterReply } from "./askVault/retirementNativeContract";
import type { RetirementContextReply, RetirementContextWireRequest, RetirementRosterReply, RetirementRosterWireRequest } from "./askVault/retirementNativeContract";
import type { AskVaultRequest, AskVaultRequestV2, ParseContext } from "./askVault/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * M6 step 3. The real Ask the Vault card, with its real hooks and parsers, driven the way a person drives it. Native replies are fakes that
 * record what was asked; they carry no numbers that a test could echo back. One row per distinct risk, not a Cartesian product.
 * Authorities: Requirements-Checklist CG-23 and EX-01 to EX-06; Owner-Decisions D-S3-01 to D-S3-06; cards claim order at AskVaultCard.tsx runQuestion.
 */
const TODAY = "2026-10-20";
const ctx: ParseContext = {
  today: TODAY,
  categories: ["Dining Out", "Dining", "Groceries", "Rent"],
  accounts: [{ id: 1, name: "Everyday Checking" }, { id: 5, name: "Roth IRA" }],
  investmentAccounts: [{ id: 5, name: "Roth IRA" }],
  merchants: ["WHOLE FOODS MARKET #12", "COSTCO WHSE", "MEIJER #55", "TARGET T-1204", "CUT ABOVE SALON"],
  members: ["Sam", "Robin"], familyMembers: [{ id: 1, name: "Sam" }, { id: 2, name: "Robin" }], historyStart: "2025-09-01",
};
const REVISION = { local: 40, external: 7 };
const contextReply = (id: number): RetirementContextReply => ({
  contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { ...REVISION }, asOf: TODAY, account: { id, name: "Roth IRA", type: "investment" },
  worth: { amount: "10000", basis: "holdings" }, contribution: { kind: "saved", monthlyAmount: "200" }, returnAssumption: { kind: "stored-plan", annualPct: "7" }, inflation: { kind: "stored", pct: "3" }, retirementMonth: "2056-01",
});
const period = (over: Record<string, unknown> = {}) => ({
  from: "2026-07-01", to: "2026-09-30", dayCount: 92, endsToday: false, historyCoverage: "unknown" as const,
  total: "900", purchaseCount: 3, categoryCount: 1, categories: [], purchases: [], vendors: [], vendorNameCount: 0,
  vendorTotals: [], leftOut: { total: "0", purchaseCount: 0, vendors: [], categories: [] }, ...over,
});
/** The three-month native baseline an M3 review is built from, for the quarter before this month. */
const baselineReply = () => ({
  contractVersion: 2 as const, context: { generation: 1, sessionRevision: 1 }, revision: { ...REVISION }, asOf: TODAY, kind: "total" as const,
  spendingBasis: "gross-negative-allocations", thresholdBasis: "absolute-parent-amount", difference: null, earliestRecord: "2025-01-01", comparison: null,
  periods: [{ ...period(), categoryTotals: [], sharedPurchaseCount: 0, memberTotals: [], recordedFrom: "2025-01-01", recordedThrough: TODAY, average: null,
    months: ["07", "08", "09"].map(month => ({ month: `2026-${month}`, from: `2026-${month}-01`, to: `2026-${month}-${month === "09" ? "30" : "31"}`, dayCount: month === "09" ? 30 : 31, coverage: "complete" as const, recordCount: 1, total: "300", purchaseCount: 1 })) }],
});

/** The version 1 snapshot that the savings-target flow reads first, only to learn the data revision. */
const plainSnapshot = (request: { periods: { from: string; to: string }[] }) => ({
  contractVersion: 1 as const, context: { generation: 1, sessionRevision: 1 }, revision: { ...REVISION }, asOf: TODAY, kind: "total" as const,
  spendingBasis: "gross-negative-allocations", thresholdBasis: "absolute-parent-amount", difference: null,
  periods: [period({ from: request.periods[0].from, to: request.periods[0].to, dayCount: 1, total: "0", purchaseCount: 0, categoryCount: 0 })],
});
type Spend = (request: AskVaultRequest | AskVaultRequestV2) => Promise<unknown>;
function makeClient(spend: Spend = async () => { throw new Error("stop"); }, roster = [{ id: 5, name: "Roth IRA" }]) {
  return {
    askVault: vi.fn<Spend>(spend),
    askVaultBaselines: vi.fn(async () => { throw new Error("stop"); }),
    dispose: vi.fn(),
    askVaultRetirementAccounts: vi.fn(async (request: RetirementRosterWireRequest) => {
      const raw: RetirementRosterReply = { contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { ...REVISION }, asOf: TODAY, accounts: roster };
      return validateRetirementRosterReply(raw, request, TODAY);
    }),
    askVaultRetirementContext: vi.fn(async (request: RetirementContextWireRequest) => validateRetirementContextReply(contextReply(request.accountId), request, TODAY)),
  };
}
let container: HTMLDivElement, root: Root, client: ReturnType<typeof makeClient>;
const legacy = vi.fn((_question: string) => ({ matched: true, answer: "Older answer." }));
function mount(over: { ctx?: ParseContext; dataKey?: unknown } = {}) {
  const element = (key: unknown) => <AskVaultCard getContext={() => over.ctx ?? ctx} legacyAsk={legacy} dataKey={key} reloadKey="r1" accountNames={new Map([[1, "Everyday Checking"]])} createClient={() => client as never} />;
  act(() => root.render(element(over.dataKey ?? "v1")));
  return { rerender: (key: unknown) => act(() => root.render(element(key))) };
}
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
const box = () => container.querySelector<HTMLInputElement>(".ledger-qa-card input")!;
async function type(question: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box(), question); box().dispatchEvent(new Event("input", { bubbles: true })); });
}
async function ask(question: string) {
  await type(question);
  await act(async () => { container.querySelector<HTMLFormElement>(".ledger-qa-card form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await settle();
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === label);
  if (!button) throw new Error(`no button "${label}" in: ${document.body.textContent}`);
  await act(async () => button.click()); await settle();
}
const dialog = () => document.querySelector('[role="dialog"]');
const dialogText = () => dialog()?.textContent ?? "";
const cardText = () => container.querySelector(".ledger-qa-card")?.textContent ?? "";
const clarify = () => container.querySelector(".ledger-qa-clarify");
const choiceButtons = () => [...(clarify()?.querySelectorAll(".ledger-qa-choices button") ?? [])].map(b => b.textContent);
const noNativeReads = () => {
  expect(client.askVault).not.toHaveBeenCalled(); expect(client.askVaultBaselines).not.toHaveBeenCalled();
  expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled(); expect(client.askVaultRetirementContext).not.toHaveBeenCalled();
};

beforeEach(() => { client = makeClient(); legacy.mockClear(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("D-S4-03 (I-06 / UC-05): the Tips control and its examples are announced", () => {
  const toggle = () => [...container.querySelectorAll<HTMLButtonElement>(".ledger-qa-card button")].find(b => /Tips & examples|Hide tips/.test(b.textContent ?? ""))!;
  it("the Tips button exposes whether the tips are open, and what it controls", async () => {
    mount();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await act(async () => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const controlled = toggle().getAttribute("aria-controls");
    expect(controlled).toBeTruthy(); expect(document.getElementById(controlled!)).toBe(container.querySelector(".ledger-qa-tips"));
    await act(async () => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("false"); expect(container.querySelector(".ledger-qa-tips")).toBeNull();
  });
  it("choosing an example fills the question, moves focus to it, and says so without asking it", async () => {
    mount(); await act(async () => toggle().click());
    const example = [...container.querySelectorAll<HTMLButtonElement>(".ledger-qa-examples button")].find(b => b.textContent === "What if I cut Groceries by $50 a month?")!;
    await act(async () => example.click()); await settle();
    expect(box().value).toBe("What if I cut Groceries by $50 a month?");
    expect(document.activeElement).toBe(box());
    const status = container.querySelector('.ledger-qa-card [data-example-status][role="status"]');
    expect(status?.textContent).toMatch(/filled in/i); expect(status?.textContent).toMatch(/press Ask/i);
    expect(client.askVault).not.toHaveBeenCalled(); expect(dialog()).toBeNull();
  });
  it("typing afterwards clears the filled-in notice", async () => {
    mount(); await act(async () => toggle().click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>(".ledger-qa-examples button")][0].click()); await settle();
    await type("something else");
    expect(container.querySelector("[data-example-status]")?.textContent ?? "").toBe("");
  });
});

describe("D-S4-01 (I-01): extra money for retirement with no named account", () => {
  const Q = "Save an extra $50 a month for retirement";
  it("opens the extra-money flow, asks for the account and the month, and chooses nothing itself", async () => {
    mount(); await ask(Q);
    expect(cardText()).not.toContain("is not supported"); expect(clarify()).toBeNull(); expect(dialog()).not.toBeNull();
    expect(dialogText()).toContain("Roth IRA"); expect(dialogText()).toContain("$50");
    expect(client.askVaultRetirementAccounts).toHaveBeenCalledTimes(1);
    expect(client.askVaultRetirementContext).not.toHaveBeenCalled(); expect(client.askVault).not.toHaveBeenCalled(); expect(client.askVaultBaselines).not.toHaveBeenCalled();
    expect(box().value).toBe(Q);
  });
  it("says an investment account is required when there is none, and reads nothing", async () => {
    mount({ ctx: { ...ctx, investmentAccounts: [] } }); await ask(Q);
    expect(cardText() + dialogText()).toMatch(/investment account/i); noNativeReads();
  });
  it("editing the question changes what is asked and retires the earlier flow", async () => {
    mount(); await ask(Q); expect(dialogText()).toContain("$50");
    await ask("Save an extra $75 a month for retirement"); expect(dialogText()).toContain("$75"); expect(dialogText()).not.toContain("$50");
  });
});

describe("D-S4-02 (I-02 / I-03): a known store name is not a savings instruction", () => {
  const stores = { ...ctx, merchants: ["Save A Lot", "Extra Space Storage", "Cut Rate Gas"] };
  it.each(["Save A Lot last month", "Save A Lot spending in July", "Extra Space Storage last month", "Cut Rate Gas last month"])("goes to the ordinary reader, not a savings flow: %s", async question => {
    mount({ ctx: stores }); await ask(question);
    expect(dialog()).toBeNull(); expect(clarify()).toBeNull(); expect(cardText()).not.toMatch(/couldn't account for|is not supported/);
    expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled(); expect(client.askVaultBaselines).not.toHaveBeenCalled();
    expect(client.askVault).toHaveBeenCalledTimes(1);
  });
  it.each(["spending at Cut Above last month", "total at Cut Above salon this year", "my spending at Reduce Stress last month"])("an operator word inside a store's name, anywhere in the question, is not an instruction: %s", async question => {
    mount({ ctx: { ...ctx, merchants: [...(ctx.merchants ?? []), "REDUCE STRESS SPA"] } }); await ask(question);
    expect(dialog()).toBeNull(); expect(clarify()).toBeNull(); expect(cardText()).not.toMatch(/couldn't account for|is not supported/);
    expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled(); expect(client.askVaultBaselines).not.toHaveBeenCalled();
    expect(client.askVault).toHaveBeenCalledTimes(1);
  });
  it("the same words are still a saving request when the store list does not contain the name", async () => {
    mount({ ctx: { ...ctx, merchants: ["Costco"] } }); await ask("Save A Lot last month");
    expect(client.askVault).not.toHaveBeenCalled();
  });
});

describe("D-S3-01 / SR-01: Save ... into an investment account asks whether the money is extra", () => {
  const Q = "Save $50 a month into my Roth IRA until June 2050";
  it("asks the owner's question, offers one affirmative answer, and reads nothing", async () => {
    mount(); await ask(Q);
    expect(clarify()?.textContent).toContain("Do you mean adding an extra $50 a month to this account?");
    expect(clarify()?.textContent).toContain("Nothing has been calculated yet.");
    expect(choiceButtons()).toEqual(["Yes, add an extra $50 a month"]);
    expect(dialog()).toBeNull(); noNativeReads(); expect(legacy).not.toHaveBeenCalled();
  });
  it("an affirmative answer enters the extra-money flow with the account, amount, cadence and month kept", async () => {
    mount(); await ask(Q); await click("Yes, add an extra $50 a month");
    expect(box().value).toBe("Extra $50 a month into my Roth IRA until June 2050");
    expect(clarify()).toBeNull(); expect(dialog()).not.toBeNull(); expect(dialogText()).toContain("Roth IRA");
    expect(client.askVaultRetirementAccounts).toHaveBeenCalledTimes(1); expect(client.askVault).not.toHaveBeenCalled(); expect(client.askVaultBaselines).not.toHaveBeenCalled();
    await click("Use my saved plan");
    expect(client.askVaultRetirementContext.mock.calls.at(-1)![0]).toMatchObject({ accountId: 5 });
    expect(dialogText()).toContain(retirementIllustrativeBalance("2050-06"));
    expect(dialogText()).toContain("Adding $50 each month to Roth IRA");
  });
  it("goes straight to the extra-money flow when the money is stated to be extra", async () => {
    mount(); await ask("Save an extra $50 a month into my Roth IRA until June 2050");
    expect(clarify()).toBeNull(); expect(dialog()).not.toBeNull(); expect(client.askVaultRetirementAccounts).toHaveBeenCalledTimes(1); expect(client.askVault).not.toHaveBeenCalled();
  });
  it("is not taken by the savings-target flow, and the savings-target flow still works for a real target", async () => {
    mount(); await ask(Q); expect(cardText()).not.toContain("I couldn't account for"); expect(dialog()).toBeNull();
    await ask("Where can I cut back to save $200 a month?");
    expect(clarify()).toBeNull(); expect(dialogText()).toContain("Where would you like to cut back?"); expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled();
  });
  it("shows how editing the question changes the question asked, and retires the earlier one", async () => {
    mount(); await ask(Q); expect(clarify()?.textContent).toContain("an extra $50 a month");
    await type("Save $75 a month into my Roth IRA until June 2050");
    expect(clarify()).toBeNull();
    await ask("Save $75 a month into my Roth IRA until June 2050");
    expect(clarify()?.textContent).toContain("an extra $75 a month"); expect(clarify()?.textContent).not.toContain("$50");
    expect(choiceButtons()).toEqual(["Yes, add an extra $75 a month"]);
  });
  it("a replacement contribution gets no extra-money question and reads nothing", async () => {
    mount(); await ask("Save $50 a month into my Roth IRA instead of $100");
    expect(clarify()).toBeNull(); expect(dialogText()).toContain("I can't do that yet"); expect(dialogText()).toContain("I couldn't keep every part of that request"); noNativeReads();
  });
  it("a typed request for the wrong month cannot be confirmed by the affirmative answer: the answer asks again for the year", async () => {
    mount(); await ask("Save $50 a month into my Roth IRA until June");
    expect(choiceButtons()).toEqual(["Yes, add an extra $50 a month"]);
    await click("Yes, add an extra $50 a month");
    expect(clarify()?.textContent).toContain("Which year?"); noNativeReads();
  });
  it("mixed spending-category and account instructions clarify, with no button that picks one", async () => {
    mount(); await ask("Save $50 on Dining and $50 a month into my Roth IRA until June 2050");
    expect(clarify()?.textContent).toContain("That mixes spending in a category with adding money to an investment account. Ask about one at a time.");
    expect(choiceButtons()).toEqual([]); expect(clarify()?.querySelector('[role="group"]')).toBeNull(); expect(clarify()?.textContent).toContain("Change your question above and ask again."); expect(dialog()).toBeNull(); noNativeReads();
  });
  it("mixed instructions that start with a different verb clarify too", async () => {
    mount(); await ask("Cut Dining by $50 and put $50 a month into my Roth IRA until June 2050");
    expect(clarify()?.textContent).toContain("That mixes spending"); expect(dialog()).toBeNull(); noNativeReads();
  });
});

describe("D-S3-02 / SR-03: one-category saving wording becomes the spending-reduction preview", () => {
  const withBaseline = () => { client = makeClient(async () => baselineReply()); };
  const FULL = "from November through December 2026";
  it.each([
    "Help me save $50 on Dining each month " + FULL,
    "How can I save $50 on Dining each month " + FULL,
    "Please save $50 on Dining each month " + FULL,
    "I want to save $50 on Dining each month " + FULL,
  ])("reaches the review with every clause kept and states the assumption: %s", async question => {
    withBaseline(); mount(); await ask(question);
    expect(dialogText()).toContain("Check these details");
    expect(client.askVault.mock.calls[0][0]).toMatchObject({ contractVersion: 2, categories: ["Dining"], expectedRevision: null });
    expect(client.askVaultBaselines).not.toHaveBeenCalled(); expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled();
    const text = dialogText();
    expect(text).toContain("Dining"); expect(text).toContain("$50.00"); expect(text).toContain("November 1, 2026"); expect(text).toContain("December 31, 2026");
    expect(text).toContain("This assumes you spend $50.00 less on Dining each month from November 1, 2026 to December 31, 2026.");
    expect(text).toContain("It is a what-if, not advice, and nothing in your budget changes.");
    expect(text).not.toMatch(/invest|Roth|retire/i);
  });
  it("asks for the missing cadence and dates through the existing choices, reading nothing first", async () => {
    mount(); await ask("Help me save $50 on Dining");
    expect(dialog()).not.toBeNull(); expect(dialogText()).toContain("Dining"); noNativeReads();
  });
  it("shows how editing the amount changes the review, and a changed question closes the old one", async () => {
    withBaseline(); mount(); await ask("Help me save $50 on Dining each month " + FULL);
    expect(dialogText()).toContain("This assumes you spend $50.00 less");
    await type("Help me save $75 on Dining each month " + FULL);
    expect(dialog()).toBeNull();
    await ask("Help me save $75 on Dining each month " + FULL);
    expect(dialogText()).toContain("This assumes you spend $75.00 less"); expect(dialogText()).not.toContain("$50.00");
    expect(client.askVault).toHaveBeenCalledTimes(2);
  });
  it("a misspelled category offers the exact name, and the choice reaches the review with every clause kept", async () => {
    withBaseline(); mount(); await ask("Help me save $50 on Dinning each month " + FULL);
    expect(clarify()?.textContent).toContain('Choose the category you mean by "dinning".'); expect(choiceButtons()).toEqual(["Dining"]); expect(dialog()).toBeNull(); noNativeReads();
    await click("Dining");
    expect(box().value).toBe('Help me save $50 on "Dining" each month ' + FULL);
    expect(dialogText()).toContain("This assumes you spend $50.00 less on Dining each month from November 1, 2026 to December 31, 2026.");
  });
  it("a misspelled category with every month still reaches the review with the exact name chosen and every clause kept", async () => {
    withBaseline(); mount(); await ask("Help me save $50 on Dinning every month " + FULL);
    expect(clarify()?.textContent).toContain('Choose the category you mean by "dinning".'); expect(choiceButtons()).toEqual(["Dining"]); expect(dialog()).toBeNull(); noNativeReads();
    await click("Dining");
    expect(box().value).toBe('Help me save $50 on "Dining" every month ' + FULL);
    expect(dialogText()).toContain("This assumes you spend $50.00 less on Dining each month from November 1, 2026 to December 31, 2026.");
  });
  it("a misspelled category with once offers the exact name and keeps the date", async () => {
    withBaseline(); mount(); await ask("Help me save $50 on Dinning once on November 5, 2026");
    expect(clarify()?.textContent).toContain('Choose the category you mean by "dinning".'); expect(choiceButtons()).toEqual(["Dining"]); expect(dialog()).toBeNull(); noNativeReads();
    await click("Dining");
    expect(box().value).toBe('Help me save $50 on "Dining" once on November 5, 2026');
    expect(dialogText()).toContain("November 5, 2026");
  });
  it("confirm, edit, reconfirm: the computed saving follows the typed amount ($50 for two months is $100.00, $75 is $150.00) and the earlier result is gone (UI-08)", async () => {
    withBaseline(); mount(); await ask("Help me save $50 on Dining each month " + FULL);
    await click("Show what I would save");
    expect(dialogText()).toContain("What you would save"); expect(dialogText()).toContain("$100.00"); expect(dialogText()).not.toContain("$150.00");
    await type("Help me save $75 on Dining each month " + FULL);
    expect(dialog()).toBeNull();
    await ask("Help me save $75 on Dining each month " + FULL); await click("Show what I would save");
    expect(dialogText()).toContain("$150.00"); expect(dialogText()).not.toContain("$100.00");
  });
  it("keeps the refusals that Cut would give, so nothing is dropped or turned into an investment", async () => {
    mount();
    await ask("Help me save $50 on Dining and invest it each month"); expect(dialogText()).toMatch(/investments|invest/i); noNativeReads();
    await ask("Please save $50 on Dining at Costco each month"); expect(dialogText()).toContain("Costco"); noNativeReads();
    await ask("How can I save $50 on Dining last month"); expect(dialogText()).toMatch(/Retrospective/); noNativeReads();
  });
  it("leaves the savings-target flow in charge of a target with no single category", async () => {
    mount(); await ask("Help me save $200 a month across Dining and Groceries from November through December 2026");
    expect(dialogText()).toContain("Where would you like to cut back?");
  });
});

describe("SR-02 and SR-04: names are not operators and are claimed whole", () => {
  it.each([
    ['how much did I spend at "Cut Above" last month', "cut above"],
    ["how much did I spend at Cut Above in July", "cut above"],
  ])("a store whose name holds a scenario word is asked about in the ordinary way: %s", async (question, vendor) => {
    mount(); await ask(question);
    expect(dialog()).toBeNull(); expect(client.askVault).toHaveBeenCalledTimes(1);
    expect(client.askVault.mock.calls[0][0]).toMatchObject({ vendors: [vendor] });
    expect(cardText()).not.toMatch(/Retrospective|couldn't account for the condition/);
  });
  it("an account named ETF does not claim a question about Netflix", async () => {
    const withEtf = { ...ctx, investmentAccounts: [{ id: 5, name: "Roth IRA" }, { id: 6, name: "ETF" }] };
    mount({ ctx: withEtf }); await ask("how much have I saved on Netflix");
    expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled(); expect(dialog()).toBeNull(); expect(legacy).toHaveBeenCalledWith("how much have I saved on Netflix");
  });
});

describe("claim order is unchanged where nothing was decided (observed order, CG-23)", () => {
  it("a savings target, an extra-money question, a spending cut and an ordinary question each reach their own family", async () => {
    mount();
    await ask("Save $200 in total this year"); expect(dialogText()).toContain("Where would you like to cut back?"); expect(client.askVault).not.toHaveBeenCalled();
    await ask("Extra $50 a month into Roth IRA until January 2056"); expect(dialogText()).toContain("Roth IRA"); expect(client.askVaultRetirementAccounts).toHaveBeenCalledTimes(1);
    await ask("Cut Dining by $50"); expect(dialogText()).not.toContain("Roth IRA"); expect(dialog()).not.toBeNull();
    await ask("how much did I spend on groceries last month"); expect(dialog()).toBeNull(); expect(client.askVault).toHaveBeenCalledTimes(1);
  });
});

describe("D-S3-03: no new native read when the window regains focus on an M3 or M4 result (SR-07 deferred)", () => {
  it("a displayed M3 review is not re-read on focus; existing freshness checks are unchanged", async () => {
    client = makeClient(async () => baselineReply()); mount();
    await ask("Cut Dining by $50 monthly from November through December 2026");
    expect(dialogText()).toContain("Check these details"); const reads = client.askVault.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event("focus")); }); await settle();
    expect(client.askVault.mock.calls.length).toBe(reads); expect(dialogText()).toContain("Check these details");
  });
  it("a changed profile retires a displayed M3 review at once, with the shared wording", async () => {
    client = makeClient(async () => baselineReply()); const view = mount();
    await ask("Cut Dining by $50 monthly from November through December 2026"); expect(dialogText()).toContain("Check these details");
    view.rerender("changed");
    expect(dialogText()).toContain("Your details changed"); expect(dialogText()).toContain("This answer or preview is no longer shown. Ask again using your current details.");
    expect(dialogText()).not.toContain("Check these details");
  });
});

describe("every advertised sentence reaches its own family (EX-01, EX-03, EX-04, EX-06)", () => {
  it("the lists are exactly the advertised ones, so a change is deliberate", () => {
    expect(LEDGER_QA_EXAMPLES).toHaveLength(12);
    expect(MORE_EXAMPLES).toEqual([
      "how much did I spend at Costco last month", "everything except rent last month", "spending by month this year", "average purchase on groceries last month",
      "what did each family member spend last month", "Where can I cut back to save $200 a month?", "Save $200 in total this year", "Extra $50 a month into Roth IRA until January 2056",
      "What if I cut Groceries by $50 a month?",
    ]);
    expect(SUGGESTIONS).toEqual(["how much did I spend on groceries last month", "top 3 spending categories this year", "my three biggest expenses last month", "groceries last month without Costco"]);
  });
  const original = (index: number) => LEDGER_QA_EXAMPLES[index];
  // [sentence, family, observable]
  const native: [string, Record<string, unknown>][] = [
    [original(0), { categories: ["Dining Out"], periods: [{ from: "2026-07-01", to: "2026-07-31" }] }],
    [original(11), { kind: "compare" }],
    ["how much did I spend at Costco last month", { vendors: ["costco"], periods: [{ from: "2026-09-01", to: "2026-09-30" }] }],
    ["everything except rent last month", { excludeCategories: ["Rent"], periods: [{ from: "2026-09-01", to: "2026-09-30" }] }],
    ["spending by month this year", { contractVersion: 2, groupBy: "month", periods: [{ from: "2026-01-01", to: TODAY }] }],
    ["average purchase on groceries last month", { contractVersion: 2, average: "per-purchase", categories: ["Groceries"] }],
    ["what did each family member spend last month", { contractVersion: 2, groupBy: "member" }],
    ["top 3 spending categories this year", { kind: "rank-categories", limit: 3 }],
    ["my three biggest expenses last month", { kind: "rank-purchases", limit: 3 }],
    ["groceries last month without Costco", { categories: ["Groceries"], excludeVendors: ["costco"] }],
    ["how much did I spend at Meijer and Target last month", { vendors: ["meijer", "target"] }],
    ["how much did I spend on groceries last month", { categories: ["Groceries"], periods: [{ from: "2026-09-01", to: "2026-09-30" }] }],
  ];
  it.each(native)("is read natively and exactly as written: %s", async (sentence, shape) => {
    mount(); await ask(sentence);
    expect(client.askVault).toHaveBeenCalledTimes(1); expect(client.askVault.mock.calls[0][0]).toMatchObject(shape);
    expect(legacy).not.toHaveBeenCalled(); expect(dialog()).toBeNull(); expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled();
  });
  it("a store with no period is added up over every recorded day, and a category with no period asks which period", async () => {
    mount(); await ask(original(1));
    expect(client.askVault).toHaveBeenCalledTimes(1);
    expect(client.askVault.mock.calls[0][0]).toMatchObject({ vendors: ["whole foods"], periods: [{ from: "2025-09-01", to: TODAY }] });
    act(() => root.unmount()); root = createRoot(container); client = makeClient(); mount();
    await ask("how much did I spend on dining out");
    expect(clarify()?.textContent).toContain("Which time period should I use?"); expect(choiceButtons()).toEqual(["Last month", "This month so far", "This year so far"]); noNativeReads();
  });
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10].map(index => [original(index)]))("is answered by the older matcher without a native read: %s", async sentence => {
    mount(); await ask(sentence);
    expect(legacy).toHaveBeenCalledWith(sentence); expect(client.askVault).not.toHaveBeenCalled(); expect(dialog()).toBeNull();
  });
  it("the savings-target examples open the savings-target choices and read nothing", async () => {
    for (const sentence of ["Where can I cut back to save $200 a month?", "Save $200 in total this year"]) {
      mount(); await ask(sentence);
      expect(dialogText()).toContain("Where would you like to cut back?"); noNativeReads();
      act(() => root.unmount()); root = createRoot(container);
    }
  });
  it("the extra-money example opens the extra-money flow for a household with a Roth IRA, and is refused plainly for one without", async () => {
    mount(); await ask("Extra $50 a month into Roth IRA until January 2056");
    expect(dialogText()).toContain("Roth IRA"); expect(client.askVaultRetirementAccounts).toHaveBeenCalledTimes(1);
    act(() => root.unmount()); root = createRoot(container);
    client = makeClient(async () => { throw new Error("stop"); }, []);
    mount({ ctx: { ...ctx, investmentAccounts: [] } }); await ask("Extra $50 a month into Roth IRA until January 2056");
    expect(dialogText()).toMatch(/investment account/i); expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled();
  });
  it("the spending-cut example (M3, UC-08) opens the spending-cut choices and reads nothing", async () => {
    mount(); await ask("What if I cut Groceries by $50 a month?");
    expect(dialog()).not.toBeNull(); expect(dialogText()).toContain("Groceries"); noNativeReads();
  });
  it("every Tips button fills the box with exactly its sentence, and every suggestion button asks its sentence", async () => {
    mount();
    await act(async () => { [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Tips & examples")!.click(); });
    const tips = [...container.querySelectorAll<HTMLButtonElement>(".ledger-qa-examples button")];
    expect(tips.map(b => b.textContent)).toEqual([...LEDGER_QA_EXAMPLES, ...MORE_EXAMPLES]);
    for (const button of tips) { await act(async () => button.click()); expect(box().value).toBe(button.textContent); }
    await ask("zzzz qqqq xxxx");
    const suggestions = [...container.querySelectorAll<HTMLButtonElement>(".ledger-qa-answer-unmatched .ledger-qa-examples button")];
    expect(suggestions.map(b => b.textContent)).toEqual([...SUGGESTIONS]);
  });
  it("clicking each suggestion puts its sentence in the box and sends that sentence's request (R3-04: the buttons are clicked, not just listed)", async () => {
    for (const sentence of SUGGESTIONS) {
      client = makeClient(); mount(); await ask("zzzz qqqq xxxx");
      const button = [...container.querySelectorAll<HTMLButtonElement>(".ledger-qa-answer-unmatched .ledger-qa-examples button")].find(b => b.textContent === sentence)!;
      expect(button, sentence).toBeDefined(); client.askVault.mockClear();
      await act(async () => button.click()); await settle();
      expect(box().value).toBe(sentence);
      const expected = native.find(([text]) => text === sentence)![1];
      expect(client.askVault).toHaveBeenCalled(); expect(client.askVault.mock.calls.at(-1)![0], sentence).toMatchObject(expected);
      act(() => root.unmount()); container.remove(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    }
  });
});

describe("every sentence the in-app Help quotes reaches the family Help says it does (EX-06, characterization: written after the behavior, not a RED test)", () => {
  // Quoted verbatim from the <q> sentences of HelpView.tsx's four Ask the Vault entries.
  it("\"What if I cut Groceries by $50 a month?\" and \"Help me save $50 on Groceries each month\" open the spending-cut choices and read nothing first", async () => {
    for (const sentence of ["What if I cut Groceries by $50 a month?", "Help me save $50 on Groceries each month"]) {
      mount(); await ask(sentence);
      expect(dialogText(), sentence).toContain("Groceries"); noNativeReads();
      act(() => root.unmount()); root = createRoot(container);
    }
  });
  it("\"Where can I cut back to save $200 a month?\", \"Save $200 in total this year\" and \"Extra $50 a month into Roth IRA until January 2056\" open their own flows", async () => {
    mount(); await ask("Where can I cut back to save $200 a month?");
    expect(dialogText()).toContain("Where would you like to cut back?"); noNativeReads();
    act(() => root.unmount()); root = createRoot(container); mount(); await ask("Save $200 in total this year");
    expect(dialogText()).toContain("Where would you like to cut back?"); noNativeReads();
    act(() => root.unmount()); root = createRoot(container); mount(); await ask("Extra $50 a month into Roth IRA until January 2056");
    expect(dialogText()).toContain("Roth IRA"); expect(client.askVaultRetirementAccounts).toHaveBeenCalledTimes(1);
  });
  it("the two ordinary Help sentences ask the native reader exactly what they say", async () => {
    mount(); await ask("how much did I spend on dining out in July");
    expect(client.askVault.mock.calls[0][0]).toMatchObject({ categories: ["Dining Out"], periods: [{ from: "2026-07-01", to: "2026-07-31" }] });
    act(() => root.unmount()); root = createRoot(container); client = makeClient(); mount();
    await ask("how much did I spend at Meijer and Target last month");
    expect(client.askVault.mock.calls[0][0]).toMatchObject({ vendors: ["meijer", "target"], periods: [{ from: "2026-09-01", to: "2026-09-30" }] });
  });
});

describe("cross-family transitions: the family that was showing shows nothing afterwards (LC-04, LC-07)", () => {
  const later = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
  it("an ordinary read in flight, then a savings-target question: the late reply is ignored", async () => {
    const pending = later<unknown>(); client = makeClient(() => pending.promise as Promise<never>); mount();
    await ask("how much did I spend on groceries last month"); await ask("Save $200 in total this year");
    expect(dialogText()).toContain("Where would you like to cut back?");
    await act(async () => pending.resolve(baselineReply())); await settle();
    expect(cardText()).not.toContain("$900.00"); expect(dialogText()).toContain("Where would you like to cut back?");
  });
  it("an M3 baseline read in flight, then an ordinary question: the late baseline opens no dialog", async () => {
    const pending = later<unknown>(); let first = true;
    client = makeClient(request => { if (first && "contractVersion" in request) { first = false; return pending.promise as Promise<never>; } throw new Error("stop"); }); mount();
    await ask("Cut Dining by $50 monthly from November through December 2026");
    await ask("how much did I spend on groceries last month");
    await act(async () => pending.resolve(baselineReply())); await settle();
    expect(dialog()).toBeNull();
  });
  it("an M4 baseline read in flight, then an extra-money question: only the extra-money flow remains", async () => {
    const pending = later<unknown>(); client = makeClient(async request => "contractVersion" in request ? baselineReply() : plainSnapshot(request)); client.askVaultBaselines.mockImplementation((() => pending.promise) as never); mount();
    await ask("Save $40 monthly across Dining with Dining floor $0 and maximum cut 100% from November through December 2026");
    await click("Review the details"); expect(client.askVaultBaselines).toHaveBeenCalledTimes(1);
    await ask("Extra $50 a month into Roth IRA until January 2056");
    await act(async () => pending.resolve({ not: "a valid bundle" })); await settle();
    expect(dialogText()).toContain("Roth IRA"); expect(dialogText()).not.toContain("Dining");
  });
  it("an open extra-money result, then a spending cut: the result is gone and its consent cannot be used", async () => {
    mount(); await ask("Extra $50 a month into Roth IRA until January 2056"); await click("Use my saved plan");
    expect(dialogText()).toContain(retirementIllustrativeBalance("2056-01"));
    await ask("Cut Dining by $50");
    expect(dialogText()).not.toContain("Illustrative balance"); expect([...document.querySelectorAll("button")].some(b => b.textContent === "Use my saved plan")).toBe(false);
  });
  it("an extra-money review, then typing in the box: the review is closed at once", async () => {
    mount(); await ask("Extra $50 a month into Roth IRA until January 2056"); expect(dialogText()).toContain("Use my saved plan");
    await type("Extra $50 a month into Roth IRA until January 2056 "); expect(dialog()).toBeNull();
    expect(document.body.textContent).not.toContain("Use my saved plan");
  });
});
