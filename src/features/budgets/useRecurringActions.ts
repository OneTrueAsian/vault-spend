import { type StatusKind } from "../../shared/native/appTypes";
import { errorMessage } from "../../shared/lib/errorMessage";
import { type RecurringCandidate } from "../../shared/lib/types";

export function useRecurringActions({ invoke, refreshRecurring, refreshRecurringTotals, setStatus, refreshRecurringCandidates, refreshRecurringMatches }: {
  invoke: <T>(command: string, args?: Record<string, unknown> | undefined) => Promise<T>;
  refreshRecurring: () => Promise<void>;
  refreshRecurringTotals: () => Promise<void>;
  setStatus: (text: string, kind?: StatusKind) => void;
  refreshRecurringCandidates: () => Promise<void>;
  refreshRecurringMatches: () => Promise<void>;
}) {
  async function handleCreateRecurring(
    merchant: string,
    category: string | null,
    amount: string,
    cadence: string,
    anchorDate: string,
    accountId: number | null,
    memberId: number | null,
  ) {
    try {
      const id = await invoke<number>("create_recurring", { merchant, category, amount, cadence, anchorDate, accountId });
      if (memberId !== null) {
        await invoke("set_recurring_member", { id, memberId });
      }
      await Promise.all([refreshRecurring(), refreshRecurringTotals()]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleUpdateRecurring(
    id: number,
    merchant: string,
    category: string | null,
    amount: string,
    cadence: string,
    anchorDate: string,
    accountId: number | null,
    memberId: number | null,
  ) {
    try {
      await invoke("update_recurring", { id, merchant, category, amount, cadence, anchorDate, accountId });
      await invoke("set_recurring_member", { id, memberId });
      await Promise.all([refreshRecurring(), refreshRecurringTotals()]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteRecurring(id: number) {
    try {
      await invoke("delete_recurring", { id });
      await Promise.all([refreshRecurring(), refreshRecurringTotals()]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetRecurringStatus(id: number, status: "keep" | "reviewing" | "canceled") {
    try {
      await invoke("set_recurring_status", { id, status });
      await refreshRecurring();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleAddRecurringCandidate(candidate: RecurringCandidate) {
    try {
      await invoke("create_recurring", {
        merchant: candidate.merchant,
        category: candidate.category,
        amount: candidate.amount,
        cadence: candidate.cadence,
        anchorDate: candidate.anchor_date,
        accountId: null,
      });
      await Promise.all([refreshRecurring(), refreshRecurringTotals(), refreshRecurringCandidates()]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDismissRecurringCandidate(candidate: RecurringCandidate) {
    try {
      await invoke("dismiss_recurring_candidate", {
        merchant: candidate.merchant,
        amount: candidate.amount,
        cadence: candidate.cadence,
      });
      await refreshRecurringCandidates();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleIgnoreRecurringPriceChange(id: number, from: string, to: string) {
    try {
      await invoke("dismiss_recurring_price_change", { id, from, to });
      await refreshRecurringMatches();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  return { handleCreateRecurring, handleUpdateRecurring, handleDeleteRecurring, handleSetRecurringStatus, handleAddRecurringCandidate, handleDismissRecurringCandidate, handleIgnoreRecurringPriceChange };
}
