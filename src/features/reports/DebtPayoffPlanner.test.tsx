// @vitest-environment jsdom
//
// VS-31 step 0 (F5): the debt payoff planner lives in its own file. Cash Flow shows it and Reports does
// not, so it no longer sits in the Reports overview file where both pages' work would collide.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Account } from "../../shared/lib/types";
import { DebtPayoffPlannerSection } from "./DebtPayoffPlanner";
import * as ReportsOverviewModule from "./ReportsOverview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const card: Account = {
  id: 7,
  name: "Rewards Card",
  account_type: "credit",
  starting_balance: "0",
  current_balance: "-1200.50",
  institution: null,
  mask: null,
  interest_rate: "19.99",
  excluded_from_debt_payoff: false,
  member_id: null,
  member_name: null,
  checkpoint_date: null,
  icon_key: null,
  import_flip_signs: null,
  hidden: false,
} as Account;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("DebtPayoffPlannerSection in its own file", () => {
  it("renders the planner for a debt with a balance owed", () => {
    act(() =>
      root.render(
        <DebtPayoffPlannerSection
          accounts={[card]}
          onSetAccountInterestRate={vi.fn()}
          onCalculateDebtPayoff={vi.fn(async () => null)}
          onSetAccountExcludedFromDebtPayoff={vi.fn()}
          layoutWidgets={[]}
          onPinWidget={vi.fn()}
        />,
      ),
    );
    expect(host.querySelector(".reports-section-title")?.textContent).toBe("Debt Payoff Planner");
    expect(host.textContent).toContain("Rewards Card");
  });

  it("is no longer exported from the Reports overview file", () => {
    expect("DebtPayoffPlannerSection" in ReportsOverviewModule).toBe(false);
  });
});
