// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImportInboxDialog } from "./ImportInboxDialog";
import type { InboxItem } from "./importInbox";

vi.mock("./Modal", () => ({ ModalShell: ({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) =>
  <div><button data-cancel onClick={onCancel}>Cancel</button>{children}</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.showPopover = vi.fn();
  HTMLElement.prototype.hidePopover = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function item(id: number, category: string | null, kinds: InboxItem["reasons"][number]["kind"][]): InboxItem {
  return { transaction: { id, account_id: 1, date: "2026-09-23", description: `Merchant ${id}`, amount: "-10.00",
    account_name: "Checking", category, category_source: "user", confidence: null, transfer_counterpart_id: null,
    applied_to_debt: null, principal_amount: null, split_count: 0, tags: [], member_id: null, member_name: null, notes: null },
    reasons: kinds.map((kind) => ({ kind, detail: kind })), suggestion: null };
}
function mount(items: InboxItem[], setCategory = vi.fn().mockResolvedValue(undefined)) {
  const callbacks = { onSetCategory: setCategory, onDismiss: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined), onClose: vi.fn() };
  act(() => root.render(<ImportInboxDialog items={items} categories={["Groceries", "Dining Out"]} {...callbacks} />));
  return callbacks;
}
async function click(selector: string) { await act(async () => host.querySelector<HTMLElement>(selector)!.click()); }
function changeCategory(value: string) {
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Category for selected transactions"]')!.click());
  act(() => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((button) => button.textContent?.trim() === value)!.click());
}

it("reviews only selected rows, accepts a category and dismisses all its flags without deleting", async () => {
  const callbacks = mount([item(1, "Groceries", ["low_confidence", "large", "duplicate"]), item(2, "Dining Out", ["duplicate"])]);
  await click('[data-inbox-row="1"] [data-inbox-select]');
  await click('[data-inbox-review-selected]');
  expect(callbacks.onSetCategory).toHaveBeenCalledExactlyOnceWith(1, "Groceries");
  expect(callbacks.onDismiss).toHaveBeenCalledExactlyOnceWith(1, ["large", "duplicate"]);
  expect(callbacks.onDelete).not.toHaveBeenCalled();
  expect(host.querySelector('[data-inbox-row="2"]')?.getAttribute("data-inbox-state")).toBe("open");
});

it("requires missing categories and applies a bulk category to both uncategorized and flagged rows", async () => {
  const callbacks = mount([item(1, null, ["uncategorized"]), item(2, "Dining Out", ["large"])]);
  await click('[aria-label="Select all remaining transactions"]');
  expect(host.querySelector<HTMLButtonElement>('[data-inbox-review-selected]')!.disabled).toBe(true);
  changeCategory("Groceries");
  await click('[data-inbox-review-selected]');
  expect(callbacks.onSetCategory.mock.calls).toEqual([[1, "Groceries"], [2, "Groceries"]]);
  expect(callbacks.onDismiss).toHaveBeenCalledExactlyOnceWith(2, ["large"]);
  expect(host.querySelector('[data-inbox-summary]')?.textContent).toContain("All 2 reviewed");
});

it("keeps failed rows selected for retry and never repeats completed rows", async () => {
  const setCategory = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Write failed")).mockResolvedValue(undefined);
  mount([item(1, "Groceries", ["low_confidence"]), item(2, "Groceries", ["low_confidence"])], setCategory);
  await click('[aria-label="Select all remaining transactions"]');
  await click('[data-inbox-review-selected]');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Write failed");
  expect(host.querySelector<HTMLInputElement>('[data-inbox-row="2"] [data-inbox-select]')!.checked).toBe(true);
  await click('[data-inbox-review-selected]');
  expect(setCategory.mock.calls.map(([id]) => id)).toEqual([1, 2, 2]);
  expect(host.querySelector('[data-inbox-summary]')?.textContent).toContain("All 2 reviewed");
});

it("blocks duplicate submissions and closing while writes are in progress", async () => {
  let release!: () => void;
  const write = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  const callbacks = mount([item(1, "Groceries", ["low_confidence"])], write);
  await click('[aria-label="Select all remaining transactions"]');
  await click('[data-inbox-review-selected]');
  await click('[data-inbox-review-selected]');
  await click('[data-cancel]');
  expect(write).toHaveBeenCalledTimes(1);
  expect(callbacks.onClose).not.toHaveBeenCalled();
  await act(async () => release());
  await click('[data-inbox-close]');
  expect(callbacks.onClose).toHaveBeenCalledTimes(1);
});
