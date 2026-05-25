/**
 * SQLite persistence layer for canvas state.
 *
 * Uses Bun's built-in `bun:sqlite` for zero-dependency, synchronous,
 * WAL-mode persistence. Replaces the previous JSON file-based approach.
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import type {
  CanvasAnnotation,
  CanvasEdge,
  CanvasNodeState,
  CanvasSnapshot,
  CanvasSnapshotListOptions,
  ViewportState,
} from './canvas-state.js';

// ── Schema ──────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    pos_x REAL NOT NULL,
    pos_y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    z_index INTEGER NOT NULL DEFAULT 0,
    collapsed INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    dock_position TEXT,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    from_node TEXT NOT NULL,
    to_node TEXT NOT NULL,
    type TEXT NOT NULL,
    label TEXT,
    style TEXT,
    animated INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    points TEXT NOT NULL,
    bounds TEXT NOT NULL,
    color TEXT NOT NULL,
    width REAL NOT NULL,
    text TEXT,
    label TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS context_pins (
    node_id TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    node_count INTEGER NOT NULL,
    edge_count INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS snapshot_nodes (
    snapshot_id TEXT NOT NULL,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    pos_x REAL NOT NULL,
    pos_y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    z_index INTEGER NOT NULL DEFAULT 0,
    collapsed INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    dock_position TEXT,
    data TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, id)
  );

  CREATE TABLE IF NOT EXISTS snapshot_edges (
    snapshot_id TEXT NOT NULL,
    id TEXT NOT NULL,
    from_node TEXT NOT NULL,
    to_node TEXT NOT NULL,
    type TEXT NOT NULL,
    label TEXT,
    style TEXT,
    animated INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (snapshot_id, id)
  );

  CREATE TABLE IF NOT EXISTS snapshot_annotations (
    snapshot_id TEXT NOT NULL,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    points TEXT NOT NULL,
    bounds TEXT NOT NULL,
    color TEXT NOT NULL,
    width REAL NOT NULL,
    text TEXT,
    label TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, id)
  );

  CREATE TABLE IF NOT EXISTS snapshot_pins (
    snapshot_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, node_id)
  );

  CREATE TABLE IF NOT EXISTS snapshot_meta (
    snapshot_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, key)
  );

  CREATE TABLE IF NOT EXISTS blobs (
    sha256 TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    json_bytes INTEGER NOT NULL
  );
`;

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function normalizeSnapshotTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

// ── Persisted State Interface ───────────────────────────────────

export interface PersistedCanvasState {
  version: number;
  viewport: ViewportState;
  nodes: CanvasNodeState[];
  edges: CanvasEdge[];
  annotations?: CanvasAnnotation[];
  contextPins: string[];
}

// ── Database Management ─────────────────────────────────────────

export function openCanvasDb(dbPath: string): Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec('PRAGMA busy_timeout=5000');
  db.exec(SCHEMA_SQL);

  // Set schema version if not present
  const row = db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get('schema_version');
  if (!row) {
    db.run('INSERT INTO meta (key, value) VALUES (?, ?)', ['schema_version', String(SCHEMA_VERSION)]);
  }

  return db;
}

export function checkpointCanvasDb(db: Database): void {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
}

export function finalizeCanvasDbForClose(db: Database): void {
  checkpointCanvasDb(db);
  db.exec('PRAGMA journal_mode=DELETE');
}

// ── State Persistence ───────────────────────────────────────────

export function saveStateToDB(db: Database, state: PersistedCanvasState): void {
  const transaction = db.transaction(() => {
    // Clear current state tables
    db.run('DELETE FROM nodes');
    db.run('DELETE FROM edges');
    db.run('DELETE FROM annotations');
    db.run('DELETE FROM context_pins');

    // Save viewport
    db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['viewport_x', String(state.viewport.x)]);
    db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['viewport_y', String(state.viewport.y)]);
    db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['viewport_scale', String(state.viewport.scale)]);

    // Mark DB as populated (for migration detection)
    db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['state_populated', '1']);

    // Save nodes
    const insertNode = db.prepare(
      `INSERT INTO nodes (id, type, pos_x, pos_y, width, height, z_index, collapsed, pinned, dock_position, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const node of state.nodes) {
      insertNode.run(
        node.id,
        node.type,
        node.position.x,
        node.position.y,
        node.size.width,
        node.size.height,
        node.zIndex,
        node.collapsed ? 1 : 0,
        node.pinned ? 1 : 0,
        node.dockPosition,
        JSON.stringify(node.data),
      );
    }

    // Save edges
    const insertEdge = db.prepare(
      `INSERT INTO edges (id, from_node, to_node, type, label, style, animated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const edge of state.edges) {
      insertEdge.run(
        edge.id,
        edge.from,
        edge.to,
        edge.type,
        edge.label ?? null,
        edge.style ?? null,
        edge.animated ? 1 : 0,
      );
    }

    // Save annotations
    const insertAnnotation = db.prepare(
      `INSERT INTO annotations (id, type, points, bounds, color, width, text, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const annotation of state.annotations ?? []) {
      insertAnnotation.run(
        annotation.id,
        annotation.type,
        JSON.stringify(annotation.points),
        JSON.stringify(annotation.bounds),
        annotation.color,
        annotation.width,
        annotation.text ?? null,
        annotation.label ?? null,
        annotation.createdAt,
      );
    }

    // Save context pins
    const insertPin = db.prepare('INSERT INTO context_pins (node_id) VALUES (?)');
    for (const pinId of state.contextPins) {
      insertPin.run(pinId);
    }
  });

  transaction();
}

/** Check if the DB has been populated with canvas state at least once. */
export function isDbPopulated(db: Database): boolean {
  const row = db.query<{ value: string }, [string]>(
    'SELECT value FROM meta WHERE key = ?',
  ).get('state_populated');
  return row?.value === '1';
}

