import { z } from 'zod';
export type CanvasNodeType = 'markdown' | 'mcp-app' | 'webpage' | 'json-render' | 'graph' | 'board' | 'prompt' | 'response' | 'status' | 'context' | 'ledger' | 'trace' | 'file' | 'diff' | 'mermaid' | 'image' | 'html' | 'group';
export type CanvasNodeProvenanceSourceKind = 'workspace-file' | 'webpage-url' | 'mcp-tool' | 'artifact-file' | 'image-url' | 'recipe';
export type CanvasNodeRefreshStrategy = 'file-watch' | 'file-read-write' | 'image-reload' | 'webpage-refresh' | 'mcp-app-rehydrate' | 'artifact-reopen' | 'agent-request';
declare const observedSourceSchema: z.ZodObject<{
    boardId: z.ZodString;
    cardId: z.ZodString;
    contentRevision: z.ZodOptional<z.ZodNumber>;
    observedAt: z.ZodOptional<z.ZodISODateTime>;
    availability: z.ZodOptional<z.ZodEnum<{
        live: "live";
        cached: "cached";
        unavailable: "unavailable";
    }>>;
}, z.core.$strip>;
declare const recipeSchema: z.ZodObject<{
    tool: z.ZodString;
    input: z.ZodOptional<z.ZodUnknown>;
    prompt: z.ZodString;
}, z.core.$strip>;
export interface CanvasNodeProvenance {
    sourceKind: CanvasNodeProvenanceSourceKind;
    sourceUri: string;
    refreshStrategy: CanvasNodeRefreshStrategy;
    snapshotContent: boolean;
    syncedAt?: string;
    sources?: Array<z.infer<typeof observedSourceSchema>>;
    recipe?: z.infer<typeof recipeSchema>;
    details?: Record<string, unknown>;
}
export declare function inferCanvasNodeProvenance(nodeType: CanvasNodeType, data: Record<string, unknown>): CanvasNodeProvenance | null;
export declare function normalizeCanvasNodeData<T extends Record<string, unknown>>(nodeType: CanvasNodeType, data: T): T;
export {};
