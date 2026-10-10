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
    /** Per node, the newest links revision an agent read carried. */
    links?: Record<string, number>;
    pins?: Record<string, ContextPinMeta>;
}
export declare const nodeReadStatus: import("@preact/signals-core").Signal<Map<string, NodeReadStatus>>;
export declare const contextPinMeta: import("@preact/signals-core").Signal<Record<string, ContextPinMeta>>;
export declare const seenLinks: import("@preact/signals-core").Signal<Record<string, number>>;
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
/**
 * The marks a link's pill carries (docs/design/LinkAuthorship.dc.html):
 * - `agent`: the agent that drew or last relabelled it — a ✦ that stays until
 *   a person edits, retypes or relabels the link. A read never clears it.
 * - `notSeen`: a person's new or edited link that no read has carried yet —
 *   temporary, cleared by the agent's next read of either end. Quiet until an
 *   agent has read this board at all. An agent's link is never "not seen".
 * The board's only person draws without a mark (another person's initial is
 * Part 3, shared boards).
 */
export interface LinkMarks {
    agent: string | null;
    notSeen: boolean;
}
export declare function linkMarks(edge: {
    from: string;
    to: string;
    revision?: number;
    changedBy?: {
        actor: string;
        source: string;
        agentId?: string;
    };
}): LinkMarks;
/**
 * A card whose links changed after the last read that carried them (shown
 * neutral, never amber). A link an agent drew does not count — that agent
 * made it, and the link itself says "by <agent>". A removed link has no
 * author left to check, so it counts.
 */
export declare function linksChanged(nodeId: string, linksRevision: number): boolean;
/** Display name for an attributed writer: its agent id, else its transport label. */
export declare function writerName(actor: {
    source: string;
    agentId?: string;
}): string;
export {};
