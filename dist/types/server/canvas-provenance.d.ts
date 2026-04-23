export type CanvasNodeType = 'markdown' | 'mcp-app' | 'webpage' | 'json-render' | 'graph' | 'prompt' | 'response' | 'status' | 'context' | 'ledger' | 'trace' | 'file' | 'image' | 'group';
export type CanvasNodeProvenanceSourceKind = 'workspace-file' | 'webpage-url' | 'mcp-tool' | 'artifact-file' | 'image-url';
export type CanvasNodeRefreshStrategy = 'file-watch' | 'file-read-write' | 'image-reload' | 'webpage-refresh' | 'mcp-app-rehydrate' | 'artifact-reopen';
export interface CanvasNodeProvenance {
    sourceKind: CanvasNodeProvenanceSourceKind;
    sourceUri: string;
    refreshStrategy: CanvasNodeRefreshStrategy;
    snapshotContent: boolean;
    syncedAt?: string;
    details?: Record<string, unknown>;
}
export declare function inferCanvasNodeProvenance(nodeType: CanvasNodeType, data: Record<string, unknown>): CanvasNodeProvenance | null;
export declare function normalizeCanvasNodeData<T extends Record<string, unknown>>(nodeType: CanvasNodeType, data: T): T;
