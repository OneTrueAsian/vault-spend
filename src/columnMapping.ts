/** Which column of a CSV file holds the money: one column, or separate money-out and money-in columns. */
export type AmountColumns = { kind: "single"; column: number } | { kind: "debit_credit"; debit: number; credit: number };

/** The person's answer to "Match your columns". Numbers are 0-based column positions in the file. */
export type ColumnMap = { date: number; description: number; amount: AmountColumns; category?: number | null };

/** What `inspect_import_columns` found in a file's first rows. */
export type ColumnInspection = {
  status: "ok" | "saved" | "needs_mapping";
  headers: string[];
  sample_rows: string[][];
  missing: string[];
  guess: { date: number | null; description: number | null; amount: number | null; debit: number | null; credit: number | null };
  map: ColumnMap | null;
};

/** The window's choices while they are being made; any of them can still be empty. */
export type Draft = {
  date: number | null;
  description: number | null;
  split: boolean;
  amount: number | null;
  debit: number | null;
  credit: number | null;
};

export function draftFromGuess(inspection: ColumnInspection): Draft {
  const { date, description, amount, debit, credit } = inspection.guess;
  return { date, description, split: amount === null && debit !== null && credit !== null, amount, debit, credit };
}

/** Why the choices can't be used yet, in plain words, or null when they can. */
export function draftProblem(draft: Draft): string | null {
  if (draft.date === null) return "Pick the column that has the date.";
  if (draft.description === null) return "Pick the column that has the description.";
  const money = draft.split ? [draft.debit, draft.credit] : [draft.amount];
  if (money.some((column) => column === null)) return "Pick the column that has the amount.";
  const used = [draft.date, draft.description, ...money];
  if (new Set(used).size !== used.length) return "Each field needs its own column.";
  return null;
}

export function toColumnMap(draft: Draft): ColumnMap {
  const problem = draftProblem(draft);
  if (problem !== null) throw new Error(problem);
  const amount: AmountColumns = draft.split
    ? { kind: "debit_credit", debit: draft.debit as number, credit: draft.credit as number }
    : { kind: "single", column: draft.amount as number };
  return { date: draft.date as number, description: draft.description as number, amount };
}

/** How a column is named in a menu: its header, "Column N" when the header is blank, and the position added when two headers read the same. */
export function columnLabel(headers: string[], index: number): string {
  const text = (headers[index] ?? "").trim();
  if (text === "") return `Column ${index + 1}`;
  const repeated = headers.filter((h) => h.trim() === text).length > 1;
  return repeated ? `${text} (column ${index + 1})` : text;
}

/** Whether the window should open: the file needs matching, or a remembered choice was reported without its columns. */
export function needsMapping(inspection: ColumnInspection): boolean {
  return inspection.status === "needs_mapping" || (inspection.status === "saved" && inspection.map === null);
}
