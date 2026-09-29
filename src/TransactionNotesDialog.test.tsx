// @vitest-environment jsdom
//
// TransactionNotesDialog: a person's own freeform annotation on one
// transaction. Prefilled from the transaction's current note, saved
// through an async onSave that can reject (backend validation or a write
// failure) — the dialog stays open with the typed text intact and an
// inline error on rejection, so nothing typed is ever silently lost.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TransactionNotesDialog } from "./TransactionNotesDialog";
import type { Transaction } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    transfer_counterpart_id: null,
    date: "2026-08-10",
    description: "Costco run",
    amount: "-150.00",
    category: "Groceries",
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

describe("TransactionNotesDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSave = vi.fn(async () => {});
  const onClose = vi.fn();

  beforeEach(() => {
    onSave.mockReset().mockImplementation(async () => {});
    onClose.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(transaction: Transaction) {
    act(() => {
      root.render(<TransactionNotesDialog transaction={transaction} onSave={onSave} onClose={onClose} />);
    });
  }

  const textarea = () => document.querySelector<HTMLTextAreaElement>("textarea")!;
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
  const setNativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  function typeInto(value: string) {
    setNativeValue.call(textarea(), value);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("prefills the existing note", () => {
    show(txn({ notes: "Split with Jordan" }));
    expect(textarea().value).toBe("Split with Jordan");
  });

  it("starts empty when there is no existing note", () => {
    show(txn({ notes: null }));
    expect(textarea().value).toBe("");
  });

  it("supports multiline editing and Enter inserts a newline without submitting or closing", () => {
    show(txn());
    act(() => {
      textarea().focus();
    });
    typeInto("line one\nline two");
    act(() => {
      textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(textarea().value).toBe("line one\nline two");
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("saves the typed text and closes on success", async () => {
    show(txn({ notes: null }));
    typeInto("Reimbursed by Sam");
    await act(async () => {
      button("Save").click();
    });
    expect(onSave).toHaveBeenCalledWith("Reimbursed by Sam");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clearing the text to empty saves null, not an empty string", async () => {
    show(txn({ notes: "old note" }));
    typeInto("");
    await act(async () => {
      button("Save").click();
    });
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("Cancel closes without saving", () => {
    show(txn({ notes: "old note" }));
    typeInto("changed but not saved");
    act(() => {
      button("Cancel").click();
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a live character count", () => {
    show(txn({ notes: "hello" }));
    expect(document.body.textContent).toMatch(/5\s*\/\s*4,?000/);
  });

  it("keeps the dialog open with the typed text and an inline error when the save is rejected", async () => {
    onSave.mockImplementation(async () => {
      throw new Error("Notes can be at most 4,000 characters.");
    });
    show(txn({ notes: null }));
    typeInto("too long".repeat(1000));
    await act(async () => {
      button("Save").click();
    });
    expect(onClose).not.toHaveBeenCalled();
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("4,000 characters");
    expect(textarea().value).toBe("too long".repeat(1000));
  });

  it("disables Save/Cancel and the textarea while saving", async () => {
    let resolveSave: () => void = () => {};
    onSave.mockImplementation(() => new Promise<void>((resolve) => (resolveSave = resolve)));
    show(txn({ notes: null }));
    typeInto("saving...");
    act(() => {
      button("Save").click();
    });
    expect(textarea().disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);
    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });
  });
});
