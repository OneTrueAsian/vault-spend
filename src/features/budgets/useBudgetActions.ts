import { type StatusKind } from "../../shared/native/appTypes";
import { errorMessage } from "../../shared/lib/errorMessage";
import { type BudgetSuggestions } from "../../shared/lib/types";

export function useBudgetActions({ callTransaction, budgetPeriod, refreshBudgetMonthActuals, budgetYear, budgetMonthNum, setStatus, invoke, budgetMonthLabel }: {
  callTransaction: <T>(command: string, args?: Record<string, unknown> | undefined) => Promise<T>;
  budgetPeriod: string;
  refreshBudgetMonthActuals: (year: number, month: number) => Promise<void>;
  budgetYear: number;
  budgetMonthNum: number;
  setStatus: (text: string, kind?: StatusKind) => void;
  invoke: <T>(command: string, args?: Record<string, unknown> | undefined) => Promise<T>;
  budgetMonthLabel: string;
}) {
  async function handleSetBudget(category: string, monthlyAmount: string, budgetGroup: string) {
    try {
      await callTransaction("set_budget", { category, period: budgetPeriod, monthlyAmount, budgetGroup });
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSuggestBudgets(): Promise<BudgetSuggestions | null> {
    try {
      return await invoke<BudgetSuggestions>("suggest_budgets", { year: budgetYear, month: budgetMonthNum });
    } catch (e) {
      setStatus(errorMessage(e));
      return null;
    }
  }

  async function handleApplyBudgetSuggestions(rows: { category: string; amount: string; group: string }[]) {
    try {
      for (const row of rows) {
        await callTransaction("set_budget", { category: row.category, period: budgetPeriod, monthlyAmount: row.amount, budgetGroup: row.group });
      }
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
      setStatus(`Set ${rows.length} budget${rows.length === 1 ? "" : "s"} for ${budgetMonthLabel}.`);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetCap(category: string, capEnabled: boolean) {
    try {
      await callTransaction("set_budget_cap", { category, period: budgetPeriod, capEnabled });
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetRollover(category: string, rolloverEnabled: boolean) {
    try {
      await callTransaction("set_budget_rollover", { category, period: budgetPeriod, rolloverEnabled });
      // Reload the selected month after its carry policy changes.
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteBudget(category: string) {
    try {
      await callTransaction("delete_budget", { category, period: budgetPeriod });
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  return { handleSetBudget, handleSuggestBudgets, handleApplyBudgetSuggestions, handleSetCap, handleSetRollover, handleDeleteBudget };
}
