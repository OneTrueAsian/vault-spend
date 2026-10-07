// @vitest-environment jsdom
//
// Account details opened from an account row's "Reconcile with a statement…" (UAT s7.1) start at the
// reconcile card, ready to type the statement's ending balance.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDetailView } from "./AccountDetailView";
import type { Account } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve([])) }));

const account: Account = { id: 7, name: "Everyday Checking", account_type: "checking", starting_balance: "100", current_balance: "123.45", institution: null, mask: null, interest_rate: null, excluded_from_debt_payoff: false, member_id: null, member_name: null, checkpoint_date: null, icon_key: null, import_flip_signs: null };

let host: HTMLDivElement;
let root: Root;
const scrolled = vi.fn();
beforeEach(() => {
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled(this);
  };
  scrolled.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const show = (focus?: "reconcile") =>
  act(() => root.render(<AccountDetailView account={account} onBack={() => {}} onOpenTransactions={() => {}} onOpenPayment={() => {}} onMessage={() => {}} focus={focus} />));

describe("AccountDetailView opened to reconcile", () => {
  it("scrolls to the reconcile card and puts the cursor in the ending balance", () => {
    show("reconcile");
    expect(scrolled).toHaveBeenCalledWith(host.querySelector("[data-reconcile-card]"));
    expect(document.activeElement).toBe(host.querySelector('.reconcile-form input[placeholder="0.00"]'));
  });

  it("opens at the top as usual otherwise", () => {
    show();
    expect(scrolled).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(host.querySelector('.reconcile-form input[placeholder="0.00"]'));
  });
});
