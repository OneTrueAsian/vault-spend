// @vitest-environment jsdom
//
// TransferReviewDialog used to offer only "Not now" (a temporary close) and
// "Link" — an unwanted suggestion always came back next time, with no way
// to say "stop suggesting this pair." This covers the Dismiss selected /
// Dismiss all actions added to close that gap (there is deliberately no
// per-row Dismiss — it duplicated Dismiss selected): they never touch
// a transaction's own data, only the suggestion list; a failed dismiss
// keeps the dialog open with an inline error instead of losing the
// person's place; and the dialog shows an explicit empty state once every
// pair has been cleared.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TransferReviewDialog } from "./Modal";
import type { Transaction } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function txn(overrides: Partial<Transaction> & { id: number; description: string; amount: string; account_name: string }): Transaction {
  return {
    transfer_counterpart_id: null,
    date: "2026-08-10",
    category: null,
    category_source: null,
    confidence: null,
    account_id: 1,
    applied_to_debt: null,
    principal_amount: null,
    split_count: 0,
    tags: [],
    member_id: null,
    member_name: null,
    notes: null,
    ...overrides,
  } as Transaction;
}

const pairA = {
  out: txn({ id: 1, description: "Move to savings", amount: "-500.00", account_name: "Checking" }),
  in: txn({ id: 2, description: "Deposit from checking", amount: "500.00", account_name: "Savings" }),
};
const pairB = {
  out: txn({ id: 3, description: "Sent to brother", amount: "-75.00", account_name: "Checking" }),
  in: txn({ id: 4, description: "Brother paid me back", amount: "75.00", account_name: "Savings" }),
};

describe("TransferReviewDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onLink = vi.fn();
  const onDismiss = vi.fn(async () => {});
  const onDismissAll = vi.fn(async () => {});
  const onCancel = vi.fn();

  beforeEach(() => {
    onLink.mockReset();
    onDismiss.mockReset().mockImplementation(async () => {});
    onDismissAll.mockReset().mockImplementation(async () => {});
    onCancel.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(pairs = [pairA, pairB]) {
    act(() => {
      root.render(<TransferReviewDialog pairs={pairs} onLink={onLink} onDismiss={onDismiss} onDismissAll={onDismissAll} onCancel={onCancel} />);
    });
  }

  it("still offers Not now and Link alongside the Dismiss selected / Dismiss all actions", () => {
    show();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Not now");
    expect(text).toMatch(/Link 2 as transfers/);
    expect(text).toContain("Dismiss 2 selected");
    expect(text).toContain("Dismiss all");
  });

  it("has no per-row Dismiss button — Dismiss selected and Dismiss all are the only dismiss actions", () => {
    show();
    expect(document.querySelectorAll(".transfer-review-dismiss").length).toBe(0);
    const dismissButtons = [...document.querySelectorAll<HTMLButtonElement>("button")].filter((b) => /dismiss/i.test(b.textContent ?? ""));
    expect(dismissButtons.map((b) => b.textContent?.trim())).toEqual(["Dismiss 2 selected", "Dismiss all"]);
  });

  it("with every pair ticked, Dismiss selected calls onDismiss with both pairs", async () => {
    show();
    const dismissSelected = document.querySelector<HTMLButtonElement>("[data-dismiss-selected]")!;
    await act(async () => {
      dismissSelected.click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith([
      { out_id: 1, in_id: 2 },
      { out_id: 3, in_id: 4 },
    ]);
  });

  it("unchecking a pair excludes it from Dismiss selected — unchecked never means dismissed", async () => {
    show();
    const checkboxes = [...document.querySelectorAll<HTMLInputElement>(".transfer-review-row input[type=checkbox]")];
    act(() => {
      checkboxes[1].click(); // uncheck pair B
    });
    const dismissSelected = document.querySelector<HTMLButtonElement>("[data-dismiss-selected]")!;
    await act(async () => {
      dismissSelected.click();
    });
    expect(onDismiss).toHaveBeenCalledWith([{ out_id: 1, in_id: 2 }]);
  });

  it("Dismiss all calls onDismissAll, not onDismiss", async () => {
    show();
    const dismissAll = document.querySelector<HTMLButtonElement>("[data-dismiss-all]")!;
    await act(async () => {
      dismissAll.click();
    });
    expect(onDismissAll).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and shows an inline error when a dismiss fails, instead of closing", async () => {
    onDismiss.mockImplementation(async () => {
      throw new Error("Write failed: disk full");
    });
    show();
    const dismissSelected = document.querySelector<HTMLButtonElement>("[data-dismiss-selected]")!;
    await act(async () => {
      dismissSelected.click();
    });
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("disk full");
    // Still open, both pairs still shown — nothing was lost.
    expect(document.querySelectorAll(".transfer-review-row").length).toBe(2);
  });

  it("disables Dismiss selected/Dismiss all/Link while a dismiss is in flight", async () => {
    let resolveDismiss: () => void = () => {};
    onDismiss.mockImplementation(() => new Promise<void>((resolve) => (resolveDismiss = resolve)));
    show();
    act(() => {
      document.querySelector<HTMLButtonElement>("[data-dismiss-selected]")!.click();
    });
    expect(document.querySelector<HTMLButtonElement>("[data-dismiss-selected]")!.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("[data-dismiss-all]")!.disabled).toBe(true);
    await act(async () => {
      resolveDismiss();
      await Promise.resolve();
    });
  });

  it("a pair that surfaces later with the same out id but a different in id starts unchecked, not inheriting the old pair's tick", async () => {
    // Simulates dismissing pair A's original match, which surfaces an
    // alternate in-leg for the same out-transaction (found by code
    // review: `checked` used to be keyed by out.id alone, so the new pair
    // silently inherited whatever the old one's checkbox said).
    show([pairA, pairB]);
    const alternateInLeg = txn({ id: 5, description: "Alternate deposit", amount: "500.00", account_name: "Backup Savings" });
    show([{ out: pairA.out, in: alternateInLeg }, pairB]);
    const checkboxes = [...document.querySelectorAll<HTMLInputElement>(".transfer-review-row input[type=checkbox]")];
    expect(checkboxes[0].checked).toBe(false);
    const linkButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Link"))!;
    await act(async () => {
      linkButton.click();
    });
    expect(onLink).toHaveBeenCalledWith([{ out_id: 3, in_id: 4 }]);
  });

  it("shows an explicit empty state with a close control once every pair is gone", () => {
    show([]);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/no more possible transfers/i);
    const closeButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Close");
    expect(closeButton).toBeTruthy();
    act(() => {
      closeButton!.click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
