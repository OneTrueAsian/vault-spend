// @vitest-environment jsdom
//
// The import review opens as a pop-up over the page (owner, 2026-10-04): wherever the person had
// scrolled, the review is in front of them, and Cancel / Import stay pinned at its foot.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { readFileSync } from "node:fs";
import { pickMenuOption } from "../../shared/ui/menuSelectTestUtils";
import { createRoot, type Root } from "react-dom/client";
import { ImportReviewDialog } from "./ImportReviewDialog";
import type { ImportReview } from "./useImportReview";
import type { ImportRow } from "../../shared/lib/importResolution";
import type { Account } from "../../shared/lib/types";

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
      preview: { rows, row_errors: 0, row_problems: [], unmatched_categories: [], review_token: "t", choice_below: 0.5 },
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

  it("shows an unfamiliar CSV account as metadata without promising to create it", () => {
    show(review([row(0, { account_name: "Blue Cash Everyday" })]));
    expect(dialog()!.textContent).toContain("CSV: Blue Cash Everyday");
    expect(dialog()!.textContent).not.toContain("(new)");
    expect(dialog()!.querySelector('[title*="created on import"]')).toBeNull();
    expect(dialog()!.querySelector('[aria-label^="Account for"]')?.textContent).toContain("Joint Checking");
  });

  it("draws no card of its own inside the dialog", () => {
    show(review([row(0)]));
    expect(dialog()!.querySelector(".dup-review")).toBeNull();
  });

  describe("rows that couldn't be read (VS-52)", () => {
    const problems = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ row_number: i + 3, preview: `2026-08-0${i + 1}, Coffee, abc`, reason: "This row has no amount." }));
    const withProblems = (rows: ImportRow[], n: number) => {
      const r = review(rows);
      r.pendingImport!.preview.row_errors = n;
      r.pendingImport!.preview.row_problems = problems(n);
      return r;
    };
    const items = () => Array.from(dialog()!.querySelectorAll(".import-row-problems li")).map((li) => li.textContent);

    it("lists each row with its reason and a preview, under the unchanged count sentence", () => {
      show(withProblems([row(0)], 2));
      expect(dialog()!.textContent).toContain("2 rows couldn't be read.");
      expect(items()).toHaveLength(2);
      expect(items()[0]).toContain("Row 3: This row has no amount.");
      expect(items()[0]).toContain("2026-08-01, Coffee, abc");
    });

    it("shows the first five, and Show all reveals the rest", () => {
      show(withProblems([row(0)], 7));
      expect(items()).toHaveLength(5);
      const showAll = [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Show all 7")!;
      act(() => showAll.click());
      expect(items()).toHaveLength(7);
      expect([...dialog()!.querySelectorAll("button")].some((b) => b.textContent === "Show all 7")).toBe(false);
    });

    it("keeps the all-rows-failed sentence and lists the rows", () => {
      show(withProblems([], 7));
      const summary = dialog()!.querySelector(".dup-review-summary")!.textContent;
      expect(summary).toBe("No transactions could be read from this file. 7 rows couldn't be read.");
      expect(items()).toHaveLength(5);
    });

    it("shows a row with no preview (OFX or QIF) by its reason alone", () => {
      const r = withProblems([row(0)], 1);
      r.pendingImport!.preview.row_problems = [{ row_number: 7, preview: null, reason: "This transaction is cut off; the file may be incomplete." }];
      show(r);
      expect(items()).toEqual(["Row 7: This transaction is cut off; the file may be incomplete."]);
    });
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
      expect(names[0]).not.toContain("4.50");
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

  it("lets the person open a bank category's row count to see which transactions use it, marking unticked ones", () => {
    const rows = [
      row(0, { category: "Merchandise", matched_category: null, description: "MEIJER", amount: "156.99" }),
      row(1, { category: "Merchandise", matched_category: null, description: "WALMART", amount: "36.82" }),
    ];
    const r = review(rows, { includedIndices: new Set([0]), importCategoryChoices: { Merchandise: { action: "skip" } } });
    r.pendingImport!.preview.unmatched_categories = [{ name: "Merchandise", count: 2 }];
    show(r);
    const toggle = dialog()!.querySelector<HTMLButtonElement>("button.import-category-rows-toggle")!;
    expect(toggle.textContent).toBe("2 rows");
    expect(dialog()!.querySelector(".import-category-transactions")).toBeNull();
    act(() => toggle.click());
    const items = [...dialog()!.querySelectorAll(".import-category-transactions li")];
    expect(items.map((li) => li.textContent)).toEqual([expect.stringContaining("MEIJER"), expect.stringMatching(/WALMART.*Not importing/)]);
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

  describe("VS-35 import sections", () => {
    const tabs = () => [...dialog()!.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const selected = () => tabs().find(t => t.getAttribute("aria-selected") === "true")?.dataset.importReviewTab;
    const choose = (id: string) => act(() => dialog()!.querySelector<HTMLButtonElement>(`[data-import-review-tab="${id}"]`)!.click());
    const shownPanel = () => dialog()!.querySelector<HTMLElement>("[role=tabpanel]:not([hidden])")!;
    const bankReview = (allRemembered = false) => {
      const r = review([unsure(0), row(1)]);
      r.pendingImport!.preview.unmatched_categories = [
        { name: "MERCHANDISE", count: 1, remembered_category: "Shopping" },
        { name: "OTHER BANK", count: 1, ...(allRemembered ? { remembered_category: "Groceries" } : {}) },
      ];
      r.importCategoryChoices = { MERCHANDISE: { action: "map_to", category: "Shopping" }, "OTHER BANK": allRemembered ? { action: "map_to", category: "Groceries" } : { action: "skip" } };
      return r;
    };

    it("orders bank, needs, transactions, opens bank and counts only asked names", () => {
      show(bankReview());
      expect(tabs().map(t => t.textContent)).toEqual(["Bank categories (1)", "Needs a category (1)", "Transactions (2)"]);
      expect(selected()).toBe("bank");
      expect(shownPanel().querySelectorAll("[data-import-category-name]")).toHaveLength(1);
      expect(shownPanel().textContent).toContain("Your bank uses 1 category you don't have");
      expect(shownPanel().textContent).not.toContain("MERCHANDISE");
      expect(dialog()!.textContent).toContain("Using your choices from last time for 1 bank category.");
    });

    it("opens needs when no bank category is asked, otherwise transactions", () => {
      show(review([unsure(0)]));
      expect(selected()).toBe("needs");
      const r = review([row(0)]); r.pendingImport!.preview.review_token = "other";
      show(r);
      expect(selected()).toBe("rows");
      expect(tabs().map(t => t.textContent)).toEqual(["Transactions (1)"]);
    });

    it("hides all remembered names until Change adds and selects bank in original file order", () => {
      const r = bankReview(true);
      show(r);
      expect(tabs().map(t => t.dataset.importReviewTab)).toEqual(["needs", "rows"]);
      expect(dialog()!.textContent).toContain("Using your choices from last time for 2 bank categories.");
      const change = dialog()!.querySelector<HTMLButtonElement>('[aria-label="Change your choices from last time"]')!;
      expect(change.textContent).toBe("Change");
      act(() => change.click());
      expect(selected()).toBe("bank");
      expect([...shownPanel().querySelectorAll<HTMLElement>("[data-import-category-name]")].map(el => el.dataset.importCategoryName)).toEqual(["MERCHANDISE", "OTHER BANK"]);
      expect(shownPanel().textContent?.match(/Your choice from last time/g)).toHaveLength(2);
      expect(dialog()!.querySelector('[aria-label="Change your choices from last time"]')).toBeNull();
    });

    it.each(["Let the app guess for all", "Add all as new categories"])("%s changes only listed names, preserving hidden remembered mappings", label => {
      const r = bankReview(); show(r);
      act(() => [...shownPanel().querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label)!.click());
      expect(r.updateImportCategoryChoices).toHaveBeenCalledWith({ MERCHANDISE: { action: "map_to", category: "Shopping" }, "OTHER BANK": { action: label.startsWith("Let") ? "skip" : "create" } });
    });

    it("keeps needs selected after its last choice, with count 0, completion text and enabled Import", () => {
      const r = review([unsure(0)]); show(r);
      pickMenuOption(shownPanel().querySelector("[data-import-row-choice]")!, "cat:Groceries");
      const update = vi.mocked(r.setImportRowChoices).mock.calls[0][0] as (prev: Map<number,string|null>) => Map<number,string|null>;
      r.importRowChoices = update(r.importRowChoices);
      show(r);
      expect(selected()).toBe("needs");
      expect(tabs().map(t => t.textContent)).toEqual(["Needs a category (0)", "Transactions (1)"]);
      expect(shownPanel().textContent).toContain("Every row has a category now.");
      expect(importButton().disabled).toBe(false);
    });

    it("recomputes sticky tabs and remembered split on a replacement preview, retaining selection only if available", () => {
      const r = bankReview(); show(r); choose("rows");
      r.pendingImport = { ...r.pendingImport!, preview: { ...r.pendingImport!.preview, review_token: "reread" } };
      show(r); expect(selected()).toBe("rows");
      // A Change columns preview has no bank category or uncertain row: old sticky tabs reset.
      r.pendingImport = { ...r.pendingImport, preview: { ...r.pendingImport.preview, review_token: "columns", rows: [row(0)], unmatched_categories: [] } };
      show(r); expect(tabs().map(t => t.dataset.importReviewTab)).toEqual(["rows"]);
      expect(dialog()!.textContent).not.toContain("Using your choices from last time");
      // When the selected bank tab disappears on reread, choose the first tab that needs the person.
      r.pendingImport = bankReview().pendingImport; show(r); choose("bank");
      r.pendingImport = { ...r.pendingImport!, preview: { ...r.pendingImport!.preview, review_token: "no-bank", unmatched_categories: [] } };
      show(r); expect(selected()).toBe("needs");
    });

    it("resets revealed remembered names for a new preview and for the next review", () => {
      const r=bankReview(true); show(r);
      act(()=>dialog()!.querySelector<HTMLButtonElement>('[aria-label="Change your choices from last time"]')!.click());
      r.pendingImport={...r.pendingImport!, preview:{...r.pendingImport!.preview,review_token:"new"}};
      show(r); expect(tabs().map(t=>t.dataset.importReviewTab)).toEqual(["needs","rows"]);
      expect(selected()).toBe("needs");
      show(review([], {pendingImport:null})); show(bankReview(true));
      expect(tabs().map(t=>t.dataset.importReviewTab)).toEqual(["needs","rows"]);
    });

    it("shows no tabs even if a zero-row preview has unmatched names", () => {
      const r=bankReview(); r.pendingImport!.preview.rows=[]; show(r);
      expect(dialog()!.querySelector("[role=tablist]")).toBeNull();
      expect(dialog()!.querySelector("table")).toBeNull();
      expect(dialog()!.textContent).toContain("No transactions were found");
    });

    it("keeps Select all, per-row account and CSV metadata in transactions, and Leave rest in needs", () => {
      const r=review([unsure(0), row(1,{account_name:"CSV account"})]); show(r);
      act(()=>[...shownPanel().querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="Leave the rest uncategorized")!.click());
      expect(r.leaveRestOfRowsUncategorized).toHaveBeenCalledOnce();
      choose("rows");
      act(()=>shownPanel().querySelector<HTMLInputElement>('[aria-label="Select all"]')!.click());
      expect(r.toggleSelectAllImportRows).toHaveBeenCalledOnce();
      expect(shownPanel().textContent).toContain("CSV: CSV account");
      pickMenuOption(shownPanel().querySelector('[aria-label^="Account for"]')!,"1");
      expect(r.setImportRowAccount).toHaveBeenCalledWith(0,1);
    });

    it("contains no amount in any attribute, including checkbox names", () => {
      show(review([row(0,{amount:"-1234.56"}),row(1,{amount:"-12.34"})]));
      const attributes=[...dialog()!.querySelectorAll("*")].flatMap(el=>[...el.attributes].map(a=>a.value));
      expect(attributes.some(value=>/1,?234\.56|12\.34/.test(value))).toBe(false);
    });

    it("removes vertical height limits from the table and expanded category transactions", () => {
      const css=readFileSync("src/features/transactions/Transactions.css","utf8");
      expect(css.match(/\.import-review-dialog \.dup-review-table-scroll\s*\{([^}]+)\}/)?.[1]).toMatch(/max-height:\s*none/);
      expect(css.match(/\.import-category-transactions\s*\{([^}]+)\}/)![1]).not.toMatch(/max-height|overflow-y:\s*auto/);
    });
  });

});
