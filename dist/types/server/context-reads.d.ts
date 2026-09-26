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
    bytes: number;
}
export type ContextReadInput = Omit<ContextRead, 'seq' | 'id' | 'at'>;
export interface ContextReadConsumerSummary {
    consumer: string;
    reads: number;
    readsWithPins: number;
    readsDeliveringAllPins: number;
    lastReadAt: string;
    resources: Record<string, number>;
}
/**
 * Pinned nodes whose serialized node (an object carrying `"id": "<id>"`) is in
 * what the reader received. A bare id list, a title, or a clipped-off node does
 * not count — the agent got the pin's name, not its content.
 */
export declare function deliveredPinnedIds(pinnedNodeIds: string[], payloadText: string): string[];
export declare function contextReadFromPayload(base: Omit<ContextReadInput, 'deliveredNodeIds' | 'bytes'>, payload: unknown): ContextReadInput;
export declare const CONTEXT_READS_SCHEMA_SQL = "\n  CREATE TABLE IF NOT EXISTS context_reads (\n    seq INTEGER PRIMARY KEY AUTOINCREMENT,\n    id TEXT NOT NULL UNIQUE,\n    at TEXT NOT NULL,\n    channel TEXT NOT NULL,\n    resource TEXT NOT NULL,\n    source TEXT NOT NULL,\n    consumer TEXT,\n    agent_id TEXT,\n    pinned_node_ids TEXT NOT NULL DEFAULT '[]',\n    delivered_node_ids TEXT NOT NULL DEFAULT '[]',\n    bytes INTEGER NOT NULL DEFAULT 0\n  );\n";
export declare function appendContextReadToDB(db: Database, input: ContextReadInput): ContextRead;
/** Newest first. The summary covers every retained row, not just the returned page. */
export declare function loadContextReadsFromDB(db: Database, limit?: number): {
    reads: ContextRead[];
    summary: ContextReadConsumerSummary[];
};
export declare function summarizeContextReads(reads: ContextRead[]): ContextReadConsumerSummary[];
