// @vitest-environment jsdom
//
// Reports hub (VS-31 step 2, stream R): one range, summary strip and set of print buttons above the v9 tabs; every
// section in one tab; Print and Save as PDF include every section even from tabs nobody opened.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { monthKeys, presetRange, type RangePreset } from "../../shared/lib/reportRange";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = vi.hoisted(() => ({ value: null as unknown, state: null as unknown, refresh: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("../../shared/hooks/useFinancialRead", () => ({
  useFinancialRead: () => ({ data: read.value, state: read.state, refresh: read.refresh }),
}));

import { ReportsOverview, type ReportsTab } from "./ReportsOverview";

const TAB_LABELS = ["Where income went", "Categories by month", "Daily spending", "Tags and people", "Savings rate", "Year by year", "Comparisons"];
// One heading per section, as drawn on the page.
const HEADINGS: Record<string, string[]> = {
  income: ["Income → spending"],
  categories: ["Where the money went, by category and month"],
  daily: ["Daily spending"],
  people: ["Spending by member", "Spending by tag", "Net Worth by Member"],
  savings: ["Savings rate trend"],
  years: ["Year by year"],
};
const ALL_HEADINGS = Object.values(HEADINGS).flat();

const account = { id: 1, name: "Checking", account_type: "checking", starting_balance: "0", current_balance: "100", institution: null, mask: null, interest_rate: null, excluded_from_debt_payoff: false, member_id: null, member_name: null, checkpoint_date: null, icon_key: null, import_flip_signs: null, hidden: false };
const tx = (id: number, date: string, amount: string, category: string, extra: object = {}) => ({ id, transfer_counterpart_id: null, date, description: `T${id}`, amount, category, category_source: "user" as const, confidence: null, account_id: 1, account_name: "Checking", applied_to_debt: null, principal_amount: null, split_count: 0, tags: [], member_id: null, member_name: null, notes: null, excluded_from_budget: false, ...extra });

function snapshotFor(today: Date, preset: RangePreset = "last_6") {
  const { from, to } = presetRange(preset, today);
  const months = monthKeys(from, to);
  const key = `${months[0]}..${months[months.length - 1]}`;
  const last = months[months.length - 1];
  return {
    key,
    value: {
      fromYear: from.year, fromMonth: from.month, toYear: to.year, toMonth: to.month,
      cells: [{ month: last, category: "Rent", amount: "1200.00" }, { month: last, category: "Groceries", amount: "300.00" }],
      flow: {
        months: months.map((m) => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5)), month_label: m, income: "3000.00", expense: "1500.00" })),
        top_categories: [], top_merchants: [], total_income: "18000.00", total_expense: "9000.00",
      },
      daily: [{ date: `${last}-02`, amount: "1200.00" }, { date: `${last}-05`, amount: "300.00" }],
    },
  };
}

const people = [tx(1, "2026-11-02", "-1200.00", "Rent", { tags: ["holiday"], member_name: "Alex", member_id: 1 }), tx(2, "2026-11-01", "3000.00", "Income")];

