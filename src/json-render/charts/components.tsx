/** @jsxImportSource react */

/**
 * Chart component implementations for json-render.
 *
 * Built on Recharts, following the same pattern as the Vercel json-render
 * chat example. Each component receives BaseComponentProps<T> and renders
 * a responsive chart inside a styled container.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BaseComponentProps } from '@json-render/react';
import {
  BarChart as RechartsBarChart,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Fallbacks mirror the light-theme palette in renderer/index.css so the
// chart still reads as on-brand if the Tailwind bundle fails to load.
export const CHART_COLORS = [
  'var(--chart-1, #1A7ABF)',
  'var(--chart-2, #1a9f55)',
  'var(--chart-3, #c89b2a)',
  'var(--chart-4, #7c4dff)',
  'var(--chart-5, #d32f2f)',
  'var(--chart-6, #00838F)',
];

export type AggregateMode = 'sum' | 'count' | 'avg';

const AGGREGATE_FNS: Record<AggregateMode, (values: number[]) => number> = {
  sum: (v) => v.reduce((a, b) => a + b, 0),
  count: (v) => v.length,
  avg: (v) => v.reduce((a, b) => a + b, 0) / v.length,
};

export function processChartData(
  data: Record<string, unknown>[],
  xKey: string,
  yKey: string,
  aggregate: AggregateMode | null | undefined,
): Record<string, unknown>[] {
  if (!aggregate) return data;

  const groups = new Map<string, number[]>();
  for (const row of data) {
    const key = String(row[xKey] ?? '');
    const val = Number(row[yKey] ?? 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(isNaN(val) ? 0 : val);
  }

  const result: Record<string, unknown>[] = [];
  for (const [key, values] of groups) {
    result.push({ [xKey]: key, [yKey]: AGGREGATE_FNS[aggregate](values) });
  }
  return result;
}

export type BarColorBy = 'series' | 'category' | 'value' | 'none';
export type BarHighlight = number | 'max' | 'min' | null;

export interface CartesianChartProps {
  title?: string | null;
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  aggregate?: AggregateMode | null;
  color?: string | null;
  height?: number | null;
  /** Bar-only: how bar fills are colored. Defaults to 'series'. Ignored by line charts. */
  colorBy?: BarColorBy | null;
  /** Bar-only: which bar gets the accent under colorBy='series'. Defaults to 'max'. */
  highlight?: BarHighlight;
}

interface PieChartProps {
  title?: string | null;
  data: Record<string, unknown>[];
  nameKey: string;
  valueKey: string;
  height?: number | null;
  showLegend?: boolean | null;
  showLabels?: boolean | null;
}

export const axisStyle = {
  fontSize: 12,
  fill: 'var(--muted-foreground, #666)',
};

export const tooltipStyle = {
  backgroundColor: 'var(--popover, #fff)',
  border: '1px solid var(--border, #e5e5e5)',
  borderRadius: 'var(--radius, 0.5rem)',
  color: 'var(--popover-foreground, #111)',
  fontSize: 13,
};

export const chartMargin = { top: 14, right: 28, bottom: 28, left: 10 };
export const polarChartMargin = { top: 18, right: 40, bottom: 30, left: 40 };
export const axisTickMargin = 8;
export const legendMargin = { top: 10 };

