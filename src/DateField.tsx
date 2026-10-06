import { useState, type KeyboardEvent } from "react";
import { formatFullDate } from "./format";
import "./DateField.css";

type DataAttributes = { [key: `data-${string}`]: string | boolean | number | undefined };

export type DateFieldProps = {
  /** The stored "YYYY-MM-DD" date, or "" for none. */
  value: string;
  onChange: (iso: string) => void;
  ariaLabel: string;
  /** What the field says while it's empty (default "Pick a date"). */
  placeholder?: string;
  min?: string;
  max?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Classes for the input itself (it draws the field's box, so the usual field styles apply). */
  className?: string;
  id?: string;
  title?: string;
  disabled?: boolean;
  ariaDescribedBy?: string;
} & DataAttributes;

/** The one date field. A real `<input type="date">` does the work (typing, the calendar, tests that
 * set its value), and draws the box. While it isn't being edited its own "mm/dd/yyyy" text is hidden
 * and the date is written out instead ("Oct 4, 2026"), the same way dates read everywhere else. */
export function DateField({
  value,
  onChange,
  ariaLabel,
  placeholder = "Pick a date",
  min,
  max,
  autoFocus,
  onBlur,
  onKeyDown,
  className,
  id,
  title,
  disabled,
  ariaDescribedBy,
  ...data
}: DateFieldProps) {
  // autoFocus focuses the input before any focus handler is attached, so start in editing mode then.
  const [editing, setEditing] = useState(Boolean(autoFocus));
  const wrapperClass = [
    "date-field",
    editing ? "date-field-editing" : "",
    value ? "" : "date-field-empty",
    disabled ? "date-field-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={wrapperClass}>
      <input
        {...data}
        type="date"
        className={["date-field-input", className].filter(Boolean).join(" ")}
        id={id}
        value={value}
        min={min}
        max={max}
        title={title}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          onBlur?.();
        }}
        onKeyDown={onKeyDown}
      />
      <span className="date-field-text" aria-hidden="true">
        {value ? formatFullDate(value) : placeholder}
      </span>
    </span>
  );
}
