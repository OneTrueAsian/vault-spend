// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TransactionMoveHistory } from "./TransactionMoveHistory";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const call = vi.fn();
const mount = (sessionKey = "1:1") => act(() => root.render(<TransactionMoveHistory call={call} sessionKey={sessionKey} />));
const click = async (label: string) => act(async () => { [...document.querySelectorAll("button")].find((b) => b.textContent === label)!.click(); });
beforeEach(() => { call.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });

it("loads read-only history and exposes recorded before/after balances and historical limitations", async () => {
  call.mockResolvedValue([{
    operationId: "operation-1", mode: "confirmation", effectiveDate: "2026-10-29", destinationAccountId: 2, destinationName: "Savings",
    movedCount: 1, movedIds: [1], affectedAccountIds: [1, 2], confirmedAccountIds: [1, 2], correctedCheckpoints: 0,
    accounts: [{ accountId: 1, name: "Checking", role: "source", label: "Balance", displayedBefore: "900", displayedAfter: "1000" }], inputs: [], corrections: 2,
  }]);
  mount(); await click("Account move history");
  expect(call).toHaveBeenCalledExactlyOnceWith("list_transaction_account_moves", { limit: 50 });
  expect(document.querySelector("summary")?.textContent).toContain("1 transaction to Savings");
  expect(document.body.textContent).toContain("Balance $900.00 → $1,000.00");
  expect(document.body.textContent).toContain("did not reconstruct past balances");
  await click("Close");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("shows an empty state and refuses malformed history instead of inventing a result", async () => {
  call.mockResolvedValueOnce([]);
  mount(); await click("Account move history");
  expect(document.body.textContent).toContain("No account moves have been recorded");
  await click("Close");
  call.mockResolvedValueOnce([{}]);
  await click("Account move history");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("incomplete move history");
});

it.each(["close", "switch"])("discards a pending history response after %s", async (action) => {
  let finish!: (value: unknown) => void;
  call.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  mount(); await click("Account move history");
  if (action === "close") await click("Close"); else mount("2:2");
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
  mount(); await click("Account move history");
  expect(document.body.textContent).not.toMatch(/latest 0/);
  await click("Close");
  call.mockResolvedValueOnce([record(1, "automatic", 1)]);
  await click("Account move history");
  expect(document.body.textContent).toContain("The latest account move in this profile");
  expect(document.body.textContent).not.toMatch(/latest 1 account moves/);
  expect(document.body.textContent).toContain("1 saved balance corrected automatically");
  expect(document.body.textContent).not.toMatch(/1 saved balances/);
  await click("Close");
  call.mockResolvedValueOnce([record(1, "automatic", 0), record(2, "automatic", 2)]);
  await click("Account move history");
  expect(document.body.textContent).toContain("The latest 2 account moves in this profile");
  expect(document.body.textContent).toContain("No saved balances needed correcting");
  expect(document.body.textContent).toContain("2 saved balances corrected automatically");
});
