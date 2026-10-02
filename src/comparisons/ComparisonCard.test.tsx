// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ComparisonCard } from "./ComparisonCard";
import { adjusted, comparableIncome, metric, result, unavailable } from "./testFixtures";
import { menuOptions, pickMenuOption } from "../menuSelectTestUtils";
import type { CardView } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ComparisonCard", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onExplore = vi.fn();
  const onChooseUniverse = vi.fn();
  const onChooseCohort = vi.fn();

  beforeEach(() => {
    onExplore.mockReset();
    onChooseUniverse.mockReset();
    onChooseCohort.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const show = (view: CardView) =>
    act(() => {
      root.render(<ComparisonCard view={view} onExplore={onExplore} onChooseUniverse={onChooseUniverse} onChooseCohort={onChooseCohort} />);
    });
  const text = () => container.textContent ?? "";
  const q = (sel: string) => container.querySelector<HTMLElement>(sel);

  it("shows the person's figure, the peer figure, the difference and the group it describes", () => {
    show(comparableIncome());

    expect(q("[data-cmp-local]")?.textContent).toContain("$120,000");
    expect(q("[data-cmp-local]")?.textContent).toContain("per year");
    expect(q("[data-cmp-difference]")?.textContent).toBe("$15,000 above · +14.3%");
    expect(q("[data-cmp-reference]")?.textContent).toContain("ages 40–44");
    expect(q("[data-cmp-reference]")?.textContent).toContain("2025");
    expect(q("[data-cmp-reference]")?.textContent).toContain("2026-08 dollars");
    expect(text()).toContain("$105,000");
    expect(text()).toContain("Median");
  });

  it("says where the figure came from and flags an out-of-date typed total", () => {
    show(comparableIncome({ stale: true }));
    expect(text()).toContain("Entered by you");
    expect(text()).toContain("may be out of date");
  });

  it("describes a tracked figure as coming from the person's accounts", () => {
    show(comparableIncome({ metric: metric("income", { origin: { kind: "derived" } }) }));
    expect(text()).toContain("From your tracked accounts");
  });

  it("explains a benchmark gap as the benchmark's limit and shows no difference", () => {
    show(unavailable("spending"));

    expect(q("[data-cmp-notice]")?.textContent).toContain("No matching benchmark");
    expect(q("[data-cmp-difference]")).toBeNull();
    expect(q(".cmp-bars")).toBeNull();
    expect(q("[data-cmp-local]")).toBeNull();
    expect(q(".cmp-measure")).toBeNull();
    expect(text()).not.toContain("per year");
  });

  it("keeps a benchmark that was dropped from the package visible with its own wording", () => {
    show(unavailable("savings", { code: "benchmark_removed" }));
    expect(text()).toContain("Benchmark no longer available in the current reference package");
  });

  it("warns, visibly, when an approximate comparison used a substitute age group", () => {
    const view = comparableIncome();
    view.result = { ...view.result, status: "approximate", reasons: [{ code: "nearest_cohort_used", cohort: "x" }] };
    show(view);

    const warning = q(".cmp-notice-warning");
    expect(warning?.textContent).toContain("Approximate");
    expect(q("[data-cmp-difference]")).not.toBeNull();
  });

  it("labels a holders-only comparison", () => {
    const view = comparableIncome();
    view.result = { ...view.result, reference: adjusted({ universe: "holders", metric: "savings" }) };
    show(view);
    expect(q("[data-cmp-holders-only]")?.textContent).toContain("Only people who hold this");
  });

  it("offers an All peers / Holders only choice only when both exist, and reports the pick", () => {
    show(comparableIncome());
    expect(q("[data-cmp-universe]")).toBeNull();

    show(comparableIncome({ universeOptions: ["all", "holders"] }));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("[data-cmp-universe]")];
    expect(buttons.map((b) => b.textContent)).toEqual(["All peers", "Only people who hold this"]);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    act(() => buttons[1].click());
    expect(onChooseUniverse).toHaveBeenCalledWith("holders");
  });

  it("asks which published age group to use when the entered range spans several", () => {
    const view: CardView = {
      ...comparableIncome(),
      result: result("income", "cohort_choice_required", { reasons: [{ code: "cohort_choice_required", options: ["a", "b"] }], localValue: null }),
      cohortOptions: [
        { id: "a", ageMin: 25, ageMax: 29 },
        { id: "b", ageMin: 30, ageMax: 34 },
      ],
    };
    show(view);

    expect(q("[data-cmp-notice]")?.textContent).toContain("Choose the age group");
    const trigger = q("[data-cmp-cohort-picker] button")!;
    expect(menuOptions(trigger).map((o) => o.label)).toEqual(["Ages 25–29", "Ages 30–34"]);
    pickMenuOption(trigger, "b");
    expect(onChooseCohort).toHaveBeenCalledWith("b");
  });

  it("does not show an unconfirmed, partly assigned total next to a benchmark gap", () => {
    const view = unavailable("savings");
    view.metric = metric("savings", { value: "0", origin: { kind: "derived" }, completeness: "partial" });
    show(view);
    expect(q("[data-cmp-local]")).toBeNull();
    expect(text()).toContain("No matching benchmark");
  });

  it("keeps a confirmed total visible beside a benchmark gap", () => {
    const view = unavailable("savings");
    view.metric = metric("savings", { value: "8000", origin: { kind: "derived" }, completeness: "confirmed" });
    show(view);
    expect(q("[data-cmp-local]")?.textContent).toContain("$8,000");
  });

  it("opens the details", () => {
    show(comparableIncome());
    act(() => q(".cmp-explore")!.click());
    expect(onExplore).toHaveBeenCalledTimes(1);
  });

  it("puts every dollar amount in text, where the privacy mask can reach it, and none in labels", () => {
    show(comparableIncome());
    const labelled = [...container.querySelectorAll("[aria-label], [title]")].map((el) => `${el.getAttribute("aria-label") ?? ""}${el.getAttribute("title") ?? ""}`);
    expect(labelled.join(" ")).not.toMatch(/\$\d/);
    expect(q(".cmp-bars")?.getAttribute("aria-hidden")).toBe("true");
  });
});
