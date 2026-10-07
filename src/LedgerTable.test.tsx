// @vitest-environment jsdom
//
// LedgerTable (s1, calmer rows): each row is plain text with its actions in one `⋯` menu, the
// member column shows only when there's more than one person, and amounts line up on the right.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { LedgerTable } from "./LedgerTable";
import { ledgerColumnCount } from "./ledgerHelpers";
import type { Account, FamilyMember, Transaction } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function txn(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    transfer_counterpart_id: null,
    date: "2026-08-10",
    description: "Coffee Shop",
    amount: "-4.50",
    category: "Dining Out",
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
    ...over,
  };
}

const checking: Account = {
  id: 1,
  name: "Checking",
  account_type: "checking",
  starting_balance: "0",
  current_balance: "0",
  institution: null,
  mask: null,
  interest_rate: null,
  excluded_from_debt_payoff: false,
  member_id: null,
  member_name: null,
  checkpoint_date: null,
  icon_key: null,
  import_flip_signs: null,
};

type Props = ComponentProps<typeof LedgerTable>;

function baseProps(transactions: Transaction[], familyMembers: FamilyMember[]): Omit<Props, "confirmingDeleteId" | "setConfirmingDeleteId" | "taggingId" | "setTaggingId"> {
  const narrow = false;
  const showMemberCol = familyMembers.length >= 2;
  return {
    setLedgerScrollEl: vi.fn(),
    ledgerDensity: "comfortable",
    ledgerNarrow: narrow,
    showMemberCol,
    appSettings: {
      apply_to_debt_enabled: true,
      split_purchases_enabled: true,
      envelope_caps_enabled: true,
      rollover_enabled: true,
      auto_link_transfers: false,
      safe_to_spend_enabled: true,
    },
    selectAllBatch: null,
    selectedIds: new Set(),
    toggleSelectAll: vi.fn(),
    sortColumn: "date",
    sortDirection: "desc",
    toggleSort: vi.fn(),
    pagedTransactions: transactions,
    inLegByOutId: new Map(),
    highlightedPaymentRow: null,
    toggleSelectedMany: vi.fn(),
    handleUnlinkTransfer: vi.fn(),
    setNotesDialogFor: vi.fn(),
    detailsOpenId: null,
    setDetailsOpenId: vi.fn(),
    accounts: [checking],
    handleAccountChangeForTransaction: vi.fn(),
    familyMembers,
    handleMemberChangeForTransaction: vi.fn(),
    categoryOptions: ["Dining Out", "Groceries"],
    handleCategoryChange: vi.fn(),
    toggleSplitEditor: vi.fn(),
    editingPrincipalId: null,
    principalDraft: "",
    setPrincipalDraft: vi.fn(),
    handleSetPrincipalAmount: vi.fn(),
    setEditingPrincipalId: vi.fn(),
    handleResetPrincipalAmount: vi.fn(),
    startEditingPrincipal: vi.fn(),
    handleUnapplyDebtPayment: vi.fn(),
    applyingDebtId: null,
    applyDebtForm: { accountId: "", amount: "" },
    setApplyDebtForm: vi.fn(),
    debtAccounts: [],
    handleApplyDebtPayment: vi.fn(),
    setApplyingDebtId: vi.fn(),
    startApplyingDebtPayment: vi.fn(),
    toggleSelected: vi.fn(),
    editingDate: null,
    setEditingDate: vi.fn(),
    commitDateEdit: vi.fn(),
    categoryIconMap: {},
    editingDescription: null,
    setEditingDescription: vi.fn(),
    commitDescriptionEdit: vi.fn(),
    anomalyFlagsByTransaction: new Map(),
    handleRemoveTag: vi.fn(),
    newTagText: {},
    setNewTagText: vi.fn(),
    handleAddTag: vi.fn(),
    editingAmount: null,
    setEditingAmount: vi.fn(),
    commitAmountEdit: vi.fn(),
    handleDeleteTransaction: vi.fn(),
    ledgerColumnCount: ledgerColumnCount(narrow, showMemberCol),
    expandedSplitId: null,
    splitLines: [],
    updateSplitLine: vi.fn(),
    removeSplitLine: vi.fn(),
    addSplitLine: vi.fn(),
    splitRemaining: () => 0,
    saveSplits: vi.fn(),
    clearSplits: vi.fn(),
    setExpandedSplitId: vi.fn(),
    filteredTransactions: transactions,
    transactions,
  };
}

