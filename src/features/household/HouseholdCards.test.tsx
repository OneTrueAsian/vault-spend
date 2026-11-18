// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { HouseholdView } from "./HouseholdView";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof HouseholdView>;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = { transactions: [], accounts: [], assets: [], familyMembers: [{id: 1, name: "Alex"}, {id: 2, name: "Sam"}], memberBudgetActuals: [], monthLabel: "November 2026", year: 2026, month: 11,
    onPrevMonth: vi.fn(), onNextMonth: vi.fn(), onManageMembers: vi.fn(), onRenameMember: vi.fn(), onRemoveMember: vi.fn(), onSetYear: vi.fn(), onSetMonth: vi.fn() };
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const show = (over: Partial<ComponentProps<typeof HouseholdView>> = {}) => act(() => root.render(<HouseholdView {...props} {...over} />));
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === name)!;
const txn = (id: number, amount: string, member_id: number | null, date = "2026-11-10") => ({id, date, amount, member_id, member_name: member_id === 1 ? "Alex" : member_id === 2 ? "Sam" : null, category: "Food", account_id: 1} as ComponentProps<typeof HouseholdView>["transactions"][number]);
it("v9 People actions target a person and confirm removal before invoking existing handlers", () => {
  show();
  act(() => button("Rename").click());
  const input = host.querySelector<HTMLInputElement>('[aria-label="Name for Alex"]')!;
  expect(input).not.toBeNull();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Alexandra");
    input.dispatchEvent(new Event("input", {bubbles: true}));
  });
  act(() => button("Save").click());
  expect(props.onRenameMember).toHaveBeenCalledWith(1, "Alexandra");
  act(() => button("Remove").click());
  expect(props.onRemoveMember).not.toHaveBeenCalled();
  expect(host.textContent).toContain("becomes unassigned");
  act(() => button("Remove person").click());
  expect(props.onRemoveMember).toHaveBeenCalledWith(1);
});
it("v9 header retains month navigation and Add person even in an empty profile", () => {
  show({familyMembers: []});
  act(() => button("Add person").click());
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Previous month"]')!.click());
  expect(props.onManageMembers).toHaveBeenCalledOnce(); expect(props.onPrevMonth).toHaveBeenCalledOnce();
});
it("v9 monthly table includes every person and Shared, scopes income/spending and keeps current net worth", () => {
  show({transactions: [txn(1,"50",1),txn(2,"-8",2),txn(3,"20",null),txn(4,"-4",null),txn(5,"-99",2,"2026-10-31") ]});
  const monthly = host.querySelector('[data-month-by-person]')!;
  expect(monthly?.textContent).toContain("November 2026 by person");
  expect([...monthly.querySelectorAll('thead th')].map(e => e.textContent)).toEqual(["Person", "Income", "Spending"]);
  const rows = [...monthly.querySelectorAll('tbody tr')].map(e => e.textContent);
  expect(rows).toEqual(["Alex$50.00$0.00", "Sam$0.00$8.00", "Shared$20.00$4.00"]);
  expect(host.textContent).toContain("Today's values, whatever month is chosen.");
  expect(host.textContent).toContain("Spending by person");
});
it("v9 budget table has one row per category, a shared plan and bars for every person and Shared", () => {
  show({ memberBudgetActuals: [
    {category:"Food", budget_group:"flexible", budgeted:"100", actual:"25", member_id:1, member_name:"Alex"},
    {category:"Food", budget_group:"flexible", budgeted:"100", actual:"150", member_id:null, member_name:null},
  ] });
  const table=host.querySelector('[data-budget-by-person] table')!;
  expect(table).not.toBeNull();
  expect([...table.querySelectorAll('thead th')].map(e => e.textContent)).toEqual(["Category", "Planned", "Alex", "Sam", "Shared"]);
  expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(table.textContent).toContain("$100.00"); expect(table.textContent).toContain("$150.00");
  const bars=[...table.querySelectorAll<HTMLElement>('.household-person-bar > span')];
  expect(bars).toHaveLength(3); expect(bars.every(e => parseFloat(e.style.width) <= 100)).toBe(true);
});

