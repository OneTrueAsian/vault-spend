// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TransactionsPageActions } from "./TransactionsPageActions";
import type { ImportReview } from "./useImportReview";

describe("TransactionsPageActions", () => {
  let container: HTMLDivElement;
  let root: Root;
  const handleImport = vi.fn(async () => undefined);
  const setNewTransactionOpen = vi.fn();
  const openManageCategories = vi.fn();

  beforeEach(() => {
    handleImport.mockClear();
    setNewTransactionOpen.mockClear();
    openManageCategories.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <TransactionsPageActions
          busy={false}
          importReview={{ pendingImport: null } as ImportReview}
          dataLoaded
          handleImport={handleImport}
          setNewTransactionOpen={setNewTransactionOpen}
          moreMenuRef={createRef<HTMLDivElement>()}
          setMoreMenuOpen={vi.fn()}
          moreMenuOpen={false}
          moreMenuShouldRender={false}
          moreMenuClosing={false}
          openManageCategories={openManageCategories}
          openManageFamilyMembers={vi.fn()}
          handleRecategorize={vi.fn(async () => undefined)}
          handleExportTransactionsCsv={vi.fn(async () => undefined)}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

  it("has no standing account menu: Import and Add transaction each ask for the account themselves", () => {
    expect(container.querySelector("#ledger-account-select")).toBeNull();
    expect(container.querySelector(".import-controls-label")).toBeNull();
    expect(container.textContent).not.toContain("Add to");
  });

  it("keeps the Import and Add transaction buttons working", () => {
    act(() => button("Import transactions")!.click());
    expect(handleImport).toHaveBeenCalledTimes(1);
    act(() => button("Add transaction")!.click());
    expect(setNewTransactionOpen).toHaveBeenCalledWith(true);
  });

  it("has Manage categories as a quick button beside Import and Add transaction", () => {
    const labels = [...container.querySelectorAll(".import-controls > button")].map((b) => b.textContent?.trim());
    expect(labels).toEqual(["Import transactions", "Add transaction", "Manage categories"]);
    act(() => button("Manage categories")!.click());
    expect(openManageCategories).toHaveBeenCalledTimes(1);
  });

  it("no longer repeats Manage categories in the ⋯ menu", () => {
    act(() => {
      root.render(
        <TransactionsPageActions
          busy={false}
          importReview={{ pendingImport: null } as ImportReview}
          dataLoaded
          handleImport={handleImport}
          setNewTransactionOpen={setNewTransactionOpen}
          moreMenuRef={createRef<HTMLDivElement>()}
          setMoreMenuOpen={vi.fn()}
          moreMenuOpen
          moreMenuShouldRender
          moreMenuClosing={false}
          openManageCategories={openManageCategories}
          openManageFamilyMembers={vi.fn()}
          handleRecategorize={vi.fn(async () => undefined)}
          handleExportTransactionsCsv={vi.fn(async () => undefined)}
        />,
      );
    });
    expect([...container.querySelectorAll(".more-menu-item")].map((b) => b.textContent?.trim())).toEqual([
      "Manage family members",
      "Categorize uncategorized",
      "Export CSV",
    ]);
  });
});
