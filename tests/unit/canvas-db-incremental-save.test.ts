import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyAxState } from '../../src/server/ax-state.js';
import { loadStateFromDB, openCanvasDb, saveStateToDB } from '../../src/server/canvas-db.js';
import { removeTempDirWithRetry } from './helpers.js';
import type { PersistedCanvasState } from '../../src/server/canvas-state.js';

// Issue #22: every debounced save used to DELETE and re-INSERT every row, so a
// single node move rewrote the whole board — multi-MB html payloads included.
// The write cost scaled with board size instead of change size.

let dir: string;
let db: Database;

function makeState(nodeCount: number, htmlBytes = 64): PersistedCanvasState {
  return {
    version: 1,
    theme: 'dark',
    viewport: { x: 0, y: 0, scale: 1 },
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      id: `n${i}`,
      type: 'html' as const,
      position: { x: i * 10, y: 0 },
      size: { width: 400, height: 300 },
      zIndex: 0,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: { html: 'x'.repeat(htmlBytes) },
    })),
    edges: [{ id: 'e0', from: 'n0', to: 'n1', type: 'flow' as const, animated: false }],
    annotations: [],
    contextPins: ['n0'],
    ax: createEmptyAxState(),
  } as unknown as PersistedCanvasState;
}

/** Rows actually written by one save — 0 means SQLite wrote no page. */
function rowsWrittenBy(save: () => void): number {
  const before = db.query<{ c: number }, []>('SELECT total_changes() AS c').get()?.c ?? 0;
  save();
  const after = db.query<{ c: number }, []>('SELECT total_changes() AS c').get()?.c ?? 0;
  return after - before;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pmx-db-'));
  db = openCanvasDb(join(dir, 'canvas.db'));
});

afterEach(() => {
  db.close();
  removeTempDirWithRetry(dir);
});

describe('saveStateToDB writes only what changed', () => {
  test('re-saving identical state writes nothing', () => {
    const state = makeState(50, 20_000);
    saveStateToDB(db, state);
    expect(rowsWrittenBy(() => saveStateToDB(db, state))).toBe(0);
  });

  test('moving one node on a 50-node board writes exactly one row', () => {
    const state = makeState(50, 20_000);
    saveStateToDB(db, state);
    state.nodes[7].position = { x: 999, y: 42 };
    expect(rowsWrittenBy(() => saveStateToDB(db, state))).toBe(1);
  });

  test('editing one node body writes exactly one row', () => {
    const state = makeState(50, 20_000);
    saveStateToDB(db, state);
    state.nodes[3].data = { html: 'y'.repeat(20_000) };
    expect(rowsWrittenBy(() => saveStateToDB(db, state))).toBe(1);
  });

  test('a changed viewport does not drag the nodes along', () => {
    const state = makeState(50, 20_000);
    saveStateToDB(db, state);
    state.viewport = { x: -120, y: 64, scale: 0.8 };
    // Three meta rows, no node rows.
    expect(rowsWrittenBy(() => saveStateToDB(db, state))).toBe(3);
  });

  test('removed nodes, edges and pins are deleted', () => {
    const state = makeState(6);
    saveStateToDB(db, state);
    state.nodes = state.nodes.slice(0, 4);
    state.edges = [];
    state.contextPins = [];
    saveStateToDB(db, state);
    const loaded = loadStateFromDB(db);
    expect(loaded?.nodes.map((n) => n.id)).toEqual(['n0', 'n1', 'n2', 'n3']);
    expect(loaded?.edges).toEqual([]);
    expect(loaded?.contextPins).toEqual([]);
  });

  test('round-trips every field after an incremental save — no silently skipped write', () => {
    const state = makeState(4);
    saveStateToDB(db, state);
    state.nodes[1].position = { x: 77, y: 88 };
    state.nodes[1].size = { width: 512, height: 256 };
    state.nodes[1].collapsed = true;
    state.nodes[1].pinned = true;
    state.nodes[1].zIndex = 9;
    state.nodes[1].data = { html: 'changed' };
    state.nodes.push({
      id: 'n-new',
      type: 'markdown',
      position: { x: 5, y: 5 },
      size: { width: 360, height: 180 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: { content: 'hello' },
    } as unknown as (typeof state.nodes)[number]);
    state.edges = [
      {
        id: 'e0',
        from: 'n0',
        to: 'n2',
        type: 'depends-on',
        label: 'lbl',
        animated: true,
      } as unknown as (typeof state.edges)[number],
    ];
    saveStateToDB(db, state);

    const loaded = loadStateFromDB(db);
    const moved = loaded?.nodes.find((n) => n.id === 'n1');
    expect(moved?.position).toEqual({ x: 77, y: 88 });
    expect(moved?.size).toEqual({ width: 512, height: 256 });
    expect(moved?.collapsed).toBe(true);
    expect(moved?.pinned).toBe(true);
    expect(moved?.zIndex).toBe(9);
    expect(moved?.data).toEqual({ html: 'changed' });
    expect(loaded?.nodes.find((n) => n.id === 'n-new')?.data).toEqual({ content: 'hello' });
    expect(loaded?.edges[0]).toMatchObject({ from: 'n0', to: 'n2', type: 'depends-on', label: 'lbl', animated: true });
  });

  test('clearing a nullable field back to null is persisted', () => {
    const state = makeState(2);
    state.edges = [
      {
        id: 'e0',
        from: 'n0',
        to: 'n1',
        type: 'flow',
        label: 'first',
        animated: false,
      } as unknown as (typeof state.edges)[number],
    ];
    saveStateToDB(db, state);
    state.edges = [
      { id: 'e0', from: 'n0', to: 'n1', type: 'flow', animated: false } as unknown as (typeof state.edges)[number],
    ];
    expect(rowsWrittenBy(() => saveStateToDB(db, state))).toBe(1);
    expect(loadStateFromDB(db)?.edges[0].label).toBeUndefined();
  });
});
