// @vitest-environment jsdom
//
// The import review opens as a pop-up over the page (owner, 2026-10-04): wherever the person had
// scrolled, the review is in front of them, and Cancel / Import stay pinned at its foot.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImportReviewDialog } from "./ImportReviewDialog";
import type { ImportReview } from "./useImportReview";
import type { ImportRow } from "./importResolution";
import type { Account } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const accounts = [{ id: 1, name: "Joint Checking" }] as Account[];

function row(index: number, over: Partial<ImportRow> = {}): ImportRow {
  return {
    index,
    date: "2026-09-21",
    description: `SHOP ${index}`,
    amount: "-10.00",
    is_duplicate: false,
    account_name: null,
    category: null,
    matched_category: "Groceries",
    suggestion: null,
    ...over,
  };
}

function review(rows: ImportRow[], over: Partial<ImportReview> = {}): ImportReview {
  return {
    pendingImport: {
      path: "C:/bank.csv",
      invertAmounts: false,
      defaultAccountId: 1,
      preview: { rows, row_errors: 0, unmatched_categories: [], review_token: "t", choice_below: 0.5 },
    },
    includedIndices: new Set(rows.map((r) => r.index)),
    accountOverrides: new Map(),
    importCategoryChoices: {},
    importRowChoices: new Map(),
    setImportRowChoices: vi.fn(),
    begin: vi.fn(),
    toggleIncluded: vi.fn(),
    toggleSelectAllImportRows: vi.fn(),
    setImportRowAccount: vi.fn(),
    updateImportCategoryChoices: vi.fn(),
    leaveRestOfRowsUncategorized: vi.fn(),
    confirmPendingImport: vi.fn(),
    cancelPendingImport: vi.fn(),
    notice: null,
    ...over,
  } as ImportReview;
}

const unsure = (index: number) => row(index, { matched_category: null, suggestion: { category: "Groceries", source: "guess", confidence: 0.2 } });

