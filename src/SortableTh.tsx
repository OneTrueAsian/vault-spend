import type { ReactNode } from "react";

/** A table column heading that sorts its table. The whole cell still sorts when clicked, but the
 * label is a real button, so the keyboard can reach it (Tab) and operate it (Enter / Space arrive as
 * a click, which bubbles to the cell), and the sorted column says which way it is sorted
 * (`aria-sort`) so a screen reader can tell. The arrow is for the eye only. */
export function SortableTh<C extends string>({
  column,
  activeColumn,
  direction,
  onSort,
  className,
  children,
}: {
  column: C;
  activeColumn: C;
  direction: "asc" | "desc";
  onSort: (column: C) => void;
  className?: string;
  children: ReactNode;
}) {
  const active = column === activeColumn;
  return (
    <th
      className={className ? `${className} sortable-col` : "sortable-col"}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}
      onClick={() => onSort(column)}
    >
      <button type="button" className="sort-button">
        {children}
        {active && <span aria-hidden="true">{direction === "asc" ? " ▲" : " ▼"}</span>}
      </button>
    </th>
  );
}
