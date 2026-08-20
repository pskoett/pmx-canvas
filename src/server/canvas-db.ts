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
import { type CanvasThemeName, normalizeCanvasThemeName } from '../shared/themes.js';
import type {
  CanvasAnnotation,
  CanvasEdge,
  CanvasNodeState,
  CanvasSnapshot,
  CanvasSnapshotListOptions,
  ViewportState,
} from './canvas-state.js';
import {
  createEmptyAxState,
  normalizeAxState,
  normalizeAxEvent,
  normalizeAxEvidence,
  normalizeAxSteeringMessage,
  normalizeAxHostCapability,
  AX_TIMELINE_RETENTION,
  AX_TIMELINE_DEFAULT_LIMIT,
  AX_TIMELINE_MAX_LIMIT,
  AX_CONTEXT_EVENT_LIMIT,
  AX_CONTEXT_EVIDENCE_LIMIT,
  AX_CONTEXT_STEERING_LIMIT,
  type PmxAxState,
  type PmxAxEvent,
  type PmxAxEvidence,
  type PmxAxSteeringMessage,
  type PmxAxHostCapability,
  type PmxAxTimelineSummary,
} from './ax-state.js';

// ── Schema ──────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

export type CanvasTheme = CanvasThemeName;

export function normalizeCanvasTheme(value: unknown, fallback: CanvasTheme = 'dark'): CanvasTheme {
  return normalizeCanvasThemeName(value, fallback);
}

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

  CREATE TABLE IF NOT EXISTS ax_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
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

  CREATE TABLE IF NOT EXISTS ax_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT,
    node_ids TEXT NOT NULL DEFAULT '[]',
    data TEXT,
    created_at TEXT NOT NULL,
    source TEXT,
    agent_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ax_events_seq ON ax_events (seq);

  CREATE TABLE IF NOT EXISTS ax_evidence (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    ref TEXT,
    node_ids TEXT NOT NULL DEFAULT '[]',
    data TEXT,
    created_at TEXT NOT NULL,
    source TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ax_evidence_seq ON ax_evidence (seq);

  CREATE TABLE IF NOT EXISTS ax_steering (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    message TEXT NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    source TEXT,
    agent_id TEXT,
    target TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ax_steering_seq ON ax_steering (seq);

  CREATE TABLE IF NOT EXISTS ax_host_capabilities (
    host TEXT PRIMARY KEY,
    reported_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
`;

/** Idempotently add a column to an existing table (no prior-migrations system in this repo). */
function ensureColumn(db: Database, table: string, column: string, ddl: string): void {
  interface ColumnInfoRow {
    name: string;
  }
  const columns = db.query<ColumnInfoRow, []>(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch (error) {
    // Two processes can race the check-then-ALTER on the first post-upgrade
    // open; the loser's duplicate-column error means the column exists — done.
    if (!/duplicate column/i.test(error instanceof Error ? error.message : String(error))) throw error;
  }
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function normalizeSnapshotTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function parsePersistedAxState(raw: string | null | undefined): PmxAxState {
  if (!raw) return createEmptyAxState();
  try {
    return normalizeAxState(JSON.parse(raw));
  } catch {
    return createEmptyAxState();
  }
}

// ── Persisted State Interface ───────────────────────────────────

export interface PersistedCanvasState {
  version: number;
  theme?: CanvasTheme;
  viewport: ViewportState;
  nodes: CanvasNodeState[];
  edges: CanvasEdge[];
  annotations?: CanvasAnnotation[];
  contextPins: string[];
  ax?: PmxAxState;
}

// ── Database Management ─────────────────────────────────────────

export function openCanvasDb(dbPath: string): Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  // FULL, not NORMAL: under WAL, NORMAL lets a host/OS-level crash lose the most
  // recent commits (a clean process exit loses nothing either way). The reporter of
  // issue #22 declined FULL specifically because a save rewrote the whole board, so
  // an fsync per commit scaled with board size. Saves are incremental now — a
  // typical save is a row or two — so that objection is gone and the durability is
  // worth the fsync.
  db.exec('PRAGMA synchronous=FULL');
  db.exec('PRAGMA busy_timeout=5000');
  db.exec(SCHEMA_SQL);

  // Additive columns for pre-existing DBs (fresh installs already get them via SCHEMA_SQL above).
  ensureColumn(db, 'ax_events', 'agent_id', 'agent_id TEXT');
  ensureColumn(db, 'ax_steering', 'agent_id', 'agent_id TEXT');
  ensureColumn(db, 'ax_steering', 'target', 'target TEXT');

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

/**
 * Delete blob rows nothing references any more. Blobs are content-addressed and
 * written with INSERT OR IGNORE, so editing a node's html supersedes its old blob
 * and leaves it orphaned — without this, `canvas.db` (which is git-committable)
 * would grow without bound once externalization applies to ordinary html nodes.
 *
 * References are collected by scanning the raw persisted JSON for sha256 fields
 * rather than parsing every node. That deliberately OVER-approximates: a stray
 * 64-hex string keeps a blob alive that could have been dropped, which wastes a
 * little space. The opposite error would delete live content, so the scan is
 * biased to the safe side on purpose. Snapshot rows are scanned too — a snapshot
 * restore must still find its blobs.
 */
export function gcBlobsInDB(db: Database): number {
  const referenced = new Set<string>();
  const collect = (sql: string): void => {
    for (const row of db.query<{ data: string }, []>(sql).all()) {
      if (!row.data) continue;
      for (const match of row.data.matchAll(/"sha256"\s*:\s*"([0-9a-f]{64})"/g)) referenced.add(match[1]);
    }
  };
  collect('SELECT data FROM nodes');
  collect('SELECT data FROM snapshot_nodes');

  const all = db.query<{ sha256: string }, []>('SELECT sha256 FROM blobs').all();
  const orphans = all.filter((row) => !referenced.has(row.sha256));
  if (orphans.length === 0) return 0;
  const remove = db.prepare('DELETE FROM blobs WHERE sha256 = ?');
  const transaction = db.transaction(() => {
    for (const row of orphans) remove.run(row.sha256);
  });
  transaction();
  return orphans.length;
}

export function finalizeCanvasDbForClose(db: Database): void {
  checkpointCanvasDb(db);
  // The WAL→DELETE switch takes an exclusive lock, so it succeeds only when no
  // other connection has the DB open — and that makes it the GC gate. GC deletes
  // blob rows a second live process may still depend on: its in-memory nodes
  // hold content-addressed refs, not content, so a GC'd blob is unrecoverable
  // once that process re-saves (review of #22, reproduced). Locked ⇒ someone
  // else is on this canvas: leave WAL in place and keep every blob.
  try {
    db.exec('PRAGMA journal_mode=DELETE');
  } catch {
    return;
  }
  gcBlobsInDB(db);
}

// ── State Persistence ───────────────────────────────────────────

/**
 * Drop rows whose id is no longer in the live state. Reads only the id column
 * (index-only scan) so it stays cheap on large boards.
 */
function deleteMissingRows(
  db: Database,
  table: 'nodes' | 'edges' | 'annotations' | 'context_pins',
  idColumn: 'id' | 'node_id',
  keep: Set<string>,
): void {
  const rows = db.query<{ id: string }, []>(`SELECT ${idColumn} AS id FROM ${table}`).all();
  if (rows.length === 0) return;
  const remove = db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = ?`);
  for (const row of rows) {
    if (!keep.has(row.id)) remove.run(row.id);
  }
}

export function saveStateToDB(db: Database, state: PersistedCanvasState): void {
  const transaction = db.transaction(() => {
    // Rows are upserted only when a column actually differs, and rows that are
    // gone are deleted by id. This used to be DELETE-all + INSERT-all, which
    // rewrote every row on every debounced save: dragging one node rewrote the
    // whole board, multi-MB html payloads included, so the write cost scaled
    // with board size instead of change size (issue #22). The
    // `WHERE ... IS NOT excluded....` guard makes an unchanged row a true
    // no-op — SQLite performs no update, so no page is written. The comparison
    // is against the DB itself rather than an in-memory cache, so nothing can
    // go stale and silently skip a write that was actually needed.
    const upsertMeta = db.prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE value IS NOT excluded.value`,
    );
    upsertMeta.run('theme', normalizeCanvasTheme(state.theme));
    upsertMeta.run('viewport_x', String(state.viewport.x));
    upsertMeta.run('viewport_y', String(state.viewport.y));
    upsertMeta.run('viewport_scale', String(state.viewport.scale));
    // Mark DB as populated (for migration detection)
    upsertMeta.run('state_populated', '1');

    // Save nodes
    const upsertNode = db.prepare(
      `INSERT INTO nodes (id, type, pos_x, pos_y, width, height, z_index, collapsed, pinned, dock_position, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type, pos_x = excluded.pos_x, pos_y = excluded.pos_y,
         width = excluded.width, height = excluded.height, z_index = excluded.z_index,
         collapsed = excluded.collapsed, pinned = excluded.pinned,
         dock_position = excluded.dock_position, data = excluded.data
       WHERE type IS NOT excluded.type OR pos_x IS NOT excluded.pos_x
          OR pos_y IS NOT excluded.pos_y OR width IS NOT excluded.width
          OR height IS NOT excluded.height OR z_index IS NOT excluded.z_index
          OR collapsed IS NOT excluded.collapsed OR pinned IS NOT excluded.pinned
          OR dock_position IS NOT excluded.dock_position OR data IS NOT excluded.data`,
    );
    for (const node of state.nodes) {
      upsertNode.run(
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
    deleteMissingRows(db, 'nodes', 'id', new Set(state.nodes.map((node) => node.id)));

    // Save edges
    const upsertEdge = db.prepare(
      `INSERT INTO edges (id, from_node, to_node, type, label, style, animated)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         from_node = excluded.from_node, to_node = excluded.to_node, type = excluded.type,
         label = excluded.label, style = excluded.style, animated = excluded.animated
       WHERE from_node IS NOT excluded.from_node OR to_node IS NOT excluded.to_node
          OR type IS NOT excluded.type OR label IS NOT excluded.label
          OR style IS NOT excluded.style OR animated IS NOT excluded.animated`,
    );
    for (const edge of state.edges) {
      upsertEdge.run(
        edge.id,
        edge.from,
        edge.to,
        edge.type,
        edge.label ?? null,
        edge.style ?? null,
        edge.animated ? 1 : 0,
      );
    }
    deleteMissingRows(db, 'edges', 'id', new Set(state.edges.map((edge) => edge.id)));

    // Save annotations
    const annotations = state.annotations ?? [];
    const upsertAnnotation = db.prepare(
      `INSERT INTO annotations (id, type, points, bounds, color, width, text, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type, points = excluded.points, bounds = excluded.bounds,
         color = excluded.color, width = excluded.width, text = excluded.text,
         label = excluded.label, created_at = excluded.created_at
       WHERE type IS NOT excluded.type OR points IS NOT excluded.points
          OR bounds IS NOT excluded.bounds OR color IS NOT excluded.color
          OR width IS NOT excluded.width OR text IS NOT excluded.text
          OR label IS NOT excluded.label OR created_at IS NOT excluded.created_at`,
    );
    for (const annotation of annotations) {
      upsertAnnotation.run(
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
    deleteMissingRows(db, 'annotations', 'id', new Set(annotations.map((annotation) => annotation.id)));

    // Save context pins (node_id is the whole row — nothing to update)
    const insertPin = db.prepare('INSERT OR IGNORE INTO context_pins (node_id) VALUES (?)');
    for (const pinId of state.contextPins) {
      insertPin.run(pinId);
    }
    deleteMissingRows(db, 'context_pins', 'node_id', new Set(state.contextPins));

    db.run(
      `INSERT INTO ax_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE value IS NOT excluded.value`,
      ['state', JSON.stringify(state.ax ?? createEmptyAxState())],
    );
  });

  transaction();
}

/** Check if the DB has been populated with canvas state at least once. */
export function isDbPopulated(db: Database): boolean {
  const row = db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get('state_populated');
  return row?.value === '1';
}

export function loadStateFromDB(db: Database): PersistedCanvasState | null {
  const schemaVersion = db
    .query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?')
    .get('schema_version');
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
  const themeValue = db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get('theme')?.value;
  const theme = themeValue ? normalizeCanvasTheme(themeValue) : undefined;

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
  interface PinRow {
    node_id: string;
  }
  const pinRows = db.query<PinRow, []>('SELECT node_id FROM context_pins').all();
  const contextPins = pinRows.map((row) => row.node_id);

  const axRow = db.query<{ value: string }, [string]>('SELECT value FROM ax_state WHERE key = ?').get('state');

  return {
    version: 1,
    theme,
    viewport,
    nodes,
    edges,
    annotations,
    contextPins,
    ax: parsePersistedAxState(axRow?.value),
  };
}

// ── Snapshot Persistence ────────────────────────────────────────

export function saveSnapshotToDB(db: Database, snapshot: CanvasSnapshot, state: PersistedCanvasState): void {
  const transaction = db.transaction(() => {
    // Insert snapshot metadata
    db.run('INSERT INTO snapshots (id, name, created_at, node_count, edge_count) VALUES (?, ?, ?, ?, ?)', [
      snapshot.id,
      snapshot.name,
      snapshot.createdAt,
      state.nodes.length,
      state.edges.length,
    ]);

    // Insert snapshot viewport meta
    db.run('INSERT INTO snapshot_meta (snapshot_id, key, value) VALUES (?, ?, ?)', [
      snapshot.id,
      'viewport_x',
      String(state.viewport.x),
    ]);
    db.run('INSERT INTO snapshot_meta (snapshot_id, key, value) VALUES (?, ?, ?)', [
      snapshot.id,
      'viewport_y',
      String(state.viewport.y),
    ]);
    db.run('INSERT INTO snapshot_meta (snapshot_id, key, value) VALUES (?, ?, ?)', [
      snapshot.id,
      'viewport_scale',
      String(state.viewport.scale),
    ]);
    db.run('INSERT INTO snapshot_meta (snapshot_id, key, value) VALUES (?, ?, ?)', [
      snapshot.id,
      'ax_state',
      JSON.stringify(state.ax ?? createEmptyAxState()),
    ]);

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
  let snapshotRow = db.query<SnapshotRow, [string]>('SELECT * FROM snapshots WHERE id = ?').get(idOrName);

  if (!snapshotRow) {
    snapshotRow = db
      .query<SnapshotRow, [string]>('SELECT * FROM snapshots WHERE name = ? ORDER BY created_at DESC LIMIT 1')
      .get(idOrName);
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
  interface MetaRow {
    key: string;
    value: string;
  }
  const metaRows = db
    .query<MetaRow, [string]>('SELECT key, value FROM snapshot_meta WHERE snapshot_id = ?')
    .all(snapshotRow.id);
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
  const nodeRows = db
    .query<NodeRow, [string]>('SELECT * FROM snapshot_nodes WHERE snapshot_id = ?')
    .all(snapshotRow.id);
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
  const edgeRows = db
    .query<EdgeRow, [string]>('SELECT * FROM snapshot_edges WHERE snapshot_id = ?')
    .all(snapshotRow.id);
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
  const annotationRows = db
    .query<AnnotationRow, [string]>('SELECT * FROM snapshot_annotations WHERE snapshot_id = ?')
    .all(snapshotRow.id);
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
  interface PinRow {
    node_id: string;
  }
  const pinRows = db
    .query<PinRow, [string]>('SELECT node_id FROM snapshot_pins WHERE snapshot_id = ?')
    .all(snapshotRow.id);
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
      ax: parsePersistedAxState(metaMap.get('ax_state')),
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
  db.run('INSERT OR IGNORE INTO blobs (sha256, data, json_bytes) VALUES (?, ?, ?)', [
    sha256,
    compressed,
    Buffer.byteLength(jsonValue),
  ]);
  return compressed.byteLength;
}

export function readBlobFromDB(db: Database, sha256: string): string | null {
  interface BlobRow {
    data: Buffer;
    json_bytes: number;
  }
  const row = db.query<BlobRow, [string]>('SELECT data, json_bytes FROM blobs WHERE sha256 = ?').get(sha256);
  if (!row) return null;
  return gunzipSync(row.data).toString('utf-8');
}

// ── AX Timeline Persistence (NOT snapshotted; bounded by retention) ──

function safeParseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface AxTimelineQuery {
  limit?: number;
  sessionId?: string;
}

function clampTimelineLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return AX_TIMELINE_DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), AX_TIMELINE_MAX_LIMIT);
}

function trimAxTable(db: Database, table: 'ax_events' | 'ax_evidence' | 'ax_steering'): void {
  db.run(`DELETE FROM ${table} WHERE seq <= (SELECT seq FROM ${table} ORDER BY seq DESC LIMIT 1 OFFSET ?)`, [
    AX_TIMELINE_RETENTION,
  ]);
}

function readLastSeq(db: Database, table: 'ax_events' | 'ax_evidence' | 'ax_steering'): number {
  const row = db.query<{ seq: number }, []>(`SELECT seq FROM ${table} ORDER BY seq DESC LIMIT 1`).get();
  return row ? Number(row.seq) : 0;
}

export function appendAxEventToDB(db: Database, ev: Omit<PmxAxEvent, 'seq'>): PmxAxEvent {
  db.run(
    'INSERT INTO ax_events (id, kind, summary, detail, node_ids, data, created_at, source, agent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      ev.id,
      ev.kind,
      ev.summary,
      ev.detail,
      JSON.stringify(ev.nodeIds),
      ev.data ? JSON.stringify(ev.data) : null,
      ev.createdAt,
      ev.source,
      ev.agentId,
    ],
  );
  const seq = readLastSeq(db, 'ax_events');
  trimAxTable(db, 'ax_events');
  return { ...ev, seq };
}

export function appendAxEvidenceToDB(db: Database, ev: Omit<PmxAxEvidence, 'seq'>): PmxAxEvidence {
  db.run(
    'INSERT INTO ax_evidence (id, kind, title, body, ref, node_ids, data, created_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      ev.id,
      ev.kind,
      ev.title,
      ev.body,
      ev.ref,
      JSON.stringify(ev.nodeIds),
      ev.data ? JSON.stringify(ev.data) : null,
      ev.createdAt,
      ev.source,
    ],
  );
  const seq = readLastSeq(db, 'ax_evidence');
  trimAxTable(db, 'ax_evidence');
  return { ...ev, seq };
}

export function appendAxSteeringToDB(db: Database, s: Omit<PmxAxSteeringMessage, 'seq'>): PmxAxSteeringMessage {
  db.run(
    'INSERT INTO ax_steering (id, message, delivered, created_at, source, agent_id, target) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [s.id, s.message, s.delivered ? 1 : 0, s.createdAt, s.source, s.agentId, s.target],
  );
  const seq = readLastSeq(db, 'ax_steering');
  trimAxTable(db, 'ax_steering');
  return { ...s, seq };
}

export function markAxSteeringDeliveredInDB(db: Database, id: string): boolean {
  // Compare-and-set: true ONLY on the undelivered→delivered transition. Two
  // adapters racing the same steer see exactly one true — the loser (and any
  // re-mark) gets false and must not treat the message as its own delivery.
  const r = db.run('UPDATE ax_steering SET delivered = 1 WHERE id = ? AND delivered = 0', [id]);
  return r.changes > 0;
}

export function loadAxEventsFromDB(db: Database, q: AxTimelineQuery = {}): PmxAxEvent[] {
  interface Row {
    seq: number;
    id: string;
    kind: string;
    summary: string;
    detail: string | null;
    node_ids: string;
    data: string | null;
    created_at: string;
    source: string | null;
    agent_id: string | null;
  }
  const rows = db
    .query<Row, [number]>('SELECT * FROM ax_events ORDER BY seq DESC LIMIT ?')
    .all(clampTimelineLimit(q.limit));
  return rows
    .map((r) =>
      normalizeAxEvent({
        ...r,
        createdAt: r.created_at,
        nodeIds: safeParseJson(r.node_ids),
        data: safeParseJson(r.data),
        agentId: r.agent_id,
      }),
    )
    .filter((e): e is PmxAxEvent => e !== null);
}

export function loadAxEvidenceFromDB(db: Database, q: AxTimelineQuery = {}): PmxAxEvidence[] {
  interface Row {
    seq: number;
    id: string;
    kind: string;
    title: string;
    body: string | null;
    ref: string | null;
    node_ids: string;
    data: string | null;
    created_at: string;
    source: string | null;
  }
  const rows = db
    .query<Row, [number]>('SELECT * FROM ax_evidence ORDER BY seq DESC LIMIT ?')
    .all(clampTimelineLimit(q.limit));
  return rows
    .map((r) =>
      normalizeAxEvidence({
        ...r,
        createdAt: r.created_at,
        nodeIds: safeParseJson(r.node_ids),
        data: safeParseJson(r.data),
      }),
    )
    .filter((e): e is PmxAxEvidence => e !== null);
}

interface AxSteeringRow {
  seq: number;
  id: string;
  message: string;
  delivered: number;
  created_at: string;
  source: string | null;
  agent_id: string | null;
  target: string | null;
}

function mapAxSteeringRow(r: AxSteeringRow): PmxAxSteeringMessage | null {
  return normalizeAxSteeringMessage({
    ...r,
    createdAt: r.created_at,
    delivered: r.delivered === 1,
    agentId: r.agent_id,
  });
}

export function loadAxSteeringFromDB(
  db: Database,
  q: AxTimelineQuery & { onlyPending?: boolean } = {},
): PmxAxSteeringMessage[] {
  const sql = q.onlyPending
    ? 'SELECT * FROM ax_steering WHERE delivered = 0 ORDER BY seq DESC LIMIT ?'
    : 'SELECT * FROM ax_steering ORDER BY seq DESC LIMIT ?';
  const rows = db.query<AxSteeringRow, [number]>(sql).all(clampTimelineLimit(q.limit));
  return rows.map(mapAxSteeringRow).filter((s): s is PmxAxSteeringMessage => s !== null);
}

export function loadPendingAxSteeringFromDB(
  db: Database,
  options: { consumer?: string; limit?: number } = {},
): PmxAxSteeringMessage[] {
  // FIFO (oldest undelivered first); exclude the consumer's own steering (loop
  // prevention) and any steering addressed to a DIFFERENT consumer (target scoping)
  // in SQL so the LIMIT is applied AFTER both filters, not before.
  const limit = clampTimelineLimit(options.limit);
  const rows = options.consumer
    ? db
        .query<AxSteeringRow, [string, string, string, number]>(
          'SELECT * FROM ax_steering WHERE delivered = 0 AND (source IS NULL OR source != ?) AND (agent_id IS NULL OR agent_id != ?) AND (target IS NULL OR target = ?) ORDER BY seq ASC LIMIT ?',
        )
        .all(options.consumer, options.consumer, options.consumer, limit)
    : db
        .query<AxSteeringRow, [number]>('SELECT * FROM ax_steering WHERE delivered = 0 ORDER BY seq ASC LIMIT ?')
        .all(limit);
  return rows.map(mapAxSteeringRow).filter((s): s is PmxAxSteeringMessage => s !== null);
}

/**
 * NEWEST undelivered steering first (report #57) for the compact AX context lead
 * block — so a fresh steer is visible even behind a long backlog. Loop-safe: excludes
 * the consumer's own steering and steering targeted at a different consumer in SQL
 * so the LIMIT applies after both filters.
 * Distinct from loadPendingAxSteeringFromDB (FIFO oldest-first) which the claim/ack
 * delivery queue uses for ordered processing.
 */
export function loadNewestPendingAxSteeringFromDB(
  db: Database,
  options: { consumer?: string; limit?: number } = {},
): PmxAxSteeringMessage[] {
  const limit = clampTimelineLimit(options.limit);
  const rows = options.consumer
    ? db
        .query<AxSteeringRow, [string, string, string, number]>(
          'SELECT * FROM ax_steering WHERE delivered = 0 AND (source IS NULL OR source != ?) AND (agent_id IS NULL OR agent_id != ?) AND (target IS NULL OR target = ?) ORDER BY seq DESC LIMIT ?',
        )
        .all(options.consumer, options.consumer, options.consumer, limit)
    : db
        .query<AxSteeringRow, [number]>('SELECT * FROM ax_steering WHERE delivered = 0 ORDER BY seq DESC LIMIT ?')
        .all(limit);
  return rows.map(mapAxSteeringRow).filter((s): s is PmxAxSteeringMessage => s !== null);
}

/** Total undelivered steering for a consumer (loop-safe — excludes the consumer's own; target-scoped). */
export function countPendingAxSteeringFromDB(db: Database, consumer?: string): number {
  const n = consumer
    ? db
        .query<{ n: number }, [string, string, string]>(
          'SELECT COUNT(*) AS n FROM ax_steering WHERE delivered = 0 AND (source IS NULL OR source != ?) AND (agent_id IS NULL OR agent_id != ?) AND (target IS NULL OR target = ?)',
        )
        .get(consumer, consumer, consumer)?.n
    : db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM ax_steering WHERE delivered = 0').get()?.n;
  return Number(n ?? 0);
}

function countRows(db: Database, table: 'ax_events' | 'ax_evidence' | 'ax_steering'): number {
  return Number(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0);
}

export function loadAxTimelineSummaryFromDB(db: Database): PmxAxTimelineSummary {
  return {
    recentEvents: loadAxEventsFromDB(db, { limit: AX_CONTEXT_EVENT_LIMIT }),
    recentEvidence: loadAxEvidenceFromDB(db, { limit: AX_CONTEXT_EVIDENCE_LIMIT }),
    pendingSteering: loadAxSteeringFromDB(db, { onlyPending: true, limit: AX_CONTEXT_STEERING_LIMIT }),
    counts: {
      events: countRows(db, 'ax_events'),
      evidence: countRows(db, 'ax_evidence'),
      steering: countRows(db, 'ax_steering'),
    },
  };
}

export function upsertAxHostCapabilityToDB(db: Database, cap: PmxAxHostCapability): void {
  const host = cap.host ?? 'default';
  db.run('INSERT OR REPLACE INTO ax_host_capabilities (host, reported_at, payload) VALUES (?, ?, ?)', [
    host,
    cap.reportedAt ?? new Date().toISOString(),
    JSON.stringify(cap),
  ]);
}

export function loadAxHostCapabilityFromDB(db: Database): PmxAxHostCapability | null {
  const row = db
    .query<{ payload: string }, []>('SELECT payload FROM ax_host_capabilities ORDER BY reported_at DESC LIMIT 1')
    .get();
  return row ? normalizeAxHostCapability(safeParseJson(row.payload)) : null;
}
