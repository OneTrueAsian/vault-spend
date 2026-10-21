// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AskVaultCard, MORE_EXAMPLES } from "./AskVaultCard";
import { LEDGER_QA_EXAMPLES } from "./ledgerQa";
import { parseQuestion } from "./askVault/parser";
import type { AskVaultSnapshot } from "./askVault/contract";
import type { AskVaultSnapshotV2 } from "./askVault/contractV2";
import type { AskVaultRequest, AskVaultRequestV2, ParseContext } from "./askVault/types";
import { TransactionError } from "./transactionContracts";
import type { AskBaselineBatchRequest, AskBaselineBatchSnapshot } from "./askVault/cutPreviewBatch";
import { useCutPreview } from "./askVault/useCutPreview";
import { parseCutPreview } from "./askVault/cutPreviewParser";
import { parseSpendingScenario } from "./askVault/spendingScenarioParser";
import { parseRetirementScenario } from "./askVault/retirementParser";
import type { ConfirmedCutPreview, CutPreviewIntent } from "./askVault/cutPreviewContract";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const context: ParseContext = {
  today: "2026-09-06",
  categories: ["Groceries", "Dining", "Dining Out", "Rent"],
  accounts: [{ id: 1, name: "Everyday Checking" }],
  merchants: ["SAMS CLUB #6482", "Costco"],
  members: ["Alex"],
  historyStart: "2025-09-01",
};
const period = (over: Record<string, unknown> = {}) => ({
  from: "2026-08-01", to: "2026-08-31", dayCount: 31, endsToday: false, historyCoverage: "unknown" as const,
  total: "317.13", purchaseCount: 3, categoryCount: 1, categories: [], purchases: [], vendors: [], vendorNameCount: 0,
  vendorTotals: [], leftOut: { total: "0", purchaseCount: 0, vendors: [], categories: [] }, ...over,
});

