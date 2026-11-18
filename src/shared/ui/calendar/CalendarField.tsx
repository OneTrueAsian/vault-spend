import { useEffect, useId, useLayoutEffect, useMemo, useRef, type FocusEvent, type KeyboardEvent } from "react";
import type { DateRecord, MonthRecord } from "./calendarDate";
import { formatDisplay, textDirection } from "./calendarLocale";
import { CalendarPopover } from "./CalendarPopover";
import { DateCalendar } from "./DateCalendar";
import { MonthCalendar } from "./MonthCalendar";
import { useCalendarField, type CalendarFieldOptions } from "./useCalendarField";
import { useCalendarPopover, type CloseReason } from "./useCalendarPopover";
import { useToday } from "./useToday";
import "../DateField.css";

type DataAttributes = { [key: `data-${string}`]: string | boolean | number | undefined };

export type CalendarFieldProps = Pick<CalendarFieldOptions, "kind" | "value" | "onChange" | "locale" | "min" | "max" | "required" | "readOnly" | "onValidityChange" | "onCommit" | "onCancel"> & {
  ariaLabel: string;
  /** What the closed field says while it is empty. */
  placeholder: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Focus left the whole field (not just the box for the button or the calendar), with a valid value. */
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  /** Keys the field does not use itself. */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
  id?: string;
  title?: string;
  ariaDescribedBy?: string;
  /** Extra attributes for the box (data hooks, name-less native attributes). */
  inputAttrs?: DataAttributes & Record<string, unknown>;
};

const HELP: Record<"date" | "month", string> = {
  date: "Use the arrow keys to move between days, Page Up and Page Down for months, and Enter to choose a day. Escape closes the calendar.",
  month: "Use the arrow keys to move between months, Page Up and Page Down for years, and Enter to choose a month. Escape closes the calendar.",
};

/** The text box, calendar button and popup that DateField and MonthField share. The visible box is a real
 * text input in the region's order; the calendar is drawn by the app, never by the browser. */
