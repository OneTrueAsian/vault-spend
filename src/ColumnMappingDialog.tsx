import "./ColumnMappingDialog.css";
import { useEffect, useRef, useState } from "react";
import { ModalShell } from "./Modal";
import { MenuSelect } from "./MenuSelect";
import { columnLabel, draftFromGuess, draftProblem, toColumnMap, type ColumnInspection, type ColumnMap, type Draft } from "./columnMapping";

type Field = "date" | "description" | "amount" | "debit" | "credit";

const QUESTIONS: Record<Field, string> = {
  date: "Which column has the date?",
  description: "Which column has the description?",
  amount: "Which column has the amount?",
  debit: "Which column has the money out?",
  credit: "Which column has the money in?",
};

/** Shown when a CSV's headers aren't ones the importer recognises: the person says which column is
 * the date, the description and the amount, looking at the file's first rows. */
export function ColumnMappingDialog({
  inspection,
  accountName,
  onCancel,
  onConfirm,
}: {
  inspection: ColumnInspection;
  accountName?: string;
  onCancel: () => void;
  onConfirm: (map: ColumnMap) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFromGuess(inspection));
  const bodyRef = useRef<HTMLDivElement>(null);
  const problem = draftProblem(draft);
  const { headers, sample_rows: rows } = inspection;
  const options = headers.map((_, index) => ({ value: String(index), label: columnLabel(headers, index) }));

  // The first dropdown takes focus once the dialog has settled (the shell focuses its own panel first).
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLButtonElement>("[data-column-field]")?.focus();
  }, []);

  function select(field: Field) {
    return (
      <div className="column-mapping-field" key={field}>
        <span className="column-mapping-question">{QUESTIONS[field]}</span>
        <MenuSelect
          fill
          ariaLabel={QUESTIONS[field]}
          options={options}
          placeholder="Choose a column"
          value={draft[field] === null ? "" : String(draft[field])}
          onChange={(value) => setDraft((d) => ({ ...d, [field]: Number(value) }))}
          triggerAttrs={{ "data-column-field": field }}
        />
      </div>
    );
  }

  return (
    <ModalShell title="Match your columns" onCancel={onCancel} wide dismissOnOverlayClick={false} panelAttrs={{ "data-column-mapping": true }}>
      <div ref={bodyRef}>
        <p className="modal-message">
          We couldn't tell which columns in this file are the date, the description and the amount. Pick them below. We'll remember your
          choice for {accountName ?? "this account"}.
        </p>
        <div className="column-mapping-fields">
          {select("date")}
          {select("description")}
          {draft.split ? (
            <>
              {select("debit")}
              {select("credit")}
            </>
          ) : (
            select("amount")
          )}
        </div>
        <label className="column-mapping-split">
          <input
            type="checkbox"
            data-column-split
            checked={draft.split}
            onChange={(e) => setDraft((d) => ({ ...d, split: e.target.checked }))}
          />
          <span>Money in and money out are in separate columns</span>
        </label>
        <p className="modal-message modal-message-secondary column-mapping-caption">The first rows of your file</p>
        <div className="column-mapping-preview">
          <table>
            <thead>
              <tr>
                {headers.map((_, index) => (
                  <th key={index}>{columnLabel(headers, index)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {headers.map((_, index) => (
                    <td key={index}>{row[index] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {problem && (
          <p className="modal-message modal-message-secondary column-mapping-problem" role="status" data-column-problem>
            {problem}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" data-column-cancel onClick={onCancel}>
            Cancel
          </button>
          <button type="button" data-column-continue disabled={problem !== null} onClick={() => onConfirm(toColumnMap(draft))}>
            Continue
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
