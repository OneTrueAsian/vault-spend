import { formatAmount } from "../lib/format";
import "./ChartPieces.css";
import { useChartDetails } from "./useChartDetails";
import { ChartDetailTrack } from "./ChartDetailTrack";

export type Segment = { label: string; amount: number; /** A theme variable, e.g. "var(--cat-1)". */ color: string };
export type SegmentRow = { label?: string; segments: Segment[] };

const pct = (value: number, scale: number) => `${scale > 0 ? (Math.max(value, 0) / scale) * 100 : 0}%`;
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

/** One or more labelled bars on one shared scale (Accounts "What you own and owe", Investments "What
 * your investments are in"). The picture is named by `caption` and carries no amounts in any
 * attribute; a visually hidden table gives the exact figures. Optional details enable hover/focus and
 * click-to-pin on each segment. Nothing is written inside the segments: each
 * page's key under the bar names every part with its figure (owner, UAT of VS-31 step 3). A zero or negative segment (an
 * overpaid card) gets no width but keeps its real figure in the row total and the table. */
export function SegmentBar({
  rows,
  caption,
  emptyText = "Nothing to show yet.",
  format = formatAmount,
  details = false,
}: {
  rows: SegmentRow[];
  /** Names the picture (its aria-label) and the hidden table. Never put an amount in it: hiding amounts masks
   * text, not attributes. */
  caption: string;
  emptyText?: string;
  format?: (amount: number) => string;
  /** Opt in where the page requests hover and click details (Investments allocation). */
  details?: boolean;
}) {
  const chartDetails = useChartDetails(rows, format);
  const scale = Math.max(0, ...rows.map((r) => sum(r.segments.map((s) => Math.max(s.amount, 0)))));
  // Empty only when there is truly nothing: an overpaid card (a negative figure) still shows its row and total.
  if (rows.every((r) => r.segments.every((s) => s.amount === 0))) return <p className="empty-state">{emptyText}</p>;

  return (
    <div className="segment-bar-wrap">
      <div className="segment-bar" role={details ? "group" : "img"} aria-label={caption}>
        {rows.map((r, ri) => (
          <div key={ri} className="segment-bar-row">
            {r.label !== undefined && <span className="segment-bar-label">{r.label}</span>}
            {details ? <ChartDetailTrack className="segment-bar-track" controller={chartDetails}
              points={r.segments.map((s, si) => ({ key: `${ri}-${si}`, className: "segment-bar-seg",
                style: { width: pct(s.amount, scale), background: s.color },
                detail: { title: r.label ? `${r.label} · ${s.label}` : s.label,
                  entries: [{ label: s.label, amount: s.amount }], total: sum(r.segments.map(item => item.amount)), totalLabel: "Portfolio total" },
              }))} /> : <div className="segment-bar-track">
              {r.segments.map((s, si) => <div key={si} className="segment-bar-seg" style={{ width: pct(s.amount, scale), background: s.color }} />)}
            </div>}
            <span className="segment-bar-total">{format(sum(r.segments.map((s) => s.amount)))}</span>
          </div>
        ))}
      </div>
      {chartDetails.popover}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th>Group</th>
              <th>Part</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r, ri) => [
              ...r.segments.map((s, si) => (
                <tr key={`${ri}-${si}`}>
                  <td>{r.label ?? ""}</td>
                  <td>{s.label}</td>
                  <td>{format(s.amount)}</td>
                </tr>
              )),
              <tr key={`${ri}-total`}>
                <td>{r.label ?? ""}</td>
                <td>Total</td>
                <td>{format(sum(r.segments.map((s) => s.amount)))}</td>
              </tr>,
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}
