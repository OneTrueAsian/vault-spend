// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ColumnMappingDialog } from "./ColumnMappingDialog";
import type { ColumnInspection } from "./columnMapping";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INSPECTION: ColumnInspection = {
  status: "needs_mapping",
  headers: ["When", "Memo", "Money"],
  sample_rows: [
    ["2026-01-02", "Coffee", "-4.50"],
    ["2026-01-03", "Paycheck", "1200.00"],
  ],
  missing: ["date", "description", "amount"],
  guess: { date: null, description: null, amount: null, debit: null, credit: null },
  map: null,
};

describe("ColumnMappingDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onCancel = vi.fn();
  const onConfirm = vi.fn();

  const field = (name: string) => document.querySelector<HTMLButtonElement>(`[data-column-field="${name}"]`)!;
  const cont = () => document.querySelector<HTMLButtonElement>("[data-column-continue]")!;
  const cancel = () => document.querySelector<HTMLButtonElement>("[data-column-cancel]")!;
  const pick = (name: string, index: number) => {
    act(() => field(name).click());
    const option = document.querySelector<HTMLButtonElement>(`[role="menuitemradio"][data-value="${index}"]`)!;
    act(() => option.click());
  };

  function show(inspection: ColumnInspection = INSPECTION) {
    act(() => {
      root.render(<ColumnMappingDialog inspection={inspection} accountName="Checking" onCancel={onCancel} onConfirm={onConfirm} />);
    });
  }

  beforeEach(() => {
    onCancel.mockReset();
    onConfirm.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("asks one question per field and explains itself", () => {
    show();
    expect(document.querySelector("[data-column-mapping]")).not.toBeNull();
    expect(document.body.textContent).toContain("Match your columns");
    expect(document.body.textContent).toContain("We'll remember your choice for Checking.");
    expect(field("date").getAttribute("aria-label")).toBe("Which column has the date?");
    expect(field("description").getAttribute("aria-label")).toBe("Which column has the description?");
    expect(field("amount").getAttribute("aria-label")).toBe("Which column has the amount?");
  });

  it("shows the file's headers and first rows", () => {
    show();
    expect(document.body.textContent).toContain("The first rows of your file");
    const headers = [...document.querySelectorAll("table th")].map((t) => t.textContent);
    expect(headers).toEqual(["When", "Memo", "Money"]);
    const cells = [...document.querySelectorAll("table tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent));
    expect(cells).toEqual(INSPECTION.sample_rows);
  });

  it("keeps Continue off, and says why, until the columns are chosen", () => {
    show();
    expect(cont().disabled).toBe(true);
    expect(document.body.textContent).toContain("Pick the column that has the date.");
    pick("date", 0);
    expect(document.body.textContent).toContain("Pick the column that has the description.");
    pick("description", 1);
    expect(cont().disabled).toBe(true);
    pick("amount", 2);
    expect(cont().disabled).toBe(false);
  });

  it("hands back the chosen columns on Continue", () => {
    show();
    pick("date", 0);
    pick("description", 1);
    pick("amount", 2);
    act(() => cont().click());
    expect(onConfirm).toHaveBeenCalledWith({ date: 0, description: 1, amount: { kind: "single", column: 2 } });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("starts from the app's best guess", () => {
    show({ ...INSPECTION, guess: { date: 0, description: 1, amount: 2, debit: null, credit: null } });
    expect(cont().disabled).toBe(false);
    act(() => cont().click());
    expect(onConfirm).toHaveBeenCalledWith({ date: 0, description: 1, amount: { kind: "single", column: 2 } });
  });

  it("swaps the amount question for money out and money in when they are separate", () => {
    show();
    const toggle = document.querySelector<HTMLInputElement>("[data-column-split]")!;
    expect(document.body.textContent).toContain("Money in and money out are in separate columns");
    act(() => toggle.click());
    expect(field("amount")).toBeNull();
    expect(field("debit").getAttribute("aria-label")).toBe("Which column has the money out?");
    expect(field("credit").getAttribute("aria-label")).toBe("Which column has the money in?");
    pick("date", 0);
    pick("description", 1);
    pick("debit", 2);
    expect(cont().disabled).toBe(true);
    expect(document.body.textContent).toContain("Pick the column that has the amount.");
  });

  it("builds a separate-columns map", () => {
    show({ ...INSPECTION, headers: ["When", "Memo", "Out", "In"], guess: { date: 0, description: 1, amount: null, debit: 2, credit: 3 } });
    expect(field("debit")).not.toBeNull();
    act(() => cont().click());
    expect(onConfirm).toHaveBeenCalledWith({ date: 0, description: 1, amount: { kind: "debit_credit", debit: 2, credit: 3 } });
  });

  it("explains when two fields share a column", () => {
    show();
    pick("date", 1);
    pick("description", 1);
    pick("amount", 2);
    expect(document.body.textContent).toContain("Each field needs its own column.");
    expect(cont().disabled).toBe(true);
  });

  it("Cancel and Escape cancel without confirming", () => {
    show();
    act(() => cancel().click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("puts focus on the first dropdown", () => {
    show();
    expect(document.activeElement).toBe(field("date"));
  });
});
