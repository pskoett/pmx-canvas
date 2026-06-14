import { type Operation } from '../types.js';
/** Legacy server.ts parseGraphPayloadData: a graph dataset must be an array of records. */
export declare function parseGraphPayloadData(value: unknown): Array<Record<string, unknown>> | null;
export interface StreamJsonRenderInput {
    nodeId?: string;
    title?: string;
    patches?: unknown[];
    done?: boolean;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    strictSize?: boolean;
}
export interface StreamJsonRenderResult {
    id: string;
    url: string;
    ok: true;
    applied: number;
    skipped: number;
    specVersion: number;
    elementCount: number;
    streamStatus: 'open' | 'closed';
}
/**
 * Create-or-append core for streaming json-render nodes (the SDK's
 * streamJsonRenderNode wraps this directly). Throws OperationError(400) when
 * the append target is missing or not a json-render node.
 */
export declare function streamJsonRenderCore(input: StreamJsonRenderInput): StreamJsonRenderResult;
export declare const jsonRenderOperations: Operation[];
