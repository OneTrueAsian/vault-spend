// @vitest-environment jsdom
//
// Budget page (s2): one summary strip instead of three stacks of totals, each group's progress in
// its heading, column headings over the rows (so the rows drop their trailing words), a typed
// budget field, and a row's settings in one `⋯` menu with visible markers for what is switched on.
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

import { BudgetView } from "./BudgetView";
import { startPrivacyMask } from "../../shared/lib/privacy";
import type { ReportBudgetLine } from "../../shared/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function line(over: Partial<ReportBudgetLine>): ReportBudgetLine {
  return {
    category: "Mortgage",
    budget_group: "fixed",
    budgeted: "1600.00",
    actual: "1600.00",
    cap_enabled: false,
    rollover: "0",
    rollover_enabled: false,
    ...over,
  };
}

const budgetTotals = { income: "5000.00", expense: "1690.00" };

type Props = ComponentProps<typeof BudgetView>;

function props(over: Partial<Props> = {}): Props {
  return {
    categories: ["Mortgage", "Insurance", "Paycheck", "Groceries"],
    budgetActuals: [
      line({ category: "Mortgage" }),
      line({ category: "Insurance", budgeted: "120.00", actual: "90.00" }),
      line({ category: "Paycheck", budget_group: "income", budgeted: "5200.00", actual: "5000.00" }),
    ],
    budgetTotals,
    budgetAlerts: [],
    monthLabel: "March 2026",
    year: 2026,
    month: 3,
    onPrevMonth: vi.fn(),
    onNextMonth: vi.fn(),
    onSetBudget: vi.fn(),
    onSetCap: vi.fn(),
    onSetRollover: vi.fn(),
    envelopeCapsEnabled: true,
    rolloverEnabled: true,
    onDeleteBudget: vi.fn(),
    onCategoryClick: vi.fn(),
    onFetchTrend: vi.fn(async () => []),
    onSuggest: vi.fn(async () => null),
    onApplySuggestions: vi.fn(async () => {}),
    onOpenMonthReview: vi.fn(),
    amountsHidden: false,
    ...over,
  };
}

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

async function render(p: Props) {
  await act(async () => {
    root.render(<BudgetView {...p} />);
  });
}

const rowFor = (category: string) =>
  [...container.querySelectorAll<HTMLElement>(".cat-row")].find((r) => r.querySelector(".category-link")?.textContent === category)!;

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function openMenu(row: HTMLElement) {
  act(() => row.querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
  return document.querySelector<HTMLElement>(".row-menu-panel")!;
}

/** Opens a row's ⋯ menu and picks an item, in two steps so the menu has rendered before the pick. */
function choose(row: HTMLElement, label: string) {
  const panel = openMenu(row);
  act(() => menuItem(panel, label).click());
}

const menuLabels = (panel: HTMLElement) => [...panel.querySelectorAll("[role^='menuitem']")].map((b) => b.textContent?.trim());
const menuItem = (panel: HTMLElement, label: string) =>
  [...panel.querySelectorAll<HTMLButtonElement>("[role^='menuitem']")].find((b) => b.textContent?.trim() === label)!;

describe("Budget read state", () => {
  it("discards a suggestion reply after the viewed month changes", async () => {
    let resolve!: (value: { months_used: number; lines: [] }) => void;
    const onSuggest = () => new Promise<{ months_used: number; lines: [] }>(done => { resolve = done; });
    await render(props({ onSuggest }));
    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Suggest from"))!.click());
    await render(props({ month: 4, monthLabel: "April 2026", onSuggest }));
    await act(async () => resolve({ months_used: 0, lines: [] }));
    expect(document.querySelector('[data-suggest-empty="no-history"]')).toBeNull();
  });
  it("keeps independent suggestions usable when aggregate totals fail", async () => {
    await render(props({ readReady: false, readError: "Fixture read failed", onSuggest: async () => ({ months_used: 0, lines: [] }) }));
    expect(container.querySelector("[data-budget-summary]")).toBeNull();
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("Suggest from"))!.click();
    });
    expect(document.querySelector('[data-suggest-empty="no-history"]')).not.toBeNull();
  });
});

