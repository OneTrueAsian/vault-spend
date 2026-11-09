import type { InputHTMLAttributes } from "react";
import { CalendarField, type CalendarFieldProps } from "./calendar/CalendarField";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max"> & {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  /** A fixed region (for tests); otherwise the browser's own. */
  locale?: string;
  /** Told when the text in the box becomes a usable month or stops being one. */
  onValidityChange?: (valid: boolean) => void;
};

/** The one month field: a text box in the region's order ("mm/yyyy") and a month grid the app draws. The
 * stored value is always "YYYY-MM". `onBlur` is told when focus leaves the whole field, not when it moves
 * between the box, its calendar button and the calendar. */
export function MonthField({
  value,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  autoFocus,
  className,
  disabled,
  readOnly,
  required,
  min,
  max,
  id,
  title,
  locale,
  onValidityChange,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  ...attrs
}: Props) {
  // Whatever is left are data hooks and other attributes the caller put on the box.
  const { placeholder: _placeholder, ...rest } = attrs;
  return (
    <CalendarField
      kind="month"
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel ?? "Month"}
      placeholder={typeof _placeholder === "string" && _placeholder ? _placeholder : "Pick a month"}
      min={min}
      max={max}
      autoFocus={autoFocus}
      onFocus={onFocus}
      onBlur={onBlur}
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
      inputAttrs={rest as NonNullable<CalendarFieldProps["inputAttrs"]>}
    />
  );
}