export function CalendarField(props: CalendarFieldProps) {
  const { kind, ariaLabel, placeholder, autoFocus, disabled = false, readOnly = false, required = false, className, id, title, ariaDescribedBy, inputAttrs } = props;
  const leaveEvent = useRef<FocusEvent<HTMLInputElement> | null>(null);
  const closeRef = useRef<((reason: CloseReason) => void) | null>(null);
  const field = useCalendarField({
    kind,
    value: props.value,
    onChange: props.onChange,
    locale: props.locale,
    min: props.min,
    max: props.max,
    required,
    disabled,
    readOnly,
    onValidityChange: props.onValidityChange,
    onCommit: props.onCommit,
    onCancel: props.onCancel,
    onLeave: () => leaveEvent.current && props.onBlur?.(leaveEvent.current),
    onExternalReplace: () => closeRef.current?.("other"),
  });
  const direction = textDirection(field.locale);
  const popup = useCalendarPopover({ disabled: disabled || readOnly, direction });
  closeRef.current = popup.close;
  const today = useToday();
  const problemId = useId();
  const hintId = useId();
  const labelId = useId();
  const helpId = useId();

  useEffect(() => {
    if (autoFocus) field.startEditing();
    // Only when the field mounts: autoFocus focuses the box before any focus handler is attached.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The browser's own validity: native form submission refuses an invalid field and says why.
  useLayoutEffect(() => {
    popup.inputRef.current?.setCustomValidity(field.valid ? "" : field.error ?? (field.check.valid ? "" : field.check.message));
  });

  const describedBy = [ariaDescribedBy, hintId, field.error ? problemId : null].filter(Boolean).join(" ");
  const stored = field.selected;
  const closedText = useMemo(() => {
    if (!stored || props.value === "") return placeholder;
    return kind === "date" ? formatDisplay(field.locale, "date", stored as DateRecord) : formatDisplay(field.locale, "month", stored as MonthRecord);
  }, [stored, props.value, kind, field.locale, placeholder]);
  const shownText = props.value !== "" && !stored ? props.value : closedText;
  const interactive = !disabled && !readOnly;

  const wrapperClass = [
    "date-field",
    field.showInputText ? "date-field-editing" : "",
    props.value || field.inputText ? "" : "date-field-empty",
    disabled ? "date-field-disabled" : "",
    field.error ? "date-field-invalid" : "",
  ].filter(Boolean).join(" ");

  function onKeyDown(e: KeyboardEvent<HTMLSpanElement>) {
    if (e.key === "Escape" && popup.open) {
      // Dismiss only the calendar: the dialog or filter panel around the field must stay open.
      e.preventDefault();
      e.stopPropagation();
      popup.close("escape");
      return;
    }
    // Escape reaches an editor from the box, or from the calendar button when the calendar was just closed.
    const fromBox = e.target === popup.inputRef.current;
    if (!fromBox && !(e.key === "Escape" && e.target === popup.triggerRef.current)) return;
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" && e.altKey && interactive) {
      e.preventDefault();
      popup.openPopup("input");
      return;
    }
    if (e.key === "Enter") {
      const outcome = field.confirm();
      if (outcome === "ignore") return;
      if (outcome === "blocked" || outcome === "committed") {
        e.preventDefault();
        return;
      }
    } else if (e.key === "Escape") {
      if (field.cancel()) return;
    }
    props.onKeyDown?.(e as unknown as KeyboardEvent<HTMLInputElement>);
  }

  function onBlur(e: FocusEvent<HTMLSpanElement>) {
    const next = e.relatedTarget;
    if (next instanceof Node && popup.rootRef.current?.contains(next)) return;
    popup.close("leave");
    // A caller listening for the box's blur gets one that targets the box, whichever inner control lost focus.
    const box = popup.inputRef.current;
    leaveEvent.current = box ? (Object.assign(Object.create(e), { target: box, currentTarget: box }) as FocusEvent<HTMLInputElement>) : null;
    field.leave();
  }

  const triggerName = kind === "date" ? "Choose date" : "Choose month";
  const open = popup.open;
  const selectedDate = kind === "date" ? (stored as DateRecord | null) : null;
  const anchor = open ? field.anchor(today) : null;

  return (
    <>
      <span
        ref={popup.rootRef}
        className={wrapperClass}
        data-date-field={kind}
        data-value={props.value}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        <input
          {...(inputAttrs as object)}
          ref={popup.inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          className={["date-field-input", className].filter(Boolean).join(" ")}
          id={id}
          title={title}
          value={field.inputText}
          placeholder={field.format.hint}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          autoFocus={autoFocus}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-invalid={field.error ? true : undefined}
          onChange={(e) => field.typeText(e.target.value)}
          onFocus={(e) => {
            field.startEditing();
            props.onFocus?.(e);
          }}
          onCompositionStart={field.beginComposition}
          onCompositionEnd={(e) => field.endComposition(e.currentTarget.value)}
        />
        <span className="date-field-text" aria-hidden="true">
          {shownText}
        </span>
        <button
          ref={popup.triggerRef}
          type="button"
          className="date-field-trigger"
          aria-label={`${triggerName}: ${ariaLabel}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popup.id : undefined}
          disabled={!interactive}
          onClick={() => (open ? popup.close("other") : popup.openPopup("trigger"))}
        >
          <span aria-hidden="true" className="date-field-trigger-icon" />
        </button>
        <span id={hintId} className="calendar-sr">
          Type the {kind} as {field.format.hint}, or open the calendar.
        </span>
        {open && (
          <CalendarPopover ref={popup.panelRef} id={popup.id} labelId={labelId} helpId={helpId} dir={direction} kind={kind} help={HELP[kind]}>
            {kind === "date" ? (
              <DateCalendar
                locale={field.locale}
                bounds={field.dateBounds}
                selected={selectedDate}
                start={anchor as DateRecord | null}
                today={today}
                labelId={labelId}
                optional={!required}
                onSelect={(date) => {
                  field.choose(date);
                  popup.close("select");
                }}
                onClear={() => {
                  field.clear();
                  popup.close("select");
                }}
              />
            ) : (
              <MonthCalendar
                locale={field.locale}
                bounds={field.monthBounds}
                selected={stored as MonthRecord | null}
                start={anchor as MonthRecord | null}
                current={{ year: today.year, month: today.month }}
                labelId={labelId}
                onPick={(month) => {
                  field.choose(month);
                  popup.close("select");
                }}
                footer={
                  <>
                    {!required ? (
                      <button type="button" className="calendar-action" onClick={() => { field.clear(); popup.close("select"); }}>
                        Clear
                      </button>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      className="calendar-action"
                      disabled={!currentMonthAvailable(field.monthBounds, today)}
                      onClick={() => {
                        field.choose({ year: today.year, month: today.month });
                        popup.close("select");
                      }}
                    >
                      This month
                    </button>
                  </>
                }
              />
            )}
          </CalendarPopover>
        )}
      </span>
      {field.error && (
        <span id={problemId} className="field-error date-field-problem" role="alert">
          {field.error}
        </span>
      )}
    </>
  );
}

function currentMonthAvailable(bounds: { min: MonthRecord; max: MonthRecord; empty: boolean }, today: DateRecord): boolean {
  if (bounds.empty) return false;
  const index = today.year * 12 + today.month;
  return index >= bounds.min.year * 12 + bounds.min.month && index <= bounds.max.year * 12 + bounds.max.month;
}
