import { type Operation } from '../types.js';
export interface BatchEnvelope {
    ok: boolean;
    results: Array<Record<string, unknown>>;
    refs: Record<string, unknown>;
    failedIndex?: number;
    error?: string;
}
export declare const batchOperations: Operation[];
/**
 * Typed SDK entry point: run a batch through the registry's single execution
 * path (`executeOperation('canvas.batch')`). The op emits the one final
 * canvas-layout-update itself, so callers must NOT emit again.
 */
export declare function runCanvasBatchOperation(operations: Array<{
    op: string;
    assign?: string;
    args?: Record<string, unknown>;
}>): Promise<BatchEnvelope>;