describe("BudgetView Spending against the plan", () => {
  const card = () => container.querySelector<HTMLElement>("[data-budget-summary]")!;
  const rows = () => [...card().querySelectorAll(".category-bars tr")].map((tr) => tr.textContent!.replace(/\s+/g, " ").trim());
  const noAmountInAttributes = (el: HTMLElement) => {
    for (const child of [el, ...el.querySelectorAll<HTMLElement>("*")]) {
      for (const attr of child.getAttributeNames()) expect(`${attr}=${child.getAttribute(attr)}`).not.toMatch(/\$\s?\d/);
    }
  };

  it("replaces the summary strip with one card of bars, a plan outline behind each spent fill", async () => {
    await render(props());
    expect(container.querySelectorAll("[data-budget-summary]")).toHaveLength(1);
    expect(card().querySelector(".reports-section-title")?.textContent).toBe("Spending against the plan");
    expect(container.querySelector(".budget-summary-grid")).toBeNull();
    expect(container.querySelectorAll(".stats")).toHaveLength(0);
    expect(container.querySelector("[data-budget-net-summary]")).toBeNull();
    expect(card().querySelectorAll(".category-bars-plan")).toHaveLength(2);
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toContain("Mortgage");
    expect(rows()[0]).toContain("$1,600.00 of $1,600.00");
    expect(rows()[0]).toContain("$0.00 left");
    expect(rows()[1]).toContain("Insurance");
    expect(rows()[1]).toContain("$90.00 of $120.00");
    expect(rows()[1]).toContain("$30.00 left");
  });

  it("still shows every figure the old strip did: planned, spent, left to spend, and money left after income both ways", async () => {
    await render(props());
    const corner = card().querySelector<HTMLElement>("[data-plan-total]")!;
    expect(corner.textContent).toContain("$1,690.00 of $1,720.00 planned");
    expect(corner.textContent).toContain("$30.00 left");
    expect(card().querySelector("[data-planned-net]")?.textContent).toBe("$3,480.00");
    expect(card().querySelector("[data-actual-net]")?.textContent).toBe("$3,310.00");
  });

  it("says in the corner how far over the plan the month is", async () => {
    await render(props({ budgetActuals: [line({ category: "Mortgage", budgeted: "100.00", actual: "160.00" })] }));
    const corner = card().querySelector<HTMLElement>("[data-plan-total]")!;
    expect(corner.textContent).toContain("$160.00 of $100.00 planned");
    expect(corner.textContent).toContain("$60.00 over");
    expect(rows()[0]).toContain("$60.00 over");
    expect(card().querySelector(".category-bars-note-bad")?.textContent).toContain("over");
  });

  it("keeps the income-minus-spending breakdown in words on the page, with no amount in a tooltip", async () => {
    await render(props());
    const note = card().querySelector<HTMLElement>("[data-budget-summary-note]")!;
    expect(note.textContent).toContain("$5,200.00 budgeted income − $1,720.00 budgeted spending");
    expect(note.textContent).toContain("$5,000.00 recorded income − $1,690.00 recorded spending");
    expect(note.textContent).toContain("Not an account balance");
    noAmountInAttributes(card());
  });

  it("puts the income line at the bottom, carrying the allocation message", async () => {
    await render(props());
    const income = card().querySelector<HTMLElement>("[data-budget-income-line]")!;
    expect(income.textContent).toContain("Income so far is $5,000.00 of $5,200.00 planned.");
    const allocation = income.querySelector("[data-allocation]")!;
    expect(allocation.getAttribute("data-allocation")).toBe("unallocated");
    expect(allocation.textContent).toBe("$3,480.00 of your planned income isn't given a job yet.");
    expect(card().querySelector(".category-bars")!.compareDocumentPosition(income) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says when every dollar has a job, and when spending is planned past income", async () => {
    await render(props({ budgetActuals: [line({ category: "Mortgage", budgeted: "5200.00", actual: "100.00" }), line({ category: "Paycheck", budget_group: "income", budgeted: "5200.00", actual: "5000.00" })] }));
    expect(card().querySelector("[data-allocation]")!.getAttribute("data-allocation")).toBe("balanced");
    expect(card().querySelector("[data-allocation]")!.textContent).toBe("Every dollar of your planned income has a job.");
    await render(props({ budgetActuals: [line({ category: "Mortgage", budgeted: "6000.00", actual: "100.00" }), line({ category: "Paycheck", budget_group: "income", budgeted: "5200.00", actual: "5000.00" })] }));
    expect(card().querySelector("[data-allocation]")!.getAttribute("data-allocation")).toBe("over");
    expect(card().querySelector("[data-allocation]")!.textContent).toBe("Planned spending is $800.00 more than your planned income.");
  });

  it("keeps a category far over its plan inside the card: the over part ends where the scale ends", async () => {
    await render(
      props({
        budgetActuals: [line({ category: "Car upkeep", budget_group: "flexible", budgeted: "100.00", actual: "1340.00" }), line({ category: "Groceries", budget_group: "flexible", budgeted: "400.00", actual: "100.00" })],
      }),
    );
    expect(rows()[0]).toContain("Car upkeep");
    expect(rows()[0]).toContain("$1,340.00 of $100.00");
    expect(rows()[0]).toContain("$1,240.00 over");
    const over = card().querySelector<HTMLElement>(".category-bars-over")!;
    expect(parseFloat(over.style.left) + parseFloat(over.style.width)).toBeLessThanOrEqual(100.001);
    for (const el of card().querySelectorAll<HTMLElement>(".category-bars-fill, .category-bars-plan")) expect(parseFloat(el.style.width)).toBeLessThanOrEqual(100);
  });

  it("shows eight rows and counts the rest in words", async () => {
    const many = Array.from({ length: 10 }, (_, i) => line({ category: `Cat${i}`, budget_group: "flexible", budgeted: `${100 + i}.00`, actual: "10.00" }));
    await render(props({ budgetActuals: many }));
    expect(rows()).toHaveLength(8);
    const more = card().querySelector<HTMLElement>("[data-plan-more]")!;
    expect(more.textContent).toBe("2 more categories: $20.00 spent of $201.00 planned.");
  });

  it("opens a category's transactions when its name is clicked", async () => {
    const onCategoryClick = vi.fn();
    await render(props({ onCategoryClick }));
    const name = [...card().querySelectorAll<HTMLButtonElement>(".category-bars-select")].find((b) => b.textContent!.includes("Insurance"))!;
    act(() => name.click());
    expect(onCategoryClick).toHaveBeenCalledWith("Insurance");
  });

  it("sums the net from the budget totals, which can differ from Cash Flow when rows are excluded", async () => {
    await render(props({ budgetTotals: { income: "4000.00", expense: "900.00" } }));
    const note = card().querySelector<HTMLElement>("[data-budget-summary-note]")!;
    expect(note.textContent).toContain("$4,000.00 recorded income − $900.00 recorded spending");
  });

  it("says so in words when the month has no budget", async () => {
    await render(props({ budgetActuals: [], budgetTotals: { income: "0.00", expense: "0.00" } }));
    expect(card().textContent).toContain("Nothing is planned for spending in March 2026 yet.");
    expect(card().querySelector(".category-bars")).toBeNull();
    expect(card().querySelector("[data-plan-total]")).toBeNull();
    expect(card().querySelector("[data-allocation]")).toBeNull();
    expect(container.textContent).toContain("No budget lines yet.");
  });

  it("hides every figure, and keeps amounts out of every attribute", async () => {
    await render(props({ amountsHidden: true }));
    const stop = startPrivacyMask(container);
    try {
      expect(card().textContent).not.toMatch(/\$\s?\d/);
      expect(card().textContent).toContain("••••");
    } finally {
      stop();
    }
    noAmountInAttributes(card());
  });

  it("names the month and how much of it has gone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 15, 12));
    try {
      await render(props());
      expect(card().querySelector(".budget-plan-sub")!.textContent).toBe("March 2026, 48% of the month gone");
    } finally {
      vi.useRealTimers();
    }
    await render(props({ month: 4, monthLabel: "April 2026" }));
    expect(card().querySelector(".budget-plan-sub")!.textContent).toBe("April 2026");
  });
});

