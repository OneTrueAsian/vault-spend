import { useId, useState } from "react";
import { toLocalIsoDate } from "../format";
import { InfoTip } from "../InfoTip";
import { FIELD_TIPS } from "./fieldTips";
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
  tip,
}: {
  label: string;
  value: ManualAmount | null;
  onChange: (amount: ManualAmount | null) => void;
  hint?: string;
  /** What to enter, shown in an InfoTip beside the label (the date and note have their own). */
  tip?: string;
}) {
  const [text, setText] = useState(value?.value ?? "");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const inputId = useId();
  const tipId = useId();
  const dateTipId = useId();
  const noteTipId = useId();
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
        {/* The tips sit beside their labels, never inside: a label holding a button labels the button. */}
        <span className="cmp-row-label">
          <label htmlFor={inputId}>{label}</label>
          {tip && <InfoTip label={label} text={tip} id={tipId} />}
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            className="cmp-money-input"
            aria-label={label}
            aria-invalid={error !== null}
            aria-describedby={[error ? errorId : null, tip ? tipId : null].filter(Boolean).join(" ") || undefined}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              commit(e.target.value, date, note);
            }}
            placeholder="$"
          />
        </span>
        <span className="cmp-tip-field">
          <label>
            <span className="cmp-sr-label">{label}: date measured</span>
            <input
              type="date"
              className="cmp-date-input"
              value={date}
              disabled={value === null}
              aria-describedby={dateTipId}
              onChange={(e) => commit(text, e.target.value, note)}
            />
          </label>
          <InfoTip label={`${label}: date measured`} text={FIELD_TIPS.measuredOn} id={dateTipId} />
        </span>
        <span className="cmp-tip-field cmp-note-input">
          <label>
            <span className="cmp-sr-label">{label}: where this came from</span>
            <input
              type="text"
              value={note}
              disabled={value === null}
              placeholder="Where this came from (optional)"
              aria-describedby={noteTipId}
              onChange={(e) => commit(text, date, e.target.value)}
            />
          </label>
          <InfoTip label={`${label}: where this came from`} text={FIELD_TIPS.sourceNote} id={noteTipId} />
        </span>
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
