// @vitest-environment jsdom
// VS-46: Add widget › Pin a specific item can also pin a watch on a category, a tag, a store (typed, matched like the
// Transactions search box) or a saved filter.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AddWidgetDialog } from "./AddWidgetDialog";
import type { SavedTransactionFilter } from "../../shared/native/appTypes";
import type { WidgetId } from "../../shared/lib/dashboardLayout";

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
  document.body.innerHTML = "";
});

const saved = (name: string): SavedTransactionFilter => ({
  name, searchText: "", filterCategory: "all", filterAccountIds: "all", filterMemberIds: "all", filterFrom: "", filterTo: "", filterTag: "all",
});

function show(currentWidgets: WidgetId[] = []) {
  const onAdd = vi.fn();
  act(() => root.render(
    <AddWidgetDialog currentWidgets={currentWidgets} accounts={[]} buckets={[]} holdings={[]} safeToSpendEnabled={false}
      categories={["Coffee", "Groceries"]} tags={["treat"]} savedFilters={[saved("Weekend")]} onAdd={onAdd} onCancel={vi.fn()} />,
  ));
  return onAdd;
}
const row = (label: string) => [...document.querySelectorAll<HTMLElement>(".category-manage-row")].find((r) => r.querySelector(".category-manage-name")?.textContent === label)!;
const addButton = (r: HTMLElement) => [...r.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Add")!;
function choose(r: HTMLElement, option: string) {
  act(() => r.querySelector<HTMLButtonElement>(".menu-select-toggle")!.click());
  const item = [...document.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")].find((b) => b.textContent?.includes(option));
  expect(item, `option ${option}`).toBeDefined();
  act(() => item!.click());
}
const options = (r: HTMLElement) => {
  act(() => r.querySelector<HTMLButtonElement>(".menu-select-toggle")!.click());
  const found = [...document.querySelectorAll("[role='menuitemradio']")].map((b) => b.textContent);
  act(() => r.querySelector<HTMLButtonElement>(".menu-select-toggle")!.click());
  return found;
};

describe("Add widget › watch rows (VS-46)", () => {
  it("pins a category, a tag and a saved filter as watch tiles", () => {
    const onAdd = show();
    choose(row("Category"), "Coffee");
    act(() => addButton(row("Category")).click());
    choose(row("Tag"), "treat");
    act(() => addButton(row("Tag")).click());
    choose(row("Saved filter"), "Weekend");
    act(() => addButton(row("Saved filter")).click());
    expect(onAdd.mock.calls.map((c) => c[0])).toEqual(["watch:category:Coffee", "watch:tag:treat", "watch:filter:Weekend"]);
  });

  it("leaves out what is already watched", () => {
    show(["watch:category:Coffee"]);
    expect(options(row("Category"))).toEqual(["Groceries"]);
  });

  it("pins a store from a typed name, trimmed, and says what Add is waiting for once the box is used", () => {
    const onAdd = show();
    const r = row("Store");
    const box = r.querySelector<HTMLInputElement>("input")!;
    expect(addButton(r).disabled).toBe(true);
    expect(r.querySelector("[data-watch-store-missing]")).toBeNull();
    act(() => box.focus());
    expect(r.querySelector("[data-watch-store-missing]")?.textContent).toBe("Type a store name, as it appears in your transactions.");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box, "  Amazon ");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(addButton(r).disabled).toBe(false);
    act(() => addButton(r).click());
    expect(onAdd).toHaveBeenCalledWith("watch:store:Amazon");
    expect(box.value).toBe("");
  });
});
