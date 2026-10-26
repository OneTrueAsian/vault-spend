import { useCallback, useEffect, useRef, useState } from "react";
import { createTransactionClient } from "./transactionReads";
import { transactionError, TransactionError, type TransactionSnapshot } from "./transactionContracts";
import type { Transaction } from "./types";
import { mergeTransactionRows } from "./transactionMerge";

/** Atomic shared read model, scoped to the mounted profile, with explicit loading/failure state. */
export function useTransactionData() {
  const client = useRef<ReturnType<typeof createTransactionClient> | null>(null);
  const [snapshot, setSnapshot] = useState<TransactionSnapshot | null>(null);
  const current = useRef<TransactionSnapshot | null>(null);
  const optimistic = useRef(false);
  const sequence = useRef(0);
  const inFlight = useRef(new Set<number>());
  const alive = useRef(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<TransactionError | null>(null);
  useEffect(() => {
    const pendingRequests = inFlight.current;
    alive.current = true;
    client.current = createTransactionClient();
    return () => {
      alive.current = false;
      // This is a request counter, not a DOM ref; incrementing invalidates pending reads.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++;
      pendingRequests.clear();
      client.current?.dispose(); client.current = null;
    };
  }, []);
  const read = useCallback(async (ids: number[] | null = null) => {
    const request = ++sequence.current;
    // A superseded partial reply must not leave its changed rows missing from a later patch.
    const complete = inFlight.current.size > 0;
    inFlight.current.add(request);
    setLoading(true);
    setError(null);
    try {
      const bound = client.current;
      if (!bound) throw new TransactionError("stale_profile", "This profile session has closed.");
      let next = await bound.snapshot(current.current && !complete ? ids : null, complete);
      if (!alive.current || request !== sequence.current) throw new TransactionError("superseded", "A newer data request replaced this one.");
      const previous = current.current;
      if (previous && (previous.context.generation !== next.context.generation || previous.context.sessionRevision !== next.context.sessionRevision)) throw new TransactionError("stale_profile", "This profile session has changed.");
      if (next.requestedIds && previous) {
        const { transactions, hasNewRows } = mergeTransactionRows(previous.transactions, next.requestedIds, next.transactions);
        // A concurrent insert/delete outside the requested rows requires a complete model.
        if (next.revision.external !== previous.revision.external || transactions.length !== next.stats.total || hasNewRows) {
          next = await bound.snapshot(null, true);
          if (!alive.current || request !== sequence.current) throw new TransactionError("superseded", "A newer data request replaced this one.");
        } else next = { ...next, requestedIds: null, transactions };
      }
      if (previous && (next.revision.local < previous.revision.local || next.revision.external < previous.revision.external)) throw new TransactionError("superseded", "An older response was discarded.");
      if (previous && !optimistic.current && next.revision.local === previous.revision.local && next.revision.external === previous.revision.external) next = previous;
      else if (previous) {
        // Small metadata lists retain identity when their values did not change. A note edit
        // must not look like an account-balance change to account-tracked Goals.
        const retain = <T,>(before: T, after: T): T => JSON.stringify(before) === JSON.stringify(after) ? before : after;
        next = { ...next, accounts: retain(previous.accounts, next.accounts), categories: retain(previous.categories, next.categories), categoryIcons: retain(previous.categoryIcons, next.categoryIcons), tags: retain(previous.tags, next.tags), members: retain(previous.members, next.members), stats: retain(previous.stats, next.stats) };
      }
      optimistic.current = false;
      current.current = next;
      setSnapshot(next);
      setLoading(false);
      return next;
    } catch (failure) {
      const error = transactionError(failure);
      if (alive.current && request === sequence.current) { setLoading(false); setError(error); }
      throw error;
    } finally { inFlight.current.delete(request); }
  }, []);
  const refresh = useCallback(() => read(), [read]);
  const refreshRows = useCallback((ids: number[]) => read([...new Set(ids)]), [read]);
  const setTransactions = useCallback((update: Transaction[] | ((previous: Transaction[]) => Transaction[])) => {
    const previous = current.current;
    if (!previous) return;
    const next = { ...previous, transactions: typeof update === "function" ? update(previous.transactions) : update };
    optimistic.current = true;
    current.current = next;
    setSnapshot(next);
  }, []);
  const revision = snapshot ? `${snapshot.context.sessionRevision}:${snapshot.revision.local}:${snapshot.revision.external}` : "unloaded";
  const call = useCallback(<T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
    if (!client.current) return Promise.reject(new TransactionError("stale_profile", "This profile session has closed."));
    return client.current.call<T>(command, args);
  }, []);
  return { snapshot, loading, error, refresh, refreshRows, setTransactions, call, revision };
}
