import { useState } from "react";
import { useAutoCancelDelete } from "./useAutoCancelDelete";
import { errorMessage } from "./errorMessage";
import type { Transaction, TransactionSplit, Account } from "./types";
import type { useTransactionData } from "./useTransactionData";
import type { StatusKind } from "./appTypes";

/** Owns row editing state, mutations and full/targeted refresh choices. */
export function useTransactionRowActions({ data, accounts, categories: categoryOptions, onStatus: setStatus }: {
  data: Pick<ReturnType<typeof useTransactionData>, "call" | "refresh" | "refreshRows">;
  accounts: Account[]; categories: string[]; onStatus: (message: string, kind?: StatusKind) => void;
}) {
  const { refresh, refreshRows } = data;
  const debtAccounts = accounts.filter(a => a.account_type === "loan" || a.account_type === "credit");
  const [newTagText, setNewTagText] = useState<Record<number, string>>({});

  const [taggingId, setTaggingId] = useState<number | null>(null);

  const [notesDialogFor, setNotesDialogFor] = useState<Transaction | null>(null);

  const [editingAmount, setEditingAmount] = useState<{ id: number; value: string } | null>(null);

  const [editingDate, setEditingDate] = useState<{ id: number; value: string } | null>(null);

  const [editingDescription, setEditingDescription] = useState<{ id: number; value: string } | null>(null);

  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);

  const [applyingDebtId, setApplyingDebtId] = useState<number | null>(null);

  const [applyDebtForm, setApplyDebtForm] = useState<{ accountId: string; amount: string }>({
    accountId: "",
    amount: "",
  });

  const [editingPrincipalId, setEditingPrincipalId] = useState<number | null>(null);

  const [principalDraft, setPrincipalDraft] = useState("");

  const [expandedSplitId, setExpandedSplitId] = useState<number | null>(null);

  const [splitLines, setSplitLines] = useState<{ category: string; amount: string; note: string }[]>([]);

  async function commitAmountEdit(id: number, value: string) {
    setEditingAmount(null);
    try {
      const splitsReconciled = await data.call<boolean>("update_transaction_amount", { id, amount: value.trim() });
      await refreshRows([id]);
      if (splitsReconciled) {
        setStatus("Amount updated — its splits were rescaled to still add up to the new amount.", "info");
      }
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function commitDateEdit(id: number, value: string) {
    setEditingDate(null);
    if (!value.trim()) return;
    try {
      await data.call("update_transaction_date", { id, date: value.trim() });
      await refreshRows([id]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function commitDescriptionEdit(id: number, value: string) {
    setEditingDescription(null);
    try {
      await data.call("update_transaction_description", { id, description: value.trim() });
      await refreshRows([id]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleAccountChangeForTransaction(id: number, accountId: string) {
    try {
      await data.call("update_transaction_account", { id, accountId: Number(accountId) });
      await refreshRows([id]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleMemberChangeForTransaction(id: number, memberId: string) {
    try {
      await data.call("set_transaction_member", { id, memberId: memberId === "" ? null : Number(memberId) });
      await refreshRows([id]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteTransaction(id: number) {
    setConfirmingDeleteId(null);
    try {
      await data.call("delete_transaction", { id });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  function startApplyingDebtPayment(t: Transaction) {
    setApplyingDebtId(t.id);
    setApplyDebtForm({
      accountId: debtAccounts[0] ? String(debtAccounts[0].id) : "",
      amount: Math.abs(parseFloat(t.amount)).toFixed(2),
    });
  }

  async function handleApplyDebtPayment(sourceTransactionId: number, date: string) {
    if (!applyDebtForm.accountId || !applyDebtForm.amount.trim()) return;
    try {
      await data.call("apply_debt_payment", {
        sourceTransactionId,
        debtAccountId: Number(applyDebtForm.accountId),
        amount: applyDebtForm.amount.trim(),
        date,
      });
      setApplyingDebtId(null);
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleUnapplyDebtPayment(sourceTransactionId: number) {
    try {
      await data.call("unapply_debt_payment", { sourceTransactionId });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  function startEditingPrincipal(t: Transaction) {
    setEditingPrincipalId(t.id);
    setPrincipalDraft(t.principal_amount ?? t.amount);
  }

  async function handleSetPrincipalAmount(id: number) {
    if (!principalDraft.trim()) return;
    try {
      await data.call("update_transaction_principal_amount", { id, principalAmount: principalDraft.trim() });
      setEditingPrincipalId(null);
      await refreshRows([id]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleResetPrincipalAmount(id: number) {
    try {
      await data.call("update_transaction_principal_amount", { id, principalAmount: null });
      await refreshRows([id]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function toggleSplitEditor(t: Transaction) {
    if (expandedSplitId === t.id) {
      setExpandedSplitId(null);
      return;
    }
    try {
      const existing = await data.call<TransactionSplit[]>("get_transaction_splits", { transactionId: t.id });
      if (existing.length > 0) {
        setSplitLines(
          existing.map((s) => ({
            category: s.category ?? "",
            amount: Math.abs(parseFloat(s.amount)).toFixed(2),
            note: s.note ?? "",
          })),
        );
      } else {
        setSplitLines([
          { category: t.category ?? categoryOptions[0] ?? "", amount: Math.abs(parseFloat(t.amount)).toFixed(2), note: "" },
        ]);
      }
      setExpandedSplitId(t.id);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  function addSplitLine() {
    setSplitLines((prev) => [...prev, { category: categoryOptions[0] ?? "", amount: "", note: "" }]);
  }

  function removeSplitLine(index: number) {
    setSplitLines((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSplitLine(index: number, patch: Partial<{ category: string; amount: string; note: string }>) {
    setSplitLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function splitRemaining(t: Transaction): number {
    const total = Math.abs(parseFloat(t.amount));
    const allocated = splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    return total - allocated;
  }

  async function saveSplits(t: Transaction) {
    const sign = parseFloat(t.amount) < 0 ? -1 : 1;
    const splits = splitLines
      .filter((l) => l.category && l.amount.trim())
      .map((l): [string, string, string | null] => [
        l.category,
        (sign * Math.abs(parseFloat(l.amount))).toFixed(2),
        l.note.trim() ? l.note.trim() : null,
      ]);
    try {
      await data.call("set_transaction_splits", { transactionId: t.id, splits });
      setExpandedSplitId(null);
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function clearSplits(t: Transaction) {
    try {
      await data.call("set_transaction_splits", { transactionId: t.id, splits: [] });
      setExpandedSplitId(null);
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSaveNotes(transactionId: number, notes: string | null) {
    await data.call("update_transaction_notes", { transactionId, notes });
    await refreshRows([transactionId]);
  }

  async function handleAddTag(id: number, tag: string) {
    const trimmed = tag.trim();
    if (!trimmed) return;
    try {
      await data.call("add_tag", { transactionId: id, tag: trimmed });
      setNewTagText((prev) => ({ ...prev, [id]: "" }));
      await refreshRows([id]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleRemoveTag(id: number, tag: string) {
    try {
      await data.call("remove_tag", { transactionId: id, tag });
      await refreshRows([id]);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }
useAutoCancelDelete(confirmingDeleteId, () => setConfirmingDeleteId(null));
  return {
    editingAmount,
    editingDate,
    editingDescription,
    confirmingDeleteId,
    applyingDebtId,
    applyDebtForm,
    editingPrincipalId,
    principalDraft,
    expandedSplitId,
    splitLines,
    newTagText,
    taggingId,
    notesDialogFor,
    setEditingAmount,
    setEditingDate,
    setEditingDescription,
    setConfirmingDeleteId,
    setApplyingDebtId,
    setApplyDebtForm,
    setEditingPrincipalId,
    setPrincipalDraft,
    setExpandedSplitId,
    setSplitLines,
    setNewTagText,
    setTaggingId,
    setNotesDialogFor,
    commitAmountEdit,
    commitDateEdit,
    commitDescriptionEdit,
    handleAccountChangeForTransaction,
    handleMemberChangeForTransaction,
    handleDeleteTransaction,
    startApplyingDebtPayment,
    handleApplyDebtPayment,
    handleUnapplyDebtPayment,
    startEditingPrincipal,
    handleSetPrincipalAmount,
    handleResetPrincipalAmount,
    toggleSplitEditor,
    addSplitLine,
    removeSplitLine,
    updateSplitLine,
    splitRemaining,
    saveSplits,
    clearSplits,
    handleSaveNotes,
    handleAddTag,
    handleRemoveTag,
  };
}
