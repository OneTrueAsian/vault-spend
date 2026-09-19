/** Small hand-rolled inline-SVG chart components — no charting library,
 * same technique as the Monarch-styled mockup this was adapted from. */
import { useState } from "react";

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
