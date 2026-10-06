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
    expect(card().querySelectorAll(".account-card-open")).toHaveLength(1);
    expect([...card().querySelectorAll("button")].some(b => b.textContent === "Details" || b.textContent === "Edit")).toBe(false);
    act(() => button.click()); expect(open).toHaveBeenCalledWith(7);
  });
  it("offers Details and Edit in the row menu", () => {
    const menu = card().querySelector<HTMLButtonElement>("[data-row-menu]")!;
    expect(menu).not.toBeNull(); act(() => menu.click());
    const items = [...document.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role=menuitem]")];
    expect(items.map(i => i.textContent)).toEqual(["Details", "Edit…"]);
    act(() => items[0].click()); expect(open).toHaveBeenCalledWith(7);
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
