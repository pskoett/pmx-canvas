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
declare function ChartSparkline({ props }: BaseComponentProps<SparklineProps>): import("react/jsx-runtime").JSX.Element;
interface DotPlotProps {
    title?: string | null;
    data: Record<string, unknown>[];
    labelKey: string;
    valueKey: string;
    color?: string | null;
    sort?: 'asc' | 'desc' | 'none' | null;
    height?: number | null;
}
declare function ChartDotPlot({ props }: BaseComponentProps<DotPlotProps>): import("react/jsx-runtime").JSX.Element;
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
declare function ChartBulletChart({ props }: BaseComponentProps<BulletChartProps>): import("react/jsx-runtime").JSX.Element;
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
declare function ChartSlopegraph({ props }: BaseComponentProps<SlopegraphProps>): import("react/jsx-runtime").JSX.Element;
export declare const tufteChartComponents: {
    Sparkline: typeof ChartSparkline;
    DotPlot: typeof ChartDotPlot;
    BulletChart: typeof ChartBulletChart;
    Slopegraph: typeof ChartSlopegraph;
};
export {};
