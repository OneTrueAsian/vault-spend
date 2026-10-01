import { useId, useState } from "react";
import { toLocalIsoDate } from "../format";
import { parseMoneyText } from "./setupDraft";
import type { ManualAmount } from "./types";

/** A figure the person types and vouches for: the amount, the date it was measured, and a short note
 * on where it came from. `onChange` receives a complete amount as soon as the dollars parse (the date
 * defaults to today), or `null` when the dollars are cleared. The note is optional. */
export function AmountEditor({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: ManualAmount | null;
  onChange: (amount: ManualAmount | null) => void;
  hint?: string;
}) {
  const [text, setText] = useState(value?.value ?? "");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const date = value?.measuredOn ?? toLocalIsoDate();
  const note = value?.explanation ?? "";

  function commit(nextText: string, nextDate: string, nextNote: string) {
    if (nextText.trim() === "") {
      setError(null);
      onChange(null);
      return;
    }
    const parsed = parseMoneyText(nextText);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    onChange({ value: parsed.ok, measuredOn: nextDate, explanation: nextNote });
  }

  return (
    <div className="cmp-amount-editor" data-cmp-amount={label}>
      <div className="cmp-settings-row">
        <label className="cmp-row-label">
          {label}
          <input
            type="text"
            inputMode="decimal"
            className="cmp-money-input"
            aria-label={label}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              commit(e.target.value, date, note);
            }}
            placeholder="$"
          />
        </label>
        <label>
          <span className="cmp-sr-label">{label}: date measured</span>
          <input
            type="date"
            className="cmp-date-input"
            value={date}
            disabled={value === null}
            onChange={(e) => commit(text, e.target.value, note)}
          />
        </label>
        <label className="cmp-note-input">
          <span className="cmp-sr-label">{label}: where this came from</span>
          <input
            type="text"
            value={note}
            disabled={value === null}
            placeholder="Where this came from (optional)"
            onChange={(e) => commit(text, date, e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p id={errorId} className="cmp-field-error" role="alert">
          {error}
        </p>
      )}
      {hint && <p className="modal-message-secondary">{hint}</p>}
    </div>
  );
}
