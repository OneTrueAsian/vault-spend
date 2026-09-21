// @vitest-environment jsdom
//
// Two things about how the accumulation screens treat a request that goes wrong,
// each of which used to look like something else:
//
//  - The Investments tab's summary card, when its data can't be loaded, must say
//    so. It used to render nothing, which looked exactly like a portfolio with no
//    investment accounts and gave the person no way to try again.
//  - The Details page's "Save plan" must send the plan and the shared inflation
//    setting as ONE request (so a refusal can't leave half of it saved), and must
//    not report a failed save when the save worked and only the refresh after it
//    failed.
//
// Like Modal.test.tsx, this drives the real components in jsdom, with the backend
// requests mocked at the Tauri boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Account, InvestmentAccumulation } from "./types";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { AccountAccumulationSection, AccumulationSummaryCard } from "./AccumulationSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function account(id: number, name: string, accountType: string): Account {
  return {
    id,
    name,
    account_type: accountType,
    starting_balance: "0.00",
    current_balance: "5000.00",
    institution: null,
    mask: null,
    interest_rate: null,
    excluded_from_debt_payoff: false,
    member_id: null,
    member_name: null,
    checkpoint_date: null,
    icon_key: null,
  };
}

const roth = account(1, "Joey Roth IRA", "investment");
const checking = account(2, "Everyday Checking", "checking");

const accumulation: InvestmentAccumulation = {
  account_id: 1,
  months: [{ month: "2026-08", money_in: "450.00", money_out: "0.00" }],
  total_in: "450.00",
  total_out: "0.00",
  net: "450.00",
  first_deposit: "2026-08-01",
  deposit_count: 1,
  plan: { monthly_contribution: null, annual_return_pct: "7", withdraw_month: null, withdraw_years: null },
};

