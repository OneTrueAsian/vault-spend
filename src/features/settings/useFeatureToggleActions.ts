import type { Dispatch, SetStateAction } from "react";
import type { TransactionSnapshot } from "../../shared/native/transactionContracts";
import { type StatusKind } from "../../shared/native/appTypes";
import { type BillAwareForecast } from "../../shared/lib/types";
import { errorMessage } from "../../shared/lib/errorMessage";

export function useFeatureToggleActions({ invoke, refreshAppSettings, setStatus, refreshBudgetMonthActuals, budgetYear, budgetMonthNum, setSafeToSpendForecast, refresh }: {
  invoke: <T>(command: string, args?: Record<string, unknown> | undefined) => Promise<T>;
  refreshAppSettings: () => Promise<void>;
  setStatus: (text: string, kind?: StatusKind) => void;
  refreshBudgetMonthActuals: (year: number, month: number) => Promise<void>;
  budgetYear: number;
  budgetMonthNum: number;
  setSafeToSpendForecast: Dispatch<SetStateAction<BillAwareForecast | null>>;
  refresh: () => Promise<TransactionSnapshot>;
}) {
  async function handleSetApplyToDebtEnabled(enabled: boolean) {
    try {
      await invoke("set_apply_to_debt_enabled", { enabled });
      await refreshAppSettings();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetSplitPurchasesEnabled(enabled: boolean) {
    try {
      await invoke("set_split_purchases_enabled", { enabled });
      await refreshAppSettings();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetEnvelopeCapsEnabled(enabled: boolean) {
    try {
      await invoke("set_envelope_caps_enabled", { enabled });
      await refreshAppSettings();
      // The feature's effect on the 90% threshold lives in the backend
      // (see budget_alerts_for_month) — refresh so any already-loaded
      // alerts pick up the change immediately instead of on next nav.
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetRolloverEnabled(enabled: boolean) {
    try {
      await invoke("set_rollover_enabled", { enabled });
      await refreshAppSettings();
      // Reload the selected month after its carry policy changes.
      await refreshBudgetMonthActuals(budgetYear, budgetMonthNum);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetSafeToSpendEnabled(enabled: boolean) {
    try {
      await invoke("set_safe_to_spend_enabled", { enabled });
      await refreshAppSettings();
      if (!enabled) setSafeToSpendForecast(null);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAutoLinkTransfers(enabled: boolean) {
    try {
      const linkedNow = await invoke<number>("set_auto_link_transfers", { enabled });
      await refreshAppSettings();
      if (!enabled) {
        setStatus("Automatic transfer linking is off. Links already made stay; unlink any from Transactions.", "info");
        return;
      }
      // Turning it on also links the clear-cut pairs already in the ledger.
      await refresh();
      setStatus(
        linkedNow > 0
          ? `Automatic linking is on. ${linkedNow === 1 ? "Linked 1 transfer that was" : `Linked ${linkedNow} transfers that were`} already there — review ${linkedNow === 1 ? "it" : "them"} on Transactions.`
          : "Automatic linking is on. Clear-cut transfers will be linked as they arrive.",
        "success",
      );
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  return { handleSetApplyToDebtEnabled, handleSetSplitPurchasesEnabled, handleSetEnvelopeCapsEnabled, handleSetRolloverEnabled, handleSetSafeToSpendEnabled, handleSetAutoLinkTransfers };
}
