import { invoke } from "@tauri-apps/api/core";
import {
  transactionError,
  validateTransactions,
  validateTransactionContext,
  TransactionError,
  type TransactionContext,
} from "./transactionContracts";
import { validateTransactionWireSnapshot } from "./compactTransactionContracts";
import { applicationChecks, financialMutations } from "./applicationContracts";

async function checked<T>(request: Promise<unknown>, validate: (value: unknown) => T): Promise<T> {
  try {
    return validate(await request);
  } catch (error) {
    throw transactionError(error);
  }
}
/** Compatibility reads for consumers not yet owned by the transaction controller. */
export const transactionReads = {
  list: () => checked(invoke("list_transactions"), validateTransactions),
  byIds: (ids: number[]) => checked(invoke("list_transactions_by_ids", { ids }), validateTransactions),
};

/** One instance per mounted profile. Identical pending calls share a promise; writes never retry. */
export function createTransactionClient() {
  let disposed = false;
  let context: Promise<TransactionContext> | undefined;
  const pending = new Map<string, Promise<unknown>>();
  const origin = () =>
    (context ??= checked(invoke("get_transaction_context"), validateTransactionContext).catch((error) => {
      context = undefined;
      throw error;
    }));
  async function call<T>(command: string, args: Record<string, unknown> = {}, fresh = false): Promise<T> {
    if (disposed) throw new TransactionError("stale_profile", "This profile session has closed.");
    if (financialMutations.has(command)) {
      for (const key of pending.keys())
        if (Object.keys(applicationChecks).some((read) => key.startsWith(read + "{"))) pending.delete(key);
    }
    // A command sent after an in-flight snapshot may change its revision. A following
    // snapshot must queue after that command rather than share the older read's promise.
    if (command !== "get_transaction_snapshot" && command !== "get_transaction_snapshot_compact") {
      for (const key of pending.keys()) if (key.startsWith("get_transaction_snapshot")) pending.delete(key);
    }
    const key = command + JSON.stringify(args);
    if (fresh) pending.delete(key);
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    const request = (async () => {
      const captured = await origin();
      if (disposed) throw new TransactionError("stale_profile", "This profile session has closed.");
      try {
        return await invoke<T>(command, {
          ...args,
          expectedGeneration: captured.generation,
          expectedSessionRevision: captured.sessionRevision,
        });
      } catch (error) {
        throw transactionError(error);
      }
    })();
    pending.set(key, request);
    try {
      return await request;
    } finally {
      if (pending.get(key) === request) pending.delete(key);
    }
  }
  return {
    call,
    context: async () => {
      if (disposed) throw new TransactionError("stale_profile", "This profile session has closed.");
      const captured = await origin();
      if (disposed) throw new TransactionError("stale_profile", "This profile session has closed.");
      return captured;
    },
    snapshot: async (ids: number[] | null = null, fresh = false) => {
      const captured = await origin();
      if (fresh) for (const key of pending.keys()) if (key.startsWith("get_transaction_snapshot")) pending.delete(key);
      const result = await checked(call("get_transaction_snapshot_compact", { ids }), validateTransactionWireSnapshot);
      if (disposed) throw new TransactionError("stale_profile", "This profile session has closed.");
      if (
        result.context.generation !== captured.generation ||
        result.context.sessionRevision !== captured.sessionRevision
      )
        throw new TransactionError("stale_profile", "The response belongs to another profile session.");
      if (JSON.stringify(result.requestedIds) !== JSON.stringify(ids))
        throw new TransactionError("invalid_response", "The response did not match the requested transaction rows.");
      return result;
    },
    dispose: () => {
      disposed = true;
      pending.clear();
    },
  };
}
