// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TransactionMoveHistory } from "./TransactionMoveHistory";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const call = vi.fn();
// The page opens the history from its More actions menu by asking again (a new request number).
let requests = 0;
let session = "1:1";
const render = () => act(() => root.render(<TransactionMoveHistory call={call} sessionKey={session} openRequest={requests} />));
const mount = (sessionKey = "1:1") => { session = sessionKey; requests = 0; render(); };
const openHistory = async () => act(async () => { requests += 1; render(); });
const click = async (label: string) => act(async () => { [...document.querySelectorAll("button")].find((b) => b.textContent === label)!.click(); });
beforeEach(() => { call.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });

it("has no button of its own and opens only when the page asks", async () => {
  call.mockResolvedValue([]);
  mount();
  expect(document.querySelector("[data-account-move-history]")).toBeNull();
  expect(call).not.toHaveBeenCalled();
  await openHistory();
  expect(call).toHaveBeenCalledExactlyOnceWith("list_transaction_account_moves", { limit: 50 });
  expect(document.body.textContent).toContain("No account moves have been recorded.");
});

it("loads read-only history and exposes recorded before/after balances and historical limitations", async () => {
  call.mockResolvedValue([{
    operationId: "operation-1", mode: "confirmation", effectiveDate: "2026-10-29", destinationAccountId: 2, destinationName: "Savings",
    movedCount: 1, movedIds: [1], affectedAccountIds: [1, 2], confirmedAccountIds: [1, 2], correctedCheckpoints: 0,
    accounts: [{ accountId: 1, name: "Checking", role: "source", label: "Balance", displayedBefore: "900", displayedAfter: "1000" }], inputs: [], corrections: 2,
  }]);
  mount(); await openHistory();
  expect(call).toHaveBeenCalledExactlyOnceWith("list_transaction_account_moves", { limit: 50 });
  expect(document.querySelector("summary")?.textContent).toContain("1 transaction to Savings");
  expect(document.body.textContent).toContain("Balance $900.00 → $1,000.00");
  expect(document.body.textContent).toContain("did not reconstruct past balances");
  await click("Close");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("shows an empty state and refuses malformed history instead of inventing a result", async () => {
  call.mockResolvedValueOnce([]);
  mount(); await openHistory();
  expect(document.body.textContent).toContain("No account moves have been recorded");
  await click("Close");
  call.mockResolvedValueOnce([{}]);
  await openHistory();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("incomplete move history");
});

it.each(["close", "switch"])("discards a pending history response after %s", async (action) => {
  let finish!: (value: unknown) => void;
  call.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  mount(); await openHistory();
  // Switching profile keeps the page's request number: only a new request opens the history again.
  if (action === "close") await click("Close"); else { session = "2:2"; render(); }
  await act(async () => { finish([]); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).not.toContain("No account moves");
});

const record = (n: number, mode: "automatic" | "confirmation", corrected: number) => ({
  operationId: `operation-${n}`, mode, effectiveDate: "2026-10-29", destinationAccountId: 2, destinationName: "Savings",
  movedCount: 1, movedIds: [n], affectedAccountIds: [1, 2], confirmedAccountIds: [], correctedCheckpoints: corrected,
  accounts: [{ accountId: 1, name: "Checking", role: "source", label: "Balance", displayedBefore: "900", displayedAfter: "1000" }], inputs: [], corrections: 0,
});

it("uses correct singular and plural wording for the number of moves and corrected balances", async () => {
  call.mockResolvedValueOnce([]);
  mount(); await openHistory();
  expect(document.body.textContent).not.toMatch(/latest 0/);
  await click("Close");
  call.mockResolvedValueOnce([record(1, "automatic", 1)]);
  await openHistory();
  expect(document.body.textContent).toContain("The latest account move in this profile");
  expect(document.body.textContent).not.toMatch(/latest 1 account moves/);
  expect(document.body.textContent).toContain("1 saved balance corrected automatically");
  expect(document.body.textContent).not.toMatch(/1 saved balances/);
  await click("Close");
  call.mockResolvedValueOnce([record(1, "automatic", 0), record(2, "automatic", 2)]);
  await openHistory();
  expect(document.body.textContent).toContain("The latest 2 account moves in this profile");
  expect(document.body.textContent).toContain("No saved balances needed correcting");
  expect(document.body.textContent).toContain("2 saved balances corrected automatically");
});
