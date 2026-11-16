import { useLayoutEffect, useRef, useState } from "react";
import { formatAmount } from "../lib/format";
import "./ChartPieces.css";

/** As in v9, a segment carries its name inside the bar only from this share of its row; the page's key names the rest. */
const MIN_LABEL_SHARE = 0.15;

export type Segment = { label: string; amount: number; /** A theme variable, e.g. "var(--cat-1)". */ color: string };
export type SegmentRow = { label?: string; segments: Segment[] };

const pct = (value: number, scale: number) => `${scale > 0 ? (Math.max(value, 0) / scale) * 100 : 0}%`;
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

/** One or more labelled bars on one shared scale (Accounts "What you own and owe", Investments "What
 * your investments are in"). The picture is named by `caption` and carries no amounts in any
 * attribute; a visually hidden table gives the exact figures. A zero or negative segment (an
 * overpaid card) gets no width but keeps its real figure in the row total and the table. */
export function SegmentBar({
  rows,
  caption,
  emptyText = "Nothing to show yet.",
  format = formatAmount,
}: {
  rows: SegmentRow[];
  /** Names the picture (its aria-label) and the hidden table. Never put an amount in it: hiding amounts masks
   * text, not attributes. */
  caption: string;
  emptyText?: string;
  format?: (amount: number) => string;
}) {
  const scale = Math.max(0, ...rows.map((r) => sum(r.segments.map((s) => Math.max(s.amount, 0)))));
  // A label too long for its segment is hidden whole, never cut short ("International stoc"); measured after
  // layout and again whenever the bar is resized.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cutShort, setCutShort] = useState("");
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const tags = [...wrap.querySelectorAll<HTMLElement>(".segment-bar-seg-text")];
      const cut = tags.filter((t) => t.scrollWidth > t.clientWidth + 1).map((t) => t.dataset.seg).join(" ");
      setCutShort((previous) => (previous === cut ? previous : cut));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  });
  const isCut = (key: string) => cutShort.split(" ").includes(key);
  // Empty only when there is truly nothing: an overpaid card (a negative figure) still shows its row and total.
  if (rows.every((r) => r.segments.every((s) => s.amount === 0))) return <p className="empty-state">{emptyText}</p>;

  return (
    <div className="segment-bar-wrap" ref={wrapRef}>
      <div className="segment-bar" role="img" aria-label={caption}>
        {rows.map((r, ri) => {
          const rowWhole = sum(r.segments.map((s) => Math.max(s.amount, 0)));
          return (
            <div key={ri} className="segment-bar-row">
              {r.label !== undefined && <span className="segment-bar-label">{r.label}</span>}
              <div className="segment-bar-track">
                {r.segments.map((s, si) => (
                  <div key={si} className="segment-bar-seg" style={{ width: pct(s.amount, scale), background: s.color }}>
                    {rowWhole > 0 && s.amount / rowWhole >= MIN_LABEL_SHARE && (
                      <span className={`segment-bar-seg-text${isCut(`${ri}-${si}`) ? " is-cut" : ""}`} data-seg={`${ri}-${si}`}>
                        <span className="segment-bar-seg-name">{s.label}</span>
                        <span className="segment-bar-seg-amount">{format(s.amount)}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <span className="segment-bar-total">{format(sum(r.segments.map((s) => s.amount)))}</span>
            </div>
          );
        })}
      </div>
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