describe("M4 integrated savings-target routing and lifecycle", () => {
  const targetQuestion = "Save $40 monthly across Dining with Dining floor $0 and maximum cut 100% from October through November 2026";
  function bundle(names: string[], counts: Record<string, number> = {}): AskBaselineBatchSnapshot {
    return {
      contractVersion: 1, context: { generation: 1, sessionRevision: 1 }, revision: { local: 5, external: 2 }, asOf: context.today,
      baselines: names.map(category => {
        const count = counts[category] ?? 3;
        const months = ["06", "07", "08"].map((m, index) => ({
          month: `2026-${m}`, from: `2026-${m}-01`, to: `2026-${m}-${m === "06" ? 30 : 31}`, dayCount: m === "06" ? 30 : 31,
          coverage: index < count ? "complete" as const : "no-records" as const,
          recordCount: index < count ? 1 : 0, total: index < count ? "300" : "0", purchaseCount: index < count ? 1 : 0,
        }));
        return { category, snapshot: { ...snapshot(), contractVersion: 2, earliestRecord: "2025-01-01", comparison: null,
          periods: [{ ...period({ from: "2026-06-01", to: "2026-08-31", dayCount: 92, total: String(count * 300), purchaseCount: count, categoryCount: count ? 1 : 0 }),
            categoryTotals: [], sharedPurchaseCount: 0, memberTotals: [], recordedFrom: "2025-01-01", recordedThrough: context.today, months,
            average: { basis: "per-month", numerator: String(count * 300), denominator: count, value: count ? "300.00" : null, unavailable: count ? null : "no-complete-months",
              monthsUsed: months.filter(m => m.coverage === "complete").map(m => m.month), monthsLeftOut: months.filter(m => m.coverage !== "complete").map(m => ({ month: m.month, why: "no-records" as const })) },
          }],
        } };
      }),
    };
  }
  const batchClient = (counts: Record<string, number> = {}) => ({
    ...fake(async () => snapshot()),
    askVaultBaselines: vi.fn(async (request: AskBaselineBatchRequest) => bundle(request.categories, counts)),
  });
  const dialogText = () => document.querySelector('[role="dialog"]')?.textContent ?? "";
  async function enter(label: string, value: string) {
    const field = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    expect(field, label).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function radio(prefix: string) {
    const label = [...document.querySelectorAll("label.scenario-option")].find(l => l.textContent?.startsWith(prefix));
    expect(label, prefix).toBeDefined();
    await act(async () => label!.querySelector<HTMLInputElement>("input")!.click());
  }
  async function review() { await click("Review the details"); }
  async function preview() { await review(); await click("Show the preview"); }

  it("routes a target through deliberate choices, one batch, live revision check and exact calculator", async () => {
    const client = batchClient(); mount(client);
    await ask(targetQuestion);
    expect(dialogText()).toContain("Where would you like to cut back?");
    expect(client.askVault).not.toHaveBeenCalled();
    expect(client.askVaultBaselines).not.toHaveBeenCalled();
    await review();
    expect(dialogText()).toContain("Check every detail");
    expect(client.askVaultBaselines).toHaveBeenCalledTimes(1);
    expect(client.askVaultBaselines.mock.calls[0][0]).toEqual({ contractVersion: 1, categories: ["Dining"], expectedRevision: { local: 5, external: 2 } });
    expect(document.querySelector('.cut-preview-results')).toBeNull();
    await click("Show the preview");
    expect(dialogText()).toContain("Goal: $40.00 per month");
    expect(dialogText()).toContain("$80.00 across the selected dates");
    expect(client.askVault.mock.calls.at(-1)![0]).toMatchObject({ expectedRevision: { local: 5, external: 2 }, periods: [{ from: context.today, to: context.today }] });
    expect(client.askVaultBaselines).toHaveBeenCalledTimes(1);
  });
  it("distinguishes a whole-period target from monthly and labels monthly equivalents", async () => {
    mount(batchClient()); await ask(targetQuestion.replace("$40 monthly", "$40 in total")); await preview();
    expect(dialogText()).toContain("Goal: $40.00 over these dates");
    expect(dialogText()).toContain("$40.00 across the selected dates");
    expect(dialogText()).toContain("Approx. monthly cut");
  });
  for (const choice of ["From now until December 31", "The whole of 2026 as a what-if"]) it(`requires and routes year-choice: ${choice}`, async () => {
    const client = batchClient(); mount(client);
    await ask(targetQuestion.replace("from October through November 2026", "this year"));
    expect(client.askVaultBaselines).not.toHaveBeenCalled();
    expect([...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === "Review the details")?.disabled).toBe(true);
    await radio(choice);
    if (choice.startsWith("From")) await radio("Count the part month by the day");
    await preview();
    expect(dialogText()).toContain("Your savings target preview");
    if (choice.startsWith("The whole")) expect(dialogText()).toContain("includes months that have already passed");
  });
  it("re-parses a close category choice without losing target, schedule or constraints", async () => {
    const client = batchClient(); mount(client);
    await ask("Save $40 monthly across dinning from October through November 2026");
    expect(client.askVault).not.toHaveBeenCalled();
    await click("Dining");
    expect(dialogText()).toContain("Dining");
    await click("Allow up to 100% with floor $0 for Dining");
    await preview();
    expect(dialogText()).toContain("Goal: $40.00 per month");
    expect(dialogText()).toContain("$80.00 across the selected dates");
  });
  for (const suffix of ["for Alex", "at Costco", "weekly", "apply these cuts", "cut the fewest categories"]) it(`explains unsupported target scope without reading or legacy fallback: ${suffix}`, async () => {
    const client = batchClient(); mount(client); legacy.mockClear();
    await ask(targetQuestion + " " + suffix);
    expect(dialogText()).not.toBe("");
    expect(dialogText()).not.toContain("Your savings target preview");
    expect(client.askVault).not.toHaveBeenCalled(); expect(client.askVaultBaselines).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled();
  });
  for (const first of ["manual", "recorded"]) it(`resolves missing Dining and short Groceries in either order: ${first}`, async () => {
    const client = batchClient({ Dining: 0, Groceries: 2 }); mount(client);
    await ask(targetQuestion.replace("across Dining", "across Dining and Groceries with Groceries floor $0 and maximum cut 100%"));
    await review();
    const confirm = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === "Show the preview")!;
    expect(confirm().disabled).toBe(true);
    if (first === "manual") await enter("Dining usual month", "100"); else await radio("Use 2 recorded months for Groceries");
    expect(confirm().disabled).toBe(true); expect(client.askVault).toHaveBeenCalledTimes(1);
    if (first === "manual") await radio("Use 2 recorded months for Groceries"); else await enter("Dining usual month", "100");
    await click("Show the preview");
    expect(dialogText()).toContain("Your savings target preview"); expect(dialogText()).toContain("$80.00 across the selected dates");
  });
  it("removing the last category returns to explicit choices without a calculation", async () => {
    const client = batchClient({ Dining: 0 }); mount(client); await ask(targetQuestion); await review(); await click("Remove Dining");
    expect(dialogText()).toContain("Where would you like to cut back?");
    expect(document.querySelector<HTMLInputElement>('[aria-label="Select Dining"]')?.checked).toBe(false);
    expect(document.querySelector('.cut-preview-results')).toBeNull(); expect(client.askVault).toHaveBeenCalledTimes(1);
  });
  it("editing terms preserves them as a draft and requires new history review and confirmation", async () => {
    const client = batchClient(); mount(client); await ask(targetQuestion); await preview();
    await click("Change the details");
    expect(dialogText()).toContain("Where would you like to cut back?"); expect(document.querySelector('.cut-preview-results')).toBeNull();
    await enter("Savings target", "60"); await review();
    expect(dialogText()).toContain("Check every detail"); expect(document.querySelector('.cut-preview-results')).toBeNull();
    await click("Show the preview"); expect(dialogText()).toContain("$120.00 across the selected dates");
    expect(client.askVaultBaselines).toHaveBeenCalledTimes(2);
  });
  for (const change of ["ledger", "reload", "roster", "day"]) it(`retires a displayed result immediately after ${change}`, async () => {
    const ctx = structuredClone(context), client = batchClient(), view = mount(client, { ctx });
    await ask(targetQuestion); await preview();
    if (change === "roster") ctx.categories = ctx.categories.filter(c => c !== "Dining");
    if (change === "day") ctx.today = "2026-09-07";
    view.rerender(change === "ledger" ? "v2" : "v1", change === "reload" ? "r2" : "r1");
    expect(document.querySelector('.cut-preview-results')).toBeNull(); expect(dialogText()).toContain("changed");
  });
  for (const phase of ["source", "bundle", "confirmation"]) for (const action of ["new-question", "close", "reload", "unmount"]) it(`drops a late ${phase} reply after ${action}`, async () => {
    const client = batchClient(); let release!: () => void;
    if (phase === "bundle") client.askVaultBaselines.mockImplementationOnce(request => new Promise(resolve => { release = () => resolve(bundle(request.categories)); }));
    else {
      const hold = () => new Promise<AskVaultSnapshot>(resolve => { release = () => resolve(snapshot()); });
      if (phase === "source") client.askVault.mockImplementationOnce(hold); else client.askVault.mockImplementationOnce(async () => snapshot()).mockImplementationOnce(hold);
    }
    const view = mount(client); await ask(targetQuestion); await review();
    if (phase === "confirmation") await click("Show the preview");
    expect(release).toBeTypeOf("function");
    if (action === "new-question") await ask("how much did I spend on groceries last month");
    if (action === "close") await click("Close");
    if (action === "reload") view.rerender("v1", "r2");
    if (action === "unmount") { act(() => root.unmount()); expect(client.dispose).toHaveBeenCalled(); root = createRoot(container); }
    await act(async () => release()); await settle();
    expect(document.querySelector('.cut-preview-results')).toBeNull();
    if (action === "new-question" || action === "close" || action === "unmount") expect(document.querySelector('[role="dialog"]')).toBeNull();
    else expect(dialogText()).toContain("changed");
  });
  for (const changed of ["generation", "sessionRevision", "local", "external", "asOf"]) it(`rejects changed native ${changed} on final consent check`, async () => {
    const client = batchClient(); mount(client); await ask(targetQuestion); await review();
    const reply = snapshot();
    if (changed === "generation" || changed === "sessionRevision") reply.context[changed]++;
    else if (changed === "asOf") reply.asOf = "2026-09-07"; else reply.revision[changed as "local" | "external"]++;
    client.askVault.mockImplementationOnce(async () => reply); await click("Show the preview");
    expect(document.querySelector('.cut-preview-results')).toBeNull(); expect(dialogText()).toContain("changed");
  });
  it("suppresses duplicate confirmation while its freshness request is pending", async () => {
    const client = batchClient(); let release!: () => void;
    mount(client); await ask(targetQuestion); await review();
    client.askVault.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(snapshot()); }));
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === "Show the preview")!;
    await act(async () => { button.click(); button.click(); });
    expect(client.askVault).toHaveBeenCalledTimes(2);
    await act(async () => release()); expect(dialogText()).toContain("Your savings target preview");
  });
  it("sanitizes a real read failure and retries from fresh choices rather than old consent", async () => {
    const client = batchClient(); client.askVaultBaselines.mockRejectedValueOnce(new TransactionError("internal_error", "SQL secret /private/question"));
    mount(client); await ask(targetQuestion); await review();
    expect(dialogText()).not.toContain("SQL secret"); expect(document.querySelector('.cut-preview-results')).toBeNull();
    await click("Try again"); expect(dialogText()).toContain("Where would you like to cut back?");
    await preview(); expect(dialogText()).toContain("Your savings target preview");
  });
  it("never writes or sends the question/choices to storage, URL, title or a remote request", async () => {
    const stored = [vi.spyOn(Storage.prototype, "setItem"), vi.spyOn(history, "pushState"), vi.spyOn(history, "replaceState")];
    const before = { url: location.href, title: document.title };
    try {
      const client = batchClient(); mount(client); await ask(targetQuestion); await preview();
      expect(stored.every(spy => spy.mock.calls.length === 0)).toBe(true);
      expect(location.href).toBe(before.url); expect(document.title).toBe(before.title);
      expect(JSON.stringify(client.askVault.mock.calls)).not.toContain("Save $40");
      expect(JSON.stringify(client.askVaultBaselines.mock.calls)).not.toContain("maximum cut");
      expect([...document.querySelectorAll('button')].some(b => /apply|save (?:plan|budget)/i.test(b.textContent ?? ""))).toBe(false);
    } finally { stored.forEach(spy => spy.mockRestore()); }
  });
  it("allows an explicitly removed exclusion after the user reselects and reviews the category", async () => {
    const client = batchClient(); mount(client);
    await ask(targetQuestion.replace("from October", "except Rent from October"));
    expect(document.querySelector<HTMLInputElement>('[aria-label="Select Rent"]')?.disabled).toBe(true);
    await click("Allow selecting Rent");
    await act(async () => document.querySelector<HTMLInputElement>('[aria-label="Select Rent"]')!.click());
    await click("Allow up to 100% with floor $0 for Rent"); await review();
    expect(dialogText()).toContain("Check every detail");
    expect(client.askVaultBaselines.mock.calls[0][0].categories).toEqual(["Dining", "Rent"]);
  });
  function controller(client = batchClient()) {
    let api!: ReturnType<typeof useCutPreview>;
    function Probe() { api = useCutPreview({ getContext: () => context, dataKey: "stable", reloadKey: "stable", createClient: () => client }); return null; }
    act(() => root.render(<Probe />));
    const intent: CutPreviewIntent = { version: 1, target: { kind: "monthly", amount: "40" }, allocationPolicy: "capacity-proportional",
      categories: [{ category: "Dining", monthlyFloor: "0", maximumReduction: { kind: "percent", amount: "100" } }], horizon: { kind: "prospective", from: "2026-10-01", to: "2026-11-30" }, partialMonth: "exclude" };
    return { client, api: () => api, intent,
      start: async () => { await act(async () => { api.ask(targetQuestion); }); await act(async () => { await api.choose(intent); }); },
      payload: (): ConfirmedCutPreview => { const screen = api.screen; if (screen?.stage !== "review") throw new Error("Expected a real review"); return structuredClone({ ...screen.scenario, confirmed: true as const }); },
    };
  }
  it("keeps one controller timer/client through repeated previews and releases them on unmount", async () => {
    vi.useFakeTimers();
    const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
    try {
      const t = controller();
      expect(vi.getTimerCount()).toBe(1);
      const focus = add.mock.calls.filter(([type]) => type === "focus");
      expect(focus).toHaveLength(1);
      for (let i = 0; i < 60; i++) {
        await t.start(); await act(async () => { await t.api().confirm(t.payload()); });
        expect(t.api().screen?.stage).toBe("result");
        await act(async () => t.api().cancel());
        expect(t.api().screen).toBeNull(); expect(vi.getTimerCount()).toBe(1);
      }
      expect(add.mock.calls.filter(([type]) => type === "focus")).toHaveLength(1);
      expect(remove.mock.calls.filter(([type]) => type === "focus")).toHaveLength(0);
      await act(async () => root.render(null));
      expect(vi.getTimerCount()).toBe(0); expect(t.client.dispose).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith("focus", focus[0][1]);
    } finally { add.mockRestore(); remove.mockRestore(); vi.useRealTimers(); }
  });
  // M6 D-S6: "A few details need attention" is a defensive stage. The review screen refuses a floor above the usual month, so no click path reaches it
  // (CutPreviewDialog.tsx:165-168 against cutPreviewMath.ts:62-68). These tests call the controller with a confirmation the review screen would never send,
  // to prove the fallback: an invalid calculation never becomes a displayed result, and the person can go back and change the details.
  it("a confirmation with a floor above the usual month becomes the blocked screen: no result, details named, recovery offered", async () => {
    const t = controller(batchClient({ Dining: 2 }));
    t.intent.categories[0].monthlyFloor = "500";
    await t.start();
    const confirmed = t.payload();
    confirmed.baselines = [{ category: "Dining", baseline: { kind: "manual", monthlyAmount: "100", source: structuredClone(confirmed.source) } }];
    await act(async () => { await t.api().confirm(confirmed); });
    const screen = t.api().screen;
    expect(screen?.stage).toBe("blocked");
    expect(screen).toMatchObject({ calculation: { kind: "constraints-invalid", violations: [{ category: "Dining", monthlyFloor: "500", reason: "floor-above-baseline" }] } });
    expect(JSON.stringify(screen)).not.toMatch(/allocations|totalSaving|targetMet|shortfall/);
    await act(async () => t.api().edit());
    expect(t.api().screen?.stage).toBe("choices");
  });
  it("a confirmation that drops a selected category's usual month is stopped earlier, as an error with no result (the needs-a-usual-month blocker cannot be reached either)", async () => {
    const t = controller(batchClient({ Dining: 0 }));
    await t.start();
    const confirmed = t.payload();
    confirmed.baselines = [{ category: "Dining", baseline: { kind: "recorded", months: [], source: structuredClone(confirmed.source) } as never }];
    await act(async () => { await t.api().confirm(confirmed); });
    expect(t.api().screen).toMatchObject({ stage: "error", message: expect.stringMatching(/no longer match/) });
    expect(JSON.stringify(t.api().screen)).not.toMatch(/allocations|totalSaving|targetMet/);
  });
  it("routes a natural floor question without assuming its missing maximum cut or reading early", async () => {
    const client = batchClient(); mount(client);
    await ask("save $120 a month from groceries but keep at least $400 a month");
    expect(dialogText()).toContain("Where would you like to cut back?");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Groceries monthly floor"]')?.value).toBe("400");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Groceries maximum cut"]')?.value).toBe("");
    expect(client.askVault).not.toHaveBeenCalled(); expect(client.askVaultBaselines).not.toHaveBeenCalled();
    expect(document.querySelector('.cut-preview-results')).toBeNull();
  });
  for (const phase of ["source", "confirmation"]) for (const action of ["close", "edit", "new-question", "unmount"]) it(`releases the pending ${phase} controller wait after ${action}, before native settlement`, async () => {
    const client = batchClient(), t = controller(client);
    if (phase === "confirmation") await t.start();
    else await act(async () => { t.api().ask(targetQuestion); });
    let reject!: (e: unknown) => void;
    client.askVault.mockImplementationOnce(() => new Promise<AskVaultSnapshot>((_resolve, fail) => { reject = fail; }));
    let settled = false;
    await act(async () => { const work = phase === "source" ? t.api().choose(t.intent) : t.api().confirm(t.payload()); void work.then(() => { settled = true; }); });
    expect(settled).toBe(false);
    await act(async () => {
      if (action === "close") t.api().cancel();
      else if (action === "edit") t.api().edit();
      else if (action === "new-question") t.api().ask("Save $20 monthly");
      else root.render(null);
    });
    const releasedBeforeNative = settled;
    await act(async () => { reject(new Error("late native failure")); });
    expect(releasedBeforeNative).toBe(true);
    expect(t.api().screen?.stage).not.toBe("result");
  });
  for (const mutation of ["target", "floor", "dates", "policy", "source", "recorded-total", "manual-override", "duplicate", "missing", "extra-key", "unconfirmed"]) it(`does not treat a forged ${mutation} callback as reviewed consent`, async () => {
    const t = controller(); await t.start(); const confirmed = t.payload();
    switch (mutation) {
      case "target": confirmed.intent.target.amount = "900"; break;
      case "floor": confirmed.intent.categories[0].monthlyFloor = "100"; break;
      case "dates": confirmed.intent.horizon.to = "2026-12-31"; break;
      case "policy": Object.assign(confirmed.intent, { allocationPolicy: "fewest" }); break;
      case "source": confirmed.source.revision.external++; break;
      case "recorded-total": if (confirmed.baselines[0].baseline.kind === "recorded") confirmed.baselines[0].baseline.months[0].total = "900"; break;
      case "manual-override": confirmed.baselines[0].baseline = { kind: "manual", monthlyAmount: "999", source: confirmed.source }; break;
      case "duplicate": confirmed.baselines.push(structuredClone(confirmed.baselines[0])); break;
      case "missing": confirmed.baselines = []; break;
      case "extra-key": Object.assign(confirmed, { consentFromParser: true }); break;
      case "unconfirmed": Object.assign(confirmed, { confirmed: false }); break;
    }
    await act(async () => { await t.api().confirm(confirmed); });
    expect(t.api().screen?.stage).not.toBe("result");
  });
  it("rejects a saved consent callback after editing and loading an identical new review", async () => {
    const t = controller(); await t.start(); const oldConfirm = t.api().confirm, oldPayload = t.payload();
    await act(async () => t.api().edit()); await act(async () => { await t.api().choose(t.intent); });
    expect(t.api().screen?.stage).toBe("review");
    const before = t.client.askVault.mock.calls.length;
    await act(async () => { await oldConfirm(oldPayload); });
    expect(t.client.askVault).toHaveBeenCalledTimes(before); expect(t.api().screen?.stage).toBe("review");
    await act(async () => { await t.api().confirm(t.payload()); }); expect(t.api().screen?.stage).toBe("result");
  });
  it("does not authorize confirmation before review or after closing", async () => {
    const t = controller(); await t.start(); const payload = t.payload();
    await act(async () => t.api().cancel());
    await act(async () => { await t.api().confirm(payload); });
    expect(t.api().screen).toBeNull(); expect(t.client.askVault).toHaveBeenCalledTimes(1);
    await act(async () => { t.api().ask(targetQuestion); });
    await act(async () => { await t.api().confirm(payload); });
    expect(t.api().screen?.stage).toBe("choices"); expect(t.client.askVault).toHaveBeenCalledTimes(1);
  });
  it("documents monthly versus total targets, deliberate constraints, shortfalls and read-only scope", async () => {
    mount(batchClient()); await click("Tips & examples");
    expect(text()).toContain("monthly floor"); expect(text()).toContain("maximum cut"); expect(text()).toContain("shortfall");
    expect(MORE_EXAMPLES).toContain("Where can I cut back to save $200 a month?");
    expect(MORE_EXAMPLES).toContain("Save $200 in total this year");
  });
  it("drops a result on date rollover at focus without a React rerender", async () => {
    const ctx = structuredClone(context); mount(batchClient(), { ctx }); await ask(targetQuestion); await preview();
    ctx.today = "2026-09-07"; await act(async () => window.dispatchEvent(new Event("focus")));
    expect(document.querySelector('.cut-preview-results')).toBeNull(); expect(dialogText()).toContain("changed");
  });
  const supported = ["Save", "Help me save", "I want to save", "Where can I cut back to save", "How could we save", "Please save"];
  for (const lead of supported) for (const basis of ["monthly", "in total"]) for (const amount of ["0", "0.01", "40", "600", "700"]) {
    it(`couples ${lead} $${amount} ${basis} to the fixed native mean, capacity and exact result`, async () => {
      mount(batchClient());
      await ask(`${lead} $${amount} ${basis} across Dining and Groceries with Dining floor $0 and maximum cut 100% with Groceries floor $0 and maximum cut 100% from October through November 2026`);
      await preview();
      const targetCents = BigInt(amount.replace('.', '').padEnd(amount.includes('.') ? amount.length - 1 : amount.length + 2, '0'));
      const capacity = basis === "monthly" ? 60000n : 120000n;
      const allocated = targetCents < capacity ? targetCents : capacity;
      const result = dialogText();
      const dollars = (cents: bigint) => '$' + (cents / 100n).toLocaleString('en-US') + '.' + (cents % 100n).toString().padStart(2,'0');
      expect(result).toContain(`Goal: ${dollars(targetCents)} ${basis === "monthly" ? "per month" : "over these dates"}`);
      expect(result).toContain(`Achievable: ${dollars(allocated)}`);
      expect(result).toContain(`Maximum: ${dollars(capacity)}`);
      expect(result).toContain(`Shortfall: ${dollars(targetCents - allocated)}`);
      expect(result).toContain(`${dollars(allocated * (basis === "monthly" ? 2n : 1n))} across the selected dates`);
    });
  }
});
const snapshot = (over: Partial<AskVaultSnapshot> = {}): AskVaultSnapshot => ({
  contractVersion: 1, context: { generation: 1, sessionRevision: 1 }, revision: { local: 5, external: 2 }, asOf: "2026-09-06",
  kind: "total", spendingBasis: "gross-negative-allocations", thresholdBasis: "absolute-parent-amount", periods: [period()], difference: null, ...over,
});
const purchases = [
  { transactionId: 1, accountId: 1, date: "2026-08-24", description: "Costco", amount: "132.41", parentAmount: "132.41" },
  { transactionId: 2, accountId: 1, date: "2026-08-13", description: "Trader Joes", amount: "88.07", parentAmount: "88.07" },
  { transactionId: 3, accountId: 1, date: "2026-08-06", description: "Whole Foods Market", amount: "96.65", parentAmount: "96.65" },
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

type Handler = (request: AskVaultRequest | AskVaultRequestV2) => Promise<AskVaultSnapshot | AskVaultSnapshotV2>;
type Fake = { askVault: ReturnType<typeof vi.fn<Handler>>; dispose: ReturnType<typeof vi.fn<() => void>> };
function fake(handler: Handler): Fake {
  return { askVault: vi.fn<Handler>(handler), dispose: vi.fn<() => void>() };
}
const legacy = vi.fn((q: string) => (q.includes("net worth") ? { matched: true, answer: "Your net worth is $50,178.37." } : { matched: false, answer: "I couldn't match that." }));

function mount(client: Fake, over: { dataKey?: unknown; ctx?: ParseContext; onOpenTransactions?: (f: { category: string; accountIds: number[]; from: string; to: string }) => void } = {}) {
  const element = (key: unknown, reload: unknown = "r1") => (
    <AskVaultCard getContext={() => over.ctx ?? context} legacyAsk={legacy} dataKey={key} reloadKey={reload} accountNames={new Map([[1, "Everyday Checking"]])} onOpenTransactions={over.onOpenTransactions} createClient={() => client} />
  );
  act(() => root.render(element(over.dataKey ?? "v1")));
  return { rerender: (key: unknown, reload?: unknown) => act(() => root.render(element(key, reload))) };
}

async function ask(question: string) {
  const input = container.querySelector<HTMLInputElement>(".ledger-qa-card input")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, question);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector<HTMLFormElement>(".ledger-qa-card form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}
// The card shows "working" first and reads the question on the next turn of the event loop, so tests wait one turn.
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
const text = () => container.querySelector(".ledger-qa-card")!.textContent ?? "";
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);
  if (!button) throw new Error(`no button "${label}" in: ${document.body.textContent}`);
  await act(async () => button.click());
  await settle();
};

