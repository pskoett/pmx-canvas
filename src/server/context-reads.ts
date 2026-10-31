/**
 * Context read instrumentation (vision Part 1 item 4, the delivery half):
 * one row per agent read of canvas context — which surface, by whom, and
 * which pinned nodes were in what came back. Diagnostics only, like the AX
 * timeline: never snapshotted, never cleared with the canvas, bounded, and
 * recording never notifies (a read must not trigger more reads).
 */
import type { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { CARD_HISTORY_CTE } from './card-relocation.js';
import type { MemoryGraph } from '../shared/memory-graph.js';
import type { CompiledContextEntry } from './context-brief.js';
import { OperationError } from './operations/types.js';

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
  'memory-graph.get',
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
  /** Every node on the read board that arrived with its relations (summaries count), with its links revision then. */
  seenLinks: Record<string, number>;
  bytes: number;
  /** The board open when the read happened (null on Home). */
  boardId: string | null;
}

export type ContextReadInput = Omit<ContextRead, 'seq' | 'id' | 'at' | 'boardId' | 'readNodes' | 'seenLinks'> & {
  /** Stable adapter receipt identity. Retries record this delivery once per consumer and board. */
  deliveryId?: string;
  /** Explicit read target, captured before asynchronous formatting/proxy work. */
  boardId?: string | null;
  /** Ids of every serialized node in what the reader received; the server keeps those on the board. */
  readNodeIds?: string[];
  /** Ids of every node that arrived, summaries included; defaults to readNodeIds. */
  seenNodeIds?: string[];
  /** Exact link clocks captured in the delivered projection, before asynchronous transport work. */
  seenLinkRevisions?: Record<string, number>;
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
 * caller against the board's nodes. A summary is "seen", not "read": `read`
 * holds only nodes pulled in full and `reached` adds the summaries. Content
 * delivery alone never establishes that the card's relations were delivered.
 */
export function deliveredIds(payloadText: string): { read: Set<string>; reached: Set<string> } {
  const read = new Set<string>();
  const reached = new Set<string>();
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
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const item = value as {
            id?: unknown;
            nodeId?: unknown;
            titleOnly?: unknown;
            summaryOnly?: unknown;
            text?: unknown;
          };
          if (typeof item.id === 'string') {
            read.add(item.id);
            reached.add(item.id);
          } else if (typeof item.nodeId === 'string' && item.titleOnly !== true && typeof item.text === 'string') {
            reached.add(item.nodeId);
            if (item.summaryOnly !== true) read.add(item.nodeId);
          }
        }
      } catch {
        // An inner object may be complete even when its containing object was clipped.
      }
    }
  }

  return { read, reached };
}

/** Only complete, board-qualified brief relations can acknowledge their captured clock. */
function briefLinkRevisions(entries: Partial<CompiledContextEntry>[], boardId: string): Record<string, number> {
  return Object.fromEntries(
    entries.flatMap((entry) =>
      entry.sourceBoardId === boardId &&
      typeof entry.nodeId === 'string' &&
      !entry.nodeId.startsWith('board:') &&
      typeof entry.text === 'string' &&
      entry.titleOnly !== true &&
      entry.truncated !== true &&
      entry.linksComplete !== false &&
      typeof entry.linksRevision === 'number' &&
      Number.isSafeInteger(entry.linksRevision) &&
      entry.linksRevision >= 0
        ? [[entry.nodeId, entry.linksRevision]]
        : [],
    ),
  );
}

export function contextReadFromPayload(
  base: Omit<ContextReadInput, 'deliveredNodeIds' | 'bytes' | 'readNodeIds'>,
  payload: unknown,
): ContextReadInput {
  const text = typeof payload === 'string' ? payload : (JSON.stringify(payload) ?? '');
  let delivered = text;
  let seenLinkRevisions: Record<string, number> = {};
  try {
    const document = JSON.parse(text) as {
      board?: { boardId?: string };
      entries?: Partial<CompiledContextEntry>[];
    };
    if (document.board?.boardId && Array.isArray(document.entries)) {
      // A brief carries several boards. Bare IDs from a remote README must
      // never acknowledge a same-ID card on the open board.
      const entries = document.entries.filter(
        (entry) => entry.sourceBoardId === (base.boardId ?? document.board?.boardId),
      );
      delivered = JSON.stringify(entries);
      seenLinkRevisions = briefLinkRevisions(entries, base.boardId ?? document.board.boardId);
    }
  } catch {
    // Non-JSON and clipped payloads keep the complete-object delivery scanner.
  }
  // Delivery (did the pins reach the agent?) counts summaries; read marks do not.
  const { read, reached } = deliveredIds(delivered);
  return {
    ...base,
    deliveredNodeIds: base.pinnedNodeIds.filter((id) => reached.has(id)),
    readNodeIds: [...read],
    seenNodeIds: Object.keys(seenLinkRevisions),
    seenLinkRevisions,
    bytes: Buffer.byteLength(text, 'utf-8'),
  };
}

