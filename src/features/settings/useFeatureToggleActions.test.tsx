// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useFeatureToggleActions } from "./useFeatureToggleActions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useFeatureToggleActions", () => {
  it("saves the Exclude from budget switch, then reloads settings and the budget month", async () => {
    const calls: string[] = [];
    const invoke = vi.fn(async (command: string) => { calls.push(command); return undefined as never; });
    const refreshAppSettings = vi.fn(async () => { calls.push("refreshAppSettings"); });
    const refreshBudgetMonthActuals = vi.fn(async () => { calls.push("refreshBudgetMonthActuals"); });
    let actions!: ReturnType<typeof useFeatureToggleActions>;
    function Probe() {
      actions = useFeatureToggleActions({ invoke, refreshAppSettings, setStatus: vi.fn(), refreshBudgetMonthActuals, budgetYear: 2026, budgetMonthNum: 11, setSafeToSpendForecast: vi.fn(), refresh: vi.fn() });
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<Probe />));
    await act(async () => { await actions.handleSetBudgetExclusionEnabled(true); });
    expect(invoke).toHaveBeenCalledWith("set_budget_exclusion_enabled", { enabled: true });
    expect(calls).toEqual(["set_budget_exclusion_enabled", "refreshAppSettings", "refreshBudgetMonthActuals"]);
    expect(refreshBudgetMonthActuals).toHaveBeenCalledWith(2026, 11);
    act(() => root.unmount());
  });
});
