import { save } from "./nativeDialog";
import { toLocalIsoDate } from "./format";
import { errorMessage } from "./errorMessage";
import type { StatusKind } from "./appTypes";

/** "Save as PDF" on Reports: the app's own Save window picks the file (Windows asks before replacing one),
 * then the app writes the report there. Cancelling the window does nothing. */
export function createReportPdfSaver({ call, onStatus, today = toLocalIsoDate }: {
  call: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  onStatus: (message: string, kind?: StatusKind) => void;
  today?: () => string;
}) {
  return async () => {
    try {
      const path = await save({ defaultPath: `Vault Spend report ${today()}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!path) return;
      await call("save_report_pdf", { path });
      onStatus(`Saved the report as a PDF to ${path}.`, "success");
    } catch (error) {
      onStatus(errorMessage(error));
    }
  };
}
