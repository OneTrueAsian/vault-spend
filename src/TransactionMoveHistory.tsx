import { useEffect, useRef, useState } from "react";
import { ModalShell } from "./Modal";
import { errorMessage } from "./errorMessage";
import { formatDisplayDate } from "./format";
import { money, moveTransactionsText, validateMoveRecords, type MoveRecord } from "./transactionAccountMove";

/** Read-only details of the latest moves in the currently open profile. */
export function TransactionMoveHistory({ call, sessionKey }: {
  call: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  sessionKey: string;
}) {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<MoveRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const owner = useRef(sessionKey);
  owner.current = sessionKey;
  useEffect(() => {
    const sequence = request;
    sequence.current++;
    setOpen(false);
    setRecords(null);
    setError(null);
    return () => { sequence.current++; };
  }, [sessionKey]);

  async function load() {
    const mine = ++request.current;
    const session = owner.current;
    setOpen(true);
    setRecords(null);
    setError(null);
    try {
      const result = validateMoveRecords(await call("list_transaction_account_moves", { limit: 50 }));
      if (mine === request.current && owner.current === session) setRecords(result);
    } catch (reason) {
      if (mine === request.current && owner.current === session) setError(errorMessage(reason));
    }
  }
  function close() { request.current++; setOpen(false); setRecords(null); setError(null); }

  return <>
    <button type="button" className="modal-secondary" onClick={() => void load()} data-account-move-history>Account move history</button>
    {open && <ModalShell title="Account move history" wide onCancel={close} footer={<div className="modal-actions"><button type="button" onClick={close}>Close</button></div>}>
      {error ? <><p role="alert">{error}</p><button type="button" onClick={() => void load()}>Try again</button></>
        : records === null ? <p role="status">Loading account moves…</p>
          : <>
            {records.length > 0 && <p>{records.length === 1 ? "The latest account move in this profile." : `The latest ${records.length} account moves in this profile.`} Each amount below was recorded when the move completed.</p>}
            {records.length === 0 && <p>No account moves have been recorded.</p>}
            {records.map((record) => <details key={record.operationId} data-move-history-record>
              <summary>{formatDisplayDate(record.effectiveDate)} · {moveTransactionsText(record.movedCount)} to {record.destinationName}</summary>
              <p>{record.mode === "confirmation" ? "Current balances confirmed by you. Older saved balances were kept; this did not reconstruct past balances." : record.correctedCheckpoints === 0 ? "No saved balances needed correcting." : `${record.correctedCheckpoints} saved ${record.correctedCheckpoints === 1 ? "balance" : "balances"} corrected automatically from ${record.correctedCheckpoints === 1 ? "its" : "their"} recorded transactions.`}</p>
              <ul className="move-balances">{record.accounts.map((account) => <li key={account.accountId}><strong>{account.name}</strong><span className="move-effect-line">{account.label} {money(account.displayedBefore)} → {money(account.displayedAfter)}</span></li>)}</ul>
            </details>)}
          </>}
    </ModalShell>}
  </>;
}