describe("BudgetView groups", () => {
  it("drops the group tiles and puts progress in each heading", async () => {
    await render(props());
    expect(container.querySelector(".group-cards")).toBeNull();
    const heads = [...container.querySelectorAll<HTMLElement>(".budget-group-head")];
    const fixed = heads.find((h) => h.textContent?.includes("Fixed"))!;
    expect(fixed.textContent).toContain("$1,690.00 of $1,720.00");
    expect(fixed.textContent).not.toContain("98% used");
    expect(fixed.querySelector(".progress-track")).toBeNull();
    const income = heads.find((h) => h.textContent?.includes("Income"))!;
    expect(income.textContent).toContain("$5,000.00 of $5,200.00");
  });

  it("labels each group's columns once, and the rows carry no trailing words", async () => {
    await render(props());
    const lists = [...container.querySelectorAll<HTMLElement>(".cat-list")];
    expect(lists).toHaveLength(2);
    for (const list of lists) {
      const heads = list.querySelectorAll(".cat-list-head");
      expect(heads).toHaveLength(1);
      const head = heads[0].textContent ?? "";
      expect(head).toContain("Category");
      expect(head).toContain("Planned");
      const isIncome = list.closest("[data-budget-group]")?.getAttribute("data-budget-group") === "income";
      if (isIncome) {
        expect(head).toContain("Received");
        expect(head).toContain("Still expected");
      } else {
        expect(head.match(/Planned/g)).toHaveLength(1);
        expect(head.match(/Spent/g)).toHaveLength(1);
        expect(head.match(/Left/g)).toHaveLength(1);
      }
    }
    for (const row of container.querySelectorAll<HTMLElement>(".cat-row")) {
      expect(row.textContent).not.toMatch(/\b(budget|actual|left|diff)\b/i);
    }
    const mortgage = rowFor("Mortgage");
    const amounts = [...mortgage.querySelectorAll(".cat-amt")].map((c) => c.textContent?.trim());
    expect(amounts).toEqual(["", "$1,600.00", "$0.00"]);
    const insurance = rowFor("Insurance");
    expect([...insurance.querySelectorAll(".cat-amt")].map((c) => c.textContent?.trim())).toEqual(["", "$90.00", "$30.00"]);
  });

  it("marks a Left figure below zero", async () => {
    await render(props({ budgetActuals: [line({ category: "Mortgage", actual: "1700.00" })] }));
    const left = [...rowFor("Mortgage").querySelectorAll(".cat-amt")][2];
    expect(left.textContent).toBe("-$100.00");
    expect(left.classList.contains("neg")).toBe(true);
  });
});

