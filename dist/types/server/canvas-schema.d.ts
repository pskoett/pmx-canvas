import { type JsonRenderComponentDescriptor } from '../json-render/catalog.js';
import { type GraphNodeInput, type JsonRenderSpec } from '../json-render/server.js';
import { type HtmlPrimitiveDescriptor } from './html-primitives.js';
export interface CanvasCreateField {
    name: string;
    type: string;
    required: boolean;
    description: string;
    aliases?: string[];
}
export interface CanvasCreateTypeSchema {
    type: string;
    kind: 'node' | 'virtual-node';
    description: string;
    endpoint: string;
    mcpTool?: string;
    fields: CanvasCreateField[];
    example: Record<string, unknown>;
    notes?: string[];
}
export interface StructuredValidationResult {
    ok: true;
    type: 'json-render' | 'graph' | 'html-primitive';
    normalizedSpec?: JsonRenderSpec;
    normalizedPrimitive?: {
        kind: string;
        title: string;
        htmlBytes: number;
        defaultSize: {
            width: number;
            height: number;
        };
    };
    summary: Record<string, unknown>;
}
declare const CANONICAL_GRAPH_TYPES: readonly ["line", "bar", "pie", "area", "scatter", "radar", "stacked-bar", "composed", "sparkline", "dot-plot", "bullet", "slopegraph"];
type CanvasGraphType = typeof CANONICAL_GRAPH_TYPES[number];
export declare function describeCanvasSchema(): {
    ok: true;
    source: 'running-server';
    version: string | null;
    nodeTypes: CanvasCreateTypeSchema[];
    jsonRender: {
        rootShape: Record<string, string>;
        components: JsonRenderComponentDescriptor[];
        directives: Array<{
            name: string;
            usage: string;
        }>;
    };
    graph: {
        graphTypes: CanvasGraphType[];
    };
    htmlPrimitives: HtmlPrimitiveDescriptor[];
    mcp: {
        tools: string[];
        resources: string[];
        nodeTypeRouting: Record<string, string>;
    };
};
export declare function validateStructuredCanvasPayload(input: {
    type: 'json-render' | 'graph' | 'html-primitive';
    spec?: unknown;
    graph?: GraphNodeInput;
    primitive?: {
        kind: string;
        title?: string;
        data?: Record<string, unknown>;
    };
}): StructuredValidationResult;
export {};
