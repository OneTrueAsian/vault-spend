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

  function show(out: Transaction, incoming: Transaction, opts: { narrow?: boolean; detailsOpen?: boolean } = {}) {
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
              showDebtColumn={false}
              narrow={opts.narrow ?? false}
              detailsOpen={opts.detailsOpen ?? false}
              onToggleDetails={onToggleDetails}
            />
          </tbody>
        </table>,
      );
    });
  }

  const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(label));

  it("offers separate note actions for the outgoing and incoming legs, each labeled with its account", () => {
    const out = txn({ id: 1, account_name: "Checking", notes: null });
    const incoming = txn({ id: 2, account_name: "Savings", notes: null });
    show(out, incoming);
    expect(button("Checking"), "expected an outgoing-leg note action labeled with its account").not.toBeUndefined();
    expect(button("Savings"), "expected an incoming-leg note action labeled with its account").not.toBeUndefined();
  });

  it("clicking the outgoing leg's note action edits the outgoing transaction, not the incoming one", () => {
    const out = txn({ id: 1, account_name: "Checking", notes: null });
    const incoming = txn({ id: 2, account_name: "Savings", notes: null });
    show(out, incoming);
    act(() => button("Checking")!.click());
    expect(onEditNote).toHaveBeenCalledWith(out);
  });

  it("clicking the incoming leg's note action edits the incoming transaction, not the outgoing one", () => {
    const out = txn({ id: 1, account_name: "Checking", notes: null });
    const incoming = txn({ id: 2, account_name: "Savings", notes: null });
    show(out, incoming);
    act(() => button("Savings")!.click());
    expect(onEditNote).toHaveBeenCalledWith(incoming);
  });

  it("previews an existing note instead of offering to add one", () => {
    const out = txn({ id: 1, account_name: "Checking", notes: "Reimbursed by Sam" });
    const incoming = txn({ id: 2, account_name: "Savings", notes: null });
    show(out, incoming);
    expect(container.textContent).toContain("Reimbursed by Sam");
    expect(button("Checking")?.textContent).not.toContain("Add note");
    expect(button("Savings")?.textContent).toContain("Add note");
  });

  it("does not copy a note from one leg onto the other", () => {
    const out = txn({ id: 1, account_name: "Checking", notes: "Only on the outgoing leg" });
    const incoming = txn({ id: 2, account_name: "Savings", notes: null });
    show(out, incoming);
    const savingsButton = button("Savings");
    expect(savingsButton?.textContent).not.toContain("Only on the outgoing leg");
  });

  it("still unlinks when Unlink is clicked", () => {
    const out = txn({ id: 1, account_name: "Checking" });
    const incoming = txn({ id: 2, account_name: "Savings" });
    show(out, incoming);
    act(() => button("Unlink")!.click());
    expect(onUnlink).toHaveBeenCalledTimes(1);
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