export function useChartFrameHeight(explicitHeight: number | null | undefined, fallbackHeight = 300) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [autoHeight, setAutoHeight] = useState(fallbackHeight);
  const [autoWidth, setAutoWidth] = useState(0);

  // Standalone "Open as site" tab (#65): fill the full browser viewport — there is no
  // card chrome below the chart, so drop the ~44px reserve and use a larger floor.
  const isSite =
    typeof window !== 'undefined' &&
    (window as { __PMX_CANVAS_JSON_RENDER_DISPLAY__?: string }).__PMX_CANVAS_JSON_RENDER_DISPLAY__ === 'site';

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const updateHeight = () => {
      const rect = frame.getBoundingClientRect();
      // Available height runs from the frame's top to the bottom of the iframe
      // viewport. It is deliberately NOT derived from the document's own scroll
      // overflow: feeding the chart's own overflow back into its height creates a
      // shrink -> no-overflow -> grow -> overflow feedback loop that repaints
      // forever (the reported Tufte-chart flicker). When natural content exceeds
      // the viewport the document simply scrolls (with a stable gutter, see
      // index.css) instead of the height oscillating.
      // Reserve ~44px below the frame for the chrome that sits under the chart
      // inside the json-render card (card padding/margin ≈ 41px, measured stable
      // across node sizes). rect.top already accounts for everything above. With
      // too small a reserve a filled chart spills ~17px past the viewport and the
      // iframe document shows a needless scrollbar.
      // Keep the ~44px reserve in BOTH modes — it covers the chart frame's own
      // non-plot chrome (title + .pmx-chart padding), which exists in site mode too.
      // Dropping it pushed the frame past the viewport and reintroduced a scrollbar.
      // Site mode differs only in the floor (300 vs 220) and the fill selection below.
      const available = Math.max(isSite ? 300 : 220, Math.round(window.innerHeight - rect.top - 44));
      const nextWidth = Math.round(rect.width);
      // Dead-band: ignore sub-threshold churn so a stray re-measure (e.g. a
      // scrollbar toggling) can't ping-pong state and repaint.
      setAutoHeight((prev) => (Math.abs(available - prev) > 2 ? available : prev));
      setAutoWidth((prev) => (Math.abs(nextWidth - prev) > 2 ? nextWidth : prev));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(document.documentElement);
    observer.observe(frame);
    window.addEventListener('resize', updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, [explicitHeight]);

  // Content-fit mode (node grows to fit, set by the viewer when fit=content): the
  // chart takes its INTRINSIC height — explicit, or the fallback — independent of
  // the node/viewport height. That makes the document's scrollHeight stable so the
  // node can grow to it once and converge (no fill-down feedback loop). When NOT in
  // content-fit (strictSize / user-resized nodes), it fills the frame down as before.
  const fitContent =
    typeof window !== 'undefined' &&
    (window as { __PMX_CANVAS_FIT_CONTENT__?: boolean }).__PMX_CANVAS_FIT_CONTENT__ === true;
  // Site mode (#65): fill the viewport (autoHeight), ignoring an explicit/configured
  // chart height that would otherwise cap it to a shallow card. Content-fit is off in
  // site mode (the server skips it), so site never takes the intrinsic-height branch.
  const height = isSite
    ? autoHeight
    : fitContent
      ? typeof explicitHeight === 'number'
        ? explicitHeight
        : fallbackHeight
      : typeof explicitHeight === 'number'
        ? Math.min(explicitHeight, autoHeight)
        : autoHeight;
  return {
    frameRef,
    height,
    width: autoWidth,
  };
}

/**
 * Height available for the plotted SVG inside `.pmx-chart`, i.e. the measured
 * frame height minus the non-plot chrome: the `.pmx-chart__title` block (~24px
 * of text + margin, only when a title is shown) plus the chart's own vertical
 * padding. Sizing the SVG to this — instead of the full frame height — keeps a
 * filled chart's title+plot within the frame so it doesn't push a scrollbar onto
 * the single iframe-document scroller. Dense charts still exceed it and scroll
 * (one scrollbar, as expected).
 */
export function chartPlotHeight(height: number, hasTitle: boolean): number {
  return Math.max(60, height - (hasTitle ? 36 : 12));
}

/** Shared wrapper for cartesian charts (Line + Bar). */
export function CartesianChart({
  props,
  children,
  className,
}: {
  props: CartesianChartProps;
  children: (data: Record<string, unknown>[]) => ReactNode;
  className?: string;
}) {
  const chartData = processChartData(props.data ?? [], props.xKey, props.yKey, props.aggregate);
  const { frameRef, height } = useChartFrameHeight(props.height, 300);

  return (
    <div ref={frameRef} className={`pmx-chart${className ? ` ${className}` : ''}`}>
      {props.title && <div className="pmx-chart__title">{props.title}</div>}
      <ResponsiveContainer width="100%" height={height}>
        {children(chartData)}
      </ResponsiveContainer>
    </div>
  );
}

function ChartLineChart({ props }: BaseComponentProps<CartesianChartProps>) {
  const stroke = props.color ?? CHART_COLORS[0];
  return (
    <CartesianChart props={props} className="pmx-chart--line">
      {(data) => (
        <RechartsLineChart data={data} margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e5e5)" />
          <XAxis dataKey={props.xKey} tick={axisStyle} tickMargin={axisTickMargin} />
          <YAxis tick={axisStyle} tickMargin={axisTickMargin} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line
            type="monotone"
            dataKey={props.yKey}
            stroke={stroke}
            strokeWidth={2}
            dot={{ r: 4, fill: stroke }}
            activeDot={{ r: 6 }}
          />
        </RechartsLineChart>
      )}
    </CartesianChart>
  );
}

