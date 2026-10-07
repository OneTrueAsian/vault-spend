// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsView } from "./AccountsView";
import type { Account } from "./types";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve([])) }));
const account: Account = { id: 7, name: "Everyday Checking", account_type: "checking", starting_balance: "100", current_balance: "123.45", institution: "Local bank", mask: "1234", interest_rate: null, excluded_from_debt_payoff: false, member_id: null, member_name: null, checkpoint_date: null, icon_key: null, import_flip_signs: null };
let host: HTMLDivElement;
let root: Root;
let open = vi.fn<(id: number) => void>();
let props: ComponentProps<typeof AccountsView>;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  open = vi.fn<(id: number) => void>(); const noop = () => {};
  props = { accounts: [account], manualAssetsTotal: 0, netWorthHistory: [], accountContributionDeltas: [], onSetStartingBalance: noop, onSetBalanceOverride: noop, onUpdateAccountType: noop, onDeleteAccount: noop, onSetAccountDetails: noop, familyMembers: [], onSetAccountMember: noop, onSetAccountIcon: noop, onAddAccount: noop, onOpenAccountDetail: open, assets: [], onCreateAsset: noop, onUpdateAssetValue: noop, onSetAssetMember: noop, onDeleteAsset: noop };
  act(() => root.render(<AccountsView {...props} />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const card = () => host.querySelector(".account-card")!;
describe("account rows", () => {
  it("has one named open button instead of separate Details/Edit buttons", () => {
    const button = card().querySelector<HTMLButtonElement>(".account-card-open")!;
    expect(button?.textContent).toBe(account.name);
    expect(button.getAttribute("title")).toBe(`Open details for ${account.name}`);
    expect(card().querySelectorAll(".account-card-open")).toHaveLength(1);
    expect([...card().querySelectorAll("button")].some(b => b.textContent === "Details" || b.textContent === "Edit")).toBe(false);
    act(() => button.click()); expect(open).toHaveBeenCalledWith(7);
  });
  it("offers Details, Edit, Reconcile and Delete in the row menu", () => {
    const menu = card().querySelector<HTMLButtonElement>("[data-row-menu]")!;
    expect(menu).not.toBeNull(); act(() => menu.click());
    const items = [...document.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role=menuitem]")];
    expect(items.map(i => i.textContent)).toEqual(["Details", "Edit…", "Reconcile with a statement…", "Delete…"]);
    act(() => items[0].click()); expect(open).toHaveBeenCalledWith(7);
  });
  it("Reconcile opens the account's details at its reconcile card", () => {
    act(() => card().querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    const item = [...document.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role=menuitem]")].find(b => b.textContent === "Reconcile with a statement…")!;
    act(() => item.click());
    expect(open).toHaveBeenCalledWith(7, "reconcile");
  });
  it("only checking and savings accounts offer Reconcile", () => {
    act(() => root.render(<AccountsView {...props} accounts={[{ ...account, account_type: "credit" }]} />));
    act(() => card().querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    const labels = [...document.querySelectorAll(".row-menu-panel [role=menuitem]")].map(i => i.textContent);
    expect(labels).toEqual(["Details", "Edit…", "Delete…"]);
  });
  it("Delete asks first, in the account dialog, before deleting", () => {
    const onDeleteAccount = vi.fn();
    act(() => root.render(<AccountsView {...props} onDeleteAccount={onDeleteAccount} />));
    act(() => card().querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    act(() => [...document.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role=menuitem]")].find(b => b.textContent === "Delete…")!.click());
    expect(onDeleteAccount).not.toHaveBeenCalled();
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent === "Delete account")!;
    expect(confirm).toBeDefined();
    act(() => confirm.click());
    expect(onDeleteAccount).toHaveBeenCalledWith(7);
  });
  it("Edit opens the account dialog without navigating to Details", () => {
    act(() => card().querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    const edit = [...document.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role=menuitem]")].find(button => button.textContent === "Edit…")!;
    act(() => edit.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Edit Everyday Checking");
    expect(open).not.toHaveBeenCalled();
  });
  it("balance editing keeps its own action", () => {
    act(() => card().querySelector<HTMLElement>(".bal")!.click());
    expect(card().querySelector<HTMLInputElement>(".amount-edit-input")?.value).toBe("123.45");
    expect(open).not.toHaveBeenCalled();
  });
  it("credit limit and icon selection keep their own actions", () => {
    act(() => root.render(<AccountsView {...props} accounts={[{ ...account, account_type: "credit" }]} />));
    act(() => card().querySelector<HTMLElement>(".sub.amount-editable")!.click());
    expect(card().querySelector<HTMLInputElement>(".amount-edit-input")?.value).toBe("100");
    act(() => card().querySelector<HTMLButtonElement>(".type-badge")!.click());
    expect(card().querySelector(".icon-picker-popover")).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
const card2: Account = { ...account, id: 8, name: "Rainy Day", account_type: "savings", current_balance: "900.00", institution: "Ally", mask: "1177" };
const visa: Account = { ...account, id: 9, name: "Visa Rewards", account_type: "credit", starting_balance: "12000.00", current_balance: "10658.07", institution: "Capital One", mask: "9034" };
const loan: Account = { ...account, id: 10, name: "Car Loan", account_type: "loan", starting_balance: "20000.00", current_balance: "15333.53", institution: null, mask: null };
describe("the Accounts page, as in the UI mockup (UAT s7.1)", () => {
  const show = (over: Partial<ComponentProps<typeof AccountsView>>) => act(() => root.render(<AccountsView {...props} {...over} />));
  const house = { id: 1, name: "Our House", asset_type: "real_estate", value: "415000.00", valued_on: "2026-10-04", notes: null, member_id: null, member_name: null };
  it("says how many accounts and things you own there are", () => {
    show({ accounts: [account, card2, visa], assets: [house], manualAssetsTotal: 415000 });
    expect(host.querySelector(".view-sub")?.textContent).toBe("3 accounts and 1 thing you own");
    show({ accounts: [account], assets: [] });
    expect(host.querySelector(".view-sub")?.textContent).toBe("1 account");
  });
  it("labels each total above its figure, and shows what you owe as the amount owed", () => {
    show({ accounts: [account, visa, loan] });
    const tiles = [...host.querySelectorAll(".stats .stat")].map(t => [...t.children].map(c => c.textContent));
    expect(tiles.map(t => t[0])).toEqual(["What you own", "What you owe", "Net worth"]);
    expect(tiles[1][1]).toBe("$16,675.46");
  });
  it("puts each group in one card with its name and total, debts as an amount owed", () => {
    show({ accounts: [account, card2, visa, loan] });
    const heads = [...host.querySelectorAll(".account-group-head")].map(h => [...h.children].map(c => c.textContent));
    expect(heads).toEqual([["Cash", "$1,023.45"], ["Credit cards", "$1,341.93 owed"], ["Loans", "$15,333.53 owed"], ["Property and valuables", "$0.00"]]);
    const cash = host.querySelector(".account-group")!;
    expect(cash.querySelectorAll(".account-card")).toHaveLength(2);
  });
  it("lists the biggest balance first in each group", () => {
    show({ accounts: [account, card2] });
    expect([...host.querySelectorAll(".account-card .account-card-open")].map(b => b.textContent)).toEqual(["Rainy Day", "Everyday Checking"]);
  });
  it("writes the bank and last digits as in the mockup, and a card's available credit after the amount", () => {
    show({ accounts: [card2, visa] });
    const rows = [...host.querySelectorAll(".account-card")];
    expect(rows[0].querySelector(".account-name-detail-static")?.textContent).toBe("Ally ··1177 · Savings");
    const visaRow = rows.find(r => r.textContent?.includes("Visa Rewards"))!;
    expect(visaRow.querySelector(".bal")?.textContent).toBe("Owed $1,341.93");
    expect(visaRow.querySelector(".owed-tag")?.textContent).toBe("Owed");
    expect(visaRow.querySelector(".sub.amount-editable")?.textContent).toBe("$10,658.07 available");
  });
  it("tints each icon by what the account is", () => {
    show({ accounts: [card2, visa, { ...account, id: 11, name: "Brokerage", account_type: "investment" }] });
    const tint = (name: string) => [...host.querySelectorAll(".account-card")].find(r => r.textContent?.includes(name))!.querySelector(".type-badge")!.className;
    expect(tint("Rainy Day")).toBe("type-badge");
    expect(tint("Visa Rewards")).toBe("type-badge type-badge-debt");
    expect(tint("Brokerage")).toBe("type-badge type-badge-investment");
  });
  it("lists property and valuables as a group of rows like the accounts", () => {
    const onSetAssetMember = vi.fn(), onDeleteAsset = vi.fn();
    show({ accounts: [account], assets: [house], manualAssetsTotal: 415000, familyMembers: [{ id: 3, name: "Jordan" }], onSetAssetMember, onDeleteAsset });
    const groups = [...host.querySelectorAll(".account-group")];
    const property = groups[groups.length - 1];
    expect([...property.querySelector(".account-group-head")!.children].map(c => c.textContent)).toEqual(["Property and valuables", "$415,000.00"]);
    const row = property.querySelector(".account-card")!;
    expect(row.querySelector(".account-name-cell")?.textContent).toBe("Our House");
    expect(row.querySelector(".account-name-detail-static")?.textContent).toBe("Real Estate · updated Oct 4, 2026");
    expect(row.querySelector(".bal")?.textContent).toBe("$415,000.00");
    act(() => row.querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    const items = [...document.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role^=menuitem]")];
    expect(items.map(i => i.textContent)).toEqual(["Update value…", "Belongs to Jordan", "Delete…"]);
    act(() => items[1].click());
    expect(onSetAssetMember).toHaveBeenCalledWith(1, 3);
    act(() => row.querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    act(() => [...document.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role=menuitem]")].find(b => b.textContent === "Delete…")!.click());
    expect(onDeleteAsset).not.toHaveBeenCalled();
    act(() => [...row.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Delete")!.click());
    expect(onDeleteAsset).toHaveBeenCalledWith(1);
  });
  it("still offers to add property when there is none yet", () => {
    show({ accounts: [account], assets: [] });
    expect([...host.querySelectorAll("button")].some(b => b.textContent === "Add property or valuable…")).toBe(true);
  });
});
