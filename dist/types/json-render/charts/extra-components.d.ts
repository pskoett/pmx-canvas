/** @jsxImportSource react */
/**
 * Additional chart components for json-render.
 *
 * Lives alongside ./components.tsx so the original chart set stays
 * unchanged and the merge point in ./catalog.ts is the only contact
 * surface with the upstream `@json-render/*` packages.
 */
import type { BaseComponentProps } from '@json-render/react';
import { type CartesianChartProps } from './components';
type AreaChartProps = CartesianChartProps;
declare function ChartAreaChart({ props }: BaseComponentProps<AreaChartProps>): import("react/jsx-runtime").JSX.Element;
interface ScatterChartProps {
    title?: string | null;
    data: Record<string, unknown>[];
    xKey: string;
    yKey: string;
    zKey?: string | null;
    color?: string | null;
    height?: number | null;
}
declare function ChartScatterChart({ props }: BaseComponentProps<ScatterChartProps>): import("react/jsx-runtime").JSX.Element;
interface RadarChartProps {
    title?: string | null;
    data: Record<string, unknown>[];
    axisKey: string;
    metrics: string[];
    height?: number | null;
}
declare function ChartRadarChart({ props }: BaseComponentProps<RadarChartProps>): import("react/jsx-runtime").JSX.Element;
interface StackedBarChartProps {
    title?: string | null;
    data: Record<string, unknown>[];
    xKey: string;
    series: string[];
    aggregate?: 'sum' | 'count' | 'avg' | null;
    height?: number | null;
}
declare function ChartStackedBarChart({ props }: BaseComponentProps<StackedBarChartProps>): import("react/jsx-runtime").JSX.Element;
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
declare function ChartComposedChart({ props }: BaseComponentProps<ComposedChartProps>): import("react/jsx-runtime").JSX.Element;
export declare const extraChartComponents: {
    AreaChart: typeof ChartAreaChart;
    ScatterChart: typeof ChartScatterChart;
    RadarChart: typeof ChartRadarChart;
    StackedBarChart: typeof ChartStackedBarChart;
    ComposedChart: typeof ChartComposedChart;
};
export {};
