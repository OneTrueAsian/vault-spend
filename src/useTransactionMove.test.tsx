// @vitest-environment jsdom
//
// "Move to account": choosing a destination only previews; one confirmation sends one move for the frozen ids and
// token; stale, blocked, refused, uncertain and refresh-failed outcomes each say the true thing and never resend.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MoveTransactionsDialog } from "./MoveTransactionsDialog";
import { moveDestinationOptions, useTransactionMove } from "./useTransactionMove";
import { TransactionError } from "./transactionContracts";
import { previewFixture, resultFixture } from "./transactionAccountMoveFixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const account = (id: number, name: string, type = "checking", hidden = false) => ({ id, name, account_type: type, hidden });
const ACCOUNTS = [account(1, "Checking"), account(2, "Savings", "savings"), account(3, "Old card", "credit", true)];

let host: HTMLDivElement;
let root: Root;
let owner: ReturnType<typeof useTransactionMove>;
const call = vi.fn();
const refresh = vi.fn();
const onStatus = vi.fn();
const setSelectedIds = vi.fn();
const snapshot = { context: { generation: 1, sessionRevision: 1 }, transactions: [{ id: 1, account_id: 1 }, { id: 2, account_id: 1 }, { id: 9, account_id: 2 }] };
let currentSnapshot = snapshot;

function Harness({ selected, filter = null }: { selected: number[]; filter?: string | null }) {
  owner = useTransactionMove({
    data: { call, refresh, snapshot: currentSnapshot } as never,
    accounts: ACCOUNTS,
    selectedIds: new Set(selected),
    setSelectedIds,
    onStatus,
  });
  return owner.dialog ? (
    <MoveTransactionsDialog dialog={owner.dialog} hiddenByFilter={filter} onCancel={owner.cancel} onConfirm={() => void owner.confirm()} onReviewAgain={owner.reviewAgain} onReloadAndClose={() => void owner.reloadAndClose()} onSetBalance={owner.setBalance} onReviewBalances={owner.reviewBalances} onChangeBalances={owner.changeBalances} />
  ) : null;
}

function mount(selected = [1, 2], filter: string | null = null) {
  act(() => root.render(<Harness selected={selected} filter={filter} />));
}
const flush = () => act(async () => { await Promise.resolve(); });
const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim().startsWith(name));
const commands = () => call.mock.calls.map((c) => c[0]);

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.resetAllMocks();
  currentSnapshot = snapshot;
  refresh.mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("destinations", () => {
  it("offers visible accounts with their kind, and leaves out the account every selected row is already in", () => {
    expect(moveDestinationOptions(ACCOUNTS, [1, 1])).toEqual([{ value: "2", label: "Savings (Savings)" }]);
    expect(moveDestinationOptions(ACCOUNTS, [1, 2]).map((o) => o.value)).toEqual(["1", "2"]);
    expect(moveDestinationOptions([account(1, "Only")], [1])).toEqual([]);
  });
});

