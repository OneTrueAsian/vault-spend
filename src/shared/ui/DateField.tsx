import type { KeyboardEvent } from "react";
import { CalendarField } from "./calendar/CalendarField";

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
  /** Focus left the whole field (the box, its calendar button and the calendar together), with a valid date. */
  onBlur?: () => void;
  /** Keys the field does not use itself; Enter and Escape are the field's own when `onCommit` / `onCancel` are given. */
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Classes for the input itself (it draws the field's box, so the usual field styles apply). */
  className?: string;
  id?: string;
  title?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  ariaDescribedBy?: string;
  /** A fixed region (for tests); otherwise the browser's own. */
  locale?: string;
  /** Told when the text in the box becomes a usable date or stops being one, for a Save button that does not use form validation. */
  onValidityChange?: (valid: boolean) => void;
  /** An editor that saves when confirmed: told once, with the date, on Enter or when focus leaves a valid date. */
  onCommit?: (iso: string) => void;
  /** An editor that cancels: told once on Escape. */
  onCancel?: () => void;
} & DataAttributes;

/** The one date field: a text box in the region's own order ("mm/dd/yyyy", "dd.mm.yyyy", "yyyy/mm/dd") and
 * a calendar the app draws, so it looks like the rest of the app in every style. While it isn't being
 * edited the date is written out ("Oct 4, 2026"). The stored value is always "YYYY-MM-DD", kept to
 * 1900-2100 (`dateRange.ts`); text that is not a real date in range says so under the field and marks it
 * invalid, so the form around it won't submit until it is corrected. */
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
  readOnly,
  required,
  ariaDescribedBy,
  locale,
  onValidityChange,
  onCommit,
  onCancel,
  ...data
}: DateFieldProps) {
  return (
    <CalendarField
      kind="date"
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      min={min}
      max={max}
      autoFocus={autoFocus}
      onBlur={onBlur ? () => onBlur() : undefined}
      onKeyDown={onKeyDown}
      className={className}
      id={id}
      title={title}
      disabled={disabled}
      readOnly={readOnly}
      required={required}
      ariaDescribedBy={ariaDescribedBy}
      locale={locale}
      onValidityChange={onValidityChange}
      onCommit={onCommit}
      onCancel={onCancel}
      inputAttrs={data}
    />
  );
}