export function loadStateFromDB(db: Database): PersistedCanvasState | null {
  const schemaVersion = db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get('schema_version');
  if (!schemaVersion) return null;

  // Load viewport
  const getMetaValue = (key: string): number => {
    const row = db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? Number(row.value) : 0;
  };

  const viewport: ViewportState = {
    x: getMetaValue('viewport_x'),
    y: getMetaValue('viewport_y'),
    scale: getMetaValue('viewport_scale') || 1,
  };

  // Load nodes
  interface NodeRow {
    id: string;
    type: string;
    pos_x: number;
    pos_y: number;
    width: number;
    height: number;
    z_index: number;
    collapsed: number;
    pinned: number;
    dock_position: string | null;
    data: string;
  }
  const nodeRows = db.query<NodeRow, []>('SELECT * FROM nodes').all();
  const nodes: CanvasNodeState[] = nodeRows.map((row) => ({
    id: row.id,
    type: row.type as CanvasNodeState['type'],
    position: { x: row.pos_x, y: row.pos_y },
    size: { width: row.width, height: row.height },
    zIndex: row.z_index,
    collapsed: row.collapsed === 1,
    pinned: row.pinned === 1,
    dockPosition: row.dock_position as CanvasNodeState['dockPosition'],
    data: JSON.parse(row.data) as Record<string, unknown>,
  }));

  // Load edges
  interface EdgeRow {
    id: string;
    from_node: string;
    to_node: string;
    type: string;
    label: string | null;
    style: string | null;
    animated: number;
  }
  const edgeRows = db.query<EdgeRow, []>('SELECT * FROM edges').all();
  const edges: CanvasEdge[] = edgeRows.map((row) => ({
    id: row.id,
    from: row.from_node,
    to: row.to_node,
    type: row.type as CanvasEdge['type'],
    ...(row.label ? { label: row.label } : {}),
    ...(row.style ? { style: row.style as CanvasEdge['style'] } : {}),
    ...(row.animated ? { animated: true } : {}),
  }));

  // Load annotations
  interface AnnotationRow {
    id: string;
    type: string;
    points: string;
    bounds: string;
    color: string;
    width: number;
    text: string | null;
    label: string | null;
    created_at: string;
  }
  const annotationRows = db.query<AnnotationRow, []>('SELECT * FROM annotations').all();
  const annotations: CanvasAnnotation[] = annotationRows.map((row) => ({
    id: row.id,
    type: row.type as CanvasAnnotation['type'],
    points: JSON.parse(row.points),
    bounds: JSON.parse(row.bounds),
    color: row.color,
    width: row.width,
    ...(row.text ? { text: row.text } : {}),
    ...(row.label ? { label: row.label } : {}),
    createdAt: row.created_at,
  }));

  // Load context pins
  interface PinRow { node_id: string }
  const pinRows = db.query<PinRow, []>('SELECT node_id FROM context_pins').all();
  const contextPins = pinRows.map((row) => row.node_id);

  return {
    version: 1,
    viewport,
    nodes,
    edges,
    annotations,
    contextPins,
  };
}

