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
export declare const CHART_COLORS: string[];
export type AggregateMode = 'sum' | 'count' | 'avg';
export declare function processChartData(data: Record<string, unknown>[], xKey: string, yKey: string, aggregate: AggregateMode | null | undefined): Record<string, unknown>[];
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
}
export declare const axisStyle: {
    fontSize: number;
    fill: string;
};
export declare const tooltipStyle: {
    backgroundColor: string;
    border: string;
    borderRadius: string;
    color: string;
    fontSize: number;
};
/** Shared wrapper for cartesian charts (Line + Bar). */
export declare function CartesianChart({ props, children, }: {
    props: CartesianChartProps;
    children: (data: Record<string, unknown>[]) => ReactNode;
}): import("react/jsx-runtime").JSX.Element;
declare function ChartLineChart({ props }: BaseComponentProps<CartesianChartProps>): import("react/jsx-runtime").JSX.Element;
declare function ChartBarChart({ props }: BaseComponentProps<CartesianChartProps>): import("react/jsx-runtime").JSX.Element;
declare function ChartPieChart({ props }: BaseComponentProps<PieChartProps>): import("react/jsx-runtime").JSX.Element;
export declare const chartComponents: {
    LineChart: typeof ChartLineChart;
    BarChart: typeof ChartBarChart;
    PieChart: typeof ChartPieChart;
};
export {};