/** The backend answering normally. `overrides` replaces the answer for one command. */
function backendWorks(overrides: Record<string, (args: unknown) => unknown> = {}) {
  invokeMock.mockImplementation(async (command: string, args: unknown) => {
    if (overrides[command]) return overrides[command](args);
    switch (command) {
      case "list_investment_accumulation":
        return [accumulation];
      case "investment_accumulation":
        return accumulation;
      case "account_value_history":
        return [];
      case "get_inflation_pct":
        return "3";
      case "set_investment_plan":
        return undefined;
      default:
        throw new Error(`unexpected command ${command}`);
    }
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  invokeMock.mockReset();
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** Types into a React-controlled input the way a person would (a plain `.value =` isn't seen by React). */
function typeInto(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AccumulationSummaryCard", () => {
  async function show(accounts: Account[]) {
    await act(async () => {
      root.render(<AccumulationSummaryCard accounts={accounts} onOpenAccount={() => {}} />);
    });
    await settle();
  }

  it("shows the table once the summary has loaded", async () => {
    backendWorks();
    await show([roth, checking]);
    expect(container.querySelector("[data-acc-summary-table]")).not.toBeNull();
    expect(container.querySelector("[data-acc-summary-row='Joey Roth IRA']")).not.toBeNull();
  });

  it("says the summary couldn't be loaded, and why, instead of rendering nothing", async () => {
    invokeMock.mockRejectedValue("database is locked");
    await show([roth]);
    const card = container.querySelector("[data-acc-summary-error]");
    expect(card, "a failed load should leave a visible message").not.toBeNull();
    expect(card!.textContent).toContain("Couldn't load the accumulation summary");
    expect(card!.textContent).toContain("database is locked");
    expect(container.querySelector("[data-acc-summary-table]")).toBeNull();
  });

  it("offers Try again, and shows the table once the request works", async () => {
    invokeMock.mockRejectedValue("database is locked");
    await show([roth]);
    backendWorks();
    const retry = container.querySelector<HTMLButtonElement>("[data-acc-summary-retry]");
    expect(retry, "the message should carry a retry button").not.toBeNull();
    await act(async () => {
      retry!.click();
    });
    await settle();
    expect(container.querySelector("[data-acc-summary-error]")).toBeNull();
    expect(container.querySelector("[data-acc-summary-row='Joey Roth IRA']")).not.toBeNull();
  });

  it("says in the total row that each account's number is taken at its own date, and how many were left out", async () => {
    const sam = account(3, "Sam's 529", "investment");
    const alex = account(4, "Alex's 529", "investment");
    backendWorks({
      list_investment_accumulation: () => [
        { ...accumulation, account_id: 1, plan: { ...accumulation.plan, monthly_contribution: "100", withdraw_month: "2040-09" } },
        { ...accumulation, account_id: 3 },
        { ...accumulation, account_id: 4 },
      ],
    });
    await show([roth, sam, alex]);
    const caption = container.querySelector("[data-acc-total-caption]");
    expect(caption, "the total's Projected cell should say what the figure is").not.toBeNull();
    expect(caption!.textContent).toContain("each at its own date");
    expect(caption!.textContent).toContain("2 left out");
    // The amount stays alone in its own element, where the specs and readers look for it.
    expect(container.querySelector("[data-acc-total-projected]")!.textContent).toMatch(/^\$[\d,]+\.\d{2}$/);
  });

  it("doesn't mention left-out accounts when every account has a withdraw date", async () => {
    backendWorks({
      list_investment_accumulation: () => [{ ...accumulation, plan: { ...accumulation.plan, monthly_contribution: "100", withdraw_month: "2040-09" } }],
    });
    await show([roth]);
    const caption = container.querySelector("[data-acc-total-caption]");
    expect(caption!.textContent).toBe("each at its own date");
  });

  it("still renders nothing when there are no investment accounts, even if the request fails", async () => {
    invokeMock.mockRejectedValue("database is locked");
    await show([checking]);
    expect(container.innerHTML).toBe("");
  });
});

describe("AccountAccumulationSection saving", () => {
  const onMessage = vi.fn();

  async function showDetails() {
    onMessage.mockReset();
    await act(async () => {
      root.render(<AccountAccumulationSection account={roth} onMessage={onMessage} onOpenTransactions={() => {}} />);
    });
    await settle();
  }

  async function pressSave() {
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-acc-save]")!.click();
    });
    await settle();
  }

  it("sends the plan and a changed inflation as one request, so a refusal can't save half of it", async () => {
    backendWorks();
    await showDetails();
    typeInto("[data-acc-return]", "5");
    typeInto("[data-acc-inflation]", "4");
    await pressSave();

    const commands = invokeMock.mock.calls.map((call) => call[0]);
    expect(commands, "the inflation is no longer written by a second request").not.toContain("set_inflation_pct");
    const save = invokeMock.mock.calls.find((call) => call[0] === "set_investment_plan");
    expect(save, "the plan should be saved").toBeDefined();
    expect(save![1]).toMatchObject({ accountId: 1, annualReturnPct: "5", inflationPct: "4" });
  });

  it("leaves the inflation out of the request when it wasn't changed", async () => {
    backendWorks();
    await showDetails();
    typeInto("[data-acc-return]", "5");
    await pressSave();

    const save = invokeMock.mock.calls.find((call) => call[0] === "set_investment_plan");
    expect(save![1]).toMatchObject({ accountId: 1, annualReturnPct: "5", inflationPct: null });
  });

  it("shows the backend's refusal and doesn't claim the plan was saved", async () => {
    backendWorks({
      set_investment_plan: () => {
        throw "Inflation has to be between 0 and 100%.";
      },
    });
    await showDetails();
    typeInto("[data-acc-inflation]", "100.0000000000000000001");
    await pressSave();

    expect(container.querySelector("[data-acc-error]")!.textContent).toContain("Inflation has to be between 0 and 100%.");
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("doesn't report a failed save when the save worked and only the refresh afterwards failed", async () => {
    let saved = false;
    backendWorks({
      set_investment_plan: () => {
        saved = true;
      },
      investment_accumulation: () => {
        if (saved) throw new Error("the refresh failed");
        return accumulation;
      },
    });
    await showDetails();
    typeInto("[data-acc-return]", "5");
    await pressSave();

    expect(container.querySelector("[data-acc-error]"), "the plan is saved, so the form must not say it failed").toBeNull();
    expect(onMessage).toHaveBeenCalledWith(expect.stringContaining("Saved the plan for Joey Roth IRA"), expect.anything());
  });
});
