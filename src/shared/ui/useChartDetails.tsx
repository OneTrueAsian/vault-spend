import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { formatAmount } from "../lib/format";
import { PRIVACY_MASK } from "../lib/privacy";
import "./ChartDetails.css";

export type ChartDetail = {
  title: string;
  entries: { label: string; amount: number }[];
  sectionTotal?: number;
  total: number;
  totalLabel: string;
};
type Selection = { key: string; detail: ChartDetail; anchor: HTMLButtonElement; positionAnchor?: HTMLElement; pinned: boolean };

/** Amounts are rendered as text only. Every target gets a real button, leaving the complete data
 * table available separately. One popover per chart avoids hundreds of hidden tooltip nodes. */
export function useChartDetails(data: unknown, format: (amount: number) => string = formatAmount) {
  const id = useId();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const panel = useRef<HTMLDivElement>(null);
  const suppressPointerPreview = useRef(false);

  useEffect(() => { setSelection(null); }, [data]);
  useEffect(() => {
    const onPrivacy = new MutationObserver(() => setSelection(null));
    onPrivacy.observe(document.documentElement, { attributes: true, attributeFilter: ["data-privacy"] });
    return () => onPrivacy.disconnect();
  }, []);

  useEffect(() => {
    if (!selection) return;
    const dismissOutside = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !selection.anchor.contains(e.target as Node)) {
        suppressPointerPreview.current = true;
        setSelection(null);
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        suppressPointerPreview.current = true;
        // Focus before dismissing: focus can open a preview again.
        selection.anchor.focus();
        setSelection(null);
      }
    };
    const scroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) {
        suppressPointerPreview.current = true;
        setSelection(null);
      }
    };
    const resize = () => { suppressPointerPreview.current = true; setSelection(null); };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", escape);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [selection]);

  useLayoutEffect(() => {
    if (!selection || !panel.current) return;
    const anchor = (selection.positionAnchor ?? selection.anchor).getBoundingClientRect();
    const box = panel.current.getBoundingClientRect();
    setPosition({
      left: Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12)),
      top: Math.max(12, anchor.bottom + box.height + 10 < window.innerHeight ? anchor.bottom + 10 : anchor.top - box.height - 10),
    });
  }, [selection]);

  function preview(key: string, detail: ChartDetail, anchor: HTMLButtonElement, positionAnchor?: HTMLElement) {
    setSelection(current => current?.pinned || current?.key === key ? current : { key, detail, anchor, positionAnchor, pinned: false });
  }
  function pointerPreview(key: string, detail: ChartDetail, anchor: HTMLButtonElement, moved: boolean, positionAnchor?: HTMLElement) {
    if (moved) suppressPointerPreview.current = false;
    if (!suppressPointerPreview.current) preview(key, detail, anchor, positionAnchor);
  }
  function toggle(key: string, detail: ChartDetail, anchor: HTMLButtonElement, positionAnchor?: HTMLElement) {
    suppressPointerPreview.current = false;
    setSelection(current => current?.key === key && current.pinned ? null : { key, detail, anchor, positionAnchor, pinned: true });
  }
  function explore(key: string, detail: ChartDetail, anchor: HTMLButtonElement, positionAnchor?: HTMLElement) {
    setSelection(current => ({ key, detail, anchor, positionAnchor, pinned: current?.pinned ?? false }));
  }
  function targetProps(key: string, detail: ChartDetail): ButtonHTMLAttributes<HTMLButtonElement> {
    const leave = () => setSelection(current => current?.key === key && !current.pinned ? null : current);
    return {
      type: "button",
      "aria-label": `${detail.title} details`,
      "aria-pressed": selection?.key === key && selection.pinned,
      "aria-describedby": selection?.key === key ? id : undefined,
      onPointerEnter: e => pointerPreview(key, detail, e.currentTarget, false),
      onPointerMove: e => {
        // Removing the popup can synthesize pointerenter for the segment underneath it. Wait for
        // an actual movement before showing another pointer preview; keyboard focus remains usable.
        if (suppressPointerPreview.current && (e.movementX || e.movementY)) {
          suppressPointerPreview.current = false;
          preview(key, detail, e.currentTarget);
        }
      },
      onPointerLeave: leave,
      onFocus: e => preview(key, detail, e.currentTarget),
      onBlur: leave,
      onClick: e => {
        toggle(key, detail, e.currentTarget);
      },
    };
  }

  const amount = (value: number) => document.documentElement.dataset.privacy === "on" ? PRIVACY_MASK : format(value);
  const popover = selection && createPortal(
    <div ref={panel} id={id} className="chart-details" role={selection.pinned ? "dialog" : "tooltip"}
      aria-label={selection.pinned ? selection.detail.title : undefined} data-pinned={selection.pinned}
      style={position}>
      <h3>{selection.detail.title}</h3>
      {selection.pinned && <button type="button" className="chart-details-close" aria-label="Close chart details" onClick={() => {
        suppressPointerPreview.current = true;
        selection.anchor.focus();
        setSelection(null);
      }}>×</button>}
      <ul>{selection.detail.entries.map((entry, i) => <li key={i}><span>{entry.label}</span><strong>{amount(entry.amount)}</strong></li>)}</ul>
      {selection.detail.sectionTotal !== undefined && <p>Section total: {amount(selection.detail.sectionTotal)}</p>}
      <p>{selection.detail.totalLabel}: {amount(selection.detail.total)}</p>
      <small>{selection.pinned ? "Pinned · Escape or click outside to close" : "Click or press Enter to pin"}. Left/Right explores sections.</small>
    </div>, document.body,
  );
  return { targetProps, pointerPreview, toggle, explore, activeKey: selection?.key, pinned: selection?.pinned ?? false, popover };
}
