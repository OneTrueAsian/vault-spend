// @vitest-environment jsdom
//
// The import review screen used to say nothing about the categories a bank file brings, and the app
// quietly added every one of them to the person's list. This panel is where they now decide, for each
// category the file uses that they don't have: use one of their own, add it as a new one, or leave
// those rows uncategorized. Nothing is added unless they choose to.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImportCategoryReconcile, defaultCategoryChoices, type CategoryChoice } from "./ImportCategoryReconcile";
import { menuOptions, menuValue, pickMenuOption } from "./menuSelectTestUtils";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mine = ["Groceries", "Dining Out", "Rent"];
const unmatched = [
  { name: "Merchandise", count: 12 },
  { name: "Gas/Automotive", count: 1 },
];

describe("ImportCategoryReconcile", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onChange = vi.fn();
  const onSetAll = vi.fn();

  beforeEach(() => {
    onChange.mockReset();
    onSetAll.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function show(choices: Record<string, CategoryChoice> = defaultCategoryChoices(unmatched), list = unmatched) {
    act(() => {
      root.render(<ImportCategoryReconcile unmatched={list} categories={mine} choices={choices} onChange={onChange} onSetAll={onSetAll} />);
    });
  }

  const selects = () => [...container.querySelectorAll<HTMLButtonElement>("button[data-import-category-choice]")];

  const pick = pickMenuOption;

  it("shows nothing when the file brings no category the person lacks", () => {
    show({}, []);
    expect(container.innerHTML).toBe("");
  });

  it("says how many categories are unfamiliar and that none will be added on its own", () => {
    show();
    const text = container.textContent ?? "";
    expect(text).toContain("2 categories in this file aren't in your list");
    expect(text).toMatch(/won't add them unless you say so/i);
  });

  it("uses the singular for a single category", () => {
    show({ "Gas/Automotive": { action: "skip" } }, [{ name: "Gas/Automotive", count: 1 }]);
    expect(container.textContent).toContain("1 category in this file isn't in your list");
  });

  it("lists each category with how many rows use it, one dropdown each", () => {
    show();
    const text = container.textContent ?? "";
    expect(text).toContain("Merchandise");
    expect(text).toContain("12 rows");
    expect(text).toContain("Gas/Automotive");
    expect(text).toContain("1 row");
    expect(selects()).toHaveLength(2);
    expect(selects()[0].getAttribute("aria-label")).toContain("Merchandise");
  });

  it("defaults every category to not being used", () => {
    expect(defaultCategoryChoices(unmatched)).toEqual({
      Merchandise: { action: "skip" },
      "Gas/Automotive": { action: "skip" },
    });
    show();
    expect(selects().map(menuValue)).toEqual(["skip", "skip"]);
  });

  it("offers not using it, adding the file's category, or any of the person's own", () => {
    show();
    const options = menuOptions(selects()[0]).map((o) => o.label);
    expect(options[0]).toBe("Let the app guess");
    expect(options[1]).toBe("Add as a new category");
    expect(options.slice(2)).toEqual(mine);
  });

  it("reports the person's own category when one is picked", () => {
    show();
    pick(selects()[0], "map:Dining Out");
    expect(onChange).toHaveBeenCalledWith("Merchandise", { action: "map_to", category: "Dining Out" });
  });

  it("reports adding a new category only when that is picked", () => {
    show();
    expect(onChange).not.toHaveBeenCalled();
    pick(selects()[1], "create");
    expect(onChange).toHaveBeenCalledWith("Gas/Automotive", { action: "create" });
  });

  it("reflects the current choices", () => {
    show({ Merchandise: { action: "map_to", category: "Groceries" }, "Gas/Automotive": { action: "create" } });
    expect(selects().map(menuValue)).toEqual(["map:Groceries", "create"]);
  });

  it("fills in a choice remembered from an earlier import, and says so", () => {
    const withMemory = [{ name: "Merchandise", count: 12, remembered_category: "Groceries" }, { name: "Gas/Automotive", count: 1 }];
    expect(defaultCategoryChoices(withMemory)).toEqual({
      Merchandise: { action: "map_to", category: "Groceries" },
      "Gas/Automotive": { action: "skip" },
    });
    show(defaultCategoryChoices(withMemory), withMemory);
    expect(selects().map(menuValue)).toEqual(["map:Groceries", "skip"]);
    const rows = [...container.querySelectorAll(".import-category-row")];
    expect(rows[0].textContent).toContain("Your choice from last time");
    expect(rows[1].textContent).not.toContain("Your choice from last time");
  });

  it("stops saying it remembered once the choice is changed", () => {
    const withMemory = [{ name: "Merchandise", count: 12, remembered_category: "Groceries" }];
    show({ Merchandise: { action: "skip" } }, withMemory);
    expect(container.textContent).not.toContain("Your choice from last time");
  });

  it("explains that unsure rows wait for a choice and that picks are remembered", () => {
    show();
    const text = container.textContent ?? "";
    expect(text).toMatch(/remember/i);
    expect(text).toMatch(/choose/i);
  });

  it("locks every control while the import is being saved", () => {
    act(() => {
      root.render(
        <ImportCategoryReconcile unmatched={unmatched} categories={mine} choices={defaultCategoryChoices(unmatched)} onChange={onChange} onSetAll={onSetAll} disabled />,
      );
    });
    expect(selects().every((b) => b.disabled)).toBe(true);
    expect([...container.querySelectorAll("button:not([data-import-category-choice])")].every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("has one-click ways to not use any of them or to add them all", () => {
    show();
    const buttons = [...container.querySelectorAll("button")];
    const leaveAll = buttons.find((b) => b.textContent === "Let the app guess for all")!;
    const addAll = buttons.find((b) => b.textContent === "Add all as new categories")!;
    act(() => leaveAll.click());
    expect(onSetAll).toHaveBeenLastCalledWith("skip");
    act(() => addAll.click());
    expect(onSetAll).toHaveBeenLastCalledWith("create");
  });
});