describe("the Ask the Vault card", () => {
  const membersContext = { ...context, familyMembers: [{ id: 1, name: "Sam" }, { id: 2, name: "Robin" }] };
  const memberReply = (): AskVaultSnapshotV2 => ({
    ...snapshot(), contractVersion: 2, earliestRecord: "2026-01-01", comparison: null,
    periods: [{ ...period(), categoryTotals: [], sharedPurchaseCount: 0, months: [], recordedFrom: null, recordedThrough: null, average: null,
      memberTotals: [{memberId:1,name:"Sam",total:"317.13",purchaseCount:3},{memberId:2,name:"Robin",total:"0",purchaseCount:0},{memberId:null,name:null,total:"0",purchaseCount:0}] }],
  });
  for (const memberId of [7,8]) it(`sends only selected lookalike member ${memberId} after clicking a clarification`, async () => {
    const ctx={...context,familyMembers:[{id:7,name:"O’Neil"},{id:8,name:"O'Neil"}]};
    const reply=memberReply();reply.periods[0].memberTotals=[];
    const client=fake(async()=>reply);
    mount(client,{ctx});
    await ask("how much did O’Neil spend on groceries last month");
    expect(client.askVault).not.toHaveBeenCalled();
    const name=ctx.familyMembers.find(m=>m.id===memberId)!.name;
    const button=[...container.querySelectorAll<HTMLButtonElement>('.ledger-qa-choices button')].find(b=>b.textContent?.includes(name));
    expect(button).toBeDefined();
    await act(async()=>button!.click());await settle();
    expect(client.askVault).toHaveBeenCalledTimes(1);
    expect(client.askVault.mock.calls[0][0]).toMatchObject({members:{ids:[memberId],unassigned:false},categories:["Groceries"],periods:[{from:"2026-08-01",to:"2026-08-31"}]});
    expect(text()).toContain("$317.13");
  });
  it("retires a member clarification when its roster or ledger changes before selection", async () => {
    const ctx={...context,familyMembers:[{id:7,name:"O’Neil"},{id:8,name:"O'Neil"}]};
    const client=fake(async()=>memberReply());
    const screen=mount(client,{ctx});
    await ask("how much did O’Neil spend last month");
    expect(container.querySelector('.ledger-qa-choices button')).not.toBeNull();
    screen.rerender("changed-roster");
    await settle();
    expect(container.querySelector('.ledger-qa-choices button')).toBeNull();
    expect(client.askVault).not.toHaveBeenCalled();
    expect(text()).toContain("Your details changed");
  });
  it("renders member and unassigned rows as an accessible labeled table and restates grouping", async () => {
    mount(fake(async () => memberReply()), {ctx:membersContext});
    await ask("what did each family member spend last month");
    const table = container.querySelector('table[aria-label="Spending by family member"]');
    expect(table).not.toBeNull();
    expect(table?.textContent).toContain("Robin");
    expect(table?.textContent).toContain("Not assigned to anyone");
    expect(table?.textContent).toContain("$0.00");
    expect(container.querySelector('[aria-label="What I understood"]')?.textContent).toContain("By family member");
  });
  it("keeps member filters on purchase details and hides inexact Transactions navigation", async () => {
    const navigate=vi.fn();
    const client=fake(async request => request.kind === "rank-purchases" ? snapshot({kind:"rank-purchases",periods:[period({purchases})]}) : memberReply());
    mount(client,{ctx:membersContext,onOpenTransactions:navigate});
    await ask("how much did Sam spend on groceries last month");
    expect(text()).toContain("for Sam");
    await click("View 3 purchases");
    expect(client.askVault.mock.calls[1][0]).toMatchObject({members:{ids:[1],unassigned:false},groupBy:"none",average:"none"});
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Open in Transactions");
  });
  it("shows monthly uncertainty visibly, not only inside What's counted", async () => {
    const reply=memberReply();
    reply.periods[0].memberTotals=[];
    reply.periods[0].months=[{month:"2026-08",from:"2026-08-01",to:"2026-08-31",dayCount:31,coverage:"no-records",recordCount:0,total:"0",purchaseCount:0}];
    mount(fake(async()=>reply),{ctx:membersContext});
    await ask("spending by month last month");
    expect(container.querySelector('.ledger-qa-caution')?.textContent).toContain("missing import");
    expect(container.querySelector('table[aria-label="Spending by month"]')?.textContent).toContain("spending unknown");
  });
  it("retires an in-flight member answer when the roster changes even if the ledger revision stays the same", async () => {
    let finish!: (reply: AskVaultSnapshotV2) => void;
    let first=true;
    const client=fake(() => {
      if (!first) return Promise.resolve(memberReply());
      first=false;
      return new Promise<AskVaultSnapshotV2>(resolve => { finish=resolve; });
    });
    const view=mount(client,{ctx:membersContext});
    await ask("how much did Sam spend last month");
    view.rerender("roster-renamed");
    await act(async()=>finish(memberReply()));
    await settle();
    expect(text()).toContain("no longer shown");
    expect(text()).not.toContain("$317.13");
  });
  it("shows an extra-money-into-an-investment-account example under Tips & examples", () => {
    expect(MORE_EXAMPLES).toContain("Extra $50 a month into Roth IRA until January 2056");
  });
  it("every example shown under Tips & examples is understood, never refused", () => {
    const ctx: ParseContext = { ...membersContext, categories: [...context.categories, "Dining Out"], merchants: [...(context.merchants ?? []), "WHOLE FOODS MARKET", "COSTCO #1"], historyStart: "2025-01-01" };
    // The same order as the card's own claims: savings target, extra money, spending cut, then the ordinary reader (AskVaultCard.tsx runQuestion).
    // The routed, request-level proof for every advertised sentence is AskVaultCardRouting.test.tsx; this loop only shows that none is refused.
    for (const example of [...LEDGER_QA_EXAMPLES, ...MORE_EXAMPLES]) {
      const target = parseCutPreview(example, ctx);
      if (target) {
        expect(target.kind, example).toBe("cut-preview");
        if (target.kind === "cut-preview") expect(target.draft.missing.length, example).toBeGreaterThan(0);
        continue;
      }
      const retirement = parseRetirementScenario(example, { today: ctx.today, investmentAccounts: [{ id: 1, name: "Roth IRA" }] });
      if (retirement) {
        expect(retirement.kind, example).toBe("retirement");
        if (retirement.kind === "retirement") expect(retirement.draft.missing, example).toEqual([]); // every term the example gives is understood
        continue;
      }
      const spend = parseSpendingScenario(example, ctx);
      if (spend) {
        expect(spend.kind, example).toBe("scenario");
        continue;
      }
      const outcome = parseQuestion(example, ctx);
      expect(["query", "legacy", "clarify"], example).toContain(outcome.status);
      if (outcome.status === "clarify") expect(outcome.choices.length, example).toBeGreaterThan(0);
    }
  });

  it("keeps its title, tips button and Ask button", () => {
    mount(fake(async () => snapshot()));
    expect(text()).toContain("Ask the Vault");
    expect(container.querySelector("button[type='submit']")?.textContent).toBe("Ask");
    expect(container.querySelector(".ledger-qa-card .card-head")).not.toBeNull();
  });

  it("shows that it is working before it starts reading the question (so a big ledger cannot delay the first sign of life)", async () => {
    let sawWorking: boolean | null = null;
    const client = fake(async () => snapshot());
    mount(client, { ctx: undefined });
    // A context built at ask time stands in for the work done before parsing.
    root.render(<AskVaultCard getContext={() => { sawWorking = document.body.textContent?.includes("Looking that up") ?? false; return context; }} legacyAsk={legacy} dataKey="v1" accountNames={new Map()} createClient={() => client} />);
    await ask("how much did I spend on groceries last month");
    expect(sawWorking).toBe(true);
  });

  it("reads once from the native side and shows the answer in plain words", async () => {
    const client = fake(async () => snapshot());
    mount(client);
    await ask("how much did I spend on groceries last month");
    expect(client.askVault).toHaveBeenCalledTimes(1);
    expect(client.askVault.mock.calls[0][0]).toMatchObject({ kind: "total", categories: ["Groceries"], periods: [{ from: "2026-08-01", to: "2026-08-31" }] });
    expect(container.querySelector(".ledger-qa-answer")!.textContent).toContain("You spent $317.13 on Groceries in August 2026.");
    expect(text()).toContain("3 purchases");
    expect(text()).not.toContain("-$");
  });

  it("says what it understood and shows a correction it made", async () => {
    mount(fake(async () => snapshot()));
    await ask("how much i spnt on grocries last month");
    expect(text()).toContain("I read");
    expect(text()).toContain("spnt");
    expect(text()).toContain("Groceries");
    expect(container.querySelector("[aria-label='What I understood']")?.textContent).toContain("August 2026");
  });

  it("older questions go to the older matcher and never touch the native read", async () => {
    const client = fake(async () => snapshot());
    mount(client);
    await ask("what's my net worth");
    expect(client.askVault).not.toHaveBeenCalled();
    expect(container.querySelector(".ledger-qa-answer")!.textContent).toBe("Your net worth is $50,178.37.");
  });

  it("an unsupported question explains itself, keeps the quiet styling and offers examples", async () => {
    const client = fake(async () => snapshot());
    mount(client);
    await ask("who let the dogs out");
    expect(client.askVault).not.toHaveBeenCalled();
    const box = container.querySelector(".ledger-qa-answer")!;
    expect(box.className).toContain("ledger-qa-answer-unmatched");
    expect(box.textContent).toContain("I don't understand");
    expect(box.textContent).toContain("Try something like");
  });

  it("a clarification shows choices; picking one asks the new question", async () => {
    const client = fake(async () => snapshot());
    mount(client);
    await ask("total spending on din last month");
    expect(client.askVault).not.toHaveBeenCalled();
    expect(text()).toContain("Which one did you mean?");
    expect(text()).toContain("Nothing has been added up yet");
    await click("Dining Out");
    expect(client.askVault).toHaveBeenCalledTimes(1);
    expect(client.askVault.mock.calls[0][0]).toMatchObject({ categories: ["Dining Out"] });
    expect(container.querySelector<HTMLInputElement>(".ledger-qa-card input")!.value).toBe('total spending on "dining out" last month');
    expect(text()).toContain("You spent $317.13 on Dining Out");
  });

  it("a store answer lists the names it matched and each store's total", async () => {
    const client = fake(async () =>
      snapshot({
        periods: [period({
          total: "412.90", purchaseCount: 6, vendorNameCount: 2,
          vendors: [{ description: "SAMS CLUB #6482", purchaseCount: 5 }, { description: "SAMSCLUB.COM", purchaseCount: 1 }],
          vendorTotals: [{ term: "sams club", total: "412.90", purchaseCount: 6 }],
          from: "2025-09-01", to: "2026-09-06", dayCount: 371, endsToday: true,
        })],
      }),
    );
    mount(client);
    await ask("how much did I spend at sams club");
    expect(text()).toContain("since your records begin");
    expect(text()).toContain("SAMS CLUB #6482 (5 purchases)");
  });

  it("View purchases opens the exact purchases behind the total", async () => {
    const client = fake(async (request) =>
      request.kind === "rank-purchases" ? snapshot({ kind: "rank-purchases", periods: [period({ purchases })] }) : snapshot(),
    );
    mount(client);
    await ask("how much did I spend on groceries last month");
    await click("View 3 purchases");
    const detailCall = client.askVault.mock.calls[1][0] as AskVaultRequest;
    expect(detailCall).toMatchObject({ kind: "rank-purchases", categories: ["Groceries"], limit: 50, expectedRevision: { local: 5, external: 2 } });
    const dialog = document.querySelector("[role='dialog']")!;
    expect(dialog.textContent).toContain("Costco");
    expect(dialog.textContent).toContain("$132.41");
    expect(dialog.textContent).toContain("Everyday Checking");
    await click("Close");
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("a category answer's purchases can be opened in Transactions with the same category, account and dates", async () => {
    const client = fake(async (request) =>
      request.kind === "rank-purchases" ? snapshot({ kind: "rank-purchases", periods: [period({ purchases })] }) : snapshot(),
    );
    const open = vi.fn();
    mount(client, { onOpenTransactions: open });
    await ask("how much did I spend on groceries last month in everyday checking");
    await click("View 3 purchases");
    await click("Open in Transactions");
    expect(open).toHaveBeenCalledWith({ category: "Groceries", accountIds: [1], from: "2026-08-01", to: "2026-08-31" });
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("offers no Open in Transactions when the Transactions tab could not show exactly the same purchases", async () => {
    const client = fake(async (request) =>
      request.kind === "rank-purchases" ? snapshot({ kind: "rank-purchases", periods: [period({ purchases })] }) : snapshot(),
    );
    const open = vi.fn();
    mount(client, { onOpenTransactions: open });
    await ask("how much did I spend at costco last month");
    await click("View 3 purchases");
    expect(document.querySelector("[role='dialog']")!.textContent).not.toContain("Open in Transactions");
    await click("Close");
    await ask("groceries last month without costco");
    await click("View 3 purchases");
    expect(document.querySelector("[role='dialog']")!.textContent).not.toContain("Open in Transactions");
  });

  it("the details dialog says plainly when the ledger changed in between", async () => {
    const client = fake(async (request) => {
      if (request.kind === "rank-purchases") throw new TransactionError("stale_data", "Your transactions changed. Ask again using the current data.");
      return snapshot();
    });
    mount(client);
    await ask("how much did I spend on groceries last month");
    await click("View 3 purchases");
    expect(document.querySelector("[role='dialog']")!.textContent).toContain("Your details changed");
    expect(document.querySelector("[role='dialog']")!.textContent).toContain("This answer or preview is no longer shown. Ask again using your current details.");
  });

  it("an answer is retired when the ledger changes underneath it, and can be asked again", async () => {
    const client = fake(async () => snapshot());
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    expect(text()).toContain("$317.13");
    view.rerender("v2");
    await act(async () => {});
    expect(text()).not.toContain("$317.13");
    expect(text()).toContain("Your details changed");
    await click("Ask again");
    expect(client.askVault).toHaveBeenCalledTimes(2);
    expect(text()).toContain("$317.13");
  });

  it("an open 'Show all' list does not keep showing amounts while the answer is being re-checked", async () => {
    const names = ["Groceries", "Dining Out", "Rent", "Shopping", "Gifts", "Health", "Travel"];
    const categories = names.map((category, i) => ({ category, amount: String(1000 - i * 10), purchaseCount: 1 }));
    let release: (s: AskVaultSnapshot) => void = () => {};
    let holdChecks = false;
    const full = () => snapshot({ kind: "rank-categories", periods: [period({ categories, categoryCount: 7 })] });
    const client = fake(() => (holdChecks ? new Promise<AskVaultSnapshot>((r) => (release = r)) : Promise.resolve(full())));
    const view = mount(client);
    await ask("top 7 spending categories last month");
    await click("Show all 7");
    expect(document.querySelector("[role='dialog']")!.textContent).toContain("$1,000.00");
    holdChecks = true;
    view.rerender("v1", "r2"); // reloaded: the answer is being checked
    await act(async () => {});
    expect(document.body.textContent).not.toContain("$1,000.00");
    expect(document.querySelector("[role='dialog']")).toBeNull();
    await act(async () => release(full()));
    await act(async () => {});
    expect(text()).toContain("$1,000.00"); // confirmed current: the answer is back on the card
  });

  it("a long ranking shows five rows inline and the rest in a dialog", async () => {
    const names = ["Groceries", "Dining Out", "Rent", "Shopping", "Gifts", "Health", "Travel", "Pets", "Fuel", "Coffee"];
    const categories = names.map((category, i) => ({ category, amount: String(1000 - i * 10), purchaseCount: i + 1 }));
    const client = fake(async () => snapshot({ kind: "rank-categories", periods: [period({ categories, categoryCount: 12, total: "9550", purchaseCount: 55 })] }));
    mount(client);
    await ask("top 10 spending categories last month");
    expect(container.querySelectorAll(".ledger-qa-rows li")).toHaveLength(5);
    expect(text()).not.toContain("Coffee");
    await click("Show all 10");
    const dialog = document.querySelector("[role='dialog']")!;
    expect(dialog.querySelectorAll("li")).toHaveLength(10);
    expect(dialog.textContent).toContain("Coffee");
    await click("Close");
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("five or fewer rows have no extra button", async () => {
    const categories = ["Groceries", "Rent"].map((category, i) => ({ category, amount: String(100 - i), purchaseCount: 1 }));
    mount(fake(async () => snapshot({ kind: "rank-categories", periods: [period({ categories, categoryCount: 2 })] })));
    await ask("top 5 spending categories last month");
    expect(text()).not.toContain("Show all");
  });

  it("no more than three choices are shown at once; the rest sit behind 'More choices'", async () => {
    const many: ParseContext = { ...context, categories: ["Dining", "Dining Out", "Dinner Club", "Diner Tabs", "Dinero"] };
    mount(fake(async () => snapshot()), { ctx: many });
    await ask("total spending on din last month");
    const inline = container.querySelectorAll("[role='group'] > button");
    expect(inline.length).toBeLessThanOrEqual(3);
    expect(inline.length).toBeGreaterThan(0);
    expect(text()).toContain("More choices");
    const more = container.querySelectorAll("[role='group'] details button");
    expect(inline.length + more.length).toBeGreaterThan(3);
  });

  it("a reload with the ledger unchanged keeps the answer; a changed split (same fingerprint) retires it", async () => {
    let revision = { local: 5, external: 2 };
    const client = fake(async () => snapshot({ revision }));
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    expect(text()).toContain("$317.13");
    view.rerender("v1", "r2"); // the list was reloaded, nothing was written
    await act(async () => {});
    expect(text()).toContain("$317.13");
    revision = { local: 6, external: 2 }; // split amounts changed: same count, same fingerprint
    view.rerender("v1", "r3");
    await act(async () => {});
    expect(text()).not.toContain("$317.13");
    expect(text()).toContain("Your details changed");
  });

  it("an answer read before the ledger changed is not left standing as current", async () => {
    let release: (s: AskVaultSnapshot) => void = () => {};
    let calls = 0;
    const client = fake(() => {
      calls++;
      if (calls === 1) return new Promise<AskVaultSnapshot>((r) => (release = r)); // the question itself, still being read
      return Promise.resolve(snapshot({ revision: { local: 6, external: 2 } })); // the freshness check, after the change
    });
    const view = mount(client);
    await ask("how much did I spend on groceries last month"); // returns while the read is still pending
    view.rerender("v2", "r2"); // the ledger changes while the answer is on its way
    await act(async () => {});
    await act(async () => release(snapshot({ revision: { local: 5, external: 2 } })));
    await act(async () => {});
    expect(text()).not.toContain("$317.13");
    expect(text()).toContain("Your details changed");
  });

  it("a purchases list still loading does not open after its answer was retired", async () => {
    let releaseDetails: (s: AskVaultSnapshot) => void = () => {};
    let revision = { local: 5, external: 2 };
    const client = fake((request) => {
      if (request.kind === "rank-purchases") return new Promise<AskVaultSnapshot>((r) => (releaseDetails = r));
      return Promise.resolve(snapshot({ revision }));
    });
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    await click("View 3 purchases"); // the list is being read
    revision = { local: 6, external: 2 };
    view.rerender("v1", "r2"); // the answer is retired
    await act(async () => {});
    expect(text()).toContain("Your details changed");
    await act(async () => releaseDetails(snapshot({ kind: "rank-purchases", periods: [period({ purchases })] })));
    await act(async () => {});
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("a 'Show all' list does not come back for the next answer", async () => {
    const names = ["Groceries", "Dining Out", "Rent", "Shopping", "Gifts", "Health", "Travel"];
    const categories = names.map((category, i) => ({ category, amount: String(1000 - i * 10), purchaseCount: 1 }));
    const client = fake(async () => snapshot({ kind: "rank-categories", periods: [period({ categories, categoryCount: 7 })] }));
    const view = mount(client);
    await ask("top 7 spending categories last month");
    await click("Show all 7");
    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    view.rerender("v2"); // answer retired: the dialog goes with it
    await act(async () => {});
    expect(document.querySelector("[role='dialog']")).toBeNull();
    await click("Ask again");
    expect(text()).toContain("Show all 7");
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  it("while an answer is being checked after a reload, its amount is not shown", async () => {
    let release: (s: AskVaultSnapshot) => void = () => {};
    let holdChecks = false;
    const client = fake(() => (holdChecks ? new Promise<AskVaultSnapshot>((r) => (release = r)) : Promise.resolve(snapshot())));
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    expect(text()).toContain("$317.13");
    holdChecks = true;
    view.rerender("v1", "r2");
    await act(async () => {});
    expect(text()).not.toContain("$317.13");
    expect(text()).toContain("Checking that this is still up to date");
    await act(async () => release(snapshot())); // unchanged: the same answer comes back
    await act(async () => {});
    expect(text()).toContain("$317.13");
    expect(text()).not.toContain("Checking that this");
  });

  it("an answer that turns out to be out of date is never shown, not even briefly", async () => {
    let release: (s: AskVaultSnapshot) => void = () => {};
    let holdChecks = false;
    const client = fake(() => (holdChecks ? new Promise<AskVaultSnapshot>((r) => (release = r)) : Promise.resolve(snapshot())));
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    holdChecks = true;
    const seen: string[] = [];
    view.rerender("v1", "r2");
    seen.push(text());
    await act(async () => release(snapshot({ revision: { local: 9, external: 2 } })));
    seen.push(text());
    await act(async () => {});
    seen.push(text());
    expect(seen.some((s) => s.includes("$317.13"))).toBe(false);
    expect(text()).toContain("Your details changed");
  });

  it("if the freshness check itself fails, the answer is retired rather than trusted", async () => {
    let fail = false;
    const client = fake(async () => {
      if (fail) throw new TransactionError("internal_error", "boom");
      return snapshot();
    });
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    fail = true;
    view.rerender("v1", "r2");
    await act(async () => {});
    expect(text()).not.toContain("$317.13");
  });

  it("a freshness check that finishes after a newer question was asked is ignored", async () => {
    let release: (s: AskVaultSnapshot) => void = () => {};
    let held = false;
    const client = fake(() => (held ? new Promise<AskVaultSnapshot>((r) => (release = r)) : Promise.resolve(snapshot())));
    const view = mount(client);
    await ask("how much did I spend on groceries last month");
    held = true;
    view.rerender("v1", "r2"); // check starts and waits
    held = false;
    await ask("how much did I spend on groceries last month"); // a newer question answers
    release(snapshot({ revision: { local: 99, external: 2 } })); // the old check finishes late with a different revision
    await act(async () => {});
    expect(text()).toContain("$317.13");
    expect(text()).not.toContain("Your details changed");
  });

  it("a failed read is reported in plain words with a way to retry", async () => {
    let fail = true;
    const client = fake(async () => {
      if (fail) throw new TransactionError("internal_error", "sqlite: disk I/O error at /secret/path");
      return snapshot();
    });
    mount(client);
    await ask("how much did I spend on groceries last month");
    expect(text()).toContain("I couldn't answer that right now");
    expect(text()).not.toContain("secret");
    fail = false;
    await click("Try again");
    expect(text()).toContain("$317.13");
  });

  it("a profile that closes mid-question shows nothing and releases the client", async () => {
    let finish!: (value: AskVaultSnapshot) => void;
    const client = fake(() => new Promise<AskVaultSnapshot>((resolve) => { finish = resolve; }));
    mount(client);
    await ask("how much did I spend on groceries last month");
    expect(text()).toContain("Looking that up");
    act(() => root.unmount());
    expect(client.dispose).toHaveBeenCalled();
    await act(async () => finish(snapshot()));
    root = createRoot(container);
  });

  it("only the latest question can answer", async () => {
    const pending: Array<(value: AskVaultSnapshot) => void> = [];
    const client = fake(() => new Promise<AskVaultSnapshot>((resolve) => pending.push(resolve)));
    mount(client);
    await ask("how much did I spend on groceries last month");
    await ask("how much did I spend on rent last month");
    await act(async () => pending[1](snapshot({ periods: [period({ total: "1504" })] })));
    await act(async () => pending[0](snapshot({ periods: [period({ total: "1" })] })));
    expect(text()).toContain("$1,504.00");
    expect(text()).not.toContain("$1.00");
  });

  it("announces results to screen readers and labels the choices", async () => {
    mount(fake(async () => snapshot()));
    expect(container.querySelector("[aria-live='polite']")).not.toBeNull();
    await ask("total spending on din last month");
    expect(container.querySelector("[role='group'][aria-label]")).not.toBeNull();
  });
});

describe("spending scenarios in the Ask the Vault card", () => {
  const baselineReply = (): AskVaultSnapshotV2 => ({
    ...snapshot(), contractVersion: 2, earliestRecord: "2025-01-01", comparison: null,
    periods: [{ ...period({ from: "2026-06-01", to: "2026-08-31", dayCount: 92, total: "900" }),
      categoryTotals: [], sharedPurchaseCount: 0, memberTotals: [], recordedFrom: "2025-01-01", recordedThrough: "2026-09-06", average: null,
      months: ["06", "07", "08"].map(month => ({ month: `2026-${month}`, from: `2026-${month}-01`, to: `2026-${month}-${month === "06" ? "30" : "31"}`, dayCount: month === "06" ? 30 : 31, coverage: "complete" as const, recordCount: 1, total: "300", purchaseCount: 1 })) }],
  });
  const question = "Cut Dining by $50 monthly from October to November 2026";

  it("reviews the native baseline and rechecks its revision before displaying savings", async () => {
    const client = fake(async () => baselineReply());
    mount(client);
    await ask(question);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Check these details");
    expect(client.askVault.mock.calls[0][0]).toMatchObject({ contractVersion: 2, categories: ["Dining"], groupBy: "month", average: "per-month", accountIds: [], expectedRevision: null });
    expect(document.body.textContent).not.toContain("What you would save");
    await click("Show what I would save");
    expect(client.askVault.mock.calls[1][0]).toMatchObject({ expectedRevision: { local: 5, external: 2 } });
    // Freshness is global to the profile: do not recalculate the expensive three-month baseline.
    expect(client.askVault.mock.calls[1][0]).toMatchObject({ periods: [{ from: context.today, to: context.today }] });
    expect(client.askVault.mock.calls[1][0]).not.toHaveProperty("contractVersion");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("What you would save");
    expect(document.querySelector('.scenario-total')?.textContent).toBe("$100.00");
  });

  it("removes a scenario result immediately when the ledger changes", async () => {
    const client = fake(async () => baselineReply());
    const screen = mount(client);
    await ask(question);
    await click("Show what I would save");
    screen.rerender("changed");
    expect(document.querySelector('.scenario-total')).toBeNull();
    expect(document.body.textContent).toContain("no longer shown");
  });

  // M6 UC-10 / LC-04: the same lifecycle mechanisms the savings-target matrix proves above, for the spending what-if (reload, roster and date changes, late replies, a changed source at consent).
  for (const change of ["reload", "roster", "day"]) it(`retires a displayed scenario result immediately after ${change}`, async () => {
    const ctx = structuredClone(context), client = fake(async () => baselineReply()), view = mount(client, { ctx });
    await ask(question); await click("Show what I would save");
    expect(document.querySelector(".scenario-total")).not.toBeNull();
    if (change === "roster") ctx.categories = ctx.categories.filter(c => c !== "Dining");
    if (change === "day") ctx.today = "2026-09-07";
    view.rerender("v1", change === "reload" ? "r2" : "r1");
    expect(document.querySelector(".scenario-total")).toBeNull(); expect(document.body.textContent).toContain("no longer shown");
  });
  for (const phase of ["source", "confirmation"]) for (const action of ["close", "reload", "unmount"]) it(`drops a late scenario ${phase} reply after ${action}`, async () => {
    let release!: () => void;
    const hold = () => new Promise<AskVaultSnapshotV2>(resolve => { release = () => resolve(baselineReply()); });
    const client = fake(async () => baselineReply());
    if (phase === "source") client.askVault.mockImplementationOnce(hold); else client.askVault.mockImplementationOnce(async () => baselineReply()).mockImplementationOnce(hold);
    const view = mount(client); await ask(question);
    if (phase === "confirmation") await click("Show what I would save");
    expect(release).toBeTypeOf("function");
    if (action === "close") await click([...document.querySelectorAll("button")].some(b => b.textContent === "Cancel") ? "Cancel" : "Close");
    if (action === "reload") view.rerender("v1", "r2");
    if (action === "unmount") { act(() => root.unmount()); expect(client.dispose).toHaveBeenCalled(); root = createRoot(container); }
    await act(async () => release()); await settle();
    expect(document.querySelector(".scenario-total")).toBeNull();
    if (action === "reload") expect(document.body.textContent).toContain("no longer shown"); else expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("refuses a confirmation whose native date moved", async () => {
    const client = fake(async () => baselineReply()); mount(client); await ask(question);
    client.askVault.mockImplementationOnce(async () => ({ ...baselineReply(), asOf: "2026-09-07" })); await click("Show what I would save");
    expect(document.querySelector(".scenario-total")).toBeNull(); expect(document.body.textContent).toContain("no longer shown");
  });
  it("cancels a pending scenario when a different question is submitted", async () => {
    let finish!: (reply: AskVaultSnapshotV2) => void;
    const client = fake(request => "contractVersion" in request && request.contractVersion === 2 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(snapshot()));
    mount(client);
    await ask(question);
    await ask("how much did I spend on groceries last month");
    await act(async () => finish(baselineReply()));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(text()).toContain("$317.13");
  });

  it.each([
    { context: { generation: 2, sessionRevision: 1 } },
    { context: { generation: 1, sessionRevision: 2 } },
    { revision: { local: 6, external: 2 } },
  ])("refuses a confirmation whose native source changed: %j", async changed => {
    const client = fake(async () => baselineReply());
    mount(client);
    await ask(question);
    client.askVault.mockImplementationOnce(async () => ({ ...baselineReply(), ...changed }));
    await click("Show what I would save");
    expect(document.querySelector('.scenario-total')).toBeNull();
    expect(document.body.textContent).toContain("no longer shown");
  });

  it("requires selection and re-parses a misspelled scenario category before reading", async () => {
    const client = fake(async () => baselineReply());
    mount(client);
    await ask(question.replace("Dining", "dinning"));
    expect(client.askVault).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click("Dining");
    expect(client.askVault.mock.calls[0][0]).toMatchObject({ categories: ["Dining"] });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Check these details");
  });

  it("cannot display a scenario read that finishes after the profile unmounts", async () => {
    let finish!: (reply: AskVaultSnapshotV2) => void;
    const client = fake(() => new Promise(resolve => { finish = resolve; }));
    mount(client);
    await ask(question);
    act(() => root.unmount());
    expect(client.dispose).toHaveBeenCalled();
    await act(async () => finish(baselineReply()));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    root = createRoot(container);
  });

  it("requires an explicit short-history choice before confirmation", async () => {
    const reply = baselineReply();
    reply.periods[0].months[1] = { ...reply.periods[0].months[1], coverage: "no-records", total: "0", recordCount: 0, purchaseCount: 0 };
    const client = fake(async () => reply);
    mount(client);
    await ask(question);
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Show what I would save")!;
    expect(confirm.disabled).toBe(true);
    expect(client.askVault).toHaveBeenCalledTimes(1);
    const choice = [...document.querySelectorAll('label')].find(label => label.textContent?.includes("Use the 2 months I have"))!.querySelector<HTMLInputElement>('input')!;
    await act(async () => choice.click());
    await click("Show what I would save");
    expect(document.querySelector('.scenario-total')?.textContent).toBe("$100.00");
  });

  it("retires a scenario result on local date rollover even when the data key is unchanged", async () => {
    const ctx = { ...context };
    const screen = mount(fake(async () => baselineReply()), { ctx });
    await ask(question);
    await click("Show what I would save");
    ctx.today = "2026-09-07";
    screen.rerender("v1");
    expect(document.querySelector('.scenario-total')).toBeNull();
    expect(document.body.textContent).toContain("no longer shown");
  });

  it("keeps keyboard focus in the scenario during an asynchronous confirmation", async () => {
    let finish!: (reply: AskVaultSnapshot) => void;
    const client = fake(request => "contractVersion" in request ? Promise.resolve(baselineReply()) : new Promise(resolve => { finish = resolve; }));
    mount(client);
    await ask(question);
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Show what I would save")!;
    confirm.focus();
    await click("Show what I would save");
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
    await act(async () => finish(snapshot()));
    expect(document.querySelector('.scenario-total')?.textContent).toBe("$100.00");
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
  });

  it("uses the reviewed baseline rather than the current-day source-check amount", async () => {
    const client = fake(request => Promise.resolve("contractVersion" in request ? baselineReply() : snapshot({ periods: [period({ from: context.today, to: context.today, total: "0", purchaseCount: 0 })] })));
    mount(client);
    await ask(question.replace("$50", "10%"));
    await click("Show what I would save");
    expect(document.querySelector('.scenario-total')?.textContent).toBe("$60.00");
  });

  it("returns focus to the question when changing scenario terms", async () => {
    const client = fake(async () => baselineReply());
    mount(client);
    container.querySelector<HTMLButtonElement>('button[type="submit"]')!.focus();
    await ask(question);
    await act(async () => (document.querySelector('[aria-label="Change category"]') as HTMLButtonElement).click());
    await settle();
    const input = container.querySelector<HTMLInputElement>('.ledger-qa-card input')!;
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe(question);
    expect(client.askVault).toHaveBeenCalledTimes(1);
  });
});