describe("ReportsOverview tabs", () => {
  let container: HTMLDivElement;
  let root: Root;
  const props = () => ({
    accounts: [account],
    transactions: people,
    assets: [],
    familyMembers: [{ id: 1, name: "Alex" }],
    onExportCsv: vi.fn(),
    onPrint: vi.fn(),
    onSavePdf: vi.fn(),
    onOpenBudget: vi.fn(),
    layoutWidgets: [],
    onPinWidget: vi.fn(),
    renderComparisons: (active: boolean): ReactNode => <div data-comparisons-page data-active={String(active)}>comparisons page</div>,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 16, 12));
    read.value = snapshotFor(new Date(2026, 10, 16));
    read.refresh = vi.fn(() => Promise.resolve());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const show = (p: Partial<ReturnType<typeof props>> & { initialTab?: ReportsTab } = {}) => act(() => { root.render(<ReportsOverview {...props()} {...p} />); });
  const tab = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("[role='tab']")].find((t) => t.textContent === name)!;
  const panelOf = (name: string) => container.querySelector<HTMLElement>(`[role='tabpanel'][aria-labelledby='${tab(name).id}']`)!;
  const open = (name: string) => act(() => tab(name).click());
  const headingsIn = (el: ParentNode) => ALL_HEADINGS.filter((h) => [...el.querySelectorAll(".reports-section-title")].some((t) => t.textContent === h));

  it("has the v9 tabs in order, with Comparisons last, and opens on Where income went", () => {
    show();
    expect([...container.querySelectorAll("[role='tab']")].map((t) => t.textContent)).toEqual(TAB_LABELS);
    expect(container.querySelector("[role='tablist']")?.getAttribute("aria-label")).toBe("Report sections");
    expect(tab("Where income went").getAttribute("aria-selected")).toBe("true");
    expect(tab("Comparisons").getAttribute("data-reports-tab")).toBe("comparisons");
  });

  it("puts every section in its own tab and in no other", () => {
    show();
    const tabsOf: Record<string, string> = { income: "Where income went", categories: "Categories by month", daily: "Daily spending", people: "Tags and people", savings: "Savings rate", years: "Year by year" };
    for (const label of Object.values(tabsOf)) open(label);
    for (const [id, label] of Object.entries(tabsOf)) {
      expect(headingsIn(panelOf(label)), label).toEqual(HEADINGS[id]);
    }
  });

  it("keeps the range picker, summary strip and output buttons above the tabs, outside every panel", () => {
    show();
    const list = container.querySelector("[role='tablist']")!;
    for (const el of [
      container.querySelector("[data-range-preset='last_6']")!,
      container.querySelector("[data-report-summary]")!,
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Export CSV")!,
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Print")!,
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Save as PDF")!,
    ]) {
      expect(el).toBeTruthy();
      expect(el.closest("[role='tabpanel']")).toBeNull();
      expect(el.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(container.querySelector("[data-summary-income]")?.textContent).toBe("$18,000.00");
  });

  it("hides the report's controls while Comparisons shows, and keeps them mounted", () => {
    show();
    const controls = container.querySelector<HTMLElement>("[data-reports-controls]")!;
    expect(controls.hidden).toBe(false);
    open("Comparisons");
    expect(controls.hidden).toBe(true);
    expect(container.querySelector("[data-comparisons-page]")?.getAttribute("data-active")).toBe("true");
    open("Where income went");
    expect(controls.hidden).toBe(false);
    expect(container.querySelector("[data-comparisons-page]")?.getAttribute("data-active")).toBe("false");
  });

  it("does not mount a tab's sections until it is opened", () => {
    show();
    expect(container.querySelector("[data-report-heatmap]")).toBeNull();
    expect(container.querySelector("[data-report-sankey]")).not.toBeNull();
    open("Daily spending");
    expect(container.querySelector("[data-report-heatmap]")).not.toBeNull();
  });

  it("still sends 'This month's budget' to Budget, and keeps it below the tabs", () => {
    const p = props();
    show(p);
    const link = [...container.querySelectorAll<HTMLElement>(".clickable-row")].find((e) => e.textContent?.includes("This month's budget"))!;
    expect(link.closest("[role='tabpanel']")).toBeNull();
    act(() => link.click());
    expect(p.onOpenBudget).toHaveBeenCalledTimes(1);
  });

  it("does not mount Comparisons until it is first opened, and keeps it mounted after", () => {
    show({ renderComparisons: () => <div data-comparisons-page /> });
    expect(container.querySelector("[data-comparisons-page]")).toBeNull();
    open("Comparisons");
    expect(container.querySelector("[data-comparisons-page]")).not.toBeNull();
    open("Daily spending");
    expect(container.querySelector("[data-comparisons-page]")).not.toBeNull();
    expect(panelOf("Comparisons").hidden).toBe(true);
  });

  it("moves between tabs with the arrow keys, Home and End, and wires each tab to its panel", () => {
    show();
    const press = (el: HTMLElement, key: string) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
    for (const label of TAB_LABELS) expect(tab(label).getAttribute("aria-controls")).toBe(panelOf(label).id);
    press(tab("Where income went"), "ArrowLeft");
    expect(tab("Comparisons").getAttribute("aria-selected")).toBe("true");
    press(tab("Comparisons"), "ArrowRight");
    expect(tab("Where income went").getAttribute("aria-selected")).toBe("true");
    press(tab("Where income went"), "End");
    expect(tab("Comparisons").getAttribute("aria-selected")).toBe("true");
    press(tab("Comparisons"), "Home");
    expect(document.activeElement).toBe(tab("Where income went"));
    expect(tab("Where income went").tabIndex).toBe(0);
    expect(tab("Comparisons").tabIndex).toBe(-1);
  });

  it("can open on another tab", () => {
    show({ initialTab: "comparisons" as const });
    expect(tab("Comparisons").getAttribute("aria-selected")).toBe("true");
  });

  it("says so in words when there are no transactions for the savings rate, instead of an empty tab", () => {
    show({ transactions: [] });
    open("Savings rate");
    expect(panelOf("Savings rate").textContent).toContain("Savings rate trend");
    expect(panelOf("Savings rate").querySelector(".empty-state")?.textContent).toBe("No income or spending in this range, so there is no savings rate to show.");
  });

  const savingsLabels = () => [...panelOf("Savings rate").querySelectorAll(".sr-only tbody tr td:first-child")].map((td) => td.textContent);
  const pick = (preset: RangePreset) => {
    read.value = snapshotFor(new Date(2026, 10, 16), preset);
    act(() => container.querySelector<HTMLButtonElement>(`[data-range-preset='${preset}']`)!.click());
  };

  it("the savings rate trend covers only the chosen range", () => {
    const history = [tx(10, "2026-03-02", "1000.00", "Income"), tx(11, "2026-03-03", "-200.00", "Rent"), ...people];
    show({ transactions: history });
    open("Savings rate");
    expect(savingsLabels()).toEqual(["Nov so far"]);
    pick("last_12");
    expect(savingsLabels()).toEqual(["Mar", "Nov so far"]);
  });

  it("the savings rate trend marks the current month as so far", () => {
    const history = [tx(10, "2026-10-02", "1000.00", "Income"), ...people];
    show({ transactions: history });
    open("Savings rate");
    const panel = panelOf("Savings rate");
    expect(savingsLabels()).toEqual(["Oct", "Nov so far"]);
    expect(panel.textContent).toContain("November isn't over yet, so its rate is only for the days so far.");
    expect(panel.querySelector("[data-partial-segment]")).not.toBeNull();
    pick("last_month");
    expect(savingsLabels()).toEqual(["Oct"]);
    expect(panel.textContent).not.toContain("isn't over yet");
    expect(panel.querySelector("[data-partial-segment]")).toBeNull();
  });

  it("shows the current month as a hollow point when it is the only month with activity", () => {
    show();
    open("Savings rate");
    const panel = panelOf("Savings rate");
    expect(savingsLabels()).toEqual(["Nov so far"]);
    expect(panel.querySelector("[data-partial-point]")).not.toBeNull();
    expect(panel.querySelector("[data-partial-segment]")).toBeNull();
  });

  it("marks the category table wide when the range is longer than six months, so paper can shrink it", () => {
    show();
    open("Categories by month");
    expect(container.querySelector("[data-report-table] table")?.classList.contains("report-table-wide")).toBe(false);
    read.value = snapshotFor(new Date(2026, 10, 16), "last_12");
    act(() => container.querySelector<HTMLButtonElement>("[data-range-preset='last_12']")!.click());
    expect(container.querySelector("[data-report-table] table")?.classList.contains("report-table-wide")).toBe(true);
  });

  it("keeps Pin to Dashboard off paper", () => {
    show();
    open("Tags and people");
    const pin = [...panelOf("Tags and people").querySelectorAll("button")].find((b) => b.textContent === "Pin to Dashboard")!;
    expect(pin.closest(".no-print")).not.toBeNull();
  });

  it("scrolls a heatmap to its newest weeks when its tab is opened after the range changed while it was hidden", () => {
    const proto = HTMLElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "scrollWidth");
    Object.defineProperty(proto, "scrollWidth", { configurable: true, get() { return this.classList.contains("table-scroll") && !this.closest("[hidden]") ? 900 : 0; } });
    try {
      show();
      open("Daily spending");
      expect(container.querySelector<HTMLElement>("[data-report-heatmap] .table-scroll")!.scrollLeft).toBe(900);
      open("Where income went");
      container.querySelector<HTMLElement>("[data-report-heatmap] .table-scroll")!.scrollLeft = 0; // a hidden frame loses its place
      // The range changes while the heatmap is hidden; its new figures arrive while it is still hidden.
      read.value = snapshotFor(new Date(2026, 10, 16), "last_12");
      act(() => container.querySelector<HTMLButtonElement>("[data-range-preset='last_12']")!.click());
      const hiddenFrame = container.querySelector<HTMLElement>("[data-report-heatmap] .table-scroll")!;
      expect(hiddenFrame.scrollLeft).toBe(0);
      open("Daily spending");
      expect(hiddenFrame.scrollLeft).toBe(900);
    } finally {
      if (original) Object.defineProperty(proto, "scrollWidth", original);
      else delete (proto as unknown as { scrollWidth?: number }).scrollWidth;
    }
  });
});

