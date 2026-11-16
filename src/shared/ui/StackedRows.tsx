import { formatAmount } from "../lib/format";
import { CATEGORY_COLORS } from "./categoryPalette";
import "./ChartPieces.css";

export type StackedRow = { label: string; segments: { category: string; amount: number }[]; /** e.g. what came in or was earned */ tick?: number };

export const EVERYTHING_ELSE = "Everything else";
const EVERYTHING_ELSE_COLOR = "var(--text-faint)";
/** One fewer than the palette, so "Everything else" never shares a category's color. */
const MAX_NAMED = CATEGORY_COLORS.length - 1;

const pct = (value: number, scale: number) => `${scale > 0 ? (Math.max(value, 0) / scale) * 100 : 0}%`;
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

/** Rows of stacked category segments on one shared scale, each with an optional tick (Cash Flow "Six
 * months at a glance", Household "Spending by person"). Categories are colored by their total across
 * all rows, so a category keeps its color from row to row. Up to six categories each get a palette
 * color; with more, the largest five keep theirs and the rest are drawn as one "Everything else". The picture carries no amounts in any attribute; a visually hidden
 * table gives every category's exact figure. */
export function StackedRows({
  rows,
  caption,
  tickLabel,
  emptyText = "Nothing to show yet.",
  format = formatAmount,
}: {
  rows: StackedRow[];
  /** Names the picture (its aria-label) and the hidden table. Never put an amount in it: hiding amounts masks
   * text, not attributes. */
  caption: string;
  /** What the tick means, e.g. "What came in". Shown in the legend and the table. */
  tickLabel: string;
  emptyText?: string;
  format?: (amount: number) => string;
}) {
  const totals = new Map<string, number>();
  for (const r of rows) for (const s of r.segments) totals.set(s.category, (totals.get(s.category) ?? 0) + Math.max(s.amount, 0));
  // Only categories with something to draw take a color; a refund-only or zero category would waste a slot.
  const ranked = [...totals].filter(([, t]) => t > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const named = ranked.slice(0, ranked.length > MAX_NAMED + 1 ? MAX_NAMED : ranked.length);
  const folds = named.length < ranked.length;
  const color = (category: string) => (named.includes(category) ? CATEGORY_COLORS[named.indexOf(category)] : EVERYTHING_ELSE_COLOR);

  const drawn = rows.map((r) => {
    const kept = r.segments.filter((s) => named.includes(s.category));
    const rest = r.segments.filter((s) => !named.includes(s.category) && ranked.includes(s.category));
    return rest.length > 0 ? [...kept, { category: EVERYTHING_ELSE, amount: sum(rest.map((s) => Math.max(s.amount, 0))) }] : kept;
  });
  const scale = Math.max(0, ...rows.map((r, i) => Math.max(sum(drawn[i].map((s) => Math.max(s.amount, 0))), r.tick ?? 0)));
  // Empty only when there is truly nothing: a month of refunds alone still shows its row and total.
  if (rows.every((r) => !r.tick && r.segments.every((s) => s.amount === 0))) return <p className="empty-state">{emptyText}</p>;
  const hasTick = rows.some((r) => r.tick !== undefined);

  return (
    <div className="stacked-rows-wrap">
      <div className="stacked-rows" role="img" aria-label={caption}>
        {rows.map((r, ri) => (
          <div key={ri} className="stacked-rows-row">
            <span className="stacked-rows-label">{r.label}</span>
            <div className="stacked-rows-track">
              {drawn[ri].map((s, si) => (
                <div key={si} className="stacked-rows-seg" style={{ width: pct(s.amount, scale), background: color(s.category) }} />
              ))}
              {r.tick !== undefined && <div className="stacked-rows-tick" style={{ left: pct(r.tick, scale) }} />}
            </div>
            <span className="stacked-rows-total">{format(sum(r.segments.map((s) => s.amount)))}</span>
          </div>
        ))}
        <ul className="stacked-rows-legend">
          {named.map((c) => (
            <li key={c}>
              <span className="stacked-rows-swatch" style={{ background: color(c) }} />
              {c}
            </li>
          ))}
          {folds && (
            <li>
              <span className="stacked-rows-swatch" style={{ background: EVERYTHING_ELSE_COLOR }} />
              {EVERYTHING_ELSE}
            </li>
          )}
          {hasTick && (
            <li>
              <span className="stacked-rows-swatch stacked-rows-swatch-tick" />
              {tickLabel}
            </li>
          )}
        </ul>
      </div>
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th>Row</th>
              <th>Category</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r, ri) => [
              ...r.segments.map((s, si) => (
                <tr key={`${ri}-${si}`}>
                  <td>{r.label}</td>
                  <td>{s.category}</td>
                  <td>{format(s.amount)}</td>
                </tr>
              )),
              <tr key={`${ri}-total`}>
                <td>{r.label}</td>
                <td>Total</td>
                <td>{format(sum(r.segments.map((s) => s.amount)))}</td>
              </tr>,
              ...(r.tick !== undefined
                ? [
                    <tr key={`${ri}-tick`}>
                      <td>{r.label}</td>
                      <td>{tickLabel}</td>
                      <td>{format(r.tick)}</td>
                    </tr>,
                  ]
                : []),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}
