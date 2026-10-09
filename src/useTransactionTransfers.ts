import { useCallback, useEffect, useMemo, useState } from "react";
import type { Transaction } from "./types";
import type { useTransactionData } from "./useTransactionData";
import type { useTransactionsLedger } from "./useTransactionsLedger";
import type { StatusKind } from "./appTypes";
import { errorMessage } from "./errorMessage";

/** Owns transfer suggestions, review/dismissal/undo state and link mutations. */
export function useTransactionTransfers({ data, transactions, active, ledger, onStatus: setStatus }: {
  data: Pick<ReturnType<typeof useTransactionData>, "call" | "refresh">;
  transactions: Transaction[]; active: boolean;
  ledger: Pick<ReturnType<typeof useTransactionsLedger>, "selectedPairForLink" | "setSelectedIds">;
  onStatus: (message: string, kind?: StatusKind) => void;
}) {
  const { call: callTransaction, refresh } = data;
  const { selectedPairForLink, setSelectedIds } = ledger;
  const [transferCandidates, setTransferCandidates] = useState<{ out_id: number; in_id: number }[]>([]);
  const [transferReviewOpen, setTransferReviewOpen] = useState(false);
  // Own state (like `undoToast`) so a routine status message can't clobber
  // an active Undo window, and — since this whole component remounts on a
  // profile switch/lock (see `onDataFileChanged`) — a stale Undo can never
  // be applied to a different profile.
  const [dismissUndoToast, setDismissUndoToast] = useState<{ text: string; pairs: { out_id: number; in_id: number }[] } | null>(null);
  useEffect(() => {
    if (!dismissUndoToast) return;
    const timer = setTimeout(() => setDismissUndoToast(null), 10000);
    return () => clearTimeout(timer);
  }, [dismissUndoToast]);
  async function refreshTransferCandidates() {
    try {
      setTransferCandidates(await callTransaction<{ out_id: number; in_id: number }[]>("list_transfer_candidates"));
    } catch {
      /* a missing suggestion is never worth an error banner */
    }
  }
  async function handleDismissTransferCandidates(pairs: { out_id: number; in_id: number }[]) {
    const newly = await callTransaction<{ out_id: number; in_id: number }[]>("dismiss_transfer_candidates", { pairs });
    await refreshTransferCandidates();
    if (newly.length > 0) {
      setDismissUndoToast({ text: `Dismissed ${newly.length} possible transfer${newly.length === 1 ? "" : "s"}.`, pairs: newly });
    }
  }
  async function handleDismissAllTransferCandidates() {
    const all = await callTransaction<{ out_id: number; in_id: number }[]>("list_all_transfer_candidate_pairs");
    await handleDismissTransferCandidates(all);
  }
  async function handleUndoDismissTransferCandidates() {
    if (!dismissUndoToast) return;
    const pairs = dismissUndoToast.pairs;
    setDismissUndoToast(null);
    try {
      await callTransaction("restore_transfer_candidates", { pairs });
      await refreshTransferCandidates();
      setStatus(`Restored ${pairs.length} possible transfer${pairs.length === 1 ? "" : "s"}.`, "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    callTransaction<{ out_id: number; in_id: number }[]>("list_transfer_candidates")
      .then((c) => {
        if (!cancelled) setTransferCandidates(c);
      })
      .catch(() => {
        /* a missing suggestion is never worth an error banner */
      });
    return () => {
      cancelled = true;
    };
  }, [active, transactions, callTransaction]);
  const transferCandidatePairs = useMemo(() => {
    const byId = new Map(transactions.map((t) => [t.id, t]));
    return transferCandidates.flatMap((c) => {
      const out = byId.get(c.out_id);
      const inn = byId.get(c.in_id);
      return out && inn ? [{ out, in: inn }] : [];
    });
  }, [transferCandidates, transactions]);
  // Pairs the app linked on its own (Settings > Feature toggles) that nobody has
  // marked "looks right" yet — the review report. Read the same way as the
  // suggestions above.
  const [autoLinked, setAutoLinked] = useState<{ out_id: number; in_id: number }[]>([]);
  const [autoLinkReviewOpen, setAutoLinkReviewOpen] = useState(false);
  const reloadAutoLinked = useCallback(async () => {
    try {
      setAutoLinked(await callTransaction<{ out_id: number; in_id: number }[]>("list_auto_linked_transfers"));
    } catch {
      /* the review list is a convenience; never worth an error banner */
    }
  }, [callTransaction]);
  useEffect(() => {
    if (!active) return;
    void reloadAutoLinked();
  }, [active, transactions, reloadAutoLinked]);
  const autoLinkedPairs = useMemo(() => {
    const byId = new Map(transactions.map((t) => [t.id, t]));
    return autoLinked.flatMap((c) => {
      const out = byId.get(c.out_id);
      const inn = byId.get(c.in_id);
      return out && inn ? [{ out, in: inn }] : [];
    });
  }, [autoLinked, transactions]);
async function handleUnlinkTransfer(transactionId: number) {
    try {
      await callTransaction("unlink_transfer", { transactionId });
      await refresh();
      setStatus("Unlinked — they're two separate transactions again.", "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

async function handleLinkSelectedAsTransfer() {
    if (!selectedPairForLink) return;
    try {
      await callTransaction("link_transfer", { a: selectedPairForLink[0].id, b: selectedPairForLink[1].id });
      setSelectedIds(new Set());
      await refresh();
      setStatus("Linked as a transfer — it no longer counts as income or spending.", "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

async function handleLinkTransfers(pairs: { out_id: number; in_id: number }[]) {
    setTransferReviewOpen(false);
    try {
      for (const p of pairs) {
        await callTransaction("link_transfer", { a: p.out_id, b: p.in_id });
      }
      await refresh();
      setStatus(`Linked ${pairs.length} transfer${pairs.length === 1 ? "" : "s"}.`, "success");
    } catch (e) {
      setStatus(errorMessage(e));
      await refresh();
    }
  }

async function handleMarkAutoLinksReviewed(outIds: number[]) {
    try {
      await callTransaction("mark_auto_links_reviewed", { outIds });
      await reloadAutoLinked();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }
  return { transferReviewOpen, setTransferReviewOpen, dismissUndoToast, setDismissUndoToast, transferCandidatePairs, autoLinkReviewOpen, setAutoLinkReviewOpen, autoLinkedPairs, handleDismissTransferCandidates, handleDismissAllTransferCandidates, handleUndoDismissTransferCandidates, handleUnlinkTransfer, handleLinkSelectedAsTransfer, handleLinkTransfers, handleMarkAutoLinksReviewed };
}