// ── Snapshot Persistence ────────────────────────────────────────

export function saveSnapshotToDB(
  db: Database,
  snapshot: CanvasSnapshot,
  state: PersistedCanvasState,
): void {
  const transaction = db.transaction(() => {
    // Insert snapshot metadata
    db.run(
      'INSERT INTO snapshots (id, name, created_at, node_count, edge_count) VALUES (?, ?, ?, ?, ?)',
      [snapshot.id, snapshot.name, snapshot.createdAt, state.nodes.length, state.edges.length],
    );

    // Insert snapshot viewport meta
    db.run('INSERT INTO snapshot_meta (snapshot_id, key, value) VALUES (?, ?, ?)', [snapshot.id, 'viewport_x', String(state.viewport.x)]);
    db.run('INSERT INTO snapshot_meta (snapshot_id, key, value) VALUES (?, ?, ?)', [snapshot.id, 'viewport_y', String(state.viewport.y)]);
    db.run('INSERT INTO snapshot_meta (snapshot_id, key, value) VALUES (?, ?, ?)', [snapshot.id, 'viewport_scale', String(state.viewport.scale)]);

    // Insert snapshot nodes
    const insertNode = db.prepare(
      `INSERT INTO snapshot_nodes (snapshot_id, id, type, pos_x, pos_y, width, height, z_index, collapsed, pinned, dock_position, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const node of state.nodes) {
      insertNode.run(
        snapshot.id,
        node.id,
        node.type,
        node.position.x,
        node.position.y,
        node.size.width,
        node.size.height,
        node.zIndex,
        node.collapsed ? 1 : 0,
        node.pinned ? 1 : 0,
        node.dockPosition,
        JSON.stringify(node.data),
      );
    }

    // Insert snapshot edges
    const insertEdge = db.prepare(
      `INSERT INTO snapshot_edges (snapshot_id, id, from_node, to_node, type, label, style, animated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const edge of state.edges) {
      insertEdge.run(
        snapshot.id,
        edge.id,
        edge.from,
        edge.to,
        edge.type,
        edge.label ?? null,
        edge.style ?? null,
        edge.animated ? 1 : 0,
      );
    }

    // Insert snapshot annotations
    const insertAnnotation = db.prepare(
      `INSERT INTO snapshot_annotations (snapshot_id, id, type, points, bounds, color, width, text, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const annotation of state.annotations ?? []) {
      insertAnnotation.run(
        snapshot.id,
        annotation.id,
        annotation.type,
        JSON.stringify(annotation.points),
        JSON.stringify(annotation.bounds),
        annotation.color,
        annotation.width,
        annotation.text ?? null,
        annotation.label ?? null,
        annotation.createdAt,
      );
    }

    // Insert snapshot pins
    const insertPin = db.prepare('INSERT INTO snapshot_pins (snapshot_id, node_id) VALUES (?, ?)');
    for (const pinId of state.contextPins) {
      insertPin.run(snapshot.id, pinId);
    }
  });

  transaction();
}

export function loadSnapshotFromDB(
  db: Database,
  idOrName: string,
): { snapshot: CanvasSnapshot; state: PersistedCanvasState } | null {
  // Try by ID first, then by name (most recent match)
  interface SnapshotRow {
    id: string;
    name: string;
    created_at: string;
    node_count: number;
    edge_count: number;
  }
  let snapshotRow = db.query<SnapshotRow, [string]>(
    'SELECT * FROM snapshots WHERE id = ?',
  ).get(idOrName);

  if (!snapshotRow) {
    snapshotRow = db.query<SnapshotRow, [string]>(
      'SELECT * FROM snapshots WHERE name = ? ORDER BY created_at DESC LIMIT 1',
    ).get(idOrName);
  }

  if (!snapshotRow) return null;

  const snapshot: CanvasSnapshot = {
    id: snapshotRow.id,
    name: snapshotRow.name,
    createdAt: snapshotRow.created_at,
    nodeCount: snapshotRow.node_count,
    edgeCount: snapshotRow.edge_count,
  };

  // Load snapshot viewport
  interface MetaRow { key: string; value: string }
  const metaRows = db.query<MetaRow, [string]>(
    'SELECT key, value FROM snapshot_meta WHERE snapshot_id = ?',
  ).all(snapshotRow.id);
  const metaMap = new Map(metaRows.map((r) => [r.key, r.value]));

  const viewport: ViewportState = {
    x: Number(metaMap.get('viewport_x') ?? '0'),
    y: Number(metaMap.get('viewport_y') ?? '0'),
    scale: Number(metaMap.get('viewport_scale') ?? '1') || 1,
  };

  // Load snapshot nodes
  interface NodeRow {
    id: string;
    type: string;
    pos_x: number;
    pos_y: number;
    width: number;
    height: number;
    z_index: number;
    collapsed: number;
    pinned: number;
    dock_position: string | null;
    data: string;
  }
  const nodeRows = db.query<NodeRow, [string]>(
    'SELECT * FROM snapshot_nodes WHERE snapshot_id = ?',
  ).all(snapshotRow.id);
  const nodes: CanvasNodeState[] = nodeRows.map((row) => ({
    id: row.id,
    type: row.type as CanvasNodeState['type'],
    position: { x: row.pos_x, y: row.pos_y },
    size: { width: row.width, height: row.height },
    zIndex: row.z_index,
    collapsed: row.collapsed === 1,
    pinned: row.pinned === 1,
    dockPosition: row.dock_position as CanvasNodeState['dockPosition'],
    data: JSON.parse(row.data) as Record<string, unknown>,
  }));

  // Load snapshot edges
  interface EdgeRow {
    id: string;
    from_node: string;
    to_node: string;
    type: string;
    label: string | null;
    style: string | null;
    animated: number;
  }
  const edgeRows = db.query<EdgeRow, [string]>(
    'SELECT * FROM snapshot_edges WHERE snapshot_id = ?',
  ).all(snapshotRow.id);
  const edges: CanvasEdge[] = edgeRows.map((row) => ({
    id: row.id,
    from: row.from_node,
    to: row.to_node,
    type: row.type as CanvasEdge['type'],
    ...(row.label ? { label: row.label } : {}),
    ...(row.style ? { style: row.style as CanvasEdge['style'] } : {}),
    ...(row.animated ? { animated: true } : {}),
  }));

  // Load snapshot annotations
  interface AnnotationRow {
    id: string;
    type: string;
    points: string;
    bounds: string;
    color: string;
    width: number;
    text: string | null;
    label: string | null;
    created_at: string;
  }
  const annotationRows = db.query<AnnotationRow, [string]>(
    'SELECT * FROM snapshot_annotations WHERE snapshot_id = ?',
  ).all(snapshotRow.id);
  const annotations: CanvasAnnotation[] = annotationRows.map((row) => ({
    id: row.id,
    type: row.type as CanvasAnnotation['type'],
    points: JSON.parse(row.points),
    bounds: JSON.parse(row.bounds),
    color: row.color,
    width: row.width,
    ...(row.text ? { text: row.text } : {}),
    ...(row.label ? { label: row.label } : {}),
    createdAt: row.created_at,
  }));

  // Load snapshot pins
  interface PinRow { node_id: string }
  const pinRows = db.query<PinRow, [string]>(
    'SELECT node_id FROM snapshot_pins WHERE snapshot_id = ?',
  ).all(snapshotRow.id);
  const contextPins = pinRows.map((row) => row.node_id);

  return {
    snapshot,
    state: {
      version: 1,
      viewport,
      nodes,
      edges,
      annotations,
      contextPins,
    },
  };
}

export function listSnapshotsFromDB(db: Database, options: CanvasSnapshotListOptions = {}): CanvasSnapshot[] {
  const query = options.query?.trim().toLowerCase();
  const before = normalizeSnapshotTimestamp(options.before);
  const after = normalizeSnapshotTimestamp(options.after);
  const limit = options.all ? undefined : (normalizePositiveInteger(options.limit) ?? 20);

  let sql = 'SELECT * FROM snapshots WHERE 1=1';
  const params: string[] = [];

  if (query) {
    sql += ' AND (LOWER(id) LIKE ? OR LOWER(name) LIKE ?)';
    params.push(`%${query}%`, `%${query}%`);
  }
  if (before) {
    sql += ' AND created_at <= ?';
    params.push(before);
  }
  if (after) {
    sql += ' AND created_at >= ?';
    params.push(after);
  }

  sql += ' ORDER BY created_at DESC';
  if (limit !== undefined) {
    sql += ` LIMIT ${limit}`;
  }

  interface SnapshotRow {
    id: string;
    name: string;
    created_at: string;
    node_count: number;
    edge_count: number;
  }

  const stmt = db.prepare<SnapshotRow, string[]>(sql);
  const rows = stmt.all(...params);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    nodeCount: row.node_count,
    edgeCount: row.edge_count,
  }));
}

export function deleteSnapshotFromDB(db: Database, id: string): boolean {
  const transaction = db.transaction(() => {
    db.run('DELETE FROM snapshot_nodes WHERE snapshot_id = ?', [id]);
    db.run('DELETE FROM snapshot_edges WHERE snapshot_id = ?', [id]);
    db.run('DELETE FROM snapshot_annotations WHERE snapshot_id = ?', [id]);
    db.run('DELETE FROM snapshot_pins WHERE snapshot_id = ?', [id]);
    db.run('DELETE FROM snapshot_meta WHERE snapshot_id = ?', [id]);
    const result = db.run('DELETE FROM snapshots WHERE id = ?', [id]);
    return result.changes > 0;
  });

  return transaction();
}

// ── Blob Persistence ────────────────────────────────────────────

export function writeBlobToDB(db: Database, sha256: string, jsonValue: string): number {
  const compressed = gzipSync(jsonValue);
  db.run(
    'INSERT OR IGNORE INTO blobs (sha256, data, json_bytes) VALUES (?, ?, ?)',
    [sha256, compressed, Buffer.byteLength(jsonValue)],
  );
  return compressed.byteLength;
}

export function readBlobFromDB(db: Database, sha256: string): string | null {
  interface BlobRow { data: Buffer; json_bytes: number }
  const row = db.query<BlobRow, [string]>(
    'SELECT data, json_bytes FROM blobs WHERE sha256 = ?',
  ).get(sha256);
  if (!row) return null;
  return gunzipSync(row.data).toString('utf-8');
}

export function hasBlobInDB(db: Database, sha256: string): boolean {
  interface CountRow { c: number }
  const row = db.query<CountRow, [string]>(
    'SELECT COUNT(*) as c FROM blobs WHERE sha256 = ?',
  ).get(sha256);
  return (row?.c ?? 0) > 0;
}
