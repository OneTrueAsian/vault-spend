import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "./errorMessage";
import { pickableAccounts } from "./hiddenAccounts";
import { accountTypeLabel } from "./accountGroups";
import { transactionError } from "./transactionContracts";
import {
  MAX_MOVE_TRANSACTIONS, NOT_REFRESHED_MESSAGE, UNCERTAIN_MESSAGE, movedWithBalancesMessage, validateMovePreview, validateMoveRecord, validateMoveResult,
  type BalanceInput, type MovePreview,
} from "./transactionAccountMove";
import type { useTransactionData } from "./useTransactionData";
import type { StatusKind } from "./appTypes";

export type MoveDialogState = {
  /** The exact transactions chosen when the dialog opened; never retargeted afterwards. */
  ids: readonly number[];
  destinationId: number;
  destinationName: string;
  /** Whether a successful move empties the Transactions selection (the bulk action does; the row menu does not). */
  clearSelection: boolean;
  phase: "loading" | "ready" | "committing" | "failed" | "uncertain";
  preview: MovePreview | null;
  /** The balances typed or kept so far, by account; sent to native as text and never calculated with here. */
  balances: Record<number, { keep: boolean; value: string }>;
  /** True while the person is choosing balances, false once they are looking at the final review. */
  editingBalances: boolean;
  /** Identifies the commit that was sent, so an unanswered request can be looked up instead of repeated. */
  operationId: string | null;
  /** Why a preview could not load, or what an uncertain outcome means. */
  message: string | null;
  /** Something the person should know about the details they are now looking at (they changed while reviewing). */
  notice: string | null;
  sessionKey: string;
};

const PROFILE_GONE = new Set(["stale_profile", "profile_locked", "no_profile_open"]);
/** A fresh id for one commit attempt. */
export function newOperationId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const toInputs = (balances: MoveDialogState["balances"]): BalanceInput[] =>
  Object.entries(balances).map(([accountId, b]) => ({ accountId: Number(accountId), keep: b.keep, value: b.keep ? null : b.value }));

const CHANGED_NOTICE = "Something changed while you were reviewing, so these details are new. Check them before moving.";

/** The accounts a selection can be moved to: visible accounts, leaving out the one every selected row is already in. */
export function moveDestinationOptions(
  accounts: readonly { id: number; name: string; account_type: string; hidden: boolean }[],
  selectedAccountIds: readonly number[],
): { value: string; label: string }[] {
  const everyoneIn = new Set(selectedAccountIds).size === 1 ? selectedAccountIds[0] : null;
  return pickableAccounts(accounts)
    .filter((a) => a.id !== everyoneIn)
    .map((a) => ({ value: String(a.id), label: `${a.name} (${accountTypeLabel(a.account_type)})` }));
}

