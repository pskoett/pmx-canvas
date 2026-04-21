import { type JsonRenderComponentDescriptor } from '../json-render/catalog.js';
import { type GraphNodeInput, type JsonRenderSpec } from '../json-render/server.js';
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
    fields: CanvasCreateField[];
    example: Record<string, unknown>;
    notes?: string[];
}
export interface StructuredValidationResult {
    ok: true;
    type: 'json-render' | 'graph';
    normalizedSpec: JsonRenderSpec;
    summary: Record<string, unknown>;
}
export declare function describeCanvasSchema(): {
    ok: true;
    source: 'running-server';
    version: string | null;
    nodeTypes: CanvasCreateTypeSchema[];
    jsonRender: {
        rootShape: Record<string, string>;
        components: JsonRenderComponentDescriptor[];
    };
    graph: {
        graphTypes: Array<'line' | 'bar' | 'pie'>;
    };
    mcp: {
        tools: string[];
        resources: string[];
    };
};
export declare function validateStructuredCanvasPayload(input: {
    type: 'json-render' | 'graph';
    spec?: unknown;
    graph?: GraphNodeInput;
}): StructuredValidationResult;
