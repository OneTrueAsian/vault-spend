import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HouseholdView } from "./HouseholdView";

const props = {
  transactions: [], accounts: [], assets: [], familyMembers: [{ id: 1, name: "Fixture member" }],
  memberBudgetActuals: [], monthLabel: "October 2026", year: 2026, month: 10,
  onPrevMonth: () => {}, onNextMonth: () => {}, onManageMembers: () => {},
};
describe("Household budget read readiness", () => {
  it("does not imply no budgeted spending before a valid snapshot", () => {
    const html = renderToStaticMarkup(<HouseholdView {...props} budgetReadReady={false} />);
    expect(html).not.toContain("No budgeted spending yet");
    expect(html).not.toContain("Budget, by category and person");
    expect(html).toContain("Previous month");
    expect(html).toContain("Net worth by person");
  });
  it("shows a genuine empty state after a valid snapshot", () => {
    const html = renderToStaticMarkup(<HouseholdView {...props} budgetReadReady />);
    expect(html).toContain("No budgeted spending yet");
  });
});

describe("Household spending by person (QA-FUNC-007)", () => {
  const txn = (id: number, date: string, amount: string, member: string | null, over: Record<string, unknown> = {}) => ({
    id, date, amount, description: `Purchase ${id}`, category: "Groceries", member_id: member ? 1 : null, member_name: member,
    transfer_counterpart_id: null, account_id: 1, account_name: "Checking", category_source: "user", confidence: null,
    applied_to_debt: null, principal_amount: null, split_count: 0, tags: [], notes: null, ...over,
  });
  const render = (transactions: unknown[]) =>
    renderToStaticMarkup(<HouseholdView {...props} transactions={transactions as never} budgetReadReady />);
  const spendingCard = (html: string) => html.slice(html.indexOf("Spending by person"), html.indexOf("Income by person"));

  it("lists an Unassigned line with this month's unattributed spending", () => {
    const card = spendingCard(render([txn(1, "2026-10-03", "-30.00", "Fixture member"), txn(2, "2026-10-04", "-12.25", null), txn(3, "2026-10-09", "-7.75", null)]));
    expect(card).toContain("Fixture member");
    expect(card).toContain("$30.00");
    expect(card).toMatch(/Unassigned<\/span><span>\$20\.00/);
  });

  it("only counts the viewed month, and leaves transfers and money in out", () => {
    const card = spendingCard(
      render([
        txn(1, "2026-09-30", "-99.00", null), // last month
        txn(2, "2026-10-02", "-500.00", null, { category: "Transfer" }),
        txn(3, "2026-10-05", "20.00", null), // money in
        txn(4, "2026-10-06", "-8.00", null),
      ]),
    );
    expect(card).toMatch(/Unassigned<\/span><span>\$8\.00/);
    expect(card).not.toContain("$99.00");
  });

  it("keeps the empty message only when there is no spending at all", () => {
    expect(spendingCard(render([]))).toContain("No spending this month.");
    expect(spendingCard(render([txn(1, "2026-10-03", "-5.00", null)]))).not.toContain("No spending");
  });
});
