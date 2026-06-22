export interface JsonRenderSpec {
    root: string;
    elements: Record<string, unknown>;
    state?: Record<string, unknown>;
}
export interface JsonRenderNodeInput {
    title?: string;
    spec: unknown;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    strictSize?: boolean;
}
export interface GraphNodeInput {
    title?: string;
    graphType: string;
    data: Array<Record<string, unknown>>;
    xKey?: string;
    yKey?: string;
    zKey?: string;
    nameKey?: string;
    valueKey?: string;
    axisKey?: string;
    metrics?: string[];
    series?: string[];
    barKey?: string;
    lineKey?: string;
    aggregate?: 'sum' | 'count' | 'avg';
    color?: string;
    colorBy?: 'series' | 'category' | 'value' | 'none';
    highlight?: number | 'max' | 'min' | null;
    barColor?: string;
    lineColor?: string;
    labelKey?: string;
    beforeKey?: string;
    afterKey?: string;
    beforeLabel?: string;
    afterLabel?: string;
    targetKey?: string;
    rangesKey?: string;
    sort?: 'asc' | 'desc' | 'none';
    fill?: boolean;
    showEndDot?: boolean;
    showMinMax?: boolean;
    showValue?: boolean;
    colorByDirection?: boolean;
    height?: number;
    showLegend?: boolean;
    showLabels?: boolean;
    x?: number;
    y?: number;
    width?: number;
    heightPx?: number;
    strictSize?: boolean;
}
export declare const JSON_RENDER_NODE_SIZE: {
    width: number;
    height: number;
};
export declare const GRAPH_NODE_SIZE: {
    width: number;
    height: number;
};
export type GraphChartType = 'LineChart' | 'BarChart' | 'PieChart' | 'AreaChart' | 'ScatterChart' | 'RadarChart' | 'StackedBarChart' | 'ComposedChart' | 'Sparkline' | 'DotPlot' | 'BulletChart' | 'Slopegraph';
export declare function inferJsonRenderNodeTitle(spec: JsonRenderSpec, fallback?: string): string;
export declare function normalizeAndValidateJsonRenderSpec(spec: unknown): JsonRenderSpec;
export declare function normalizeGraphType(value: string): GraphChartType;
export declare function buildGraphSpec(input: GraphNodeInput): JsonRenderSpec;
export declare function buildGraphConfig(input: GraphNodeInput): Record<string, unknown>;
/** The minimal spec a streaming json-render node starts from before any patches. */
export declare function emptyStreamingSpec(): JsonRenderSpec;
/**
 * Apply a batch of SpecStream patches to the current spec, accumulating the
 * result. The canvas is the source of truth — patches are applied server-side
 * and the browser only renders the current accumulated spec, so there is no
 * client-side reconciliation. Tolerant by design: malformed or inapplicable
 * patches are skipped and counted, never thrown, so a partial stream keeps
 * building toward the final spec.
 */
export declare function applyJsonRenderStreamPatches(currentSpec: JsonRenderSpec, items: unknown[]): {
    spec: JsonRenderSpec;
    applied: number;
    skipped: number;
};
export declare function createJsonRenderNodeData(nodeId: string, title: string, spec: JsonRenderSpec, extra?: Record<string, unknown>): Record<string, unknown>;
export declare function buildJsonRenderViewerHtml(options: {
    title: string;
    spec: JsonRenderSpec;
    theme?: 'dark' | 'light' | 'high-contrast';
    display?: 'expanded' | 'site';
    devtools?: boolean;
    nodeId?: string;
    axToken?: string;
    axState?: unknown;
    /** Nonce for the content-height reporter so the node can grow to fit the chart. */
    frameToken?: string;
    /** When true, charts render at their natural (intrinsic) height instead of
     *  filling the viewport down — so the reported scrollHeight is stable and the
     *  node grows to it. Off for strictSize / user-resized nodes (they fill-down). */
    fitContent?: boolean;
}): Promise<string>;
