import { save } from "./nativeDialog";
import { toCsv } from "./csv";
import { toLocalIsoDate } from "./format";
import { errorMessage } from "./errorMessage";
import type { Transaction } from "./types";
import type { StatusKind } from "./appTypes";

/** Exports the complete sorted matching dataset, including both transfer legs, through a bound client. */
export function createTransactionExporter({ rows, isProtected, confirmPlaintext, call, onStatus }: {
  rows: Transaction[]; isProtected: boolean; confirmPlaintext: () => Promise<boolean>;
  call: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  onStatus: (message: string, kind?: StatusKind) => void;
}) {
  return async () => {
    try {
      if (isProtected && !(await confirmPlaintext())) return;
      const path = await save({ defaultPath: `transactions-export-${toLocalIsoDate()}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      const content = toCsv(["Date", "Description", "Amount", "Account", "Category", "Tags", "Notes"], rows.map(t => [t.date, t.description, t.amount, t.account_name, t.category ?? "", t.tags.join("; "), t.notes ?? ""]), ["text", "text", "decimal", "text", "text", "text", "text"]);
      await call("write_text_file", { path, content });
      onStatus(`Exported ${rows.length} transaction(s) to ${path}.`, "success");
    } catch (error) { onStatus(errorMessage(error)); }
  };
}
