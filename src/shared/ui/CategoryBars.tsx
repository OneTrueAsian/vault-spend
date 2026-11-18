import type { ReactNode } from "react";
import { formatAmount } from "../lib/format";
import "./ChartPieces.css";

export type CategoryBarRow = {
  key: string;
  label: string;
  icon?: ReactNode;
  amount: number;
  /** With a plan, the row reads "$amount of $plan", the outline marks the plan, and spending past it
   * is drawn in its own warning style. */
  plan?: number;
  /** A CSS color (a theme variable) for the fill; the accent color when left out. */
  color?: string;
  note?: ReactNode;
  noteTone?: "bad" | "warn" | "good";
};

const pct = (value: number, scale: number) => `${scale > 0 ? (Math.max(value, 0) / scale) * 100 : 0}%`;

/** Category rows on one shared dollar scale (Dashboard "Spending in <month> so far", Budget "Spending
 * against the plan"). It is a real table: the name, amount and note cells are what screen readers
 * read, and the bar cell is hidden from them. Amounts only ever appear as text, so hiding amounts
 * covers them. A negative amount (a category that is all refunds) gets no bar but keeps its figure. */
export function CategoryBars({
  rows,
  caption,
  emptyText = "Nothing to show yet.",
  onSelect,
  format = formatAmount,
}: {
  rows: CategoryBarRow[];
  /** Names the table for screen readers. */
  caption: string;
  emptyText?: string;
  /** When given, each name is a button that calls this with the row's key. */
  onSelect?: (key: string) => void;
  format?: (amount: number) => string;
}) {
  if (rows.length === 0) return <p className="empty-state">{emptyText}</p>;

  const scale = Math.max(0, ...rows.map((r) => Math.max(r.amount, r.plan ?? 0)));

  return (
    <table className="category-bars">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map((r) => {
          const hasPlan = r.plan !== undefined;
          const plan = Math.max(r.plan ?? 0, 0);
          const filled = hasPlan ? Math.min(r.amount, plan) : r.amount;
          const over = hasPlan ? r.amount - plan : 0;
          const name = (
            <>
              {r.icon && <span className="category-bars-icon">{r.icon}</span>}
              {r.label}
            </>
          );
          return (
            <tr key={r.key}>
              <th scope="row" className="category-bars-name">
                {onSelect ? (
                  <button type="button" className="category-bars-select" onClick={() => onSelect(r.key)}>
                    {name}
                  </button>
                ) : (
                  name
                )}
              </th>
              <td className="category-bars-bar" aria-hidden="true">
                <div className="category-bars-track">
                  {hasPlan && <div className="category-bars-plan" style={{ width: pct(plan, scale) }} />}
                  <div className="category-bars-fill" style={{ width: pct(filled, scale), background: r.color }} />
                  {over > 0 && <div className="category-bars-over" style={{ left: pct(plan, scale), width: pct(over, scale) }} />}
                </div>
              </td>
              <td className="category-bars-amount">
                {hasPlan ? `${format(r.amount)} of ${format(r.plan ?? 0)}` : format(r.amount)}
              </td>
              <td className="category-bars-note-cell">
                {r.note !== undefined && (
                  <span className={r.noteTone ? `category-bars-note category-bars-note-${r.noteTone}` : "category-bars-note"}>{r.note}</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
