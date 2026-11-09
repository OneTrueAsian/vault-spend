// @vitest-environment jsdom
//
// QA-A11Y-002: a wide table that scrolls sideways inside its card has to be reachable from the
// keyboard, or a person who can't use a mouse can never see its right-hand columns.
import { afterEach, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ScrollRegion } from "./ScrollRegion";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
afterEach(() => { act(() => root.unmount()); container.remove(); });

function show(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(node));
}

it("is a labelled region that one Tab press lands on", () => {
  show(<ScrollRegion label="Spending by category and month" className="report-table-scroll"><table><tbody><tr><td>x</td></tr></tbody></table></ScrollRegion>);
  const region = container.querySelector<HTMLElement>("[role='region']")!;
  expect(region.getAttribute("aria-label")).toBe("Spending by category and month");
  expect(region.tabIndex).toBe(0);
  expect(region.className).toContain("report-table-scroll");
  expect(region.querySelector("table")).not.toBeNull();
});

it("keeps the keyboard route the arrow keys already scroll the focused region on", () => {
  show(<ScrollRegion label="Table"><div style={{ width: 4000 }}>wide</div></ScrollRegion>);
  const region = container.querySelector<HTMLElement>("[role='region']")!;
  region.focus();
  expect(document.activeElement).toBe(region);
});

it("passes the ref through so a caller can still measure or scroll it", () => {
  let seen: HTMLDivElement | null = null;
  show(<ScrollRegion label="Heat map" innerRef={(el) => { seen = el; }}>x</ScrollRegion>);
  expect(seen).toBe(container.querySelector("[role='region']"));
});
