import { validateTransactionSnapshot, TransactionError, type TransactionSnapshot } from "./transactionContracts";
/** Lossless transport only. Every consumer receives the unchanged complete v1 model. */
export function validateTransactionWireSnapshot(value: unknown): TransactionSnapshot {
  // Explicit compatibility with the original validated object contract; never retry a failed command.
  if (value && typeof value === "object" && "contractVersion" in value && value.contractVersion === 1)
    return validateTransactionSnapshot(value);
  const invalid = (): never => {
    throw new TransactionError(
      "invalid_response",
      "The app received an invalid compact financial response. Retry loading data.",
    );
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const wire = value as Record<string, unknown>;
  if (
    wire.contractVersion !== 2 ||
    !Array.isArray(wire.strings) ||
    !wire.strings.every((s) => typeof s === "string") ||
    !Array.isArray(wire.rows) ||
    !Array.isArray(wire.flags)
  )
    return invalid();
  const strings = wire.strings as string[];
  const text = (ref: unknown): string =>
    typeof ref === "number" && Number.isSafeInteger(ref) && ref >= 0 && ref < strings.length ? strings[ref] : invalid();
  const optional = (ref: unknown) => (ref === null ? null : text(ref));
  const tuple = (row: unknown, length: number): unknown[] =>
    Array.isArray(row) && row.length === length ? row : invalid();
  const transactions = wire.rows.map((value) => {
    const r = tuple(value, 17),
      debt = r[10] === null ? null : tuple(r[10], 4);
    if (!Array.isArray(r[13])) return invalid();
    return {
      id: r[0],
      transfer_counterpart_id: r[1],
      date: text(r[2]),
      description: text(r[3]),
      amount: text(r[4]),
      category: optional(r[5]),
      category_source: optional(r[6]),
      confidence: r[7],
      account_id: r[8],
      account_name: text(r[9]),
      applied_to_debt: debt
        ? { date: text(debt[0]), debt_account_id: debt[1], debt_account_name: text(debt[2]), amount: text(debt[3]) }
        : null,
      principal_amount: optional(r[11]),
      split_count: r[12],
      tags: r[13].map(text),
      member_id: r[14],
      member_name: optional(r[15]),
      notes: optional(r[16]),
    };
  });
  const flags = wire.flags.map((value) => {
    const r = tuple(value, 3);
    return { transaction_id: r[0], kind: text(r[1]), detail: text(r[2]) };
  });
  const { strings: _strings, rows: _rows, flags: _flags, ...metadata } = wire;
  void _strings;
  void _rows;
  void _flags;
  return validateTransactionSnapshot({ ...metadata, contractVersion: 1, transactions, flags });
}
