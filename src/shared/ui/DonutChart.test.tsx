// @vitest-environment jsdom
//
// A clickable donut slice is announced like the legend button for the same category: the amount reads
// as money ("$1,234.50"), not a bare number.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DonutChart } from "./charts";

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

describe("DonutChart", () => {
  it("names a clickable slice with its amount formatted as money", () => {
    act(() => root.render(<DonutChart data={[{ label: "Groceries", value: 1234.5, color: "red" }, { label: "Rent", value: 80, color: "blue" }]} onSelect={() => {}} />));
    const labels = [...host.querySelectorAll("circle[role='button']")].map((c) => c.getAttribute("aria-label"));
    expect(labels).toEqual(["Show Groceries spending, $1,234.50", "Show Rent spending, $80.00"]);
  });

  it("gives a slice no button name when nothing is selectable", () => {
    act(() => root.render(<DonutChart data={[{ label: "Groceries", value: 5, color: "red" }]} />));
    expect(host.querySelector("circle")?.getAttribute("aria-label")).toBeNull();
  });
});
