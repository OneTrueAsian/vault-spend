// @vitest-environment jsdom
//
// The selection bar's "Move to account": offered beside "Set category to", names the destinations, hands the choice
// to the review (it never moves anything itself), and explains itself when there is nowhere to move to.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionBulkActionsBar } from "./TransactionBulkActionsBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(moveDestinations: { value: string; label: string }[], onMoveToAccount = vi.fn(), count = 3) {
  const noop = vi.fn();
  act(() =>
    root.render(
      <TransactionBulkActionsBar
        selectedIds={new Set(Array.from({ length: count }, (_, i) => i + 1))}
        handleBulkCategoryChange={noop}
        categoryOptions={["Groceries"]}
        moveDestinations={moveDestinations}
        onMoveToAccount={onMoveToAccount}
        handleAddSelectedToRecurring={noop}
        familyMembers={[]}
        handleBulkMemberChange={noop}
        allTags={[]}
        bulkTagText=""
        setBulkTagText={noop}
        handleBulkAddTag={noop}
        confirmingBulkDelete={false}
        setConfirmingBulkDelete={noop}
        handleBulkDelete={noop}
        confirmingBulkFlip={false}
        selectedAccountNames={["Checking"]}
        setConfirmingBulkFlip={noop}
        handleBulkFlipSigns={noop}
        selectedPairForLink={null}
        handleLinkSelectedAsTransfer={noop}
        setSelectedIds={noop}
      />,
    ),
  );
  return onMoveToAccount;
}
const trigger = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label^="${name}"]`);

describe("Move to account in the selection bar", () => {
  it("sits right after Set category to", () => {
    render([{ value: "2", label: "Savings (Savings)" }]);
    const labels = [...document.querySelectorAll<HTMLButtonElement>(".bulk-actions-bar .menu-select > button")].map((b) => b.getAttribute("aria-label"));
    expect(labels.slice(0, 2)).toEqual(["Set category to", "Move to account"]);
  });

  it("lists the destinations by name and kind, and chooses one without doing anything else", () => {
    const onMove = render([{ value: "2", label: "Savings (Savings)" }, { value: "4", label: "Visa (Credit card)" }]);
    act(() => trigger("Move to account")!.click());
    const options = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"], .menu-select-option')];
    expect(options.map((o) => o.textContent?.trim())).toEqual(["Savings (Savings)", "Visa (Credit card)"]);
    act(() => options[1].click());
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith("4");
  });

  it("is disabled and explains why when there is no account to move to", () => {
    render([]);
    const control = trigger("Move to account")!;
    expect(control.disabled).toBe(true);
    expect(control.title).toBe("There is no other account to move these transactions to.");
    expect(control.textContent).toContain("No other account to move to");
  });
});

describe("a selection too large for anything but a move", () => {
  const bar = () => document.querySelector(".bulk-actions-bar")!;
  it("keeps everything at 250 selected", () => {
    render([{ value: "2", label: "Savings (Savings)" }], vi.fn(), 250);
    expect(trigger("Set category to")).not.toBeNull();
    expect(bar().textContent).toContain("Delete selected");
    expect(bar().querySelector("[data-move-only-note]")).toBeNull();
  });
  it("offers only Move to account and Clear selection above 250, and says why", () => {
    const onMove = render([{ value: "2", label: "Savings (Savings)" }], vi.fn(), 251);
    expect(bar().textContent).toContain("251 selected");
    expect(trigger("Move to account")).not.toBeNull();
    for (const name of ["Set category to", "Add to Recurring"]) expect(trigger(name), name).toBeNull();
    for (const text of ["Delete selected", "Flip signs", "Add tag"]) expect(bar().textContent).not.toContain(text);
    expect(bar().querySelector("input")).toBeNull();
    expect(bar().querySelector("[data-move-only-note]")!.textContent).toBe("Only moving works with more than 250 selected. Select 250 or fewer to change anything else.");
    expect(bar().textContent).toContain("Clear selection");
    act(() => trigger("Move to account")!.click());
    act(() => document.querySelector<HTMLElement>('[role="menuitemradio"], [role="menuitem"], .menu-select-option')!.click());
    expect(onMove).toHaveBeenCalledWith("2");
  });
});
