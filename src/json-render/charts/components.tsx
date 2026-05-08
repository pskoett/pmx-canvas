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

export interface CartesianChartProps {
  title?: string | null;
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  aggregate?: AggregateMode | null;
  color?: string | null;
  height?: number | null;
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

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const updateHeight = () => {
      const rect = frame.getBoundingClientRect();
      const doc = document.documentElement;
      const currentHeight = frame.getBoundingClientRect().height;
      const overflow = Math.max(0, doc.scrollHeight - doc.clientHeight);
      const available = overflow > 0 ? currentHeight - overflow : window.innerHeight - rect.top - 24;
      setAutoHeight(Math.max(220, Math.round(available)));
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

  return {
    frameRef,
    height: typeof explicitHeight === 'number' ? Math.min(explicitHeight, autoHeight) : autoHeight,
  };
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

function ChartBarChart({ props }: BaseComponentProps<CartesianChartProps>) {
  const fill = props.color ?? CHART_COLORS[0];
  return (
    <CartesianChart props={props} className="pmx-chart--bar">
      {(data) => (
        <RechartsBarChart data={data} margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e5e5)" />
          <XAxis dataKey={props.xKey} tick={axisStyle} tickMargin={axisTickMargin} />
          <YAxis tick={axisStyle} tickMargin={axisTickMargin} />
          <Tooltip contentStyle={tooltipStyle} cursor={false} />
          <Bar dataKey={props.yKey} fill={fill} radius={[4, 4, 0, 0]} />
        </RechartsBarChart>
      )}
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
