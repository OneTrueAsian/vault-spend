import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { addMonthRecords, clampMonth, compareMonths, monthInBounds, type MonthBounds, type MonthRecord } from "./calendarDate";
import { monthLabels, textDirection, yearLabel } from "./calendarLocale";

/** Twelve months in three columns and four rows, with year navigation. It is the whole popup for a month
 * field and the "jump to a month" view inside a date calendar. Moving focus or the year never selects;
 * choosing a month is always an explicit Enter, Space or click. */
export function MonthCalendar({
  locale,
  bounds,
  selected,
  start,
  current,
  labelId,
  onPick,
  onBack,
  footer,
}: {
  locale: string;
  bounds: MonthBounds;
  selected: MonthRecord | null;
  /** The month the grid opens on (focus lands here). */
  start: MonthRecord | null;
  /** The real current month, marked "today". */
  current: MonthRecord;
  labelId: string;
  onPick: (month: MonthRecord) => void;
  /** Present when this is the jump view of a date calendar. */
  onBack?: () => void;
  footer?: React.ReactNode;
}) {
  const rtl = textDirection(locale) === "rtl";
  const names = monthLabels(locale);
  const [focus, setFocus] = useState<MonthRecord | null>(start);
  const [year, setYear] = useState((start ?? current).year);
  const [yearText, setYearText] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const wantsFocus = useRef(true);

  useEffect(() => {
    if (!wantsFocus.current || !focus) return;
    wantsFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-month="${focus.year}-${focus.month}"]`)?.focus();
  });

  const hasYear = (y: number) => !bounds.empty && y >= bounds.min.year && y <= bounds.max.year;
  const goTo = (target: MonthRecord | null) => {
    if (!target) return;
    wantsFocus.current = true;
    setFocus(target);
    setYear(target.year);
    setYearText(null);
  };
  const stepYear = (delta: number) => {
    if (!hasYear(year + delta)) return;
    const next = clampMonth({ year: year + delta, month: focus?.month ?? 1 }, bounds);
    goTo(next);
  };

  function onKeyDown(e: KeyboardEvent) {
    if (!focus || bounds.empty) return;
    const horizontal = rtl ? -1 : 1;
    let target: MonthRecord | null = null;
    switch (e.key) {
      case "ArrowRight": target = addMonthRecords(focus, horizontal); break;
      case "ArrowLeft": target = addMonthRecords(focus, -horizontal); break;
      case "ArrowDown": target = addMonthRecords(focus, 3); break;
      case "ArrowUp": target = addMonthRecords(focus, -3); break;
      case "Home": target = { year: focus.year, month: 1 }; break;
      case "End": target = { year: focus.year, month: 12 }; break;
      case "PageUp": target = { year: focus.year - 1, month: focus.month }; break;
      case "PageDown": target = { year: focus.year + 1, month: focus.month }; break;
      default: return;
    }
    e.preventDefault();
    goTo(clampMonth(target, bounds));
  }

  function typeYear(text: string) {
    setYearText(text);
    if (!/^\d{4}$/.test(text)) return;
    const typed = Number(text);
    if (!hasYear(typed)) return;
    const next = clampMonth({ year: typed, month: focus?.month ?? 1 }, bounds);
    if (next) {
      setFocus(next);
      setYear(typed);
    }
  }
  const yearInvalid = yearText !== null && !(/^\d{4}$/.test(yearText) && hasYear(Number(yearText)));
  const rows = [0, 1, 2, 3];
  const prevYear = hasYear(year - 1);
  const nextYear = hasYear(year + 1);

  return (
    <div className="calendar-body calendar-months">
      <div className="calendar-header">
        <button type="button" className="calendar-nav" aria-label="Previous year" disabled={!prevYear} onClick={() => stepYear(-1)}>
          <span aria-hidden="true">{rtl ? "›" : "‹"}</span>
        </button>
        <h2 id={labelId} className="calendar-heading" aria-live="polite">
          <input
            className="calendar-year"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Year"
            aria-invalid={yearInvalid || undefined}
            value={yearText ?? yearLabel(locale, year)}
            onChange={(e) => typeYear(e.target.value)}
            onBlur={() => setYearText(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                stepYear(e.key === "ArrowUp" ? 1 : -1);
              }
            }}
          />
        </h2>
        <button type="button" className="calendar-nav" aria-label="Next year" disabled={!nextYear} onClick={() => stepYear(1)}>
          <span aria-hidden="true">{rtl ? "‹" : "›"}</span>
        </button>
      </div>
      <div ref={grid} role="grid" aria-label={`Months of ${yearLabel(locale, year)}`} className="calendar-month-grid" onKeyDown={onKeyDown}>
        {rows.map((row) => (
          <div role="row" className="calendar-month-row" key={row}>
            {[0, 1, 2].map((col) => {
              const month = row * 3 + col + 1;
              const record = { year, month };
              const available = monthInBounds(record, bounds);
              const isSelected = selected !== null && compareMonths(selected, record) === 0;
              const isCurrent = compareMonths(current, record) === 0;
              const tabbable = focus !== null && compareMonths(focus, record) === 0;
              return (
                <div role="gridcell" aria-selected={isSelected} key={month}>
                  <button
                    type="button"
                    className={["calendar-month", isSelected ? "is-selected" : "", isCurrent ? "is-today" : ""].filter(Boolean).join(" ")}
                    data-month={`${year}-${month}`}
                    tabIndex={tabbable ? 0 : -1}
                    disabled={!available}
                    aria-current={isCurrent ? "date" : undefined}
                    aria-label={`${names[month - 1].long} ${yearLabel(locale, year)}`}
                    onClick={() => onPick(record)}
                  >
                    {names[month - 1].short}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="calendar-footer">
        {onBack && (
          <button type="button" className="calendar-action" onClick={onBack}>
            Back to days
          </button>
        )}
        {footer}
      </div>
    </div>
  );
}
