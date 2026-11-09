/** The Reports page's output buttons. Where the app can write a PDF itself (`onSavePdf`), "Print" is only for
 * printers and "Save as PDF" makes the file; elsewhere the one system print window does both. */
export function ReportPrintActions({ onExportCsv, onPrint, onSavePdf }: { onExportCsv: () => void; onPrint: () => void; onSavePdf?: () => void }) {
  return (
    <div className="page-actions no-print">
      <button type="button" className="modal-secondary" onClick={onExportCsv}>
        Export CSV
      </button>
      <button type="button" className="modal-secondary" onClick={onPrint}>
        {onSavePdf ? "Print" : "Print / Save as PDF"}
      </button>
      {onSavePdf && (
        <button type="button" className="modal-secondary" onClick={onSavePdf}>
          Save as PDF
        </button>
      )}
    </div>
  );
}
