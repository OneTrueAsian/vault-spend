import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clampDate, clampMonth, dateInBounds, formatIso, formatIsoMonth, monthInBounds, parseIso, parseIsoMonth, resolveBounds, resolveMonthBounds,
  type DateBounds, type DateRecord, type MonthBounds, type MonthRecord,
} from "./calendarDate";
import { afterPress } from "./pointerPress";
import { formatDisplay, formatEntry, getEntryFormat, parseEntry, resolveLocale, type FieldKind } from "./calendarLocale";

export type CalendarValue = DateRecord | MonthRecord;

export type FieldCheck = { valid: true; iso: string } | { valid: false; reason: "required" | "format" | "range"; message: string };

export type CalendarFieldOptions = {
  kind: FieldKind;
  /** The stored "YYYY-MM-DD" / "YYYY-MM" value, or "" for none. */
  value: string;
  onChange: (iso: string) => void;
  locale?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** Told when the field becomes valid or invalid, for callers whose submit path does not use native form validation. */
  onValidityChange?: (valid: boolean) => void;
  /** Editor-save callers: told once, with the parsed value, when the person confirms (Enter) or leaves a valid field. */
  onCommit?: (iso: string) => void;
  /** Editor-save callers: told once when the person cancels with Escape. */
  onCancel?: () => void;
  /** Told when the caller replaces the value with one this field did not just report (another record, a reset). */
  onExternalReplace?: () => void;
  /** Everyone else: told when focus leaves the whole field (not when it moves between the box, the button and the calendar) with a valid value. */
  onLeave?: () => void;
};

const DEFAULT_RANGE_MESSAGE = "Choose a date between 1900 and 2100.";

/** Locale changes mid-session (the browser's language list); a dirty draft keeps its original locale until it ends. */
function useBrowserLocale(requested: string | undefined): string {
  const [locale, setLocale] = useState(() => resolveLocale(requested));
  const pending = useRef(locale);
  useEffect(() => {
    const next = resolveLocale(requested);
    pending.current = next;
    setLocale(next);
    const onChange = () => {
      const changed = resolveLocale(requested);
      pending.current = changed;
      setLocale(changed);
    };
    window.addEventListener("languagechange", onChange);
    return () => window.removeEventListener("languagechange", onChange);
  }, [requested]);
  return locale;
}

/** Everything a date or month field decides: what text is in the box, whether it is a usable value, what
 * to tell the caller and when. It owns no popup; the field component pairs it with `useCalendarPopover`. */
