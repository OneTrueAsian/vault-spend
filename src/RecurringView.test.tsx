// @vitest-environment jsdom
//
// Recurring page (s10): two totals (bills and income) with the yearly figure as small text under
// each, instead of four equal tiles; cadence written the way people say it ("Yearly", "Every 2
// weeks") everywhere it shows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { RecurringView } from "./RecurringView";
import type { Recurring } from "./types";

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
