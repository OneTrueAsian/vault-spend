// @vitest-environment jsdom
//
// VS-31 step 0 (F4): stacked category rows with a tick and a legend. Cash Flow uses it for "Six months
// at a glance" (a row per month, the tick is what came in); Household for "Spending by person" (a row
// per person, the tick is what they earned).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StackedRows, type StackedRow } from "./StackedRows";
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

const months: StackedRow[] = [
  { label: "Oct", segments: [{ category: "Rent", amount: 1650 }, { category: "Groceries", amount: 400 }], tick: 3000 },
  { label: "Nov", segments: [{ category: "Rent", amount: 1650 }, { category: "Car upkeep", amount: 1240 }], tick: 1722 },
];

const visualRows = () => [...host.querySelectorAll<HTMLElement>(".stacked-rows-row")];
const segs = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>(".stacked-rows-seg")];
const tableRows = () => [...host.querySelectorAll(".sr-only table tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent));
const legend = () => [...host.querySelectorAll(".stacked-rows-legend li")].map((li) => li.textContent);

describe("StackedRows", () => {
  it("puts every row and its tick on one scale set by the largest total or tick", () => {
    act(() => root.render(<StackedRows rows={months} caption="Six months at a glance" tickLabel="What came in" />));
    const [oct, nov] = visualRows();
    const scale = 3000; // Oct's tick is larger than any row's spending (Nov: 2,890)
    expect(segs(oct).map((s) => s.style.width)).toEqual([`${(1650 / scale) * 100}%`, `${(400 / scale) * 100}%`]);
    expect(segs(nov).map((s) => s.style.width)).toEqual([`${(1650 / scale) * 100}%`, `${(1240 / scale) * 100}%`]);
    expect(oct.querySelector<HTMLElement>(".stacked-rows-tick")?.style.left).toBe("100%");
    expect(nov.querySelector<HTMLElement>(".stacked-rows-tick")?.style.left).toBe(`${(1722 / scale) * 100}%`);
  });

  it("shows each row's label and total, and leaves out the tick when a row has none", () => {
    act(() => root.render(<StackedRows rows={[{ label: "Shared", segments: [{ category: "Rent", amount: 100 }] }]} caption="Spending by person" tickLabel="What they earned" />));
    const [row] = visualRows();
    expect(row.querySelector(".stacked-rows-label")?.textContent).toBe("Shared");
    expect(row.querySelector(".stacked-rows-total")?.textContent).toBe("$100.00");
    expect(row.querySelector(".stacked-rows-tick")).toBeNull();
  });

  it("colors categories by their total across all rows, the same color in every row", () => {
    act(() => root.render(<StackedRows rows={months} caption="Six months" tickLabel="What came in" />));
    const [oct, nov] = visualRows();
    // Rent 3,300 > Car upkeep 1,240 > Groceries 400
    expect(segs(oct)[0].style.background).toBe("var(--cat-1)");
    expect(segs(nov)[0].style.background).toBe("var(--cat-1)");
    expect(segs(nov)[1].style.background).toBe("var(--cat-2)");
    expect(segs(oct)[1].style.background).toBe("var(--cat-3)");
    expect(legend()).toEqual(["Rent", "Car upkeep", "Groceries", "What came in"]);
  });

  it("folds categories past the largest five into Everything else, drawn and listed once per row", () => {
    const many = ["A", "B", "C", "D", "E", "F", "G"].map((c, i) => ({ category: c, amount: 70 - i * 10 }));
    act(() => root.render(<StackedRows rows={[{ label: "Nov", segments: many }]} caption="Six months" tickLabel="What came in" />));
    const [nov] = visualRows();
    expect(segs(nov)).toHaveLength(6);
    expect(segs(nov)[5].style.background).toBe("var(--text-faint)");
    expect(segs(nov)[5].style.width).toBe(`${((20 + 10) / 280) * 100}%`);
    // No row has a tick, so the legend has no tick entry.
    expect(legend()).toEqual(["A", "B", "C", "D", "E", "Everything else"]);
  });

  it("gives all six categories their own color when there are exactly six, with no Everything else", () => {
    const six = ["A", "B", "C", "D", "E", "F"].map((c, i) => ({ category: c, amount: 60 - i * 10 }));
    act(() => root.render(<StackedRows rows={[{ label: "Nov", segments: six }]} caption="Six months" tickLabel="What came in" />));
    expect(segs(visualRows()[0]).map((s) => s.style.background)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `var(--cat-${n})`));
    expect(legend()).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("names the picture without amounts, and gives the exact figures for every category in a table", () => {
    act(() => root.render(<StackedRows rows={months} caption="Six months at a glance" tickLabel="What came in" />));
    const pic = host.querySelector(".stacked-rows")!;
    expect(pic.getAttribute("role")).toBe("group");
    expect(pic.getAttribute("aria-label")).toBe("Six months at a glance");
    expect(host.querySelector(".sr-only table caption")?.textContent).toBe("Six months at a glance");
    expect(tableRows()).toEqual([
      ["Oct", "Rent", "$1,650.00"],
      ["Oct", "Groceries", "$400.00"],
      ["Oct", "Total", "$2,050.00"],
      ["Oct", "What came in", "$3,000.00"],
      ["Nov", "Rent", "$1,650.00"],
      ["Nov", "Car upkeep", "$1,240.00"],
      ["Nov", "Total", "$2,890.00"],
      ["Nov", "What came in", "$1,722.00"],
    ]);
  });

  it("gives a negative segment (refunds) no width but keeps its real figure in the total", () => {
    act(() => root.render(<StackedRows rows={[{ label: "Nov", segments: [{ category: "Refunds", amount: -30 }, { category: "Rent", amount: 100 }] }]} caption="Six months" tickLabel="What came in" />));
    // The refund-only category is not drawn at all (it has nothing to draw); only Rent is.
    expect(segs(visualRows()[0]).map((s) => s.style.width)).toEqual(["100%"]);
    expect(tableRows()).toContainEqual(["Nov", "Total", "$70.00"]);
  });

  it("does not give a refund-only or zero category a color, so six real categories keep their own", () => {
    const six = ["A", "B", "C", "D", "E", "F"].map((c, i) => ({ category: c, amount: 60 - i * 10 }));
    const segments = [...six, { category: "Refunds", amount: -25 }, { category: "Nothing", amount: 0 }];
    act(() => root.render(<StackedRows rows={[{ label: "Nov", segments }]} caption="Six months" tickLabel="What came in" />));
    expect(legend()).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(segs(visualRows()[0]).map((s) => s.style.background)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `var(--cat-${n})`));
    expect(tableRows()).toContainEqual(["Nov", "Refunds", "-$25.00"]);
  });

  it("still shows a row whose only figure is a refund, rather than the empty message", () => {
    act(() => root.render(<StackedRows rows={[{ label: "Nov", segments: [{ category: "Refunds", amount: -30 }] }]} caption="Six months" tickLabel="What came in" />));
    expect(host.querySelector(".empty-state")).toBeNull();
    expect(visualRows()[0].querySelector(".stacked-rows-total")?.textContent).toBe("-$30.00");
  });

  it("shows a plain message when there is no spending and nothing came in", () => {
    act(() => root.render(<StackedRows rows={[{ label: "Nov", segments: [], tick: 0 }]} caption="Six months" tickLabel="What came in" emptyText="No spending in these months." />));
    expect(host.querySelector(".stacked-rows")).toBeNull();
    expect(host.querySelector(".empty-state")?.textContent).toBe("No spending in these months.");
  });

  it("keeps amounts out of every attribute", () => {
    act(() => root.render(<StackedRows rows={months} caption="Six months at a glance" tickLabel="What came in" />));
    for (const el of host.querySelectorAll("*")) {
      for (const attr of el.attributes) expect(attr.value, `${el.tagName} ${attr.name}`).not.toMatch(/\$\s?\d/);
    }
  });

  it("has every amount hidden when amounts are hidden", () => {
    act(() => root.render(<StackedRows rows={months} caption="Six months at a glance" tickLabel="What came in" />));
    const stop = startPrivacyMask(host);
    expect(host.textContent).not.toMatch(/\$\s?\d/);
    stop();
  });

  it("shows the actual category in sparse rows and pins details until dismissed", () => {
    act(() => root.render(<StackedRows rows={months} caption="Six months" tickLabel="What came in" />));
    const groceries = segs(visualRows()[0])[1]; // Legend position two is Car upkeep, not Groceries.
    act(() => groceries.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    expect(document.querySelector(".chart-details")?.textContent).toContain("Groceries");
    expect(document.querySelector(".chart-details")?.textContent).toContain("$400.00");
    act(() => groceries.click());
    act(() => groceries.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
    expect(document.querySelector(".chart-details")?.getAttribute("role")).toBe("dialog");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector(".chart-details")).toBeNull();
  });

  it("gives grouped categories their exact breakdown and income ticks their own value", () => {
    const many = ["A", "B", "C", "D", "E", "F", "G"].map((category, i) => ({ category, amount: 70 - i * 10 }));
    act(() => root.render(<StackedRows rows={[{ label: "Jordan", segments: many, tick: 900 }]} caption="By person" tickLabel="What they earned" />));
    act(() => segs(visualRows()[0])[5].click());
    expect(document.querySelector(".chart-details")?.textContent).toContain("Everything else");
    expect(document.querySelector(".chart-details")?.textContent).toContain("$20.00");
    expect(document.querySelector(".chart-details")?.textContent).toContain("Section total: $30.00");
    act(() => visualRows()[0].querySelector<HTMLButtonElement>(".stacked-rows-tick")!.click());
    expect(document.querySelector(".chart-details")?.textContent).toContain("What they earned");
    expect(document.querySelector(".chart-details")?.textContent).toContain("$900.00");
  });

  it("does not expose amounts when details open while privacy is enabled", () => {
    document.documentElement.dataset.privacy = "on";
    try {
      act(() => root.render(<StackedRows rows={months} caption="Six months" tickLabel="What came in" />));
      act(() => segs(visualRows()[0])[0].click());
      const panel = document.querySelector(".chart-details")!;
      expect(panel).not.toBeNull();
      expect(panel.textContent).not.toMatch(/\$\s?\d/);
      for (const el of document.querySelectorAll(".chart-details *, .stacked-rows *")) {
        for (const attr of el.attributes) expect(attr.value).not.toMatch(/\$\s?\d/);
      }
    } finally {
      delete document.documentElement.dataset.privacy;
    }
  });

  it("does not reopen beneath the pointer when closing pinned details", () => {
    act(() => root.render(<StackedRows rows={months} caption="Six months" tickLabel="What came in" />));
    act(() => segs(visualRows()[0])[0].click());
    act(() => document.querySelector<HTMLButtonElement>(".chart-details-close")!.click());
    // Removing the popup can expose another segment without an intentional pointer move.
    act(() => segs(visualRows()[1])[1].dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    expect(document.querySelector(".chart-details")).toBeNull();
    const bar = visualRows()[1].querySelector<HTMLButtonElement>(".stacked-rows-track")!;
    act(() => bar.focus());
    act(() => bar.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    act(() => bar.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.querySelector(".chart-details")?.textContent).toContain("Car upkeep");
  });

  it("lets keyboard users explore every section from one bar without widening small values", () => {
    act(() => root.render(<StackedRows rows={months} caption="Six months" tickLabel="What came in" />));
    const row = visualRows()[0], bar = row.querySelector<HTMLButtonElement>(".stacked-rows-track")!;
    expect(row.querySelectorAll("button")).toHaveLength(1);
    act(() => bar.focus());
    act(() => bar.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.querySelector(".chart-details")?.textContent).toContain("Groceries");
    act(() => bar.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.querySelector(".chart-details")?.textContent).toContain("What came in");
    expect(segs(row)[1].style.width).toBe(`${(400 / 3000) * 100}%`);
  });

  it("keeps a pinned section selected when the pointer moves across the same bar", () => {
    act(() => root.render(<StackedRows rows={months} caption="Six months" tickLabel="What came in" />));
    const row = visualRows()[0], bar = row.querySelector<HTMLButtonElement>(".stacked-rows-track")!;
    act(() => segs(row)[0].click());
    act(() => segs(row)[1].dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    expect(bar.getAttribute("aria-pressed")).toBe("true");
    expect(bar.getAttribute("aria-label")).toContain("Rent");
    expect(document.querySelector(".chart-details h3")?.textContent).toContain("Rent");
  });
});
