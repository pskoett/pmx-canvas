import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { openCanvasBoard, refreshCanvasWebpageNode } from '../../src/server/canvas-operations.ts';
import { canvasState, type CanvasNodeState } from '../../src/server/canvas-state.ts';
import { intentRegistry } from '../../src/server/intent-registry.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { runCanvasBatchOperation } from '../../src/server/operations/index.ts';
import { isEmitSuppressed } from '../../src/server/operations/registry.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

/** The one-board layout every 0.6.x workspace has on disk (schema 1). */
const SCHEMA_1 = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE nodes (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, pos_x REAL NOT NULL, pos_y REAL NOT NULL,
    width REAL NOT NULL, height REAL NOT NULL, z_index INTEGER NOT NULL DEFAULT 0,
    collapsed INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL
  );
  CREATE TABLE edges (
    id TEXT PRIMARY KEY, from_node TEXT NOT NULL, to_node TEXT NOT NULL, type TEXT NOT NULL,
    label TEXT, style TEXT, animated INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE annotations (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, points TEXT NOT NULL, bounds TEXT NOT NULL,
    color TEXT NOT NULL, width REAL NOT NULL, text TEXT, label TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE context_pins (node_id TEXT PRIMARY KEY);
  CREATE TABLE ax_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE snapshots (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
    node_count INTEGER NOT NULL, edge_count INTEGER NOT NULL
  );
  CREATE TABLE snapshot_nodes (
    snapshot_id TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, pos_x REAL NOT NULL, pos_y REAL NOT NULL,
    width REAL NOT NULL, height REAL NOT NULL, z_index INTEGER NOT NULL DEFAULT 0,
    collapsed INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, id)
  );
  CREATE TABLE snapshot_pins (snapshot_id TEXT NOT NULL, node_id TEXT NOT NULL, PRIMARY KEY (snapshot_id, node_id));
  CREATE TABLE snapshot_meta (snapshot_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (snapshot_id, key));
`;

function writeSchema1Workspace(root: string): string {
  const dir = join(root, '.pmx-canvas');
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, 'canvas.db');
  const db = new Database(dbPath);
  db.exec(SCHEMA_1);
  for (const [key, value] of [
    ['schema_version', '1'],
    ['theme', 'sepia'],
    ['tour', 'null'],
    ['viewport_x', '-120'],
    ['viewport_y', '40'],
    ['viewport_scale', '0.5'],
    ['state_populated', '1'],
  ]) {
    db.run('INSERT INTO meta (key, value) VALUES (?, ?)', [key, value]);
  }
  const node = (id: string, title: string) =>
    db.run(
      "INSERT INTO nodes (id, type, pos_x, pos_y, width, height, data) VALUES (?, 'markdown', 0, 0, 360, 200, ?)",
      [id, JSON.stringify({ title, content: title })],
    );
  node('okr-1', 'Objective one');
  node('okr-2', 'Objective two');
  db.run("INSERT INTO edges (id, from_node, to_node, type) VALUES ('e1', 'okr-1', 'okr-2', 'flow')");
  db.run("INSERT INTO context_pins (node_id) VALUES ('okr-1')");
  // Two past boards that survive only as snapshots, one sharing a node id with the live board.
  const snapshot = (id: string, name: string, at: string, nodeIds: string[]) => {
    db.run('INSERT INTO snapshots (id, name, created_at, node_count, edge_count) VALUES (?, ?, ?, ?, 0)', [
      id,
      name,
      at,
      nodeIds.length,
    ]);
    for (const nodeId of nodeIds) {
      db.run(
        "INSERT INTO snapshot_nodes (snapshot_id, id, type, pos_x, pos_y, width, height, data) VALUES (?, ?, 'markdown', 0, 0, 360, 200, ?)",
        [id, nodeId, JSON.stringify({ title: `${name} ${nodeId}` })],
      );
    }
    db.run("INSERT INTO snapshot_meta (snapshot_id, key, value) VALUES (?, 'viewport_scale', '0.75')", [id]);
  };
  snapshot('snap-april', 'April OKRs', '2026-04-15T00:00:00.000Z', ['okr-1', 'metric-1', 'metric-2']);
  snapshot('snap-june', 'Discovery', '2026-06-22T00:00:00.000Z', ['card-1']);
  db.run("INSERT INTO snapshot_pins (snapshot_id, node_id) VALUES ('snap-june', 'card-1')");
  db.close();
  return dbPath;
}

let root = '';

function note(id: string, title: string): CanvasNodeState {
  return {
    id,
    type: 'markdown',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 200 },
    zIndex: 0,
    collapsed: false,
    pinned: false,
    data: { title, content: title },
  };
}

beforeEach(() => {
  root = createTestWorkspace('pmx-canvas-boards-');
});

afterEach(() => {
  canvasState.close();
  removeTestWorkspace(root);
});

describe('migrating a one-board workspace', () => {
  test('the live board stays open, every old snapshot becomes its own board, and a copy is kept', async () => {
    const dbPath = writeSchema1Workspace(root);
    resetCanvasForTests(root);

    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    const boards = canvasState.listBoards();
    // Migrated snapshots are filed on their own shelf; the live board is not.
    expect(boards.map((entry) => entry.category)).toEqual([null, 'From old snapshots', 'From old snapshots']);
    expect(boards.map((entry) => [entry.name, entry.nodeCount])).toEqual([
      [basename(root), 2],
      ['Discovery', 1],
      ['April OKRs', 3],
    ]);
    const [board] = boards;
    expect(canvasState.activeBoardId).toBe(board.id);
    expect(
      canvasState
        .getLayout()
        .nodes.map((node) => node.id)
        .sort(),
    ).toEqual(['okr-1', 'okr-2']);
    expect(canvasState.getLayout().edges.map((edge) => edge.id)).toEqual(['e1']);
    expect([...canvasState.contextPinnedNodeIds]).toEqual(['okr-1']);
    expect(canvasState.viewport).toEqual({ x: -120, y: 40, scale: 0.5 });
    expect(canvasState.theme).toBe('sepia');
    // The snapshots are boards now, not snapshots of the live board.
    expect(canvasState.listSnapshots({ all: true })).toEqual([]);
    expect(existsSync(`${dbPath}.pre-boards`)).toBe(true);

    // A past board opens whole, with its own pins and viewport.
    const discovery = boards.find((entry) => entry.name === 'Discovery');
    expect(openCanvasBoard(discovery?.id ?? '')).toEqual({ ok: true });
    expect(canvasState.getLayout().nodes.map((node) => node.id)).toEqual(['card-1']);
    expect([...canvasState.contextPinnedNodeIds]).toEqual(['card-1']);
    expect(canvasState.viewport.scale).toBe(0.75);
    await openCanvasBoard(board.id);

    // Opening again is a no-op: same boards, same data.
    canvasState.close();
    resetCanvasForTests(root);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    expect(canvasState.listBoards().map((entry) => entry.id)).toEqual(boards.map((entry) => entry.id));
  });
});

describe('boards', () => {
  beforeEach(() => {
    resetCanvasForTests(root);
    canvasState.loadFromDisk({ clearExisting: true });
  });

  test('a fresh workspace starts on Home, and the first content opens a new board', () => {
    expect(canvasState.activeBoardId).toBeNull();
    expect(canvasState.listBoards()).toEqual([]);

    canvasState.addNode(note('first', 'First'));
    canvasState.flushToDisk();

    expect(canvasState.activeBoardId).not.toBeNull();
    expect(canvasState.listBoards()).toHaveLength(1);
  });

  test('switching boards keeps each board whole: nodes, pins, viewport, AX state and snapshots', async () => {
    canvasState.addNode(note('a-node', 'On A'));
    canvasState.setContextPins(['a-node']);
    canvasState.setViewport({ x: 11, y: 22, scale: 0.8 });
    canvasState.addWorkItem({ title: 'A work' });
    canvasState.flushToDisk();
    const boardA = canvasState.activeBoardId as string;
    canvasState.saveSnapshot('A snapshot');

    const boardB = canvasState.createBoard('Board B');
    expect(boardB).not.toBeNull();
    expect(await openCanvasBoard(boardB?.id ?? '')).toEqual({ ok: true });
    expect(canvasState.getLayout().nodes).toEqual([]);
    expect([...canvasState.contextPinnedNodeIds]).toEqual([]);
    expect(canvasState.getWorkItems()).toEqual([]);
    expect(canvasState.listSnapshots({ all: true })).toEqual([]);
    canvasState.addNode(note('b-node', 'On B'));

    expect(await openCanvasBoard(boardA)).toEqual({ ok: true });
    expect(canvasState.getLayout().nodes.map((node) => node.id)).toEqual(['a-node']);
    expect([...canvasState.contextPinnedNodeIds]).toEqual(['a-node']);
    expect(canvasState.viewport).toEqual({ x: 11, y: 22, scale: 0.8 });
    expect(canvasState.getWorkItems().map((item) => item.title)).toEqual(['A work']);
    expect(canvasState.listSnapshots({ all: true }).map((snapshot) => snapshot.name)).toEqual(['A snapshot']);

    const byName = new Map(canvasState.listBoards().map((board) => [board.name, board]));
    expect(byName.get('Board B')?.nodeCount).toBe(1);
    // Most recently opened first.
    expect(canvasState.listBoards()[0].id).toBe(boardA);

    // A restart reopens the board that was open last.
    canvasState.close();
    resetCanvasForTests(root);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    expect(canvasState.activeBoardId).toBe(boardA);
  });

  test('opening a board drops undo history and pending intents from the previous one', async () => {
    canvasState.addNode(note('kept', 'Kept'));
    canvasState.flushToDisk();
    // Undo closures capture the open board; replaying one on another board would corrupt it.
    mutationHistory.record({
      description: 'add kept',
      operationType: 'addNode',
      forward: () => {},
      inverse: () => canvasState.removeNode('kept'),
    });
    expect(mutationHistory.canUndo()).toBe(true);
    intentRegistry.signal({ kind: 'create', label: 'about to add', nodeType: 'markdown', position: { x: 0, y: 0 } });

    const other = canvasState.createBoard('Other');
    await openCanvasBoard(other?.id ?? '');
    expect(mutationHistory.canUndo()).toBe(false);
    expect(intentRegistry.list()).toEqual([]);
  });

  test('deleting the open board returns to Home and removes its snapshots', async () => {
    canvasState.addNode(note('doomed', 'Doomed'));
    canvasState.flushToDisk();
    const doomed = canvasState.activeBoardId as string;
    const snapshot = canvasState.saveSnapshot('before delete');

    expect(canvasState.deleteBoard(doomed)).toBe(true);
    expect(canvasState.activeBoardId).toBeNull();
    expect(canvasState.getLayout().nodes).toEqual([]);
    expect(canvasState.listBoards()).toEqual([]);
    expect(canvasState.restoreSnapshot(snapshot?.id ?? '')).toBe(false);
  });

  test('opening an unknown board changes nothing', async () => {
    canvasState.addNode(note('stay', 'Stay'));
    canvasState.flushToDisk();
    const before = canvasState.activeBoardId;
    expect(await openCanvasBoard('board-missing')).toEqual({ ok: false });
    expect(canvasState.activeBoardId).toBe(before);
    expect(canvasState.getLayout().nodes.map((node) => node.id)).toEqual(['stay']);
  });

  test('a failed save prevents switching and keeps the unsaved board in memory', () => {
    canvasState.addNode(note('saved', 'Saved'));
    canvasState.flushToDisk();
    const current = canvasState.activeBoardId;
    const other = canvasState.createBoard('Other');
    canvasState.addNode(note('unsaved', 'Unsaved'));

    const db = new Database(canvasState.databasePath as string);
    db.exec("CREATE TRIGGER reject_node_save BEFORE INSERT ON nodes BEGIN SELECT RAISE(FAIL, 'save rejected'); END");
    try {
      expect(() => openCanvasBoard(other?.id ?? '')).toThrow('save rejected');
      expect(canvasState.activeBoardId).toBe(current);
      expect(canvasState.getLayout().nodes.map((node) => node.id)).toEqual(['saved', 'unsaved']);
      expect(canvasState.persistenceHealth.ok).toBe(false);
    } finally {
      db.exec('DROP TRIGGER reject_node_save');
      db.close();
    }
  });

  test('a batch stops at a board switch without suppressing concurrent human events', async () => {
    canvasState.addNode(note('anchor', 'A'));
    canvasState.flushToDisk();
    const a = canvasState.activeBoardId as string;
    const b = canvasState.createBoard('B')!;
    const pending = runCanvasBatchOperation([
      { op: 'node.add', args: { type: 'markdown', title: 'first' } },
      { op: 'node.add', args: { type: 'markdown', title: 'must not appear on B' } },
    ]);
    expect(isEmitSuppressed()).toBe(false);
    canvasState.switchBoard(b.id);
    expect(await pending).toMatchObject({
      ok: false,
      failedIndex: 0,
      error: 'The board changed while the batch was running.',
    });
    expect(canvasState.getLayout().nodes).toEqual([]);
    expect(canvasState.readBoard(a)?.layout.nodes.map((node) => node.data.title)).toContain('first');
  });

  test('close refuses a failed pending save, then retries a failed debounce after recovery', async () => {
    canvasState.addNode(note('saved', 'Saved'));
    canvasState.flushToDisk();
    const path = canvasState.databasePath as string;
    const db = new Database(path);
    db.exec("CREATE TRIGGER reject_node_save BEFORE INSERT ON nodes BEGIN SELECT RAISE(FAIL, 'save rejected'); END");
    try {
      canvasState.addNode(note('unsaved', 'Unsaved'));
      expect(() => canvasState.close()).toThrow('save rejected');
      expect(canvasState.databasePath).toBe(path);
      expect(canvasState.getNode('unsaved')).toBeDefined();
      canvasState.addNode(note('after-failure', 'After failure'));
      await Bun.sleep(650);
      expect(canvasState.persistenceHealth.ok).toBe(false);
    } finally {
      db.exec('DROP TRIGGER reject_node_save');
      db.close();
    }
    canvasState.close();
    canvasState.setWorkspaceRoot(root);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    expect(
      canvasState
        .getLayout()
        .nodes.map((node) => node.id)
        .sort(),
    ).toEqual(['after-failure', 'saved', 'unsaved']);
  });

  test.each([
    false,
    true,
  ])('an in-flight webpage refresh is invalidated by a board switch (return=%s)', async (returnToA) => {
    let release!: (response: Response) => void;
    let started!: () => void;
    const received = new Promise<void>((resolve) => {
      started = resolve;
    });
    const response = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch() {
        started();
        return response;
      },
    });
    const url = `http://127.0.0.1:${server.port}/a`;
    const webpage = (title: string): CanvasNodeState => ({
      ...note('shared', title),
      type: 'webpage',
      data: { title, url, status: 'ready' },
    });
    canvasState.addNode(webpage('A original'));
    canvasState.flushToDisk();
    const a = canvasState.activeBoardId as string;
    const b = canvasState.createBoard('B')!;
    canvasState.switchBoard(b.id);
    canvasState.addNode(webpage('B original'));
    canvasState.switchBoard(a);
    const pending = refreshCanvasWebpageNode('shared');
    try {
      await received;
      canvasState.switchBoard(b.id);
      if (returnToA) canvasState.switchBoard(a);
      release(new Response('<title>Fetched A</title><p>Fetched content</p>'));
      expect(await pending).toMatchObject({ ok: false, error: 'The board changed during webpage refresh.' });
      expect(canvasState.getNode('shared')?.data.title).toBe(returnToA ? 'A original' : 'B original');
      expect(canvasState.readBoard(a)?.layout.nodes[0]?.data.status).toBe('ready');
      expect(canvasState.readBoard(b.id)?.layout.nodes[0]?.data.title).toBe('B original');
    } finally {
      release(new Response('cancelled'));
      await pending;
      server.stop(true);
    }
  });
});
