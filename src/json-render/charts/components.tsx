/** @jsxImportSource react */

/**
 * Chart component implementations for json-render.
 *
 * Built on Recharts, following the same pattern as the Vercel json-render
 * chat example. Each component receives BaseComponentProps<T> and renders
 * a responsive chart inside a styled container.
 */

import type { ReactNode } from 'react';
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

const CHART_COLORS = [
  'var(--chart-1, #2563eb)',
  'var(--chart-2, #16a34a)',
  'var(--chart-3, #ea580c)',
  'var(--chart-4, #8b5cf6)',
  'var(--chart-5, #d946ef)',
  'var(--chart-6, #0891b2)',
];

type AggregateMode = 'sum' | 'count' | 'avg';

const AGGREGATE_FNS: Record<AggregateMode, (values: number[]) => number> = {
  sum: (v) => v.reduce((a, b) => a + b, 0),
  count: (v) => v.length,
  avg: (v) => v.reduce((a, b) => a + b, 0) / v.length,
};

function processChartData(
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

interface CartesianChartProps {
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
}

const axisStyle = {
  fontSize: 12,
  fill: 'var(--muted-foreground, #666)',
};

const tooltipStyle = {
  backgroundColor: 'var(--popover, #fff)',
  border: '1px solid var(--border, #e5e5e5)',
  borderRadius: 'var(--radius, 0.5rem)',
  color: 'var(--popover-foreground, #111)',
  fontSize: 13,
};

/** Shared wrapper for cartesian charts (Line + Bar). */
function CartesianChart({
  props,
  children,
}: {
  props: CartesianChartProps;
  children: (data: Record<string, unknown>[]) => ReactNode;
}) {
  const chartData = processChartData(props.data ?? [], props.xKey, props.yKey, props.aggregate);
  const h = props.height ?? 300;

  return (
    <div className="pmx-chart">
      {props.title && <div className="pmx-chart__title">{props.title}</div>}
      <ResponsiveContainer width="100%" height={h}>
        {children(chartData)}
      </ResponsiveContainer>
    </div>
  );
}

function ChartLineChart({ props }: BaseComponentProps<CartesianChartProps>) {
  const stroke = props.color ?? CHART_COLORS[0];
  return (
    <CartesianChart props={props}>
      {(data) => (
        <RechartsLineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e5e5)" />
          <XAxis dataKey={props.xKey} tick={axisStyle} />
          <YAxis tick={axisStyle} />
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
    <CartesianChart props={props}>
      {(data) => (
        <RechartsBarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e5e5)" />
          <XAxis dataKey={props.xKey} tick={axisStyle} />
          <YAxis tick={axisStyle} />
          <Tooltip contentStyle={tooltipStyle} cursor={false} />
          <Bar dataKey={props.yKey} fill={fill} radius={[4, 4, 0, 0]} />
        </RechartsBarChart>
      )}
    </CartesianChart>
  );
}

function ChartPieChart({ props }: BaseComponentProps<PieChartProps>) {
  const data = props.data ?? [];
  const h = props.height ?? 300;

  return (
    <div className="pmx-chart">
      {props.title && <div className="pmx-chart__title">{props.title}</div>}
      <ResponsiveContainer width="100%" height={h}>
        <RechartsPieChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend />
          <Pie
            data={data}
            dataKey={props.valueKey}
            nameKey={props.nameKey}
            cx="50%"
            cy="50%"
            outerRadius="80%"
            label
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
