// @vitest-environment jsdom
//
// Recurring page (s10): two totals (bills and income) with the yearly figure as small text under
// each, instead of four equal tiles; cadence written the way people say it ("Yearly", "Every 2
// weeks") everywhere it shows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { RecurringView, projectOccurrencesInMonth } from "./RecurringView";
import type { Recurring } from "../../shared/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function item(over: Partial<Recurring>): Recurring {
  return {
    id: 1,
    merchant: "Iron Works Gym",
    category: null,
    amount: "-45.00",
    cadence: "monthly",
    anchor_date: "2026-10-01",
    next_date: "2099-11-01",
    account_id: null,
    account_name: null,
    member_id: null,
    member_name: null,
    status: "keep",
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
});

function render(over: Partial<ComponentProps<typeof RecurringView>> = {}) {
  const props: ComponentProps<typeof RecurringView> = {
    recurring: [],
    matches: [],
    totals: { monthly_expense: "3321.00", annual_expense: "39852.00", monthly_income: "2450.00", annual_income: "29400.00" },
    candidates: [],
    accounts: [],
    familyMembers: [],
    categoryIconMap: {},
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onSetStatus: vi.fn(),
    onAddCandidate: vi.fn(),
    onDismissCandidate: vi.fn(),
    onIgnorePriceChange: vi.fn(async () => {}),
    ...over,
  };
  act(() => root.render(<RecurringView {...props} />));
  return props;
}

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("RecurringView totals", () => {
  it("shows two neutral tiles, a month in large text and the year in small text", () => {
    render();
    const tiles = [...container.querySelectorAll(".stats .stat")];
    expect(tiles).toHaveLength(2);
    const [bills, income] = tiles;
    for (const tile of tiles) expect(tile.classList.contains("tint-neutral")).toBe(true);

    expect(text(bills.querySelector(".stat-label"))).toBe("Bills");
    expect(text(bills.querySelector(".stat-value"))).toBe("$3,321.00 a month");
    expect(text(bills.querySelector(".stat-sub"))).toBe("$39,852.00 a year");

    expect(text(income.querySelector(".stat-label"))).toBe("Income");
    expect(text(income.querySelector(".stat-value"))).toBe("$2,450.00 a month");
    expect(text(income.querySelector(".stat-sub"))).toBe("$29,400.00 a year · estimate");
  });

  it("puts each tile's label before its value", () => {
    render();
    const first = container.querySelector(".stats .stat")!;
    const children = [...first.children].map((c) => c.className);
    expect(children.indexOf("stat-label")).toBeLessThan(children.findIndex((c) => c.startsWith("stat-value")));
  });
});

describe("RecurringView cadence labels", () => {
  it("writes cadences the way people say them, never as lowercase codes", () => {
    render({
      recurring: [
        item({ id: 1, cadence: "monthly" }),
        item({ id: 2, merchant: "Car insurance", cadence: "annual" }),
        item({ id: 3, merchant: "Payroll", amount: "1650.00", cadence: "biweekly" }),
      ],
    });
    const badges = [...container.querySelectorAll(".confidence-badge")].map((b) => text(b));
    expect(badges).toContain("Monthly");
    expect(badges).toContain("Yearly");
    expect(badges).toContain("Every 2 weeks");
    for (const b of badges) expect(b).not.toMatch(/^(weekly|biweekly|monthly|annual)$/);
  });

  it("writes a suggestion's cadence the same way", () => {
    render({
      candidates: [{ merchant: "Hulu", category: null, amount: "-17.99", cadence: "biweekly", anchor_date: "2026-09-01", occurrence_count: 4 }],
    });
    expect(text(container.querySelector(".suggested-row"))).toContain("Every 2 weeks · seen 4 times");
  });
});

describe("RecurringView edit row date", () => {
  const editRow = () => {
    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Edit")!.click());
    return container.querySelector<HTMLElement>("tr:has(.row-edit-input)")!;
  };
  const typeInto = (input: HTMLInputElement, text: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const save = (row: HTMLElement) => [...row.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save")!;

  it("will not save while the next due date is half typed, instead of saving the old date", () => {
    const props = render({ recurring: [item({ anchor_date: "2026-10-01" })] });
    const row = editRow();
    const box = row.querySelector<HTMLInputElement>("input.date-field-input")!;
    expect(box.value).toBe("10/01/2026");
    typeInto(box, "10/1");
    expect(save(row).disabled).toBe(true);
    act(() => save(row).click());
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("saves the new date once it is complete", () => {
    const props = render({ recurring: [item({ anchor_date: "2026-10-01" })] });
    const row = editRow();
    const box = row.querySelector<HTMLInputElement>("input.date-field-input")!;
    typeInto(box, "10/1");
    typeInto(box, "10/15/2026");
    expect(save(row).disabled).toBe(false);
    act(() => save(row).click());
    expect(props.onUpdate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onUpdate).mock.calls[0][5]).toBe("2026-10-15");
  });
});

describe("RecurringView calendar projection", () => {
  it("keeps a monthly item on its original day after a short month", () => {
    const item = { anchor_date: "2026-01-31", cadence: "monthly" };
    expect(projectOccurrencesInMonth(item, 2026, 2)).toEqual(["2026-02-28"]);
    expect(projectOccurrencesInMonth(item, 2026, 3)).toEqual(["2026-03-31"]);
    expect(projectOccurrencesInMonth(item, 2026, 4)).toEqual(["2026-04-30"]);
    expect(projectOccurrencesInMonth(item, 2026, 5)).toEqual(["2026-05-31"]);
    expect(projectOccurrencesInMonth(item, 2028, 2)).toEqual(["2028-02-29"]);
    expect(projectOccurrencesInMonth(item, 2028, 3)).toEqual(["2028-03-31"]);
  });

  it("returns a yearly 29 February item to the 29th in the next leap year", () => {
    const item = { anchor_date: "2024-02-29", cadence: "annual" };
    expect(projectOccurrencesInMonth(item, 2025, 2)).toEqual(["2025-02-28"]);
    expect(projectOccurrencesInMonth(item, 2027, 2)).toEqual(["2027-02-28"]);
    expect(projectOccurrencesInMonth(item, 2028, 2)).toEqual(["2028-02-29"]);
    expect(projectOccurrencesInMonth(item, 2028, 3)).toEqual([]);
  });

  it("still lands weekly and every-2-weeks items on their usual dates", () => {
    expect(projectOccurrencesInMonth({ anchor_date: "2026-11-02", cadence: "weekly" }, 2026, 11)).toEqual([
      "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30",
    ]);
    expect(projectOccurrencesInMonth({ anchor_date: "2026-11-02", cadence: "biweekly" }, 2026, 12)).toEqual(["2026-12-14", "2026-12-28"]);
  });

  it("shows nothing before the first due date", () => {
    expect(projectOccurrencesInMonth({ anchor_date: "2026-11-15", cadence: "monthly" }, 2026, 10)).toEqual([]);
  });
});