describe("Print and Save as PDF include every section", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 16, 12));
    read.value = snapshotFor(new Date(2026, 10, 16));
    read.refresh = vi.fn(() => Promise.resolve());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  const base = {
    accounts: [account],
    transactions: people,
    assets: [], familyMembers: [{ id: 1, name: "Alex" }], onExportCsv: vi.fn(), onOpenBudget: vi.fn(), layoutWidgets: [], onPinWidget: vi.fn(),
    renderComparisons: () => <div data-comparisons-page />,
  };
  const printBlock = () => container.querySelector(".reports-print-all");
  const headingsIn = (el: ParentNode) => ALL_HEADINGS.filter((h) => [...el.querySelectorAll(".reports-section-title")].some((t) => t.textContent === h));
  const press = (label: string) => act(() => { [...container.querySelectorAll("button")].find((b) => b.textContent === label)!.click(); });

  it("has no print block on screen until someone prints", () => {
    act(() => { root.render(<ReportsOverview {...base} onPrint={vi.fn()} />); });
    expect(printBlock()).toBeNull();
  });

  it("Print: every section is on the page when the printer is asked, though only the first tab was ever opened, then it goes away", () => {
    let seen: string[] = [];
    const onPrint = vi.fn(() => { seen = headingsIn(printBlock()!); });
    act(() => { root.render(<ReportsOverview {...base} onPrint={onPrint} />); });
    expect(container.querySelector("[data-report-heatmap]")).toBeNull();
    press("Print / Save as PDF");
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(ALL_HEADINGS);
    expect(printBlock()).toBeNull();
  });

  it("Save as PDF: every section is present for the whole save, then the block is removed", async () => {
    let seen: string[] = [];
    let finish: () => void = () => {};
    const onSavePdf = vi.fn(() => new Promise<void>((resolve) => { seen = headingsIn(printBlock()!); finish = resolve; }));
    act(() => { root.render(<ReportsOverview {...base} onPrint={vi.fn()} onSavePdf={onSavePdf} />); });
    press("Save as PDF");
    expect(seen).toEqual(ALL_HEADINGS);
    expect(printBlock()).not.toBeNull();
    await act(async () => { finish(); });
    expect(printBlock()).toBeNull();
  });

  it("the system print shortcut (beforeprint) mounts the block too, and afterprint removes it", () => {
    act(() => { root.render(<ReportsOverview {...base} onPrint={vi.fn()} />); });
    act(() => { window.dispatchEvent(new Event("beforeprint")); });
    expect(headingsIn(printBlock()!)).toEqual(ALL_HEADINGS);
    act(() => { window.dispatchEvent(new Event("afterprint")); });
    expect(printBlock()).toBeNull();
  });

  it("prints nothing extra while Comparisons is showing", () => {
    act(() => { root.render(<ReportsOverview {...base} onPrint={vi.fn()} initialTab="comparisons" />); });
    act(() => { window.dispatchEvent(new Event("beforeprint")); });
    expect(printBlock()).toBeNull();
  });

  it("keeps amounts out of every attribute in the print block", () => {
    act(() => { root.render(<ReportsOverview {...base} onPrint={vi.fn()} />); });
    act(() => { window.dispatchEvent(new Event("beforeprint")); });
    const bad = [...printBlock()!.querySelectorAll("*")].flatMap((el) => [...el.attributes].filter((a) => /\$\s?\d/.test(a.value)).map((a) => `${el.tagName}.${a.name}`));
    expect(bad).toEqual([]);
  });
});

