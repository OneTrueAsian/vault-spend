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
import { formatAmount, formatDisplayDate } from "./format";
import type { ImportRow } from "./importResolution";
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

  it("says in plain words that these are the bank's categories, and that the choice is remembered", () => {
    show();
    const text = container.textContent ?? "";
    expect(text).toContain("Your bank uses 2 categories you don't have");
    expect(text).toContain("Pick one of yours for each. The app will remember it next time.");
  });

  it("has an info icon saying that letting the app guess is not remembered", () => {
    show();
    const icons = container.querySelectorAll<HTMLButtonElement>("button.info-tip-button");
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute("aria-label")).toBe("About Let the app guess");
    const tip = container.querySelector("[role='tooltip']")!.textContent ?? "";
    expect(tip).toContain("does not remember");
    expect(tip).toContain("ask again");
    expect(tip).toContain("pick one of your own categories");
  });

  it("uses the singular for a single category", () => {
    show({ "Gas/Automotive": { action: "skip" } }, [{ name: "Gas/Automotive", count: 1 }]);
    expect(container.textContent).toContain("Your bank uses 1 category you don't have");
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

  it("locks every control while the import is being saved", () => {
    act(() => {
      root.render(
        <ImportCategoryReconcile unmatched={unmatched} categories={mine} choices={defaultCategoryChoices(unmatched)} onChange={onChange} onSetAll={onSetAll} disabled />,
      );
    });
    expect(selects().every((b) => b.disabled)).toBe(true);
    // The info icon only explains, so it stays usable while saving.
    expect([...container.querySelectorAll("button:not([data-import-category-choice]):not(.info-tip-button)")].every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  describe("showing the transactions under a category", () => {
    const fileRow = (index: number, category: string | null, description: string, amount: string, date = "2026-10-31"): ImportRow => ({
      index,
      date,
      description,
      amount,
      is_duplicate: false,
      account_name: null,
      category,
      matched_category: null,
      suggestion: null,
    });
    const rows = [
      fileRow(0, "Merchandise", "Meijer", "156.99"),
      fileRow(1, "Gas/Automotive", "Speedway", "42.89", "2026-10-30"),
      fileRow(2, "MERCHANDISE", "Walmart", "36.82", "2026-10-28"),
      fileRow(3, null, "No category here", "9.00"),
    ];
    const showRows = (included: Set<number> = new Set([0, 1, 2, 3]), extra: Partial<React.ComponentProps<typeof ImportCategoryReconcile>> = {}) => {
      act(() => {
        root.render(
          <ImportCategoryReconcile
            unmatched={[
              { name: "Merchandise", count: 2 },
              { name: "Gas/Automotive", count: 1 },
            ]}
            categories={mine}
            choices={defaultCategoryChoices(unmatched)}
            onChange={onChange}
            onSetAll={onSetAll}
            rows={rows}
            included={included}
            {...extra}
          />,
        );
      });
    };
    const toggles = () => [...container.querySelectorAll<HTMLButtonElement>("button.import-category-rows-toggle")];
    const listFor = (i: number) => container.querySelectorAll(".import-category-row")[i].querySelector(".import-category-transactions");

    it("turns the row count into a button, with every list closed at first", () => {
      showRows();
      expect(toggles().map((b) => b.textContent)).toEqual(["2 rows", "1 row"]);
      expect(toggles().map((b) => b.getAttribute("aria-expanded"))).toEqual(["false", "false"]);
      expect(container.querySelector(".import-category-transactions")).toBeNull();
    });

    it("opens a list of that category's transactions, matched whatever the casing, and closes it again", () => {
      showRows();
      act(() => toggles()[0].click());
      expect(toggles()[0].getAttribute("aria-expanded")).toBe("true");
      const items = [...listFor(0)!.querySelectorAll("li")];
      expect(items).toHaveLength(2);
      expect(items[0].textContent).toContain("Meijer");
      expect(items[0].textContent).toContain(formatDisplayDate("2026-10-31"));
      expect(items[0].textContent).toContain(formatAmount("156.99"));
      expect(items[1].textContent).toContain("Walmart");
      expect(listFor(1)).toBeNull();
      act(() => toggles()[0].click());
      expect(listFor(0)).toBeNull();
      expect(toggles()[0].getAttribute("aria-expanded")).toBe("false");
    });

    it("marks the category list while any transaction list is open, so it can grow instead of scrolling inside the dialog", () => {
      showRows();
      const list = () => container.querySelector(".import-category-list")!;
      expect(list().hasAttribute("data-has-open")).toBe(false);
      act(() => toggles()[0].click());
      expect(list().hasAttribute("data-has-open")).toBe(true);
      act(() => toggles()[0].click());
      expect(list().hasAttribute("data-has-open")).toBe(false);
    });

    it("points the button at its list", () => {
      showRows();
      act(() => toggles()[1].click());
      expect(toggles()[1].getAttribute("aria-controls")).toBe(listFor(1)!.id);
    });

    it("marks rows that are not ticked as not importing, and leaves ticked ones plain", () => {
      showRows(new Set([0, 1, 3]));
      act(() => toggles()[0].click());
      const items = [...listFor(0)!.querySelectorAll("li")];
      expect(items).toHaveLength(2);
      expect(items[0].textContent).not.toContain("Not importing");
      expect(items[1].textContent).toContain("Walmart");
      expect(items[1].textContent).toContain("Not importing");
    });

    it("keeps the count as it was, whatever is ticked", () => {
      showRows(new Set());
      expect(toggles().map((b) => b.textContent)).toEqual(["2 rows", "1 row"]);
    });

    it("keeps the toggle usable while the import is being saved", () => {
      showRows(undefined, { disabled: true });
      expect(toggles()).toHaveLength(2);
      expect(toggles().every((b) => !b.disabled)).toBe(true);
    });

    it("still says when a choice is remembered from last time", () => {
      showRows(undefined, {
        unmatched: [{ name: "Merchandise", count: 2, remembered_category: "Groceries" }],
        choices: { Merchandise: { action: "map_to", category: "Groceries" } },
      });
      expect(container.textContent).toContain("Your choice from last time");
    });

    it("leaves the count as plain text when no rows are given", () => {
      show();
      expect(toggles()).toHaveLength(0);
      expect(container.textContent).toContain("12 rows");
    });
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
