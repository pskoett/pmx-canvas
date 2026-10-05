/**
 * What agents did with the board's context (docs/design/AgentContext.dc.html):
 * per node, the latest agent read of its content and the revision it read;
 * per pin, who pinned it, when and why. Server truth from
 * `GET /api/canvas/ax/context-status`, refetched when a read lands
 * (`context-status-changed`), when pins change, and on (re)connect.
 */
export interface NodeReadStatus {
    nodeId: string;
    lastReadAt: string;
    lastReadBy: string;
    readRevision: number;
    readCount: number;
}
export interface ContextPinMeta {
    pinnedBy: {
        actor: 'human' | 'agent' | 'system' | 'unknown';
        source: string;
        agentId?: string;
    };
    pinnedAt: string;
    reason?: string;
}
interface ContextStatusResponse {
    ok?: boolean;
    boardId?: string | null;
    nodes?: NodeReadStatus[];
    pins?: Record<string, ContextPinMeta>;
}
export declare const nodeReadStatus: import("@preact/signals-core").Signal<Map<string, NodeReadStatus>>;
export declare const contextPinMeta: import("@preact/signals-core").Signal<Record<string, ContextPinMeta>>;
export declare function applyContextStatus(response: ContextStatusResponse): void;
export declare function refreshContextStatus(): Promise<void>;
/** How an agent's context relates to one pinned node — the mark its header shows. */
export type PinnedReadState = {
    kind: 'not-read';
} | {
    kind: 'read';
    by: string;
    at: string;
    count: number;
} | {
    kind: 'changed';
    by: string;
    at: string;
};
export declare function pinnedReadState(nodeId: string, currentRevision: number): PinnedReadState;
/** Display name for an attributed writer: its agent id, else its transport label. */
export declare function writerName(actor: {
    source: string;
    agentId?: string;
}): string;
export {};
