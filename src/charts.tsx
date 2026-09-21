/** Small hand-rolled inline-SVG chart components — no charting library,
 * same technique as the Monarch-styled mockup this was adapted from. */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

export function fmtMoneyShort(n: number): string {
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1000000) s = (abs / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  else if (abs >= 1000) s = (abs / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  else s = abs.toFixed(0);
  return (n < 0 ? "-" : "") + "$" + s;
}

export function ProgressRing({
  pct,
  size = 64,
  stroke = 7,
  color = "var(--accent)",
}: {
  pct: number;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(1, Math.max(0, pct / 100)) * circ;
  return (
    <div className="goal-ring-wrap" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </svg>
      <div className="goal-ring-label">
        <div className="goal-ring-pct">{Math.round(pct)}%</div>
      </div>
    </div>
  );
}

export function DonutChart({
  data,
  size = 132,
  stroke = 22,
  center,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  stroke?: number;
  /** Optional total shown in the donut's hole, e.g. `{ value: "$1,510", label: "this month" }`. */
  center?: { value: string; label: string };
}) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const circ = 2 * Math.PI * r;
  let angle = -90;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {data.map((d, i) => {
          const frac = d.value / total;
          const dash = frac * circ;
          const rotate = angle;
          angle += frac * 360;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circ - dash}`}
              transform={`rotate(${rotate} ${cx} ${cy})`}
            />
          );
        })}
      </svg>
      {center && (
        <div className="donut-hole">
          <span className="donut-hole-amt">{center.value}</span>
          <span className="donut-hole-lbl">{center.label}</span>
        </div>
      )}
    </div>
  );
}

/** A minimal per-stat trend indicator — no axes/labels/tooltip, just the
 * line, matching the small "stat-spark" glyphs in the design mockup this
 * was adapted from. */
export function Sparkline({
  points,
  width = 52,
  height = 26,
  color = "var(--accent)",
  title,
  fluid = false,
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
  /** A one-line description of what the trend shows (e.g. "Up 3 months in
   * a row, from $80 to $140"). WCAG 1.1.1 requires every non-text graphic
   * to either be marked decorative or given a text alternative — pass this
   * when the *shape* of the trend is information the surrounding numbers
   * don't already say out loud (a lone total doesn't tell you it's the
   * third month in a row of creeping up). Omit it when a sibling element
   * already states the trend in words (the Dashboard's stat cards render
   * their own "▲ $X over Nmo" line right next to the chart) — the SVG is
   * then marked `aria-hidden` instead, since a screen reader saying the
   * same thing twice is worse than not saying it at all. */
  title?: string;
  /** Render at 100% of the container's width via CSS instead of the fixed
   * pixel `width` below — for a full-width sparkline strip (Dashboard's
   * hero stat cards) rather than a small inline one next to a value.
   * `width` still sets the internal coordinate space the points are
   * plotted against, so pass a wider logical value (e.g. 160) alongside
   * `fluid` for a gently-sloped line rather than a narrow one stretched
   * flat. */
  fluid?: boolean;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 3;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const x = (i: number) => pad + (innerW * i) / (points.length - 1);
  const y = (v: number) => pad + innerH - ((v - min) / span) * innerH;
  const linePts = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg
      className={fluid ? "stat-spark stat-spark-fluid" : "stat-spark"}
      width={fluid ? "100%" : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? "none" : undefined}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <polyline points={linePts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BarChart({
  data,
  width = 560,
  height = 220,
  onBarClick,
}: {
  data: { label: string; values: { value: number; color: string; name?: string }[] }[];
  width?: number;
  height?: number;
  /** Called with a group's index when it's clicked — omit for a purely
   * informational chart (no click affordance shown). */
  onBarClick?: (index: number) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const padL = 46;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  let max = 0;
  data.forEach((d) => d.values.forEach((v) => { max = Math.max(max, Math.abs(v.value)); }));
  max = max === 0 ? 1 : max * 1.15;
  const groupW = innerW / (data.length || 1);
  const gridCount = 4;

  const hovered = hoveredIndex !== null ? data[hoveredIndex] : null;

  // tooltip geometry, computed only while something is hovered — kept in
  // the same SVG coordinate space as everything else so no pixel-to-
  // viewBox conversion is needed for a responsive (width: 100%) chart
  const tooltipPadding = 9;
  const tooltipLineH = 15;
  const tooltipW = 152;
  const tooltipH = hovered ? tooltipPadding * 2 + tooltipLineH * (hovered.values.length + 1) - 3 : 0;
  let tooltipX = 0;
  let tooltipY = 0;
  if (hovered && hoveredIndex !== null) {
    const groupCenterX = padL + groupW * hoveredIndex + groupW / 2;
    tooltipX = Math.min(Math.max(groupCenterX - tooltipW / 2, padL), width - padR - tooltipW);
    const maxBarH = Math.max(0, ...hovered.values.map((v) => (Math.abs(v.value) / max) * innerH));
    tooltipY = Math.max(padT + innerH - maxBarH - tooltipH - 10, 2);
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="xMidYMid meet">
      {Array.from({ length: gridCount + 1 }).map((_, i) => {
        const gy = padT + (innerH * i) / gridCount;
        const val = max - (max * i) / gridCount;
        return (
          <g key={i}>
            <line x1={padL} y1={gy} x2={width - padR} y2={gy} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 8} y={gy + 3} textAnchor="end" className="axis-label">
              {fmtMoneyShort(val)}
            </text>
          </g>
        );
      })}
      {data.map((d, gi) => {
        const n = d.values.length || 1;
        const barGap = 6;
        const barW = Math.min(26, (groupW - barGap * 2) / n);
        const totalBarsW = barW * n + (n - 1) * 2;
        const groupX = padL + groupW * gi + (groupW - totalBarsW) / 2;
        return (
          <g key={gi}>
            {gi === hoveredIndex && (
              <rect x={padL + groupW * gi} y={padT} width={groupW} height={innerH} fill="var(--surface-2)" />
            )}
            <rect
              x={padL + groupW * gi}
              y={padT}
              width={groupW}
              height={innerH}
              fill="transparent"
              style={{ cursor: onBarClick ? "pointer" : "default" }}
              onMouseEnter={() => setHoveredIndex(gi)}
              onMouseLeave={() => setHoveredIndex(null)}
              onClick={onBarClick ? () => onBarClick(gi) : undefined}
            />
            {d.values.map((v, vi) => {
              const bh = (Math.abs(v.value) / max) * innerH;
              const bx = groupX + vi * (barW + 2);
              const by = padT + innerH - bh;
              return (
                <rect
                  key={vi}
                  x={bx}
                  y={by}
                  width={barW}
                  height={bh}
                  rx={4}
                  fill={v.color}
                  style={{ pointerEvents: "none" }}
                />
              );
            })}
            <text x={padL + groupW * gi + groupW / 2} y={height - 6} textAnchor="middle" className="axis-label">
              {d.label}
            </text>
          </g>
        );
      })}
      {hovered && (
        <g style={{ pointerEvents: "none" }}>
          <rect
            x={tooltipX}
            y={tooltipY}
            width={tooltipW}
            height={tooltipH}
            rx={8}
            fill="var(--surface)"
            stroke="var(--border-strong)"
            strokeWidth={1}
          />
          <text x={tooltipX + tooltipPadding} y={tooltipY + tooltipPadding + 9} className="chart-tooltip-title">
            {hovered.label}
          </text>
          {hovered.values.map((v, vi) => (
            <g key={vi}>
              <circle
                cx={tooltipX + tooltipPadding + 4}
                cy={tooltipY + tooltipPadding + tooltipLineH * (vi + 1) + 5}
                r={4}
                fill={v.color}
              />
              <text
                x={tooltipX + tooltipPadding + 14}
                y={tooltipY + tooltipPadding + tooltipLineH * (vi + 1) + 9}
                className="chart-tooltip-text"
              >
                {(v.name ? v.name + ": " : "") + fmtMoneyShort(v.value)}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

export function LineChart({
  points,
  width = 560,
  height = 200,
  color = "var(--accent)",
  formatValue = fmtMoneyShort,
  maxLabels,
}: {
  points: { label: string; value: number }[];
  width?: number;
  height?: number;
  color?: string;
  /** Draw at most about this many x-axis labels (evenly spaced) — for a series
   * with too many points to label every one. Hovering still names any point. */
  maxLabels?: number;
  /** Axis/tooltip value formatter — defaults to money since every point on
   * this chart has been a dollar amount so far, but a non-currency trend
   * (e.g. a percentage) needs its own. */
  formatValue?: (v: number) => string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const padL = 46;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const minPad = min - span * 0.12;
  const maxPad = max + span * 0.12;
  const spanPad = maxPad - minPad || 1;
  const x = (i: number) => padL + (points.length === 1 ? innerW / 2 : (innerW * i) / (points.length - 1));
  const y = (v: number) => padT + innerH - ((v - minPad) / spanPad) * innerH;
  const linePts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const areaPts = `${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} ${linePts} ${x(points.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)}`;
  const gridCount = 4;
  const lastX = x(points.length - 1);
  const lastY = y(points[points.length - 1]?.value ?? 0);
  const gradId = "grad-" + Math.random().toString(36).slice(2, 8);

  const bandW = innerW / (points.length || 1);
  const hovered = hoveredIndex !== null ? points[hoveredIndex] : null;

  // tooltip geometry, same viewBox coordinate space as everything else —
  // no pixel conversion needed for a responsive (width: 100%) chart
  const tooltipPadding = 9;
  const tooltipLineH = 15;
  const tooltipW = 130;
  const tooltipH = tooltipPadding * 2 + tooltipLineH * 2 - 3;
  let tooltipX = 0;
  let tooltipY = 0;
  if (hovered && hoveredIndex !== null) {
    const px = x(hoveredIndex);
    const py = y(hovered.value);
    tooltipX = Math.min(Math.max(px - tooltipW / 2, padL), width - padR - tooltipW);
    const above = py - tooltipH - 12;
    tooltipY = above >= padT ? above : Math.min(py + 12, padT + innerH - tooltipH);
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {Array.from({ length: gridCount + 1 }).map((_, i) => {
        const gy = padT + (innerH * i) / gridCount;
        const val = maxPad - (spanPad * i) / gridCount;
        return (
          <g key={i}>
            <line x1={padL} y1={gy} x2={width - padR} y2={gy} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 8} y={gy + 3} textAnchor="end" className="axis-label">
              {formatValue(val)}
            </text>
          </g>
        );
      })}
      <polygon points={areaPts} fill={`url(#${gradId})`} />
      <polyline
        points={linePts}
        fill="none"
        stroke={color}
        strokeWidth={2.25}
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ pointerEvents: "none" }}
      />
      {points.length > 0 && hoveredIndex === null && (
        <circle cx={lastX} cy={lastY} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
      )}
      {points.map((p, i) => {
        const step = maxLabels && points.length > maxLabels ? Math.ceil((points.length - 1) / (maxLabels - 1)) : 1;
        const last = points.length - 1;
        // Every `step`th label, plus the newest — dropping a regular one that would sit on top of it.
        const show = i === last || (i % step === 0 && last - i >= step * 0.6);
        if (!show) return null;
        return (
          <text key={i} x={x(i)} y={height - 6} textAnchor="middle" className="axis-label">
            {p.label}
          </text>
        );
      })}
      {hoveredIndex !== null && (
        <g style={{ pointerEvents: "none" }}>
          <line
            x1={x(hoveredIndex)}
            y1={padT}
            x2={x(hoveredIndex)}
            y2={padT + innerH}
            stroke="var(--border-strong)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <circle cx={x(hoveredIndex)} cy={y(points[hoveredIndex].value)} r={5} fill={color} stroke="var(--surface)" strokeWidth={2} />
        </g>
      )}
      {points.map((_, i) => {
        const bx = padL + bandW * i;
        return (
          <rect
            key={i}
            x={bx}
            y={padT}
            width={bandW}
            height={innerH}
            fill="transparent"
            style={{ cursor: "default" }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          />
        );
      })}
      {hovered && (
        <g style={{ pointerEvents: "none" }}>
          <rect
            x={tooltipX}
            y={tooltipY}
            width={tooltipW}
            height={tooltipH}
            rx={8}
            fill="var(--surface)"
            stroke="var(--border-strong)"
            strokeWidth={1}
          />
          <text x={tooltipX + tooltipPadding} y={tooltipY + tooltipPadding + 9} className="chart-tooltip-title">
            {hovered.label}
          </text>
          <text x={tooltipX + tooltipPadding} y={tooltipY + tooltipPadding + tooltipLineH + 9} className="chart-tooltip-text">
            {formatValue(hovered.value)}
          </text>
        </g>
      )}
    </svg>
  );
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** An x-axis label for a position counted in months (year * 12 + month - 1, with
 * a fraction for the day): "Sep 2026", or just "2031" once the chart spans
 * several years and a month name would be noise. */
export function monthAxisLabel(x: number, spanMonths: number): string {
  const whole = Math.floor(x + 1e-9);
  const year = Math.floor(whole / 12);
  return spanMonths > 36 ? String(year) : `${MONTH_ABBR[whole % 12]} ${year}`;
}

export interface SeriesChartSeries {
  /** Stable name for the series, exposed as `data-series` (tests and styling hooks). */
  key: string;
  /** Shown in the legend and the hover tooltip. */
  name: string;
  color: string;
  /** A forecast rather than a record — drawn dashed. */
  dashed?: boolean;
  /** Ordered by `x`; two points sharing an `x` draw a vertical step. */
  points: { x: number; value: number }[];
}

/** Axis ticks that land on real calendar boundaries — a label per month, per
 * quarter, per year or per few years, whichever keeps it to about six — so two
 * neighbouring ticks never read the same ("2027, 2027"). x is counted in months
 * (year * 12 + month - 1). */
export function timeTicks(xMin: number, xMax: number, maxTicks = 6): { x: number; label: string }[] {
  const first = Math.ceil(xMin - 1e-9);
  const last = Math.floor(xMax + 1e-9);
  for (const step of [1, 2, 3, 4, 6, 12, 24, 36, 60, 120]) {
    if (Math.floor((last - first) / step) + 1 > maxTicks) continue;
    const ticks: { x: number; label: string }[] = [];
    for (let t = Math.ceil(first / step) * step; t <= last; t += step) {
      ticks.push({ x: t, label: step >= 12 ? String(Math.floor(t / 12)) : `${MONTH_ABBR[t % 12]} ${Math.floor(t / 12)}` });
    }
    if (ticks.length >= 2) return ticks;
  }
  return [
    { x: xMin, label: monthAxisLabel(xMin, 0) },
    { x: xMax, label: monthAxisLabel(xMax, 0) },
  ];
}

/** Several lines on ONE value axis over a shared time axis (x counted in
 * months, see `monthAxisLabel`) — for a record and a forecast of the same
 * thing. The value axis always includes zero, since these lines start from
 * nothing. A legend names every series (a dashed swatch for a dashed line, so
 * identity never rests on colour alone), a dotted "now" line separates what
 * happened from what is projected, and hovering shows every series' value at
 * that time. A series with a single point is drawn as a dot. */
export function SeriesChart({
  series,
  width: initialWidth = 560,
  height = 220,
  formatValue = fmtMoneyShort,
  nowX,
  ariaLabel,
}: {
  series: SeriesChartSeries[];
  width?: number;
  height?: number;
  formatValue?: (v: number) => string;
  /** Draws a dotted vertical "Today" line at this x. */
  nowX?: number;
  ariaLabel: string;
}) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  // Drawn at the card's real pixel width, so the text stays its own size and the
  // chart fills the card instead of sitting at a fixed width in the middle of it.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      setMeasured((prev) => (w > 0 && w !== prev ? w : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const width = Math.max(measured ?? initialWidth, 280);
  const drawn = series.filter((s) => s.points.length > 0);
  // Nothing to draw (an account with no deposits, no value history and no plan yet): a grid of
  // made-up axis labels would only mislead, so leave it to the caller's own note.
  if (drawn.length === 0) return null;
  const padL = 46;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const allX = drawn.flatMap((s) => s.points.map((p) => p.x));
  const allV = drawn.flatMap((s) => s.points.map((p) => p.value));
  let xMin = Math.min(...allX);
  let xMax = Math.max(...allX);
  if (drawn.length === 0 || xMin === xMax) {
    xMin = (drawn.length ? xMin : 0) - 0.5;
    xMax = (drawn.length ? xMax : 0) + 0.5;
  }
  const spanX = xMax - xMin;
  const vMin = Math.min(0, ...allV);
  const vMaxRaw = Math.max(0, ...allV);
  const vMax = vMaxRaw === vMin ? vMin + 1 : vMaxRaw + (vMaxRaw - vMin) * 0.08;
  const spanV = vMax - vMin;
  const x = (v: number) => padL + ((v - xMin) / spanX) * innerW;
  const y = (v: number) => padT + innerH - ((v - vMin) / spanV) * innerH;

  const gridCount = 4;
  const xTicks = timeTicks(xMin, xMax, width < 480 ? 4 : 6);

  const sortedX = Array.from(new Set(allX)).sort((a, b) => a - b);
  function nearestX(target: number): number {
    return sortedX.reduce((best, candidate) => (Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best), sortedX[0]);
  }
  /** A series' value at `at`: its last point at or before it, or nothing outside its own span. */
  function valueAt(s: SeriesChartSeries, at: number): number | null {
    if (s.points.length === 0 || at < s.points[0].x - 1e-9 || at > s.points[s.points.length - 1].x + 1e-9) return null;
    let value = s.points[0].value;
    for (const p of s.points) {
      if (p.x > at + 1e-9) break;
      value = p.value;
    }
    return value;
  }

  const hovered = hoverX !== null ? hoverX : null;
  const tooltipRows =
    hovered === null ? [] : drawn.map((s) => ({ s, v: valueAt(s, hovered) })).filter((r): r is { s: SeriesChartSeries; v: number } => r.v !== null);
  const tooltipW = 176;
  const tooltipLineH = 15;
  const tooltipH = 12 + tooltipLineH * (tooltipRows.length + 1);
  let tooltipX = 0;
  if (hovered !== null) tooltipX = Math.min(Math.max(x(hovered) + 10, padL), width - padR - tooltipW);
  if (hovered !== null && x(hovered) + 10 + tooltipW > width - padR) tooltipX = Math.max(padL, x(hovered) - 10 - tooltipW);

  function onMove(e: MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * innerW + padL;
    setHoverX(nearestX(xMin + ((px - padL) / innerW) * spanX));
  }
  /** The same points the mouse reads, for the keyboard: arrows step through them, Home / End jump to the
   * ends, Escape puts the tooltip away. Keys the chart doesn't use are left alone. */
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (sortedX.length === 0) return;
    const current = hovered === null ? -1 : sortedX.indexOf(hovered);
    // The first arrow press starts at today's point (or the first one, on a chart with no "Today" line).
    const start = nowX !== undefined ? sortedX.indexOf(nearestX(nowX)) : 0;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
        next = current < 0 ? start : Math.min(current + 1, sortedX.length - 1);
        break;
      case "ArrowLeft":
        next = current < 0 ? start : Math.max(current - 1, 0);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = sortedX.length - 1;
        break;
      case "Escape":
        if (hovered === null) return;
        e.preventDefault();
        setHoverX(null);
        return;
      default:
        return;
    }
    e.preventDefault();
    setHoverX(sortedX[next]);
  }
  /** What a screen reader hears at the current point: the same values as the tooltip. */
  const liveText =
    hovered !== null && tooltipRows.length > 0 ? `${monthAxisLabel(hovered, 0)}: ${tooltipRows.map((r) => `${r.s.name} ${formatValue(r.v)}`).join(", ")}` : "";

  return (
    <div
      data-series-chart
      ref={wrapRef}
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel}. Use the left and right arrow keys to read its values.`}
      onKeyDown={onKey}
      onBlur={() => setHoverX(null)}
    >
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="xMidYMid meet" role="img" aria-label={ariaLabel}>
        {Array.from({ length: gridCount + 1 }).map((_, i) => {
          const gy = padT + (innerH * i) / gridCount;
          const val = vMax - (spanV * i) / gridCount;
          return (
            <g key={i}>
              <line x1={padL} y1={gy} x2={width - padR} y2={gy} stroke="var(--border)" strokeWidth={1} />
              <text x={padL - 8} y={gy + 3} textAnchor="end" className="axis-label">
                {formatValue(val)}
              </text>
            </g>
          );
        })}
        {xTicks.map((t) => (
          <text key={t.x} x={x(t.x)} y={height - 6} textAnchor="middle" className="axis-label">
            {t.label}
          </text>
        ))}
        {nowX !== undefined && nowX > xMin && nowX < xMax && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={x(nowX)} y1={padT} x2={x(nowX)} y2={padT + innerH} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="2 3" />
            <text x={x(nowX) + 4} y={padT + 9} className="axis-label">
              Today
            </text>
          </g>
        )}
        {drawn.map((s) =>
          s.points.length >= 2 ? (
            <polyline
              key={s.key}
              data-series={s.key}
              data-points={s.points.length}
              data-first-x-label={monthAxisLabel(s.points[0].x, 0)}
              points={s.points.map((p) => `${x(p.x).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.dashed ? "6 4" : undefined}
              style={{ pointerEvents: "none" }}
            />
          ) : (
            <circle
              key={s.key}
              data-series={s.key}
              data-points={1}
              data-first-x-label={monthAxisLabel(s.points[0].x, 0)}
              cx={x(s.points[0].x)}
              cy={y(s.points[0].value)}
              r={4}
              fill={s.color}
              stroke="var(--surface)"
              strokeWidth={2}
            />
          ),
        )}
        {hovered !== null && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={x(hovered)} y1={padT} x2={x(hovered)} y2={padT + innerH} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="3 3" />
            {tooltipRows.map((r) => (
              <circle key={r.s.key} cx={x(hovered)} cy={y(r.v)} r={5} fill={r.s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}
        <rect
          x={padL}
          y={padT}
          width={innerW}
          height={innerH}
          fill="transparent"
          style={{ cursor: "default" }}
          onMouseMove={onMove}
          onMouseLeave={() => setHoverX(null)}
        />
        {hovered !== null && tooltipRows.length > 0 && (
          <g style={{ pointerEvents: "none" }}>
            {/* Opaque in every style (Transparent's --surface is a translucent wash, and the lines would show through the text). */}
            <rect x={tooltipX} y={padT + 4} width={tooltipW} height={tooltipH} rx={8} fill="var(--status-base)" stroke="var(--border-strong)" strokeWidth={1} />
            <text x={tooltipX + 9} y={padT + 4 + 16} className="chart-tooltip-title">
              {monthAxisLabel(hovered, 0)}
            </text>
            {tooltipRows.map((r, i) => (
              <g key={r.s.key}>
                <line
                  x1={tooltipX + 9}
                  x2={tooltipX + 21}
                  y1={padT + 4 + 16 + tooltipLineH * (i + 1) - 3.5}
                  y2={padT + 4 + 16 + tooltipLineH * (i + 1) - 3.5}
                  stroke={r.s.color}
                  strokeWidth={2}
                  strokeDasharray={r.s.dashed ? "3 2" : undefined}
                />
                <text x={tooltipX + 27} y={padT + 4 + 16 + tooltipLineH * (i + 1)} className="chart-tooltip-text">
                  {r.s.name}: {formatValue(r.v)}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
      <div className="sr-only" role="status" aria-live="polite" data-chart-live>
        {liveText}
      </div>
      {drawn.length >= 2 && (
        <div className="chart-legend" data-series-legend>
          {drawn.map((s) => (
            <span className="chart-legend-item" key={s.key}>
              <svg width="18" height="8" aria-hidden="true">
                <line x1="1" y1="4" x2="17" y2="4" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeDasharray={s.dashed ? "4 3" : undefined} />
              </svg>
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
