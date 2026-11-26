import { formatDisplayDate } from "../../shared/lib/format";
import { UNCATEGORIZED_FILTER } from "../../shared/native/appTypes";

/** On Transactions, when it was opened from a Reports row: says what is shown (only while `showing`, that is, the filters are still the ones the row set) and always offers the way back. It states the
 * category and dates only; the ledger lists every transaction in the category, so its total can differ from the report's. */
export function ReportReturnBar({ category, from, to, showing, onBack }: { category: string; from: string; to: string; showing: boolean; onBack: () => void }) {
  const name = category === UNCATEGORIZED_FILTER ? "Uncategorized" : category;
  return (
    <div data-report-return role="region" aria-label="Opened from Reports" className="folder-import-notice">
      {showing && (
        <span>
          Showing {name} transactions from {formatDisplayDate(from)} to {formatDisplayDate(to)}.
        </span>
      )}
      <button type="button" className="modal-secondary" data-report-return-back onClick={onBack}>
        ← Back to Reports
      </button>
    </div>
  );
}