export function useCalendarField(options: CalendarFieldOptions) {
  const { kind, value, required = false, disabled = false, readOnly = false, min, max } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const liveLocale = useBrowserLocale(options.locale);
  const [draft, setDraft] = useState<string | null>(null);
  // The locale a dirty draft was typed in: a language change applies once the edit is over.
  const draftLocale = useRef<string | null>(null);
  const locale = draft !== null && draftLocale.current ? draftLocale.current : liveLocale;
  const [focused, setFocused] = useState(false);
  const [showError, setShowError] = useState(false);
  const composing = useRef(false);
  const emitted = useRef<string | null>(null);
  const finished = useRef(false); // this edit already saved or cancelled: leaving must not do it again
  const heldReveal = useRef<(() => void) | null>(null); // an explanation waiting for the current press to end
  const dropHeldReveal = useCallback(() => {
    heldReveal.current?.();
    heldReveal.current = null;
  }, []);
  useEffect(() => dropHeldReveal, [dropHeldReveal]);

  const format = useMemo(() => getEntryFormat(locale, kind), [locale, kind]);
  const dateBounds: DateBounds = useMemo(() => resolveBounds(min, max), [min, max]);
  const monthBounds: MonthBounds = useMemo(() => resolveMonthBounds(min, max), [min, max]);
  const boundsEmpty = kind === "date" ? dateBounds.empty : monthBounds.empty;

  const rangeMessage = useMemo(() => {
    if (kind === "date") {
      if (min === undefined && max === undefined) return DEFAULT_RANGE_MESSAGE;
      const lo = dateBounds.empty ? null : formatDisplay(locale, "date", dateBounds.min);
      const hi = dateBounds.empty ? null : formatDisplay(locale, "date", dateBounds.max);
      if (dateBounds.empty) return "No dates can be chosen here.";
      const defaultLo = dateBounds.min.year === 1900 && dateBounds.min.month === 1 && dateBounds.min.day === 1;
      const defaultHi = dateBounds.max.year === 2100 && dateBounds.max.month === 12 && dateBounds.max.day === 31;
      if (defaultLo && defaultHi) return DEFAULT_RANGE_MESSAGE;
      if (defaultLo) return `Choose a date on or before ${hi}.`;
      if (defaultHi) return `Choose a date on or after ${lo}.`;
      return `Choose a date from ${lo} to ${hi}.`;
    }
    if (monthBounds.empty) return "No months can be chosen here.";
    const lo = formatDisplay(locale, "month", monthBounds.min);
    const hi = formatDisplay(locale, "month", monthBounds.max);
    if (min && max) return `Choose a month from ${lo} to ${hi}.`;
    if (min) return `Choose ${lo} or a later month.`;
    if (max) return `Choose ${hi} or an earlier month.`;
    return "Choose a month.";
  }, [kind, min, max, dateBounds, monthBounds, locale]);

  const requiredMessage = kind === "date" ? "Enter a date." : "Choose a month.";
  const formatMessage = `Enter the ${kind} as ${format.hint}.`;

  const inBounds = useCallback(
    (record: CalendarValue) => (kind === "date" ? dateInBounds(record as DateRecord, dateBounds) : monthInBounds(record, monthBounds)),
    [kind, dateBounds, monthBounds],
  );

  /** What the text in the box (or, when nothing is being edited, the stored value) amounts to. */
  const checkText = useCallback(
    (text: string): FieldCheck => {
      if (text.trim() === "") return required ? { valid: false, reason: "required", message: requiredMessage } : { valid: true, iso: "" };
      const record = kind === "date" ? parseEntry(getEntryFormat(locale, "date"), text) : parseEntry(getEntryFormat(locale, "month"), text);
      if (!record) return { valid: false, reason: "format", message: formatMessage };
      if (!inBounds(record)) return { valid: false, reason: "range", message: rangeMessage };
      return { valid: true, iso: kind === "date" ? formatIso(record as DateRecord) : formatIsoMonth(record) };
    },
    [kind, locale, required, requiredMessage, formatMessage, rangeMessage, inBounds],
  );

  const storedRecord: CalendarValue | null = useMemo(() => (value === "" ? null : kind === "date" ? parseIso(value) : parseIsoMonth(value)), [value, kind]);
  const storedText = storedRecord ? (kind === "date" ? formatEntry(getEntryFormat(locale, "date"), storedRecord as DateRecord) : formatEntry(getEntryFormat(locale, "month"), storedRecord as MonthRecord)) : value;

  const check: FieldCheck = useMemo(() => {
    if (draft !== null) return checkText(draft);
    if (value === "") return required ? { valid: false, reason: "required", message: requiredMessage } : { valid: true, iso: "" };
    if (!storedRecord) return { valid: false, reason: "format", message: formatMessage };
    if (!inBounds(storedRecord)) return { valid: false, reason: "range", message: rangeMessage };
    return { valid: true, iso: value };
  }, [draft, checkText, value, required, requiredMessage, storedRecord, formatMessage, rangeMessage, inBounds]);

  const valid = check.valid && !boundsEmpty;
  const message = valid ? null : check.valid ? rangeMessage : check.message;
  // A value that is out of range, or a complete date typed out of range, says so at once; a half-typed or
  // empty value waits until the person leaves the field or presses Enter.
  const error = !valid && (showError || (check as { reason?: string }).reason === "range" || boundsEmpty) ? message : null;

  // Independent external replacement (another account, profile or a caller reset) retires the draft; the
  // echo of a value this field just emitted does not.
  const seenValue = useRef(value);
  useEffect(() => {
    if (seenValue.current === value) return;
    seenValue.current = value;
    if (value === emitted.current) {
      emitted.current = null;
      return;
    }
    emitted.current = null;
    dropHeldReveal();
    setDraft(null);
    draftLocale.current = null;
    setShowError(false);
    optionsRef.current.onExternalReplace?.();
  }, [value, dropHeldReveal]);

  // Validity is told to the caller only when it changes, and a field that goes away while invalid says it is
  // valid again so a parent's Save button is not left disabled.
  const told = useRef(true);
  useEffect(() => {
    if (told.current === valid) return;
    told.current = valid;
    optionsRef.current.onValidityChange?.(valid);
  }, [valid]);
  useEffect(
    () => () => {
      if (!told.current) optionsRef.current.onValidityChange?.(true);
    },
    [],
  );

  // Disabled or read-only fields end any edit and never save.
  useEffect(() => {
    if (!disabled && !readOnly) return;
    setDraft(null);
    draftLocale.current = null;
    setFocused(false);
    setShowError(false);
  }, [disabled, readOnly]);

  const emit = useCallback((iso: string) => {
    if (iso === optionsRef.current.value) return;
    emitted.current = iso;
    optionsRef.current.onChange(iso);
  }, []);

  const inputText = draft !== null ? draft : storedText;
  const showInputText = focused || draft !== null;

  const startEditing = useCallback(() => {
    finished.current = false;
    dropHeldReveal();
    setFocused(true);
  }, [dropHeldReveal]);

  const typeText = useCallback(
    (text: string) => {
      if (disabled || readOnly) return;
      draftLocale.current = locale;
      setDraft(text);
      if (composing.current) return;
      const result = checkText(text);
      if (result.valid) {
        setShowError(false);
        emit(result.iso);
      }
    },
    [disabled, readOnly, locale, checkText, emit],
  );

  const endComposition = useCallback(
    (text: string) => {
      composing.current = false;
      typeText(text);
    },
    [typeText],
  );

  const endEdit = useCallback(() => {
    dropHeldReveal();
    setDraft(null);
    draftLocale.current = null;
    setShowError(false);
  }, [dropHeldReveal]);

  /** Focus left the whole field. */
  const leave = useCallback(() => {
    setFocused(false);
    if (finished.current) {
      finished.current = false;
      return;
    }
    composing.current = false;
    const result = draft !== null ? checkText(draft) : check;
    if (!result.valid || boundsEmpty) {
      // Leaving by pressing a button below the field: show why only once the press is over, or the button moves.
      dropHeldReveal();
      heldReveal.current = afterPress(() => {
        heldReveal.current = null;
        setShowError(true);
      });
      return;
    }
    endEdit();
    const { onCommit, onLeave } = optionsRef.current;
    if (onCommit) onCommit(result.iso);
    else onLeave?.();
  }, [draft, checkText, check, boundsEmpty, endEdit, dropHeldReveal]);

  /** Enter in the box. Returns true when the key was used (the form must not also submit). */
  const confirm = useCallback((): "ignore" | "blocked" | "committed" | "pass" => {
    if (composing.current) return "ignore";
    const result = draft !== null ? checkText(draft) : check;
    if (!result.valid || boundsEmpty) {
      setShowError(true);
      return "blocked";
    }
    if (result.iso !== optionsRef.current.value) emit(result.iso);
    const { onCommit } = optionsRef.current;
    if (onCommit) {
      finished.current = true;
      endEdit();
      onCommit(result.iso);
      return "committed";
    }
    return "pass";
  }, [draft, checkText, check, boundsEmpty, emit, endEdit]);

  /** Escape in the box with no calendar open: put the stored value back and cancel the edit. */
  const cancel = useCallback((): boolean => {
    endEdit();
    const { onCancel } = optionsRef.current;
    if (!onCancel) return false;
    finished.current = true;
    onCancel();
    return true;
  }, [endEdit]);

  /** A day or month chosen in the calendar. */
  const choose = useCallback(
    (record: CalendarValue) => {
      const iso = kind === "date" ? formatIso(record as DateRecord) : formatIsoMonth(record as MonthRecord);
      const text = kind === "date" ? formatEntry(getEntryFormat(locale, "date"), record as DateRecord) : formatEntry(getEntryFormat(locale, "month"), record as MonthRecord);
      draftLocale.current = locale;
      setDraft(text);
      setShowError(false);
      emit(iso);
    },
    [kind, locale, emit],
  );

  const clear = useCallback(() => {
    if (required) return;
    draftLocale.current = locale;
    setDraft("");
    setShowError(false);
    emit("");
  }, [required, locale, emit]);

  /** Where the calendar opens: the chosen value if it can be chosen, else today, else the nearest allowed. */
  const anchor = useCallback(
    (today: DateRecord): CalendarValue | null => {
      const typed = draft !== null ? (kind === "date" ? parseEntry(getEntryFormat(locale, "date"), draft) : parseEntry(getEntryFormat(locale, "month"), draft)) : storedRecord;
      if (typed && inBounds(typed)) return typed;
      if (kind === "date") return clampDate(today, dateBounds);
      return clampMonth({ year: today.year, month: today.month }, monthBounds);
    },
    [draft, kind, locale, storedRecord, inBounds, dateBounds, monthBounds],
  );

  return {
    kind,
    locale,
    format,
    check,
    valid,
    error,
    inputText,
    showInputText,
    focused,
    selected: draft !== null ? (check.valid && check.iso !== "" ? (kind === "date" ? parseIso(check.iso) : parseIsoMonth(check.iso)) : null) : storedRecord,
    dateBounds,
    monthBounds,
    boundsEmpty,
    startEditing,
    typeText,
    beginComposition: () => {
      composing.current = true;
    },
    endComposition,
    isComposing: () => composing.current,
    leave,
    confirm,
    cancel,
    choose,
    clear,
    anchor,
    reveal: () => setShowError(true),
  };
}
