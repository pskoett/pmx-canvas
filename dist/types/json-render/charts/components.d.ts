/** @jsxImportSource react */
import type { BaseComponentProps } from '@json-render/react';
type AggregateMode = 'sum' | 'count' | 'avg';
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
declare function ChartLineChart({ props }: BaseComponentProps<CartesianChartProps>): import("react/jsx-runtime").JSX.Element;
declare function ChartBarChart({ props }: BaseComponentProps<CartesianChartProps>): import("react/jsx-runtime").JSX.Element;
declare function ChartPieChart({ props }: BaseComponentProps<PieChartProps>): import("react/jsx-runtime").JSX.Element;
export declare const chartComponents: {
    LineChart: typeof ChartLineChart;
    BarChart: typeof ChartBarChart;
    PieChart: typeof ChartPieChart;
};
export {};
