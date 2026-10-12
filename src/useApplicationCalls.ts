import { useCallback, useEffect, useRef, useState } from "react";
import { applicationChecks, financialMutations, validateApplicationResult } from "./applicationContracts";
import { transactionError, TransactionError } from "./transactionContracts";
type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
/** Bound legacy adapters plus explicit successful-mutation invalidation. No retries of writes. */
export function useApplicationCalls(bound: Call) {
  const alive = useRef(false);
  const incarnation = useRef(0);
  const sequences = useRef<Record<string, number>>({});
  const [revision, setRevision] = useState(0);
  const [errors, setErrors] = useState<Record<string, TransactionError>>({});
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      incarnation.current += 1;
    };
  }, []);
  const call = useCallback(
    async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      const origin = incarnation.current;
      const sequence = (sequences.current[command] ?? 0) + 1;
      if (applicationChecks[command]) sequences.current[command] = sequence;
      try {
        const raw = await bound(command, args);
        if (applicationChecks[command] && (!alive.current || origin !== incarnation.current))
          throw new TransactionError("stale_profile", "This profile session has closed.");
        if (applicationChecks[command] && sequences.current[command] !== sequence)
          throw new TransactionError("superseded", "A newer data load replaced this request.");
        const result = validateApplicationResult<T>(command, raw);
        if (alive.current && origin === incarnation.current) {
          if (applicationChecks[command]) {
            setLoaded((previous) => (previous.has(command) ? previous : new Set([...previous, command])));
            setErrors((previous) => {
              if (!previous[command]) return previous;
              const next = { ...previous };
              delete next[command];
              return next;
            });
          }
          if (financialMutations.has(command)) setRevision((value) => value + 1);
        }
        return result;
      } catch (failure) {
        const error = transactionError(failure);
        if (alive.current && origin === incarnation.current && applicationChecks[command] && sequences.current[command] === sequence)
          setErrors((previous) => ({ ...previous, [command]: error }));
        throw error;
      }
    },
    [bound],
  );
  return { call, revision, errors, loaded };
}
