/**
 * SQLite persistence layer for canvas state.
 *
 * Uses Bun's built-in `bun:sqlite` for zero-dependency, synchronous,
 * WAL-mode persistence. Replaces the previous JSON file-based approach.
 */

import { Database } from 'bun:sqlite';
import { CONTEXT_READS_SCHEMA_SQL } from './context-reads.js';
import { MIGRATED_SNAPSHOT_CATEGORY, normalizeBoardCategory } from '../shared/boards.js';
import { tourSchema, type Tour } from '../shared/tour.js';
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

const SCHEMA_VERSION = 2;

export type CanvasTheme = CanvasThemeName;

export function normalizeCanvasTheme(value: unknown, fallback: CanvasTheme = 'dark'): CanvasTheme {
  return normalizeCanvasThemeName(value, fallback);
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS context_brief_cursors (
    board_id TEXT NOT NULL,
    consumer TEXT NOT NULL,
    revision INTEGER NOT NULL,
    PRIMARY KEY (board_id, consumer)
  );

  CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_opened_at TEXT,
    viewport_x REAL NOT NULL DEFAULT 0,
    viewport_y REAL NOT NULL DEFAULT 0,
    viewport_scale REAL NOT NULL DEFAULT 1,
    tour TEXT NOT NULL DEFAULT 'null',
    category TEXT,
    readme_node_id TEXT
  );

  CREATE TABLE IF NOT EXISTS nodes (
    board_id TEXT NOT NULL,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    pos_x REAL NOT NULL,
    pos_y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    z_index INTEGER NOT NULL DEFAULT 0,
    collapsed INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    PRIMARY KEY (board_id, id)
  );

  CREATE TABLE IF NOT EXISTS edges (
    board_id TEXT NOT NULL,
    id TEXT NOT NULL,
    from_node TEXT NOT NULL,
    to_node TEXT NOT NULL,
    type TEXT NOT NULL,
    label TEXT,
    style TEXT,
    animated INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (board_id, id)
  );

  CREATE TABLE IF NOT EXISTS annotations (
    board_id TEXT NOT NULL,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    points TEXT NOT NULL,
    bounds TEXT NOT NULL,
    color TEXT NOT NULL,
    width REAL NOT NULL,
    text TEXT,
    label TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (board_id, id)
  );

  CREATE TABLE IF NOT EXISTS context_pins (
    board_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    PRIMARY KEY (board_id, node_id)
  );

  CREATE TABLE IF NOT EXISTS ax_state (
    board_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (board_id, key)
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    board_id TEXT,
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

  CREATE TABLE IF NOT EXISTS attachment_bytes (
    sha256 TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    size INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_board ON attachments (board_id);

  CREATE TABLE IF NOT EXISTS document_imports (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    attachment_id TEXT NOT NULL,
    status TEXT NOT NULL,
    position_x REAL NOT NULL,
    position_y REAL NOT NULL,
    sections TEXT,
    warnings TEXT,
    agent_description TEXT,
    reason TEXT,
    committed_node_ids TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
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

  CREATE TABLE IF NOT EXISTS ax_steering_deliveries (
    steering_id TEXT NOT NULL,
    consumer TEXT NOT NULL,
    at TEXT NOT NULL,
    PRIMARY KEY (steering_id, consumer)
  );

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
  tour?: Tour;
  version: number;
  theme?: CanvasTheme;
  viewport: ViewportState;
  nodes: CanvasNodeState[];
  edges: CanvasEdge[];
  annotations?: CanvasAnnotation[];
  contextPins: string[];
  ax?: PmxAxState;
  revisionState?: PersistedRevisionState;
}

export interface PersistedRevisionState {
  revision: number;
  floor: number;
  tombstones: Array<{ nodeId: string; revision: number; deletedBy: import('./attribution.js').ActorAttribution }>;
}

/** Durable, delivery-based context cursor. This is separate from the bounded diagnostic read log. */
export function readContextBriefCursor(db: Database, boardId: string, consumer: string): number | null {
  return (
    db
      .query<{ revision: number }, [string, string]>(
        'SELECT revision FROM context_brief_cursors WHERE board_id = ? AND consumer = ?',
      )
      .get(boardId, consumer)?.revision ?? null
  );
}

/** Monotonic update prevents a stale concurrent response from regressing a consumer. */
export function advanceContextBriefCursor(db: Database, boardId: string, consumer: string, revision: number): void {
  db.run(
    `INSERT INTO context_brief_cursors (board_id, consumer, revision) VALUES (?, ?, ?)
     ON CONFLICT(board_id, consumer) DO UPDATE SET revision = MAX(revision, excluded.revision)`,
    [boardId, consumer, revision],
  );
}

function readTour(raw: string | undefined): Tour | undefined {
  if (!raw || raw === 'null') return undefined;
  return tourSchema.parse(JSON.parse(raw));
}

// ── Database Management ─────────────────────────────────────────

export interface OpenCanvasDbOptions {
  /** Name for the board a pre-boards (0.6.x) database migrates into. */
  migratedBoardName?: string;
}

export function openCanvasDb(dbPath: string, options: OpenCanvasDbOptions = {}): Database {
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
  if (needsBoardsMigration(db)) migrateToBoards(db, dbPath, options.migratedBoardName ?? 'Board');
  db.exec(SCHEMA_SQL);
  db.exec(CONTEXT_READS_SCHEMA_SQL);

  // Additive columns for pre-existing DBs (fresh installs already get them via SCHEMA_SQL above).
  ensureColumn(db, 'ax_events', 'agent_id', 'agent_id TEXT');
  ensureColumn(db, 'ax_steering', 'agent_id', 'agent_id TEXT');
  ensureColumn(db, 'ax_steering', 'target', 'target TEXT');
  ensureColumn(db, 'context_reads', 'board_id', 'board_id TEXT');
  ensureColumn(db, 'boards', 'category', 'category TEXT');
  ensureColumn(db, 'boards', 'readme_node_id', 'readme_node_id TEXT');
  ensureColumn(db, 'nodes', 'attribution', "attribution TEXT NOT NULL DEFAULT '{}' ");
  ensureColumn(db, 'nodes', 'content_revision', 'content_revision INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'snapshot_nodes', 'attribution', "attribution TEXT NOT NULL DEFAULT '{}' ");
  ensureColumn(db, 'snapshot_nodes', 'content_revision', 'content_revision INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'document_imports', 'committed_node_ids', 'committed_node_ids TEXT');

  // Set schema version if not present
  const row = db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get('schema_version');
  if (!row) {
    db.run('INSERT INTO meta (key, value) VALUES (?, ?)', ['schema_version', String(SCHEMA_VERSION)]);
  }

  return db;
}

// ── Many boards migration (schema 1 → 2) ────────────────────────

/** A pre-boards database has a `nodes` table without a `board_id` column. */
function needsBoardsMigration(db: Database): boolean {
  const columns = db.query<{ name: string }, []>('PRAGMA table_info(nodes)').all();
  return columns.length > 0 && !columns.some((column) => column.name === 'board_id');
}

export function createBoardId(): string {
  return `board-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Moves a one-board (0.6.x) database into the boards layout. The current board
 * becomes a named board and stays the open one. Every snapshot becomes a board
 * of its own: in 0.6 each session replaced the one board, so a snapshot is
 * effectively a past board (the real work of earlier sessions survives only
 * there). SQLite cannot change a primary key in place, so the board-scoped
 * tables are rebuilt. A copy of the file is written first (`<db>.pre-boards`),
 * and everything runs in one transaction.
 */
function migrateToBoards(db: Database, dbPath: string, boardName: string): void {
  const metaValue = (key: string): string | undefined =>
    db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get(key)?.value;
  // Schema 1 always created `snapshots` alongside `nodes`.
  const snapshotCount = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM snapshots').get()?.n ?? 0;
  const hasBoard = metaValue('state_populated') === '1';

  if ((hasBoard || snapshotCount > 0) && dbPath !== ':memory:') {
    const backupPath = `${dbPath}.pre-boards`;
    if (!existsSync(backupPath)) db.run('VACUUM INTO ?', [backupPath]);
  }

  const boardId = createBoardId();
  const rebuilt: Array<{ table: string; columns: string }> = [
    { table: 'nodes', columns: 'id, type, pos_x, pos_y, width, height, z_index, collapsed, pinned, data' },
    { table: 'edges', columns: 'id, from_node, to_node, type, label, style, animated' },
    { table: 'annotations', columns: 'id, type, points, bounds, color, width, text, label, created_at' },
    { table: 'context_pins', columns: 'node_id' },
    { table: 'ax_state', columns: 'key, value' },
  ];

  const migrate = db.transaction(() => {
    const existing = new Set(
      db
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name),
    );
    for (const { table } of rebuilt) {
      if (existing.has(table)) db.exec(`ALTER TABLE ${table} RENAME TO ${table}_v1`);
    }
    if (existing.has('snapshots')) ensureColumn(db, 'snapshots', 'board_id', 'board_id TEXT');
    db.exec(SCHEMA_SQL);

    if (hasBoard) {
      const now = new Date().toISOString();
      db.run(
        'INSERT INTO boards (id, name, created_at, last_opened_at, viewport_x, viewport_y, viewport_scale, tour) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          boardId,
          boardName,
          now,
          now,
          Number(metaValue('viewport_x') ?? 0),
          Number(metaValue('viewport_y') ?? 0),
          Number(metaValue('viewport_scale') ?? 1) || 1,
          metaValue('tour') ?? 'null',
        ],
      );
      for (const { table, columns } of rebuilt) {
        if (!existing.has(table)) continue;
        db.run(`INSERT INTO ${table} (board_id, ${columns}) SELECT ?, ${columns} FROM ${table}_v1`, [boardId]);
      }
      db.run(
        "INSERT INTO meta (key, value) VALUES ('active_board', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [boardId],
      );
    }
    snapshotsToBoards(db);
    for (const { table } of rebuilt) {
      if (existing.has(table)) db.exec(`DROP TABLE ${table}_v1`);
    }
    db.run("DELETE FROM meta WHERE key IN ('viewport_x', 'viewport_y', 'viewport_scale', 'tour', 'state_populated')");
    db.run("UPDATE meta SET value = ? WHERE key = 'schema_version'", [String(SCHEMA_VERSION)]);
  });
  migrate();
}

/** Each schema-1 snapshot becomes a board named after it; the snapshot rows are then removed. */
function snapshotsToBoards(db: Database): void {
  interface SnapshotRow {
    id: string;
    name: string;
    created_at: string;
  }
  const snapshots = db
    .query<SnapshotRow, []>('SELECT id, name, created_at FROM snapshots WHERE board_id IS NULL ORDER BY created_at')
    .all();
  for (const snapshot of snapshots) {
    const meta = new Map(
      db
        .query<{ key: string; value: string }, [string]>('SELECT key, value FROM snapshot_meta WHERE snapshot_id = ?')
        .all(snapshot.id)
        .map((row) => [row.key, row.value]),
    );
    const boardId = createBoardId();
    db.run(
      'INSERT INTO boards (id, name, category, created_at, viewport_x, viewport_y, viewport_scale, tour) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        boardId,
        snapshot.name,
        MIGRATED_SNAPSHOT_CATEGORY,
        snapshot.created_at,
        Number(meta.get('viewport_x') ?? 0),
        Number(meta.get('viewport_y') ?? 0),
        Number(meta.get('viewport_scale') ?? 1) || 1,
        meta.get('tour') ?? 'null',
      ],
    );
    const nodeColumns = 'id, type, pos_x, pos_y, width, height, z_index, collapsed, pinned, data';
    const edgeColumns = 'id, from_node, to_node, type, label, style, animated';
    const annotationColumns = 'id, type, points, bounds, color, width, text, label, created_at';
    db.run(
      `INSERT INTO nodes (board_id, ${nodeColumns}) SELECT ?, ${nodeColumns} FROM snapshot_nodes WHERE snapshot_id = ?`,
      [boardId, snapshot.id],
    );
    db.run(
      `INSERT INTO edges (board_id, ${edgeColumns}) SELECT ?, ${edgeColumns} FROM snapshot_edges WHERE snapshot_id = ?`,
      [boardId, snapshot.id],
    );
    db.run(
      `INSERT INTO annotations (board_id, ${annotationColumns}) SELECT ?, ${annotationColumns} FROM snapshot_annotations WHERE snapshot_id = ?`,
      [boardId, snapshot.id],
    );
    db.run('INSERT INTO context_pins (board_id, node_id) SELECT ?, node_id FROM snapshot_pins WHERE snapshot_id = ?', [
      boardId,
      snapshot.id,
    ]);
    const ax = meta.get('ax_state');
    if (ax) db.run("INSERT INTO ax_state (board_id, key, value) VALUES (?, 'state', ?)", [boardId, ax]);
    deleteSnapshotFromDB(db, snapshot.id);
  }
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
  boardId: string,
  keep: Set<string>,
): void {
  const rows = db
    .query<{ id: string }, [string]>(`SELECT ${idColumn} AS id FROM ${table} WHERE board_id = ?`)
    .all(boardId);
  if (rows.length === 0) return;
  const remove = db.prepare(`DELETE FROM ${table} WHERE board_id = ? AND ${idColumn} = ?`);
  for (const row of rows) {
    if (!keep.has(row.id)) remove.run(boardId, row.id);
  }
}

/** The theme is workspace-wide: it is saved even while no board is open. */
export function saveThemeToDB(db: Database, theme: CanvasTheme | undefined): void {
  db.run(
    `INSERT INTO meta (key, value) VALUES ('theme', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value
     WHERE value IS NOT excluded.value`,
    [normalizeCanvasTheme(theme)],
  );
}

export function readThemeFromDB(db: Database): CanvasTheme | undefined {
  const value = db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get('theme')?.value;
  return value ? normalizeCanvasTheme(value) : undefined;
}

/** Saves one board's state; every other board's rows are untouched. */
export function saveStateToDB(db: Database, boardId: string, state: PersistedCanvasState): void {
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
    saveThemeToDB(db, state.theme);
    const tour = JSON.stringify(state.tour ?? null);
    db.run(
      `UPDATE boards SET viewport_x = ?, viewport_y = ?, viewport_scale = ?, tour = ?
       WHERE id = ? AND (viewport_x IS NOT ? OR viewport_y IS NOT ? OR viewport_scale IS NOT ? OR tour IS NOT ?)`,
      [
        state.viewport.x,
        state.viewport.y,
        state.viewport.scale,
        tour,
        boardId,
        state.viewport.x,
        state.viewport.y,
        state.viewport.scale,
        tour,
      ],
    );

    // Save nodes
    const upsertNode = db.prepare(
      `INSERT INTO nodes (board_id, id, type, pos_x, pos_y, width, height, z_index, collapsed, pinned, data, attribution, content_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(board_id, id) DO UPDATE SET
         type = excluded.type, pos_x = excluded.pos_x, pos_y = excluded.pos_y,
         width = excluded.width, height = excluded.height, z_index = excluded.z_index,
         collapsed = excluded.collapsed, pinned = excluded.pinned, data = excluded.data,
         attribution = excluded.attribution, content_revision = excluded.content_revision
       WHERE type IS NOT excluded.type OR pos_x IS NOT excluded.pos_x
          OR pos_y IS NOT excluded.pos_y OR width IS NOT excluded.width
          OR height IS NOT excluded.height OR z_index IS NOT excluded.z_index
          OR collapsed IS NOT excluded.collapsed OR pinned IS NOT excluded.pinned
          OR data IS NOT excluded.data OR attribution IS NOT excluded.attribution
          OR content_revision IS NOT excluded.content_revision`,
    );
    for (const node of state.nodes) {
      upsertNode.run(
        boardId,
        node.id,
        node.type,
        node.position.x,
        node.position.y,
        node.size.width,
        node.size.height,
        node.zIndex,
        node.collapsed ? 1 : 0,
        node.pinned ? 1 : 0,
        JSON.stringify(node.data),
        JSON.stringify({ createdBy: node.createdBy, lastEditedBy: node.lastEditedBy }),
        node.contentRevision ?? 0,
      );
    }
    deleteMissingRows(db, 'nodes', 'id', boardId, new Set(state.nodes.map((node) => node.id)));

    // Save edges
    const upsertEdge = db.prepare(
      `INSERT INTO edges (board_id, id, from_node, to_node, type, label, style, animated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(board_id, id) DO UPDATE SET
         from_node = excluded.from_node, to_node = excluded.to_node, type = excluded.type,
         label = excluded.label, style = excluded.style, animated = excluded.animated
       WHERE from_node IS NOT excluded.from_node OR to_node IS NOT excluded.to_node
          OR type IS NOT excluded.type OR label IS NOT excluded.label
          OR style IS NOT excluded.style OR animated IS NOT excluded.animated`,
    );
    for (const edge of state.edges) {
      upsertEdge.run(
        boardId,
        edge.id,
        edge.from,
        edge.to,
        edge.type,
        edge.label ?? null,
        edge.style ?? null,
        edge.animated ? 1 : 0,
      );
    }
    deleteMissingRows(db, 'edges', 'id', boardId, new Set(state.edges.map((edge) => edge.id)));

    // Save annotations
    const annotations = state.annotations ?? [];
    const upsertAnnotation = db.prepare(
      `INSERT INTO annotations (board_id, id, type, points, bounds, color, width, text, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(board_id, id) DO UPDATE SET
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
        boardId,
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
    deleteMissingRows(db, 'annotations', 'id', boardId, new Set(annotations.map((annotation) => annotation.id)));

    // Save context pins (node_id is the whole row — nothing to update)
    const insertPin = db.prepare('INSERT OR IGNORE INTO context_pins (board_id, node_id) VALUES (?, ?)');
    for (const pinId of state.contextPins) {
      insertPin.run(boardId, pinId);
    }
    deleteMissingRows(db, 'context_pins', 'node_id', boardId, new Set(state.contextPins));

    db.run(
      `INSERT INTO ax_state (board_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(board_id, key) DO UPDATE SET value = excluded.value
       WHERE value IS NOT excluded.value`,
      [boardId, 'state', JSON.stringify(state.ax ?? createEmptyAxState())],
    );
    db.run(
      `INSERT INTO ax_state (board_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(board_id, key) DO UPDATE SET value = excluded.value
       WHERE value IS NOT excluded.value`,
      [boardId, 'revision', JSON.stringify(state.revisionState ?? { revision: 0, floor: 0, tombstones: [] })],
    );
  });

  transaction();
}

/** Loads one board (the open board when `boardId` is omitted); null when there is no such board. */
export function loadStateFromDB(db: Database, boardId?: string): PersistedCanvasState | null {
  const id = boardId ?? getActiveBoardIdFromDB(db);
  if (!id) return null;
  interface BoardRow {
    viewport_x: number;
    viewport_y: number;
    viewport_scale: number;
    tour: string;
  }
  const board = db
    .query<BoardRow, [string]>('SELECT viewport_x, viewport_y, viewport_scale, tour FROM boards WHERE id = ?')
    .get(id);
  if (!board) return null;

  const viewport: ViewportState = {
    x: board.viewport_x,
    y: board.viewport_y,
    scale: board.viewport_scale || 1,
  };
  const theme = readThemeFromDB(db);

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
    data: string;
    attribution: string;
    content_revision: number;
  }
  const nodeRows = db.query<NodeRow, [string]>('SELECT * FROM nodes WHERE board_id = ?').all(id);
  const nodes: CanvasNodeState[] = nodeRows.map((row) => {
    const attribution = JSON.parse(row.attribution || '{}') as Partial<
      Pick<CanvasNodeState, 'createdBy' | 'lastEditedBy'>
    >;
    return {
      id: row.id,
      type: row.type as CanvasNodeState['type'],
      position: { x: row.pos_x, y: row.pos_y },
      size: { width: row.width, height: row.height },
      zIndex: row.z_index,
      collapsed: row.collapsed === 1,
      pinned: row.pinned === 1,
      data: JSON.parse(row.data) as Record<string, unknown>,
      createdBy: attribution.createdBy,
      lastEditedBy: attribution.lastEditedBy,
      contentRevision: row.content_revision,
    };
  });

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
  const edgeRows = db.query<EdgeRow, [string]>('SELECT * FROM edges WHERE board_id = ?').all(id);
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
  const annotationRows = db.query<AnnotationRow, [string]>('SELECT * FROM annotations WHERE board_id = ?').all(id);
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
  const pinRows = db.query<PinRow, [string]>('SELECT node_id FROM context_pins WHERE board_id = ?').all(id);
  const contextPins = pinRows.map((row) => row.node_id);

  const axRow = db
    .query<{ value: string }, [string, string]>('SELECT value FROM ax_state WHERE board_id = ? AND key = ?')
    .get(id, 'state');

  const revisionRaw = db
    .query<{ value: string }, [string, string]>('SELECT value FROM ax_state WHERE board_id = ? AND key = ?')
    .get(id, 'revision')?.value;
  return {
    version: 1,
    theme,
    tour: readTour(board.tour),
    viewport,
    nodes,
    edges,
    annotations,
    contextPins,
    ax: parsePersistedAxState(axRow?.value),
    revisionState: revisionRaw ? (JSON.parse(revisionRaw) as PersistedRevisionState) : undefined,
  };
}

// ── Boards ──────────────────────────────────────────────────────

export interface CanvasBoard {
  id: string;
  name: string;
  /** A human-chosen shelf on Home ("Planning", "Research"); null is uncategorized. */
  category: string | null;
  createdAt: string;
  lastOpenedAt: string | null;
  nodeCount: number;
  /** Markdown node used as this board's introduction. */
  readmeNodeId: string | null;
}

interface BoardListRow {
  id: string;
  name: string;
  category: string | null;
  created_at: string;
  last_opened_at: string | null;
  node_count: number;
  readme_node_id: string | null;
}

const BOARD_LIST_SQL = `SELECT b.id, b.name, b.category, b.created_at, b.last_opened_at, b.readme_node_id,
    (SELECT COUNT(*) FROM nodes n WHERE n.board_id = b.id) AS node_count
  FROM boards b`;

function rowToBoard(row: BoardListRow): CanvasBoard {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
    nodeCount: row.node_count,
    readmeNodeId: row.readme_node_id,
  };
}

/** Most recently opened first, then never-opened boards, newest first. */
export function listBoardsFromDB(db: Database): CanvasBoard[] {
  return db
    .query<BoardListRow, []>(`${BOARD_LIST_SQL} ORDER BY b.last_opened_at DESC NULLS LAST, b.created_at DESC`)
    .all()
    .map(rowToBoard);
}

export function getBoardFromDB(db: Database, id: string): CanvasBoard | null {
  const row = db.query<BoardListRow, [string]>(`${BOARD_LIST_SQL} WHERE b.id = ?`).get(id);
  return row ? rowToBoard(row) : null;
}

export function createBoardInDB(db: Database, name: string, category: string | null = null): CanvasBoard {
  category = normalizeBoardCategory(category);
  const id = createBoardId();
  const createdAt = new Date(Date.now()).toISOString();
  db.run('INSERT INTO boards (id, name, category, created_at) VALUES (?, ?, ?, ?)', [id, name, category, createdAt]);
  return { id, name, category, createdAt, lastOpenedAt: null, nodeCount: 0, readmeNodeId: null };
}

/** Rename and/or re-shelve a board; `category: null` removes it from its category. */
export function updateBoardInDB(
  db: Database,
  id: string,
  patch: { name?: string; category?: string | null; readmeNodeId?: string | null },
): boolean {
  const category = patch.category === undefined ? undefined : normalizeBoardCategory(patch.category);
  if (!db.query<{ id: string }, [string]>('SELECT id FROM boards WHERE id = ?').get(id)) return false;
  if (patch.name !== undefined) db.run('UPDATE boards SET name = ? WHERE id = ?', [patch.name, id]);
  if (category !== undefined) db.run('UPDATE boards SET category = ? WHERE id = ?', [category, id]);
  if (patch.readmeNodeId !== undefined) {
    db.run('UPDATE boards SET readme_node_id = ? WHERE id = ?', [patch.readmeNodeId, id]);
  }
  return true;
}

/** Create and populate an inactive board as one SQLite transaction. */
export function createBoardWithStateInDB(
  db: Database,
  name: string,
  category: string | null,
  state: PersistedCanvasState,
  readmeNodeId: string | null,
): CanvasBoard {
  return db.transaction(() => {
    const board = createBoardInDB(db, name, category);
    saveStateToDB(db, board.id, state);
    updateBoardInDB(db, board.id, { readmeNodeId });
    return { ...board, nodeCount: state.nodes.length, readmeNodeId };
  })();
}

/** Deletes a board with its rows and its snapshots. */
export function deleteBoardFromDB(db: Database, id: string): boolean {
  const transaction = db.transaction(() => {
    for (const table of ['nodes', 'edges', 'annotations', 'context_pins', 'ax_state']) {
      db.run(`DELETE FROM ${table} WHERE board_id = ?`, [id]);
    }
    const snapshotIds = db
      .query<{ id: string }, [string]>('SELECT id FROM snapshots WHERE board_id = ?')
      .all(id)
      .map((row) => row.id);
    for (const snapshotId of snapshotIds) deleteSnapshotFromDB(db, snapshotId);
    db.run('DELETE FROM document_imports WHERE board_id = ?', [id]);
    db.run('DELETE FROM attachments WHERE board_id = ?', [id]);
    db.run('DELETE FROM attachment_bytes WHERE sha256 NOT IN (SELECT sha256 FROM attachments)');
    db.run("DELETE FROM meta WHERE key = 'active_board' AND value = ?", [id]);
    return db.run('DELETE FROM boards WHERE id = ?', [id]).changes > 0;
  });
  return transaction();
}

export function readMetaFromDB(db: Database, key: string): string | null {
  return db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

/** Write a workspace-wide meta value; null removes it. */
export function writeMetaToDB(db: Database, key: string, value: string | null): void {
  if (value === null) {
    db.run('DELETE FROM meta WHERE key = ?', [key]);
    return;
  }
  db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
}

/** The board that was open last, if it still exists. */
export function getActiveBoardIdFromDB(db: Database): string | null {
  const id = db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get('active_board')?.value;
  if (!id) return null;
  return db.query<{ id: string }, [string]>('SELECT id FROM boards WHERE id = ?').get(id) ? id : null;
}

export function setActiveBoardIdInDB(db: Database, id: string | null): void {
  if (!id) {
    db.run("DELETE FROM meta WHERE key = 'active_board'");
    return;
  }
  const latestOpenedAt = db
    .query<{ value: string }, []>('SELECT MAX(last_opened_at) AS value FROM boards')
    .get()?.value;
  const now = Date.now();
  const openedAt = new Date(Math.max(now, latestOpenedAt ? Date.parse(latestOpenedAt) + 1 : now)).toISOString();
  db.run(
    "INSERT INTO meta (key, value) VALUES ('active_board', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [id],
  );
  db.run('UPDATE boards SET last_opened_at = ? WHERE id = ?', [openedAt, id]);
}

// ── Snapshot Persistence ────────────────────────────────────────

export function saveSnapshotToDB(
  db: Database,
  boardId: string,
  snapshot: CanvasSnapshot,
  state: PersistedCanvasState,
): void {
  const transaction = db.transaction(() => {
    // Insert snapshot metadata
    db.run('INSERT INTO snapshots (id, board_id, name, created_at, node_count, edge_count) VALUES (?, ?, ?, ?, ?, ?)', [
      snapshot.id,
      boardId,
      snapshot.name,
      snapshot.createdAt,
      state.nodes.length,
      state.edges.length,
    ]);

    db.run('INSERT INTO snapshot_meta (snapshot_id, key, value) VALUES (?, ?, ?)', [
      snapshot.id,
      'tour',
      JSON.stringify(state.tour ?? null),
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
      `INSERT INTO snapshot_nodes (snapshot_id, id, type, pos_x, pos_y, width, height, z_index, collapsed, pinned, data, attribution, content_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        JSON.stringify(node.data),
        JSON.stringify({ createdBy: node.createdBy, lastEditedBy: node.lastEditedBy }),
        node.contentRevision ?? 0,
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
    db.run('INSERT INTO snapshot_meta (snapshot_id, key, value) VALUES (?, ?, ?)', [
      snapshot.id,
      'revision_state',
      JSON.stringify(state.revisionState ?? { revision: 0, floor: 0, tombstones: [] }),
    ]);
  });

  transaction();
}

/** By id or name (most recent match) on `boardId`. */
export function loadSnapshotFromDB(
  db: Database,
  idOrName: string,
  boardId: string | null,
): { snapshot: CanvasSnapshot; state: PersistedCanvasState } | null {
  if (!boardId) return null;

  interface SnapshotRow {
    id: string;
    name: string;
    created_at: string;
    node_count: number;
    edge_count: number;
  }
  let snapshotRow = db
    .query<SnapshotRow, [string, string]>('SELECT * FROM snapshots WHERE board_id = ? AND id = ?')
    .get(boardId, idOrName);

  if (!snapshotRow) {
    snapshotRow = db
      .query<SnapshotRow, [string, string]>(
        'SELECT * FROM snapshots WHERE board_id = ? AND name = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(boardId, idOrName);
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
    data: string;
    attribution: string;
    content_revision: number;
  }
  const nodeRows = db
    .query<NodeRow, [string]>('SELECT * FROM snapshot_nodes WHERE snapshot_id = ?')
    .all(snapshotRow.id);
  const nodes: CanvasNodeState[] = nodeRows.map((row) => {
    const attribution = JSON.parse(row.attribution || '{}') as Partial<
      Pick<CanvasNodeState, 'createdBy' | 'lastEditedBy'>
    >;
    return {
      id: row.id,
      type: row.type as CanvasNodeState['type'],
      position: { x: row.pos_x, y: row.pos_y },
      size: { width: row.width, height: row.height },
      zIndex: row.z_index,
      collapsed: row.collapsed === 1,
      pinned: row.pinned === 1,
      data: JSON.parse(row.data) as Record<string, unknown>,
      createdBy: attribution.createdBy,
      lastEditedBy: attribution.lastEditedBy,
      contentRevision: row.content_revision,
    };
  });

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
      tour: readTour(metaMap.get('tour')),
      viewport,
      nodes,
      edges,
      annotations,
      contextPins,
      ax: parsePersistedAxState(metaMap.get('ax_state')),
      revisionState: metaMap.has('revision_state')
        ? (JSON.parse(metaMap.get('revision_state')!) as PersistedRevisionState)
        : undefined,
    },
  };
}

export function listSnapshotsFromDB(
  db: Database,
  boardId: string,
  options: CanvasSnapshotListOptions = {},
): CanvasSnapshot[] {
  const query = options.query?.trim().toLowerCase();
  const before = normalizeSnapshotTimestamp(options.before);
  const after = normalizeSnapshotTimestamp(options.after);
  const limit = options.all ? undefined : (normalizePositiveInteger(options.limit) ?? 20);

  let sql = 'SELECT * FROM snapshots WHERE board_id = ?';
  const params: string[] = [boardId];

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

export function renameSnapshotInDB(db: Database, boardId: string, id: string, name: string): boolean {
  return db.run('UPDATE snapshots SET name = ? WHERE board_id = ? AND id = ?', [name, boardId, id]).changes > 0;
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
  if (table === 'ax_steering') {
    db.run('DELETE FROM ax_steering_deliveries WHERE steering_id NOT IN (SELECT id FROM ax_steering)');
  }
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

export function markAxSteeringDeliveredInDB(db: Database, id: string, consumer?: string | null): boolean {
  // ADDRESSED steer (target set): global compare-and-set as before — one
  // legitimate recipient, true only on the undelivered→delivered transition.
  // BROADCAST + consumer: per-consumer delivery ("all workers: stop" must
  // reach every worker) — the mark records THIS consumer's pickup and the
  // message stays pending for everyone else; true iff this consumer had not
  // marked it before. BROADCAST without a consumer: the legacy anonymous ack
  // (global CAS) that hides it from all consumers.
  const row = db.query<{ target: string | null }, [string]>('SELECT target FROM ax_steering WHERE id = ?').get(id);
  if (!row) return false;
  // An addressed steer belongs to its target. A different named consumer marking
  // it delivered would silently swallow the human's instruction (the target then
  // never sees it). A consumer-less mark is still the single legitimate host ack.
  if (row.target !== null && consumer && consumer !== row.target) return false;
  if (row.target === null && consumer) {
    const r = db.run('INSERT OR IGNORE INTO ax_steering_deliveries (steering_id, consumer, at) VALUES (?, ?, ?)', [
      id,
      consumer,
      new Date().toISOString(),
    ]);
    return r.changes > 0;
  }
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

/**
 * Broadcasts age out of PENDING (they stay on the timeline): per-consumer
 * delivery otherwise means every broadcast greets every FUTURE consumer key
 * forever — a brand-new pump inherited two-day-old "all workers" calls.
 * Addressed steers never expire here; they wait for their named consumer.
 */
export const BROADCAST_PENDING_TTL_MS = 15 * 60_000;

function broadcastCutoffIso(): string {
  return new Date(Date.now() - BROADCAST_PENDING_TTL_MS).toISOString();
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
  const deliveredTo = new Map<string, string[]>();
  for (const row of db
    .query<{ steering_id: string; consumer: string }, []>('SELECT steering_id, consumer FROM ax_steering_deliveries')
    .all()) {
    if (!deliveredTo.has(row.steering_id)) deliveredTo.set(row.steering_id, []);
    deliveredTo.get(row.steering_id)!.push(row.consumer);
  }
  return rows
    .map((row) => {
      const mapped = mapAxSteeringRow(row);
      if (!mapped) return null;
      const pickups = deliveredTo.get(mapped.id) ?? [];
      // A broadcast reads as delivered once ANY consumer picked it up; the
      // per-consumer list is exposed for fleet UIs ("picked up by 3").
      return {
        ...mapped,
        delivered: mapped.delivered || pickups.length > 0,
        ...(pickups.length > 0 ? { deliveredTo: pickups } : {}),
      };
    })
    .filter((s): s is PmxAxSteeringMessage => s !== null);
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
        .query<AxSteeringRow, [string, string, string, string, string, number]>(
          // A broadcast stays pending PER CONSUMER: it leaves this consumer's
          // queue only once THIS consumer marked it (or an anonymous global ack
          // set delivered).
          'SELECT * FROM ax_steering s WHERE s.delivered = 0 AND (s.source IS NULL OR s.source != ?) AND (s.agent_id IS NULL OR s.agent_id != ?) AND (s.target IS NULL OR s.target = ?) AND (s.target IS NOT NULL OR s.created_at > ?) AND NOT EXISTS (SELECT 1 FROM ax_steering_deliveries d WHERE d.steering_id = s.id AND d.consumer = ?) ORDER BY s.seq ASC LIMIT ?',
        )
        .all(options.consumer, options.consumer, options.consumer, broadcastCutoffIso(), options.consumer, limit)
    : db
        .query<AxSteeringRow, [string, number]>(
          // No consumer given: only broadcasts — addressed steering is claimable
          // solely by the consumer it names.
          'SELECT * FROM ax_steering WHERE delivered = 0 AND target IS NULL AND created_at > ? ORDER BY seq ASC LIMIT ?',
        )
        .all(broadcastCutoffIso(), limit);
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
        .query<AxSteeringRow, [string, string, string, string, string, number]>(
          'SELECT * FROM ax_steering s WHERE s.delivered = 0 AND (s.source IS NULL OR s.source != ?) AND (s.agent_id IS NULL OR s.agent_id != ?) AND (s.target IS NULL OR s.target = ?) AND (s.target IS NOT NULL OR s.created_at > ?) AND NOT EXISTS (SELECT 1 FROM ax_steering_deliveries d WHERE d.steering_id = s.id AND d.consumer = ?) ORDER BY s.seq DESC LIMIT ?',
        )
        .all(options.consumer, options.consumer, options.consumer, broadcastCutoffIso(), options.consumer, limit)
    : db
        .query<AxSteeringRow, [number]>(
          'SELECT * FROM ax_steering WHERE delivered = 0 AND target IS NULL ORDER BY seq DESC LIMIT ?',
        )
        .all(limit);
  return rows.map(mapAxSteeringRow).filter((s): s is PmxAxSteeringMessage => s !== null);
}

/** Total undelivered steering for a consumer (loop-safe — excludes the consumer's own; target-scoped). */
export function countPendingAxSteeringFromDB(db: Database, consumer?: string): number {
  // Must mirror loadPendingAxSteeringFromDB exactly (per-consumer deliveries,
  // broadcast TTL) — the roster shows this as "what would this consumer claim".
  const n = consumer
    ? db
        .query<{ n: number }, [string, string, string, string, string]>(
          'SELECT COUNT(*) AS n FROM ax_steering s WHERE s.delivered = 0 AND (s.source IS NULL OR s.source != ?) AND (s.agent_id IS NULL OR s.agent_id != ?) AND (s.target IS NULL OR s.target = ?) AND (s.target IS NOT NULL OR s.created_at > ?) AND NOT EXISTS (SELECT 1 FROM ax_steering_deliveries d WHERE d.steering_id = s.id AND d.consumer = ?)',
        )
        .get(consumer, consumer, consumer, broadcastCutoffIso(), consumer)?.n
    : db
        .query<{ n: number }, [string]>(
          'SELECT COUNT(*) AS n FROM ax_steering WHERE delivered = 0 AND target IS NULL AND created_at > ?',
        )
        .get(broadcastCutoffIso())?.n;
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
