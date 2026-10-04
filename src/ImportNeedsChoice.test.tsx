// @vitest-environment jsdom
//
// Rows the app can't place with at least 50% confidence wait on the import review screen for the
// person to choose a category, or to leave them uncategorized. Nothing is preselected, so the
// person always makes the call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImportNeedsChoice, LEAVE_UNCATEGORIZED } from "./ImportNeedsChoice";
import type { ImportRow, RowChoices } from "./importResolution";
import { menuOptions, menuValue, pickMenuOption } from "./menuSelectTestUtils";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mine = ["Dining", "Groceries"];

function row(index: number, over: Partial<ImportRow> = {}): ImportRow {
  return {
    index,
    date: "2026-01-05",
    description: `SHOP ${index}`,
    amount: "-12.50",
    is_duplicate: false,
    account_name: null,
    category: null,
    matched_category: null,
    suggestion: null,
    ...over,
  };
}

describe("ImportNeedsChoice", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onChoose = vi.fn();
  const onLeaveRest = vi.fn();

  beforeEach(() => {
    onChoose.mockReset();
    onLeaveRest.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(rows: ImportRow[], choices: RowChoices = new Map(), disabled = false) {
    act(() => {
      root.render(
        <ImportNeedsChoice rows={rows} categories={mine} choices={choices} onChoose={onChoose} onLeaveRest={onLeaveRest} disabled={disabled} />,
      );
    });
  }

  const menus = () => [...container.querySelectorAll<HTMLButtonElement>("button[data-import-row-choice]")];
  const lines = () => [...container.querySelectorAll<HTMLElement>("[data-import-choice-row]")];

  it("shows nothing when no row needs a choice", () => {
    show([]);
    expect(container.innerHTML).toBe("");
  });

  it("lists each row with its date, description and amount", () => {
    show([row(3), row(7)]);
    expect(lines().map((l) => l.getAttribute("data-import-choice-row"))).toEqual(["3", "7"]);
    const text = lines()[0].textContent ?? "";
    expect(text).toContain("2026-01-05");
    expect(text).toContain("SHOP 3");
    expect(text).toContain("12.50");
  });

  it("says how many rows it lists, in the right number", () => {
    show([row(1), row(2)]);
    expect(container.querySelector("h3")?.textContent).toBe("Pick a category for 2 rows");
    show([row(1)], new Map([[1, null]]));
    expect(container.querySelector("h3")?.textContent).toBe("Pick a category for 1 row");
  });

  it("preselects nothing", () => {
    show([row(1)]);
    expect(menuValue(menus()[0])).toBe("");
    expect(menus()[0].textContent).toContain("Choose a category");
    expect(lines()[0].getAttribute("data-choice-state")).toBe("unresolved");
  });

  it("offers Leave uncategorized and each of the person's categories", () => {
    show([row(1)]);
    const labels = menuOptions(menus()[0]).map((o) => o.label);
    expect(labels).toEqual(["Leave uncategorized", "Dining", "Groceries"]);
  });

  it("reports a picked category, and Leave uncategorized as null", () => {
    show([row(1)]);
    pickMenuOption(menus()[0], "cat:Groceries");
    expect(onChoose).toHaveBeenLastCalledWith(1, "Groceries");
    pickMenuOption(menus()[0], LEAVE_UNCATEGORIZED);
    expect(onChoose).toHaveBeenLastCalledWith(1, null);
  });

  it("does not confuse a category named like the internal values with them", () => {
    const odd = ["__leave__", "cat:x"];
    act(() => {
      root.render(<ImportNeedsChoice rows={[row(1)]} categories={odd} choices={new Map()} onChoose={onChoose} onLeaveRest={onLeaveRest} />);
    });
    pickMenuOption(menus()[0], "cat:__leave__");
    expect(onChoose).toHaveBeenLastCalledWith(1, "__leave__");
    pickMenuOption(menus()[0], "cat:cat:x");
    expect(onChoose).toHaveBeenLastCalledWith(1, "cat:x");
  });

  it("reflects the choices made, including leaving a row uncategorized", () => {
    show([row(1), row(2)], new Map<number, string | null>([
      [1, "Dining"],
      [2, null],
    ]));
    expect(menus().map(menuValue)).toEqual(["cat:Dining", LEAVE_UNCATEGORIZED]);
    expect(lines().map((l) => l.getAttribute("data-choice-state"))).toEqual(["category", "uncategorized"]);
  });

  it("gives the app's best guess, or says it has none, in a few words", () => {
    show([row(1, { suggestion: { category: "Groceries", source: "guess", confidence: 0.31 } }), row(2)]);
    expect(lines()[0].textContent).toContain("Best guess: Groceries");
    expect(lines()[0].textContent).not.toContain("half sure");
    expect(lines()[1].textContent).toContain("No guess");
  });

  it("names the bank's own category for the row, so the person sees the box above would settle it", () => {
    show([row(1, { category: "Merchandise", suggestion: { category: "Groceries", source: "guess", confidence: 0.2 } }), row(2)]);
    expect(lines()[0].textContent).toContain("Your bank calls it Merchandise");
    expect(lines()[0].textContent).toContain("Best guess: Groceries");
    expect(lines()[1].textContent).not.toContain("Your bank calls it");
  });

  it("does not mention a guess for a category the person no longer has", () => {
    show([row(1, { suggestion: { category: "Gone", source: "guess", confidence: 0.3 } })]);
    expect(lines()[0].textContent).not.toContain("Gone");
    expect(lines()[0].textContent).toContain("No guess");
  });

  it("has a Leave the rest uncategorized button, off once every row has a choice", () => {
    show([row(1), row(2)], new Map([[1, "Dining"]]));
    const leave = [...container.querySelectorAll("button")].find((b) => b.textContent === "Leave the rest uncategorized")!;
    expect(leave.disabled).toBe(false);
    act(() => leave.click());
    expect(onLeaveRest).toHaveBeenCalledTimes(1);
    show([row(1)], new Map([[1, "Dining"]]));
    const done = [...container.querySelectorAll("button")].find((b) => b.textContent === "Leave the rest uncategorized")!;
    expect(done.disabled).toBe(true);
  });

  it("locks every control while the import is being saved", () => {
    show([row(1)], new Map(), true);
    expect(menus()[0].disabled).toBe(true);
    const leave = [...container.querySelectorAll("button")].find((b) => b.textContent === "Leave the rest uncategorized")!;
    expect(leave.disabled).toBe(true);
  });
});
