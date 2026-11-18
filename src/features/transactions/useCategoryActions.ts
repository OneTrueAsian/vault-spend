import type { TransactionSnapshot } from "../../shared/native/transactionContracts";
import { type StatusKind } from "../../shared/native/appTypes";
import { errorMessage } from "../../shared/lib/errorMessage";

export function useCategoryActions({ invoke, refresh, setStatus, refreshBudgetMonthActuals, budgetYear, budgetMonthNum }: {
  invoke: <T>(command: string, args?: Record<string, unknown> | undefined) => Promise<T>;
  refresh: () => Promise<TransactionSnapshot>;
  setStatus: (text: string, kind?: StatusKind) => void;
  refreshBudgetMonthActuals: (year: number, month: number) => Promise<void>;
  budgetYear: number;
  budgetMonthNum: number;
}) {
  async function handleCreateCategory(name: string, iconKey: string | null) {
    try {
      await invoke("create_category", { name, iconKey });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetCategoryIcon(name: string, iconKey: string | null) {
    try {
      await invoke("set_category_icon", { name, iconKey });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleRenameCategory(oldName: string, newName: string) {
    try {
      await invoke("rename_category", { oldName, newName });
      await Promise.all([refresh(), refreshBudgetMonthActuals(budgetYear, budgetMonthNum)]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteCategory(name: string) {
    try {
      await invoke("delete_category", { name });
      await Promise.all([refresh(), refreshBudgetMonthActuals(budgetYear, budgetMonthNum)]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  return { handleCreateCategory, handleSetCategoryIcon, handleRenameCategory, handleDeleteCategory };
}
