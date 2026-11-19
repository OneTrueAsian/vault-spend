// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CutPreviewDialog, type CutPreviewScreen } from "./CutPreviewDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The savings-target choices screen names what is still missing. The owner filled everything except one maximum cut unit and saw only
 * "Enter a nonnegative amount with at most two decimal places." at the bottom, with "Review the details" greyed out and no field marked.
 */
const TODAY = "2026-11-19";
const screen = (amount: string, categories: { category: string; monthlyFloor: string | null; maximumReduction: { kind: "money" | "percent" | null; amount: string } | null }[]): CutPreviewScreen => ({
  stage: "choices", today: TODAY, categories: ["Dining Out", "Entertainment"],
  draft: { sourceText: "Where can I cut back to save $200 a month?", target: { kind: "monthly", amount }, categories: categories as never, excludedCategories: [],
    horizon: { kind: "prospective", from: TODAY, to: "2026-12-31" }, partialMonth: "prorate", missing: [] },
});
const ENTERTAINMENT = { category: "Entertainment", monthlyFloor: "0", maximumReduction: { kind: "percent" as const, amount: "100" } };

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });
function show(s: CutPreviewScreen) {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const noop = () => {};
  act(() => root!.render(<CutPreviewDialog screen={s} onChoices={noop} onConfirm={noop} onRemoveCategory={noop} onEdit={noop} onRestart={noop} onClose={noop} />));
}
const review = () => [...document.querySelectorAll("button")].find(b => b.textContent === "Review the details")!;
const missing = () => document.querySelector("[data-choices-missing]")?.textContent ?? "";

describe("savings-target choices say what is still missing", () => {
  it("names the category whose maximum cut needs dollars or percent, and marks that box", () => {
    show(screen("200", [{ category: "Dining Out", monthlyFloor: "100", maximumReduction: { kind: null, amount: "400" } }, ENTERTAINMENT]));
    expect(review().disabled).toBe(true);
    expect(missing()).toBe("Choose dollars or percent for the Dining Out maximum cut.");
    expect(document.body.textContent).not.toContain("Enter a nonnegative amount with at most two decimal places.");
    expect(document.querySelector('[data-unit-problem="Dining Out"]')!.textContent).toBe("Choose dollars or percent.");
    expect(document.querySelector('[data-unit-problem="Entertainment"]')).toBeNull();
  });

  it("names a missing savings target", () => {
    show(screen("", [ENTERTAINMENT]));
    expect(missing()).toBe("Enter a savings target.");
  });

  it("names a missing monthly floor and a missing maximum cut", () => {
    show(screen("200", [{ category: "Dining Out", monthlyFloor: null, maximumReduction: null }, ENTERTAINMENT]));
    expect(missing()).toBe("Enter a monthly floor for Dining Out.");
    show(screen("200", [{ category: "Dining Out", monthlyFloor: "100", maximumReduction: null }, ENTERTAINMENT]));
    expect(missing()).toBe("Enter a maximum cut for Dining Out.");
  });

  it("asks for at least one category before anything else about categories", () => {
    show(screen("200", []));
    expect(missing()).toBe("Choose at least one category.");
  });

  it("says nothing is missing once every choice is made", () => {
    show(screen("200", [{ category: "Dining Out", monthlyFloor: "100", maximumReduction: { kind: "money", amount: "40" } }, ENTERTAINMENT]));
    expect(review().disabled).toBe(false);
    expect(document.querySelector("[data-choices-missing]")).toBeNull();
  });
});
