/** @jsxImportSource react */

/**
 * Tufte primitive chart components for json-render.
 *
 * Word-sized / high-data-ink-ratio primitives that Recharts handles poorly:
 * Sparkline, DotPlot (Cleveland), BulletChart (Few), and Slopegraph (Tufte).
 * Hand-rolled SVG keeps the data-ink ratio high and avoids Recharts chartjunk.
 *
 * Lives alongside ./components.tsx and ./extra-components.tsx so the original
 * chart sets stay unchanged; ./catalog.ts is the only merge surface.
 */

import type { BaseComponentProps } from '@json-render/react';
import { CHART_COLORS, chartPlotHeight, useChartFrameHeight } from './components';

const ACCENT = CHART_COLORS[0];
const INK = 'var(--foreground, #111)';
const MUTED = 'var(--muted-foreground, #666)';
const FRAME = 'var(--border, #e5e5e5)';

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function extentOf(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) {
    // Avoid a zero-height/width domain so the line/dot still renders.
    return { min: min - 1, max: max + 1 };
  }
  return { min, max };
}

/* ───────────────────────── Sparkline ───────────────────────── */

interface SparklineProps {
  title?: string | null;
  data: Record<string, unknown>[];
  valueKey: string;
  color?: string | null;
  fill?: boolean | null;
  showEndDot?: boolean | null;
  showMinMax?: boolean | null;
  showValue?: boolean | null;
  height?: number | null;
}