/**
 * Resolve the highlighted bar index for colorBy='series'.
 * 'max'/'min' pick the tallest/shortest yKey value; a number is used as-is
 * (clamped to range); null/out-of-range means no bar is emphasized.
 */
function resolveHighlightIndex(data: Record<string, unknown>[], yKey: string, highlight: BarHighlight): number {
  if (highlight === null || data.length === 0) return -1;
  if (typeof highlight === 'number') {
    return highlight >= 0 && highlight < data.length ? highlight : -1;
  }
  let best = 0;
  let bestVal = Number(data[0]?.[yKey] ?? 0);
  for (let i = 1; i < data.length; i++) {
    const val = Number(data[i]?.[yKey] ?? 0);
    if (highlight === 'max' ? val > bestVal : val < bestVal) {
      best = i;
      bestVal = val;
    }
  }
  return best;
}

/** Per-bar fill for each colorBy mode. Reuses the <Cell> pattern proven in ChartPieChart. */
function barCellFill(
  mode: BarColorBy,
  accent: string,
  index: number,
  value: number,
  range: { min: number; max: number },
  highlightIndex: number,
): string {
  switch (mode) {
    case 'category':
      return CHART_COLORS[index % CHART_COLORS.length];
    case 'value': {
      // Sequential shade by magnitude: 35% (lowest) -> 100% (highest) accent,
      // mixed toward a SOLID background token so every bar is opaque and the
      // ramp is a true lightness sequence (not a translucency that reads
      // differently depending on what is behind the bar).
      const span = range.max - range.min;
      const t = span > 0 ? (value - range.min) / span : 1;
      const pct = Math.round(35 + t * 65);
      return `color-mix(in oklch, ${accent} ${pct}%, var(--card, var(--background)))`;
    }
    case 'none':
      return accent;
    case 'series':
    default:
      // Tufte-safe emphasis: one accent bar, the rest a muted version of it.
      return index === highlightIndex ? accent : `color-mix(in oklch, ${accent} 32%, transparent)`;
  }
}

function ChartBarChart({ props }: BaseComponentProps<CartesianChartProps>) {
  const accent = props.color ?? CHART_COLORS[0];
  const mode: BarColorBy = props.colorBy ?? 'series';
  const highlight: BarHighlight = props.highlight === undefined ? 'max' : props.highlight;
  return (
    <CartesianChart props={props} className="pmx-chart--bar">
      {(data) => {
        const values = data.map((row) => Number(row[props.yKey] ?? 0));
        const range = {
          min: values.length ? Math.min(...values) : 0,
          max: values.length ? Math.max(...values) : 0,
        };
        const highlightIndex = mode === 'series' ? resolveHighlightIndex(data, props.yKey, highlight) : -1;
        return (
          <RechartsBarChart data={data} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e5e5)" />
            <XAxis dataKey={props.xKey} tick={axisStyle} tickMargin={axisTickMargin} />
            <YAxis domain={[0, 'auto']} tick={axisStyle} tickMargin={axisTickMargin} />
            <Tooltip contentStyle={tooltipStyle} cursor={false} />
            <Bar dataKey={props.yKey} radius={[4, 4, 0, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={barCellFill(mode, accent, i, values[i], range, highlightIndex)} />
              ))}
            </Bar>
          </RechartsBarChart>
        );
      }}
    </CartesianChart>
  );
}

function ChartPieChart({ props }: BaseComponentProps<PieChartProps>) {
  const data = props.data ?? [];
  const { frameRef, height } = useChartFrameHeight(props.height, 300);

  return (
    <div ref={frameRef} className="pmx-chart pmx-chart--pie">
      {props.title && <div className="pmx-chart__title">{props.title}</div>}
      <ResponsiveContainer width="100%" height={height}>
        <RechartsPieChart margin={polarChartMargin}>
          <Tooltip contentStyle={tooltipStyle} />
          {props.showLegend !== false && <Legend wrapperStyle={legendMargin} />}
          <Pie
            data={data}
            dataKey={props.valueKey}
            nameKey={props.nameKey}
            cx="50%"
            cy="50%"
            outerRadius="64%"
            label={props.showLabels !== false}
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
        </RechartsPieChart>
      </ResponsiveContainer>
    </div>
  );
}

export const chartComponents = {
  LineChart: ChartLineChart,
  BarChart: ChartBarChart,
  PieChart: ChartPieChart,
};
