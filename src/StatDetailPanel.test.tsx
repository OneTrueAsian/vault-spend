// @vitest-environment jsdom
//
// s4: a breakdown row is red only when it needs you. A row can say so itself (`flag`); without
// that, a negative amount is red as before (budget alerts: negative = over budget).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StatDetailPanel } from "./StatDetailPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function amountFor(name: string) {
  const row = [...container.querySelectorAll<HTMLElement>(".stat-detail-panel span")].find((s) => s.textContent === name)!;
  return row.nextElementSibling as HTMLElement;
}

describe("StatDetailPanel row colours", () => {
  it("colours a negative amount by default", () => {
    act(() =>
      root.render(<StatDetailPanel isOpen title="alerts" rows={[{ name: "Dining", amount: -50 }, { name: "Fuel", amount: 20 }]} onClose={vi.fn()} />),
    );
    expect(amountFor("Dining").classList.contains("report-over-budget")).toBe(true);
    expect(amountFor("Fuel").classList.contains("report-over-budget")).toBe(false);
  });

  it("follows a row's own flag over its sign", () => {
    act(() =>
      root.render(
        <StatDetailPanel
          isOpen
          title="Debt"
          rows={[
            { name: "Car loan", amount: -8000, flag: false },
            { name: "Checking", amount: -20, flag: true },
          ]}
          onClose={vi.fn()}
        />,
      ),
    );
    expect(amountFor("Car loan").classList.contains("report-over-budget")).toBe(false);
    expect(amountFor("Checking").classList.contains("report-over-budget")).toBe(true);
  });
});
