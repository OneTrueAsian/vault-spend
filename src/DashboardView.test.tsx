// @vitest-environment jsdom
//
// Dashboard order (UI review s6): the page's actions sit in the title row, "Ask the Vault" stays big
// and directly under the title (owner decision: it is NOT shrunk or moved), Customize is chosen from
// the Layout menu, and the Runway ring says what it is measuring against.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";

const invokeMock = vi.hoisted(() =>
  vi.fn(async (cmd: string) => {
    if (cmd === "get_current_generation") return 1;
    return null;
  }),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
const askContextMock = vi.hoisted(() => vi.fn());
vi.mock("./AskVaultCard", async importOriginal => {
  const actual = await importOriginal<typeof import("./AskVaultCard")>();
  return { ...actual, AskVaultCard: (p: ComponentProps<typeof actual.AskVaultCard>) => {
    askContextMock(p.getContext());
    return <actual.AskVaultCard {...p} />;
  } };
});

import { DashboardView } from "./DashboardView";
import * as vendor from "./askVault/vendor";
import { DEFAULT_LAYOUT, type WidgetId } from "./dashboardLayout";
import type { Account } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function account(over: Partial<Account>): Account {
  return {
    id: 1,
    name: "Everyday checking",
    account_type: "checking",
    starting_balance: "4000.00",
    current_balance: "4000.00",
    institution: null,
    mask: null,
    interest_rate: null,
    excluded_from_debt_payoff: false,
    member_id: null,
    member_name: null,
    checkpoint_date: null,
    icon_key: null,
    import_flip_signs: null, hidden: false,
    ...over,
  };
}

type Props = ComponentProps<typeof DashboardView>;

function props(over: Partial<Props> = {}): Props {
  return {
    accounts: [account({})],
    netWorthHistory: [],
    accountContributionDeltas: [],
    spendingThisMonth: [],
    report: null,
    recurring: [],
    recurringMatches: [],
    monthReviewOffer: { year: 2026, month: 8, label: "August 2026" },
    onOpenMonthReview: vi.fn(),
    transactions: [],
    budgetAlerts: [],
    insights: [],
    avgMonthlySpend: "2000.00",
    assetsTotal: 0,
    assets: [],
    holdings: [],
    familyMembers: [],
    buckets: [],
    categories: [],
    categoryIconMap: {},
    topCategoriesData: null,
    layoutWidgets: [...DEFAULT_LAYOUT],
    onSetLayoutWidgets: vi.fn(),
    onOpenAddWidget: vi.fn(),
    onOpenTransactions: vi.fn(),
    onOpenRecurring: vi.fn(),
    onOpenBudget: vi.fn(),
    onOpenCashFlow: vi.fn(),
    onOpenInvestments: vi.fn(),
    onOpenReports: vi.fn(),
    onOpenAccounts: vi.fn(),
    onOpenBuckets: vi.fn(),
    onOpenUncategorized: vi.fn(),
    safeToSpendForecast: null,
    safeToSpendEnabled: false,
    onAddTransaction: vi.fn(),
    onAddAccount: vi.fn(),
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function render(p: Props) {
  await act(async () => {
    root.render(<DashboardView {...p} />);
  });
}

const layoutTrigger = () => container.querySelector<HTMLButtonElement>(".layout-select-toggle")!;

it("editing current property value changes the net-worth headline without rewriting historical trend amounts", async () => {
  const history = [
    { month_label: "Sep 2026", as_of: "2026-09-30", value: "1000.00", cash: "1000.00", debt: "0.00", investments: "0.00" },
    { month_label: "Oct 2026", as_of: "2026-10-27", value: "1100.00", cash: "1100.00", debt: "0.00", investments: "0.00" },
  ];
  const base = props({ netWorthHistory: history, assetsTotal: 100, layoutWidgets: ["stat_net_worth", "trend_spending"] });
  await render(base);
  const axes = () => [...container.querySelectorAll('[data-widget-id="trend_spending"] .axis-label')].map(e => e.textContent);
  const before = axes();
  expect(before.length).toBeGreaterThan(0);
  expect(container.querySelector('[data-widget-id="stat_net_worth"] .stat-value')?.textContent).toBe("$1,200.00");
  await render({ ...base, assetsTotal: 250 });
  expect(container.querySelector('[data-widget-id="stat_net_worth"] .stat-value')?.textContent).toBe("$1,350.00");
  expect(axes()).toEqual(before);
  expect(container.textContent).toContain("does not include property and valuables");
});

it("Task7: waits for the current roster preparation and ignores a cancelled earlier roster", async()=>{
  const pending:{signal:AbortSignal;resolve:(ready:boolean)=>void}[]=[];
  vi.spyOn(vendor,"prepareVendors").mockImplementation((_names,signal)=>new Promise(resolve=>pending.push({signal,resolve})));
  const first=props();await render(first);expect(pending).toHaveLength(1);
  const input=container.querySelector<HTMLInputElement>('.ledger-qa-card input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"Costco last month");input.dispatchEvent(new Event("input",{bubbles:true}));});
  const ask=()=>container.querySelector<HTMLButtonElement>('.ledger-qa-card button[type="submit"]')!;
  expect(ask().disabled).toBe(true);
  await render({...first,transactions:[...first.transactions]});expect(pending).toHaveLength(2);expect(pending[0].signal.aborted).toBe(true);
  await act(async()=>{pending[0].resolve(true);await Promise.resolve();});expect(ask().disabled).toBe(true);expect(input.value).toBe("Costco last month");
  await act(async()=>{pending[1].resolve(true);await Promise.resolve();});expect(ask().disabled).toBe(false);expect(input.value).toBe("Costco last month");
  vi.restoreAllMocks();
});
const menuLabels = () => [...container.querySelectorAll("[role='menuitemradio']")].map((b) => b.textContent?.replace("✓", "").trim());
function chooseLayoutOption(label: string) {
  act(() => layoutTrigger().click());
  const item = [...container.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")].find(
    (b) => b.textContent?.replace("✓", "").trim() === label,
  );
  if (!item) throw new Error(`no Layout option "${label}" (have: ${menuLabels().join(", ")})`);
  act(() => item.click());
}
const widgetOrder = () => [...container.querySelectorAll<HTMLElement>("[data-widget-id]")].map((el) => el.dataset.widgetId);

describe("Dashboard header", () => {
  it("supplies member IDs and names to the M2 parser while keeping legacy member names", async () => {
    const familyMembers = [{ id: 7, name: "Sam" }, { id: 8, name: "Robin" }];
    await render(props({ familyMembers }));
    expect(askContextMock.mock.lastCall?.[0]).toMatchObject({ familyMembers, members: ["Sam", "Robin"] });
  });
  describe("Ask context investment accounts (M5 A1)", () => {
    const mixed = [
      account({ id: 1, name: "Everyday checking", account_type: "checking" }), account({ id: 2, name: "Roth IRA", account_type: "investment", institution: "Fidelity", mask: "1234", current_balance: "9999.00" }),
      account({ id: 3, name: "Card", account_type: "credit" }), account({ id: 4, name: "Brokerage", account_type: "investment" }), account({ id: 5, name: "Rental", account_type: "other" }),
    ];
    it("lists only investment-type accounts, with ids and names and nothing else", async () => {
      await render(props({ accounts: mixed }));
      const context = askContextMock.mock.lastCall?.[0] as { investmentAccounts?: unknown; accounts: unknown };
      expect(context.investmentAccounts).toStrictEqual([{ id: 2, name: "Roth IRA" }, { id: 4, name: "Brokerage" }]);
      expect(context.accounts).toHaveLength(5);
    });
    it("is an empty list, not missing, when there are no investment accounts", async () => {
      await render(props({ accounts: [account({})] }));
      expect((askContextMock.mock.lastCall?.[0] as { investmentAccounts?: unknown }).investmentAccounts).toStrictEqual([]);
    });
  });
  it("keeps Ask the Vault as the full card directly under the title row (owner rule)", async () => {
    await render(props());

    const pageTop = container.querySelector(".page-top")!;
    const next = pageTop.nextElementSibling as HTMLElement;
    expect(next.classList.contains("ledger-qa-card")).toBe(true);
    expect(next.classList.contains("card")).toBe(true);
    expect(next.textContent).toContain("Ask the Vault");
    expect(next.querySelector("form input")).not.toBeNull();
    expect(next.querySelector("button[type='submit']")?.textContent).toBe("Ask");
    // Not shrunk into the title row.
    expect(pageTop.querySelector(".ledger-qa-card")).toBeNull();
  });

  it("puts the page's actions in the title row, in the same order", async () => {
    const p = props();
    await render(p);

    expect(container.querySelector(".quick-actions")).toBeNull();
    const actions = container.querySelector(".page-top > .page-actions")!;
    expect([...actions.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual([
      "+ Add transaction",
      "+ Add account",
      "Set budget",
      "Update goals",
    ]);
    act(() => actions.querySelector<HTMLButtonElement>("button")!.click());
    expect(p.onAddTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("Layout menu", () => {
  it('reads "Layout: Default" and lists the presets, then Customize', async () => {
    await render(props());

    expect(layoutTrigger().textContent).toBe("Layout: Default▾");
    act(() => layoutTrigger().click());
    expect(menuLabels()).toEqual(["Default", "Bills Focus", "Investor Focus", "Customize"]);
  });

  it("shows a Done button beside + Add widget only while customizing, and it ends customizing", async () => {
    const p = props();
    await render(p);
    const toolbarButtons = () => [...container.querySelectorAll(".dashboard-toolbar > button")].map((b) => b.textContent?.trim());
    expect(toolbarButtons()).not.toContain("Done");

    chooseLayoutOption("Customize");
    expect(toolbarButtons().slice(-2)).toEqual(["+ Add widget", "Done"]);

    act(() => container.querySelector<HTMLButtonElement>(".dashboard-toolbar > button[data-customize-done]")!.click());
    expect(container.querySelectorAll(".dashboard-widget-controls")).toHaveLength(0);
    expect(toolbarButtons()).not.toContain("Done");
    expect(p.onSetLayoutWidgets).not.toHaveBeenCalled();
    // The menu offers Customize again.
    act(() => layoutTrigger().click());
    expect(menuLabels().at(-1)).toBe("Customize");
  });

  it("has no separate Customize button", async () => {
    await render(props());

    const buttons = [...container.querySelectorAll(".dashboard-toolbar > button")].map((b) => b.textContent?.trim());
    expect(buttons).not.toContain("Customize");
    expect(buttons).not.toContain("Done");
  });

  it("Customize turns on customizing without changing the layout, and Done customizing turns it off", async () => {
    const p = props();
    await render(p);

    chooseLayoutOption("Customize");
    expect(container.querySelectorAll(".dashboard-widget-controls").length).toBeGreaterThan(0);
    expect(container.querySelector(".dashboard-toolbar")?.textContent).toContain("+ Add widget");
    expect(p.onSetLayoutWidgets).not.toHaveBeenCalled();
    // The menu still shows which layout is in use.
    expect(layoutTrigger().textContent).toBe("Layout: Default▾");

    chooseLayoutOption("Done customizing");
    expect(container.querySelectorAll(".dashboard-widget-controls")).toHaveLength(0);
    expect(p.onSetLayoutWidgets).not.toHaveBeenCalled();
  });

  it("choosing a preset still switches the layout", async () => {
    const p = props();
    await render(p);

    chooseLayoutOption("Bills Focus");

    expect(p.onSetLayoutWidgets).toHaveBeenCalledTimes(1);
    expect((p.onSetLayoutWidgets as ReturnType<typeof vi.fn>).mock.calls[0][0][4]).toBe("safe_to_spend");
  });

  it("keeps Custom (unsaved) and + Save as for an edited layout", async () => {
    const edited: WidgetId[] = DEFAULT_LAYOUT.filter((id) => id !== "runway");
    await render(props({ layoutWidgets: edited }));

    expect(layoutTrigger().textContent).toBe("Layout: Custom (unsaved)▾");
    expect(container.querySelector(".dashboard-toolbar")?.textContent).toContain("+ Save as");
    act(() => layoutTrigger().click());
    expect(menuLabels()).toEqual(["Default", "Bills Focus", "Investor Focus", "Custom (unsaved)", "Customize"]);
  });
});

describe("Dashboard order and tiles", () => {
  it("shows the money tiles, then To do, then Runway, in the default layout", async () => {
    await render(props());

    const order = widgetOrder();
    expect(order.slice(0, 4)).toEqual(["stat_net_worth", "stat_cash", "stat_debt", "stat_investments"]);
    expect(order.indexOf("needs_a_look")).toBeLessThan(order.indexOf("runway"));
    const todo = container.querySelector('[data-widget-id="needs_a_look"]')!;
    const runway = container.querySelector('[data-widget-id="runway"]')!;
    expect(todo.textContent).toContain("To do");
    expect(todo.compareDocumentPosition(runway) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lays the stat tiles out in the Dashboard's full-width row", async () => {
    await render(props());

    const row = container.querySelector(".stats.dashboard-stat-row")!;
    expect(row.querySelectorAll(".stat-hero")).toHaveLength(4);
  });
});

describe("Runway ring", () => {
  it("says what the ring measures against, in words and for screen readers", async () => {
    await render(props());

    const card = container.querySelector(".runway-card")!;
    expect(card.querySelector(".runway-goal")?.textContent).toBe("Goal: 6 months");
    const ring = card.querySelector("svg")!;
    expect(ring.getAttribute("role")).toBe("img");
    expect(ring.getAttribute("aria-label")).toBe("2.0 months of a 6-month goal");
  });
});

// s4: red only for what needs you. Owing money is not by itself a problem, so the Debt amount
// and its tile stay neutral; only its change line is coloured. The budget banner names categories.
describe("Dashboard budget card colours", () => {
  const line = (category: string, budget_group: string, budgeted: string, actual: string) => ({
    category, budget_group, budgeted, actual, cap_enabled: false, rollover: "0", rollover_enabled: false,
  });
  const fill = (group: string) => container.querySelector<HTMLElement>(`[data-dashboard-budget-group="${group}"] .progress-fill`)!;

  afterEach(() => vi.useRealTimers());

  it("uses the Budget page's rule: income still arriving early in the month is neutral, not red", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 6));
    const report = {
      total_saved: "0",
      income_total: "4100.00",
      month_label: "October 2026",
      budget_actuals: [line("Income", "income", "8200.00", "4100.00"), line("Mortgage", "fixed", "300.00", "400.00"), line("Dining", "flexible", "300.00", "48.40")],
    };
    await render(props({ report }));
    expect(fill("income").className).toBe("progress-fill neutral");
    expect(fill("income").style.background).toBe("");
    expect(fill("fixed").className).toBe("progress-fill over");
    expect(fill("flexible").className).toBe("progress-fill");
  });
});

describe("Dashboard colours", () => {
  const point = (debt: string, i: number) => ({
    month_label: `M${i}`,
    value: "0",
    cash: "4000.00",
    debt,
    investments: "0",
    as_of: `2026-0${i + 1}-28`,
  });
  const loan = account({ id: 2, name: "Car loan", account_type: "loan", starting_balance: "8000.00", current_balance: "8000.00" });
  const debtTile = () => container.querySelector<HTMLElement>('[data-stat="debt"]')!;

  it("keeps a growing debt's amount and tile neutral, and colours only its change line", async () => {
    await render(props({ accounts: [account({}), loan], netWorthHistory: [point("-5000.00", 0), point("-8000.00", 1)] }));
    const tile = debtTile();
    expect(tile.classList.contains("tint-neutral")).toBe(true);
    expect(tile.classList.contains("tint-red")).toBe(false);
    expect(tile.querySelector(".stat-value")!.className).toBe("stat-value");
    expect(tile.querySelector(".stat-delta")!.className).toBe("stat-delta down");
    expect(tile.querySelector(".stat-delta")!.textContent).toContain("▲");
    // Growing debt is the one case that keeps the warning icon.
    expect(tile.querySelector<HTMLElement>(".mini-ico")!.dataset.debtIcon).toBe("warning");
  });

  it("keeps a shrinking debt's amount neutral too, with a green change line and the plain icon", async () => {
    await render(props({ accounts: [account({}), loan], netWorthHistory: [point("-9000.00", 0), point("-8000.00", 1)] }));
    const tile = debtTile();
    expect(tile.querySelector(".stat-value")!.className).toBe("stat-value");
    expect(tile.querySelector(".stat-delta")!.className).toBe("stat-delta up");
    expect(tile.querySelector<HTMLElement>(".mini-ico")!.dataset.debtIcon).toBe("debt");
  });

  it("doesn't show the warning icon for debt with no history to compare", async () => {
    await render(props({ accounts: [account({}), loan] }));
    expect(debtTile().querySelector<HTMLElement>(".mini-ico")!.dataset.debtIcon).toBe("debt");
  });

  it("keeps a pinned debt account's tile and badge neutral", async () => {
    await render(props({ accounts: [account({}), loan], layoutWidgets: [...DEFAULT_LAYOUT, "account:2" as WidgetId] }));
    const widget = container.querySelector<HTMLElement>('[data-widget-id="account:2"] .stat')!;
    expect(widget.classList.contains("tint-neutral")).toBe(true);
    expect(widget.querySelector(".mini-ico")!.className).toBe("mini-ico neutral");
  });

  it("names the categories in the budget banner and still opens the details", async () => {
    await render(
      props({
        budgetAlerts: [
          { category: "Dining", budget_group: "flexible", budgeted: "100.00", actual: "150.00", pct: "150", level: "over", cap_enabled: false },
          { category: "Groceries", budget_group: "flexible", budgeted: "400.00", actual: "350.00", pct: "88", level: "warning", cap_enabled: false },
        ],
      }),
    );
    const banner = container.querySelector<HTMLButtonElement>(".budget-alert-banner")!;
    expect(banner.textContent).toBe("Dining is over its budget; Groceries is close to its budget");
    act(() => banner.click());
    expect(container.querySelector(".stat-detail-panel")?.textContent).toContain("Dining");
  });

  it("keeps the banner quiet when every alert is a budget used exactly in full", async () => {
    await render(
      props({
        budgetAlerts: [
          { category: "Mortgage", budget_group: "fixed", budgeted: "2140.00", actual: "2140.00", pct: "100", level: "warning", cap_enabled: false },
        ],
      }),
    );
    const banner = container.querySelector<HTMLButtonElement>(".budget-alert-banner")!;
    expect(banner.textContent).toBe("Mortgage has used its whole budget");
    expect(banner.className).toBe("budget-alert-banner budget-alert-banner-done");
    expect(banner.querySelector(".budget-alert-icon")).toBeNull();
  });

  it("keeps the warning look when any alert is over or close", async () => {
    await render(
      props({
        budgetAlerts: [
          { category: "Mortgage", budget_group: "fixed", budgeted: "2140.00", actual: "2140.00", pct: "100", level: "warning", cap_enabled: false },
          { category: "Groceries", budget_group: "flexible", budgeted: "800.00", actual: "700.00", pct: "88", level: "warning", cap_enabled: false },
        ],
      }),
    );
    const banner = container.querySelector<HTMLButtonElement>(".budget-alert-banner")!;
    expect(banner.className).toBe("budget-alert-banner");
    expect(banner.querySelector(".budget-alert-icon")).not.toBeNull();
  });
});

// QA-FUNC-003 / QA-GAP-001 (owner-approved 27 Oct 2026): two short Dashboard messages.
describe("Runway with under two weeks of history", () => {
  it("keeps the card and says why there is no figure yet", async () => {
    await render(props({ avgMonthlySpend: "0", enoughHistory: false }));
    const card = container.querySelector(".runway-card[data-runway-waiting]")!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("Not enough history yet. Cash runway shows once you have 2 weeks of transactions.");
    expect(card.querySelector("svg")).toBeNull();
    expect(card.querySelector(".runway-headline")).toBeNull();
  });

  it("shows the figure as before once there is enough history", async () => {
    await render(props({ enoughHistory: true }));
    expect(container.querySelector(".runway-card[data-runway-waiting]")).toBeNull();
    expect(container.querySelector(".runway-headline")?.textContent).toContain("months of expenses covered");
  });

  it("shows no runway card, as before, when there is history but no spending at all", async () => {
    await render(props({ avgMonthlySpend: "0", enoughHistory: true }));
    expect(container.querySelector(".runway-card")).toBeNull();
  });

  it("defaults to enough history, so callers that do not know are unchanged", async () => {
    await render(props());
    expect(container.querySelector(".runway-card[data-runway-waiting]")).toBeNull();
  });
});

describe("Hidden accounts note under the money tiles", () => {
  const hiddenAccount = (id: number, name: string) => account({ id, name, hidden: true });
  const note = () => container.querySelector(".hidden-accounts-note");

  it("says how many hidden accounts the totals include", async () => {
    await render(props({ accounts: [account({}), hiddenAccount(2, "Old Savings")] }));
    expect(note()?.textContent).toBe("Includes 1 hidden account.");
    await render(props({ accounts: [account({}), hiddenAccount(2, "Old Savings"), hiddenAccount(3, "Old Card")] }));
    expect(note()?.textContent).toBe("Includes 2 hidden accounts.");
  });

  it("says nothing when no account is hidden", async () => {
    await render(props({ accounts: [account({})] }));
    expect(note()).toBeNull();
  });

  it("sits with the stat tiles and the totals still count the hidden account", async () => {
    await render(props({ accounts: [account({ current_balance: "100.00" }), account({ id: 2, name: "Old Savings", current_balance: "12.00", hidden: true })] }));
    expect(container.querySelector(".stats.dashboard-stat-row")!.parentElement!.contains(note())).toBe(true);
    expect(container.querySelector('[data-widget-id="stat_cash"]')!.textContent).toContain("$112.00");
  });
});

describe('Pinned Net worth by member table', () => {
  it('lets a long unbroken member name wrap inside the card', async () => {
    const name = 'QA' + 'Unbroken'.repeat(10);
    await render(props({ layoutWidgets: ['net_worth_by_member'], familyMembers: [{ id: 1, name }], accounts: [account({ id: 1, member_id: 1, member_name: name })] }));
    const cell = [...container.querySelectorAll<HTMLElement>('td')].find((td) => td.textContent === name)!;
    expect(cell).toBeTruthy();
    // The wrapping rule lives in SharedCards.css (.member-name-cell), shared with the Reports member table; breakdownListStyles.test.ts reads the rule.
    expect(cell.className).toBe('member-name-cell');
  });
});
