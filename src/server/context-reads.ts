/**
 * Context read instrumentation (vision Part 1 item 4, the delivery half):
 * one row per agent read of canvas context — which surface, by whom, and
 * which pinned nodes were in what came back. Diagnostics only, like the AX
 * timeline: never snapshotted, never cleared with the canvas, bounded, and
 * recording never notifies (a read must not trigger more reads).
 */
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

export const CONTEXT_READ_RETENTION = 5000;
const CONTEXT_READ_DEFAULT_LIMIT = 50;
const CONTEXT_READ_MAX_LIMIT = 500;

export const CONTEXT_READ_CHANNELS = ['operation', 'mcp-resource', 'mcp-prompt', 'adapter'] as const;
export type ContextReadChannel = (typeof CONTEXT_READ_CHANNELS)[number];

/** Registry reads that hand an agent canvas context; recorded in executeOperation. */
export const CONTEXT_READ_OPS = new Set([
  'pinned-context.get',
  'ax.context.get',
  'ax.get',
  'summary.get',
  'spatial.get',
  'layout.get',
]);

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
export function deliveredPinnedIds(pinnedNodeIds: string[], payloadText: string): string[] {
  return pinnedNodeIds.filter((id) =>
    new RegExp(`"id"\\s*:\\s*${JSON.stringify(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(payloadText),
  );
}

export function contextReadFromPayload(
  base: Omit<ContextReadInput, 'deliveredNodeIds' | 'bytes'>,
  payload: unknown,
): ContextReadInput {
  const text = typeof payload === 'string' ? payload : (JSON.stringify(payload) ?? '');
  return {
    ...base,
    deliveredNodeIds: deliveredPinnedIds(base.pinnedNodeIds, text),
    bytes: Buffer.byteLength(text, 'utf-8'),
  };
}

export const CONTEXT_READS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS context_reads (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    at TEXT NOT NULL,
    channel TEXT NOT NULL,
    resource TEXT NOT NULL,
    source TEXT NOT NULL,
    consumer TEXT,
    agent_id TEXT,
    pinned_node_ids TEXT NOT NULL DEFAULT '[]',
    delivered_node_ids TEXT NOT NULL DEFAULT '[]',
    bytes INTEGER NOT NULL DEFAULT 0
  );
`;

export function appendContextReadToDB(db: Database, input: ContextReadInput): ContextRead {
  const id = `read-${randomUUID()}`;
  const at = new Date().toISOString();
  db.run(
    'INSERT INTO context_reads (id, at, channel, resource, source, consumer, agent_id, pinned_node_ids, delivered_node_ids, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      at,
      input.channel,
      input.resource,
      input.source,
      input.consumer,
      input.agentId,
      JSON.stringify(input.pinnedNodeIds),
      JSON.stringify(input.deliveredNodeIds),
      input.bytes,
    ],
  );
  const seq = Number(db.query<{ seq: number }, []>('SELECT last_insert_rowid() AS seq').get()?.seq ?? 0);
  db.run('DELETE FROM context_reads WHERE seq <= ?', [seq - CONTEXT_READ_RETENTION]);
  return { ...input, seq, id, at };
}

interface ContextReadRow {
  seq: number;
  id: string;
  at: string;
  channel: ContextReadChannel;
  resource: string;
  source: string;
  consumer: string | null;
  agent_id: string | null;
  pinned_node_ids: string;
  delivered_node_ids: string;
  bytes: number;
}

function rowToContextRead(row: ContextReadRow): ContextRead {
  return {
    seq: row.seq,
    id: row.id,
    at: row.at,
    channel: row.channel,
    resource: row.resource,
    source: row.source,
    consumer: row.consumer,
    agentId: row.agent_id,
    pinnedNodeIds: JSON.parse(row.pinned_node_ids) as string[],
    deliveredNodeIds: JSON.parse(row.delivered_node_ids) as string[],
    bytes: row.bytes,
  };
}

/** Newest first. The summary covers every retained row, not just the returned page. */
export function loadContextReadsFromDB(
  db: Database,
  limit?: number,
): { reads: ContextRead[]; summary: ContextReadConsumerSummary[] } {
  const pageSize =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), CONTEXT_READ_MAX_LIMIT)
      : CONTEXT_READ_DEFAULT_LIMIT;
  const rows = db.query<ContextReadRow, []>('SELECT * FROM context_reads ORDER BY seq DESC').all();
  const all = rows.map(rowToContextRead);
  return { reads: all.slice(0, pageSize), summary: summarizeContextReads(all) };
}

export function summarizeContextReads(reads: ContextRead[]): ContextReadConsumerSummary[] {
  const byConsumer = new Map<string, ContextReadConsumerSummary>();
  for (const read of reads) {
    const key = read.consumer ?? read.agentId ?? read.source;
    const entry = byConsumer.get(key) ?? {
      consumer: key,
      reads: 0,
      readsWithPins: 0,
      readsDeliveringAllPins: 0,
      lastReadAt: read.at,
      resources: {},
    };
    entry.reads += 1;
    if (read.pinnedNodeIds.length > 0) {
      entry.readsWithPins += 1;
      if (read.deliveredNodeIds.length === read.pinnedNodeIds.length) entry.readsDeliveringAllPins += 1;
    }
    if (read.at > entry.lastReadAt) entry.lastReadAt = read.at;
    entry.resources[read.resource] = (entry.resources[read.resource] ?? 0) + 1;
    byConsumer.set(key, entry);
  }
  return [...byConsumer.values()].sort((a, b) => b.lastReadAt.localeCompare(a.lastReadAt));
}
