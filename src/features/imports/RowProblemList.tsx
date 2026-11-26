import { useState } from "react";
import type { RowProblem } from "../../shared/lib/types";

const SHOWN_AT_FIRST = 5;

/** The rows an import could not read, each with why (and a look at the row when the file gives one),
 * so the person can fix the file. The first few show; "Show all" reveals the rest. */
export function RowProblemList({ problems }: { problems: RowProblem[] }) {
  const [showAll, setShowAll] = useState(false);
  if (problems.length === 0) return null;
  const shown = showAll ? problems : problems.slice(0, SHOWN_AT_FIRST);
  return (
    <>
      <ul className="import-row-problems">
        {shown.map((p, i) => (
          <li key={i}>
            Row {p.row_number}: {p.reason}
            {p.preview && <span className="import-row-problem-preview">{p.preview}</span>}
          </li>
        ))}
      </ul>
      {!showAll && problems.length > SHOWN_AT_FIRST && (
        <button type="button" className="modal-secondary" onClick={() => setShowAll(true)}>
          Show all {problems.length}
        </button>
      )}
    </>
  );
}
