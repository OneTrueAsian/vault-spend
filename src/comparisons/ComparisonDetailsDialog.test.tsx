// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { startPrivacyMask } from "../privacy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

import { ComparisonDetailsDialog } from "./ComparisonDetailsDialog";
import { ComparisonCard } from "./ComparisonCard";
import { adjusted, comparableIncome, metric, unavailable } from "./testFixtures";
import type { CardView } from "./types";

describe("ComparisonDetailsDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    opener.openUrl.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const show = (view: CardView) => act(() => root.render(<ComparisonDetailsDialog view={view} onClose={() => {}} />));
  const text = () => document.querySelector("[data-cmp-details]")?.textContent ?? "";

  it("names the population, age group, statistic, period, dollar basis, uncertainty and source", () => {
    show(comparableIncome());
    const t = text();

    expect(t).toContain("Households by age of householder, total money income");
    expect(t).toContain("40–44");
    expect(t).toContain("Median");
    expect(t).toContain("2025");
    expect(t).toContain("As published");
    expect(t).toContain("$100,000 (2025-07 dollars)");
    expect(t).toContain("Adjusted for inflation to 2026-08");
    expect(t).toContain("Standard error");
    expect(t).toContain("± $1,050");
    expect(t).toContain("U.S. Census Bureau, CPS ASEC 2026");
    expect(t).toContain("hinc02_1_1.xlsx!K54");
  });

  it("opens the source link through the app's opener", () => {
    show(comparableIncome());
    act(() => (document.querySelector(".cmp-link") as HTMLButtonElement).click());
    expect(opener.openUrl).toHaveBeenCalledWith("https://example.gov/hinc02.xlsx");
  });

  it("explains that the difference is a distance from a median, not a ranking", () => {
    show(comparableIncome());
    expect(text()).toContain("not where you rank");
  });

  it("shows contributors with the person's share, what is unassigned, and what was left out and why", () => {
    const view = comparableIncome({
      metric: metric("savings", {
        origin: { kind: "derived" },
        contributors: [{ label: "Joint checking", source: { kind: "account", id: 1 }, gross: "1000", shareBasisPoints: 6000, counted: "600" }],
        unallocated: "400",
        excluded: [
          { label: "Brokerage", source: { kind: "account", id: 2 }, reason: "default_type_not_included" },
          { label: "Old card", source: { kind: "account", id: 3 }, reason: "user_excluded" },
        ],
      }),
    });
    show(view);
    const t = text();
    expect(t).toContain("Joint checking");
    expect(t).toContain("your share 60%");
    expect(t).toContain("$600");
    expect(t).toContain("Not assigned to anyone");
    expect(t).toContain("$400");
    expect(t).toContain("This kind of account does not count here");
    expect(t).toContain("You left this out");
  });

  it("keeps the tracked total visible when a typed total replaces it, and warns when it is stale", () => {
    const view = comparableIncome({
      metric: metric("income", {
        value: "50000",
        trackedValue: "42000",
        origin: { kind: "entered", measuredOn: "2024-01-01", explanation: "Offer letter", stale: true },
      }),
    });
    show(view);
    expect(text()).toContain("Your tracked accounts add up to $42,000");
    expect(text()).toContain("may be out of date; it is still being used");
    expect(text()).toContain("Offer letter");
  });

  it("shows an entered figure without a dangling colon when it has no note", () => {
    const view = comparableIncome({
      metric: metric("income", { value: "50000", origin: { kind: "entered", measuredOn: "2024-01-01", explanation: "  ", stale: false } }),
    });
    show(view);
    expect(text()).toContain("Entered on 2024-01-01.");
    expect(text()).not.toContain("2024-01-01:");
  });

  it("breaks totals down by type and compares each class with its own published figure", () => {
    const view: CardView = {
      ...comparableIncome({ metric: metric("debt", { origin: { kind: "derived" }, classTotals: { mortgage: "150000", credit_card: "0", student_loan: "9000" } }) }),
      secondary: [
        {
          label: "Home debt",
          definitionId: "sipp_home_debt_median",
          result: { ...comparableIncome().result, metric: "debt", localValue: "150000", reference: adjusted({ metric: "debt" }, "140000") },
        },
      ],
    };
    show(view);
    const t = text();
    expect(t).toContain("Mortgage / home loans");
    expect(t).toContain("Student loans");
    expect(t).not.toContain("Credit cards");
    expect(text()).toContain("$150,000 vs $140,000");
  });

  it("says plainly when there is nothing to compare with", () => {
    show(unavailable("spending"));
    expect(text()).toContain("No matching benchmark");
    expect(text()).not.toContain("The published figure");
  });

  it("is covered by the privacy mask: every amount is text, none is in an attribute", () => {
    show(comparableIncome());
    const stop = startPrivacyMask(document.body);
    const t = text();
    expect(t).not.toMatch(/\$\d/);
    expect(t).toContain("••••");
    stop();
    expect(text()).toContain("$105,000");
  });

  it("masks a card's amounts and leaves its age group and source visible", () => {
    act(() =>
      root.render(
        <ComparisonCard view={comparableIncome()} mode="household" onExplore={() => {}} onChooseUniverse={() => {}} onChooseCohort={() => {}} />,
      ),
    );
    const stop = startPrivacyMask(document.body);
    const card = container.textContent ?? "";
    expect(card).not.toMatch(/\$\d/);
    expect(card).toContain("ages 40–44");
    expect(card).toContain("U.S. Census Bureau");
    stop();
  });
});