/**
 * Reads a `context.get` brief made on pinned boards (vision move 0a): one per
 * pinned board whose map arrived, so the board shows as read. Its cards came as
 * summaries, which mark nothing read until the agent pulls them; only summaries
 * with complete, unclipped relations count as links seen on that board.
 */
export function pinnedBoardReads(
  base: Omit<ContextReadInput, 'deliveredNodeIds' | 'bytes' | 'readNodeIds' | 'pinnedNodeIds' | 'boardId'>,
  payload: unknown,
): ContextReadInput[] {
  let document: unknown = payload;
  if (typeof payload === 'string') {
    try {
      document = JSON.parse(payload);
    } catch {
      return [];
    }
  }
  const entries = (document as { entries?: Partial<CompiledContextEntry>[] } | null)?.entries ?? [];
  return entries
    .filter(
      (entry) =>
        entry.reason === 'pinned-board' &&
        typeof entry.sourceBoardId === 'string' &&
        entry.nodeId === `board:${entry.sourceBoardId}`,
    )
    .map((entry) => {
      const boardId = entry.sourceBoardId as string;
      const seenLinkRevisions = briefLinkRevisions(entries, boardId);
      return {
        ...base,
        boardId,
        pinnedNodeIds: [],
        deliveredNodeIds: [],
        readNodeIds: [],
        seenNodeIds: Object.keys(seenLinkRevisions),
        seenLinkRevisions,
        bytes: Buffer.byteLength(JSON.stringify(entry), 'utf-8'),
      };
    });
}

/** Graph summaries are seen on their own boards, never full-content reads or a board switch. */
export function graphReads(
  base: Pick<ContextReadInput, 'channel' | 'resource' | 'source' | 'consumer' | 'agentId'>,
  graph: MemoryGraph,
): ContextReadInput[] {
  const boards = new Set(graph.nodes.map((node) => node.boardId));
  return [...boards].map((boardId) => {
    const nodes = graph.nodes.filter((node) => node.boardId === boardId);
    return {
      ...base,
      boardId,
      pinnedNodeIds: [],
      deliveredNodeIds: [],
      readNodeIds: [],
      seenNodeIds: nodes.flatMap((node) => (node.cardId && node.linksComplete !== false ? [node.cardId] : [])),
      seenLinkRevisions: Object.fromEntries(
        nodes.flatMap((node) =>
          node.cardId && typeof node.linksRevision === 'number' ? [[node.cardId, node.linksRevision]] : [],
        ),
      ),
      bytes: Buffer.byteLength(JSON.stringify(nodes), 'utf-8'),
    };
  });
}

export const CONTEXT_READS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS context_read_receipts (id TEXT PRIMARY KEY);
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
    read_nodes TEXT NOT NULL DEFAULT '{}',
    seen_links TEXT NOT NULL DEFAULT '{}'
  );
