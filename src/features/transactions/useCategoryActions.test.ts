import { describe, expect, it, vi } from "vitest";
import { useCategoryActions } from "./useCategoryActions";

// VS-46: a Dashboard watch on a category follows it when it is renamed, so onRenamed runs only once the rename saved.
describe("useCategoryActions › rename", () => {
  const setup = (invoke: (command: string) => Promise<unknown>) => {
    const onRenamed = vi.fn();
    const setStatus = vi.fn();
    const actions = useCategoryActions({
      invoke: invoke as never, refresh: vi.fn(async () => ({}) as never), setStatus, refreshBudgetMonthActuals: vi.fn(async () => {}),
      budgetYear: 2026, budgetMonthNum: 11, onRenamed,
    });
    return { actions, onRenamed, setStatus };
  };

  it("tells the caller the old and new name after a rename", async () => {
    const { actions, onRenamed } = setup(async () => undefined);
    await actions.handleRenameCategory("Coffee", "Cafes");
    expect(onRenamed).toHaveBeenCalledWith("Coffee", "Cafes");
  });

  it("says nothing about a rename that failed", async () => {
    const { actions, onRenamed, setStatus } = setup(async () => { throw new Error("A category with that name already exists."); });
    await actions.handleRenameCategory("Coffee", "Groceries");
    expect(onRenamed).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalled();
  });
});