describe("BudgetRow budget field", () => {
  it("shows an always-visible budget field with the amount", async () => {
    await render(props());
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Budget for Mortgage"]')!;
    expect(input).not.toBeNull();
    expect(input.value).toBe("1600.00");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(input.classList.contains("budget-amount-input")).toBe(true);
  });

  it("saves a typed amount on blur, and once on Enter", async () => {
    const p = props();
    await render(p);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Budget for Mortgage"]')!;
    act(() => {
      input.focus();
      setInputValue(input, "1650");
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    act(() => input.blur());
    expect(p.onSetBudget).toHaveBeenCalledTimes(1);
    expect(p.onSetBudget).toHaveBeenCalledWith("Mortgage", "1650", "fixed");

    const other = container.querySelector<HTMLInputElement>('input[aria-label="Budget for Insurance"]')!;
    act(() => {
      other.focus();
      setInputValue(other, "125.50");
    });
    await act(async () => { other.blur(); });
    expect(p.onSetBudget).toHaveBeenLastCalledWith("Insurance", "125.50", "fixed");
  });

  it("doesn't save an unchanged or empty field, and Escape puts the amount back", async () => {
    const p = props();
    await render(p);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Budget for Mortgage"]')!;
    act(() => input.focus());
    act(() => input.blur());
    act(() => {
      input.focus();
      setInputValue(input, "");
    });
    act(() => input.blur());
    expect(input.value).toBe("1600.00");
    act(() => {
      input.focus();
      setInputValue(input, "99");
    });
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(input.value).toBe("1600.00");
    act(() => input.blur());
    expect(p.onSetBudget).not.toHaveBeenCalled();
  });

  it("follows a new amount from outside", async () => {
    const p = props();
    await render(p);
    await render({ ...p, budgetActuals: [line({ category: "Mortgage", budgeted: "1700.00" })] });
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Budget for Mortgage"]')!.value).toBe("1700.00");
  });

  it("shows a stored whole amount with two decimals, and doesn't count that as a change", async () => {
    const p = props({ budgetActuals: [line({ category: "Mortgage", budgeted: "250" })] });
    await render(p);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Budget for Mortgage"]')!;
    expect(input.value).toBe("250.00");
    act(() => input.focus());
    act(() => input.blur());
    expect(p.onSetBudget).not.toHaveBeenCalled();
  });

  it("puts the saved amount back when a save is turned down", async () => {
    const p = props({ onSetBudget: vi.fn(async () => {}) });
    await render(p);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Budget for Mortgage"]')!;
    act(() => {
      input.focus();
      setInputValue(input, "abc");
    });
    await act(async () => input.blur());
    expect(p.onSetBudget).toHaveBeenCalledWith("Mortgage", "abc", "fixed");
    expect(input.value).toBe("1600.00");
  });

  it("settles a save that rejects or throws: no unhandled rejection, and the saved amount comes back", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      for (const onSetBudget of [vi.fn(() => Promise.reject(new Error("refused"))), vi.fn(() => { throw new Error("refused"); })]) {
        await render(props({ onSetBudget }));
        const input = container.querySelector<HTMLInputElement>('input[aria-label="Budget for Mortgage"]')!;
        act(() => {
          input.focus();
          setInputValue(input, "1650");
        });
        await act(async () => input.blur());
        await act(async () => new Promise((r) => setTimeout(r, 0)));
        expect(onSetBudget).toHaveBeenCalledWith("Mortgage", "1650", "fixed");
        expect(input.value).toBe("1600.00");
        // A move to another group goes through the same guard.
        choose(rowFor("Mortgage"), "Move to Flexible");
        await act(async () => new Promise((r) => setTimeout(r, 0)));
        expect(onSetBudget).toHaveBeenLastCalledWith("Mortgage", "1600.00", "flexible");
      }
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("only drags the row from its handle, so selecting text in the budget field can't start a drag", async () => {
    await render(props());
    const row = rowFor("Mortgage");
    expect(row.getAttribute("draggable")).toBe("false");
    // A drag that starts anywhere else (say, a mouse selection in the field) is refused.
    const input = row.querySelector<HTMLInputElement>("input")!;
    act(() => input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(row.getAttribute("draggable")).toBe("false");
    const stray = new Event("dragstart", { bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(stray);
    });
    expect(stray.defaultPrevented).toBe(true);
    // Pressing the ⠿ handle makes the row draggable until the mouse is let go.
    act(() => row.querySelector(".drag-handle")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(row.getAttribute("draggable")).toBe("true");
    act(() => window.dispatchEvent(new MouseEvent("mouseup")));
    expect(row.getAttribute("draggable")).toBe("false");
  });

  it("with amounts hidden, shows a maskable button instead of a field until clicked", async () => {
    const p = props({ amountsHidden: true });
    await render(p);
    const row = rowFor("Mortgage");
    expect(row.querySelector("input")).toBeNull();
    const button = row.querySelector<HTMLButtonElement>("button.amount-editable")!;
    expect(button).not.toBeNull();
    expect(button.textContent).toBe("$1,600.00");
    // Its name says what it does without repeating the hidden figure.
    expect(button.getAttribute("aria-label")).toBe("Change the budget for Mortgage");
    act(() => button.click());
    const input = row.querySelector<HTMLInputElement>("input")!;
    expect(input).not.toBeNull();
    expect(input.value).toBe("1600.00");
    act(() => setInputValue(input, "1500"));
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(p.onSetBudget).toHaveBeenCalledWith("Mortgage", "1500", "fixed");
    expect(row.querySelector("input")).toBeNull();
  });
});

describe("BudgetRow settings menu", () => {
  it("has one menu per row with the settings, moves, reorder and delete", async () => {
    await render(props());
    const row = rowFor("Mortgage");
    expect(row.querySelectorAll("[data-row-menu]")).toHaveLength(1);
    expect(row.querySelector("[data-row-menu]")!.getAttribute("aria-label")).toBe("Settings for Mortgage");
    const panel = openMenu(row);
    expect(menuLabels(panel)).toEqual([
      "Roll over unspent",
      "Warn at 90%",
      "Move to Income",
      "Move to Flexible",
      "Move to Non-Monthly",
      "Move up",
      "Move down",
      "Delete",
    ]);
    expect(menuItem(panel, "Roll over unspent").getAttribute("role")).toBe("menuitemcheckbox");
    expect(menuItem(panel, "Warn at 90%").getAttribute("role")).toBe("menuitemcheckbox");
    expect(menuItem(panel, "Move up").getAttribute("aria-disabled")).toBe("true");
    expect(menuItem(panel, "Move down").getAttribute("aria-disabled")).toBeNull();
    expect(menuItem(panel, "Delete").classList.contains("row-menu-item-danger")).toBe(true);
    expect(container.querySelector(".cat-row-move-buttons")).toBeNull();
    expect(container.querySelector(".budget-cap-toggle")).toBeNull();
    expect(container.querySelector('[aria-label^="Budget group for"]')).toBeNull();
  });

  it("leaves the spending settings off an income row and off when the features are switched off", async () => {
    await render(props());
    const incomePanel = openMenu(rowFor("Paycheck"));
    expect(menuLabels(incomePanel)).toEqual(["Move to Fixed", "Move to Flexible", "Move to Non-Monthly", "Move up", "Move down", "Delete"]);
    // No stray divider at the top where the (absent) settings would be.
    expect(incomePanel.firstElementChild?.getAttribute("role")).not.toBe("separator");
    act(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await render(props({ rolloverEnabled: false, envelopeCapsEnabled: false }));
    const panel = openMenu(rowFor("Mortgage"));
    const labels = menuLabels(panel);
    expect(labels).not.toContain("Roll over unspent");
    expect(labels).not.toContain("Warn at 90%");
    expect(panel.firstElementChild?.getAttribute("role")).not.toBe("separator");
    expect(panel.lastElementChild?.getAttribute("role")).not.toBe("separator");
  });

  it("toggles roll over and the 90% warning, and moves a row to another group", async () => {
    const p = props();
    await render(p);
    choose(rowFor("Mortgage"), "Roll over unspent");
    expect(p.onSetRollover).toHaveBeenCalledWith("Mortgage", true);
    choose(rowFor("Mortgage"), "Warn at 90%");
    expect(p.onSetCap).toHaveBeenCalledWith("Mortgage", true);
    choose(rowFor("Insurance"), "Move to Flexible");
    expect(p.onSetBudget).toHaveBeenCalledWith("Insurance", "120.00", "flexible");
  });

  it("shows muted markers for what is switched on", async () => {
    await render(
      props({
        budgetActuals: [line({ category: "Mortgage", rollover_enabled: true, cap_enabled: true }), line({ category: "Insurance", budgeted: "120.00", actual: "90.00" })],
      }),
    );
    const marker = rowFor("Mortgage").querySelector<HTMLElement>("[data-rollover-marker]")!;
    expect(marker.textContent).toBe("Rolls over");
    expect(rowFor("Mortgage").querySelector("[data-cap-marker]")?.textContent).toBe("Warns at 90%");
    expect(rowFor("Insurance").querySelector("[data-rollover-marker]")).toBeNull();
    expect(rowFor("Insurance").querySelector("[data-cap-marker]")).toBeNull();
    const panel = openMenu(rowFor("Mortgage"));
    expect(menuItem(panel, "Roll over unspent").getAttribute("aria-checked")).toBe("true");
    expect(menuItem(panel, "Warn at 90%").getAttribute("aria-checked")).toBe("true");
  });

  it("hides the markers while the matching feature is off in Settings", async () => {
    await render(
      props({
        rolloverEnabled: false,
        envelopeCapsEnabled: false,
        budgetActuals: [line({ category: "Mortgage", rollover_enabled: true, cap_enabled: true })],
      }),
    );
    expect(rowFor("Mortgage").querySelector("[data-rollover-marker]")).toBeNull();
    expect(rowFor("Mortgage").querySelector("[data-cap-marker]")).toBeNull();
  });

  it("reorders within the group from the menu", async () => {
    await render(props());
    choose(rowFor("Mortgage"), "Move down");
    const names = [...container.querySelectorAll('[data-budget-group="fixed"] .category-link')].map((n) => n.textContent);
    expect(names).toEqual(["Insurance", "Mortgage"]);
  });

  it("Delete swaps the menu for an inline confirm, and Cancel puts the menu back with focus", async () => {
    const p = props();
    await render(p);
    choose(rowFor("Mortgage"), "Delete");
    const row = rowFor("Mortgage");
    expect(row.querySelector("[data-row-menu]")).toBeNull();
    const cancel = [...row.querySelectorAll<HTMLButtonElement>(".row-delete-confirm button")].find((b) => b.textContent === "Cancel")!;
    expect(document.activeElement).toBe(cancel);
    act(() => cancel.click());
    expect(document.activeElement).toBe(rowFor("Mortgage").querySelector("[data-row-menu]"));

    choose(rowFor("Mortgage"), "Delete");
    const del = [...rowFor("Mortgage").querySelectorAll<HTMLButtonElement>(".row-delete-confirm button")].find((b) => b.textContent === "Delete")!;
    act(() => del.click());
    expect(p.onDeleteBudget).toHaveBeenCalledWith("Mortgage");
  });
});

// s4: red only for what needs you. Income that hasn't arrived yet early in the month, and a
// negative "money left" before the month is over, are normal and stay neutral.
describe("BudgetView colours", () => {
  const rowFill = (category: string) => rowFor(category).querySelector<HTMLElement>(".cat-row-bar .progress-fill")!;
  const lowIncome = [
    line({ category: "Mortgage" }),
    line({ category: "Paycheck", budget_group: "income", budgeted: "5000.00", actual: "1500.00" }),
  ];

  afterEach(() => {
    vi.useRealTimers();
  });

  function today(y: number, m: number, d: number) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(y, m - 1, d, 12));
  }

  it("keeps early-month income neutral in the current month (4 October, 30% in)", async () => {
    today(2026, 10, 4);
    await render(props({ budgetActuals: lowIncome, year: 2026, month: 10, monthLabel: "October 2026" }));
    expect(rowFill("Paycheck").className).toBe("progress-fill neutral");
    // The shortfall is shown as it is, but not in red.
    const diff = [...rowFor("Paycheck").querySelectorAll(".cat-amt")][2];
    expect(diff.textContent).toBe("$3,500.00");
    expect(diff.classList.contains("neg")).toBe(false);
  });

  it("warns late in the current month when under 80% of income is in", async () => {
    today(2026, 10, 28);
    await render(props({ budgetActuals: lowIncome, year: 2026, month: 10, monthLabel: "October 2026" }));
    expect(rowFill("Paycheck").className).toBe("progress-fill warn");
  });

  it("warns about a past month whose income fell short, never in red", async () => {
    today(2026, 10, 4);
    await render(props()); // March 2026: $5,000 of $5,200 received
    expect(rowFill("Paycheck").className).toBe("progress-fill warn");
    expect(container.querySelector("[data-budget-group='income'] .progress-fill.over")).toBeNull();
  });

  it("uses the normal fill once the income is in", async () => {
    today(2026, 10, 4);
    await render(
      props({
        budgetActuals: [line({ category: "Paycheck", budget_group: "income", budgeted: "5000.00", actual: "5000.00" })],
        year: 2026,
        month: 10,
      }),
    );
    expect(rowFill("Paycheck").className).toBe("progress-fill");
  });

  it("keeps expense rows red only past 100%", async () => {
    today(2026, 10, 4);
    await render(
      props({
        budgetAlerts: [{category: "Mortgage", level: "warning"}, {category: "Groceries", level: "over"}] as Props["budgetAlerts"],
        budgetActuals: [
          line({ category: "Mortgage", budgeted: "1000.00", actual: "900.00" }),
          line({ category: "Groceries", budget_group: "flexible", budgeted: "100.00", actual: "120.00" }),
        ],
        year: 2026,
        month: 10,
      }),
    );
    const fill = (g: string) => container.querySelector<HTMLElement>(`[data-budget-group='${g}'] .cat-row-bar .progress-fill`)!;
    expect(fill("fixed").className).toBe("progress-fill warn");
    expect(fill("flexible").className).toBe("progress-fill over");
  });

  it("doesn't colour a negative money-left figure before the month is over", async () => {
    today(2026, 10, 4);
    await render(
      props({
        budgetActuals: lowIncome.map((l) => (l.budget_group === "income" ? { ...l, budgeted: "1000.00" } : l)),
        budgetTotals: { income: "1500.00", expense: "1601.56" },
        year: 2026,
        month: 10,
      }),
    );
    const planned = container.querySelector<HTMLElement>("[data-planned-net]")!;
    const actual = container.querySelector<HTMLElement>("[data-actual-net]")!;
    expect(planned.textContent).toBe("-$600.00");
    expect(actual.textContent).toBe("-$101.56");
    expect(planned.classList.contains("report-over-budget")).toBe(false);
    expect(actual.classList.contains("report-over-budget")).toBe(false);
  });

  it("colours a negative money-left figure once the month is over", async () => {
    today(2026, 10, 4);
    await render(
      props({
        budgetActuals: lowIncome.map((l) => (l.budget_group === "income" ? { ...l, budgeted: "1000.00" } : l)),
        budgetTotals: { income: "1500.00", expense: "1601.56" },
      }),
    );
    expect(container.querySelector("[data-planned-net]")!.classList.contains("report-over-budget")).toBe(true);
    expect(container.querySelector("[data-actual-net]")!.classList.contains("report-over-budget")).toBe(true);
  });

  it("calls a budget used exactly in full 'All used', in a neutral badge", async () => {
    await render(
      props({
        budgetActuals: [line({ category: "Groceries", budget_group: "flexible", budgeted: "400.00", actual: "400.00" })],
        budgetAlerts: [
          { category: "Groceries", budget_group: "flexible", budgeted: "400.00", actual: "400.00", pct: "100", level: "warning", cap_enabled: false },
        ],
      }),
    );
    const badge = rowFor("Groceries").querySelector<HTMLElement>(".budget-alert-badge")!;
    expect(badge.textContent).toBe("All used");
    expect(badge.className).toBe("budget-alert-badge budget-alert-done");
    expect(rowFill("Groceries").className).toBe("progress-fill");
  });

  it("still marks a budget close to its limit, and one over it", async () => {
    await render(
      props({
        budgetActuals: [
          line({ category: "Groceries", budget_group: "flexible", budgeted: "400.00", actual: "360.00" }),
          line({ category: "Dining", budget_group: "flexible", budgeted: "100.00", actual: "150.00" }),
        ],
        budgetAlerts: [
          { category: "Groceries", budget_group: "flexible", budgeted: "400.00", actual: "360.00", pct: "90", level: "warning", cap_enabled: false },
          { category: "Dining", budget_group: "flexible", budgeted: "100.00", actual: "150.00", pct: "150", level: "over", cap_enabled: false },
        ],
      }),
    );
    expect(rowFor("Groceries").querySelector(".budget-alert-badge")!.className).toBe("budget-alert-badge budget-alert-warning");
    expect(rowFill("Groceries").className).toBe("progress-fill warn");
    expect(rowFor("Dining").querySelector(".budget-alert-badge")!.className).toBe("budget-alert-badge budget-alert-over");
    expect(rowFill("Dining").className).toBe("progress-fill over");
  });

  it("counts rollover when deciding a budget is used in full, as the Dashboard banner does", async () => {
    await render(
      props({
        budgetActuals: [
          line({ category: "Gifts", budget_group: "flexible", budgeted: "300.10", rollover: "99.90", actual: "400.00", rollover_enabled: true }),
          line({ category: "Pets", budget_group: "flexible", budgeted: "400.00", rollover: "100.00", actual: "400.00", rollover_enabled: true }),
        ],
        budgetAlerts: [
          { category: "Gifts", budget_group: "flexible", budgeted: "400.00", actual: "400.00", pct: "100", level: "warning", cap_enabled: false },
          { category: "Pets", budget_group: "flexible", budgeted: "500.00", actual: "400.00", pct: "80", level: "warning", cap_enabled: false },
        ],
      }),
    );
    expect(rowFor("Gifts").querySelector(".budget-alert-badge")!.textContent).toBe("All used");
    expect(rowFor("Gifts").querySelector(".budget-alert-badge")!.className).toBe("budget-alert-badge budget-alert-done");
    expect(rowFor("Pets").querySelector(".budget-alert-badge")!.textContent).toBe("Close to limit");
    expect(rowFor("Pets").querySelector(".budget-alert-badge")!.className).toBe("budget-alert-badge budget-alert-warning");
  });
});


describe("v9 group cards", () => {
  it("shows planned/actual/left/progress columns, text totals and no group bar", async () => {
    await render(props({ budgetActuals: [line({}), line({ category: "Pay", budget_group: "income", budgeted: "5000", actual: "1000" }), line({category: "Food", budget_group: "flexible"}), line({category: "Car", budget_group: "nonmonthly"})] }));
    expect([...container.querySelectorAll('.budget-group h2')].map(e => e.textContent)).toEqual(["Income", "Fixed", "Flexible", "Non-monthly (saved for over time)"]);
    expect([...container.querySelector('[data-budget-group="income"] .cat-list-head')!.children].map(e => e.textContent)).toEqual(["Category", "Planned", "Received", "Still expected", "Progress", "Settings"]);
    expect(rowFor("Pay").querySelector('[data-label="Still expected"]')?.textContent).toContain("$4,000.00");
    expect(container.querySelector('.budget-group-track')).toBeNull();
    expect(container.querySelector('[data-budget-group="fixed"] [data-group-progress]')?.textContent).toBe("$1,600.00 of $1,600.00");
  });
  it("shows All used, Close to limit and ! Over beneath names while retaining row bars", async () => {
    await render(props({ budgetActuals: [line({}), line({category: "Near", actual: "1450"}), line({category: "Past", actual: "1700"})], budgetAlerts: [{category: "Mortgage", level: "warning"}, {category: "Near", level: "warning"}, {category: "Past", level: "over"}] as Props["budgetAlerts"] }));
    expect(rowFor("Mortgage").textContent).toContain("All used");
    expect(rowFor("Near").textContent).toContain("Close to limit");
    expect(rowFor("Past").textContent).toContain("! Over");
    expect(container.querySelectorAll('.cat-row-bar')).toHaveLength(3);
  });
});

describe("Add budget line says what is missing (VS-49)", () => {
  const form = () => container.querySelector<HTMLFormElement>(".bucket-new-form")!;
  const note = () => form().querySelector("[data-budget-line-missing]")?.textContent ?? null;
  const amountBox = () => form().querySelector<HTMLInputElement>('input[placeholder="Monthly amount"]')!;
  const save = () => [...form().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save")!;
  const open = async (p: Props) => {
    await render(p);
    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Add budget line")!.click());
  };

  it("names the amount, then the comma, and saves once it is usable", async () => {
    const p = props();
    await open(p);
    expect(save().disabled).toBe(true);
    expect(note()).toBe("Enter a monthly amount.");
    act(() => setInputValue(amountBox(), "1,250.40"));
    expect(note()).toBe("Leave out the comma: 1250.40");
    expect(amountBox().getAttribute("aria-invalid")).toBe("true");
    expect(save().disabled).toBe(true);
    act(() => form().requestSubmit());
    expect(p.onSetBudget).not.toHaveBeenCalled();
    act(() => setInputValue(amountBox(), "1250.40"));
    expect(note()).toBeNull();
    expect(amountBox().getAttribute("aria-invalid")).not.toBe("true");
    expect(save().disabled).toBe(false);
    act(() => save().click());
    expect(p.onSetBudget).toHaveBeenCalled();
  });
});
