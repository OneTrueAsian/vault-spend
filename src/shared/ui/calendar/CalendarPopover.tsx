import { forwardRef, type ReactNode } from "react";
import "./CalendarPicker.css";

/** The non-modal dialog that holds a calendar. It is raised by the browser's popover layer (see
 * useCalendarPopover) but stays inside its field, so an enclosing dialog or filter panel contains it. A
 * press on its empty space must not take focus away from the field's controls, and must not activate a
 * label the field sits in, so both are cancelled here (typing into the year box is the exception). */
export const CalendarPopover = forwardRef<HTMLDivElement, {
  id: string;
  labelId: string;
  helpId: string;
  dir: "ltr" | "rtl";
  kind: "date" | "month";
  help: string;
  children: ReactNode;
}>(function CalendarPopover({ id, labelId, helpId, dir, kind, help, children }, ref) {
  return (
    <div
      ref={ref}
      id={id}
      className={`calendar-popover calendar-popover-${kind}`}
      role="dialog"
      aria-labelledby={labelId}
      aria-describedby={helpId}
      dir={dir}
      tabIndex={-1}
      popover="manual"
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
    >
      {children}
      <p id={helpId} className="calendar-help">{help}</p>
    </div>
  );
});
