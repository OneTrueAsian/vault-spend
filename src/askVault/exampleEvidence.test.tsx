// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { readFileSync, readdirSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { AskVaultCard, MORE_EXAMPLES, SUGGESTIONS } from "../AskVaultCard";
import { LEDGER_QA_EXAMPLES, answerLedgerQuestion, type QaContext } from "../ledgerQa";
import { validateRetirementContextReply, validateRetirementRosterReply } from "./retirementNativeContract";
import type { RetirementContextWireRequest, RetirementRosterWireRequest } from "./retirementNativeContract";
import { answer, request as oracleRequest } from "../testSupport/askVaultM6/referenceOracle";
import { EXAMPLES, EXAMPLE_PARSE_CONTEXT, EXAMPLE_TODAY, EXAMPLE_WORLD, LEGACY_PROFILE, type LegacyExample, type NativeExample } from "../testSupport/askVaultM6/exampleMap";
import { CLAIMS } from "../testSupport/askVaultM6/helpClaims";
import type { World } from "../testSupport/askVaultM6/referenceWorld";
import type { ParseContext } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Task-4 gap F3 (Task4-Overnight-Validation F3; Validation-Plan VP-11, Requirements-Checklist EX-01 to EX-06, CG-01).
 * Every advertised string goes through the REAL card with its real parsers, controllers and (for the older examples) the real `answerLedgerQuestion`.
 *  - native examples: the request the card sends equals the FULL hand-written request (toEqual, not toMatchObject); the reply is computed by the independent
 *    M2 oracle from a provisioned profile; the card must show the hand-worked figures; the oracle must reproduce the hand figure (a cross-check of the hand
 *    arithmetic, not its source);
 *  - older examples: real legacy calculations over a provisioned profile, hand-worked figures, and the supported missing-entity outcome;
 *  - scenario examples (M3/M4/M5): driven through review and explicit consent to a completed result, with the figure worked by hand;
 *  - an edited input must change the request and the output.
 * Fake native replies here are oracle outputs for the exact request, not echoes. A throw, an "Older answer." stub or an open choices screen is never counted.
 * Written after the behavior existed (characterization): disclosed in the gap-remediation report; RED evidence is the checklist's recorded INCOMPLETE state.
 */
const REVISION = { local: 40, external: 7 };
const ctx = EXAMPLE_PARSE_CONTEXT as unknown as ParseContext;
let container: HTMLDivElement, root: Root;

