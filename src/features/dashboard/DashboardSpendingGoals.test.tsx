// @vitest-environment jsdom
//
// VS-31 step 2 stream D: the "Spending in <month> so far" card inside the trend_spending widget, the
// "Savings goals" card (goals_overview), and where Recent transactions sits next to it.
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
import { startPrivacyMask } from "../../shared/lib/privacy";
import type { Bucket, Recurring, Transaction } from "../../shared/lib/types";
import type { WidgetId } from "../../shared/lib/dashboardLayout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof DashboardView>;

function props(over: Partial<Props> = {}): Props {
  return {
    accounts: [],
    netWorthHistory: [],
    accountContributionDeltas: [],
    spendingThisMonth: [],
    report: null,
    recurring: [],
    recurringMatches: [],
    monthReviewOffer: null,
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
    layoutWidgets: ["trend_spending"],
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

function txn(over: Partial<Transaction> & Pick<Transaction, "id" | "date">): Transaction {
  return {
    transfer_counterpart_id: null,
    description: "Something",
    amount: "-10.00",
    category: "Groceries",
    category_source: "user",
    confidence: null,
    account_id: 1,
    account_name: "Checking",
    applied_to_debt: null,
    principal_amount: null,
    split_count: 0,
    tags: [],
    member_id: null,
    member_name: null,
    notes: null,
    excluded_from_budget: false,
    ...over,
  };
}

function goal(over: Partial<Bucket> & Pick<Bucket, "id" | "name">): Bucket {
  return {
    target_amount: "1000.00",
    saved_amount: "250.00",
    target_date: null,
    account_id: null,
    account_name: null,
    member_id: null,
    member_name: null,
    sinking_amount: null,
    color: null,
    icon_key: null,
    tracks_account: false,
    monthly_pace: "0.00",
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 15, 12));
  localStorage.clear();
  invokeMock.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function render(p: Props) {
  await act(async () => {
    root.render(<DashboardView {...p} />);
  });
}

const spendCard = () => container.querySelector<HTMLElement>("[data-spending-so-far]")!;
const goalsCard = () => container.querySelector<HTMLElement>("[data-savings-goals]")!;
const rowText = (card: HTMLElement) => [...card.querySelectorAll(".category-bars tr")].map((tr) => tr.textContent!.replace(/\s+/g, " ").trim());
const noAmountInAttributes = (card: HTMLElement) => {
  for (const el of card.querySelectorAll("*")) {
    for (const attr of el.getAttributeNames()) expect(`${attr}=${el.getAttribute(attr)}`).not.toMatch(/\$\s?\d/);
  }
};

const rent = { id: 1, merchant: "Landlord", category: "Rent", amount: "-1500.00", cadence: "monthly", anchor_date: "2026-11-01", next_date: "2026-12-01", account_id: null, account_name: null, member_id: null, member_name: null, status: "keep" } satisfies Recurring;

const spendingProps = () =>
  props({
    spendingThisMonth: [
      { category: "Rent", amount: "1500.00" },
      { category: "Groceries", amount: "320.00" },
      { category: "Dining", amount: "80.00" },
    ],
    transactions: [
      txn({ id: 1, date: "2026-10-04", amount: "-1500.00", category: "Rent", description: "Landlord" }),
      txn({ id: 2, date: "2026-10-10", amount: "-400.00", category: "Groceries" }),
      txn({ id: 3, date: "2026-10-12", amount: "-80.00", category: "Dining" }),
      txn({ id: 4, date: "2026-11-09", amount: "-640.00", category: "Car", description: "Brake repair" }),
      txn({ id: 5, date: "2026-11-01", amount: "-1500.00", category: "Rent", description: "Landlord" }),
    ],
    recurring: [rent],
  });

describe("Spending in <month> so far", () => {
  it("replaces the donut: title, date range, rows largest first with the change against last month", async () => {
    await render(spendingProps());
    expect(container.textContent).not.toContain("Spending by category");
    expect(container.querySelector(".donut-with-legend")).toBeNull();
    expect(spendCard().textContent).toContain("Spending in November 2026 so far");
    expect(spendCard().textContent).toContain("Nov 1–15, largest first. The change is against Oct 1–15.");
    const rows = rowText(spendCard());
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Rent");
    expect(rows[0]).toContain("$1,500");
    expect(rows[0]).toContain("same");
    expect(rows[1]).toContain("Groceries");
    expect(rows[1]).toContain("$320");
    expect(rows[1]).toContain("down");
    expect(rows[1]).toContain("$80");
    expect(rows[2]).toContain("Dining");
    expect(rows[2]).toContain("same");
    expect(spendCard().textContent).toContain("$1,900 spent");
  });

  it("tones a rise bad and a fall good", async () => {
    await render(spendingProps());
    expect(spendCard().querySelector(".category-bars-note-good")?.textContent).toContain("down");
    await render({ ...spendingProps(), spendingThisMonth: [{ category: "Dining", amount: "180.00" }] });
    expect(spendCard().querySelector(".category-bars-note-bad")?.textContent).toContain("up");
  });

  it("shows the biggest one-off cost, leaving out a bill you pay every month", async () => {
    await render(spendingProps());
    const line = spendCard().querySelector("[data-biggest-one-off]")!;
    expect(line.textContent).toContain("Biggest one-off cost");
    expect(line.textContent).toContain("Brake repair");
    expect(line.textContent).toContain("$640");
    expect(line.textContent).toContain("Nov 9");
  });

  it("opens that category's transactions for the month when its name is clicked", async () => {
    await render(spendingProps());
    const button = [...spendCard().querySelectorAll<HTMLButtonElement>(".category-bars-select")].find((b) => b.textContent!.includes("Groceries"))!;
    await act(async () => button.click());
    expect(invokeMock).toHaveBeenCalledWith("spending_transactions_for_category", { category: "Groceries", year: 2026, month: 11 });
  });

  it("folds past eight rows into Everything else (n), which opens the rest when clicked", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ category: `Cat${i}`, amount: String(100 - i) }));
    await render(props({ spendingThisMonth: many }));
    expect(rowText(spendCard())).toHaveLength(8);
    expect(spendCard().textContent).toContain("Everything else (3)");
    const fold = [...spendCard().querySelectorAll<HTMLButtonElement>(".category-bars-select")].find((b) => b.textContent!.includes("Everything else"))!;
    await act(async () => fold.click());
    expect(rowText(spendCard())).toHaveLength(10);
    expect(spendCard().textContent).not.toContain("Everything else");
    expect(invokeMock).not.toHaveBeenCalledWith("spending_transactions_for_category", expect.anything());
    const fewer = [...spendCard().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Show fewer")!;
    await act(async () => fewer.click());
    expect(rowText(spendCard())).toHaveLength(8);
  });

  it("says so in words when nothing has been spent this month", async () => {
    await render(props());
    expect(spendCard().textContent).toContain("No spending yet this month.");
    expect(spendCard().querySelector(".category-bars")).toBeNull();
    expect(spendCard().querySelector("[data-biggest-one-off]")).toBeNull();
  });

  it("keeps the net worth trend beside it in the same widget", async () => {
    await render(props());
    const widget = container.querySelector('[data-widget-id="trend_spending"]')!;
    expect(widget.textContent).toContain("Net worth trend");
    expect(widget.contains(spendCard())).toBe(true);
  });

  it("hides every figure, change notes included, and keeps amounts out of every attribute", async () => {
    await render(spendingProps());
    const stop = startPrivacyMask(container);
    try {
      expect(spendCard().textContent).not.toMatch(/\$\s?\d/);
      expect(spendCard().textContent).toContain("••••");
    } finally {
      stop();
    }
    noAmountInAttributes(spendCard());
  });
});

