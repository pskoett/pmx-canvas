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
  'node.get',
  'pinned-context.get',
  'ax.context.get',
  'ax.get',
  'summary.get',
  'spatial.get',
  'layout.get',
  'context.get',
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
export function deliveredIds(payloadText: string): Set<string> {
  const delivered = new Set<string>();
  const objectStarts: number[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < payloadText.length; index += 1) {
    const character = payloadText[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      objectStarts.push(index);
    } else if (character === '}' && objectStarts.length > 0) {
      const start = objectStarts.pop();
      if (start === undefined) continue;
      try {
        const value = JSON.parse(payloadText.slice(start, index + 1)) as unknown;
        if (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          (typeof (value as { id?: unknown }).id === 'string' ||
            (typeof (value as { nodeId?: unknown }).nodeId === 'string' &&
              (value as { titleOnly?: unknown }).titleOnly !== true &&
              typeof (value as { text?: unknown }).text === 'string'))
        ) {
          delivered.add(
            typeof (value as { id?: unknown }).id === 'string'
              ? (value as { id: string }).id
              : (value as { nodeId: string }).nodeId,
          );
        }
      } catch {
        // An inner object may be complete even when its containing object was clipped.
      }
    }
  }

  return delivered;
}

/** Pinned nodes whose content is in what the reader received (see `deliveredIds`). */
export function deliveredPinnedIds(pinnedNodeIds: string[], payloadText: string): string[] {
  const delivered = deliveredIds(payloadText);
  return pinnedNodeIds.filter((id) => delivered.has(id));
}

export function contextReadFromPayload(
  base: Omit<ContextReadInput, 'deliveredNodeIds' | 'bytes' | 'readNodeIds'>,
  payload: unknown,
): ContextReadInput {
  const text = typeof payload === 'string' ? payload : (JSON.stringify(payload) ?? '');
  const delivered = deliveredIds(text);
  return {
    ...base,
    deliveredNodeIds: base.pinnedNodeIds.filter((id) => delivered.has(id)),
    readNodeIds: [...delivered],
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
    bytes INTEGER NOT NULL DEFAULT 0,
    board_id TEXT,
    read_nodes TEXT NOT NULL DEFAULT '{}'
  );
`;

export function appendContextReadToDB(
  db: Database,
  input: ContextReadInput,
  boardId: string | null,
  readNodes: Record<string, number> = {},
): ContextRead {
  const id = `read-${randomUUID()}`;
  const at = new Date().toISOString();
  db.run(
    'INSERT INTO context_reads (id, at, channel, resource, source, consumer, agent_id, pinned_node_ids, delivered_node_ids, bytes, board_id, read_nodes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
      boardId,
      JSON.stringify(readNodes),
    ],
  );
  const seq = Number(db.query<{ seq: number }, []>('SELECT last_insert_rowid() AS seq').get()?.seq ?? 0);
  db.run('DELETE FROM context_reads WHERE seq <= ?', [seq - CONTEXT_READ_RETENTION]);
  const { readNodeIds: _readNodeIds, ...record } = input;
  return { ...record, seq, id, at, boardId, readNodes };
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
  board_id: string | null;
  read_nodes: string;
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
    readNodes: JSON.parse(row.read_nodes) as Record<string, number>,
    bytes: row.bytes,
    boardId: row.board_id,
  };
}

/** Per node on a board, the latest agent read that delivered its content (newest row wins). */
export function loadNodeReadStatusFromDB(db: Database, boardId: string): NodeReadStatus[] {
  const rows = db
    .query<ContextReadRow, [string]>('SELECT * FROM context_reads WHERE board_id = ? ORDER BY seq DESC')
    .all(boardId);
  const status = new Map<string, NodeReadStatus>();
  for (const read of rows.map(rowToContextRead)) {
    for (const [nodeId, readRevision] of Object.entries(read.readNodes)) {
      const known = status.get(nodeId);
      if (known) {
        known.readCount += 1;
        continue;
      }
      status.set(nodeId, {
        nodeId,
        lastReadAt: read.at,
        lastReadBy: read.consumer ?? read.agentId ?? read.source,
        readRevision,
        readCount: 1,
      });
    }
  }
  return [...status.values()];
}

/** Every node on a board whose content an agent read at or after `since` (ISO). */
export function loadReadNodeIdsSince(db: Database, boardId: string, since: string): string[] {
  const rows = db
    .query<{ read_nodes: string }, [string, string]>(
      'SELECT read_nodes FROM context_reads WHERE board_id = ? AND at >= ? ORDER BY seq',
    )
    .all(boardId, since);
  const ids = new Set<string>();
  for (const row of rows) for (const id of Object.keys(JSON.parse(row.read_nodes) as object)) ids.add(id);
  return [...ids];
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
      const pins = new Set(read.pinnedNodeIds);
      const delivered = new Set(read.deliveredNodeIds);
      if (delivered.size === pins.size && [...delivered].every((id) => pins.has(id))) {
        entry.readsDeliveringAllPins += 1;
      }
    }
    if (read.at > entry.lastReadAt) entry.lastReadAt = read.at;
    entry.resources[read.resource] = (entry.resources[read.resource] ?? 0) + 1;
    byConsumer.set(key, entry);
  }
  return [...byConsumer.values()].sort((a, b) => b.lastReadAt.localeCompare(a.lastReadAt));
}
