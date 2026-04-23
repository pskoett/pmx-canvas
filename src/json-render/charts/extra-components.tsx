/** @jsxImportSource react */

/**
 * Additional chart components for json-render.
 *
 * Lives alongside ./components.tsx so the original chart set stays
 * unchanged and the merge point in ./catalog.ts is the only contact
 * surface with the upstream `@json-render/*` packages.
 */

import type { BaseComponentProps } from '@json-render/react';
import {
  Area,
  AreaChart as RechartsAreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  ComposedChart as RechartsComposedChart,
  Legend,
  Line,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart as RechartsRadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart as RechartsScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import {
  CHART_COLORS,
  CartesianChart,
  axisStyle,
  tooltipStyle,
  type CartesianChartProps,
} from './components';

type AreaChartProps = CartesianChartProps;

function ChartAreaChart({ props }: BaseComponentProps<AreaChartProps>) {
  const stroke = props.color ?? CHART_COLORS[0];
  const gradientId = `pmx-area-${props.yKey ?? 'value'}`;
  return (
    <CartesianChart props={props}>
      {(data) => (
        <RechartsAreaChart data={data}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.45} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e5e5)" />
          <XAxis dataKey={props.xKey} tick={axisStyle} />
          <YAxis tick={axisStyle} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area
            type="monotone"
            dataKey={props.yKey}
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            activeDot={{ r: 5 }}
          />
        </RechartsAreaChart>
      )}
    </CartesianChart>
  );
}

interface ScatterChartProps {
  title?: string | null;
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  zKey?: string | null;
  color?: string | null;
  height?: number | null;
}

function ChartScatterChart({ props }: BaseComponentProps<ScatterChartProps>) {
  const fill = props.color ?? CHART_COLORS[0];
  const data = props.data ?? [];
  const h = props.height ?? 300;

  return (
    <div className="pmx-chart">
      {props.title && <div className="pmx-chart__title">{props.title}</div>}
      <ResponsiveContainer width="100%" height={h}>
        <RechartsScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e5e5)" />
          <XAxis type="number" dataKey={props.xKey} tick={axisStyle} name={props.xKey} />
          <YAxis type="number" dataKey={props.yKey} tick={axisStyle} name={props.yKey} />
          {props.zKey && <ZAxis type="number" dataKey={props.zKey} range={[40, 400]} name={props.zKey} />}
          <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={data} fill={fill} />
        </RechartsScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

interface RadarChartProps {
  title?: string | null;
  data: Record<string, unknown>[];
  axisKey: string;
  metrics: string[];
  height?: number | null;
}

function ChartRadarChart({ props }: BaseComponentProps<RadarChartProps>) {
  const data = props.data ?? [];
  const metrics = (props.metrics ?? []).filter((m) => typeof m === 'string' && m.length > 0);
  const h = props.height ?? 320;

  return (
    <div className="pmx-chart">
      {props.title && <div className="pmx-chart__title">{props.title}</div>}
      <ResponsiveContainer width="100%" height={h}>
        <RechartsRadarChart data={data} outerRadius="75%">
          <PolarGrid stroke="var(--border, #e5e5e5)" />
          <PolarAngleAxis dataKey={props.axisKey} tick={axisStyle} />
          <PolarRadiusAxis tick={axisStyle} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend />
          {metrics.map((metric, i) => {
            const color = CHART_COLORS[i % CHART_COLORS.length];
            return (
              <Radar
                key={metric}
                name={metric}
                dataKey={metric}
                stroke={color}
                fill={color}
                fillOpacity={0.25}
              />
            );
          })}
        </RechartsRadarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface StackedBarChartProps {
  title?: string | null;
  data: Record<string, unknown>[];
  xKey: string;
  series: string[];
  aggregate?: 'sum' | 'count' | 'avg' | null;
  height?: number | null;
}

function ChartStackedBarChart({ props }: BaseComponentProps<StackedBarChartProps>) {
  const series = (props.series ?? []).filter((s) => typeof s === 'string' && s.length > 0);
  const chartData = props.aggregate
    ? mergeAggregated(props.data ?? [], props.xKey, series, props.aggregate)
    : props.data ?? [];
  const h = props.height ?? 300;

  return (
    <div className="pmx-chart">
      {props.title && <div className="pmx-chart__title">{props.title}</div>}
      <ResponsiveContainer width="100%" height={h}>
        <RechartsBarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e5e5)" />
          <XAxis dataKey={props.xKey} tick={axisStyle} />
          <YAxis tick={axisStyle} />
          <Tooltip contentStyle={tooltipStyle} cursor={false} />
          <Legend />
          {series.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="stack"
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}

function mergeAggregated(
  data: Record<string, unknown>[],
  xKey: string,
  series: string[],
  aggregate: 'sum' | 'count' | 'avg',
): Record<string, unknown>[] {
  const grouped = new Map<string, Record<string, number[]>>();
  for (const row of data) {
    const k = String(row[xKey] ?? '');
    if (!grouped.has(k)) grouped.set(k, {});
    const bucket = grouped.get(k)!;
    for (const s of series) {
      const n = Number(row[s] ?? 0);
      if (!bucket[s]) bucket[s] = [];
      bucket[s].push(Number.isNaN(n) ? 0 : n);
    }
  }
  const reducer = aggregate === 'count'
    ? (vs: number[]) => vs.length
    : aggregate === 'avg'
      ? (vs: number[]) => vs.reduce((a, b) => a + b, 0) / vs.length
      : (vs: number[]) => vs.reduce((a, b) => a + b, 0);
  return Array.from(grouped.entries()).map(([key, buckets]) => {
    const out: Record<string, unknown> = { [xKey]: key };
    for (const s of series) out[s] = reducer(buckets[s] ?? []);
    return out;
  });
}

interface ComposedChartProps {
  title?: string | null;
  data: Record<string, unknown>[];
  xKey: string;
  barKey: string;
  lineKey: string;
  barColor?: string | null;
  lineColor?: string | null;
  height?: number | null;
}

function ChartComposedChart({ props }: BaseComponentProps<ComposedChartProps>) {
  const data = props.data ?? [];
  const barFill = props.barColor ?? CHART_COLORS[0];
  const lineStroke = props.lineColor ?? CHART_COLORS[3];
  const h = props.height ?? 300;

  return (
    <div className="pmx-chart">
      {props.title && <div className="pmx-chart__title">{props.title}</div>}
      <ResponsiveContainer width="100%" height={h}>
        <RechartsComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e5e5)" />
          <XAxis dataKey={props.xKey} tick={axisStyle} />
          <YAxis tick={axisStyle} />
          <Tooltip contentStyle={tooltipStyle} cursor={false} />
          <Legend />
          <Bar dataKey={props.barKey} fill={barFill} radius={[4, 4, 0, 0]} />
          <Line
            type="monotone"
            dataKey={props.lineKey}
            stroke={lineStroke}
            strokeWidth={2}
            dot={{ r: 3, fill: lineStroke }}
            activeDot={{ r: 5 }}
          />
        </RechartsComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export const extraChartComponents = {
  AreaChart: ChartAreaChart,
  ScatterChart: ChartScatterChart,
  RadarChart: ChartRadarChart,
  StackedBarChart: ChartStackedBarChart,
  ComposedChart: ChartComposedChart,
};
