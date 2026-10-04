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

  function show(r: ImportReview, busy = false) {
    act(() => {
      root.render(<ImportReviewDialog review={r} accounts={accounts} categoryOptions={["Groceries", "Shopping"]} busy={busy} />);
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
