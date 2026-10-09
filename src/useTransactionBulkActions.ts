import { useEffect, useState } from "react";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import { errorMessage } from "./errorMessage";
import { distinctMerchants, similarOfferText } from "./similarRules";
import { setLastUsedAccountId } from "./appStorage";
import type { useTransactionData } from "./useTransactionData";
import type { useTransactionsLedger } from "./useTransactionsLedger";
import type { StatusKind } from "./appTypes";

/** Owns creation, categorization, bulk selection actions and undo/review decisions. */
export function useTransactionBulkActions({ data, ledger, onStatus: setStatus, onBusy: setBusy, askNewCategory, refreshRecurring }: {
  data: ReturnType<typeof useTransactionData>; ledger: Pick<ReturnType<typeof useTransactionsLedger>, "selectedIds" | "setSelectedIds">;
  onStatus: (message: string, kind?: StatusKind) => void; onBusy: (busy: boolean) => void;
  askNewCategory: () => Promise<string | null>; refreshRecurring: () => Promise<void>;
}) {
  const { refresh, refreshRows, setTransactions, call: callTransaction } = data;
  const transactions = data.snapshot?.transactions ?? [];
  const { selectedIds, setSelectedIds } = ledger;
  const [bulkTagText, setBulkTagText] = useState("");

  const [newTransactionOpen, setNewTransactionOpen] = useState(false);

  const [reviewIds, setReviewIds] = useState<Set<number> | null>(null);

  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);

  useAutoCancelDelete(confirmingBulkDelete, () => setConfirmingBulkDelete(false));

  const [confirmingBulkFlip, setConfirmingBulkFlip] = useState(false);

  useAutoCancelDelete(confirmingBulkFlip, () => setConfirmingBulkFlip(false));

  const [undoToast, setUndoToast] = useState<{ text: string; ids: number[] } | null>(null);

  useEffect(() => {
    if (!undoToast) return;
    const timer = setTimeout(() => setUndoToast(null), 10000);
    return () => clearTimeout(timer);
  }, [undoToast]);

  const [similarToast, setSimilarToast] = useState<{ text: string; patterns: string[]; category: string; count: number } | null>(null);

  useEffect(() => {
    if (!similarToast) return;
    const timer = setTimeout(() => setSimilarToast(null), 12000);
    return () => clearTimeout(timer);
  }, [similarToast]);

  async function handleCategoryChange(id: number, value: string) {
    if (value === "__new__") {
      const custom = await askNewCategory();
      if (!custom) return;
      value = custom;
    }

    const description = transactions.find((t) => t.id === id)?.description.trim();

    // optimistic update so the dropdown doesn't snap back while the call is in flight
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, category: value, category_source: "user" } : t)),
    );
    try {
      await callTransaction("correct_category", { id, category: value });
      await refreshRows([id]);
      if (description) void offerToApplyToSimilar([description], value);
    } catch (e) {
      setStatus(errorMessage(e));
      await refresh();
    }
  }

  async function offerToApplyToSimilar(merchants: string[], category: string) {
    try {
      const withTwins: string[] = [];
      let count = 0;
      for (const pattern of merchants) {
        const preview = await callTransaction<{ matching: number; would_change: number }>("preview_rule", {
          pattern,
          category,
          replacing: null,
        });
        if (preview.would_change > 0) {
          withTwins.push(pattern);
          count += preview.would_change;
        }
      }
      if (count > 0) {
        setSimilarToast({ text: similarOfferText(merchants, category, count), patterns: withTwins, category, count });
      }
    } catch {
      /* ignore */
    }
  }

  async function handleApplyToSimilar() {
    if (!similarToast) return;
    const { patterns, category } = similarToast;
    setSimilarToast(null);
    try {
      let changed = 0;
      for (const pattern of patterns) {
        changed += await callTransaction<number>("save_rule", { pattern, category, replacing: null, applyToExisting: true });
      }
      await refresh();
      setStatus(`Re-categorized ${changed} transaction${changed === 1 ? "" : "s"} as ${category}.`, "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleCreateManualTransaction(
    accountId: number,
    date: string,
    description: string,
    amount: string,
    category: string | null,
    memberId: number | null,
    notes: string | null,
  ) {
    try {
      const newId = await callTransaction<number>("create_manual_transaction", { accountId, date, description, amount, category, memberId, notes });
      setLastUsedAccountId(accountId);
      await refresh();
      setNewTransactionOpen(false);
      // With automatic linking on, an entry that completes a transfer is linked
      // straight away — say so, so it doesn't just quietly change shape.
      const autoLinked = await callTransaction<{ out_id: number; in_id: number }[]>("list_auto_linked_transfers").catch(() => []);
      const linkedNow = autoLinked.some((p) => p.out_id === newId || p.in_id === newId);
      setStatus(
        linkedNow ? `Added "${description}" and linked it as a transfer automatically — review it under “auto-linked”.` : `Added "${description}".`,
        "success",
      );
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleRecategorize() {
    setBusy(true);
    setStatus("Categorizing…", "info");
    try {
      const ids = await callTransaction<number[]>("recategorize_uncategorized");
      await refresh();
      if (ids.length > 0) {
        setReviewIds(new Set(ids));
        setStatus(`Categorized ${ids.length} transaction(s) — review below and fix any mistakes.`, "success");
      } else {
        setReviewIds(null);
        setStatus("Nothing new to categorize.", "info");
      }
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkMemberChange(value: string) {
    const ids = Array.from(selectedIds);
    try {
      await callTransaction("bulk_set_transaction_member", { ids, memberId: value === "__none__" ? null : Number(value) });
      setSelectedIds(new Set());
      await refreshRows(ids);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleBulkAddTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed) return;
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => callTransaction("add_tag", { transactionId: id, tag: trimmed })));
      setBulkTagText("");
      setSelectedIds(new Set());
      await refreshRows(ids);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleBulkCategoryChange(value: string) {
    if (value === "__new__") {
      const custom = await askNewCategory();
      if (!custom) return;
      value = custom;
    }
    const ids = Array.from(selectedIds);
    // Read before the reload: these are the merchants the change teaches rules for.
    const merchants = distinctMerchants(ids.map((id) => transactions.find((t) => t.id === id)?.description));
    try {
      await callTransaction("bulk_correct_category", { ids, category: value });
      setSelectedIds(new Set());
      await refreshRows(ids);
      if (merchants.length > 0) void offerToApplyToSimilar(merchants, value);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleBulkDelete() {
    setConfirmingBulkDelete(false);
    const ids = Array.from(selectedIds);
    try {
      const deletedIds = await callTransaction<number[]>("bulk_delete_transactions", { ids });
      setSelectedIds(new Set());
      await refresh();
      setUndoToast({ text: `Deleted ${deletedIds.length} transaction(s).`, ids: deletedIds });
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleUndoBulkDelete() {
    if (!undoToast) return;
    const ids = undoToast.ids;
    setUndoToast(null);
    try {
      await callTransaction("restore_transactions", { ids });
      await refresh();
      setStatus(`Restored ${ids.length} transaction(s).`, "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleBulkFlipSigns() {
    setConfirmingBulkFlip(false);
    const ids = Array.from(selectedIds);
    try {
      const result = await callTransaction<{ flipped: number; account_ids: number[] }>("flip_transaction_signs", { ids });
      setSelectedIds(new Set());
      await refresh();
      setStatus(`Flipped the sign of ${result.flipped} transaction${result.flipped === 1 ? "" : "s"}. Flip them again to undo.`, "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleAddSelectedToRecurring(cadence: string) {
    const ids = Array.from(selectedIds);
    try {
      const created = await callTransaction<number>("bulk_create_recurring_from_transactions", { ids, cadence });
      setSelectedIds(new Set());
      await refreshRecurring();
      setStatus(`Added ${created} transaction(s) to Recurring — adjust the cadence per item there if needed.`, "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }
  return {
    newTransactionOpen,
    reviewIds,
    confirmingBulkDelete,
    confirmingBulkFlip,
    undoToast,
    similarToast,
    bulkTagText,
    setNewTransactionOpen,
    setReviewIds,
    setConfirmingBulkDelete,
    setConfirmingBulkFlip,
    setUndoToast,
    setSimilarToast,
    setBulkTagText,
    handleCategoryChange,
    handleApplyToSimilar,
    handleCreateManualTransaction,
    handleRecategorize,
    handleBulkMemberChange,
    handleBulkAddTag,
    handleBulkCategoryChange,
    handleBulkDelete,
    handleUndoBulkDelete,
    handleBulkFlipSigns,
    handleAddSelectedToRecurring,
  };
}
