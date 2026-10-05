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

import { DashboardView } from "./DashboardView";
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
    import_flip_signs: null,
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
    onOpenLedger: vi.fn(),
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
});

async function render(p: Props) {
  await act(async () => {
    root.render(<DashboardView {...p} />);
  });
}

const layoutTrigger = () => container.querySelector<HTMLButtonElement>(".layout-select-toggle")!;
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
  it('reads "Layout: Default" and lists the presets, then Customize…', async () => {
    await render(props());

    expect(layoutTrigger().textContent).toBe("Layout: Default▾");
    act(() => layoutTrigger().click());
    expect(menuLabels()).toEqual(["Default", "Bills Focus", "Investor Focus", "Customize…"]);
  });

  it("shows a Done button beside + Add widget… only while customizing, and it ends customizing", async () => {
    const p = props();
    await render(p);
    const toolbarButtons = () => [...container.querySelectorAll(".dashboard-toolbar > button")].map((b) => b.textContent?.trim());
    expect(toolbarButtons()).not.toContain("Done");

    chooseLayoutOption("Customize…");
    expect(toolbarButtons().slice(-2)).toEqual(["+ Add widget…", "Done"]);

    act(() => container.querySelector<HTMLButtonElement>(".dashboard-toolbar > button[data-customize-done]")!.click());
    expect(container.querySelectorAll(".dashboard-widget-controls")).toHaveLength(0);
    expect(toolbarButtons()).not.toContain("Done");
    expect(p.onSetLayoutWidgets).not.toHaveBeenCalled();
    // The menu offers Customize… again.
    act(() => layoutTrigger().click());
    expect(menuLabels().at(-1)).toBe("Customize…");
  });

  it("has no separate Customize button", async () => {
    await render(props());

    const buttons = [...container.querySelectorAll(".dashboard-toolbar > button")].map((b) => b.textContent?.trim());
    expect(buttons).not.toContain("Customize");
    expect(buttons).not.toContain("Done");
  });

  it("Customize… turns on customizing without changing the layout, and Done customizing turns it off", async () => {
    const p = props();
    await render(p);

    chooseLayoutOption("Customize…");
    expect(container.querySelectorAll(".dashboard-widget-controls").length).toBeGreaterThan(0);
    expect(container.querySelector(".dashboard-toolbar")?.textContent).toContain("+ Add widget…");
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

  it("keeps Custom (unsaved) and + Save as… for an edited layout", async () => {
    const edited: WidgetId[] = DEFAULT_LAYOUT.filter((id) => id !== "runway");
    await render(props({ layoutWidgets: edited }));

    expect(layoutTrigger().textContent).toBe("Layout: Custom (unsaved)▾");
    expect(container.querySelector(".dashboard-toolbar")?.textContent).toContain("+ Save as…");
    act(() => layoutTrigger().click());
    expect(menuLabels()).toEqual(["Default", "Bills Focus", "Investor Focus", "Custom (unsaved)", "Customize…"]);
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
