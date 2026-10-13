// @vitest-environment jsdom
//
// Account details opened from an account row's "Reconcile with a statement…" (UAT s7.1) start at the
// reconcile card, ready to type the statement's ending balance.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDetailView } from "./AccountDetailView";
import type { Account } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve([])) }));
// The investment chart section loads on its own and has its own tests; here it would only race the
// mocked answers (it reads its own commands), so it is left out.
vi.mock("./AccumulationSection", () => ({ AccountAccumulationSection: () => null }));

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
    expect(document.activeElement).toBe(host.querySelector("[data-statement-balance]"));
  });

  it("opens at the top as usual otherwise", () => {
    show();
    expect(scrolled).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(host.querySelector("[data-statement-balance]"));
  });
});

/** Answers each command from `answers`; anything not listed returns an empty list, as the default mock does. */
function answer(answers: Record<string, unknown>) {
  vi.mocked(invoke).mockImplementation(async (command: string) => (command in answers ? answers[command] : []));
}
const showAccount = (shown: Account) =>
  act(async () => root.render(<AccountDetailView account={shown} onBack={() => {}} onOpenTransactions={() => {}} onOpenPayment={() => {}} onMessage={() => {}} />));

describe("AccountDetailView reconciling any account", () => {
  it("asks for a starting balance on the first reconciliation and offers reconciling on a credit card", async () => {
    const card: Account = { ...account, id: 9, name: "Rewards Card", account_type: "credit" };
    answer({ last_reconciliation: null });
    await showAccount(card);

    expect(host.textContent).not.toContain("Reconciliation is for checking and savings accounts");
    expect(host.querySelector("[data-statement-start-balance]")).not.toBeNull();
    expect(host.textContent).toContain("Amount owed at the start of the statement");
    expect(host.textContent).toContain("Amount owed at the end of the statement");
  });

  it("uses plain owed-on-the-loan wording for a loan", async () => {
    answer({ last_reconciliation: null });
    await showAccount({ ...account, id: 10, name: "Mortgage", account_type: "loan" });

    expect(host.textContent).toContain("Amount you owed on the loan at the start of the statement");
    expect(host.textContent).toContain("Amount you owed on the loan at the end of the statement");
  });

  it("explains that an investment account checks its cash activity", async () => {
    answer({ last_reconciliation: null });
    await showAccount({ ...account, id: 11, name: "Brokerage", account_type: "investment" });

    expect(host.textContent).toContain("For an investment account this checks its cash activity.");
  });

  it("hides the starting balance after a previous reconciliation and says where it picks up from", async () => {
    answer({
      last_reconciliation: { statement_date: "2026-08-31", statement_balance: "1150.00" },
      reconcile_status: { starting_point: "1180.25", needs_starting_balance: false, ticked_change: "0", ticked_count: 0, difference: null },
    });
    await showAccount(account);

    expect(host.querySelector("[data-statement-start-balance]")).toBeNull();
    // The amount comes from the balance check for this statement's date, not the last record.
    expect(host.querySelector("[data-reconcile-picks-up]")?.textContent).toBe(
      "Picks up from your last reconciliation before this statement: $1,180.25.",
    );
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("reconcile_status", {
      accountId: account.id,
      statementDate: expect.any(String),
      statementStart: null,
      statementEnd: null,
    });
  });

  it("asks for a starting balance when the statement is older than every reconciliation", async () => {
    answer({
      last_reconciliation: { statement_date: "2026-09-30", statement_balance: "1170.00" },
      reconcile_status: { starting_point: null, needs_starting_balance: true, ticked_change: "0", ticked_count: 0, difference: null },
    });
    await showAccount(account);

    expect(host.querySelector("[data-statement-start-balance]")).not.toBeNull();
    expect(host.querySelector("[data-reconcile-picks-up]")).toBeNull();
  });

  it("shows when an investment account was last reconciled by its statement", async () => {
    answer({
      last_reconciliation: { statement_date: "2026-09-30", statement_balance: null },
      reconcile_status: { starting_point: null, needs_starting_balance: true, ticked_change: "0", ticked_count: 0, difference: null },
    });
    await showAccount({ ...account, id: 11, name: "Brokerage", account_type: "investment" });

    expect(host.querySelector("[data-last-reconciled]")?.getAttribute("data-last-reconciled")).toBe("2026-09-30");
    expect(host.querySelector("[data-last-reconciled] .stat-value")?.textContent).not.toBe("Never");
    expect(host.querySelector("[data-statement-start-balance]")).not.toBeNull();
  });

  it("will not start until the first reconciliation has a starting balance", async () => {
    answer({ last_reconciliation: null });
    await showAccount(account);
    const type = (selector: string, value: string) =>
      act(async () => {
        const input = host.querySelector<HTMLInputElement>(selector)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const start = () => host.querySelector<HTMLButtonElement>("[data-reconcile-start]")!;

    await type("[data-statement-balance]", "1150.00");
    expect(start().disabled).toBe(true);
    await type("[data-statement-start-balance]", "1000.00");
    expect(start().disabled).toBe(false);
  });

  it("checks the balance as of the statement's end date, so an older month starts from the month before it", async () => {
    answer({
      last_reconciliation: { statement_date: "2026-09-30", statement_balance: "1170.00" },
      reconcile_status: { starting_point: "1200.00", needs_starting_balance: false, ticked_change: "-50.00", ticked_count: 1, difference: "0.00" },
    });
    await showAccount(account);
    await act(async () => {
      const date = host.querySelector<HTMLInputElement>("[data-statement-date]")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(date, "2026-08-31");
      date.dispatchEvent(new Event("input", { bubbles: true }));
      date.dispatchEvent(new Event("change", { bubbles: true }));
      const end = host.querySelector<HTMLInputElement>("[data-statement-balance]")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(end, "1150.00");
      end.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // A new end date asks again where that statement picks up from.
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("reconcile_status", {
      accountId: account.id,
      statementDate: "2026-08-31",
      statementStart: null,
      statementEnd: null,
    });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-reconcile-start]")!.click());

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("reconcile_status", {
      accountId: account.id,
      statementDate: "2026-08-31",
      statementStart: null,
      statementEnd: "1150.00",
    });
  });
});