/** Owns the "Move to account" review: the frozen selection, the native preview, the single confirmation and what follows it. */
export function useTransactionMove({ data, accounts, selectedIds, setSelectedIds, onStatus: setStatus }: {
  data: Pick<ReturnType<typeof useTransactionData>, "call" | "refresh" | "snapshot">;
  accounts: readonly { id: number; name: string; account_type: string; hidden: boolean }[];
  selectedIds: Set<number>;
  setSelectedIds: (ids: Set<number>) => void;
  onStatus: (message: string, kind?: StatusKind) => void;
}) {
  const { call, refresh } = data;
  const [dialog, setDialog] = useState<MoveDialogState | null>(null);
  const dialogRef = useRef<MoveDialogState | null>(null);
  dialogRef.current = dialog;
  const request = useRef(0);
  const committing = useRef(false);
  const context = data.snapshot?.context;
  const sessionKey = context ? `${context.generation}:${context.sessionRevision}` : "";
  const currentSession = useRef(sessionKey);
  currentSession.current = sessionKey;

  useEffect(() => () => { request.current++; committing.current = false; }, []);

  // A lock, profile switch or replaced session ends the review: its rows and ids belong to the old session.
  useEffect(() => {
    if (dialogRef.current && dialogRef.current.sessionKey !== sessionKey) {
      request.current++;
      committing.current = false;
      setDialog(null);
    }
  }, [sessionKey]);

  const rows = data.snapshot?.transactions;
  const selectedAccountIds = useMemo(() => {
    const chosen = new Set<number>();
    for (const t of rows ?? []) if (selectedIds.has(t.id)) chosen.add(t.account_id);
    return [...chosen];
  }, [rows, selectedIds]);
  const destinations = useMemo(() => moveDestinationOptions(accounts, selectedAccountIds), [accounts, selectedAccountIds]);

  async function loadPreview(ids: readonly number[], destinationId: number, notice: string | null, balances: MoveDialogState["balances"] = {}) {
    const mine = ++request.current;
    const ownerSession = sessionKey;
    try {
      const args: Record<string, unknown> = { ids: [...ids], destinationAccountId: destinationId };
      if (Object.keys(balances).length > 0) args.balances = toInputs(balances);
      const response = validateMovePreview(await call("preview_transaction_account_move", args));
      if (mine !== request.current || currentSession.current !== ownerSession) return;
      setDialog((d) => (d ? { ...d, phase: "ready", preview: response.preview, message: null, notice, editingBalances: response.preview.status === "needs_balance_confirmation" } : d));
    } catch (e) {
      if (mine !== request.current || currentSession.current !== ownerSession) return;
      const error = transactionError(e);
      if (PROFILE_GONE.has(error.code)) {
        setDialog(null);
        setStatus(error.message);
        return;
      }
      setDialog((d) => (d ? { ...d, phase: "failed", preview: null, message: errorMessage(e), notice: null } : d));
    }
  }

  /** Opens the review for these transactions and destination. Choosing a destination never changes data. */
  function open(ids: readonly number[], destinationId: number, options: { clearSelection: boolean }) {
    if (dialogRef.current) return;
    const destination = accounts.find((a) => a.id === destinationId);
    const frozen = [...new Set(ids)].sort((a, b) => a - b);
    if (!destination || frozen.length === 0) return;
    if (frozen.length > MAX_MOVE_TRANSACTIONS) {
      setStatus(`You selected ${frozen.length} transactions. You can move up to ${MAX_MOVE_TRANSACTIONS} at a time; nothing was moved.`);
      return;
    }
    setDialog({ ids: frozen, destinationId, destinationName: destination.name, clearSelection: options.clearSelection, phase: "loading", preview: null, balances: {}, editingBalances: false, operationId: null, message: null, notice: null, sessionKey });
    void loadPreview(frozen, destinationId, null);
  }

  function reviewAgain() {
    const d = dialogRef.current;
    if (!d || d.phase === "committing") return;
    setDialog({ ...d, phase: "loading", preview: null, balances: {}, operationId: null, message: null, notice: null });
    void loadPreview(d.ids, d.destinationId, null);
  }

  /** Records what was typed (or kept) for one account. Nothing is sent until the person asks for the final review. */
  function setBalance(accountId: number, change: { keep: boolean; value?: string }) {
    setDialog((d) => (d && d.phase === "ready" ? { ...d, balances: { ...d.balances, [accountId]: { keep: change.keep, value: change.value ?? d.balances[accountId]?.value ?? "" } } } : d));
  }

  /** Sends the balances for the final review. Still read-only on the native side. */
  function reviewBalances() {
    const d = dialogRef.current;
    if (!d || d.phase !== "ready" || d.preview?.mode !== "confirmation") return;
    setDialog({ ...d, phase: "loading", message: null });
    void loadPreview(d.ids, d.destinationId, null, d.balances);
  }

  /** Goes back from the final review to choosing balances. */
  function changeBalances() {
    setDialog((d) => (d && d.phase === "ready" && d.preview?.mode === "confirmation" ? { ...d, editingBalances: true, operationId: null } : d));
  }

  function cancel() {
    // Once the commit has been sent the dialog can no longer claim to cancel it.
    if (committing.current) return;
    request.current++;
    setDialog(null);
  }

  async function confirm() {
    const d = dialogRef.current;
    if (!d || d.phase !== "ready" || !d.preview?.canCommit || committing.current) return;
    committing.current = true;
    const { ids, destinationId, destinationName, clearSelection } = d;
    const token = d.preview.token;
    const operationId = d.operationId ?? newOperationId();
    const mine = ++request.current;
    const stillOwned = () => mine === request.current && currentSession.current === d.sessionKey;
    setDialog({ ...d, phase: "committing", operationId, message: null, notice: null });
    let result;
    try {
      const args: Record<string, unknown> = { ids: [...ids], destinationAccountId: destinationId, expectedPreviewToken: token, operationId };
      if (d.preview.mode === "confirmation") args.balances = toInputs(d.balances);
      result = validateMoveResult(await call("move_transactions_to_account", args));
    } catch (e) {
      if (!stillOwned()) return;
      committing.current = false;
      const error = transactionError(e);
      if (PROFILE_GONE.has(error.code)) {
        request.current++;
        setDialog(null);
        setStatus(`${error.message} If you had just chosen Move, check the Transactions list before trying again.`);
      } else if (error.code === "not_applied") {
        // The native side refused and rolled back; show what it says over freshly read details.
        setDialog((current) => (current ? { ...current, phase: "loading", balances: {}, operationId: null, message: null, notice: error.message } : current));
        await loadPreview(ids, destinationId, error.message);
      } else {
        // No reply we can trust: the move may or may not have happened. Reload, and never resend.
        request.current++;
        setDialog((current) => (current ? { ...current, phase: "uncertain", message: UNCERTAIN_MESSAGE, notice: null } : current));
        try { await refresh(); } catch { /* the list's own retry banner reports it */ }
      }
      return;
    }
    if (!stillOwned()) return;
    committing.current = false;
    if (result.status === "stale_preview" || result.status === "blocked" || result.status === "operation_conflict") {
      // Whatever was typed was meant for the details that have now changed, so it is not carried over.
      setDialog((current) => (current ? { ...current, phase: "loading", preview: null, balances: {}, operationId: null, message: null, notice: CHANGED_NOTICE } : current));
      await loadPreview(ids, destinationId, CHANGED_NOTICE);
      return;
    }
    request.current++;
    setDialog(null);
    if (result.status === "nothing_to_move") {
      setStatus(`Those transactions are already in ${destinationName}. Nothing was moved.`, "info");
      return;
    }
    if (clearSelection) {
      setSelectedIds(new Set());
      keepFocusInList();
    }
    setStatus(movedWithBalancesMessage(result, destinationName), "success");
    try {
      await refresh();
    } catch {
      if (currentSession.current === d.sessionKey) setStatus(NOT_REFRESHED_MESSAGE);
    }
  }

  /** Moving clears the selection, which removes the control that opened the review. Once the dialog has given up
   * its own focus restore, focus that fell to the page is brought to the list's select-all box. */
  function keepFocusInList() {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      document.querySelector<HTMLElement>('input[aria-label="Select all matching transactions"]')?.focus();
    }, 50);
  }

  /** After an uncertain outcome: reload the list and close, so the person checks before doing anything again. */
  async function reloadAndClose() {
    const ownerSession = currentSession.current;
    const sent = dialogRef.current?.operationId ?? null;
    const destinationName = dialogRef.current?.destinationName ?? "the other account";
    const clearSelection = dialogRef.current?.clearSelection ?? false;
    const mine = ++request.current;
    const stillOwned = () => mine === request.current && currentSession.current === ownerSession;
    setDialog(null);
    if (sent) {
      // The commit carried an id, so what became of it can be looked up. This only reads; nothing is sent again.
      try {
        const found = validateMoveRecord(await call("get_transaction_account_move", { operationId: sent }));
        if (!stillOwned()) return;
        if (found.record) {
          if (clearSelection) {
            setSelectedIds(new Set());
            keepFocusInList();
          }
          setStatus(movedWithBalancesMessage({ movedCount: found.record.movedCount, alreadyThereCount: 0, mode: found.record.mode, correctedCheckpoints: found.record.correctedCheckpoints, confirmedAccountIds: found.record.confirmedAccountIds }, destinationName), "success");
        } else {
          setStatus("The move was not applied. Nothing changed, so you can review it and try again.", "info");
        }
      } catch {
        /* the lookup itself failed: say nothing more than the reload below shows */
      }
    }
    if (!stillOwned()) return;
    try {
      await refresh();
    } catch {
      if (stillOwned()) setStatus(NOT_REFRESHED_MESSAGE);
    }
  }

  return { dialog, destinations, open, reviewAgain, cancel, confirm, reloadAndClose, setBalance, reviewBalances, changeBalances };
}
