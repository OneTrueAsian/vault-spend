import { useEffect, useRef } from "react";
import { transactionReads } from "./transactionReads";
import { getCurrentGeneration } from "./profileUiState";
import type { Transaction } from "./types";
import { errorMessage } from "./errorMessage";

/** Read once on explicit navigation. Requests cannot outlive a profile,
 * component, or a newer request, even if the final generation read is slow. */
export function usePaymentSource(onReady: (source: Transaction, fresh: Transaction[]) => void, onError: (message: string) => void, read = transactionReads.list) {
  const requestSequence = useRef(0);
  useEffect(() => () => { requestSequence.current += 1; }, []);
  return async (sourceId: number) => {
    const request = ++requestSequence.current;
    try {
      const generation = await getCurrentGeneration();
      const fresh = await read();
      const currentGeneration = await getCurrentGeneration();
      if (request !== requestSequence.current || generation !== currentGeneration) return;
      const source = fresh.find(t => t.id === sourceId && t.applied_to_debt);
      if (source) onReady(source, fresh);
      else onError("Payment is no longer available.");
    } catch (error) {
      if (request === requestSequence.current) onError(errorMessage(error));
    }
  };
}
