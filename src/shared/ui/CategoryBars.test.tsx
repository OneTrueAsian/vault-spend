// @vitest-environment jsdom
//
// VS-31 step 0 (F2): category bar rows for the Dashboard "Spending in <month> so far" card and the
// Budget "Spending against the plan" card. One dollar scale for every row; with a plan, the outline
// is the plan, the fill is what was spent, and spending past the plan is drawn separately.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CategoryBars, type CategoryBarRow } from "./CategoryBars";
import { startPrivacyMask } from "../lib/privacy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const spent: CategoryBarRow[] = [
  { key: "rent", label: "Rent", amount: 1650 },
  { key: "car", label: "Car upkeep", amount: 1240, note: "▲ $1,240" },
  { key: "dining", label: "Dining out", amount: 199 },
];

const planned: CategoryBarRow[] = [
  { key: "car", label: "Car upkeep", amount: 1240, plan: 100, note: "! $1,140 over", noteTone: "bad" },
  { key: "rent", label: "Rent", amount: 1650, plan: 1650, note: "$0 left" },
  { key: "groceries", label: "Groceries", amount: 197, plan: 520, note: "$323 left" },
];

const rows = () => [...host.querySelectorAll<HTMLTableRowElement>("table.category-bars tbody tr")];
const cells = (tr: HTMLTableRowElement) => [...tr.cells].map((c) => c.textContent);
const width = (el: Element | null) => (el as HTMLElement | null)?.style.width;

describe("CategoryBars", () => {
  it("is a real table whose caption names it and whose rows read name, amount and note", () => {
    act(() => root.render(<CategoryBars rows={spent} caption="Spending in November so far" />));
    const table = host.querySelector("table.category-bars")!;
    expect(table.querySelector("caption")?.textContent).toBe("Spending in November so far");
    expect(rows().map(cells)).toEqual([
      ["Rent", "", "$1,650.00", ""],
      ["Car upkeep", "", "$1,240.00", "▲ $1,240"],
      ["Dining out", "", "$199.00", ""],
    ]);
  });

  it("hides the bar column from screen readers, since the amount column says the same", () => {
    act(() => root.render(<CategoryBars rows={spent} caption="Spending" />));
    for (const tr of rows()) expect(tr.cells[1].getAttribute("aria-hidden")).toBe("true");
  });

  it("puts every row on one dollar scale set by the largest amount", () => {
    act(() => root.render(<CategoryBars rows={spent} caption="Spending" />));
    const fills = rows().map((tr) => width(tr.querySelector(".category-bars-fill")));
    expect(fills).toEqual(["100%", `${(1240 / 1650) * 100}%`, `${(199 / 1650) * 100}%`]);
  });

  it("shows amount against plan, with the plan outline and the overspend drawn separately", () => {
    act(() => root.render(<CategoryBars rows={planned} caption="Spending against the plan" />));
    const [car, rent, groceries] = rows();
    expect(cells(car)).toEqual(["Car upkeep", "", "$1,240.00 of $100.00", "! $1,140 over"]);
    // The scale is the largest of any amount or plan: 1,650.
    expect(width(car.querySelector(".category-bars-plan"))).toBe(`${(100 / 1650) * 100}%`);
    expect(width(car.querySelector(".category-bars-fill"))).toBe(`${(100 / 1650) * 100}%`);
    expect(width(car.querySelector(".category-bars-over"))).toBe(`${(1140 / 1650) * 100}%`);
    expect(rent.querySelector(".category-bars-over")).toBeNull();
    expect(width(groceries.querySelector(".category-bars-fill"))).toBe(`${(197 / 1650) * 100}%`);
    expect(width(groceries.querySelector(".category-bars-plan"))).toBe(`${(520 / 1650) * 100}%`);
  });

  it("marks a note's tone with a class, not with color alone in the text", () => {
    act(() => root.render(<CategoryBars rows={planned} caption="Plan" />));
    expect(rows()[0].cells[3].querySelector(".category-bars-note-bad")?.textContent).toBe("! $1,140 over");
  });

  it("draws a refund-only category (negative amount) with no bar but shows its real figure", () => {
    act(() => root.render(<CategoryBars rows={[{ key: "r", label: "Refunds", amount: -40 }, { key: "g", label: "Groceries", amount: 80 }]} caption="Spending" />));
    const [refund] = rows();
    expect(width(refund.querySelector(".category-bars-fill"))).toBe("0%");
    expect(cells(refund)[2]).toBe("-$40.00");
  });

  it("shows a negative plan's real figure, while drawing it as no plan", () => {
    act(() => root.render(<CategoryBars rows={[{ key: "x", label: "Refund line", amount: 10, plan: -20 }]} caption="Plan" />));
    expect(cells(rows()[0])[2]).toBe("$10.00 of -$20.00");
    expect(width(rows()[0].querySelector(".category-bars-plan"))).toBe("0%");
  });

  it("does not divide by zero when every amount and plan is zero", () => {
    act(() => root.render(<CategoryBars rows={[{ key: "a", label: "Gifts", amount: 0, plan: 0 }]} caption="Plan" />));
    expect(width(rows()[0].querySelector(".category-bars-fill"))).toBe("0%");
  });

  it("shows a plain message instead of an empty table when there are no rows", () => {
    act(() => root.render(<CategoryBars rows={[]} caption="Spending" emptyText="No spending yet this month." />));
    expect(host.querySelector("table")).toBeNull();
    expect(host.querySelector(".empty-state")?.textContent).toBe("No spending yet this month.");
  });

  it("uses a default empty message", () => {
    act(() => root.render(<CategoryBars rows={[]} caption="Spending" />));
    expect(host.querySelector(".empty-state")?.textContent).toBe("Nothing to show yet.");
  });

  it("makes each name a button when rows can be opened, reachable by keyboard", () => {
    const onSelect = vi.fn();
    act(() => root.render(<CategoryBars rows={spent} caption="Spending" onSelect={onSelect} />));
    const button = rows()[1].cells[0].querySelector("button")!;
    expect(button.textContent).toBe("Car upkeep");
    act(() => button.click());
    expect(onSelect).toHaveBeenCalledWith("car");
  });

  it("shows the icon given for a row", () => {
    act(() => root.render(<CategoryBars rows={[{ ...spent[0], icon: <svg data-icon="rent" /> }]} caption="Spending" />));
    expect(rows()[0].cells[0].querySelector("[data-icon='rent']")).not.toBeNull();
  });

  it("keeps amounts out of every attribute, where hiding amounts cannot reach them", () => {
    act(() => root.render(<CategoryBars rows={planned} caption="Spending against the plan" onSelect={vi.fn()} />));
    for (const el of host.querySelectorAll("*")) {
      for (const attr of el.attributes) expect(attr.value, `${el.tagName} ${attr.name}`).not.toMatch(/\$\s?\d/);
    }
  });

  it("has every amount hidden when amounts are hidden", () => {
    act(() => root.render(<CategoryBars rows={planned} caption="Spending against the plan" />));
    const stop = startPrivacyMask(host);
    expect(host.textContent).not.toMatch(/\$\s?\d/);
    stop();
  });
});