describe("ImportReviewDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(r: ImportReview, busy = false, onChangeColumns?: () => void) {
    act(() => {
      root.render(
        <ImportReviewDialog review={r} accounts={accounts} categoryOptions={["Groceries", "Shopping"]} busy={busy} onChangeColumns={onChangeColumns} />,
      );
    });
  }
  const dialog = () => document.querySelector<HTMLElement>("[role='dialog']");
  const importButton = () => document.querySelector<HTMLButtonElement>("button[data-import-confirm]")!;

  it("shows nothing while no import is being reviewed", () => {
    show(review([], { pendingImport: null }));
    expect(dialog()).toBeNull();
  });

  it("opens as a dialog named for how many rows go into which account", () => {
    show(review([row(0), row(1), row(2)]));
    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector(".modal-title")?.textContent).toBe("Import 3 transactions into Joint Checking");
    expect(dialog()!.textContent).toContain("Untick anything you don't want. You can change the account on any row.");
  });

  describe("Change columns", () => {
    const inspection = {
      status: "needs_mapping" as const,
      headers: ["Posted", "Memo", "Amt"],
      sample_rows: [],
      missing: [],
      guess: { date: 0, description: 1, amount: 2, debit: null, credit: null },
      map: null,
    };
    const map = { date: 0, description: 1, amount: { kind: "single" as const, column: 2 } };
    const withColumns = (source: "saved" | "chosen") => {
      const r = review([row(0)]);
      Object.assign(r.pendingImport!, { columnMap: map, columns: { inspection, source } });
      return r;
    };
    const change = () => document.querySelector<HTMLButtonElement>("button[data-change-columns]");

    it("says the remembered columns are in use and lets the person change them", () => {
      const onChange = vi.fn();
      show(withColumns("saved"), false, onChange);
      expect(dialog()!.textContent).toContain("Using the columns you picked last time.");
      act(() => change()!.click());
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("offers the same for columns chosen in this import, without the 'last time' wording", () => {
      show(withColumns("chosen"), false, vi.fn());
      expect(dialog()!.textContent).toContain("Using the columns you picked.");
      expect(dialog()!.textContent).not.toContain("last time");
      expect(change()).not.toBeNull();
    });

    it("is off while busy, and absent when no columns were chosen", () => {
      show(withColumns("saved"), true, vi.fn());
      expect(change()!.disabled).toBe(true);
      show(review([row(0)]), false, vi.fn());
      expect(change()).toBeNull();
    });
  });

  it("uses the singular for one row, and says how many rows couldn't be read", () => {
    const r = review([row(0)]);
    r.pendingImport!.preview.row_errors = 2;
    show(r);
    expect(dialog()!.querySelector(".modal-title")?.textContent).toBe("Import 1 transaction into Joint Checking");
    expect(dialog()!.textContent).toContain("2 rows couldn't be read.");
  });

  it("keeps Cancel and Import in the pinned footer, with how many rows still need a category", () => {
    show(review([unsure(0), unsure(1), row(2)]));
    const footer = dialog()!.querySelector(".modal-footer")!;
    expect(footer.contains(importButton())).toBe(true);
    expect(footer.textContent).toContain("Cancel");
    expect(footer.textContent).toContain("2 rows still need a category");
    expect(importButton().textContent).toBe("Import 3 transactions");
    expect(importButton().disabled).toBe(true);
  });

  it("turns Import on once every checked row is settled", () => {
    show(review([unsure(0), row(1)], { importRowChoices: new Map([[0, null]]) }));
    expect(importButton().disabled).toBe(false);
    expect(dialog()!.querySelector(".modal-footer")!.textContent).not.toContain("still need");
  });

  it("says 1 row still needs a category in the singular", () => {
    show(review([unsure(0), row(1)]));
    expect(dialog()!.querySelector(".modal-footer")!.textContent).toContain("1 row still needs a category");
  });

  it("cancels on Escape, but not on a click outside it, so a stray click keeps the person's choices", () => {
    const r = review([row(0)]);
    show(r);
    act(() => {
      (document.querySelector(".modal-overlay") as HTMLElement).click();
    });
    expect(r.cancelPendingImport).not.toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(r.cancelPendingImport).toHaveBeenCalledTimes(1);
  });

  it("shows why an import was refused inside the dialog, where the person is looking", () => {
    show(review([row(0)], { notice: "This file changed. The review has been updated. Check it and import again." }));
    const alert = dialog()!.querySelector("[role='alert']");
    expect(alert?.textContent).toBe("This file changed. The review has been updated. Check it and import again.");
  });

  it("shows no notice when there is none", () => {
    show(review([row(0)], { notice: null }));
    expect(dialog()!.querySelector("[role='alert']")).toBeNull();
  });

  it("draws no card of its own inside the dialog", () => {
    show(review([row(0)]));
    expect(dialog()!.querySelector(".dup-review")).toBeNull();
  });

  describe("a file with nothing to import (QA-UX-004)", () => {
    const summary = () => dialog()!.querySelector(".dup-review-summary")!.textContent!;

    it("says no transactions were found and what to check, instead of an empty table", () => {
      show(review([]));
      expect(summary()).toContain("No transactions were found in this file.");
      expect(summary()).toContain("CSV, OFX, QFX or QIF");
      expect(summary()).not.toContain("Untick anything");
      expect(dialog()!.querySelector("table")).toBeNull();
      expect(importButton().disabled).toBe(true);
    });

    it("says how many rows could not be read when the file had some, rather than blaming the file type", () => {
      const r = review([]);
      r.pendingImport!.preview.row_errors = 2;
      show(r);
      expect(summary()).toContain("No transactions could be read from this file.");
      expect(summary()).toContain("2 rows couldn't be read");
      expect(summary()).not.toContain("Untick anything");
    });

    it("keeps the normal instructions and table when there are rows", () => {
      show(review([row(0)]));
      expect(summary()).toContain("Untick anything you don't want.");
      expect(dialog()!.querySelector("table")).not.toBeNull();
    });
  });

  describe("row checkbox names (QA-A11Y-004)", () => {
    const rowBoxes = () => Array.from(document.querySelectorAll<HTMLInputElement>("tbody input[type='checkbox']"));

    it("names each row's checkbox after its own transaction, so a screen reader can tell them apart", () => {
      show(review([row(0, { description: "CORNER SHOP", date: "2026-09-03", amount: "-4.50" }), row(1, { description: "CAFE", date: "2026-09-04", amount: "-3.25" })]));
      const names = rowBoxes().map((b) => b.getAttribute("aria-label"));
      expect(names).toHaveLength(2);
      expect(names[0]).toContain("CORNER SHOP");
      expect(names[0]).toContain("4.50");
      expect(names[1]).toContain("CAFE");
      expect(new Set(names).size).toBe(2);
    });

    it("keeps names distinct when two rows share a description, date and amount", () => {
      show(review([row(0, { description: "COFFEE", amount: "-3.00" }), row(1, { description: "COFFEE", amount: "-3.00" })]));
      const names = rowBoxes().map((b) => b.getAttribute("aria-label"));
      expect(names.every((n) => n && n.length > 0)).toBe(true);
      expect(new Set(names).size).toBe(2);
    });

    it("leaves a row's name tied to its row when other rows are unticked, and toggling goes to that row", () => {
      const r = review([row(0, { description: "ONE" }), row(1, { description: "TWO" })], { includedIndices: new Set([1]) });
      show(r);
      const two = rowBoxes().find((b) => b.getAttribute("aria-label")!.includes("TWO"))!;
      expect(two.checked).toBe(true);
      act(() => two.click());
      expect(r.toggleIncluded).toHaveBeenCalledWith(1);
    });
  });

  it("does not cancel while the import is being saved", () => {
    const r = review([row(0)]);
    show(r, true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(r.cancelPendingImport).not.toHaveBeenCalled();
    expect(importButton().textContent).toBe("Importing…");
  });
});
