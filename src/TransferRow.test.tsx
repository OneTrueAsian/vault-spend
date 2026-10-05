// @vitest-environment jsdom
//
// TransferRow: a linked transfer collapsed into one ledger row. Each leg is
// still its own transaction underneath, so each needs its own note action —
// annotating the outgoing leg must never touch the incoming leg's note, and
// neither should require unlinking first.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TransferRow } from "./TransferRow";
import type { Transaction } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    transfer_counterpart_id: 2,
    date: "2026-08-10",
    description: "Transfer to savings",
    amount: "-150.00",
    category: null,
    category_source: "user",
    confidence: null,
    account_id: 1,
    account_name: "Checking",
    applied_to_debt: null,
    principal_amount: null,
    split_count: 0,
    tags: [],
    member_id: null,
    member_name: null,
    notes: null,
    ...overrides,
  };
}

describe("TransferRow", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onToggleSelected = vi.fn();
  const onUnlink = vi.fn();
  const onEditNote = vi.fn();
  const onToggleDetails = vi.fn();

  beforeEach(() => {
    onToggleSelected.mockReset();
    onUnlink.mockReset();
    onEditNote.mockReset();
    onToggleDetails.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(out: Transaction, incoming: Transaction, opts: { narrow?: boolean; detailsOpen?: boolean; showMemberCol?: boolean } = {}) {
    act(() => {
      root.render(
        <table>
          <tbody>
            <TransferRow
              out={out}
              incoming={incoming}
              selected={false}
              onToggleSelected={onToggleSelected}
              onUnlink={onUnlink}
              onEditNote={onEditNote}
              showMemberCol={opts.showMemberCol ?? true}
              narrow={opts.narrow ?? false}
              detailsOpen={opts.detailsOpen ?? false}
              onToggleDetails={onToggleDetails}
            />
          </tbody>
        </table>,
      );
    });
  }

  it("keeps applied-payment context visible in a collapsed transfer with the debt column disabled", () => {
    const out = txn({ account_name: "Checking", applied_to_debt: { debt_account_id: 3, debt_account_name: "Card", amount: "55.35", date: "2026-08-11" } });
    const incoming = txn({ id: 2, account_name: "Savings", amount: "150.00" });
    for (const narrow of [false, true]) {
      show(out, incoming, { narrow });
      const details = container.querySelector(".applied-payment-details");
      expect(details?.textContent).toContain("Checking → Card");
      expect(details?.textContent).toContain("55.35");
      expect(details?.textContent).toContain("2026-08-11");
      expect(container.querySelector('[data-payment-row="1"]')).not.toBeNull();
    }
  });

  const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(label));
  const openMenu = () => act(() => container.querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
  const menuLabels = () => [...document.body.querySelectorAll(".row-menu-panel [role='menuitem']")].map((b) => b.textContent);
  const choose = (label: string) => {
    openMenu();
    const item = [...document.body.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role='menuitem']")].find((b) => b.textContent === label);
    expect(item, `expected the menu item "${label}", found ${JSON.stringify(menuLabels())}`).not.toBeUndefined();
    act(() => item!.click());
  };

  it("puts Unlink and each leg's note action in one ⋯ menu, each note labeled with its account", () => {
    const out = txn({ id: 1, account_name: "Checking", notes: null });
    const incoming = txn({ id: 2, account_name: "Savings", notes: null });
    show(out, incoming);
    expect(container.querySelectorAll("[data-row-menu]")).toHaveLength(1);
    expect(button("Unlink")).toBeUndefined();
    expect(container.textContent).not.toContain("Add note");
    openMenu();
    expect(menuLabels()).toEqual(["Unlink transfer…", "Add note to Checking…", "Add note to Savings…"]);
  });

  it("choosing the outgoing leg's note action edits the outgoing transaction, not the incoming one", () => {
    const out = txn({ id: 1, account_name: "Checking", notes: null });
    const incoming = txn({ id: 2, account_name: "Savings", notes: null });
    show(out, incoming);
    choose("Add note to Checking…");
    expect(onEditNote).toHaveBeenCalledWith(out);
  });

  it("choosing the incoming leg's note action edits the incoming transaction, not the outgoing one", () => {
    const out = txn({ id: 1, account_name: "Checking", notes: null });
    const incoming = txn({ id: 2, account_name: "Savings", notes: null });
    show(out, incoming);
    choose("Add note to Savings…");
    expect(onEditNote).toHaveBeenCalledWith(incoming);
  });

  it("previews an existing note and offers to edit it instead of adding one", () => {
    const out = txn({ id: 1, account_name: "Checking", notes: "Reimbursed by Sam" });
    const incoming = txn({ id: 2, account_name: "Savings", notes: null });
    show(out, incoming);
    expect(container.textContent).toContain("Reimbursed by Sam");
    act(() => button("Reimbursed by Sam")!.click());
    expect(onEditNote).toHaveBeenCalledWith(out);
    openMenu();
    expect(menuLabels()).toEqual(["Unlink transfer…", "Edit note for Checking…", "Add note to Savings…"]);
  });

  it("does not copy a note from one leg onto the other", () => {
    const out = txn({ id: 1, account_name: "Checking", notes: "Only on the outgoing leg" });
    const incoming = txn({ id: 2, account_name: "Savings", notes: null });
    show(out, incoming);
    expect(button("Savings")).toBeUndefined();
    expect(container.querySelectorAll(".transaction-note-preview")).toHaveLength(1);
  });

  it("still unlinks when Unlink transfer… is chosen", () => {
    const out = txn({ id: 1, account_name: "Checking" });
    const incoming = txn({ id: 2, account_name: "Savings" });
    show(out, incoming);
    choose("Unlink transfer…");
    expect(onUnlink).toHaveBeenCalledTimes(1);
  });

  it("spans the accounts line over the member column only when that column shows", () => {
    const out = txn({ id: 1, account_name: "Checking" });
    const incoming = txn({ id: 2, account_name: "Savings" });
    show(out, incoming, { showMemberCol: true });
    expect(container.querySelector<HTMLTableCellElement>("td.transfer-accounts")!.colSpan).toBe(2);
    expect(container.querySelectorAll("tr[data-payment-row] td")).toHaveLength(8);
    show(out, incoming, { showMemberCol: false });
    expect(container.querySelector<HTMLTableCellElement>("td.transfer-accounts")!.colSpan).toBe(1);
    expect(container.querySelectorAll("tr[data-payment-row] td")).toHaveLength(8);
  });

  describe("narrow layout", () => {
    it("hides the account/category/source columns and offers a Details toggle instead", () => {
      const out = txn({ id: 1, account_name: "Checking" });
      const incoming = txn({ id: 2, account_name: "Savings" });
      show(out, incoming, { narrow: true });
      expect(container.textContent).not.toContain("Checking → Savings");
      expect(button("Details")).not.toBeUndefined();
    });

    it("clicking Details calls onToggleDetails", () => {
      const out = txn({ id: 1, account_name: "Checking" });
      const incoming = txn({ id: 2, account_name: "Savings" });
      show(out, incoming, { narrow: true });
      act(() => button("Details")!.click());
      expect(onToggleDetails).toHaveBeenCalledTimes(1);
    });

    it("shows the account line, category, and source in the details panel when open", () => {
      const out = txn({ id: 1, account_name: "Checking" });
      const incoming = txn({ id: 2, account_name: "Savings" });
      show(out, incoming, { narrow: true, detailsOpen: true });
      expect(container.textContent).toContain("Checking → Savings");
      expect(button("Hide details")).not.toBeUndefined();
    });

    it("still shows every column in wide layout, with no Details toggle", () => {
      const out = txn({ id: 1, account_name: "Checking" });
      const incoming = txn({ id: 2, account_name: "Savings" });
      show(out, incoming, { narrow: false });
      expect(container.textContent).toContain("Checking → Savings");
      expect(button("Details")).toBeUndefined();
    });
  });
});
