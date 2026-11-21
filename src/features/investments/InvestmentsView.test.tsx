// @vitest-environment jsdom
//
// VS-31 step 2 (I): Investments gets v9's "What your investments are in" bar above page tabs (Holdings, Mix and
// targets, Growth calculator, Money put in). Every section of the old long page lands in one of the tabs.
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvestmentsView } from "./InvestmentsView";
import { startPrivacyMask } from "../../shared/lib/privacy";
import type { Account, Holding } from "../../shared/lib/types";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
// The money-put-in summary has its own tests; here it only needs to be found and to open an account.
vi.mock("./AccumulationSection", () => ({
  AccumulationSummaryCard: ({ onOpenAccount }: { onOpenAccount: (id: number) => void }) => (
    <div data-acc-summary-stub>
      <button type="button" onClick={() => onOpenAccount(1)}>Open Retirement Account</button>
    </div>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => Promise.resolve(cmd === "get_inflation_pct" ? "3" : []));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const holding = (id: number, symbol: string, value: string, assetClass: string | null, extra: Partial<Holding> = {}): Holding => ({
  id, account_id: 1, account_name: "Retirement Account", symbol, name: `${symbol} fund`, shares: "1", price: value, cost_basis: "100.00",
  asset_class: assetClass, value, gain_loss: "0.00", prev_close: null, day_gain_loss: null, ...extra,
});
const investmentAccount = { id: 1, name: "Retirement Account", account_type: "investment", starting_balance: "0", current_balance: "0", institution: null, mask: null, interest_rate: null, excluded_from_debt_payoff: false, member_id: null, member_name: null, checkpoint_date: null, icon_key: null, import_flip_signs: null, hidden: false } as Account;
const mixed = [holding(1, "BRDM", "14427.00", "US stocks"), holding(2, "INTL", "6535.00", "International stocks"), holding(3, "BOND", "4277.00", "Bonds"), holding(4, "CASH", "640.00", "Cash")];

type Props = ComponentProps<typeof InvestmentsView>;
function show(holdings: Holding[] = mixed, extra: Partial<Props> = {}) {
  const p: Props = {
    holdings, accounts: [investmentAccount], onCreate: vi.fn(), onImportSaved: vi.fn(), onUpdatePrice: vi.fn(), onDelete: vi.fn(),
    livePricesEnabled: false, onFetchQuote: vi.fn(), layoutWidgets: [], onPinWidget: vi.fn(), portfolioHistory: [], allocationTargets: [],
    onSetAllocationTargets: vi.fn(), onSaveProjectionAsGoal: vi.fn(), onOpenAccountDetail: vi.fn(), ...extra,
  };
  act(() => root.render(<InvestmentsView {...p} />));
  return p;
}
const openTab = (id: string) => act(() => (host.querySelector(`#investments-tab-${id}`) as HTMLButtonElement).click());
const panel = (id: string) => host.querySelector(`#investments-panel-${id}`) as HTMLElement;
const mix = () => host.querySelector("[data-investments-mix]") as HTMLElement;
const texts = (sel: string, within: ParentNode = host) => [...within.querySelectorAll(sel)].map((e) => e.textContent);
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });

describe("tabs", () => {
  it("has the four tabs in v9 order, no Retirement plan, and opens on Holdings", () => {
    show();
    const tabs = [...host.querySelectorAll('[role="tablist"] [role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["Holdings", "Mix and targets", "Growth calculator", "Money put in"]);
    expect(tabs.map((t) => t.id)).toEqual(["investments-tab-holdings", "investments-tab-mix", "investments-tab-growth", "investments-tab-money-in"]);
    expect(host.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Investment sections");
    expect(host.querySelector("#investments-tab-holdings")?.getAttribute("aria-selected")).toBe("true");
    expect(host.textContent).not.toContain("Retirement plan");
  });

  it("can open on another tab, for links that land on one section", () => {
    show(mixed, { initialTab: "money-in" });
    expect(host.querySelector("#investments-tab-money-in")?.getAttribute("aria-selected")).toBe("true");
  });

  it("moves between tabs with the arrow keys, Home and End, wrapping at the ends", () => {
    show();
    const key = (k: string) => act(() => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
    act(() => (host.querySelector("#investments-tab-holdings") as HTMLElement).focus());
    key("ArrowLeft");
    expect(document.activeElement?.id).toBe("investments-tab-money-in");
    key("ArrowRight");
    expect(document.activeElement?.id).toBe("investments-tab-holdings");
    key("End");
    expect(document.activeElement?.id).toBe("investments-tab-money-in");
    key("Home");
    expect(document.activeElement?.id).toBe("investments-tab-holdings");
    key("ArrowRight");
    expect(document.activeElement?.id).toBe("investments-tab-mix");
    expect(panel("mix").hidden).toBe(false);
  });

  it("puts the value tiles, value over time, the holdings tables, price editing, delete, Import and Add in Holdings", () => {
    const p = show();
    const h = panel("holdings");
    for (const label of ["Portfolio value", "What you paid", "Total gain/loss", "Today's gain/loss", "Portfolio value over time", "Retirement Account", "BRDM", "Import holdings", "Add holding"]) {
      expect(h.textContent, label).toContain(label);
    }
    click(h.querySelector(".amount-editable"));
    const input = h.querySelector(".amount-edit-input") as HTMLInputElement;
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(p.onUpdatePrice).toHaveBeenCalledWith(1, "14427.00");
    click([...h.querySelectorAll("button")].find((b) => b.textContent === "Delete") ?? null);
    click(h.querySelector(".btn-danger"));
    expect(p.onDelete).toHaveBeenCalledWith(1);
  });

  it("puts Allocation (with Pin to Dashboard) and Target allocation in Mix and targets", () => {
    show();
    openTab("mix");
    const m = panel("mix");
    expect(m.textContent).toContain("Allocation");
    expect(m.textContent).toContain("Pin to Dashboard");
    expect(m.querySelector("[data-target-allocation]")).not.toBeNull();
    expect(panel("holdings").textContent).not.toContain("Target allocation");
  });

  it("puts the goal projection, with Save as goal, in Growth calculator", () => {
    const p = show();
    openTab("growth");
    const g = panel("growth");
    expect(g.textContent).toContain("Goal projection");
    click(g.querySelector("[data-projection-save-as-goal]"));
    act(() => { (g.querySelector(".projection-goal-form") as HTMLFormElement).requestSubmit(); });
    expect(p.onSaveProjectionAsGoal).toHaveBeenCalledTimes(1);
  });

  it("puts the money-put-in summary in Money put in", () => {
    show();
    expect(host.querySelector("[data-acc-summary-stub]")).toBeNull();
    openTab("money-in");
    expect(panel("money-in").querySelector("[data-acc-summary-stub]")).not.toBeNull();
  });

  it("comes back to Money put in after an account's Details page opened from it, once", () => {
    const p = show();
    openTab("money-in");
    click(panel("money-in").querySelector("button"));
    expect(p.onOpenAccountDetail).toHaveBeenCalledWith(1);
    // Details' "← Investments" shows this page again from scratch.
    act(() => root.unmount());
    root = createRoot(host);
    show();
    expect(host.querySelector("#investments-tab-money-in")?.getAttribute("aria-selected")).toBe("true");
    // Only that once: the next visit opens on Holdings as usual.
    act(() => root.unmount());
    root = createRoot(host);
    show();
    expect(host.querySelector("#investments-tab-holdings")?.getAttribute("aria-selected")).toBe("true");
  });

  // VS-63: the hint used to send people to the Reports tab, which can't add accounts.
  it("points to the Accounts page to add an investment account before adding holdings", () => {
    show([], { accounts: [] });
    expect(panel("holdings").textContent).toContain("Add an investment account on the Accounts page first, then add holdings here.");
    expect(panel("holdings").textContent).not.toContain("Reports tab");
  });

  it("says so in words when there is no investment account, rather than an empty Money put in tab", () => {
    show([], { accounts: [] });
    openTab("money-in");
    expect(panel("money-in").textContent).toBe("No investment accounts yet. Add one on Accounts to see what you've put in and where it could grow.");
  });
});

describe("What your investments are in", () => {
  it("shows one bar by kind above the tabs, in the Allocation card's order and colors, with the total invested", () => {
    show();
    const m = mix();
    expect(m.closest('[role="tabpanel"]')).toBeNull();
    expect(m.compareDocumentPosition(host.querySelector('[role="tablist"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(m.textContent).toContain("What your investments are in");
    expect(m.textContent).toContain("Every holding, grouped by kind");
    // Owner, UAT of step 3: nothing is written inside the bar; the key below names every kind.
    expect([...m.querySelectorAll(".segment-bar-seg")].map((s) => s.textContent)).toEqual(["", "", "", ""]);
    expect(texts(".segment-bar-total", m)).toEqual(["$25,879.00"]);
    // Allocation's donut uses the same colors in the same order.
    openTab("mix");
    const donutColors = [...panel("mix").querySelectorAll(".chart-legend-swatch")].map((s) => (s as HTMLElement).style.background);
    const barColors = [...m.querySelectorAll(".segment-bar-seg")].map((s) => (s as HTMLElement).style.background);
    expect(barColors).toEqual(donutColors);
  });

  it("lists every kind with its share under the bar, so a narrow one is still readable", () => {
    show();
    expect(texts("[data-investments-mix-key] li", mix())).toEqual(["US stocks 56%", "International stocks 25%", "Bonds 17%", "Cash 2%"]);
  });

  it("shows a single kind as one full bar", () => {
    show([holding(1, "VTI", "500.00", "Stocks"), holding(2, "VXUS", "250.00", "Stocks")]);
    expect(mix().querySelectorAll(".segment-bar-seg")).toHaveLength(1);
    expect(texts("[data-investments-mix-key] li", mix())).toEqual(["Stocks 100%"]);
    expect(texts(".segment-bar-total", mix())).toEqual(["$750.00"]);
  });

  it("counts a holding with no kind as Other, and a holding with no price as nothing, without breaking the shares", () => {
    show([holding(1, "VTI", "300.00", "Stocks"), holding(2, "OLD", "0.00", null)]);
    expect(texts("[data-investments-mix-key] li", mix())).toEqual(["Stocks 100%", "Other 0%"]);
    expect(texts(".segment-bar-total", mix())).toEqual(["$300.00"]);
    expect(mix().textContent).not.toContain("NaN");
  });

  it("says \"under 1%\" for a kind too small to round to 1%, rather than a misleading 0%", () => {
    show([holding(1, "VTI", "999.00", "Stocks"), holding(2, "MYST", "1.00", null)]);
    expect(texts("[data-investments-mix-key] li", mix())).toEqual(["Stocks 100%", "Other under 1%"]);
  });

  it("says so in words when nothing has a price yet", () => {
    show([holding(1, "OLD", "0.00", "Stocks")]);
    expect(mix().textContent).toContain("Your holdings don't have prices yet, so there's nothing to add up.");
    expect(mix().querySelectorAll(".segment-bar-seg")).toHaveLength(0);
  });

  it("says so in words with no holdings", () => {
    show([]);
    expect(mix().textContent).toContain("No holdings yet. Add one under Holdings to see what your investments are in.");
    expect(mix().querySelectorAll(".segment-bar-seg")).toHaveLength(0);
  });

  it("keeps amounts out of every attribute, and hides every amount when amounts are hidden", () => {
    show();
    for (const el of [mix(), ...mix().querySelectorAll("*")]) {
      for (const attr of el.attributes) expect(attr.value, `${el.tagName} ${attr.name}`).not.toMatch(/\$\s?\d/);
    }
    const stop = startPrivacyMask(mix());
    expect(mix().textContent).not.toMatch(/\$\s?\d/);
    stop();
  });
});

describe("Add holding says what is missing (VS-49)", () => {
  const form = () => host.querySelector<HTMLElement>(".labeled-field-form")!;
  const note = () => form().querySelector("[data-holding-missing]")?.textContent ?? null;
  const save = () => [...form().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save")!;
  const symbolBox = () => form().querySelector<HTMLInputElement>('input[placeholder="e.g. AAPL"]')!;
  const type = (input: HTMLInputElement, text: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("asks for a symbol, then lets Save through", () => {
    show();
    click([...host.querySelectorAll("button")].find((b) => b.textContent === "Add holding")!);
    expect(save().disabled).toBe(true);
    expect(note()).toBe("Enter a symbol, like AAPL.");
    type(symbolBox(), "AAPL");
    expect(note()).toBeNull();
    expect(save().disabled).toBe(false);
  });
});
