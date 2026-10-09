import { useCallback, useEffect, useRef, useState } from "react";
import { createFinancialClient } from "./financialReads";
import { transactionError, TransactionError } from "./transactionContracts";
type Client = ReturnType<typeof createFinancialClient>;
/** One aggregate owner per profile mount. Only the latest request can publish. */
export function useFinancialRead<T>() {
  const client = useRef<Client | null>(null);
  const alive = useRef(false);
  const sequence = useRef(0);
  const [data, setData] = useState<{ key: string; value: T } | null>(null);
  const [state, setState] = useState<{ key: string; loading: boolean; error: TransactionError | null } | null>(null);
  useEffect(() => {
    alive.current = true;
    client.current = createFinancialClient();
    return () => {
      alive.current = false;
      sequence.current++;
      client.current?.dispose();
      client.current = null;
    };
  }, []);
  const refresh = useCallback(async (key: string, read: (client: Client) => Promise<T>) => {
    const request = ++sequence.current;
    setState({ key, loading: true, error: null });
    try {
      if (!client.current) throw new TransactionError("stale_profile", "This profile session has closed.");
      const value = await read(client.current);
      if (!alive.current || request !== sequence.current)
        throw new TransactionError("superseded", "A newer totals request replaced this one.");
      setData({ key, value });
      setState({ key, loading: false, error: null });
      return value;
    } catch (failure) {
      const error = transactionError(failure);
      if (alive.current && request === sequence.current) setState({ key, loading: false, error });
      throw error;
    }
  }, []);
  return { data, state, refresh };
}
