import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { openCanvasBoard } from '../../src/server/canvas-operations.ts';
import { canvasState, type CanvasNodeState } from '../../src/server/canvas-state.ts';
import { intentRegistry } from '../../src/server/intent-registry.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
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
  db.run(
    "INSERT INTO snapshots (id, name, created_at, node_count, edge_count) VALUES ('snap-old', 'April', '2026-04-15T00:00:00.000Z', 2, 1)",
  );
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
  test('the existing board becomes a named, open board with its snapshots, and a copy is kept', () => {
    const dbPath = writeSchema1Workspace(root);
    resetCanvasForTests(root);

    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    const [board] = canvasState.listBoards();
    expect(board).toMatchObject({ name: basename(root), nodeCount: 2 });
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
    expect(canvasState.listSnapshots({ all: true }).map((snapshot) => snapshot.id)).toEqual(['snap-old']);
    expect(existsSync(`${dbPath}.pre-boards`)).toBe(true);

    // Opening again is a no-op: no second board, same data.
    resetCanvasForTests(root);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    expect(canvasState.listBoards().map((entry) => entry.id)).toEqual([board.id]);
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
});
