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
    barColor?: string;
    lineColor?: string;
    height?: number;
    x?: number;
    y?: number;
    width?: number;
    heightPx?: number;
}
export declare const JSON_RENDER_NODE_SIZE: {
    width: number;
    height: number;
};
export declare const GRAPH_NODE_SIZE: {
    width: number;
    height: number;
};
export type GraphChartType = 'LineChart' | 'BarChart' | 'PieChart' | 'AreaChart' | 'ScatterChart' | 'RadarChart' | 'StackedBarChart' | 'ComposedChart';
export declare function inferJsonRenderNodeTitle(spec: JsonRenderSpec, fallback?: string): string;
export declare function normalizeAndValidateJsonRenderSpec(spec: unknown): JsonRenderSpec;
export declare function normalizeGraphType(value: string): GraphChartType;
export declare function buildGraphSpec(input: GraphNodeInput): JsonRenderSpec;
export declare function createJsonRenderNodeData(nodeId: string, title: string, spec: JsonRenderSpec, extra?: Record<string, unknown>): Record<string, unknown>;
export declare function buildJsonRenderViewerHtml(options: {
    title: string;
    spec: JsonRenderSpec;
    theme?: 'dark' | 'light' | 'high-contrast';
}): Promise<string>;
