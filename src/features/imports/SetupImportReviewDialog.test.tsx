// @vitest-environment jsdom
//
// Setup-data import is reviewed in a pop-up too (owner, 2026-10-04). It used to sit on the Reports
// tab while the button that starts it is in Settings, so from Settings it seemed to do nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SetupImportReviewDialog, type PendingSetupImport } from "./SetupImportReviewDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pending(rowErrors = 0): PendingSetupImport {
  return {
    path: "C:/setup.csv",
    preview: {
      accounts: [{ index: 0, name: "Checking", account_type: "checking", starting_balance: "100.00", institution: null, already_exists: false }],
      categories: [],
      budgets: [],
      buckets: [],
      holdings: [],
      row_errors: rowErrors,
      row_problems: Array.from({ length: rowErrors }, (_, i) => ({ row_number: i + 3, preview: `Accounts: Row ${i + 1}, oops`, reason: "This row couldn't be read." })),
    },
    includedAccounts: new Set([0]),
    includedCategories: new Set(),
    includedBudgets: new Set(),
    includedBuckets: new Set(),
    includedHoldings: new Set(),
  } as unknown as PendingSetupImport;
}

describe("SetupImportReviewDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onToggle = vi.fn();
  const onCancel = vi.fn();
  const onConfirm = vi.fn();

  beforeEach(() => {
    [onToggle, onCancel, onConfirm].forEach((f) => f.mockReset());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(p: PendingSetupImport, busy = false) {
    act(() => {
      root.render(<SetupImportReviewDialog pending={p} busy={busy} onToggle={onToggle} onCancel={onCancel} onConfirm={onConfirm} />);
    });
  }
  const dialog = () => document.querySelector<HTMLElement>("[role='dialog']")!;
  const button = (label: string) => [...dialog().querySelectorAll("button")].find((b) => b.textContent === label)!;

  it("lists each problem row with its reason and the first five of seven, with Show all for the rest", () => {
    show(pending(2));
    const items = () => Array.from(dialog().querySelectorAll(".import-row-problems li")).map((li) => li.textContent);
    expect(dialog().textContent).toContain("2 rows had problems and will be skipped.");
    expect(items()).toEqual(["Row 3: This row couldn't be read.Accounts: Row 1, oops", "Row 4: This row couldn't be read.Accounts: Row 2, oops"]);
    show(pending(7));
    expect(items()).toHaveLength(5);
    act(() => button("Show all 7").click());
    expect(items()).toHaveLength(7);
  });

  it("opens even when every row failed: lists the reasons, says nothing can be imported, and keeps Import off", () => {
    const p = pending(2);
    p.preview.accounts = [];
    p.includedAccounts = new Set();
    show(p);
    expect(dialog().textContent).toContain("Nothing could be imported from this file. 2 rows couldn't be read.");
    expect(dialog().textContent).not.toContain("Untick anything");
    expect(dialog().querySelectorAll(".import-row-problems li")).toHaveLength(2);
    expect(button("Import selected").disabled).toBe(true);
  });

  it("opens as a dialog with a plain intro and the rows to bring in", () => {
    show(pending());
    expect(dialog().querySelector(".modal-title")?.textContent).toBe("Import setup data");
    expect(dialog().textContent).toContain("Untick anything you don't want.");
    expect(dialog().textContent).toContain("Checking");
  });

  it("says how many rows had problems and will be skipped", () => {
    show(pending(3));
    expect(dialog().textContent).toContain("3 rows had problems and will be skipped.");
  });

  it("keeps Cancel and Import selected in the pinned footer", () => {
    show(pending());
    const footer = dialog().querySelector(".modal-footer")!;
    expect(footer.contains(button("Cancel"))).toBe(true);
    expect(footer.contains(button("Import selected"))).toBe(true);
    act(() => button("Import selected").click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("draws no card of its own inside the dialog", () => {
    show(pending());
    expect(dialog().querySelector(".dup-review")).toBeNull();
  });

  it("turns Import selected off when nothing is ticked", () => {
    const p = pending();
    p.includedAccounts = new Set();
    show(p);
    expect(button("Import selected").disabled).toBe(true);
  });

  it("says to tick a row while Import selected is off, and not when an empty file already says why (VS-68)", () => {
    const note = () => document.querySelector("[data-setup-import-missing]")?.textContent ?? null;
    show(pending());
    expect(note()).toBeNull();
    const p = pending();
    p.includedAccounts = new Set();
    show(p);
    expect(note()).toBe("Tick at least one row to import.");
    const empty = pending(4);
    empty.preview.accounts = [];
    empty.includedAccounts = new Set();
    show(empty);
    expect(button("Import selected").disabled).toBe(true);
    expect(note()).toBeNull();
  });

  it("cancels on Escape but not on a click outside, and not while importing", () => {
    show(pending());
    act(() => (document.querySelector(".modal-overlay") as HTMLElement).click());
    expect(onCancel).not.toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    show(pending(), true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
