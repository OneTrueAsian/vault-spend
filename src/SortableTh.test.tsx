// @vitest-environment jsdom
//
// A sortable column heading used to be a bare <th onClick>: the mouse could sort by it, but the keyboard
// couldn't even reach it, and a screen reader wasn't told which way the table was sorted. It now holds a
// real button and carries aria-sort while it is the sorted column.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SortableTh } from "./SortableTh";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Column = "date" | "amount";

describe("SortableTh", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSort = vi.fn();

  beforeEach(() => {
    onSort.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(activeColumn: Column, direction: "asc" | "desc", className?: string) {
    act(() => {
      root.render(
        <table>
          <thead>
            <tr>
              <SortableTh<Column> column="date" activeColumn={activeColumn} direction={direction} onSort={onSort} className={className}>
                Date
              </SortableTh>
              <SortableTh<Column> column="amount" activeColumn={activeColumn} direction={direction} onSort={onSort}>
                Amount
              </SortableTh>
            </tr>
          </thead>
        </table>,
      );
    });
    const [date, amount] = [...container.querySelectorAll("th")];
    return { date, amount };
  }

  it("holds a real button, so the keyboard can reach it", () => {
    const { date } = show("amount", "asc");
    const button = date.querySelector("button");
    expect(button, "the heading's label should be a button").not.toBeNull();
    expect(button!.getAttribute("type")).toBe("button");
    expect(button!.textContent).toBe("Date");
  });

  it("marks only the sorted heading with aria-sort, and says which way", () => {
    const asc = show("date", "asc");
    expect(asc.date.getAttribute("aria-sort")).toBe("ascending");
    expect(asc.amount.hasAttribute("aria-sort")).toBe(false);
    const desc = show("date", "desc");
    expect(desc.date.getAttribute("aria-sort")).toBe("descending");
  });

  it("draws the direction arrow for the eye but hides it from screen readers", () => {
    const { date, amount } = show("date", "desc");
    const arrow = date.querySelector("button span[aria-hidden='true']");
    expect(arrow?.textContent).toContain("▼");
    expect(amount.querySelector("span")).toBeNull();
  });

  it("sorts once when its button is activated (Enter and Space both arrive as a click)", () => {
    const { date } = show("amount", "asc");
    act(() => date.querySelector("button")!.click());
    expect(onSort).toHaveBeenCalledTimes(1);
    expect(onSort).toHaveBeenCalledWith("date");
  });

  it("still sorts when the mouse clicks the cell around the label", () => {
    const { amount } = show("date", "asc");
    act(() => amount.click());
    expect(onSort).toHaveBeenCalledTimes(1);
    expect(onSort).toHaveBeenCalledWith("amount");
  });

  it("keeps the classes the table's styling and tests look for", () => {
    const { date } = show("date", "asc", "amount-col");
    expect(date.className).toBe("amount-col sortable-col");
  });
});
