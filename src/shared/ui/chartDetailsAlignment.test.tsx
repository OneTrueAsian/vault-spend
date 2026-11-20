// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StackedRows } from "./StackedRows";
import { SegmentBar } from "./SegmentBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let sheet: HTMLStyleElement;
let root: Root;
beforeEach(() => {
  sheet = document.createElement("style");
  // Include the real shared button rule that caused the regression, not a stand-in reset.
  sheet.textContent = ["SharedButtons.css", "ChartPieces.css", "ChartDetails.css"]
    .map(file => readFileSync(resolve("src/shared/ui", file), "utf8")).join("\n");
  document.head.append(sheet);
  host = document.createElement("div");
  host.className = "page";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  sheet.remove();
});

it("keeps interactive spending bars anchored to zero despite centered shared button styling", () => {
  act(() => root.render(<StackedRows caption="Monthly spending" tickLabel="Income" rows={[
    { label: "Jun", segments: [{ category: "Rent", amount: 100 }], tick: 1000 },
    { label: "Jul", segments: [{ category: "Rent", amount: 500 }], tick: 800 },
  ]} />));
  for (const track of host.querySelectorAll(".stacked-rows-track")) {
    expect(getComputedStyle(track).justifyContent).toBe("flex-start");
  }
  expect(host.querySelector<HTMLElement>(".stacked-rows-seg")?.style.width).toBe("10%");
  expect(host.querySelector<HTMLElement>(".stacked-rows-tick")?.style.left).toBe("100%");
});

it("anchors shorter interactive allocation bars to the same origin", () => {
  act(() => root.render(<SegmentBar caption="Allocation" details rows={[
    { label: "Small", segments: [{ label: "Stock", amount: 100, color: "var(--cat-1)" }] },
    { label: "Large", segments: [{ label: "Stock", amount: 1000, color: "var(--cat-1)" }] },
  ]} />));
  for (const track of host.querySelectorAll(".segment-bar-track")) {
    expect(getComputedStyle(track).justifyContent).toBe("flex-start");
  }
});