describe("opening the review", () => {
  it("only reads: choosing a destination previews the frozen selection and writes nothing", async () => {
    call.mockResolvedValueOnce(previewFixture());
    mount([2, 1, 2]);
    act(() => owner.open([2, 1, 2], 2, { clearSelection: true }));
    expect(q("[data-move-loading]")).not.toBeNull();
    await flush();
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("preview_transaction_account_move", { ids: [1, 2], destinationAccountId: 2 });
    expect(q("[data-move-dialog] h2, [role=dialog] h2")?.textContent ?? document.body.textContent).toContain("Move 2 transactions to Savings?");
    expect(q("[data-move-confirm]")?.hasAttribute("disabled")).toBe(false);
    expect(setSelectedIds).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the counts, balances, warnings and the note that details stay with the rows", async () => {
    call.mockResolvedValueOnce(previewFixture({
      alreadyThereCount: 1, selectedCount: 3, normalizedIds: [1, 2, 9],
      rows: [...previewFixture().preview.rows, { id: 9, date: "2026-10-07", description: "There", amount: "-1.00", accountId: 2, accountName: "Savings", status: "already_there" }],
      warnings: [{ code: "ticks_cleared", count: 1, detail: "1 transaction you ticked for reconciling will be unticked." }],
    }));
    mount([1, 2, 9]);
    act(() => owner.open([1, 2, 9], 2, { clearSelection: true }));
    await flush();
    const text = document.body.textContent ?? "";
    expect(text).toContain("2 transactions from Checking (2)");
    expect(text).toContain("1 selected transaction is already in Savings and will stay there.");
    expect(q('[data-move-effect="1"]')?.textContent).toContain("Balance $991.00 → $1,000.00");
    expect(q('[data-move-effect="2"]')?.textContent).toContain("Balance $500.00 → $491.00");
    expect(q('[data-move-warning="ticks_cleared"]')).not.toBeNull();
    expect(text).toContain("Categories, tags, notes, splits and who each transaction is for stay with the transactions.");
    expect(text).toContain("not a bank transfer");
  });

  it("says when the moved rows may disappear from a filtered list", async () => {
    call.mockResolvedValueOnce(previewFixture());
    mount([1, 2], "Checking");
    act(() => owner.open([1, 2], 2, { clearSelection: true }));
    await flush();
    expect(document.body.textContent).toContain("These transactions may disappear from this list because you are viewing Checking.");
  });

  it("with blockers says nothing will move and cannot be confirmed", async () => {
    call.mockResolvedValueOnce(previewFixture({
      canCommit: false, rows: previewFixture().preview.rows.map((r, i) => ({ ...r, status: i === 0 ? "blocked" : "move" })),
      blockers: [{ code: "settled", count: 1, summary: "1 transaction is already counted in a finished reconciliation, which can't be changed.", items: [{ transactionId: 1, detail: "2026-10-05 \"Cafe\" (-4.00) was already counted when you reconciled Checking." }] }],
    }));
    mount();
    act(() => owner.open([1, 2], 2, { clearSelection: true }));
    await flush();
    expect(q("#move-blockers-title")?.textContent).toBe("Nothing will be moved");
    expect(q('[data-move-blocker="settled"]')?.textContent).toContain("already counted when you reconciled Checking");
    expect(q("[data-move-confirm]")?.hasAttribute("disabled")).toBe(true);
    // pressing it anyway sends nothing
    act(() => q("[data-move-confirm]")!.click());
    await flush();
    expect(commands()).toEqual(["preview_transaction_account_move"]);
    expect(document.body.textContent).not.toContain("Force");
  });

  it("pages a long blocker list instead of truncating it", async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ transactionId: i + 1, detail: `Row ${i + 1} is linked` }));
    call.mockResolvedValueOnce(previewFixture({ canCommit: false, blockers: [{ code: "linked_transfer", count: 25, summary: "25 transactions are part of a linked transfer.", items }] }));
    mount();
    act(() => owner.open([1, 2], 2, { clearSelection: true }));
    await flush();
    const listed = () => document.querySelectorAll('[data-move-blocker="linked_transfer"] li:not(.move-more-item)').length;
    expect(listed()).toBe(10);
    act(() => button("Show 10 more")!.click());
    act(() => button("Show 5 more")!.click());
    expect(listed()).toBe(25);
    expect(button("Show")).toBeUndefined();
  });

  it("keeps the list and table valid: the show-more buttons sit inside a list item and a table row", async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ transactionId: i + 1, detail: `Row ${i + 1} is linked` }));
    const base = previewFixture().preview.rows[0];
    const rows = Array.from({ length: 12 }, (_, i) => ({ ...base, id: i + 1, description: `Row ${i + 1}` }));
    call.mockResolvedValueOnce(previewFixture({ canCommit: false, rows, selectedCount: 12, effectiveCount: 12, normalizedIds: rows.map((r) => r.id), blockers: [{ code: "linked_transfer", count: 12, summary: "12 transactions are part of a linked transfer.", items }] }));
    mount();
    act(() => owner.open([1, 2], 2, { clearSelection: true }));
    await flush();
    const direct = (selector: string) => [...document.querySelectorAll(selector)].flatMap((p) => [...p.children].map((c) => c.tagName));
    expect(direct('[data-move-blocker="linked_transfer"] > ul')).toHaveLength(11);
    expect(new Set(direct('[data-move-blocker="linked_transfer"] > ul'))).toEqual(new Set(["LI"]));
    expect(direct(".move-table tbody")).toHaveLength(11);
    expect(new Set(direct(".move-table tbody"))).toEqual(new Set(["TR"]));
    const more = [...document.querySelectorAll("button.move-more")];
    expect(more).toHaveLength(2);
    expect(more.find((b) => b.closest("tbody"))?.closest("td")?.getAttribute("colspan")).toBe("5");
  });

  it("shows a failed preview with a way to try again, and no confirm", async () => {
    call.mockRejectedValueOnce(new Error("2 selected transactions no longer exist"));
    mount();
    act(() => owner.open([1, 2], 2, { clearSelection: true }));
    await flush();
    expect(q("[data-move-error]")?.textContent).toContain("no longer exist");
    expect(q("[data-move-confirm]")).toBeNull();
    call.mockResolvedValueOnce(previewFixture());
    act(() => button("Try again")!.click());
    await flush();
    expect(q("[data-move-confirm]")).not.toBeNull();
  });

  it("refuses over the shared limit before asking native, without truncating", () => {
    mount();
    act(() => owner.open(Array.from({ length: 10_001 }, (_, i) => i + 1), 2, { clearSelection: true }));
    expect(call).not.toHaveBeenCalled();
    expect(owner.dialog).toBeNull();
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("up to 10000"));
  });

  it("cancel closes with no database effect, including a late preview reply", async () => {
    let finish!: (v: unknown) => void;
    call.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    mount();
    act(() => owner.open([1, 2], 2, { clearSelection: true }));
    act(() => button("Cancel")!.click());
    expect(owner.dialog).toBeNull();
    await act(async () => { finish(previewFixture()); });
    expect(owner.dialog).toBeNull();
    expect(commands()).toEqual(["preview_transaction_account_move"]);
  });
});

