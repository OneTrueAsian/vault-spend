// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { CashFlowView } from "./CashFlowView";
import { forecastHorizons } from "./forecastChart";
import { startPrivacyMask } from "../../shared/lib/privacy";
import type { ReportSnapshot } from "../../shared/native/financialContracts";

// VS-31 step 2 (CF): the six-month card reads the same report snapshot Reports uses. The hook is replaced so
// each test decides what the read returns; the key is the six months ending with "today" (2026-11-16 below).
const read = vi.hoisted(() => ({
  value: null as unknown,
  loading: false,
  error: null as null | { message: string },
  refresh: null as unknown as Mock,
}));
vi.mock("../../shared/hooks/useFinancialRead", () => ({
  useFinancialRead: () => ({
    data: read.value ? { key: "2026-06..2026-11", value: read.value } : null,
    state: { key: "2026-06..2026-11", loading: read.loading, error: read.error },
    refresh: read.refresh,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 16, 12));
  read.value = null; read.loading = false; read.error = null;
  read.refresh = vi.fn(() => Promise.resolve());
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

type Props = ComponentProps<typeof CashFlowView>;
function props(income = "0", expense = "0", compare = false, extra: Partial<Props> = {}): Props {
  const months = [{ year: 2026, month: 10, month_label: "Oct", income, expense }];
  const flow = { months, top_categories: [], top_merchants: [], total_income: income, total_expense: expense };
  return { cashFlow: flow, range: 3, onSetRange: vi.fn(), compareLastYear: compare, onToggleCompareLastYear: vi.fn(), yoyCashFlow: compare ? { current: months, prior_year: [{ ...months[0], income: "10", expense: "5" }] } : null, onMonthClick: vi.fn(), topCategoriesData: flow, topCategoriesMonth: { year: 2026, month: 10 }, onSetTopCategoriesMonth: vi.fn(), previousMonthCategorySpending: [], forecastData: null, forecastDays: 30, onSetForecastDays: vi.fn(), accounts: [], onSetAccountInterestRate: vi.fn(), onCalculateDebtPayoff: vi.fn(), onSetAccountExcludedFromDebtPayoff: vi.fn(), layoutWidgets: [], onPinWidget: vi.fn(), ...extra };
}
function show(income = "0", expense = "0", compare = false, extra: Partial<Props> = {}) {
  const p = props(income, expense, compare, extra);
  act(() => root.render(<CashFlowView {...p} />));
  return p;
}
const loan = { id: 7, name: "Car loan", account_type: "loan", starting_balance: "9000.00", current_balance: "4200.00", institution: null, mask: null, interest_rate: "5.0", excluded_from_debt_payoff: false, member_id: null, member_name: null, checkpoint_date: null, icon_key: null, import_flip_signs: null, hidden: false } as Props["accounts"][number];
const openTab = (id: string) => act(() => (host.querySelector(`#cashflow-tab-${id}`) as HTMLButtonElement).click());
const panel = (id: string) => host.querySelector(`#cashflow-panel-${id}`) as HTMLElement;
const card = () => host.querySelector("[data-cashflow-six-months]") as HTMLElement;
const texts = (sel: string, within: ParentNode = host) => [...within.querySelectorAll(sel)].map((e) => e.textContent);

/** A report for Jun–Nov 2026. `months` gives income and expense per month (missing months are 0);
 * `cells` are [month number, category, amount] spending cells. */
function snapshot(months: Record<number, [string, string]>, cells: [number, string, string][]): ReportSnapshot {
  const all = [6, 7, 8, 9, 10, 11].map((m) => ({ year: 2026, month: m, month_label: `M${m}`, income: months[m]?.[0] ?? "0", expense: months[m]?.[1] ?? "0" }));
  return {
    contractVersion: 1, context: { contractVersion: 1, generation: 1, sessionRevision: 1 }, revision: { local: 1, external: 0 },
    fromYear: 2026, fromMonth: 6, toYear: 2026, toMonth: 11,
    cells: cells.map(([m, category, amount]) => ({ month: `2026-${String(m).padStart(2, "0")}`, category, amount })),
    flow: { months: all, top_categories: [], top_merchants: [], total_income: "0", total_expense: "0" },
    daily: [],
  } as unknown as ReportSnapshot;
}

it("explains an empty period without invented currency ticks or a nonexistent bar action", () => {
  show();
  openTab("by-month");
  expect(panel("by-month").textContent).toContain("No income or spending in this period.");
  expect(host.querySelectorAll(".chart-bar")).toHaveLength(0);
  expect(panel("by-month").textContent).not.toContain("Click a bar");
});

it("responds to changed inputs and retains a prior-year-only comparison", () => {
  show(); openTab("by-month"); show("100", "20");
  expect(panel("by-month").querySelectorAll(".chart-bar").length).toBeGreaterThan(0);
  expect(panel("by-month").textContent).toContain("Click a bar");
  show("0", "0", true);
  openTab("last-year");
  expect(panel("last-year").querySelectorAll(".chart-bar").length).toBeGreaterThan(0);
  expect(panel("last-year").textContent).not.toContain("No income or spending in this period.");
});

describe("tabs", () => {
  it("has the five tabs in v9 order and opens on Forecast", () => {
    show();
    const tabs = [...host.querySelectorAll('[role="tablist"] [role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["Forecast", "Month by month", "Look at one month", "Compared with last year", "Debt payoff"]);
    expect(tabs.map((t) => t.id)).toEqual(["cashflow-tab-forecast", "cashflow-tab-by-month", "cashflow-tab-one-month", "cashflow-tab-last-year", "cashflow-tab-debt"]);
    expect(host.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Cash Flow sections");
    expect(host.querySelector("#cashflow-tab-forecast")?.getAttribute("aria-selected")).toBe("true");
    expect(panel("forecast").hidden).toBe(false);
    // The old strip is gone: no Overview tab and no "Compare to last year" tick box.
    expect(host.textContent).not.toContain("Overview");
    expect(host.textContent).not.toContain("Compare to last year");
  });

  it("can open on another tab, for links that land on one section", () => {
    show("0", "0", false, { initialTab: "debt", accounts: [loan] });
    expect(host.querySelector("#cashflow-tab-debt")?.getAttribute("aria-selected")).toBe("true");
    expect(panel("debt").textContent).toContain("Debt Payoff Planner");
  });

  it("moves between tabs with the arrow keys, Home and End, wrapping at the ends", () => {
    show();
    const key = (k: string) => act(() => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
    act(() => (host.querySelector("#cashflow-tab-forecast") as HTMLElement).focus());
    key("ArrowLeft");
    expect(document.activeElement?.id).toBe("cashflow-tab-debt");
    key("ArrowRight");
    expect(document.activeElement?.id).toBe("cashflow-tab-forecast");
    key("End");
    expect(document.activeElement?.id).toBe("cashflow-tab-debt");
    key("Home");
    expect(document.activeElement?.id).toBe("cashflow-tab-forecast");
    key("ArrowRight");
    expect(document.activeElement?.id).toBe("cashflow-tab-by-month");
    expect(panel("by-month").hidden).toBe(false);
  });

  it("puts the forecast and Coming up in Forecast", () => {
    show("0", "0", false, {
      forecastData: { uses_recurring: true, start_balance: "100.00", daily_baseline: "0", enough_history: true, points: [{ date: "2026-11-17", balance: "100.00" }, { date: "2026-11-18", balance: "40.00" }], events: [{ date: "2026-11-18", label: "Rent bill", amount: "-60.00" }] } as unknown as Props["forecastData"],
    });
    const f = panel("forecast");
    expect(f.textContent).toContain("Forecast");
    expect(texts(".tab-btn", f)).toEqual(["30 days", "60 days", "90 days", "6 months", "12 months"]);
    expect(f.querySelector("[data-forecast-lowest]")?.textContent).toContain("$40.00");
    expect(f.textContent).toContain("Coming up");
    expect(f.textContent).toContain("Rent bill");
  });

  it("lists the next 10 in Coming up and offers the rest, so a yearly bill months away can be seen (VS-45)", () => {
    const events = Array.from({ length: 12 }, (_, i) => ({ date: `2027-0${Math.floor(i / 3) + 1}-1${i % 3}`, label: `Bill ${i + 1}`, amount: "-10.00" }));
    show("0", "0", false, {
      forecastData: { uses_recurring: true, start_balance: "100.00", daily_baseline: "0", enough_history: true, points: [{ date: "2026-11-17", balance: "100.00" }], events } as unknown as Props["forecastData"],
    });
    const f = panel("forecast");
    expect(f.querySelectorAll(".forecast-events li")).toHaveLength(10);
    const more = f.querySelector<HTMLButtonElement>("[data-forecast-show-all]")!;
    expect(more.textContent).toBe("Show all 12");
    act(() => more.click());
    expect([...f.querySelectorAll(".forecast-events li")].map((li) => li.querySelector(".forecast-event-label")?.textContent).at(-1)).toBe("Bill 12");
    expect(f.querySelector("[data-forecast-show-all]")).toBeNull();
  });

  it("asks for the number of days to the same date 6 or 12 months from today, and marks the chosen one (VS-45)", () => {
    const [, , , six, twelve] = forecastHorizons(new Date());
    const p = show("0", "0", false, { forecastDays: twelve.days });
    const buttons = [...panel("forecast").querySelectorAll<HTMLButtonElement>(".tab-btn")];
    expect(buttons.find((b) => b.classList.contains("tab-btn-active"))?.textContent).toBe("12 months");
    act(() => buttons[3].click());
    expect(p.onSetForecastDays).toHaveBeenCalledWith(six.days);
  });

  it("puts income vs. expenses, the range and the month click in Month by month", () => {
    const p = show("100", "20");
    openTab("by-month");
    const m = panel("by-month");
    expect(m.textContent).toContain("Income vs. expenses");
    expect(texts(".tab-btn", m)).toEqual(["3 months", "6 months"]);
    expect(m.textContent).toContain("Income · $100.00");
    expect(m.textContent).toContain("Expenses · $20.00");
    expect(m.textContent).toContain("Net $80.00 (80% savings rate)");
    act(() => (m.querySelectorAll(".tab-btn")[1] as HTMLButtonElement).click());
    expect(p.onSetRange).toHaveBeenCalledWith(6);
    const hit = m.querySelector('svg rect[fill="transparent"]') as SVGRectElement;
    act(() => { hit.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(p.onMonthClick).toHaveBeenCalledWith(2026, 10);
  });

  it("keeps Month by month on income vs. expenses even once last year's figures are loaded", () => {
    show("100", "20", true);
    openTab("by-month");
    expect(panel("by-month").textContent).toContain("Income vs. expenses");
    expect(panel("by-month").textContent).not.toContain("this year vs. last year");
  });

  it("puts Top categories and Top merchants in Look at one month, with the month picker and Pin to Dashboard", () => {
    show();
    openTab("one-month");
    const o = panel("one-month");
    expect(o.textContent).toContain("Top categories");
    expect(o.textContent).toContain("Top merchants");
    expect(o.querySelector('[aria-label^="Month for top merchants and categories"]')).not.toBeNull();
    expect(o.textContent).toContain("Pin to Dashboard");
  });

  it("puts the debt planner in Debt payoff", () => {
    show("0", "0", false, { accounts: [loan] });
    openTab("debt");
    expect(panel("debt").textContent).toContain("Debt Payoff Planner");
    expect(panel("debt").textContent).toContain("Calculate");
  });

  it("says so in words when there is no debt to plan, rather than an empty tab", () => {
    show("0", "0", false, { accounts: [{ ...loan, current_balance: "0" }] });
    openTab("debt");
    expect(panel("debt").textContent).toBe("No credit cards or loans with money owed. Add one on Accounts to plan paying it off.");
  });
});

describe("Compared with last year", () => {
  it("turns on last year's figures the first time it opens, once", () => {
    const p = show();
    expect(p.onToggleCompareLastYear).not.toHaveBeenCalled();
    openTab("last-year");
    act(() => root.render(<CashFlowView {...p} />));
    expect(p.onToggleCompareLastYear).toHaveBeenCalledTimes(1);
    expect(panel("last-year").textContent).toContain("Loading");
    openTab("forecast");
    openTab("last-year");
    expect(p.onToggleCompareLastYear).toHaveBeenCalledTimes(1);
  });

  it("leaves the figures on when they already are, and shows every figure the old switch showed", () => {
    const p = show("100", "20", true);
    openTab("last-year");
    expect(p.onToggleCompareLastYear).not.toHaveBeenCalled();
    const l = panel("last-year");
    expect(l.textContent).toContain("Net cash flow — this year vs. last year");
    expect(texts(".chart-legend-item", l)).toEqual(["This year", "Last year"]);
    expect(texts(".tab-btn", l)).toEqual(["3 months", "6 months"]);
    expect(l.querySelector(".sr-only table")?.textContent).toContain("Last year");
  });

  it("opens a month's expense detail from this year's bar", () => {
    const p = show("100", "20", true);
    openTab("last-year");
    const hit = panel("last-year").querySelector('svg rect[fill="transparent"]') as SVGRectElement;
    act(() => { hit.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(p.onMonthClick).toHaveBeenCalledWith(2026, 10);
  });
});

describe("Six months at a glance", () => {
  it("reads the report for the six months ending this month, above the tabs", () => {
    show();
    expect(read.refresh).toHaveBeenCalledTimes(1);
    const [key, fn] = read.refresh.mock.calls[0];
    expect(key).toBe("2026-06..2026-11");
    const client = { report: vi.fn() };
    fn(client);
    expect(client.report).toHaveBeenCalledWith(2026, 6, 2026, 11);
    // Above the tab strip, not inside a panel.
    expect(card().closest('[role="tabpanel"]')).toBeNull();
    expect(card().compareDocumentPosition(host.querySelector('[role="tablist"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reads again when the page's figures refresh after an edit", () => {
    show();
    show("5", "1");
    expect(read.refresh).toHaveBeenCalledTimes(2);
  });

  it("shows a row per month stacked by category, the month's total, and a tick for what came in", () => {
    read.value = snapshot({ 6: ["3000", "2050"], 11: ["1722", "2890"] }, [[6, "Rent", "1650"], [6, "Groceries", "400"], [11, "Rent", "1650"], [11, "Car upkeep", "1240"]]);
    show();
    const c = card();
    expect(c.textContent).toContain("Six months at a glance");
    expect(c.textContent).toContain("Each row is a month's spending; the tick is what came in. November isn't over yet.");
    expect(texts(".stacked-rows-label", c)).toEqual(["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]);
    expect(texts(".stacked-rows-total", c)).toEqual(["$2,050.00", "$0.00", "$0.00", "$0.00", "$0.00", "$2,890.00"]);
    // Only the two months where money came in get a tick.
    expect(c.querySelectorAll(".stacked-rows-tick")).toHaveLength(2);
    expect(texts(".stacked-rows-legend li", c)).toEqual(["Rent", "Car upkeep", "Groceries", "What came in"]);
  });

  it("stacks every row in the same category order, largest over the six months first, as the legend lists them", () => {
    // Cells arrive sorted by name; Rent is the largest overall, so it leads every row.
    read.value = snapshot({ 6: ["0", "2050"], 8: ["0", "2890"] }, [[6, "Groceries", "400"], [6, "Rent", "1650"], [8, "Car upkeep", "1240"], [8, "Rent", "1650"]]);
    show();
    const rows = card().querySelectorAll(".stacked-rows-row");
    const widths = (row: Element) => [...row.querySelectorAll<HTMLElement>(".stacked-rows-seg")].map((s) => s.style.width);
    const w = (amount: number) => `${(amount / 2890) * 100}%`;
    expect(widths(rows[0])).toEqual([w(1650), w(400)]);
    expect(widths(rows[2])).toEqual([w(1650), w(1240)]);
    expect(texts(".stacked-rows-legend li", card())).toEqual(["Rent", "Car upkeep", "Groceries"]);
  });

  it("matches Month by month: each row's total is that month's spending", () => {
    // The same rules on both sides when every purchase has one category line (see plan-cf.md for splits).
    read.value = snapshot({ 9: ["800", "200"], 10: ["800", "880"], 11: ["0", "100"] }, [[9, "Groceries", "200"], [10, "Groceries", "880"], [11, "Uncategorized", "100"]]);
    show();
    const s = read.value as ReportSnapshot;
    const expected = s.flow.months.map((m) => `$${Number(m.expense).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    expect(texts(".stacked-rows-total", card())).toEqual(expected);
  });

  it("folds categories past six into Everything else", () => {
    read.value = snapshot({ 10: ["0", "280"] }, ["A", "B", "C", "D", "E", "F", "G"].map((c, i) => [10, c, String(70 - i * 10)] as [number, string, string]));
    show();
    expect(texts(".stacked-rows-legend li", card())).toEqual(["A", "B", "C", "D", "E", "Everything else"]);
  });

  it("keeps a month with only refunds or income as a row with a $0.00 total", () => {
    // Refunds never become spending cells, so a refund-only month has no segments; its refund counts as money in.
    read.value = snapshot({ 8: ["25", "0"] }, [[10, "Rent", "100"]]);
    show();
    expect(texts(".stacked-rows-total", card())).toEqual(["$0.00", "$0.00", "$0.00", "$0.00", "$100.00", "$0.00"]);
    expect(card().querySelectorAll(".stacked-rows-tick")).toHaveLength(1);
  });

  it("shows every month even with fewer than six months of history", () => {
    read.value = snapshot({ 11: ["10", "5"] }, [[11, "Coffee", "5"]]);
    show();
    expect(card().querySelectorAll(".stacked-rows-row")).toHaveLength(6);
  });

  it("says so in words when there is nothing in the last six months", () => {
    read.value = snapshot({}, []);
    show();
    expect(card().textContent).toContain("No income or spending in the last six months yet.");
    expect(card().querySelectorAll(".stacked-rows-row")).toHaveLength(0);
  });

  it("says it is loading, and offers a retry when the read fails", () => {
    read.loading = true;
    show();
    expect(card().textContent).toContain("Loading six-month totals");
    read.loading = false; read.error = { message: "Disk busy." };
    show("1", "1");
    expect(card().querySelector('[role="alert"]')?.textContent).toContain("Six-month totals could not be loaded.");
    const before = read.refresh.mock.calls.length;
    act(() => (card().querySelector(".status-action") as HTMLButtonElement).click());
    expect(read.refresh.mock.calls.length).toBe(before + 1);
  });

  it("refreshes quietly once figures are showing, so the page below does not jump", () => {
    // App replaces its month figures on every window, month or tab change, and the card reads again each time.
    read.value = snapshot({ 10: ["100", "50"] }, [[10, "Rent", "50"]]);
    read.loading = true;
    show();
    expect(card().querySelector("[data-financial-read]")).toBeNull();
    expect(card().querySelectorAll(".stacked-rows-row")).toHaveLength(6);
    // A failed refresh still says so.
    read.loading = false; read.error = { message: "Disk busy." };
    show("1", "1");
    expect(card().querySelector('[role="alert"]')?.textContent).toContain("Showing the last loaded six-month totals; refresh failed.");
  });

  it("keeps amounts out of every attribute, and hides every amount when amounts are hidden", () => {
    read.value = snapshot({ 6: ["3000", "2050"], 11: ["1722", "2890"] }, [[6, "Rent", "1650"], [6, "Groceries", "400"], [11, "Rent", "1650"], [11, "Car upkeep", "1240"]]);
    show();
    for (const el of [card(), ...card().querySelectorAll("*")]) {
      for (const attr of el.attributes) expect(attr.value, `${el.tagName} ${attr.name}`).not.toMatch(/\$\s?\d/);
    }
    const stop = startPrivacyMask(card());
    expect(card().textContent).not.toMatch(/\$\s?\d/);
    stop();
  });
});
