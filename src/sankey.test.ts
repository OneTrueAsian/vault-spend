import { describe, expect, it } from "vitest";
import { buildSankeyData, layoutSankey, sankeyRibbonPath } from "./sankey";

describe("buildSankeyData", () => {
  it("flows income directly into each category plus Left over when income exceeds spending", () => {
    const data = buildSankeyData(5000, [
      { label: "Rent", amount: 1200 },
      { label: "Groceries", amount: 400 },
    ]);

    expect(data.totalIncome).toBe(5000);
    expect(data.totalSpending).toBe(1600);
    expect(data.leftover).toBe(3400);

    const ids = data.nodes.map((n) => n.id);
    expect(ids).toEqual(["income", "cat:Rent", "cat:Groceries", "leftover"]);
    expect(data.nodes.find((n) => n.id === "income")).toMatchObject({ value: 5000, column: 0 });
    expect(data.nodes.find((n) => n.id === "leftover")).toMatchObject({ label: "Left over", value: 3400, column: 1 });

    // Every link starts at Income, and link values sum back to income.
    expect(data.links.every((l) => l.source === "income")).toBe(true);
    expect(data.links.reduce((s, l) => s + l.value, 0)).toBe(5000);
  });

  it("groups everything past the top N categories into Other, biggest first", () => {
    const cats = [
      { label: "A", amount: 100 },
      { label: "B", amount: 90 },
      { label: "C", amount: 80 },
      { label: "D", amount: 70 },
      { label: "E", amount: 60 },
      { label: "F", amount: 50 },
      { label: "G", amount: 40 },
      { label: "H", amount: 30 },
      { label: "I", amount: 20 },
      { label: "J", amount: 10 },
    ];
    const data = buildSankeyData(1000, cats, 8);

    const categoryIds = data.nodes.filter((n) => n.id.startsWith("cat:")).map((n) => n.id);
    expect(categoryIds).toEqual(["cat:A", "cat:B", "cat:C", "cat:D", "cat:E", "cat:F", "cat:G", "cat:H"]);
    const other = data.nodes.find((n) => n.id === "other");
    expect(other?.value).toBe(30); // I (20) + J (10)
  });

  it("omits the Left over node entirely when income exactly covers spending", () => {
    const data = buildSankeyData(500, [{ label: "Rent", amount: 500 }]);
    expect(data.nodes.some((n) => n.id === "leftover")).toBe(false);
    expect(data.leftover).toBe(0);
  });

  it("routes a shortfall through a middle Total spending node instead of guessing per category", () => {
    const data = buildSankeyData(1000, [
      { label: "Rent", amount: 1200 },
      { label: "Groceries", amount: 300 },
    ]);

    expect(data.leftover).toBe(-500);
    const ids = data.nodes.map((n) => n.id);
    expect(ids).toEqual(["income", "shortfall", "spending", "cat:Rent", "cat:Groceries"]);
    expect(data.nodes.find((n) => n.id === "shortfall")).toMatchObject({ value: 500, column: 0 });
    expect(data.nodes.find((n) => n.id === "spending")).toMatchObject({ value: 1500, column: 1 });
    // Both income and shortfall feed the aggregate spending node.
    const intoSpending = data.links.filter((l) => l.target === "spending");
    expect(intoSpending.map((l) => l.value).sort((a, b) => a - b)).toEqual([500, 1000]);
    // The aggregate then fans out to the categories, in column 2.
    expect(data.nodes.find((n) => n.id === "cat:Rent")?.column).toBe(2);
  });

  it("skips the Income node when there is no income at all (pure shortfall)", () => {
    const data = buildSankeyData(0, [{ label: "Rent", amount: 500 }]);
    expect(data.nodes.some((n) => n.id === "income")).toBe(false);
    expect(data.nodes.find((n) => n.id === "shortfall")).toMatchObject({ value: 500 });
  });

  it("returns an empty graph when there is no income and no spending", () => {
    const data = buildSankeyData(0, []);
    expect(data.nodes).toEqual([]);
    expect(data.links).toEqual([]);
  });

  it("ignores non-positive category amounts", () => {
    const data = buildSankeyData(100, [
      { label: "Refund", amount: -20 },
      { label: "Rent", amount: 0 },
      { label: "Groceries", amount: 50 },
    ]);
    expect(data.nodes.map((n) => n.id)).toEqual(["income", "cat:Groceries", "leftover"]);
    expect(data.totalSpending).toBe(50);
  });
});

describe("layoutSankey", () => {
  it("stacks a column's nodes top to bottom, scaled to fill the given height", () => {
    const data = buildSankeyData(100, [
      { label: "A", amount: 60 },
      { label: "B", amount: 40 },
    ]);
    const layout = layoutSankey(data, 400, 210, 16, 10);

    const income = layout.nodes.find((n) => n.id === "income")!;
    expect(income.x).toBe(0);
    expect(income.y0).toBe(0);
    expect(income.y1).toBe(210); // sole node in its column, so it fills the full height

    const a = layout.nodes.find((n) => n.id === "cat:A")!;
    const b = layout.nodes.find((n) => n.id === "cat:B")!;
    // Column height budget is 210 - 10 (one gap between two nodes) = 200, split 60/40.
    expect(a.y0).toBe(0);
    expect(a.y1).toBe(120);
    expect(b.y0).toBe(130); // 120 + 10 padding
    expect(b.y1).toBe(210); // 130 + 80 (40% of the 200px budget)
    expect(a.x).toBe(400 - 16);
    expect(b.x).toBe(400 - 16);
  });

  it("slices link endpoints proportionally out of a shared source node", () => {
    const data = buildSankeyData(100, [
      { label: "A", amount: 75 },
      { label: "B", amount: 25 },
    ]);
    const layout = layoutSankey(data, 400, 100, 16, 10);
    const links = layout.links;
    const toA = links.find((l) => l.target === "cat:A")!;
    const toB = links.find((l) => l.target === "cat:B")!;
    // Income node spans the full 100px height (only node in its column), so
    // its 75/25 split becomes 75px then 25px.
    expect(toA.sy0).toBe(0);
    expect(toA.sy1).toBe(75);
    expect(toB.sy0).toBe(75);
    expect(toB.sy1).toBe(100);
  });

  it("returns an empty layout for an empty graph", () => {
    const layout = layoutSankey(buildSankeyData(0, []), 400, 200);
    expect(layout.nodes).toEqual([]);
    expect(layout.links).toEqual([]);
  });
});

describe("sankeyRibbonPath", () => {
  it("draws a path starting and ending at the given coordinates", () => {
    const d = sankeyRibbonPath(0, 10, 20, 100, 30, 50);
    expect(d.startsWith("M0,10 C50,10 50,30 100,30 ")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("L100,50");
  });
});