describe("confirming", () => {
  async function ready(selected = [1, 2]) {
    call.mockResolvedValueOnce(previewFixture());
    mount(selected);
    act(() => owner.open(selected, 2, { clearSelection: true }));
    await flush();
  }

  it("sends one move with the frozen ids and the preview's token, then clears the selection, refreshes and reports counts", async () => {
    await ready();
    call.mockResolvedValueOnce(resultFixture({ alreadyThereIds: [9], alreadyThereCount: 1 }));
    await act(async () => { q("[data-move-confirm]")!.click(); });
    expect(call).toHaveBeenLastCalledWith("move_transactions_to_account", { ids: [1, 2], destinationAccountId: 2, expectedPreviewToken: "abc123", operationId: expect.any(String) });
    expect(setSelectedIds).toHaveBeenCalledWith(new Set());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith("Moved 2 transactions to Savings. 1 was already there.", "success");
    expect(owner.dialog).toBeNull();
  });

  it("after a move that clears the selection, focus goes to the transaction list instead of being lost", async () => {
    const stable = document.createElement("input");
    stable.type = "checkbox";
    stable.setAttribute("aria-label", "Select all matching transactions");
    document.body.append(stable);
    await ready();
    call.mockResolvedValueOnce(resultFixture());
    await act(async () => { q("[data-move-confirm]")!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
    expect(document.activeElement).toBe(stable);
  });

  it("leaves focus alone when the person already put it somewhere", async () => {
    const stable = document.createElement("input");
    stable.setAttribute("aria-label", "Select all matching transactions");
    const other = document.createElement("button");
    document.body.append(stable, other);
    await ready();
    call.mockResolvedValueOnce(resultFixture());
    await act(async () => { q("[data-move-confirm]")!.click(); });
    other.focus();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
    expect(document.activeElement).toBe(other);
  });

  it("a double click sends exactly one move", async () => {
    await ready();
    let finish!: (v: unknown) => void;
    call.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    act(() => { q("[data-move-confirm]")!.click(); });
    expect(q("[data-move-confirm]")!.textContent).toBe("Moving…");
    act(() => { void owner.confirm(); });
    act(() => button("Cancel")!.click());
    expect(owner.dialog).not.toBeNull();
    await act(async () => { finish(resultFixture()); });
    expect(commands().filter((c) => c === "move_transactions_to_account")).toHaveLength(1);
  });

  it("does not clear the selection for the single-row entry", async () => {
    call.mockResolvedValueOnce(previewFixture({ selectedCount: 1, effectiveCount: 1, normalizedIds: [1], rows: [previewFixture().preview.rows[0]] }));
    mount([7]);
    act(() => owner.open([1], 2, { clearSelection: false }));
    await flush();
    call.mockResolvedValueOnce(resultFixture({ movedIds: [1], movedCount: 1 }));
    await act(async () => { q("[data-move-confirm]")!.click(); });
    expect(setSelectedIds).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith("Moved 1 transaction to Savings.", "success");
  });

  it("a stale preview or a new blocker returns to a fresh review with a notice, and moves nothing", async () => {
    for (const status of ["stale_preview", "blocked"] as const) {
      call.mockReset();
      onStatus.mockClear();
      await ready();
      call.mockResolvedValueOnce(resultFixture({ status, movedIds: [], movedCount: 0, blockers: status === "blocked" ? [{ code: "duplicate_in_destination", count: 1, summary: "x", items: [{ transactionId: 1, detail: "y" }] }] : [] }));
      call.mockResolvedValueOnce(previewFixture({ token: "fresh" }));
      await act(async () => { q("[data-move-confirm]")!.click(); });
      expect(q("[data-move-notice]")?.textContent).toContain("Something changed while you were reviewing");
      expect(commands()).toEqual(["preview_transaction_account_move", "move_transactions_to_account", "preview_transaction_account_move"]);
      expect(setSelectedIds).not.toHaveBeenCalled();
      expect(owner.dialog?.preview?.token).toBe("fresh");
      act(() => button("Cancel")!.click());
    }
  });

  it("when everything was already there it says so, writes nothing and does not clear the selection", async () => {
    await ready();
    call.mockResolvedValueOnce(resultFixture({ status: "nothing_to_move", movedIds: [], movedCount: 0, alreadyThereIds: [1, 2], alreadyThereCount: 2 }));
    await act(async () => { q("[data-move-confirm]")!.click(); });
    expect(onStatus).toHaveBeenCalledWith("Those transactions are already in Savings. Nothing was moved.", "info");
    expect(setSelectedIds).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a refusal from native (rolled back) is shown over a freshly read review and keeps the selection", async () => {
    await ready();
    call.mockRejectedValueOnce(new TransactionError("not_applied", "Nothing was moved. 1 transaction is already counted in a finished reconciliation, which can't be changed."));
    call.mockResolvedValueOnce(previewFixture({ canCommit: false, blockers: [{ code: "settled", count: 1, summary: "1 transaction is already counted in a finished reconciliation, which can't be changed.", items: [{ transactionId: 1, detail: "d" }] }] }));
    await act(async () => { q("[data-move-confirm]")!.click(); });
    expect(q("[data-move-notice]")?.textContent).toContain("Nothing was moved.");
    expect(q("#move-blockers-title")).not.toBeNull();
    expect(setSelectedIds).not.toHaveBeenCalled();
  });

  it("an unconfirmed reply is reported as uncertain, the list is reloaded, and the move is never sent again", async () => {
    await ready();
    call.mockRejectedValueOnce(new TransactionError("invalid_response", "The app received an incomplete move result."));
    await act(async () => { q("[data-move-confirm]")!.click(); });
    expect(q("[data-move-error]")?.textContent).toContain("could not confirm whether the move finished");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(q("[data-move-confirm]")).toBeNull();
    expect(button("Reload and check")).toBeDefined();
    expect(setSelectedIds).not.toHaveBeenCalled();
    await act(async () => { button("Reload and check")!.click(); });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(owner.dialog).toBeNull();
    expect(commands().filter((c) => c === "move_transactions_to_account")).toHaveLength(1);
  });

  it("a committed move whose refresh fails says the list could not load, and does not call the move a failure", async () => {
    await ready();
    call.mockResolvedValueOnce(resultFixture());
    refresh.mockRejectedValueOnce(new TransactionError("internal_error", "boom"));
    await act(async () => { q("[data-move-confirm]")!.click(); });
    expect(setSelectedIds).toHaveBeenCalledWith(new Set());
    expect(onStatus).toHaveBeenLastCalledWith("Transactions moved, but the updated list could not load. Retry loading.");
    expect(commands().filter((c) => c === "move_transactions_to_account")).toHaveLength(1);
  });

  it("a profile that changed under the dialog ends the review and is never moved into", async () => {
    await ready();
    call.mockRejectedValueOnce(new TransactionError("stale_profile", "This request belongs to a previous profile session."));
    await act(async () => { q("[data-move-confirm]")!.click(); });
    expect(owner.dialog).toBeNull();
    expect(onStatus).toHaveBeenCalledWith("This request belongs to a previous profile session. If you had just chosen Move, check the Transactions list before trying again.");
    expect(setSelectedIds).not.toHaveBeenCalled();
  });

  it("closes the review when the profile session changes while it is open, and ignores the late reply", async () => {
    let finish!: (v: unknown) => void;
    call.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    mount();
    act(() => owner.open([1, 2], 2, { clearSelection: true }));
    currentSnapshot = { ...snapshot, context: { generation: 1, sessionRevision: 2 } };
    mount();
    expect(owner.dialog).toBeNull();
    await act(async () => { finish(previewFixture()); });
    expect(owner.dialog).toBeNull();
  });

  it.each(["success", "refusal"])("ignores a late commit %s after switching profiles", async (outcome) => {
    await ready();
    let finish!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    call.mockReturnValueOnce(new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
    let pending!: Promise<void>;
    act(() => { pending = owner.confirm(); });
    currentSnapshot = { ...snapshot, context: { generation: 2, sessionRevision: 3 } };
    mount();
    onStatus.mockClear();
    await act(async () => {
      if (outcome === "success") finish(resultFixture());
      else reject(new TransactionError("not_applied", "Old account details"));
      await pending;
    });
    expect(owner.dialog).toBeNull();
    expect(setSelectedIds).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(call.mock.calls.filter((c) => c[0] === "preview_transaction_account_move")).toHaveLength(1);
  });
});

describe("the dialog", () => {
  it("is a labelled modal dialog whose buttons are reachable by keyboard and whose actions do not move when messages appear", async () => {
    call.mockResolvedValueOnce(previewFixture());
    mount();
    act(() => owner.open([1, 2], 2, { clearSelection: true }));
    await flush();
    const dialog = q('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    const footer = [...dialog.querySelectorAll(".modal-actions")];
    expect(footer).toHaveLength(1);
    expect(footer[0].closest(".modal-body, .modal-scroll, .move-dialog-body")).toBeNull();
    for (const b of footer[0].querySelectorAll("button")) expect(b.tabIndex).toBeGreaterThanOrEqual(0);
  });

  it("announces a loaded review, and what is wrong with a blocked one, in a polite live region", async () => {
    call.mockResolvedValueOnce(previewFixture());
    mount();
    act(() => owner.open([1, 2], 2, { clearSelection: true }));
    const live = () => q("[data-move-announcement]")!;
    expect(live().getAttribute("role")).toBe("status");
    expect(live().textContent).toBe("");
    await flush();
    expect(live().textContent).toBe("Ready to move 2 transactions to Savings. Review what changes, then choose Move.");
    act(() => button("Cancel")!.click());
    call.mockResolvedValueOnce(previewFixture({ canCommit: false, blockers: [{ code: "settled", count: 1, summary: "s", items: [{ transactionId: 1, detail: "d" }] }] }));
    act(() => owner.open([1, 2], 2, { clearSelection: true }));
    await flush();
    expect(live().textContent).toBe("Nothing will be moved. There is 1 reason, listed in the dialog.");
    expect(q("[data-move-dialog] h2, [role=dialog] h2")?.textContent ?? document.body.textContent).toContain("Can't move these to Savings yet");
  });

  it("keeps long account and merchant names inside the dialog", async () => {
    const long = "A very long account name that goes on and on and on for far too many characters to fit";
    call.mockResolvedValueOnce(previewFixture({ destinationName: long, rows: [{ ...previewFixture().preview.rows[0], description: "x".repeat(200) }, previewFixture().preview.rows[1]] }));
    mount();
    act(() => owner.open([1, 2], 2, { clearSelection: true }));
    await flush();
    expect(q(".move-description")?.textContent).toHaveLength(200);
    expect(document.querySelector(".move-dialog-body")).not.toBeNull();
  });
});

const confirmation = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  accountId: id, accountName: name, accountType: "checking", inputLabel: "Balance" as const, currentDisplay: id === 1 ? "900.00" : "500.00", creditLimit: null, availableCredit: null,
  reasons: ["the monthly balance carried forward as of Oct 28, 2026 does not record which transactions it counted"], confirmedDisplay: null, choice: null, projectedBaseline: null, problem: null, ...over,
});
const needsBalances = (over: Record<string, unknown> = {}) => previewFixture({
  status: "needs_balance_confirmation", mode: "confirmation", canCommit: false, confirmations: [confirmation(1, "Checking"), confirmation(2, "Savings")],
  effects: previewFixture().preview.effects.map((e) => ({ ...e, projectedIsFinal: false, projected: e.current })), ...over,
});
const confirmed = () => previewFixture({
  mode: "confirmation", status: "ready", token: "final-token",
  confirmations: [confirmation(1, "Checking", { confirmedDisplay: "1000.00", choice: "set", projectedBaseline: "1000.00" }), confirmation(2, "Savings", { confirmedDisplay: "500.00", choice: "keep", projectedBaseline: "500.00" })],
});

describe("balances that have to be confirmed", () => {
  async function needs() {
    call.mockResolvedValueOnce(needsBalances());
    mount();
    act(() => owner.open([1, 2], 2, { clearSelection: true }));
    await flush();
  }
  const type = (id: number, value: string) => {
    const input = document.getElementById(`move-balance-${id}`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };

  it("asks for each account's balance, offers the shown one only as a reference, and cannot go on until each is given", async () => {
    await needs();
    expect(document.body.textContent).toContain("Confirm balances to move these to Savings");
    expect(document.body.textContent).toContain("The balances you confirm will apply from today");
    expect(document.body.textContent).toContain("for reference only");
    expect((document.getElementById("move-balance-1") as HTMLInputElement).value).toBe("");
    expect(q("[data-move-review-balances]")?.hasAttribute("disabled")).toBe(true);
    expect(q("[data-move-confirm]")).toBeNull();
    type(1, "1000.00");
    expect(q("[data-move-review-balances]")?.hasAttribute("disabled")).toBe(true);
    act(() => q('[data-move-keep="2"]')!.click());
    expect(q("[data-move-review-balances]")?.hasAttribute("disabled")).toBe(false);
    expect(q('[data-move-keep="2"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(commands()).toEqual(["preview_transaction_account_move"]);
  });

  it("sends exactly what was typed or kept, as text, for the final review, and never moves from the input step", async () => {
    await needs();
    type(1, "1000.00");
    act(() => q('[data-move-keep="2"]')!.click());
    call.mockResolvedValueOnce(confirmed());
    await act(async () => { q("[data-move-review-balances]")!.click(); });
    const last = call.mock.calls.at(-1)!;
    expect(last[0]).toBe("preview_transaction_account_move");
    expect(last[1].balances).toEqual([{ accountId: 1, keep: false, value: "1000.00" }, { accountId: 2, keep: true, value: null }]);
    expect(commands()).not.toContain("move_transactions_to_account");
    expect(document.body.textContent).toContain("Balances you confirmed");
    expect(q("[data-move-confirm]")).not.toBeNull();
  });

  it("shows a problem native found next to the box and keeps what was typed", async () => {
    await needs();
    type(1, "12,5");
    act(() => q('[data-move-keep="2"]')!.click());
    call.mockResolvedValueOnce(needsBalances({ confirmations: [confirmation(1, "Checking", { choice: "set", problem: "Use only digits and one decimal point, like 1250.40." }), confirmation(2, "Savings", { choice: "keep" })] }));
    await act(async () => { q("[data-move-review-balances]")!.click(); });
    expect(q('[data-move-balance-error="1"]')?.textContent).toBe("Use only digits and one decimal point, like 1250.40.");
    expect(q('[data-move-balance-error="1"]')?.getAttribute("role")).toBe("alert");
    expect(q('[data-move-balance-error="2"]')?.textContent).toBe("");
    expect((document.getElementById("move-balance-1") as HTMLInputElement).value).toBe("12,5");
    expect(document.getElementById("move-balance-1")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("commits with an operation id and the balances, and says what was confirmed", async () => {
    await needs();
    type(1, "1000.00");
    act(() => q('[data-move-keep="2"]')!.click());
    call.mockResolvedValueOnce(confirmed());
    await act(async () => { q("[data-move-review-balances]")!.click(); });
    call.mockResolvedValueOnce(resultFixture({ mode: "confirmation", confirmedAccountIds: [1, 2], operationId: "x" }));
    await act(async () => { q("[data-move-confirm]")!.click(); });
    const move = call.mock.calls.find((c) => c[0] === "move_transactions_to_account")!;
    expect(move[1].expectedPreviewToken).toBe("final-token");
    expect(typeof move[1].operationId).toBe("string");
    expect(move[1].operationId.length).toBeGreaterThan(8);
    expect(move[1].balances).toEqual([{ accountId: 1, keep: false, value: "1000.00" }, { accountId: 2, keep: true, value: null }]);
    expect(onStatus).toHaveBeenCalledWith("Moved 2 transactions to Savings. The balances you confirmed now apply from today.", "success");
  });

  it("an unanswered commit is looked up by its operation id instead of being sent again", async () => {
    await needs();
    type(1, "1000.00");
    act(() => q('[data-move-keep="2"]')!.click());
    call.mockResolvedValueOnce(confirmed());
    await act(async () => { q("[data-move-review-balances]")!.click(); });
    call.mockRejectedValueOnce(new Error("channel closed"));
    await act(async () => { q("[data-move-confirm]")!.click(); });
    expect(q("[data-move-error]")).not.toBeNull();
    const sent = call.mock.calls.find((c) => c[0] === "move_transactions_to_account")![1].operationId;
    call.mockResolvedValueOnce({
      contractVersion: 2,
      record: { operationId: sent, mode: "confirmation", effectiveDate: "2026-10-29", destinationAccountId: 2, destinationName: "Savings", movedCount: 2, movedIds: [1, 2], affectedAccountIds: [1, 2], confirmedAccountIds: [1, 2], correctedCheckpoints: 0, accounts: [], inputs: [], corrections: 2 },
    });
    await act(async () => { button("Reload and check")!.click(); });
    expect(call.mock.calls.filter((c) => c[0] === "move_transactions_to_account")).toHaveLength(1);
    expect(call).toHaveBeenCalledWith("get_transaction_account_move", { operationId: sent });
    expect(onStatus).toHaveBeenCalledWith("Moved 2 transactions to Savings. The balances you confirmed now apply from today.", "success");
  });

  it("a changed review throws away what was typed, so stale consent is never reused", async () => {
    await needs();
    type(1, "1000.00");
    act(() => q('[data-move-keep="2"]')!.click());
    call.mockResolvedValueOnce(confirmed());
    await act(async () => { q("[data-move-review-balances]")!.click(); });
    call.mockResolvedValueOnce(resultFixture({ status: "stale_preview", movedIds: [], movedCount: 0, affectedAccountIds: [] }));
    call.mockResolvedValueOnce(needsBalances());
    await act(async () => { q("[data-move-confirm]")!.click(); });
    expect(owner.dialog?.balances).toEqual({});
    expect((document.getElementById("move-balance-1") as HTMLInputElement).value).toBe("");
    expect(q("[data-move-review-balances]")?.hasAttribute("disabled")).toBe(true);
  });

  it("Cancel from the input step and from the final review writes nothing", async () => {
    await needs();
    act(() => button("Cancel")!.click());
    expect(owner.dialog).toBeNull();
    await needs();
    type(1, "1000.00");
    act(() => q('[data-move-keep="2"]')!.click());
    call.mockResolvedValueOnce(confirmed());
    await act(async () => { q("[data-move-review-balances]")!.click(); });
    act(() => button("Cancel")!.click());
    expect(owner.dialog).toBeNull();
    expect(commands()).not.toContain("move_transactions_to_account");
  });

  it("can go back from the final review to the balances", async () => {
    await needs();
    type(1, "1000.00");
    act(() => q('[data-move-keep="2"]')!.click());
    call.mockResolvedValueOnce(confirmed());
    await act(async () => { q("[data-move-review-balances]")!.click(); });
    act(() => q("[data-move-change-balances]")!.click());
    expect(q("[data-move-confirm-balances]")).not.toBeNull();
    expect((document.getElementById("move-balance-1") as HTMLInputElement).value).toBe("1000.00");
  });
});