function oracleFor(world: World, req: Record<string, unknown>) {
  const { contractVersion: _v, ...rest } = req;
  return answer(world, oracleRequest({ ...(rest as unknown as Parameters<typeof oracleRequest>[0]), members: (req.members as never) ?? { ids: [], unassigned: false } }));
}
const reply = (world: World, req: Record<string, unknown>) => ({ ...oracleFor(world, req), revision: { ...REVISION } });
const none = async () => { throw new Error("stop"); };
function makeClient(over: Partial<Record<"askVault" | "askVaultBaselines" | "askVaultRetirementAccounts" | "askVaultRetirementContext", (...a: never[]) => Promise<unknown>>> = {}) {
  return { askVault: vi.fn(over.askVault ?? none), askVaultBaselines: vi.fn(over.askVaultBaselines ?? none), dispose: vi.fn(),
    askVaultRetirementAccounts: vi.fn(over.askVaultRetirementAccounts ?? none), askVaultRetirementContext: vi.fn(over.askVaultRetirementContext ?? none) };
}
let client: ReturnType<typeof makeClient>;
const legacyCalls: string[] = [];
function mount(over: { ctx?: ParseContext; legacy?: (q: string) => { matched: boolean; answer: string }; key?: unknown; reload?: string } = {}) {
  const legacy = (q: string) => { legacyCalls.push(q); return (over.legacy ?? (() => ({ matched: false, answer: "no legacy" })))(q); };
  const element = (key: unknown, reload?: string) => <AskVaultCard getContext={() => over.ctx ?? ctx} legacyAsk={legacy as never} dataKey={key} reloadKey={reload ?? over.reload ?? "r1"} accountNames={new Map([[1, "Everyday Checking"]])} createClient={() => client as never} />;
  act(() => root.render(element(over.key ?? "v1")));
  return { rerender: (key: unknown, reload?: string) => act(() => root.render(element(key, reload))) };
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
async function radio(prefix: string) {
  const label = [...document.querySelectorAll("label.scenario-option, [role=dialog] label")].find(l => l.textContent?.startsWith(prefix));
  if (!label) throw new Error(`no option "${prefix}" in: ${dialogText()}`);
  await act(async () => label.querySelector<HTMLInputElement>("input")!.click()); await settle();
}
async function check(ariaLabel: string) {
  const field = document.querySelector<HTMLInputElement>(`input[aria-label="${ariaLabel}"]`);
  if (!field) throw new Error(`no field "${ariaLabel}" in: ${dialogText()}`);
  await act(async () => field.click()); await settle();
}
const dialog = () => document.querySelector('[role="dialog"]');
const dialogText = () => dialog()?.textContent ?? "";
const cardText = () => container.querySelector(".ledger-qa-card")?.textContent ?? "";
const remount = () => { act(() => root.unmount()); container.remove(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); };

beforeEach(() => { legacyCalls.length = 0; client = makeClient(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const natives = EXAMPLES.filter((e): e is NativeExample => e.route === "native");
const legacies = EXAMPLES.filter((e): e is LegacyExample => e.route === "legacy");

describe("the frozen example map is exactly the advertised set", () => {
  it("lists every string the app advertises, once, with a source and a route, so adding or removing one is deliberate", () => {
    const advertised = [...LEDGER_QA_EXAMPLES, ...MORE_EXAMPLES, ...SUGGESTIONS, "how much did I spend at Meijer and Target last month"];
    expect(EXAMPLES.map(e => e.text)).toEqual(advertised);
    expect(new Set(EXAMPLES.map(e => e.id)).size).toBe(EXAMPLES.length);
    expect(EXAMPLES.every(e => e.source.length > 8)).toBe(true);
    expect(EXAMPLES).toHaveLength(26);
  });
  it("the Help-only example really is quoted in the Help (whitespace-normalized)", () => {
    const help = readFileSync("src/HelpView.tsx", "utf8").replace(/\s+/g, " ");
    expect(help).toContain("how much did I spend at Meijer and Target last month");
  });
  it("every native example's hand figure is reproduced by the independent oracle for the same request", () => {
    for (const e of natives) {
      const snapshot = oracleFor(EXAMPLE_WORLD, e.request);
      expect(snapshot.periods[0].total, `${e.id}: ${e.hand}`).toBe(e.oracleTotal);
    }
  });
});

describe("native examples: full request equality, a correct result, and the figures shown", () => {
  it.each(natives.map(e => [e.id, e] as const))("%s is sent exactly as intended and answered correctly", async (_id, e) => {
    client = makeClient({ askVault: (async (req: Record<string, unknown>) => reply(EXAMPLE_WORLD, req)) as never });
    mount(); await ask(e.text);
    expect(client.askVault).toHaveBeenCalledTimes(1);
    expect(client.askVault.mock.calls[0][0]).toEqual(e.request);
    expect(legacyCalls).toEqual([]); expect(dialog()).toBeNull();
    for (const figure of e.figures) expect(cardText(), `${e.id}: ${e.hand}`).toContain(figure);
  });
  it("an edited input changes both the request and the answer (July to August, and one category to another)", async () => {
    client = makeClient({ askVault: (async (req: Record<string, unknown>) => reply(EXAMPLE_WORLD, req)) as never });
    mount(); await ask("how much did I spend on dining out in July");
    expect(cardText()).toContain("You spent $95.00 on Dining Out in July 2026.");
    await ask("how much did I spend on dining out in August");
    expect(client.askVault.mock.calls.at(-1)![0]).toEqual(expect.objectContaining({ categories: ["Dining Out"], periods: [{ from: "2026-08-01", to: "2026-08-31" }] }));
    expect(cardText()).toContain("You spent $20.00 on Dining Out in August 2026."); expect(cardText()).not.toContain("$95.00");
    await ask("how much did I spend on groceries in August");
    expect(client.askVault.mock.calls.at(-1)![0]).toEqual(expect.objectContaining({ categories: ["Groceries"] }));
    expect(cardText()).not.toContain("$20.00");
  });
});

describe("older examples: real legacy calculations over a provisioned profile", () => {
  const account = (o: Record<string, unknown>) => ({ institution: null, mask: null, interest_rate: null, excluded_from_debt_payoff: false, member_id: null, member_name: null, checkpoint_date: null, icon_key: null, import_flip_signs: null, ...o });
  const tx = (o: Record<string, unknown>) => ({ id: Math.floor(Math.random() * 1e9), transfer_counterpart_id: null, account_id: 1, account_name: "Everyday Checking", category_source: "user", confidence: null, applied_to_debt: null, principal_amount: null, split_count: 0, tags: [], member_id: null, member_name: null, notes: null, ...o });
  const full = (): QaContext => ({
    transactions: LEGACY_PROFILE.transactions.map(t => tx(t)), categories: ["Dining Out", "Groceries", "Rent"], accounts: LEGACY_PROFILE.accounts.map(a => account(a)),
    buckets: LEGACY_PROFILE.buckets.map(b => ({ account_id: null, account_name: null, member_id: null, member_name: null, sinking_amount: null, color: null, icon_key: null, target_date: null, ...b })),
    recurring: LEGACY_PROFILE.recurring.map(r => ({ category: "Entertainment", cadence: "monthly", anchor_date: "2026-01-01", account_id: null, account_name: null, member_id: null, member_name: null, status: "keep", ...r })),
    avgMonthlySpend: LEGACY_PROFILE.avgMonthlySpend, today: new Date(...LEGACY_PROFILE.today),
  } as unknown as QaContext);
  const empty = (): QaContext => ({ ...full(), transactions: [], accounts: [], buckets: [], recurring: [], avgMonthlySpend: "0" });
  it.each(legacies.map(e => [e.id, e] as const))("%s is answered by the real matcher with the hand-worked figure, and never by a native read", async (_id, e) => {
    mount({ legacy: q => answerLedgerQuestion(q, full()) }); await ask(e.text);
    expect(legacyCalls).toEqual([e.text]); expect(client.askVault).not.toHaveBeenCalled();
    for (const figure of e.figures) expect(cardText(), `${e.id}: ${e.hand}`).toContain(figure);
  });
  it.each(legacies.map(e => [e.id, e] as const))("%s, with the profile entity absent, gives the supported plain outcome", async (_id, e) => {
    mount({ legacy: q => answerLedgerQuestion(q, empty()) }); await ask(e.text);
    for (const figure of e.absentFigures) expect(cardText()).toContain(figure);
    expect(client.askVault).not.toHaveBeenCalled();
  });
  it("an edited profile changes the legacy answer (a second loan changes the debt total)", async () => {
    mount({ legacy: q => answerLedgerQuestion(q, full()) }); await ask("what's my total debt");
    expect(cardText()).toContain("You owe $8,500.00 in total.");
    remount();
    const more = full(); more.accounts = [...more.accounts, account({ id: 4, name: "Student Loan", account_type: "loan", starting_balance: "10000", current_balance: "4000" }) as never];
    mount({ legacy: q => answerLedgerQuestion(q, more) }); await ask("what's my total debt");
    expect(cardText()).toContain("You owe $12,500.00 in total.");
  });
  it("the older examples are cross-referenced to their existing arithmetic checks, which exist", () => {
    const source = readFileSync("src/ledgerQa.test.ts", "utf8");
    for (const e of legacies) for (const title of [e.existingArithmetic.replace("src/ledgerQa.test.ts ", "")]) expect(source, `${e.id}: ${title}`).toContain(`describe("${title}"`);
  });
});

describe("native examples with the named entity absent give a plain outcome and no figure (VP-11 step 2)", () => {
  const removeFrom = (e: NativeExample): ParseContext => {
    const a = e.absent!;
    if (a.remove === "category") return { ...ctx, categories: ctx.categories.filter(c => c !== a.name) };
    return { ...ctx, merchants: ctx.merchants!.filter(m => m !== a.name) };
  };
  it.each(natives.filter(e => e.absent).map(e => [e.id, e] as const))("%s (%s)", async (_id, e) => {
    client = makeClient({ askVault: (async (req: Record<string, unknown>) => reply(EXAMPLE_WORLD, req)) as never });
    mount({ ctx: removeFrom(e) }); await ask(e.text);
    expect(client.askVault).not.toHaveBeenCalled();
    expect(cardText()).not.toMatch(/\$\d/); expect(dialog()).toBeNull(); expect(legacyCalls.every(q => q === e.text)).toBe(true);
    expect(cardText(), e.absent!.why).toMatch(/couldn't find|don't understand|did you mean|Which|choose/i);
  });
});

describe("the by-month example shows every month once expanded, with the hand-worked amounts", () => {
  it("Show all 10 reveals June $25.00, July $95.00, August $20.00, September $1,856.50 and October $75.00", async () => {
    client = makeClient({ askVault: (async (req: Record<string, unknown>) => reply(EXAMPLE_WORLD, req)) as never });
    mount(); await ask("spending by month this year");
    await click("Show all 10");
    const text = dialogText() || cardText();
    for (const row of ["June 2026$25.00", "July 2026$95.00", "August 2026$20.00", "September 2026$1,856.50", "October 2026$75.00"]) expect(text).toContain(row);
  });
});

// ---- Scenario examples, driven through review and explicit consent to a completed result --------------------------------------------------------
const period = (over: Record<string, unknown> = {}) => ({
  from: "2026-07-01", to: "2026-09-30", dayCount: 92, endsToday: false, historyCoverage: "unknown" as const, total: "900", purchaseCount: 3, categoryCount: 1, categories: [], purchases: [],
  vendors: [], vendorNameCount: 0, vendorTotals: [], leftOut: { total: "0", purchaseCount: 0, vendors: [], categories: [] }, ...over,
});
const MONTHS = ["07", "08", "09"].map(m => ({ month: `2026-${m}`, from: `2026-${m}-01`, to: `2026-${m}-${m === "09" ? "30" : "31"}`, dayCount: m === "09" ? 30 : 31, coverage: "complete" as const, recordCount: 1, total: "300", purchaseCount: 1 }));
const baselineSnapshot = () => ({
  contractVersion: 2 as const, context: { generation: 1, sessionRevision: 1 }, revision: { ...REVISION }, asOf: EXAMPLE_TODAY, kind: "total" as const, spendingBasis: "gross-negative-allocations",
  thresholdBasis: "absolute-parent-amount", difference: null, earliestRecord: "2025-01-01", comparison: null,
  periods: [{ ...period(), categoryTotals: [], sharedPurchaseCount: 0, memberTotals: [], recordedFrom: "2025-01-01", recordedThrough: EXAMPLE_TODAY, average: null, months: MONTHS }],
});
const plainSnapshot = (req: { periods: { from: string; to: string }[] }) => ({
  contractVersion: 1 as const, context: { generation: 1, sessionRevision: 1 }, revision: { ...REVISION }, asOf: EXAMPLE_TODAY, kind: "total" as const, spendingBasis: "gross-negative-allocations",
  thresholdBasis: "absolute-parent-amount", difference: null, periods: [period({ from: req.periods[0].from, to: req.periods[0].to, dayCount: 1, total: "0", purchaseCount: 0, categoryCount: 0 })],
});
const bundle = (names: string[]) => ({
  contractVersion: 1, context: { generation: 1, sessionRevision: 1 }, revision: { ...REVISION }, asOf: EXAMPLE_TODAY,
  baselines: names.map(category => ({ category, snapshot: { ...baselineSnapshot(), periods: [{ ...baselineSnapshot().periods[0], total: "900", purchaseCount: 3,
    average: { basis: "per-month", numerator: "900", denominator: 3, value: "300.00", unavailable: null, monthsUsed: MONTHS.map(m => m.month), monthsLeftOut: [] } }] } })),
});
const roster = [{ id: 5, name: "Roth IRA" }];
const contextReply = (id: number) => ({ contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { ...REVISION }, asOf: EXAMPLE_TODAY, account: { id, name: "Roth IRA", type: "investment" },
  worth: { amount: "10000", basis: "holdings" }, contribution: { kind: "saved", monthlyAmount: "200" }, returnAssumption: { kind: "stored-plan", annualPct: "7" }, inflation: { kind: "stored", pct: "3" }, retirementMonth: "2056-01" });
const scenarioClient = () => makeClient({
  askVault: (async (req: { periods: { from: string; to: string }[] }) => ("contractVersion" in req ? baselineSnapshot() : plainSnapshot(req))) as never,
  askVaultBaselines: (async (req: { categories: string[] }) => bundle(req.categories)) as never,
  askVaultRetirementAccounts: (async (req: RetirementRosterWireRequest) => validateRetirementRosterReply({ contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { ...REVISION }, asOf: EXAMPLE_TODAY, accounts: roster }, req, EXAMPLE_TODAY)) as never,
  askVaultRetirementContext: (async (req: RetirementContextWireRequest) => validateRetirementContextReply(contextReply(req.accountId) as never, req, EXAMPLE_TODAY)) as never,
});
/** Independent future value: growth is worked out each month, then the deposit is added at month end (the result card states this rule). */
const futureValue = (opening: number, monthly: number, annualPct: number, months: number) => {
  const r = annualPct / 100 / 12, g = Math.pow(1 + r, months);
  return opening * g + monthly * (g - 1) / r;
};
const thousands = (n: number) => `$${(Math.round(n / 1000) * 1000).toLocaleString("en-US")}`;

describe("M09 What if I cut Groceries by $50 a month? completes through review and consent, and follows an edit", () => {
  const Q = "What if I cut Groceries by $50 a month?";
  async function toResult(question: string, partMonth: string) {
    await ask(question);
    expect(dialogText()).toContain("Nothing has been calculated yet.");
    await radio("From now until December 31, 2026"); await radio(partMonth);
    await click("Review the details");
    expect(dialogText()).toContain("Check these details");
    expect(cardText() + dialogText()).not.toMatch(/What you would save/);
    await click("Show what I would save");
  }
  it("whole months only: November and December at $50 is $100.00 (2 x $50), shown only after consent", async () => {
    client = scenarioClient(); mount(); await toResult(Q, "Count only whole months");
    expect(dialogText()).toContain("What you would save"); expect(dialogText()).toContain("$100.00");
  });
  it("counting the part month by the day: 12 of 31 days of October plus two months is $119.35 (50 x (12/31 + 2))", async () => {
    client = scenarioClient(); mount(); await toResult(Q, "Count the part month by the day");
    expect(dialogText()).toContain("$119.35");
  });
  it("editing the amount to $75 retires the result and gives $150.00 for whole months", async () => {
    client = scenarioClient(); mount(); await toResult(Q, "Count only whole months");
    expect(dialogText()).toContain("$100.00");
    await type("What if I cut Groceries by $75 a month?");
    expect(dialog()).toBeNull();
    await toResult("What if I cut Groceries by $75 a month?", "Count only whole months");
    expect(dialogText()).toContain("$150.00"); expect(dialogText()).not.toContain("$100.00");
  });
  it("only read methods exist on the client: nothing could be written to the budget or accounts", async () => {
    client = scenarioClient(); mount(); await toResult(Q, "Count only whole months");
    expect(Object.keys(client).sort()).toEqual(["askVault", "askVaultBaselines", "askVaultRetirementAccounts", "askVaultRetirementContext", "dispose"]);
  });
});

describe("M06 and M07 savings-target examples complete through review and consent", () => {
  async function choose() {
    await check("Select Groceries");
    await click("Allow up to 100% with floor $0 for Groceries");
    await radio("From now until December 31, 2026"); await radio("Count only whole months");
    await click("Review the details");
    expect(dialogText()).toContain("Check every detail");
    await click("Show the preview");
  }
  it("M06 $200 a month over November and December is $400.00 across the selected dates, with no shortfall", async () => {
    client = scenarioClient(); mount(); await ask("Where can I cut back to save $200 a month?");
    expect(dialogText()).toContain("Where would you like to cut back?");
    await choose();
    expect(dialogText()).toContain("Your savings target preview"); expect(dialogText()).toContain("Goal: $200.00 per month"); expect(dialogText()).toContain("$400.00 across the selected dates");
  });
  it("M07 $200 in total this year is $200.00 across the selected dates", async () => {
    client = scenarioClient(); mount(); await ask("Save $200 in total this year");
    await choose();
    expect(dialogText()).toContain("Goal: $200.00 over these dates"); expect(dialogText()).toContain("$200.00 across the selected dates");
  });
  it("editing the target to $300 a month changes the preview to $600.00", async () => {
    client = scenarioClient(); mount(); await ask("Where can I cut back to save $200 a month?"); await choose();
    await type("Where can I cut back to save $300 a month?"); expect(dialog()).toBeNull();
    await ask("Where can I cut back to save $300 a month?"); await choose();
    expect(dialogText()).toContain("$600.00 across the selected dates"); expect(dialogText()).not.toContain("$400.00");
  });
});

describe("M08 Extra $50 a month into Roth IRA until January 2056 completes through review and consent", () => {
  const Q = "Extra $50 a month into Roth IRA until January 2056";
  it("351 months: exact deposits $17,550.00 (351 x 50), and the balances follow an independent calculation", async () => {
    client = scenarioClient(); mount(); await ask(Q);
    expect(dialogText()).toContain("Roth IRA"); expect(dialogText()).toContain("351 months");
    expect(dialogText()).not.toContain("Illustrative balance");
    await click("Use my saved plan");
    const text = dialogText();
    expect(text).toContain("Adding $50 each month to Roth IRA"); expect(text).toContain("Extra deposits: $17,550.00 in total");
    // No growth: $10,000 now + $200 x 351 planned, with and without the extra $50 x 351.
    expect(text).toContain(thousands(10000 + 200 * 351)); expect(text).toContain(thousands(10000 + 250 * 351));
    // 7% a year, monthly growth, deposit at month end.
    expect(text).toContain(thousands(futureValue(10000, 200, 7, 351))); expect(text).toContain(thousands(futureValue(10000, 250, 7, 351)));
    expect(text).toContain(thousands(futureValue(10000, 250, 7, 351) - futureValue(10000, 200, 7, 351)));
    for (const label of ["Without the extra", "With the extra", "No investment growth", "Using your confirmed plan return"]) expect(text).toContain(label);
    expect(text).toContain("These are illustrations, not predictions."); expect(text).toContain("Nothing in your accounts was changed.");
  });
  it("editing the extra to $75 retires the result and gives $26,325.00 of exact deposits", async () => {
    client = scenarioClient(); mount(); await ask(Q); await click("Use my saved plan");
    expect(dialogText()).toContain("$17,550.00");
    await type("Extra $75 a month into Roth IRA until January 2056"); expect(dialog()).toBeNull();
    await ask("Extra $75 a month into Roth IRA until January 2056"); await click("Use my saved plan");
    expect(dialogText()).toContain("Extra deposits: $26,325.00 in total"); expect(dialogText()).not.toContain("$17,550.00");
  });
  it("without an investment account the example gets the plain supported answer and nothing is read", async () => {
    client = scenarioClient(); mount({ ctx: { ...ctx, investmentAccounts: [] } }); await ask(Q);
    expect(dialogText()).toMatch(/You don't have an investment account yet/); expect(client.askVaultRetirementAccounts).not.toHaveBeenCalled();
  });
});

// ---- Help-claim probes: behaviors the Help describes that no advertised example exercises ------------------------------------------------------------
const SEPT = { from: "2026-09-01", to: "2026-09-30" };
const base1 = (over: Record<string, unknown>) => ({ kind: "total", accountIds: [], categories: [], minimumPurchase: null, vendors: [], excludeVendors: [], excludeCategories: [], limit: 1, expectedRevision: null, ...over });
const base2 = (over: Record<string, unknown>) => ({ ...base1({}), contractVersion: 2, members: { ids: [], unassigned: false }, groupBy: "none", average: "none", alignment: "as-requested", ...over });
const nativeAnswers = () => makeClient({ askVault: (async (req: Record<string, unknown>) => reply(EXAMPLE_WORLD, req)) as never });

describe("Help claims with no advertised example, proved through the real card with hand-worked figures", () => {
  it("a total for one account: Everyday Checking last month is $1,856.50 over 8 purchases (every September purchase is in it)", async () => {
    client = nativeAnswers(); mount(); await ask("how much did I spend on the Everyday Checking last month");
    expect(client.askVault.mock.calls[0][0]).toEqual(base1({ periods: [SEPT], accountIds: [1] }));
    expect(cardText()).toContain("You spent $1,856.50 on everything from Everyday Checking in September 2026."); expect(cardText()).toContain("8 purchases");
  });
  it("several categories add up without double counting: Groceries $338.50 + Dining Out $18.00 = $356.50 over 7 purchases", async () => {
    client = nativeAnswers(); mount(); await ask("how much did I spend on groceries and dining out last month");
    expect(client.askVault.mock.calls[0][0]).toEqual(base2({ periods: [SEPT], categories: ["Groceries", "Dining Out"] }));
    expect(cardText()).toContain("You spent $356.50 on Groceries and Dining Out in September 2026."); expect(cardText()).toContain("7 purchases");
  });
  it("one named family member: Sam spent $259.00 over 4 purchases last month", async () => {
    client = nativeAnswers(); mount(); await ask("how much did sam spend last month");
    expect(client.askVault.mock.calls[0][0]).toEqual(base2({ periods: [SEPT], members: { ids: [1], unassigned: false } }));
    expect(cardText()).toContain("You spent $259.00 on everything for Sam in September 2026."); expect(cardText()).toContain("4 purchases");
  });
  it("an average per recorded month uses only July, August and September: ($95.00 + $20.00 + $1,856.50) / 3 = $657.17; June (partly recorded), October (in progress) and January to May are left out and named", async () => {
    client = nativeAnswers(); mount(); await ask("average monthly spending year to date");
    expect(client.askVault.mock.calls[0][0]).toEqual(base2({ periods: [{ from: "2026-01-01", to: EXAMPLE_TODAY }], average: "per-month" }));
    const text = cardText();
    expect(text).toContain("You averaged $657.17 per month in 2026 so far."); expect(text).toContain("$1,971.50 ÷ 3 months");
    expect(text).toContain("Used: July 2026, August 2026, September 2026.");
    expect(text).toContain("June 2026 (Recording started partway through this month)"); expect(text).toContain("October 2026 (Month still in progress)");
  });
  it("same days last month: Groceries so far this month $50.00 against the same 20 days last month $338.50 is $288.50 less, 85.2% less", async () => {
    client = nativeAnswers(); mount(); await ask("compare groceries so far this month to the same days last month");
    expect(client.askVault.mock.calls[0][0]).toEqual(base2({ kind: "compare", categories: ["Groceries"], alignment: "same-days-previous-month",
      periods: [{ from: "2026-10-01", to: EXAMPLE_TODAY }, { from: "2026-09-01", to: "2026-09-20" }] }));
    expect(cardText()).toContain("You spent $50.00 on Groceries in October 2026 so far and $338.50 in the same days in the month before.");
    expect(cardText()).toContain("That is $288.50 less in October 2026 so far. That is 85.2% less.");
  });
  it("View purchases lists the purchases behind the total: July Dining Out shows SUSHI PLACE $60.00 and TACO TOWN $35.00", async () => {
    client = nativeAnswers(); mount(); await ask("how much did I spend on dining out in July");
    await click("View 2 purchases");
    expect(client.askVault.mock.calls.at(-1)![0]).toEqual(base1({ kind: "rank-purchases", periods: [{ from: "2026-07-01", to: "2026-07-31" }], categories: ["Dining Out"], limit: 50, expectedRevision: REVISION }));
    const text = dialogText() || cardText();
    expect(text).toContain("SUSHI PLACE"); expect(text).toContain("$60.00"); expect(text).toContain("TACO TOWN"); expect(text).toContain("$35.00");
  });
  it("a misspelled category: a near-certain typo is read as the closest name and disclosed, then answered (the Help says it asks; owner decision pending)", async () => {
    client = nativeAnswers(); mount(); await ask("how much did I spend on dinning out in July");
    expect(cardText()).toContain("I read “dinning out” as “Dining Out”.");
    expect(client.askVault.mock.calls[0][0]).toEqual(base1({ periods: [{ from: "2026-07-01", to: "2026-07-31" }], categories: ["Dining Out"] }));
    expect(cardText()).toContain("You spent $95.00 on Dining Out in July 2026.");
  });
});

describe("extra money looks at one investment account at a time (Help claim H4-02)", () => {
  it("one investment account at a time: a request naming two accounts is refused plainly and nothing is read", async () => {
    client = scenarioClient();
    mount({ ctx: { ...ctx, investmentAccounts: [{ id: 5, name: "Roth IRA" }, { id: 6, name: "Brokerage" }] } });
    await ask("Extra $50 a month into Roth IRA and Brokerage until January 2056");
    expect(dialogText()).toMatch(/one (investment )?account|can.t do that yet/i); expect(dialogText()).not.toContain("Illustrative balance");
    expect(client.askVaultRetirementContext).not.toHaveBeenCalled();
  });
});

describe("the Help claim map is current, complete about its gaps, and its references exist", () => {
  const strip = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  it("every claim excerpt still appears in the Help or Tips source it cites", () => {
    const sources = { "src/HelpView.tsx": strip(readFileSync("src/HelpView.tsx", "utf8")), "src/AskVaultCard.tsx": strip(readFileSync("src/AskVaultCard.tsx", "utf8")) };
    for (const c of CLAIMS) expect(sources[c.source], c.id).toContain(c.excerpt);
  });
  it("every cited test exists by file and title, so a renamed or deleted test cannot keep a claim covered", () => {
    const files = new Map<string, string>();
    for (const c of CLAIMS) for (const ref of c.tests) {
      if (!files.has(ref.file)) files.set(ref.file, readFileSync(ref.file, "utf8"));
      expect(files.get(ref.file), `${c.id}: ${ref.file} :: ${ref.title}`).toContain(ref.title);
    }
  });
  it("claim ids are unique, and every claim has either a test or a stated gap", () => {
    expect(new Set(CLAIMS.map(c => c.id)).size).toBe(CLAIMS.length);
    for (const c of CLAIMS) expect(c.tests.length > 0 || !!c.gap, c.id).toBe(true);
  });
  it("no claim has a stated gap left; adding one is deliberate", () => {
    expect(CLAIMS.filter(c => c.gap).map(c => c.id)).toEqual([]);
  });
});

// ---- P-ID: insufficient history gives a safe outcome and never an invented number (Validation-Plan VP-04; M3 Contract.md:25) ------------------------
describe("P-ID insufficient history: the M3 review asks for the person's own usual month or an explicit acceptance, and invents no number", () => {
  const coverage = (complete: number) => MONTHS.map((m, i) => i < complete
    ? m : { ...m, coverage: "no-records" as const, recordCount: 0, total: "0", purchaseCount: 0 });
  const historyClient = (complete: number) => makeClient({
    askVault: (async (req: { periods: { from: string; to: string }[] }) => ("contractVersion" in req
      ? { ...baselineSnapshot(), periods: [{ ...baselineSnapshot().periods[0], months: coverage(complete), total: String(300 * complete), purchaseCount: complete,
        average: { basis: "per-month", numerator: String(300 * complete), denominator: complete, value: complete ? "300.00" : null, unavailable: complete ? null : "no-complete-months",
          monthsUsed: coverage(complete).filter(m => m.coverage === "complete").map(m => m.month), monthsLeftOut: coverage(complete).filter(m => m.coverage !== "complete").map(m => ({ month: m.month, why: "no-records" as const })) } }] }
      : plainSnapshot(req))) as never,
  });
  async function toReview() {
    await ask("What if I cut Groceries by $50 a month?");
    await radio("From now until December 31, 2026"); await radio("Count only whole months");
    await click("Review the details");
  }
  it("no complete month: no saving is shown, and the review asks for the person's own usual month", async () => {
    client = historyClient(0); mount(); await toReview();
    expect(dialogText()).toMatch(/usual month|your own/i);
    expect(dialogText()).not.toContain("What you would save"); expect(dialogText()).not.toContain("$100.00");
    expect([...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].some(b => b.textContent === "Show what I would save" && !b.disabled)).toBe(false);
  });
  it("one or two complete months: the months there are need an explicit acceptance before any saving is shown", async () => {
    for (const complete of [1, 2]) {
      remount(); client = historyClient(complete); mount(); await toReview();
      expect(dialogText(), `${complete} complete`).not.toContain("What you would save");
      expect(dialogText()).toMatch(/month/i);
      expect([...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].some(b => b.textContent === "Show what I would save" && !b.disabled)).toBe(false);
    }
  });
});

describe("M3 and M4 examples with the named entity absent give the supported plain outcome and read nothing", () => {
  it("M09 without a Groceries category asks for an exact category name and calculates nothing", async () => {
    client = scenarioClient(); mount({ ctx: { ...ctx, categories: ["Dining", "Rent"] } }); await ask("What if I cut Groceries by $50 a month?");
    expect(cardText()).toContain("Nothing has been calculated yet."); expect(cardText()).toMatch(/couldn.t find a close category/i);
    expect(dialog()).toBeNull(); expect(client.askVault).not.toHaveBeenCalled(); expect(cardText()).not.toMatch(/What you would save/);
  });
  it("M06 with no categories at all cannot reach a preview: nothing can be selected and no number is shown", async () => {
    client = scenarioClient(); mount({ ctx: { ...ctx, categories: [] } }); await ask("Where can I cut back to save $200 a month?");
    expect(dialogText()).toContain("Where would you like to cut back?");
    expect(document.querySelectorAll("[role=dialog] input[type=checkbox]").length).toBe(0);
    expect([...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].some(b => b.textContent === "Review the details" && !b.disabled)).toBe(false);
    expect(dialogText()).not.toContain("across the selected dates");
  });
});

// ---- The disclosed Help-claim gaps, closed (owner instruction of 21 October 2026) ---------------------------------------------------------------------
import { notifyDataWrite, RELEVANT_WRITE_COMMANDS } from "./dataWriteEvents";

describe("H1-08 and T-01: same days last month and same days last YEAR", () => {
  // Hand-worked profile: Groceries 2025: Mar 10 $100.00, Aug 15 $40.00 (total $140.00 for 1 Jan to 20 Oct 2025); 2026: Mar 12 $120.00, Sep 30 $30.00 ($150.00 for 1 Jan to 20 Oct 2026).
  const yearWorld: World = { name: "years", today: EXAMPLE_TODAY, members: [], accounts: [{ id: 1, name: "Everyday Checking", memberId: null }], categories: ["Groceries", "Rent"], ledger: [
    { id: 1, accountId: 1, date: "2025-03-10", description: "COSTCO WHSE", cents: -10000, category: "Groceries", memberId: null },
    { id: 2, accountId: 1, date: "2025-08-15", description: "COSTCO WHSE", cents: -4000, category: "Groceries", memberId: null },
    { id: 3, accountId: 1, date: "2026-03-12", description: "COSTCO WHSE", cents: -12000, category: "Groceries", memberId: null },
    { id: 4, accountId: 1, date: "2026-09-30", description: "COSTCO WHSE", cents: -3000, category: "Groceries", memberId: null },
  ] };
  it("the same days a year earlier: $150.00 so far this year against $140.00 for 1 January to 20 October last year is $10.00 more, 7.1% more (10 / 140)", async () => {
    client = makeClient({ askVault: (async (req: Record<string, unknown>) => reply(yearWorld, req)) as never });
    mount({ ctx: { ...ctx, merchants: ["COSTCO WHSE"], historyStart: "2025-01-01" } as ParseContext });
    await ask("compare groceries so far this year to the same days last year");
    expect(client.askVault.mock.calls[0][0]).toEqual(base2({ kind: "compare", categories: ["Groceries"], alignment: "same-days-previous-year",
      periods: [{ from: "2026-01-01", to: EXAMPLE_TODAY }, { from: "2025-01-01", to: "2025-10-20" }] }));
    expect(cardText()).toContain("You spent $150.00 on Groceries in 2026 so far and $140.00 in the same days a year earlier.");
    expect(cardText()).toContain("That is $10.00 more in 2026 so far. That is 7.1% more.");
  });
});

describe("T-03 and H2-01: a one-time cut", () => {
  it("What if I cut Groceries by $50 once on November 5, 2026 saves $50.00 once, with no monthly limit, after review and consent", async () => {
    client = scenarioClient(); mount();
    await ask("What if I cut Groceries by $50 once on November 5, 2026");
    expect(dialogText()).toContain("Check these details"); expect(dialogText()).toContain("November 5, 2026");
    await click("Show what I would save");
    expect(dialogText()).toContain("What you would save"); expect(dialogText()).toContain("$50.00"); expect(dialogText()).not.toContain("$100.00");
    expect(dialogText()).toContain("A one-time cut does not set a monthly limit.");
  });
  it("editing the one-time amount to $80 changes the saving to $80.00", async () => {
    client = scenarioClient(); mount();
    await ask("What if I cut Groceries by $50 once on November 5, 2026"); await click("Show what I would save");
    await type("What if I cut Groceries by $80 once on November 5, 2026"); expect(dialog()).toBeNull();
    await ask("What if I cut Groceries by $80 once on November 5, 2026"); await click("Show what I would save");
    expect(dialogText()).toContain("$80.00"); expect(dialogText()).not.toContain("$50.00");
  });
});

describe("H3-09: a savings target the limits cannot reach shows the achievable amount, the maximum and the shortfall", () => {
  it("$500 a month from a $300 usual month with up to 100 percent allowed, over November and December: achievable $300.00 a month, shortfall $200.00 a month, $600.00 across the dates", async () => {
    client = scenarioClient(); mount(); await ask("Where can I cut back to save $500 a month?");
    await check("Select Groceries"); await click("Allow up to 100% with floor $0 for Groceries");
    await radio("From now until December 31, 2026"); await radio("Count only whole months");
    await click("Review the details"); await click("Show the preview");
    const text = dialogText();
    expect(text).toContain("Goal: $500.00 per month");
    expect(text).toContain("Achievable: $300.00 per month"); expect(text).toContain("Maximum: $300.00 per month"); expect(text).toContain("Shortfall: $200.00 per month");
    expect(text).toContain("This target cannot be met with these constraints."); expect(text).toContain("$600.00 across the selected dates");
  });
});

describe("H4-07: numbers too large to show give the attention card and nothing is calculated, then Change the details recovers", () => {
  const hugeClient = () => makeClient({
    askVaultRetirementAccounts: (async (req: RetirementRosterWireRequest) => validateRetirementRosterReply({ contractVersion: 1, context: { generation: 3, sessionRevision: 11 }, revision: { ...REVISION }, asOf: EXAMPLE_TODAY, accounts: roster }, req, EXAMPLE_TODAY)) as never,
    askVaultRetirementContext: (async (req: RetirementContextWireRequest) => validateRetirementContextReply({ ...contextReply(req.accountId), returnAssumption: { kind: "stored-plan", annualPct: "100" }, retirementMonth: "2100-10" } as never, req, EXAMPLE_TODAY)) as never,
  });
  it("a saved 100 percent return to October 2100 cannot be shown exactly: A few details need attention, no balance, and the plain way forward", async () => {
    client = hugeClient(); mount(); await ask("Extra $50 a month into Roth IRA until October 2100");
    await click("Use my saved plan");
    expect(dialogText()).toContain("A few details need attention"); expect(dialogText()).not.toContain("Illustrative balance");
    expect(dialogText()).toContain("Change the details");
  });
});

describe("H2-05 and H4-14: edits, a new day, a switched profile and a lock close an open review or result", () => {
  const FULL = "What if I cut Groceries by $50 a month?";
  async function m3Result(over: { ctx?: ParseContext }) {
    const view = mount(over); await ask(FULL);
    await radio("From now until December 31, 2026"); await radio("Count only whole months"); await click("Review the details"); await click("Show what I would save");
    expect(dialogText()).toContain("$100.00"); return view;
  }
  async function m5Result(over: { ctx?: ParseContext }) {
    const view = mount(over); await ask("Extra $50 a month into Roth IRA until January 2056"); await click("Use my saved plan");
    expect(dialogText()).toContain("Illustrative balance"); return view;
  }
  it("M3: a new day closes the result and asks to ask again", async () => {
    const over = { ctx: { ...ctx } as ParseContext }; client = scenarioClient(); const view = await m3Result(over);
    over.ctx = { ...ctx, today: "2026-10-21" } as ParseContext; view.rerender("v1");
    expect(dialogText()).not.toContain("$100.00"); expect(dialogText()).toMatch(/changed|Ask again/);
  });
  it("M3: switching profile (a new data key) closes the result", async () => {
    client = scenarioClient(); const view = await m3Result({}); view.rerender("another profile");
    expect(dialogText()).not.toContain("$100.00"); expect(dialogText()).toMatch(/changed|Ask again/);
  });
  it("M5: a new day closes the result", async () => {
    const over = { ctx: { ...ctx } as ParseContext }; client = scenarioClient(); const view = await m5Result(over);
    over.ctx = { ...ctx, today: "2026-10-21" } as ParseContext; view.rerender("v1");
    expect(dialogText()).not.toContain("Illustrative balance"); expect(dialogText()).toMatch(/changed|Ask again/);
  });
  it("M5: switching profile (a new data key) closes the result", async () => {
    client = scenarioClient(); const view = await m5Result({}); view.rerender("another profile");
    expect(dialogText()).not.toContain("Illustrative balance"); expect(dialogText()).toMatch(/changed|Ask again/);
  });
  it.each(["set_investment_plan", "create_holding", "update_holding_price", "refresh_live_prices", "delete_holding", "update_account_type", "set_account_starting_balance", "update_transaction_principal_amount", "restore_backup"])
    ("M5: the write %s elsewhere in the app closes the result at once", async command => {
    expect(RELEVANT_WRITE_COMMANDS.has(command)).toBe(true);
    client = scenarioClient(); await m5Result({});
    await act(async () => { notifyDataWrite(command); });
    expect(dialogText()).not.toContain("Illustrative balance"); expect(dialogText()).toContain("Ask again");
  });
  it("a write the illustration does not depend on is not in the list that closes it", () => {
    for (const command of ["update_category_color", "create_budget", "set_theme"]) expect(RELEVANT_WRITE_COMMANDS.has(command), command).toBe(false);
  });
  it("locking: the card going away while a reply is pending drops the reply with no error and nothing shown (M3 and M5)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let release!: () => void;
    client = scenarioClient();
    client.askVaultRetirementContext.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(validateRetirementContextReply(contextReply(5) as never, { accountId: 5 } as never, EXAMPLE_TODAY) as never); }));
    mount(); await ask("Extra $50 a month into Roth IRA until January 2056");
    expect(dialogText()).toContain("Nothing has been calculated yet.");   // the saved-plan read is still pending
    act(() => root.unmount()); root = createRoot(container);
    await act(async () => { release(); await Promise.resolve(); });
    expect(document.querySelector("[role=dialog]")).toBeNull(); expect(errors).not.toHaveBeenCalled();
  });
});

describe("H1-02 and H3-12: answering uses no network, and the question is not kept", () => {
  it("across every example family the card makes no fetch, XMLHttpRequest, WebSocket, EventSource, beacon or image request", async () => {
    const calls: string[] = [];
    const w = globalThis as unknown as Record<string, unknown>;
    const saved = { fetch: w.fetch, XHR: w.XMLHttpRequest, WS: w.WebSocket, ES: w.EventSource, beacon: (navigator as unknown as Record<string, unknown>).sendBeacon };
    w.fetch = (...a: unknown[]) => { calls.push("fetch " + String(a[0])); return Promise.reject(new Error("no network")); };
    w.XMLHttpRequest = class { constructor() { calls.push("XMLHttpRequest"); } };
    w.WebSocket = class { constructor(u: string) { calls.push("WebSocket " + u); } };
    w.EventSource = class { constructor(u: string) { calls.push("EventSource " + u); } };
    (navigator as unknown as Record<string, unknown>).sendBeacon = (u: string) => { calls.push("beacon " + u); return false; };
    try {
      for (const q of ["how much did I spend on dining out in July", "what's my net worth", "What if I cut Groceries by $50 a month?", "Where can I cut back to save $200 a month?", "Extra $50 a month into Roth IRA until January 2056"]) {
        client = scenarioClient(); mount({ legacy: x => answerLedgerQuestion(x, { transactions: [], categories: [], accounts: [], buckets: [], recurring: [], avgMonthlySpend: "0", today: new Date(2026, 9, 20) }) });
        await ask(q); remount();
      }
    } finally { w.fetch = saved.fetch; w.XMLHttpRequest = saved.XHR; w.WebSocket = saved.WS; w.EventSource = saved.ES; (navigator as unknown as Record<string, unknown>).sendBeacon = saved.beacon; }
    expect(calls).toEqual([]);
  });
  it("the Ask the Vault sources use no network API at all, and no question or choice is written to storage", () => {
    const files = ["src/AskVaultCard.tsx", "src/CutPreviewDialog.tsx", "src/SpendingScenarioDialog.tsx", "src/RetirementScenarioDialog.tsx", ...readdirSync("src/askVault").filter(f => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map(f => `src/askVault/${f}`)];
    for (const file of files) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|new WebSocket|EventSource|sendBeacon|navigator\.|localStorage|sessionStorage|indexedDB|document\.cookie/);
    }
  });
});
