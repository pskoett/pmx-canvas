/** @jsxImportSource react */
/**
 * Chart component implementations for json-render.
 *
 * Built on Recharts, following the same pattern as the Vercel json-render
 * chat example. Each component receives BaseComponentProps<T> and renders
 * a responsive chart inside a styled container.
 */
import { type ReactNode } from 'react';
import type { BaseComponentProps } from '@json-render/react';
export declare const CHART_COLORS: string[];
export type AggregateMode = 'sum' | 'count' | 'avg';
export declare function processChartData(data: Record<string, unknown>[], xKey: string, yKey: string, aggregate: AggregateMode | null | undefined): Record<string, unknown>[];
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
export declare const chartMargin: {
    top: number;
    right: number;
    bottom: number;
    left: number;
};
export declare const polarChartMargin: {
    top: number;
    right: number;
    bottom: number;
    left: number;
};
export declare const axisTickMargin = 8;
export declare const legendMargin: {
    top: number;
};
export declare function useChartFrameHeight(explicitHeight: number | null | undefined, fallbackHeight?: number): {
    frameRef: import("react").RefObject<HTMLDivElement | null>;
    height: number;
    width: number;
};
/**
 * Height available for the plotted SVG inside `.pmx-chart`, i.e. the measured
 * frame height minus the non-plot chrome: the `.pmx-chart__title` block (~24px
 * of text + margin, only when a title is shown) plus the chart's own vertical
 * padding. Sizing the SVG to this — instead of the full frame height — keeps a
 * filled chart's title+plot within the frame so it doesn't push a scrollbar onto
 * the single iframe-document scroller. Dense charts still exceed it and scroll
 * (one scrollbar, as expected).
 */
export declare function chartPlotHeight(height: number, hasTitle: boolean): number;
/** Shared wrapper for cartesian charts (Line + Bar). */
export declare function CartesianChart({ props, children, className, }: {
    props: CartesianChartProps;
    children: (data: Record<string, unknown>[]) => ReactNode;
    className?: string;
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
