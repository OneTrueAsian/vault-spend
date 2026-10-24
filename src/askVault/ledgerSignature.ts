type Row = {
  id: number;
  date: string;
  description: string;
  amount: string;
  category: string | null;
  account_id: number;
  split_count: number;
  transfer_counterpart_id: number | null;
};

/**
 * A short fingerprint of the fields that can change an Ask the Vault answer. The Dashboard reloads
 * its transaction list for many reasons; an answer should only be retired when what it was
 * computed from really changed, so the card compares this rather than the list's identity.
 */
export function ledgerSignature(rows: readonly Row[]): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const row of rows) {
    const text = [row.id, row.date, row.description, row.amount, row.category ?? "", row.account_id, row.split_count, row.transfer_counterpart_id ?? ""].join("|") + ";";
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = (Math.imul(b, 31) + c) >>> 0;
    }
  }
  return `${rows.length}:${a.toString(16)}:${b.toString(16)}`;
}
