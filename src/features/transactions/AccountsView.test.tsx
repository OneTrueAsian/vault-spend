// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsView } from "./AccountsView";
import type { Account } from "../../shared/lib/types";
import { startPrivacyMask } from "../../shared/lib/privacy";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve([])) }));
const account: Account = { id: 7, name: "Everyday Checking", account_type: "checking", starting_balance: "100", current_balance: "123.45", institution: "Local bank", mask: "1234", interest_rate: null, excluded_from_debt_payoff: false, member_id: null, member_name: null, checkpoint_date: null, icon_key: null, import_flip_signs: null, hidden: false };
let host: HTMLDivElement;
let root: Root;
let open = vi.fn<(id: number) => void>();
let props: ComponentProps<typeof AccountsView>;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  open = vi.fn<(id: number) => void>(); const noop = () => {};
  props = { accounts: [account], manualAssetsTotal: 0, netWorthHistory: [], accountContributionDeltas: [], onSetStartingBalance: noop, onSetBalanceOverride: noop, onUpdateAccountType: noop, onDeleteAccount: noop, onSetAccountDetails: noop, familyMembers: [], onSetAccountMember: noop, onSetAccountIcon: noop, onSetAccountHidden: noop, onAddAccount: noop, onOpenAccountDetail: open, assets: [], onCreateAsset: noop, onUpdateAssetValue: noop, onSetAssetMember: noop, onDeleteAsset: noop };
  act(() => root.render(<AccountsView {...props} />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const card = () => host.querySelector(".account-card")!;
describe("account rows", () => {
  it("keeps the named open button alongside Activity and Edit", () => {
    const button = card().querySelector<HTMLButtonElement>(".account-card-open")!;
    expect(button?.textContent).toBe(account.name);
    expect(button.getAttribute("title")).toBe(`Open details for ${account.name}`);
    expect(card().querySelectorAll(".account-card-open")).toHaveLength(1);
    expect([...card().querySelectorAll(".account-row-links button")].map(b => b.textContent)).toEqual(["Activity", "Edit"]);
    act(() => button.click()); expect(open).toHaveBeenCalledWith(7);
  });
  it("offers Details, Edit, Reconcile and Delete in the row menu", () => {
    const menu = card().querySelector<HTMLButtonElement>("[data-row-menu]")!;
    expect(menu).not.toBeNull(); act(() => menu.click());
    const items = [...document.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role=menuitem]")];
    expect(items.map(i => i.textContent)).toEqual(["Details", "Edit", "Reconcile with a statement", "Hide", "Delete"]);
    act(() => items[0].click()); expect(open).toHaveBeenCalledWith(7);
  });
  it("Reconcile opens the account's details at its reconcile card", () => {
    act(() => card().querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    const item = [...document.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role=menuitem]")].find(b => b.textContent === "Reconcile with a statement")!;
    act(() => item.click());
    expect(open).toHaveBeenCalledWith(7, "reconcile");
  });
  it("only checking and savings accounts offer Reconcile", () => {
    act(() => root.render(<AccountsView {...props} accounts={[{ ...account, account_type: "credit" }]} />));
    act(() => card().querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    const labels = [...document.querySelectorAll(".row-menu-panel [role=menuitem]")].map(i => i.textContent);
    expect(labels).toEqual(["Details", "Edit", "Hide", "Delete"]);
  });
  it("Delete asks first, in the account dialog, before deleting", () => {
    const onDeleteAccount = vi.fn();
    act(() => root.render(<AccountsView {...props} onDeleteAccount={onDeleteAccount} />));
    act(() => card().querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    act(() => [...document.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role=menuitem]")].find(b => b.textContent === "Delete")!.click());
    expect(onDeleteAccount).not.toHaveBeenCalled();
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent === "Delete account")!;
    expect(confirm).toBeDefined();
    act(() => confirm.click());
    expect(onDeleteAccount).toHaveBeenCalledWith(7);
  });
  it("Edit opens the account dialog without navigating to Details", () => {
    act(() => card().querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    const edit = [...document.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role=menuitem]")].find(button => button.textContent === "Edit")!;
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
  it("closes the account icon picker with Escape and returns focus to the badge that opened it", () => {
    const badge = card().querySelector<HTMLButtonElement>(".type-badge")!;
    badge.focus();
    act(() => badge.click());
    expect(card().querySelector(".icon-picker-popover")).not.toBeNull();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(card().querySelector(".icon-picker-popover")).toBeNull();
    expect(document.activeElement).toBe(badge);
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
    expect(heads).toEqual([["Cash", "$1,023.45"], ["Borrowing", "$16,675.46 owed"], ["Property and valuables", "$0.00"]]);
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
    expect(visaRow.querySelector(".sub.amount-editable")?.textContent).toBe("$10,658.07 free of $12,000.00");
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
    expect(items.map(i => i.textContent)).toEqual(["Update value", "Belongs to Jordan", "Delete"]);
    act(() => items[1].click());
    expect(onSetAssetMember).toHaveBeenCalledWith(1, 3);
    act(() => row.querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    act(() => [...document.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role=menuitem]")].find(b => b.textContent === "Delete")!.click());
    expect(onDeleteAsset).not.toHaveBeenCalled();
    act(() => [...row.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Delete")!.click());
    expect(onDeleteAsset).toHaveBeenCalledWith(1);
  });
  it("still offers to add property when there is none yet", () => {
    show({ accounts: [account], assets: [] });
    expect([...host.querySelectorAll("button")].some(b => b.textContent === "Add property or valuable")).toBe(true);
  });
});

// QA-GAP-001 (owner-approved 27 Oct 2026): Hide / Unhide. Hidden accounts leave the main list for a collapsed
// section, but every total still counts them.
describe("hiding accounts", () => {
  const show = (over: Partial<ComponentProps<typeof AccountsView>>) => act(() => root.render(<AccountsView {...props} {...over} />));
  const old: Account = { ...account, id: 20, name: "Old Savings", account_type: "savings", starting_balance: "0", current_balance: "12.00", hidden: true };
  const menuItems = (cardEl: Element) => {
    act(() => cardEl.querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    return [...document.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role=menuitem]")];
  };
  const hiddenToggle = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => /^Hidden accounts \(\d+\)/.test(b.textContent ?? ""));
  const mainCards = () => [...host.querySelectorAll(".account-group:not(.account-group-hidden) .account-card-open")].map((b) => b.textContent);
  const tiles = () => [...host.querySelectorAll(".stats .stat")].map((t) => [...t.children].map((c) => c.textContent));

  it("Hide in a visible account's menu asks to hide that account, with no confirmation", () => {
    const onSetAccountHidden = vi.fn();
    show({ onSetAccountHidden });
    const hide = menuItems(card()).find((i) => i.textContent === "Hide")!;
    act(() => hide.click());
    expect(onSetAccountHidden).toHaveBeenCalledWith(7, true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps a hidden account out of the main list and puts it in a collapsed Hidden accounts section", () => {
    show({ accounts: [account, old] });
    expect(mainCards()).toEqual(["Everyday Checking"]);
    const toggle = hiddenToggle()!;
    expect(toggle.textContent).toContain("Hidden accounts (1)");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("Old Savings");
  });

  it("opens the section to list the hidden account with Unhide in its menu, and Unhide shows it again", () => {
    const onSetAccountHidden = vi.fn();
    show({ accounts: [account, old], onSetAccountHidden });
    act(() => hiddenToggle()!.click());
    expect(hiddenToggle()!.getAttribute("aria-expanded")).toBe("true");
    const hiddenCard = host.querySelector(".account-group-hidden .account-card")!;
    expect(hiddenCard.textContent).toContain("Old Savings");
    const labels = menuItems(hiddenCard).map((i) => i.textContent);
    expect(labels).toContain("Unhide");
    expect(labels).not.toContain("Hide");
    expect(labels).toContain("Details");
    expect(labels).toContain("Delete");
    act(() => menuItems(hiddenCard).find((i) => i.textContent === "Unhide")!.click());
    expect(onSetAccountHidden).toHaveBeenCalledWith(20, false);
  });

  it("counts hidden accounts in every total and says so", () => {
    show({ accounts: [account, old] });
    const t = tiles();
    expect(t[0][1]).toBe("$135.45");
    expect(t[2][1]).toBe("$135.45");
    expect(host.textContent).toContain("Includes 1 hidden account");
    show({ accounts: [account, { ...old, id: 21, name: "Older" }, old] });
    expect(host.textContent).toContain("Includes 2 hidden accounts");
  });

  it("includes hidden balances in the group total, though their rows are in the section", () => {
    show({ accounts: [account, old] });
    const heads = [...host.querySelectorAll(".account-group-head")].map((h) => [...h.children].map((c) => c.textContent));
    expect(heads[0]).toEqual(["Cash", "$135.45"]);
  });

  it("says nothing about hidden accounts when none are hidden", () => {
    show({ accounts: [account] });
    expect(hiddenToggle()).toBeUndefined();
    expect(host.textContent).not.toContain("hidden account");
  });

  it("counts them in the subtitle", () => {
    show({ accounts: [account, old] });
    expect(host.querySelector(".view-sub")?.textContent).toBe("2 accounts (1 hidden)");
  });

  it("an account with every account hidden still shows the section, not 'No accounts yet'", () => {
    show({ accounts: [old] });
    expect(host.textContent).not.toContain("No accounts yet.");
    expect(hiddenToggle()).toBeDefined();
  });
});


describe("v9 grouped accounts", () => {
  it("combines borrowing and investments/other, with working Activity and Edit links", () => {
    act(() => root.render(<AccountsView {...props} accounts={[account, visa, loan, { ...account, id: 30, name: "Other", account_type: "other" }, { ...account, id: 31, name: "Invested", account_type: "investment" }]} />));
    expect([...host.querySelectorAll(".account-group-head h2")].map(e => e.textContent)).toEqual(["Cash", "Borrowing", "Investments and other", "Property and valuables"]);
    const row = host.querySelector('[data-account-id="7"]')!;
    act(() => [...row.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Activity")!.click());
    expect(open).toHaveBeenCalledWith(7);
    act(() => [...row.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Edit")!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Edit Everyday Checking");
  });
  it("shows free credit out of the known limit and clamps the bar for overpaid cards", () => {
    act(() => root.render(<AccountsView {...props} accounts={[{ ...visa, current_balance: "13000.00" }]} />));
    expect(host.querySelector('.sub.amount-editable')?.textContent).toBe("$13,000.00 free of $12,000.00");
    expect((host.querySelector('.credit-availability .progress-fill') as HTMLElement)?.style.width).toBe("0%");
  });
});

describe("What you own and owe (VS-31 stream A)", () => {
  const show = (over: Partial<ComponentProps<typeof AccountsView>>) => act(() => root.render(<AccountsView {...props} {...over} />));
  const invest: Account = { ...account, id: 11, name: "Brokerage", account_type: "investment", starting_balance: "0", current_balance: "5000.00" };
  const bar = () => host.querySelector<HTMLElement>("[data-own-owe]")!;
  const key = () => [...bar().querySelectorAll("[data-own-owe-key] li")].map(li => li.textContent!.replace(/\s+/g, " ").trim());
  const rowTotals = () => [...bar().querySelectorAll(".segment-bar-row")].map(r => [r.querySelector(".segment-bar-label")?.textContent, r.querySelector(".segment-bar-total")?.textContent]);
  const tile = (n: number) => host.querySelectorAll(".stats .stat")[n].querySelector(".stat-value")!.textContent;
  const house = { id: 1, name: "Our House", asset_type: "real_estate", value: "415000.00", valued_on: "2026-10-04", notes: null, member_id: null, member_name: null };
  const everything = { accounts: [account, card2, visa, loan, invest], assets: [house], manualAssetsTotal: 415000 };

  it("sits between the three tiles and the grouped cards, titled What you own and owe", () => {
    show(everything);
    expect(bar().querySelector(".reports-section-title")?.textContent).toBe("What you own and owe");
    const tiles = host.querySelector(".stats")!;
    const groups = host.querySelector(".accounts-groups")!;
    expect(tiles.compareDocumentPosition(bar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar().compareDocumentPosition(groups) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...host.querySelectorAll(".stats .stat-label")].map(l => l.textContent)).toEqual(["What you own", "What you owe", "Net worth"]);
  });

  it("draws Own (invested, cash, property) and Owe (cards and loans) on one scale and agrees with the tiles to the cent", () => {
    show(everything);
    expect(rowTotals()).toEqual([["Own", tile(0)], ["Owe", tile(1)]]);
    expect(tile(0)).toBe("$421,023.45");
    expect(tile(1)).toBe("$16,675.46");
    expect(bar().querySelector("[data-own-owe-net]")?.textContent).toBe(`Net worth ${tile(2)}`);
    expect(tile(2)).toBe("$404,347.99");
  });

  it("names every kind with its amount in a key, since the bar names only the wide segments", () => {
    show(everything);
    expect(key()).toEqual(["Investments and other $5,000.00", "Cash and savings $1,023.45", "Property and valuables $415,000.00", "Cards and loans $16,675.46"]);
  });

  it("counts hidden accounts, as the tiles do", () => {
    show({ ...everything, accounts: [account, { ...card2, hidden: true }, visa, loan, invest] });
    expect(key()).toContain("Cash and savings $1,023.45");
    expect(rowTotals()[0][1]).toBe(tile(0));
  });

  it("gives an overpaid card no width but keeps its real figure in the total and the key", () => {
    const overpaid: Account = { ...visa, starting_balance: "1000.00", current_balance: "1200.00" };
    show({ accounts: [account, overpaid], assets: [], manualAssetsTotal: 0 });
    expect(tile(1)).toBe("-$200.00");
    expect(rowTotals()[1]).toEqual(["Owe", "-$200.00"]);
    expect(key()).toContain("Cards and loans -$200.00");
    const owe = bar().querySelectorAll<HTMLElement>(".segment-bar-row")[1].querySelector<HTMLElement>(".segment-bar-seg")!;
    expect(owe.style.width).toBe("0%");
  });

  it("reads $0.00 on the Owe row when nothing is owed, rather than dropping it", () => {
    show({ accounts: [account], assets: [], manualAssetsTotal: 0 });
    expect(rowTotals()).toEqual([["Own", "$123.45"], ["Owe", "$0.00"]]);
    expect(key()).toEqual(["Cash and savings $123.45", "Cards and loans $0.00"]);
  });

  it("says so in words when there is nothing yet", () => {
    show({ accounts: [], assets: [], manualAssetsTotal: 0 });
    expect(bar().textContent).toContain("Add an account to see what you own and owe.");
    expect(bar().querySelector(".segment-bar")).toBeNull();
  });

  it("hides every figure, and keeps amounts out of every attribute", () => {
    show(everything);
    const stop = startPrivacyMask(host);
    try {
      expect(bar().textContent).not.toMatch(/\$\s?\d/);
      expect(bar().textContent).toContain("••••");
    } finally {
      stop();
    }
    for (const el of [bar(), ...bar().querySelectorAll("*")]) {
      for (const attr of el.getAttributeNames()) expect(`${attr}=${el.getAttribute(attr)}`).not.toMatch(/\$\s?\d/);
    }
  });

  it("leaves the tiles clickable, with their detail panel", () => {
    show(everything);
    act(() => host.querySelectorAll<HTMLElement>(".stats .stat")[1].click());
    expect(host.textContent).toContain("Car Loan");
  });
});
