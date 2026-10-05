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
import type { CashFlow, ReportBudgetLine } from "./types";

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

const monthFlow: CashFlow = {
  months: [],
  top_categories: [],
  top_merchants: [],
  total_income: "5000.00",
  total_expense: "1690.00",
};

type Props = ComponentProps<typeof BudgetView>;

function props(over: Partial<Props> = {}): Props {
  return {
    categories: ["Mortgage", "Insurance", "Paycheck", "Groceries"],
    budgetActuals: [
      line({ category: "Mortgage" }),
      line({ category: "Insurance", budgeted: "120.00", actual: "90.00" }),
      line({ category: "Paycheck", budget_group: "income", budgeted: "5200.00", actual: "5000.00" }),
    ],
    monthFlow,
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

describe("BudgetView summary", () => {
  it("shows one summary strip with all four totals and keeps both money-left figures", async () => {
    await render(props());
    const strips = container.querySelectorAll("[data-budget-summary]");
    expect(strips).toHaveLength(1);
    const strip = strips[0] as HTMLElement;
    for (const label of ["Planned spending", "Spent so far", "Left to spend", "Money left after income"]) {
      expect(strip.textContent).toContain(label);
    }
    expect(strip.querySelector("[data-planned-net]")?.textContent).toBe("$3,480.00");
    expect(strip.querySelector("[data-actual-net]")?.textContent).toBe("$3,310.00");
    expect(strip.textContent).toContain("$1,720.00");
    expect(strip.textContent).toContain("$1,690.00");
    expect(strip.textContent).toContain("$30.00");
    // The old second block of stat cards and the separate net card are gone.
    expect(container.querySelector("[data-budget-net-summary]")).toBeNull();
    expect(container.querySelectorAll(".stats")).toHaveLength(0);
  });

  it("keeps the income-minus-spending breakdown as a tooltip and a small line", async () => {
    await render(props());
    const strip = container.querySelector<HTMLElement>("[data-budget-summary]")!;
    const netCell = strip.querySelector("[data-planned-net]")!.closest<HTMLElement>("[title]")!;
    expect(netCell.title).toContain("$5,200.00 budgeted income − $1,720.00 budgeted spending");
    expect(netCell.title).toContain("$5,000.00 recorded income − $1,690.00 recorded spending");
    const note = strip.querySelector<HTMLElement>("[data-budget-summary-note]")!;
    expect(note.textContent).toContain("$5,200.00 budgeted income − $1,720.00 budgeted spending");
    expect(note.textContent).toContain("$5,000.00 recorded income − $1,690.00 recorded spending");
  });

  it("puts the income allocation note inside the summary as its last line", async () => {
    await render(props());
    const strip = container.querySelector<HTMLElement>("[data-budget-summary]")!;
    const allocation = strip.querySelector("[data-allocation]");
    expect(allocation).not.toBeNull();
    expect(strip.lastElementChild).toBe(allocation);
  });
});

describe("BudgetView groups", () => {
  it("drops the group tiles and puts progress in each heading", async () => {
    await render(props());
    expect(container.querySelector(".group-cards")).toBeNull();
    const heads = [...container.querySelectorAll<HTMLElement>(".budget-group-head")];
    const fixed = heads.find((h) => h.textContent?.includes("Fixed"))!;
    expect(fixed.textContent).toContain("$1,690.00 of $1,720.00");
    expect(fixed.textContent).toContain("98% used");
    expect(fixed.querySelector(".progress-track")).not.toBeNull();
    const income = heads.find((h) => h.textContent?.includes("Income"))!;
    expect(income.textContent).toContain("$5,000.00 of $5,200.00 received");
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
      expect(head).toContain("Budget");
      const isIncome = list.closest("[data-budget-group]")?.getAttribute("data-budget-group") === "income";
      if (isIncome) {
        expect(head).toContain("Received");
        expect(head).toContain("Difference");
      } else {
        expect(head.match(/Budget/g)).toHaveLength(1);
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
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    act(() => input.blur());
    expect(p.onSetBudget).toHaveBeenCalledTimes(1);
    expect(p.onSetBudget).toHaveBeenCalledWith("Mortgage", "1650", "fixed");

    const other = container.querySelector<HTMLInputElement>('input[aria-label="Budget for Insurance"]')!;
    act(() => {
      other.focus();
      setInputValue(other, "125.50");
    });
    act(() => other.blur());
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
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
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
      "Delete…",
    ]);
    expect(menuItem(panel, "Roll over unspent").getAttribute("role")).toBe("menuitemcheckbox");
    expect(menuItem(panel, "Warn at 90%").getAttribute("role")).toBe("menuitemcheckbox");
    expect(menuItem(panel, "Move up").getAttribute("aria-disabled")).toBe("true");
    expect(menuItem(panel, "Move down").getAttribute("aria-disabled")).toBeNull();
    expect(menuItem(panel, "Delete…").classList.contains("row-menu-item-danger")).toBe(true);
    expect(container.querySelector(".cat-row-move-buttons")).toBeNull();
    expect(container.querySelector(".budget-cap-toggle")).toBeNull();
    expect(container.querySelector('[aria-label^="Budget group for"]')).toBeNull();
  });

  it("leaves the spending settings off an income row and off when the features are switched off", async () => {
    await render(props());
    expect(menuLabels(openMenu(rowFor("Paycheck")))).toEqual(["Move to Fixed", "Move to Flexible", "Move to Non-Monthly", "Move up", "Move down", "Delete…"]);
    act(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await render(props({ rolloverEnabled: false, envelopeCapsEnabled: false }));
    const labels = menuLabels(openMenu(rowFor("Mortgage")));
    expect(labels).not.toContain("Roll over unspent");
    expect(labels).not.toContain("Warn at 90%");
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

  it("Delete… swaps the menu for an inline confirm, and Cancel puts the menu back with focus", async () => {
    const p = props();
    await render(p);
    choose(rowFor("Mortgage"), "Delete…");
    const row = rowFor("Mortgage");
    expect(row.querySelector("[data-row-menu]")).toBeNull();
    const cancel = [...row.querySelectorAll<HTMLButtonElement>(".row-delete-confirm button")].find((b) => b.textContent === "Cancel")!;
    expect(document.activeElement).toBe(cancel);
    act(() => cancel.click());
    expect(document.activeElement).toBe(rowFor("Mortgage").querySelector("[data-row-menu]"));

    choose(rowFor("Mortgage"), "Delete…");
    const del = [...rowFor("Mortgage").querySelectorAll<HTMLButtonElement>(".row-delete-confirm button")].find((b) => b.textContent === "Delete")!;
    act(() => del.click());
    expect(p.onDeleteBudget).toHaveBeenCalledWith("Mortgage");
  });
});
