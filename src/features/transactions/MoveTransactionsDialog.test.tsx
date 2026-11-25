// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MoveTransactionsDialog } from "./MoveTransactionsDialog";
import { previewFixture } from "./transactionAccountMoveFixtures";
import type { MoveDialogState } from "./useTransactionMove";
import type { ConfirmationAccount } from "./transactionAccountMove";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// VS-49: Review the move stays greyed out until every balance is given; the dialog now says which one and how to fix it.
const confirmation = (accountId: number, accountName: string): ConfirmationAccount => ({
  accountId, accountName, accountType: "checking", inputLabel: "Balance", currentDisplay: "991.00", creditLimit: null, availableCredit: null,
  reasons: [], confirmedDisplay: null, choice: null, projectedBaseline: null, problem: null,
});
const preview = previewFixture({ status: "needs_balance_confirmation", mode: "confirmation", canCommit: false, confirmations: [confirmation(1, "Checking"), confirmation(2, "Savings")] }).preview;
const state = (balances: MoveDialogState["balances"]): MoveDialogState => ({
  ids: [1, 2], destinationId: 2, destinationName: "Savings", clearSelection: true, phase: "ready", preview, balances, editingBalances: true,
  operationId: null, message: null, notice: null, sessionKey: "s",
});

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });
function show(balances: MoveDialogState["balances"]) {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const noop = vi.fn();
  act(() => root!.render(<MoveTransactionsDialog dialog={state(balances)} hiddenByFilter={null} onCancel={noop} onConfirm={noop} onReviewAgain={noop} onReloadAndClose={noop}
    onSetBalance={noop} onReviewBalances={noop} onChangeBalances={noop} />));
}
const missing = () => document.querySelector("[data-move-missing]")?.textContent ?? null;
const review = () => document.querySelector<HTMLButtonElement>("[data-move-review-balances]")!;

describe("move balances say what is missing", () => {
  it("names the first account whose balance is still needed", () => {
    show({});
    expect(review().disabled).toBe(true);
    expect(missing()).toBe("Enter the balance after the move for Checking, or choose Keep this balance.");
    show({ 1: { keep: true, value: "" } });
    expect(missing()).toBe("Enter the balance after the move for Savings, or choose Keep this balance.");
  });

  it("says how to fix a balance typed with a comma, and greys out Review until it is fixed", () => {
    show({ 1: { keep: false, value: "1,000.50" }, 2: { keep: true, value: "" } });
    expect(review().disabled).toBe(true);
    expect(missing()).toBe("Checking: Leave out the comma: 1000.50");
    expect(document.querySelector('[data-move-balance-error="1"]')!.textContent).toBe("Leave out the comma: 1000.50");
  });

  // Found by the full desktop suite (spec 377): the note must not change which footer button React reuses, or the focused
  // Review the move button turns into Move when the final review opens.
  it("never leaves Move focused when the final review opens from a focused Review the move", () => {
    const balances = { 1: { keep: false, value: "1000.50" }, 2: { keep: true, value: "" } };
    show(balances);
    act(() => review().focus());
    const noop = vi.fn();
    const reviewing = { ...state(balances), editingBalances: false, preview: { ...preview, canCommit: true, status: "ready" as const } };
    act(() => root!.render(<MoveTransactionsDialog dialog={reviewing} hiddenByFilter={null} onCancel={noop} onConfirm={noop} onReviewAgain={noop} onReloadAndClose={noop}
      onSetBalance={noop} onReviewBalances={noop} onChangeBalances={noop} />));
    expect(document.querySelector("[data-move-confirm]")).not.toBeNull();
    expect(document.activeElement?.hasAttribute("data-move-confirm")).toBe(false);
  });

  it("says nothing once every balance is given", () => {
    show({ 1: { keep: false, value: "1000.50" }, 2: { keep: true, value: "" } });
    expect(review().disabled).toBe(false);
    expect(missing()).toBeNull();
  });
});

// VS-103 F-12: the one-account case reads "from Household (02)", not "Household (02) (1)".
describe("move summary names where the transactions come from", () => {
  const summary = (over: Parameters<typeof previewFixture>[0]) => {
    const p = previewFixture(over).preview;
    const dialog: MoveDialogState = { ids: [1, 2], destinationId: 2, destinationName: "Savings", clearSelection: true, phase: "ready", preview: p, balances: {}, editingBalances: false,
      operationId: null, message: null, notice: null, sessionKey: "s" };
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const noop = vi.fn();
    act(() => root!.render(<MoveTransactionsDialog dialog={dialog} hiddenByFilter={null} onCancel={noop} onConfirm={noop} onReviewAgain={noop} onReloadAndClose={noop}
      onSetBalance={noop} onReviewBalances={noop} onChangeBalances={noop} />));
    return document.querySelector("[data-move-summary]")!.textContent ?? "";
  };

  it("gives the account name alone when there is one source", () => {
    const text = summary({ effectiveCount: 1, sources: [{ accountId: 1, accountName: "Household (02)", count: 1 }] });
    expect(text).toContain("1 transaction from Household (02), dated");
    expect(text).not.toContain("(1)");
  });

  it("splits the count by account when there are several sources", () => {
    const text = summary({ effectiveCount: 3, sources: [{ accountId: 1, accountName: "A", count: 2 }, { accountId: 3, accountName: "B", count: 1 }] });
    expect(text).toContain("3 transactions (2 from A, 1 from B), dated");
  });
});