`;

export function appendContextReadToDB(
  db: Database,
  input: ContextReadInput,
  boardId: string | null,
  readNodes: Record<string, number> = {},
  seenLinks: Record<string, number> = {},
): ContextRead {
  return db.transaction(() => {
    const id = input.deliveryId
      ? `read-${createHash('sha256')
          .update(JSON.stringify([input.source, input.consumer, boardId, input.deliveryId]))
          .digest('hex')}`
      : `read-${randomUUID()}`;
    if (input.deliveryId) {
      const existing = db.query<ContextReadRow, [string]>('SELECT * FROM context_reads WHERE id = ?').get(id);
      if (existing) {
        db.run('INSERT OR IGNORE INTO context_read_receipts VALUES (?)', [id]);
        return rowToContextRead(existing);
      }
      if (db.query('SELECT id FROM context_read_receipts WHERE id = ?').get(id))
        throw new OperationError('Context receipt expired. Obtain fresh context instead of retrying this token.', 409, {
          code: 'context_receipt_expired',
        });
    }
    const at = new Date().toISOString();
    db.run(
      'INSERT INTO context_reads (id, at, channel, resource, source, consumer, agent_id, pinned_node_ids, delivered_node_ids, bytes, board_id, read_nodes, seen_links) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
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
        JSON.stringify(seenLinks),
      ],
    );
    const row = db.query<ContextReadRow, [string]>('SELECT * FROM context_reads WHERE id = ?').get(id)!;
    if (input.deliveryId) db.run('INSERT INTO context_read_receipts VALUES (?)', [id]);
    db.run('DELETE FROM context_reads WHERE seq <= ?', [row.seq - CONTEXT_READ_RETENTION]);
    return rowToContextRead(row);
  })();
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
  seen_links: string;
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
    seenLinks: JSON.parse(row.seen_links) as Record<string, number>,
    bytes: row.bytes,
    boardId: row.board_id,
  };
}

/** Read only the matching card's observation, not a copy of the whole receipt for every card. */
function loadCardReads(db: Database, boardId: string, field: 'read_nodes' | 'seen_links') {
  const ids = db
    .query<{ id: string }, [string, string, string]>(`
    SELECT id FROM nodes WHERE board_id = ?
    UNION SELECT j.key AS id FROM context_reads r, json_each(r.read_nodes) j WHERE r.board_id = ?
    UNION SELECT j.key AS id FROM context_reads r, json_each(r.seen_links) j WHERE r.board_id = ?
  `)
    .all(boardId, boardId, boardId);
  return db
    .query<{ nodeId: string; revision: number; at: string; who: string }, [string]>(`
    ${CARD_HISTORY_CTE} SELECT h.node_id AS nodeId, j.value AS revision, r.at,
      COALESCE(r.consumer, r.agent_id, r.source) AS who FROM history h JOIN context_reads r
      ON r.board_id = h.board_id AND r.seq > h.read_after AND r.seq <= h.read_through
      JOIN json_each(r.${field}) j ON j.key = h.node_id
    ORDER BY r.seq DESC
  `)
    .all(JSON.stringify(ids.map(({ id }) => ({ boardId, cardId: id }))));
}

/** Per node on a board, the latest agent read that delivered its content (newest row wins). */
export function loadNodeReadStatusFromDB(db: Database, boardId: string): NodeReadStatus[] {
  const status = new Map<string, NodeReadStatus>();
  for (const read of loadCardReads(db, boardId, 'read_nodes')) {
    const nodeId = read.nodeId;
    const known = status.get(nodeId);
    if (known) {
      known.readCount += 1;
      continue;
    }
    status.set(nodeId, {
      nodeId,
      lastReadAt: read.at,
      lastReadBy: read.who,
      readRevision: read.revision,
      readCount: 1,
    });
  }
  return [...status.values()];
}

/** The latest agent read on a board, of any kind (a brief, a pinned-board map, a pull), or null. */
export function loadBoardLastReadFromDB(
  db: Database,
  boardId: string,
): { lastReadAt: string; lastReadBy: string } | null {
  const row = db
    .query<ContextReadRow, [string]>('SELECT * FROM context_reads WHERE board_id = ? ORDER BY seq DESC LIMIT 1')
    .get(boardId);
  if (!row) return null;
  const read = rowToContextRead(row);
  return { lastReadAt: read.at, lastReadBy: read.consumer ?? read.agentId ?? read.source };
}

/** Per node on a board, the newest links revision any agent read has carried (connection marks). */
export function loadSeenLinksFromDB(db: Database, boardId: string): Record<string, number> {
  const seen: Record<string, number> = {};
  for (const { nodeId, revision } of loadCardReads(db, boardId, 'seen_links')) {
    if (revision > (seen[nodeId] ?? -1)) seen[nodeId] = revision;
  }
  return seen;
}

/** Every node on a board whose content an agent read at or after `since` (ISO). */
export function loadReadNodeIdsSince(db: Database, boardId: string, since: string): string[] {
  const ids = new Set<string>();
  for (const row of loadCardReads(db, boardId, 'read_nodes')) if (row.at >= since) ids.add(row.nodeId);
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