function ChartSparkline({ props }: BaseComponentProps<SparklineProps>) {
  const rows = props.data ?? [];
  const values = rows.map((row) => toNumber(row[props.valueKey]));
  const stroke = props.color ?? ACCENT;
  const h = typeof props.height === 'number' ? props.height : 36;
  const w = 240;
  const padX = 4;
  const padY = 4;

  const { min, max } = extentOf(values);
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;
  const scaleY = (v: number) => padY + innerH - ((v - min) / (max - min)) * innerH;
  const points = values.map((v, i) => ({ x: padX + i * stepX, y: scaleY(v), v }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${(padY + innerH).toFixed(1)} L${points[0].x.toFixed(1)},${(padY + innerH).toFixed(1)} Z`
      : '';

  let minIdx = 0;
  let maxIdx = 0;
  values.forEach((v, i) => {
    if (v < values[minIdx]) minIdx = i;
    if (v > values[maxIdx]) maxIdx = i;
  });
  const last = points[points.length - 1];
  const lastValue = values.length > 0 ? values[values.length - 1] : 0;

  return (
    <div className="pmx-chart pmx-chart--sparkline">
      {props.title && <div className="pmx-chart__title">{props.title}</div>}
      <div className="pmx-chart__sparkline-row">
        {/*
          preserveAspectRatio="none" stretches the 240×36 viewBox to the cell.
          Slope is faithful only when the cell's aspect ratio stays near 240:36;
          this is acceptable for a word-sized strip whose job is shape, not exact angle.
        */}
        <svg
          className="pmx-chart__sparkline-svg"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={props.title ?? 'sparkline'}
        >
          {props.fill && areaPath && <path d={areaPath} fill={stroke} fillOpacity={0.12} stroke="none" />}
          {points.length > 1 && (
            <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          )}
          {props.showMinMax && points.length > 0 && (
            <>
              <circle cx={points[minIdx].x} cy={points[minIdx].y} r={2} fill={MUTED} />
              <circle cx={points[maxIdx].x} cy={points[maxIdx].y} r={2} fill={MUTED} />
            </>
          )}
          {props.showEndDot !== false && last && <circle cx={last.x} cy={last.y} r={2.5} fill={stroke} />}
        </svg>
        {props.showValue && (
          <span className="pmx-chart__sparkline-value" style={{ color: stroke }}>
            {lastValue}
          </span>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── DotPlot (Cleveland) ───────────────────────── */

interface DotPlotProps {
  title?: string | null;
  data: Record<string, unknown>[];
  labelKey: string;
  valueKey: string;
  color?: string | null;
  sort?: 'asc' | 'desc' | 'none' | null;
  height?: number | null;
}

function ChartDotPlot({ props }: BaseComponentProps<DotPlotProps>) {
  const dot = props.color ?? ACCENT;
  const rows = (props.data ?? []).map((row) => ({
    label: String(row[props.labelKey] ?? ''),
    value: toNumber(row[props.valueKey]),
  }));
  const sort = props.sort ?? 'desc';
  if (sort === 'asc') rows.sort((a, b) => a.value - b.value);
  else if (sort === 'desc') rows.sort((a, b) => b.value - a.value);

  const fallback = Math.max(160, rows.length * 28 + 24);
  const { frameRef, height } = useChartFrameHeight(props.height, fallback);

  const values = rows.map((r) => r.value);
  const { min, max } = extentOf(values);
  const domainMin = Math.min(0, min);
  const labelW = 140;
  const valueW = 52;
  const padX = 12;
  // Distribute rows across the available plot height with 36px as a MINIMUM (not
  // a maximum): a sparse chart fills a tall expanded card instead of staying
  // tile-sized and top-aligned with whitespace below; a dense chart keeps ≥36px
  // rows and scrolls cleanly (height no longer oscillates — see useChartFrameHeight).
  const plotH = chartPlotHeight(height, Boolean(props.title));
  const rowH = rows.length > 0 ? Math.max(36, plotH / rows.length) : 24;
  const plotLeft = labelW + padX;

  return (
    <div ref={frameRef} className="pmx-chart pmx-chart--dot-plot" style={{ height }}>
      {props.title && <div className="pmx-chart__title">{props.title}</div>}
      <svg
        className="pmx-chart__dot-plot-svg"
        width="100%"
        height={rows.length * rowH}
        role="img"
        aria-label={props.title ?? 'dot plot'}
      >
        {rows.map((row, i) => {
          const cy = i * rowH + rowH / 2;
          // Reference rule runs from the axis origin to the dot, so the line's
          // length itself encodes the value (a full-width rule would make every
          // row look equal and fight the dot encoding).
          const span = max - domainMin || 1;
          const frac = Math.max(0, Math.min(1, (row.value - domainMin) / span));
          const dotCx = `calc(${plotLeft}px + (100% - ${plotLeft + valueW + padX}px) * ${frac})`;
          return (
            <g key={`${row.label}-${i}`}>
              <text x={labelW} y={cy} textAnchor="end" dominantBaseline="central" fontSize={12} fill={INK}>
                {row.label}
              </text>
              <line x1={plotLeft} y1={cy} x2={dotCx} y2={cy} stroke={FRAME} strokeWidth={1} />
              <circle cx={dotCx} cy={cy} r={4.5} fill={dot} />
              <text x="100%" dx={-padX} y={cy} textAnchor="end" dominantBaseline="central" fontSize={12} fill={MUTED}>
                {row.value}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ───────────────────────── BulletChart (Few) ───────────────────────── */

interface BulletRow {
  label?: string;
  value: number;
  target?: number;
  ranges?: number[];
}

interface BulletChartProps {
  title?: string | null;
  data: Record<string, unknown>[];
  labelKey?: string | null;
  valueKey: string;
  targetKey?: string | null;
  rangesKey?: string | null;
  color?: string | null;
  height?: number | null;
}

function ChartBulletChart({ props }: BaseComponentProps<BulletChartProps>) {
  const measure = props.color ?? ACCENT;
  const labelKey = props.labelKey ?? 'label';
  const targetKey = props.targetKey ?? 'target';
  const rangesKey = props.rangesKey ?? 'ranges';

  const rows: BulletRow[] = (props.data ?? []).map((row) => {
    const rawRanges = row[rangesKey];
    return {
      label: String(row[labelKey] ?? ''),
      value: toNumber(row[props.valueKey]),
      ...(row[targetKey] !== undefined ? { target: toNumber(row[targetKey]) } : {}),
      ...(Array.isArray(rawRanges) ? { ranges: rawRanges.map(toNumber).sort((a, b) => a - b) } : {}),
    };
  });

  const fallback = Math.max(120, rows.length * 48 + 24);
  const { frameRef, height, width } = useChartFrameHeight(props.height, fallback);
  // SVG <text x> does not support calc(), so position everything in measured
  // pixels (fallback width until the ResizeObserver reports the real size).
  const w = width || 480;
  const labelW = 120;
  const padX = 12;
  // Fill the available plot height with 56px as a MINIMUM per row (the bar itself
  // is capped at barH below, so extra row height just adds breathing room) so a
  // sparse bullet chart fills a tall expanded card instead of leaving whitespace.
  const plotH = chartPlotHeight(height, Boolean(props.title));
  const rowH = rows.length > 0 ? Math.max(56, plotH / rows.length) : 48;

  return (
    <div ref={frameRef} className="pmx-chart pmx-chart--bullet" style={{ height }}>
      {props.title && <div className="pmx-chart__title">{props.title}</div>}
      <svg
        className="pmx-chart__bullet-svg"
        width="100%"
        height={rows.length * rowH}
        role="img"
        aria-label={props.title ?? 'bullet chart'}
      >
        {rows.map((row, i) => {
          const top = i * rowH;
          const cy = top + rowH / 2;
          const domainMax = Math.max(row.value, row.target ?? 0, ...(row.ranges ?? [0])) || 1;
          const ranges = row.ranges ?? [];
          const left = labelW + padX;
          const rightInset = padX;
          const plotW = Math.max(0, w - left - rightInset);
          const pct = (v: number) => Math.max(0, Math.min(1, v / domainMax));
          const xAt = (v: number) => left + plotW * pct(v);
          const wBetween = (lo: number, hi: number) => plotW * Math.max(0, pct(hi) - pct(lo));
          const barH = Math.min(20, rowH * 0.5);
          const measureH = barH * 0.4;
          // Qualitative bands: lightest (worst) to darkest (best) grayscale.
          const bandShades = [
            'color-mix(in oklch, var(--muted) 35%, transparent)',
            'color-mix(in oklch, var(--muted) 60%, transparent)',
            'color-mix(in oklch, var(--muted) 90%, transparent)',
          ];
          return (
            <g key={`${row.label}-${i}`}>
              <text x={labelW} y={cy} textAnchor="end" dominantBaseline="central" fontSize={12} fill={INK}>
                {row.label}
              </text>
              {ranges.map((hi, idx) => {
                const lo = idx === 0 ? 0 : ranges[idx - 1];
                return (
                  <rect
                    key={idx}
                    x={xAt(lo)}
                    y={cy - barH / 2}
                    width={wBetween(lo, hi)}
                    height={barH}
                    fill={bandShades[Math.min(idx, bandShades.length - 1)]}
                  />
                );
              })}
              {/* Per-row scale ticks at each band boundary so the reader does not
                  compare bar lengths across rows that may be independently scaled. */}
              {ranges.map((hi, idx) => (
                <text
                  key={`tick-${idx}`}
                  x={xAt(hi)}
                  y={cy + barH / 2 + 10}
                  textAnchor="middle"
                  fontSize={9}
                  fill={MUTED}
                >
                  {hi}
                </text>
              ))}
              {/* Measure bar (the actual value) — the only saturated ink. */}
              <rect x={left} y={cy - measureH / 2} width={wBetween(0, row.value)} height={measureH} fill={measure} />
              {/* Target tick. */}
              {typeof row.target === 'number' && (
                <rect x={xAt(row.target)} y={cy - barH / 2} width={2} height={barH} fill={INK} />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ───────────────────────── Slopegraph ───────────────────────── */

interface SlopegraphProps {
  title?: string | null;
  data: Record<string, unknown>[];
  labelKey: string;
  beforeKey: string;
  afterKey: string;
  beforeLabel?: string | null;
  afterLabel?: string | null;
  color?: string | null;
  colorByDirection?: boolean | null;
  height?: number | null;
}

function ChartSlopegraph({ props }: BaseComponentProps<SlopegraphProps>) {
  const stroke = props.color ?? ACCENT;
  const rows = (props.data ?? []).map((row) => ({
    label: String(row[props.labelKey] ?? ''),
    before: toNumber(row[props.beforeKey]),
    after: toNumber(row[props.afterKey]),
  }));

  const { frameRef, height, width } = useChartFrameHeight(props.height, 320);
  const all = rows.flatMap((r) => [r.before, r.after]);
  const { min, max } = extentOf(all);
  const topPad = 28;
  const botPad = 20;
  const leftX = 150;
  const rightInset = 150;
  // SVG <text x> does not support calc(), so position the right column in
  // measured pixels (fallback width until the ResizeObserver reports the size).
  const w = width || 480;
  const rightX = Math.max(leftX + 40, w - rightInset);
  // Size the SVG to the plot height (frame minus title/padding) so the chart
  // fills without pushing a scrollbar onto the iframe document.
  const plotH = chartPlotHeight(height, Boolean(props.title));
  const scaleY = (v: number) => topPad + (1 - (v - min) / (max - min)) * (plotH - topPad - botPad);

  return (
    <div ref={frameRef} className="pmx-chart pmx-chart--slopegraph" style={{ height }}>
      {props.title && <div className="pmx-chart__title">{props.title}</div>}
      <svg
        className="pmx-chart__slopegraph-svg"
        width="100%"
        height={plotH}
        role="img"
        aria-label={props.title ?? 'slopegraph'}
      >
        <text x={leftX} y={14} textAnchor="end" fontSize={12} fontWeight={600} fill={MUTED}>
          {props.beforeLabel ?? props.beforeKey}
        </text>
        <text x={rightX} y={14} textAnchor="start" fontSize={12} fontWeight={600} fill={MUTED}>
          {props.afterLabel ?? props.afterKey}
        </text>
        {rows.map((row, i) => {
          const y1 = scaleY(row.before);
          const y2 = scaleY(row.after);
          const rose = row.after >= row.before;
          // Lines default to a single neutral ink. Direction coloring (rising vs
          // falling) is an opt-in via colorByDirection — by default it would be a
          // redundant double-encoding of slope and editorializes (a falling
          // error-rate is "good", a falling revenue is "bad").
          const lineColor = props.colorByDirection ? (rose ? stroke : MUTED) : stroke;
          return (
            <g key={`${row.label}-${i}`}>
              <line x1={leftX} y1={y1} x2={rightX} y2={y2} stroke={lineColor} strokeWidth={1.5} />
              <circle cx={leftX} cy={y1} r={2.5} fill={lineColor} />
              <circle cx={rightX} cy={y2} r={2.5} fill={lineColor} />
              <text x={leftX - 8} y={y1} textAnchor="end" dominantBaseline="central" fontSize={11} fill={INK}>
                {`${row.label}  ${row.before}`}
              </text>
              <text x={rightX + 8} y={y2} textAnchor="start" dominantBaseline="central" fontSize={11} fill={INK}>
                {`${row.after}  ${row.label}`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export const tufteChartComponents = {
  Sparkline: ChartSparkline,
  DotPlot: ChartDotPlot,
  BulletChart: ChartBulletChart,
  Slopegraph: ChartSlopegraph,
};
