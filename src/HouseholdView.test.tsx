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
