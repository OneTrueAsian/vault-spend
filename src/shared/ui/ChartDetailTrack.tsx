import { useState, type CSSProperties, type PointerEvent } from "react";
import { type ChartDetail, type useChartDetails } from "./useChartDetails";

export type ChartPoint = { key: string; className: string; style: CSSProperties; detail: ChartDetail };

/** One full-size control per bar. The colored marks keep their exact proportional widths; tiny
 * values never become tiny buttons or get widened to satisfy a hit-target minimum. Pointer events
 * select the mark underneath, while keyboard users explore every mark with Left/Right or Home/End. */
export function ChartDetailTrack({ className, points, controller }: {
  className: string;
  points: ChartPoint[];
  controller: ReturnType<typeof useChartDetails>;
}) {
  const [index, setIndex] = useState(0);
  if (points.length === 0) return <div className={className} />;
  const current = Math.min(index, points.length - 1);
  const point = points[current];
  function indexAt(target: EventTarget | null) {
    const value = target instanceof Element ? target.closest<HTMLElement>("[data-chart-point]")?.dataset.chartPoint : undefined;
    return value !== undefined && points[Number(value)] ? Number(value) : current;
  }
  function mark(button: HTMLButtonElement, i: number) {
    return button.querySelector<HTMLElement>(`[data-chart-point="${i}"]`) ?? undefined;
  }
  function hover(e: PointerEvent<HTMLButtonElement>) {
    if (controller.pinned) return;
    const i = indexAt(e.target);
    setIndex(i);
    controller.pointerPreview(points[i].key, points[i].detail, e.currentTarget, Boolean(e.movementX || e.movementY), mark(e.currentTarget, i));
  }
  return <button className={`${className} chart-details-track`}
    {...controller.targetProps(point.key, point.detail)}
    aria-keyshortcuts="ArrowLeft ArrowRight Home End"
    aria-description="Use Left and Right arrow keys to explore sections, then Enter to pin details."
    onPointerEnter={hover} onPointerMove={hover}
    onClick={e => {
      const i = indexAt(e.target);
      setIndex(i);
      controller.toggle(points[i].key, points[i].detail, e.currentTarget, mark(e.currentTarget, i));
    }}
    onKeyDown={e => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const i = e.key === "Home" ? 0 : e.key === "End" ? points.length - 1 : (current + (e.key === "ArrowLeft" ? -1 : 1) + points.length) % points.length;
      setIndex(i);
      controller.explore(points[i].key, points[i].detail, e.currentTarget, mark(e.currentTarget, i));
    }}>
    {points.map((p, i) => <span key={p.key} className={`${p.className} chart-details-point`} data-chart-point={i}
      data-active={controller.activeKey === p.key} aria-hidden="true" style={p.style} />)}
  </button>;
}
