// @vitest-environment jsdom
//
// Household "Spending by person" (VS-31 step 2, stream H): the old list becomes v9's stacked chart (one row per person and Shared,
// stacked by category, a tick for what each person earned), and Budget by person lists spending categories only.
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HouseholdView } from "./HouseholdView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof HouseholdView>;
let host: HTMLDivElement;
let root: Root;
let props: Props;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    transactions: [],
    accounts: [],
    assets: [],
    familyMembers: [{ id: 1, name: "Alex" }, { id: 2, name: "Sam" }],
    memberBudgetActuals: [],
    monthLabel: "November 2026",
    year: 2026,
    month: 11,
    onPrevMonth: vi.fn(),
    onNextMonth: vi.fn(),
    onManageMembers: vi.fn(),
    onRenameMember: vi.fn(),
    onRemoveMember: vi.fn(),
    onSetYear: vi.fn(),
    onSetMonth: vi.fn(),
  };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const show = (over: Partial<Props> = {}) => act(() => root.render(<HouseholdView {...props} {...over} />));
const txn = (id: number, amount: string, member_id: number | null, category: string | null = "Groceries", over: Record<string, unknown> = {}) =>
  ({ id, date: "2026-11-10", description: `Purchase ${id}`, amount, member_id, member_name: member_id === 1 ? "Alex" : member_id === 2 ? "Sam" : null, category, account_id: 1, transfer_counterpart_id: null, ...over }) as Props["transactions"][number];
const checking = { id: 1, name: "Checking", account_type: "checking", current_balance: "0", starting_balance: "0", member_id: null, member_name: null } as unknown as Props["accounts"][number];
const card = () => [...host.querySelectorAll<HTMLElement>(".card")].find((c) => c.querySelector("h2")?.textContent === "Spending by person")!;
const labels = () => [...card().querySelectorAll(".stacked-rows-label")].map((e) => e.textContent);
const totals = () => [...card().querySelectorAll(".stacked-rows-total")].map((e) => e.textContent);
const hiddenRows = () => [...card().querySelectorAll(".sr-only tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent));

describe("Household Spending by person chart", () => {
  it("replaces the old list with a stacked row for each person and Shared, in that order, with the v9 subtitle", () => {
    show({ accounts: [checking], transactions: [txn(1, "-30", 1), txn(2, "-20", 1, "Dining Out"), txn(3, "-5", 2), txn(4, "-7", null, "Gas")] });
    expect(card().querySelector("h2")?.textContent).toBe("Spending by person");
    expect(card().textContent).toContain("November 2026, by category. The tick is what each person earned.");
    expect(card().querySelector(".breakdown-list")).toBeNull();
    expect(labels()).toEqual(["Alex", "Sam", "Shared"]);
    expect(totals()).toEqual(["$50.00", "$5.00", "$7.00"]);
  });

  it("says Shared, never Unassigned, for spending nobody was named for", () => {
    show({ accounts: [checking], transactions: [txn(1, "-12.25", null), txn(2, "-7.75", null)] });
    expect(host.textContent).not.toContain("Unassigned");
    expect(labels()).toContain("Shared");
    expect(totals()[labels().indexOf("Shared")]).toBe("$20.00");
  });

  it("keeps every figure the old list had: each person's total and each category's amount are in the page text and hidden table", () => {
    show({ accounts: [checking], transactions: [txn(1, "-30", 1), txn(2, "-20", 1, "Dining Out")] });
    expect(hiddenRows()).toEqual(
      expect.arrayContaining([
        ["Alex", "Groceries", "$30.00"],
        ["Alex", "Dining Out", "$20.00"],
        ["Alex", "Total", "$50.00"],
      ]),
    );
  });

  it("with no people is just Shared", () => {
    show({ familyMembers: [], accounts: [checking], transactions: [txn(1, "-9", null)] });
    expect(labels()).toEqual(["Shared"]);
    expect(totals()).toEqual(["$9.00"]);
  });

  it("gives someone who earned but spent nothing an empty row with their tick", () => {
    show({ accounts: [checking], transactions: [txn(1, "1500", 2, "Salary"), txn(2, "-9", 1)] });
    expect(labels()).toEqual(["Alex", "Sam", "Shared"]);
    const sam = card().querySelectorAll(".stacked-rows-row")[1];
    expect(sam.querySelectorAll(".stacked-rows-seg")).toHaveLength(0);
    expect(sam.querySelectorAll(".stacked-rows-tick")).toHaveLength(1);
    expect(totals()[1]).toBe("$0.00");
  });

  it("leaves refunds and money in out of the bars", () => {
    show({ accounts: [checking], transactions: [txn(1, "-40", 1), txn(2, "15", 1, "Groceries")] });
    expect(totals()[0]).toBe("$40.00");
  });

  it("says so in words, not an empty chart, when nobody spent anything this month", () => {
    show({ accounts: [checking], transactions: [txn(1, "-5", 1, "Groceries", { date: "2026-10-30" })] });
    expect(card().querySelector(".stacked-rows")).toBeNull();
    expect(card().textContent).toContain("No spending this month.");
  });

  it("only draws the month on the page", () => {
    show({ accounts: [checking], transactions: [txn(1, "-5", 1, "Groceries", { date: "2026-10-30" }), txn(2, "-9", 2)] });
    expect(totals()).toEqual(["$0.00", "$9.00", "$0.00"]);
  });

  it("names a person's biggest one-off cost when it is at least a fifth of their spending", () => {
    show({ accounts: [checking], transactions: [txn(1, "-200", 1, "Car upkeep", { description: "Garage" }), txn(2, "-50", 1), txn(3, "-50", 1), txn(4, "-50", 1), txn(5, "-50", 1)] });
    const notes = [...card().querySelectorAll("[data-spending-note]")].map((e) => e.textContent);
    expect(notes).toEqual(["Alex's biggest one-off cost: Garage, $200.00"]);
  });

  it("keeps amounts out of every attribute in the card", () => {
    show({ accounts: [checking], transactions: [txn(1, "-200", 1, "Car upkeep", { description: "Garage" }), txn(2, "-50", 1), txn(3, "900", 1, "Salary")] });
    const bad = [...card().querySelectorAll("*")].flatMap((el) => [...el.attributes].filter((a) => /\$\s?\d/.test(a.value)).map((a) => `${el.tagName}.${a.name}`));
    expect(bad).toEqual([]);
  });
});

describe("Household Budget by person", () => {
  const line = (category: string, budget_group: string, actual: string, member_id: number | null = 1) => ({ category, budget_group, budgeted: "100", actual, member_id, member_name: member_id === 1 ? "Alex" : null });

  it("lists spending categories only: the Income row is gone", () => {
    show({ memberBudgetActuals: [line("Salary", "income", "3000"), line("Groceries", "flexible", "25"), line("Rent", "fixed", "900")] });
    const rows = [...host.querySelectorAll("[data-budget-by-person] tbody tr")].map((tr) => tr.querySelector("td")?.textContent);
    expect(rows).toEqual(["Groceries", "Rent"]);
  });

  it("says there is no budgeted spending when only income is planned", () => {
    show({ memberBudgetActuals: [line("Salary", "income", "3000")] });
    expect(host.querySelector("[data-budget-by-person]")?.textContent).toContain("No budgeted spending yet this month.");
  });
});