describe("Savings goals", () => {
  const layout: WidgetId[] = ["goals_overview"];

  it("shows each goal with its name, its own colour and what is saved of the target", async () => {
    await render(
      props({
        layoutWidgets: layout,
        buckets: [goal({ id: 1, name: "Holiday", color: "#336699" }), goal({ id: 2, name: "Car", saved_amount: "1500.00", target_amount: "1000.00" }), goal({ id: 3, name: "Rainy day", target_amount: null, saved_amount: "75.00" })],
      }),
    );
    const text = goalsCard().textContent!;
    expect(text).toContain("Savings goals");
    expect(text).toContain("Holiday");
    expect(text).toContain("$250 of $1,000");
    expect(text).toContain("$1,500 of $1,000");
    expect(text).toContain("$75");
    const fills = [...goalsCard().querySelectorAll<HTMLElement>(".progress-fill")];
    expect(fills).toHaveLength(2);
    expect(fills[0].style.background).toContain("rgb(51, 102, 153)");
    expect(fills[0].style.width).toBe("25%");
    expect(fills[1].style.width).toBe("100%");
  });

  it("opens Goals from All goals", async () => {
    const onOpenBuckets = vi.fn();
    await render(props({ layoutWidgets: layout, onOpenBuckets, buckets: [goal({ id: 1, name: "Holiday" })] }));
    const link = [...goalsCard().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "All goals")!;
    await act(async () => link.click());
    expect(onOpenBuckets).toHaveBeenCalledTimes(1);
  });

  it("says there are no goals yet and offers a way to add one", async () => {
    const onOpenBuckets = vi.fn();
    await render(props({ layoutWidgets: layout, onOpenBuckets }));
    expect(goalsCard().textContent).toContain("No savings goals yet.");
    expect(goalsCard().querySelector(".progress-track")).toBeNull();
    const add = [...goalsCard().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Add a goal")!;
    await act(async () => add.click());
    expect(onOpenBuckets).toHaveBeenCalledTimes(1);
  });

  it("draws no bar for a negative saved amount, hides its figures and keeps them out of attributes", async () => {
    await render(props({ layoutWidgets: layout, buckets: [goal({ id: 1, name: "Overdrawn", saved_amount: "-40.00" })] }));
    expect(goalsCard().querySelector<HTMLElement>(".progress-fill")!.style.width).toBe("0%");
    const stop = startPrivacyMask(container);
    try {
      expect(goalsCard().textContent).not.toMatch(/\$\s?\d/);
    } finally {
      stop();
    }
    noAmountInAttributes(goalsCard());
  });

  it("leaves a pinned single-goal widget as it was", async () => {
    await render(props({ layoutWidgets: ["bucket:1"], buckets: [goal({ id: 1, name: "Holiday" })] }));
    expect(container.querySelector('[data-widget-id="bucket:1"] .stat-value')?.textContent).toBe("$250.00");
    expect(container.querySelector("[data-savings-goals]")).toBeNull();
  });
});

describe("Recent transactions placement", () => {
  it("sits beside Savings goals in one row, each widget keeping its own id", async () => {
    await render(props({ layoutWidgets: ["recent_transactions", "goals_overview"] }));
    const pair = container.querySelector(".dashboard-pair-row")!;
    expect(pair).not.toBeNull();
    expect(pair.querySelector('[data-widget-id="recent_transactions"]')).not.toBeNull();
    expect(pair.querySelector('[data-widget-id="goals_overview"]')).not.toBeNull();
  });

  it("stays full width when something sits between the two or Savings goals is gone", async () => {
    await render(props({ layoutWidgets: ["recent_transactions", "runway", "goals_overview"] }));
    expect(container.querySelector(".dashboard-pair-row")).toBeNull();
    await render(props({ layoutWidgets: ["recent_transactions"] }));
    expect(container.querySelector(".dashboard-pair-row")).toBeNull();
  });

  it("lets each widget of the pair be removed on its own while customizing", async () => {
    const onSetLayoutWidgets = vi.fn();
    await render(props({ layoutWidgets: ["runway", "recent_transactions", "goals_overview"], onSetLayoutWidgets }));
    act(() => container.querySelector<HTMLButtonElement>(".layout-select-toggle")!.click());
    const customize = [...container.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")].find((m) => m.textContent?.includes("Customize"))!;
    act(() => customize.click());
    const goals = container.querySelector('.dashboard-pair-row [data-widget-id="goals_overview"]')!;
    await act(async () => goals.querySelector<HTMLButtonElement>('[aria-label="Remove widget"]')!.click());
    expect(onSetLayoutWidgets).toHaveBeenCalledWith(["runway", "recent_transactions"]);
  });
});
