import { useState, type InputHTMLAttributes } from "react";
import "./DateField.css";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
};
export function MonthField({ value, onChange, onFocus, onBlur, autoFocus, className, disabled, ...attrs }: Props) {
  const [editing, setEditing] = useState(Boolean(autoFocus));
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const text = valid ? new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}-01T12:00:00Z`)) : value || "Pick a month";
  return <span className={`date-field${editing ? " date-field-editing" : ""}${!value ? " date-field-empty" : ""}${disabled ? " date-field-disabled" : ""}`}>
    <input {...attrs} type="month" value={value} disabled={disabled} autoFocus={autoFocus}
      className={["date-field-input", className].filter(Boolean).join(" ")}
      onChange={event => onChange(event.target.value)}
      onFocus={event => { setEditing(true); onFocus?.(event); }}
      onBlur={event => { setEditing(false); onBlur?.(event); }} />
    <span className="date-field-text" aria-hidden="true">{text}</span>
  </span>;
}
