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

  it("says nothing once every balance is given", () => {
    show({ 1: { keep: false, value: "1000.50" }, 2: { keep: true, value: "" } });
    expect(review().disabled).toBe(false);
    expect(missing()).toBeNull();
  });
});
