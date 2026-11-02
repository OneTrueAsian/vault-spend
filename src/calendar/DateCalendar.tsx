import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  addDays, addMonths, addYears, clampDate, compareDates, dateInBounds, endOfWeek, formatIso, startOfWeek,
  type DateBounds, type DateRecord, type MonthBounds, type MonthRecord,
} from "./calendarDate";
import { firstDayOfWeek, fullDateLabel, monthYearLabel, textDirection, weekdayLabels, yearLabel } from "./calendarLocale";
import { MonthCalendar } from "./MonthCalendar";

/** The six-week day calendar. Arrow keys, Home/End, PageUp/PageDown and Shift+PageUp/PageDown only move
 * focus and the month shown; a date is chosen by Enter, Space or a click, never by moving. The heading
 * switches the same popup to a month-and-year grid, and picking a month there only changes the month
 * browsed. */
export function DateCalendar({
  locale,
  bounds,
  selected,
  start,
  today,
  labelId,
  optional,
  onSelect,
  onClear,
}: {
  locale: string;
  bounds: DateBounds;
  selected: DateRecord | null;
  /** Where focus lands when the calendar opens; null when no date can be chosen. */
  start: DateRecord | null;
  today: DateRecord;
  labelId: string;
  optional: boolean;
  onSelect: (date: DateRecord) => void;
  onClear: () => void;
}) {
  const rtl = textDirection(locale) === "rtl";
  const firstDay = firstDayOfWeek(locale);
  const weekdays = weekdayLabels(locale, firstDay);
  const [focus, setFocus] = useState<DateRecord | null>(start);
  const [page, setPage] = useState<MonthRecord>(() => ({ year: (start ?? today).year, month: (start ?? today).month }));
  const [view, setView] = useState<"days" | "months">("days");
  const grid = useRef<HTMLTableElement>(null);
  const wantsFocus = useRef(true);

  // Focus follows the keyboard: after a move, the cell for the focused date takes focus (and on opening).
  useEffect(() => {
    if (view !== "days" || !wantsFocus.current) return;
    wantsFocus.current = false;
    if (focus) grid.current?.querySelector<HTMLButtonElement>(`[data-date="${formatIso(focus)}"]`)?.focus();
  });

  const monthBounds: MonthBounds = bounds.empty
    ? { min: { year: 1900, month: 1 }, max: { year: 2100, month: 12 }, empty: true }
    : { min: { year: bounds.min.year, month: bounds.min.month }, max: { year: bounds.max.year, month: bounds.max.month }, empty: false };
  const pageIndex = page.year * 12 + page.month - 1;
  const canGo = (delta: number) => {
    if (bounds.empty) return false;
    const index = pageIndex + delta;
    return index >= monthBounds.min.year * 12 + monthBounds.min.month - 1 && index <= monthBounds.max.year * 12 + monthBounds.max.month - 1;
  };
  const showPage = (delta: number) => {
    const next = addMonths({ ...page, day: 1 }, delta);
    setPage({ year: next.year, month: next.month });
    // Keep a focusable cell inside the page that is showing.
    const target = clampDate(addMonths(focus ?? { ...page, day: 1 }, delta), bounds);
    if (target) setFocus(target);
  };

  function moveTo(target: DateRecord) {
    const next = clampDate(target, bounds);
    if (!next) return;
    wantsFocus.current = true;
    setFocus(next);
    setPage({ year: next.year, month: next.month });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!focus || bounds.empty) return;
    const horizontal = rtl ? -1 : 1;
    switch (e.key) {
      case "ArrowRight": moveTo(addDays(focus, horizontal)); break;
      case "ArrowLeft": moveTo(addDays(focus, -horizontal)); break;
      case "ArrowDown": moveTo(addDays(focus, 7)); break;
      case "ArrowUp": moveTo(addDays(focus, -7)); break;
      case "Home": moveTo(startOfWeek(focus, firstDay)); break;
      case "End": moveTo(endOfWeek(focus, firstDay)); break;
      case "PageUp": moveTo(e.shiftKey ? addYears(focus, -1) : addMonths(focus, -1)); break;
      case "PageDown": moveTo(e.shiftKey ? addYears(focus, 1) : addMonths(focus, 1)); break;
      default: return;
    }
    e.preventDefault();
  }

  const first = startOfWeek({ ...page, day: 1 }, firstDay);
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
  const todayAvailable = dateInBounds(today, bounds);
  const heading = monthYearLabel(locale, page);

  if (view === "months") {
    return (
      <MonthCalendar
        locale={locale}
        bounds={monthBounds}
        selected={null}
        start={{ year: page.year, month: page.month }}
        current={{ year: today.year, month: today.month }}
        labelId={labelId}
        onPick={(month) => {
          setPage(month);
          const target = clampDate({ year: month.year, month: month.month, day: Math.min(focus?.day ?? 1, 28) }, bounds);
          if (target) setFocus(target);
          wantsFocus.current = true;
          setView("days");
        }}
        onBack={() => {
          wantsFocus.current = true;
          setView("days");
        }}
      />
    );
  }

  return (
    <div className="calendar-body calendar-days">
      <div className="calendar-header">
        <button type="button" className="calendar-nav" aria-label="Previous month" disabled={!canGo(-1)} onClick={() => showPage(-1)}>
          <span aria-hidden="true">{rtl ? "›" : "‹"}</span>
        </button>
        <h2 id={labelId} className="calendar-heading" aria-live="polite">
          <button type="button" className="calendar-jump" aria-label={`${heading}, choose month and year`} disabled={bounds.empty} onClick={() => setView("months")}>
            {heading} <span aria-hidden="true" className="calendar-caret">▾</span>
          </button>
        </h2>
        <button type="button" className="calendar-nav" aria-label="Next month" disabled={!canGo(1)} onClick={() => showPage(1)}>
          <span aria-hidden="true">{rtl ? "‹" : "›"}</span>
        </button>
      </div>
      <table ref={grid} role="grid" aria-labelledby={labelId} className="calendar-grid" onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {weekdays.map((w) => (
              <th key={w.index} scope="col" abbr={w.long}>
                <span aria-hidden="true">{w.short}</span>
                <span className="calendar-sr">{w.long}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={formatIso(week[0])}>
              {week.map((day) => {
                const iso = formatIso(day);
                const available = dateInBounds(day, bounds);
                const isSelected = selected !== null && compareDates(selected, day) === 0;
                const isToday = compareDates(today, day) === 0;
                const outside = day.month !== page.month;
                const tabbable = focus !== null && compareDates(focus, day) === 0;
                return (
                  <td key={iso} role="gridcell" aria-selected={isSelected} aria-disabled={!available || undefined}>
                    <button
                      type="button"
                      className={["calendar-day", isSelected ? "is-selected" : "", isToday ? "is-today" : "", outside ? "is-outside" : "", available ? "" : "is-unavailable"].filter(Boolean).join(" ")}
                      data-date={iso}
                      tabIndex={tabbable ? 0 : -1}
                      disabled={!available}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={fullDateLabel(locale, day)}
                      onClick={() => onSelect(day)}
                    >
                      {yearLabel(locale, day.day)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="calendar-footer">
        {optional ? (
          <button type="button" className="calendar-action" onClick={onClear}>
            Clear
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="calendar-action" disabled={!todayAvailable} onClick={() => onSelect(today)}>
          Today
        </button>
      </div>
    </div>
  );
}