it("selects a month across years using the shared month field and existing setters", () => {
  show();
  const field = host.querySelector<HTMLInputElement>('input[aria-label="Household month"]')!;
  expect(field).not.toBeNull();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "2025-03");
    field.dispatchEvent(new Event("input", {bubbles: true}));
  });
  expect(props.onSetYear).toHaveBeenCalledWith(2025);
  expect(props.onSetMonth).toHaveBeenCalledWith(3);
});

it("keeps the selected month while the month field is cleared or incomplete", () => {
  show();
  const field = host.querySelector<HTMLInputElement>('input[aria-label="Household month"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "");
    field.dispatchEvent(new Event("input", {bubbles: true}));
  });
  expect(props.onSetYear).not.toHaveBeenCalled();
  expect(props.onSetMonth).not.toHaveBeenCalled();
});
it("contains category artwork in the existing icon badge", () => {
  show({memberBudgetActuals: [{category:"Food", budget_group:"flexible", budgeted:"100", actual:"25", member_id:1, member_name:"Alex"}]});
  expect(host.querySelector('[data-budget-by-person] .cell-with-icon > .row-icon-badge')).not.toBeNull();
});

// VS-31 step 3 (owner decision 17.4): the "(month) by person" table broke a long name in the middle of a word
// ("Montgomer-y-"). It now follows Budget by person: a name wraps only between words, the amounts stay whole, and
// a table too narrow for its names scrolls inside its own region.
it("keeps the month-by-person table in a keyboard-reachable scroll region of its own", () => {
  show();
  const region = host.querySelector<HTMLElement>("[data-month-by-person] .household-table-scroll")!;
  expect(region).not.toBeNull();
  expect(region.getAttribute("role")).toBe("region");
  expect(region.getAttribute("aria-label")).toBe("November 2026 by person");
  expect(region.tabIndex).toBe(0);
  expect(region.querySelector("table")).not.toBeNull();
});

it("styles the month-by-person names to wrap between words only, and keeps its amounts whole", () => {
  const css = readFileSync("src/features/household/HouseholdCards.css", "utf8");
  const rule = (selector: string) => {
    const at = css.indexOf(selector);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  };
  const cells = rule("[data-month-by-person] .ledger td");
  expect(cells).toMatch(/overflow-wrap:\s*normal/);
  expect(cells).toMatch(/word-break:\s*normal/);
  expect(rule("[data-month-by-person] .ledger .amount-col")).toMatch(/white-space:\s*nowrap/);
  expect(rule("[data-month-by-person] .ledger td:first-child")).toMatch(/min-width:\s*\d+px/);
});
// Moved from the removed incomeByMember tests (a real production case): an internal transfer and the deposit side of a credit
// card payment, both attributed to a person, are not income, so the month table's Income column leaves them out.
it("leaves transfers and credit card payments out of a person's income", () => {
  const account = (id: number, name: string, account_type: string) => ({ id, name, account_type, starting_balance: "0", current_balance: "0", institution: null, mask: null,
    interest_rate: null, excluded_from_debt_payoff: false, member_id: null, member_name: null, checkpoint_date: null, icon_key: null, import_flip_signs: null, hidden: false }) as ComponentProps<typeof HouseholdView>["accounts"][number];
  show({
    accounts: [account(1, "Everyday Checking", "checking"), account(2, "Capital One", "credit")],
    transactions: [
      { ...txn(1, "147.70", 1), category: "Income" },
      { ...txn(2, "6000.00", 1), category: "Transfer" },
      { ...txn(3, "1867.82", 1), category: "Credit Card Payment", account_id: 2 },
    ],
  });
  const rows = [...host.querySelectorAll('[data-month-by-person] tbody tr')].map(e => e.textContent);
  expect(rows[0]).toBe("Alex$147.70$0.00");
});
