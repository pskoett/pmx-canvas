/**
 * Context read instrumentation (vision Part 1 item 4, the delivery half):
 * one row per agent read of canvas context — which surface, by whom, and
 * which pinned nodes were in what came back. Diagnostics only, like the AX
 * timeline: never snapshotted, never cleared with the canvas, bounded, and
 * recording never notifies (a read must not trigger more reads).
 */
import type { Database } from 'bun:sqlite';
export declare const CONTEXT_READ_RETENTION = 5000;
export declare const CONTEXT_READ_CHANNELS: readonly ["operation", "mcp-resource", "mcp-prompt", "adapter"];
export type ContextReadChannel = (typeof CONTEXT_READ_CHANNELS)[number];
/** Registry reads that hand an agent canvas context; recorded in executeOperation. */
export declare const CONTEXT_READ_OPS: Set<string>;
export interface ContextRead {
    seq: number;
    id: string;
    at: string;
    channel: ContextReadChannel;
    resource: string;
    source: string;
    consumer: string | null;
    agentId: string | null;
    pinnedNodeIds: string[];
    deliveredNodeIds: string[];
    /** Every node on the read board whose content was delivered, with its content revision at read time. */
    readNodes: Record<string, number>;
    bytes: number;
    /** The board open when the read happened (null on Home). */
    boardId: string | null;
}
export type ContextReadInput = Omit<ContextRead, 'seq' | 'id' | 'at' | 'boardId' | 'readNodes'> & {
    /** Explicit read target, captured before asynchronous formatting/proxy work. */
    boardId?: string | null;
    /** Ids of every serialized node in what the reader received; the server keeps those on the board. */
    readNodeIds?: string[];
};
/** One node's read state on a board: the latest agent read that delivered its content. */
export interface NodeReadStatus {
    nodeId: string;
    lastReadAt: string;
    /** Who read it: consumer, else agent id, else transport label. */
    lastReadBy: string;
    /** The node's content revision in that read; newer current revision means "changed since read". */
    readRevision: number;
    /** How many retained agent reads delivered its content. */
    readCount: number;
}
export interface ContextReadConsumerSummary {
    consumer: string;
    reads: number;
    readsWithPins: number;
    readsDeliveringAllPins: number;
    lastReadAt: string;
    resources: Record<string, number>;
}
/**
 * Ids of every serialized node (an object carrying `"id": "<id>"`, or a
 * `nodeId` with its text) in what the reader received. A bare id list, a
 * title, or a clipped-off node does not count — the agent got the node's
 * name, not its content. Non-node ids (edges, intents) are dropped by the
 * caller against the board's nodes.
 */
export declare function deliveredIds(payloadText: string, includeSummaries?: boolean): Set<string>;
/** Pinned nodes whose content is in what the reader received (see `deliveredIds`). */
export declare function deliveredPinnedIds(pinnedNodeIds: string[], payloadText: string): string[];
export declare function contextReadFromPayload(base: Omit<ContextReadInput, 'deliveredNodeIds' | 'bytes' | 'readNodeIds'>, payload: unknown): ContextReadInput;
/**
 * Reads a `context.get` brief made on pinned boards (vision move 0a): one per
 * pinned board whose map arrived, so the board shows as read. Its cards came as
 * summaries, which mark nothing read until the agent pulls them.
 */
export declare function pinnedBoardReads(base: Omit<ContextReadInput, 'deliveredNodeIds' | 'bytes' | 'readNodeIds' | 'pinnedNodeIds' | 'boardId'>, payload: unknown): ContextReadInput[];
export declare const CONTEXT_READS_SCHEMA_SQL = "\n  CREATE TABLE IF NOT EXISTS context_reads (\n    seq INTEGER PRIMARY KEY AUTOINCREMENT,\n    id TEXT NOT NULL UNIQUE,\n    at TEXT NOT NULL,\n    channel TEXT NOT NULL,\n    resource TEXT NOT NULL,\n    source TEXT NOT NULL,\n    consumer TEXT,\n    agent_id TEXT,\n    pinned_node_ids TEXT NOT NULL DEFAULT '[]',\n    delivered_node_ids TEXT NOT NULL DEFAULT '[]',\n    bytes INTEGER NOT NULL DEFAULT 0,\n    board_id TEXT,\n    read_nodes TEXT NOT NULL DEFAULT '{}'\n  );\n";
export declare function appendContextReadToDB(db: Database, input: ContextReadInput, boardId: string | null, readNodes?: Record<string, number>): ContextRead;
/** Per node on a board, the latest agent read that delivered its content (newest row wins). */
export declare function loadNodeReadStatusFromDB(db: Database, boardId: string): NodeReadStatus[];
/** Every node on a board whose content an agent read at or after `since` (ISO). */
export declare function loadReadNodeIdsSince(db: Database, boardId: string, since: string): string[];
/** Newest first. The summary covers every retained row, not just the returned page. */
export declare function loadContextReadsFromDB(db: Database, limit?: number): {
    reads: ContextRead[];
    summary: ContextReadConsumerSummary[];
};
export declare function summarizeContextReads(reads: ContextRead[]): ContextReadConsumerSummary[];