describe("report context (VS-98)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const props = () => ({
    accounts: [account],
    transactions: people,
    assets: [],
    familyMembers: [{ id: 1, name: "Alex" }],
    onExportCsv: vi.fn(),
    onPrint: vi.fn(),
    onOpenBudget: vi.fn(),
    layoutWidgets: [],
    onPinWidget: vi.fn(),
    renderComparisons: (): ReactNode => <div data-comparisons-page />,
  });
  const at = (y: number, m: number, d: number, preset: RangePreset = "last_6") => {
    vi.setSystemTime(new Date(y, m, d, 12));
    read.value = snapshotFor(new Date(y, m, d), preset);
  };
  const show = (p: Record<string, unknown> = {}) => act(() => { root.render(<ReportsOverview {...props()} {...p} />); });
  const rangeOf = () => container.querySelector("[data-reports-hub]")!.getAttribute("data-report-range");
  const categoryButton = (name: string) => container.querySelector<HTMLButtonElement>(`button[data-report-category-open='${name}']`);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    read.state = null;
    read.refresh = vi.fn(() => Promise.resolve());
    at(2026, 10, 25);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("opens on the range it is given", () => {
    at(2026, 10, 25, "last_12");
    show({ initialPreset: "last_12" });
    expect(container.querySelector("[data-range-preset='last_12']")!.classList.contains("view-toggle-active")).toBe(true);
    expect(container.querySelector("[data-range-preset='last_6']")!.classList.contains("view-toggle-active")).toBe(false);
    expect(rangeOf()).toBe("2025-12..2026-11");
  });

  it("makes each Categories by month row a button that reports where the report was, with the range's exact dates", () => {
    const onOpenTransactions = vi.fn();
    show({ initialTab: "categories", onOpenTransactions });
    const button = categoryButton("Groceries")!;
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("See Groceries transactions");
    expect(button.textContent).toBe("Groceries");
    act(() => button.click());
    expect(onOpenTransactions).toHaveBeenCalledTimes(1);
    expect(onOpenTransactions).toHaveBeenCalledWith({ view: { tab: "categories", preset: "last_6" }, category: "Groceries", from: "2026-06-01", to: "2026-11-30" });
  });

  it("leaves the category as plain text when nothing can open transactions", () => {
    show({ initialTab: "categories" });
    expect(container.querySelector("button[data-report-category-open]")).toBeNull();
    expect(container.querySelector("[data-report-category='Groceries'] td")!.textContent).toBe("Groceries");
  });

  it("passes the Uncategorized row on as Uncategorized", () => {
    const onOpenTransactions = vi.fn();
    const snap = snapshotFor(new Date(2026, 10, 25));
    snap.value.cells.push({ month: snap.value.cells[0].month, category: "Uncategorized", amount: "10.00" });
    read.value = snap;
    show({ initialTab: "categories", onOpenTransactions });
    act(() => categoryButton("Uncategorized")!.click());
    expect(onOpenTransactions.mock.calls[0][0].category).toBe("Uncategorized");
  });

  it("moves a relative range on at a month rollover when Reports is opened again", () => {
    at(2026, 10, 30);
    show({ initialPreset: "last_6" });
    expect(rangeOf()).toBe("2026-06..2026-11");
    act(() => root.unmount());
    at(2026, 11, 1);
    root = createRoot(container);
    show({ initialPreset: "last_6" });
    expect(rangeOf()).toBe("2026-07..2026-12");
  });

  it("puts focus back on the row it was opened from, or on the Categories by month tab if that row is gone", () => {
    show({ initialTab: "categories", onOpenTransactions: vi.fn(), focusCategory: "Groceries" });
    expect(document.activeElement).toBe(categoryButton("Groceries"));
    act(() => root.unmount());
    root = createRoot(container);
    show({ initialTab: "categories", onOpenTransactions: vi.fn(), focusCategory: "Gone" });
    expect(document.activeElement).toBe(container.querySelector("[data-reports-tab='categories']"));
  });

  it("keeps the chosen range, and offers a retry, when the report cannot be read", () => {
    read.value = null;
    read.state = { key: "2025-12..2026-11", loading: false, error: new Error("Could not read") };
    show({ initialPreset: "last_12" });
    expect(container.querySelector("[data-range-preset='last_12']")!.classList.contains("view-toggle-active")).toBe(true);
    expect(rangeOf()).toBe("2025-12..2026-11");
    expect([...container.querySelectorAll("button")].some((b) => /try again|retry/i.test(b.textContent ?? ""))).toBe(true);
  });

  it("keeps the savings rate trend, with its so-far month, on a restored range (VS-64 unchanged)", () => {
    at(2026, 10, 25, "last_12");
    const history = [tx(10, "2026-03-02", "1000.00", "Income"), tx(11, "2026-03-03", "-200.00", "Rent"), ...people];
    show({ initialPreset: "last_12", initialTab: "savings", transactions: history });
    const labels = [...container.querySelectorAll("[data-report-savings] .sr-only tbody tr td:first-child")].map((td) => td.textContent);
    expect(labels).toEqual(["Mar", "Nov so far"]);
  });

  it("prints the restored range, with each category as plain text", () => {
    at(2026, 10, 25, "last_12");
    let months = -1;
    let buttons = -1;
    const onPrint = vi.fn(() => {
      const block = container.querySelector(".reports-print-all")!;
      months = block.querySelectorAll("[data-report-table] thead th.amount-col").length - 1;
      buttons = block.querySelectorAll("button[data-report-category-open]").length;
    });
    show({ initialPreset: "last_12", onPrint, onOpenTransactions: vi.fn() });
    act(() => { [...container.querySelectorAll("button")].find((b) => b.textContent === "Print / Save as PDF")!.click(); });
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(months).toBe(12);
    expect(buttons).toBe(0);
  });
});