/** Holds the two pieces of row state the menu drives, the way App.tsx does. */
function Harness({ props }: { props: ReturnType<typeof baseProps> }) {
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [taggingId, setTaggingId] = useState<number | null>(null);
  return (
    <LedgerTable {...props} confirmingDeleteId={confirmingDeleteId} setConfirmingDeleteId={setConfirmingDeleteId} taggingId={taggingId} setTaggingId={setTaggingId} />
  );
}

describe("LedgerTable", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.head.querySelectorAll("style[data-test-ledger]").forEach((s) => s.remove());
  });

  const twoRows = [txn({ id: 1, description: "Coffee Shop" }), txn({ id: 2, description: "Green Leaf Grocers", category: null, category_source: null, amount: "-82.10" })];
  const show = (props: ReturnType<typeof baseProps>) => act(() => root.render(<Harness props={props} />));
  const colWidthTotal = () => [...container.querySelectorAll<HTMLElement>("colgroup col")].reduce((sum, c) => sum + parseFloat(c.style.width), 0);
  const rows = () => [...container.querySelectorAll<HTMLTableRowElement>("tbody tr[data-payment-row]")];
  const menuItem = (label: string) =>
    [...document.body.querySelectorAll<HTMLButtonElement>(".row-menu-panel [role^='menuitem']")].find((b) => b.textContent?.trim() === label);

  it("gives each row exactly one ⋯ menu and no always-on note or tag prompts", () => {
    show(baseProps(twoRows, [{ id: 1, name: "Alex" }]));
    expect(rows()).toHaveLength(2);
    for (const row of rows()) expect(row.querySelectorAll("[data-row-menu]")).toHaveLength(1);
    expect(container.textContent).not.toContain("+ Add note");
    expect(container.querySelector("input[placeholder='+ tag']")).toBeNull();
    expect(container.querySelector(".tag-input")).toBeNull();
    expect(container.querySelector(".debt-col")).toBeNull();
  });

  it("hides the member column with one family member, and the column count matches the header", () => {
    const props = baseProps(twoRows, [{ id: 1, name: "Alex" }]);
    show(props);
    expect(container.querySelector(".member-col")).toBeNull();
    expect(container.querySelectorAll("thead th")).toHaveLength(props.ledgerColumnCount);
    expect(container.querySelectorAll("colgroup col")).toHaveLength(props.ledgerColumnCount);
    for (const row of rows()) expect(row.querySelectorAll("td")).toHaveLength(props.ledgerColumnCount);
    expect(colWidthTotal()).toBe(100);
  });

  it("shows the member column with two members, blank for a row with no one, and the count still matches", () => {
    const props = baseProps(twoRows, [
      { id: 1, name: "Alex" },
      { id: 2, name: "Sam" },
    ]);
    show(props);
    expect(container.querySelector("td.member-col")).not.toBeNull();
    expect(container.querySelectorAll("thead th")).toHaveLength(props.ledgerColumnCount);
    expect(container.querySelectorAll("colgroup col")).toHaveLength(props.ledgerColumnCount);
    expect(colWidthTotal()).toBe(100);
    const member = container.querySelector<HTMLButtonElement>("[aria-label='Family member for \"Coffee Shop\"']")!;
    expect(member.textContent).toBe("▾");
    act(() => member.click());
    expect([...document.querySelectorAll("[role='menuitemradio']")][0]?.textContent).toContain("No one");
  });

  it("draws the account, member and category cells as plain text, with a red Needs a category", () => {
    show(baseProps(twoRows, [{ id: 1, name: "Alex" }]));
    for (const label of ["Account for \"Coffee Shop\"", "Category for \"Coffee Shop\""]) {
      expect(container.querySelector(`[aria-label='${label}']`)?.classList.contains("row-field-toggle-plain")).toBe(true);
    }
    const uncategorized = container.querySelector("[aria-label='Category for \"Green Leaf Grocers\"']")!;
    expect(uncategorized.classList.contains("row-field-needs")).toBe(true);
    expect(uncategorized.textContent).toContain("Needs a category");
    expect(container.querySelector("[aria-label='Category for \"Coffee Shop\"']")!.classList.contains("row-field-needs")).toBe(false);
  });

  it("shows the inline Delete confirm in place of the ⋯ when Delete… is chosen", () => {
    show(baseProps(twoRows, [{ id: 1, name: "Alex" }]));
    act(() => rows()[0].querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    act(() => menuItem("Delete…")!.click());
    const confirm = rows()[0].querySelector(".row-delete-confirm");
    expect(confirm).not.toBeNull();
    expect([...confirm!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Cancel", "Delete"]);
    expect(rows()[0].querySelector("[data-row-menu]")).toBeNull();
    expect(rows()[1].querySelector("[data-row-menu]")).not.toBeNull();
  });

  const trigger = (i: number) => rows()[i].querySelector<HTMLButtonElement>("[data-row-menu]");

  it("puts focus on Cancel when the confirm opens, and back on the row's ⋯ after Cancel", () => {
    show(baseProps(twoRows, [{ id: 1, name: "Alex" }]));
    act(() => trigger(0)!.click());
    act(() => menuItem("Delete…")!.click());
    const cancel = [...rows()[0].querySelectorAll<HTMLButtonElement>(".row-delete-confirm button")].find((b) => b.textContent === "Cancel")!;
    expect(document.activeElement).toBe(cancel);
    act(() => cancel.click());
    expect(rows()[0].querySelector(".row-delete-confirm")).toBeNull();
    expect(document.activeElement).toBe(trigger(0));
  });

  it("gives focus back to the row's ⋯ when the tag field closes on Enter or Escape", () => {
    const props = baseProps(twoRows, [{ id: 1, name: "Alex" }]);
    props.newTagText = { 1: "trip" };
    show(props);
    for (const key of ["Enter", "Escape"]) {
      act(() => trigger(0)!.click());
      act(() => menuItem("Add tag…")!.click());
      const input = rows()[0].querySelector<HTMLInputElement>(".tag-input")!;
      expect(document.activeElement).toBe(input);
      act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
      expect(rows()[0].querySelector(".tag-input")).toBeNull();
      expect(document.activeElement, `after ${key}`).toBe(trigger(0));
    }
  });

  it("with exactly one family member, the ⋯ menu says and changes whether the row belongs to them", () => {
    const rowsWithMember = [txn({ id: 1, description: "Coffee Shop" }), txn({ id: 2, description: "Green Leaf Grocers", member_id: 1, member_name: "Alex" })];
    const props = baseProps(rowsWithMember, [{ id: 1, name: "Alex" }]);
    show(props);
    const belongs = () => document.body.querySelector<HTMLButtonElement>(".row-menu-panel [role='menuitemcheckbox']");
    act(() => trigger(0)!.click());
    expect([...document.body.querySelectorAll(".row-menu-panel [role^='menuitem']")].map((b) => b.textContent)).toEqual([
      "Split…",
      "Add note…",
      "Add tag…",
      "Belongs to Alex",
      "Delete…",
    ]);
    expect(belongs()!.getAttribute("aria-checked")).toBe("false");
    act(() => belongs()!.click());
    expect(props.handleMemberChangeForTransaction).toHaveBeenCalledWith(1, "1");
    act(() => trigger(1)!.click());
    expect(belongs()!.getAttribute("aria-checked")).toBe("true");
    act(() => belongs()!.click());
    expect(props.handleMemberChangeForTransaction).toHaveBeenLastCalledWith(2, "");
  });

  it("offers no Belongs to item when the Member column shows (two or more people) or there is no one", () => {
    show(baseProps(twoRows, [{ id: 1, name: "Alex" }, { id: 2, name: "Sam" }]));
    act(() => trigger(0)!.click());
    expect(document.body.querySelector(".row-menu-panel [role='menuitemcheckbox']")).toBeNull();
    act(() => root.render(<></>));
    show(baseProps(twoRows, []));
    act(() => trigger(0)!.click());
    expect(document.body.querySelector(".row-menu-panel [role='menuitemcheckbox']")).toBeNull();
  });

  it("says No one in the narrow Details panel for a row with no member, not an empty control", () => {
    const props = baseProps(twoRows, [{ id: 1, name: "Alex" }]);
    props.ledgerNarrow = true;
    props.ledgerColumnCount = ledgerColumnCount(true, false);
    props.detailsOpenId = 1;
    show(props);
    const member = container.querySelector<HTMLButtonElement>(".ledger-details-row [aria-label='Family member for \"Coffee Shop\"']")!;
    expect(member.textContent).toContain("No one");
  });

  it("runs the matching handler for split, note and apply to a debt", () => {
    const props = baseProps(twoRows, [{ id: 1, name: "Alex" }]);
    props.debtAccounts = [{ ...checking, id: 9, name: "Car Loan", account_type: "loan" }];
    show(props);
    const open = () => act(() => rows()[0].querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    open();
    act(() => menuItem("Split…")!.click());
    expect(props.toggleSplitEditor).toHaveBeenCalledWith(twoRows[0]);
    open();
    act(() => menuItem("Add note…")!.click());
    expect(props.setNotesDialogFor).toHaveBeenCalledWith(twoRows[0]);
    open();
    act(() => menuItem("Apply to a debt…")!.click());
    expect(props.startApplyingDebtPayment).toHaveBeenCalledWith(twoRows[0]);
  });

  it("opens a tag field on Add tag…, adds the tag on Enter and closes it", () => {
    const props = baseProps(twoRows, [{ id: 1, name: "Alex" }]);
    props.newTagText = { 1: "trip" };
    show(props);
    act(() => rows()[0].querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    act(() => menuItem("Add tag…")!.click());
    const input = rows()[0].querySelector<HTMLInputElement>(".tag-input")!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(rows()[1].querySelector(".tag-input")).toBeNull();
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(props.handleAddTag).toHaveBeenCalledWith(1, "trip");
    expect(rows()[0].querySelector(".tag-input")).toBeNull();
  });

  it("cancels the tag field on Escape without adding", () => {
    const props = baseProps(twoRows, [{ id: 1, name: "Alex" }]);
    show(props);
    act(() => rows()[0].querySelector<HTMLButtonElement>("[data-row-menu]")!.click());
    act(() => menuItem("Add tag…")!.click());
    act(() => {
      rows()[0].querySelector(".tag-input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(rows()[0].querySelector(".tag-input")).toBeNull();
    expect(props.handleAddTag).not.toHaveBeenCalled();
  });

  it("keeps an applied debt payment visible under the description, with Undo", () => {
    const props = baseProps(
      [txn({ id: 1, applied_to_debt: { date: "2026-08-10", debt_account_id: 9, debt_account_name: "Mortgage", amount: "500.00" } })],
      [{ id: 1, name: "Alex" }],
    );
    show(props);
    const meta = rows()[0].querySelector(".transaction-description-meta")!;
    expect(meta.textContent).toContain("→ Mortgage");
    expect(meta.textContent).toContain("500.00");
    expect([...meta.querySelectorAll("button")].some((b) => b.textContent === "Undo")).toBe(true);
  });

  it("right-aligns ledger amounts over the generic left alignment of ledger cells", () => {
    const style = document.createElement("style");
    style.dataset.testLedger = "";
    style.textContent = fs.readFileSync(path.join(__dirname, "Ledger.css"), "utf8");
    document.head.append(style);
    show(baseProps(twoRows, [{ id: 1, name: "Alex" }]));
    const td = container.querySelector<HTMLElement>("td.amount-col")!;
    const th = container.querySelector<HTMLElement>("th.amount-col")!;
    expect(getComputedStyle(td).textAlign).toBe("right");
    expect(getComputedStyle(th).textAlign).toBe("right");
    expect(getComputedStyle(td).fontVariantNumeric).toBe("tabular-nums");
  });
});
