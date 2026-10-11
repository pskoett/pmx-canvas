import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { openCanvasBoard, refreshCanvasWebpageNode } from '../../src/server/canvas-operations.ts';
import { canvasState, type CanvasNodeState } from '../../src/server/canvas-state.ts';
import { intentRegistry } from '../../src/server/intent-registry.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { runCanvasBatchOperation } from '../../src/server/operations/index.ts';
import { executeOperation, isEmitSuppressed } from '../../src/server/operations/registry.ts';
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

test('remote relations invalidate the target clock without editing its content, including clear/copy/delete', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  canvasState.addNode(note('shared', 'Source'));
  canvasState.flushToDisk();
  const source = canvasState.activeBoardId!;
  const target = canvasState.createBoard('Target')!;
  canvasState.switchBoard(target.id);
  canvasState.addNode(note('shared', 'Target'));
  for (let i = 0; i < 12; i++) canvasState.updateNode('shared', { data: { title: `Target ${i}` } });
  canvasState.addNode(note('deleted', 'Deleted'));
  canvasState.removeNode('deleted');
  const original = canvasState.getNode('shared')!;
  const cursor = canvasState.getContentRevision().revision;
  const revisionState = canvasState.readBoard(target.id, false)!.state.revisionState!;
  await executeOperation('context.get', {});
  canvasState.switchBoard(source);
  canvasState.addEdge({ id: 'remote', from: 'shared', to: 'shared', toBoardId: target.id, type: 'relation' });
  const read = () => canvasState.readBoard(target.id, false)!.state.nodes.find((node) => node.id === 'shared')!;
  expect(read().linksRevision ?? 0).toBeGreaterThan(cursor);
  expect(read().contentRevision).toBe(original.contentRevision);
  expect(read().data).toEqual(original.data);
  expect(read().lastEditedBy).toEqual(original.lastEditedBy);
  expect(canvasState.readBoard(target.id, false)!.state.revisionState!.tombstones).toEqual(revisionState.tombstones);
  expect(canvasState.readBoard(target.id, false)!.state.revisionState!.floor).toBe(revisionState.floor);
  canvasState.onMutation((info) => mutationHistory.record(info));
  let revision = read().linksRevision!;
  canvasState.updateEdge('remote', { label: 'supports' });
  expect(read().linksRevision!).toBeGreaterThan(revision);
  for (const change of [
    () => mutationHistory.undo(),
    () => mutationHistory.redo(),
    () => canvasState.removeEdge('remote'),
    () => mutationHistory.undo(),
  ]) {
    revision = read().linksRevision!;
    change();
    expect(read().linksRevision!).toBeGreaterThan(revision);
  }
  canvasState.saveSnapshot('remote');
  canvasState.removeEdge('remote');
  const other = canvasState.createBoard('Other target')!;
  canvasState.switchBoard(other.id);
  canvasState.addNode(note('shared', 'Other target'));
  canvasState.switchBoard(source);
  canvasState.addEdge({ id: 'remote', from: 'shared', to: 'shared', toBoardId: other.id, type: 'relation' });
  const oldTargetRevision = canvasState.readBoard(other.id, false)!.state.nodes[0]!.linksRevision!;
  revision = read().linksRevision!;
  canvasState.restoreSnapshot('remote');
  expect(read().linksRevision!).toBeGreaterThan(revision);
  expect(canvasState.readBoard(other.id, false)!.state.nodes[0]!.linksRevision!).toBeGreaterThan(oldTargetRevision);
  expect(canvasState.getNode('shared')!.data.wikiLinks).toEqual([]);
  await executeOperation('memory-graph.get', {});
  const db = new Database(canvasState.databasePath!);
  expect(
    db.query<{ count: number }, [string]>('SELECT count(*) AS count FROM edges WHERE board_id = ?').get(source)?.count,
  ).toBe(1);
  db.close();
  canvasState.close();
  canvasState.setWorkspaceRoot(root);
  canvasState.loadFromDisk({ clearExisting: true });
  expect(canvasState.getEdges()).toHaveLength(1);
  revision = read().linksRevision!;
  const copy = canvasState.createBoardFromBoard({ sourceBoardId: source, name: 'Copy', nodeIds: ['shared'] })!;
  expect(read().linksRevision!).toBeGreaterThan(revision);
  revision = read().linksRevision!;
  canvasState.deleteBoard(copy.id);
  expect(read().linksRevision!).toBeGreaterThan(revision);
  revision = read().linksRevision!;
  canvasState.clear();
  expect(read().linksRevision!).toBeGreaterThan(revision);
  canvasState.switchBoard(target.id);
  expect(canvasState.getSeenLinks().shared ?? 0).toBeLessThan(canvasState.getNode('shared')!.linksRevision!);
  const delta = (await executeOperation('context.get', { since: cursor })) as { entries: Array<{ nodeId: string }> };
  expect(delta.entries.some((entry) => entry.nodeId === 'shared')).toBe(true);
  expect(canvasState.getNode('shared')!.contentRevision).toBe(original.contentRevision);
  expect(canvasState.getNode('shared')!.data).toEqual(original.data);
  expect(canvasState.getNode('shared')!.lastEditedBy).toEqual(original.lastEditedBy);
});

test('copy/delete invalidates an active target in memory; explicit same-board endpoints share a stamp', () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  canvasState.addNode(note('from', 'From'));
  canvasState.addNode(note('to', 'To'));
  canvasState.flushToDisk();
  const target = canvasState.activeBoardId!;
  canvasState.addEdge({ id: 'local', from: 'from', to: 'to', toBoardId: target, type: 'relation' });
  expect(canvasState.getNode('to')!.linksRevision).toBe(canvasState.getNode('from')!.linksRevision);
  const source = canvasState.createBoard('Source')!;
  canvasState.switchBoard(source.id);
  canvasState.addNode(note('from', 'Source'));
  canvasState.addEdge({ id: 'remote', from: 'from', to: 'to', toBoardId: target, type: 'relation' });
  canvasState.switchBoard(target);
  let revision = canvasState.getNode('to')!.linksRevision!;
  let notifiedRevision = revision;
  const stop = canvasState.onChange((type) => {
    if (type === 'nodes') notifiedRevision = canvasState.getNode('to')!.linksRevision!;
  });
  const copy = canvasState.createBoardFromBoard({ sourceBoardId: source.id, name: 'Copy', nodeIds: ['from'] })!;
  stop();
  expect(canvasState.getNode('to')!.linksRevision!).toBeGreaterThan(revision);
  expect(notifiedRevision).toBe(canvasState.getNode('to')!.linksRevision!);
  revision = canvasState.getNode('to')!.linksRevision!;
  canvasState.deleteBoard(copy.id);
  expect(canvasState.getNode('to')!.linksRevision!).toBeGreaterThan(revision);
  revision = canvasState.getContentRevision().revision;
  canvasState.addEdge({ id: 'codegraph-remote', from: 'from', to: 'to', toBoardId: target, type: 'flow' });
  expect(canvasState.getContentRevision().revision).toBe(revision);
  canvasState.switchBoard(source.id);
  revision = canvasState.readBoard(target, false)!.state.revisionState!.revision;
  canvasState.addEdge({ id: 'missing-card', from: 'from', to: 'missing', toBoardId: target, type: 'relation' });
  canvasState.addEdge({ id: 'missing-board', from: 'from', to: 'to', toBoardId: 'absent', type: 'relation' });
  expect(canvasState.readBoard(target, false)!.state.revisionState!.revision).toBe(revision);
});

test('remote target deletion and restoration invalidate the source without changing its content', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  canvasState.addNode(note('source', 'Source'));
  canvasState.flushToDisk();
  const source = canvasState.activeBoardId!;
  const target = canvasState.createBoard('Target')!;
  canvasState.switchBoard(target.id);
  canvasState.addNode(note('target', 'Target'));
  canvasState.switchBoard(source);
  canvasState.addEdge({ id: 'remote', from: 'source', to: 'target', toBoardId: target.id, type: 'references' });
  await executeOperation('memory-graph.get', {});
  const original = canvasState.getNode('source')!;
  const read = () => canvasState.readBoard(source, false)!.state.nodes.find((node) => node.id === 'source')!;
  canvasState.switchBoard(target.id);
  canvasState.saveSnapshot('Target present');
  canvasState.onMutation((info) => mutationHistory.record(info));
  for (const change of [
    () => canvasState.removeNode('target'),
    () => mutationHistory.undo(),
    () => canvasState.clear(),
    () => canvasState.restoreSnapshot('Target present'),
    () => canvasState.deleteBoard(target.id),
  ]) {
    const revision = read().linksRevision!;
    change();
    expect(read().linksRevision!).toBeGreaterThan(revision);
    expect(read().contentRevision).toBe(original.contentRevision);
    expect(read().data).toEqual(original.data);
    expect(read().lastEditedBy).toEqual(original.lastEditedBy);
    expect(canvasState.getSeenLinks(source).source).toBeLessThan(read().linksRevision!);
  }
});

test('failed source persistence cannot durably mark remote relations seen', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  canvasState.addNode(note('source', 'Source'));
  canvasState.flushToDisk();
  const source = canvasState.activeBoardId!;
  const target = canvasState.createBoard('Target')!;
  canvasState.switchBoard(target.id);
  canvasState.addNode(note('target', 'Target'));
  canvasState.switchBoard(source);
  canvasState.addEdge({ id: 'remote', from: 'source', to: 'target', toBoardId: target.id, type: 'relation' });
  const db = new Database(canvasState.databasePath!);
  db.exec(
    "CREATE TRIGGER reject_relation_save BEFORE INSERT ON edges BEGIN SELECT RAISE(FAIL, 'relation save rejected'); END",
  );
  try {
    await executeOperation('memory-graph.get', {});
    expect(canvasState.getSeenLinks(target.id)).toEqual({});
    expect(canvasState.getSeenLinks(source)).toEqual({});
  } finally {
    db.exec('DROP TRIGGER reject_relation_save');
    db.close();
  }
  await executeOperation('memory-graph.get', {});
  expect(canvasState.getSeenLinks(target.id).target).toBeGreaterThan(0);
});

test('restoring identical plain Markdown preserves initialized empty wiki bindings without a content edit', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  canvasState.addNode(note('plain', 'Plain Markdown'));
  const original = canvasState.getNode('plain')!;
  const snapshot = canvasState.saveSnapshot('plain')!;
  await executeOperation('snapshot.restore-node', { id: snapshot.id, nodeId: 'plain' });
  expect(canvasState.getNode('plain')!.data).toEqual(original.data);
  expect(canvasState.getNode('plain')!.contentRevision).toBe(original.contentRevision);
  expect(canvasState.getNode('plain')!.lastEditedBy).toEqual(original.lastEditedBy);
});

test('legacy wiki bindings initialize once on active load and inactive read without content attribution changes', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const target = canvasState.createBoard('Legacy target')!;
  canvasState.addNode({ ...note('legacy', 'Legacy'), data: { content: '[[Legacy target]]' } });
  canvasState.addNode({ ...note('empty', 'Empty'), data: { content: '[[Legacy target]]' } });
  canvasState.addNode({ ...note('unresolved', 'Unresolved'), data: { content: '[[Legacy target]]' } });
  canvasState.flushToDisk();
  const source = canvasState.activeBoardId!;
  const before = canvasState.getNode('legacy')!;
  const db = new Database(canvasState.databasePath!);
  const strip = () =>
    db.run("UPDATE nodes SET data = json_remove(data, '$.wikiLinks') WHERE board_id = ? AND id = 'legacy'", [source]);
  db.run("UPDATE nodes SET data = json_set(data, '$.wikiLinks', json('[]')) WHERE board_id = ? AND id = 'empty'", [
    source,
  ]);
  db.run(
    "UPDATE nodes SET data = json_set(data, '$.wikiLinks', json('[{\"ref\":\"Legacy target\"}]')) WHERE board_id = ? AND id = 'unresolved'",
    [source],
  );
  strip();
  expect(canvasState.loadFromDisk()).toBe(true);
  const assertBindings = (nodes: CanvasNodeState[]) => {
    const legacy = nodes.find((node) => node.id === 'legacy')!;
    expect(legacy.data.wikiLinks).toEqual([{ ref: 'Legacy target', target: { boardId: target.id } }]);
    expect(legacy.contentRevision).toBe(before.contentRevision);
    expect(legacy.lastEditedBy).toEqual(before.lastEditedBy);
    expect(nodes.find((node) => node.id === 'empty')!.data.wikiLinks).toEqual([]);
    expect(nodes.find((node) => node.id === 'unresolved')!.data.wikiLinks).toEqual([{ ref: 'Legacy target' }]);
  };
  assertBindings(canvasState.getLayout().nodes);
  canvasState.switchBoard(target.id);
  strip();
  assertBindings(canvasState.readBoard(source, false)!.state.nodes);
  const persisted = db
    .query<{ data: string }, [string]>("SELECT data FROM nodes WHERE board_id = ? AND id = 'legacy'")
    .get(source)!;
  expect(JSON.parse(persisted.data).wikiLinks).toEqual([{ ref: 'Legacy target', target: { boardId: target.id } }]);
  canvasState.updateBoard(target.id, { name: 'Renamed legacy target' });
  canvasState.createBoard('Legacy target');
  assertBindings(canvasState.readBoard(source, false)!.state.nodes);
  const graph = (await executeOperation('memory-graph.get', {})) as {
    edges: Array<{ kind: string; target: { boardId: string } }>;
  };
  expect(graph.edges.some((edge) => edge.kind === 'wiki' && edge.target.boardId === target.id)).toBe(true);
  db.close();
});

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

  test('invalid README does not partially rename or move a board', async () => {
    canvasState.addNode(note('readme', 'Introduction'));
    canvasState.flushToDisk();
    const id = canvasState.activeBoardId!;
    const before = canvasState.getActiveBoard()!;
    await expect(
      executeOperation('board.update', { id, name: 'Unwanted rename', category: 'Other', readmeNodeId: 'missing' }),
    ).rejects.toThrow('README must identify');
    expect(canvasState.getActiveBoard()?.name).toBe(before.name);
    expect(canvasState.getActiveBoard()?.category).toBe(before.category);
    await openCanvasBoard(null);
    await executeOperation('board.create-from', { sourceBoardId: id, name: 'Copy', nodeIds: ['readme'] });
    expect(canvasState.activeBoardId).toBeNull();
    expect(canvasState.listBoards()).toHaveLength(2);
    await expect(executeOperation('context.get', {})).rejects.toThrow('Open a board');
  });

  test('context only advances an explicit consumer after complete delivery', async () => {
    canvasState.addNode(note('context-card', 'Decision'));
    canvasState.flushToDisk();
    const id = canvasState.activeBoardId!;
    const revision = canvasState.getContentRevision().revision;
    await executeOperation('context.get', {});
    expect(canvasState.getContextBriefCursor(id, 'default')).toBeNull();
    await executeOperation('context.get', { consumer: 'reader', budget: 1 });
    expect(canvasState.getContextBriefCursor(id, 'reader')).toBeNull();
    await executeOperation('context.get', { consumer: 'reader', since: 0 });
    expect(canvasState.getContextBriefCursor(id, 'reader')).toBeNull();
    await executeOperation('context.get', { consumer: 'reader' });
    expect(canvasState.getContextBriefCursor(id, 'reader')).toBe(revision);
    canvasState.updateNode('context-card', { data: { title: 'Decision', content: 'New decision' } });
    await executeOperation('context.get', { consumer: 'reader' });
    const latest = canvasState.getContentRevision().revision;
    expect(latest).toBeGreaterThan(revision);
    canvasState.close();
    resetCanvasForTests(root);
    canvasState.loadFromDisk({ clearExisting: true });
    expect(canvasState.getContextBriefCursor(id, 'reader')).toBe(latest);
    expect(canvasState.getNode('context-card')?.data.content).toBe('New decision');
  });

  test('README designation and create-from preserve the active board while remapping structure', () => {
    canvasState.addNode(note('readme', 'Introduction'));
    canvasState.addNode({
      ...note('group', 'Section'),
      type: 'group',
      data: { title: 'Section', children: ['readme'] },
    });
    canvasState.groupNodes('group', ['readme']);
    canvasState.flushToDisk();
    const sourceId = canvasState.activeBoardId!;
    expect(canvasState.setBoardReadme(sourceId, 'readme')).toBe(true);
    expect(canvasState.setBoardReadme(sourceId, 'group')).toBe(false);

    const created = canvasState.createBoardFromBoard({
      sourceBoardId: sourceId,
      name: 'Follow-up',
      nodeIds: ['readme', 'group'],
      includeReadme: true,
      includeStructure: true,
    })!;
    expect(canvasState.activeBoardId).toBe(sourceId);
    expect(
      canvasState
        .getLayout()
        .nodes.map((node) => node.id)
        .sort(),
    ).toEqual(['group', 'readme']);
    const copied = canvasState.readBoard(created.id)!;
    expect(copied.board.readmeNodeId).not.toBe('readme');
    expect(copied.layout.nodes).toHaveLength(3);
    const copiedGroup = copied.layout.nodes.find((node) => node.type === 'group')!;
    const copiedReadme = copied.layout.nodes.find((node) => node.id === copied.board.readmeNodeId)!;
    expect(copiedGroup.data.children).toContain(copiedReadme.id);
    expect(copiedReadme.data.parentGroup).toBe(copiedGroup.id);
    expect(copied.layout.nodes.find((node) => node.type === 'board')?.data.boardId).toBe(sourceId);
    expect(copied.state.contextPins).toEqual([]);
    expect(copied.state.ax?.workItems).toEqual([]);
  });

  test('copied graph and json-render viewers reference their new nodes', () => {
    for (const type of ['graph', 'json-render'] as const) {
      canvasState.addNode({
        ...note(type, type),
        type,
        data: { spec: { root: 'card', elements: {} }, url: `/api/canvas/json-render/view?nodeId=${type}` },
      });
    }
    canvasState.flushToDisk();
    const sourceId = canvasState.activeBoardId!;
    const copy = canvasState.createBoardFromBoard({
      sourceBoardId: sourceId,
      name: 'Viewers',
      nodeIds: ['graph', 'json-render'],
    })!;
    const nodes = canvasState.readBoard(copy.id)!.layout.nodes;
    for (const type of ['graph', 'json-render']) {
      const node = nodes.find((node) => node.type === type)!;
      expect(node.id).not.toBe(type);
      expect(node.data.url).toBe(`/api/canvas/json-render/view?nodeId=${node.id}`);
      expect(canvasState.getNode(type)!.data.url).toBe(`/api/canvas/json-render/view?nodeId=${type}`);
    }
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

  test('most-recent board ordering survives equal clock timestamps', async () => {
    let now = Date.parse('2026-09-29T10:00:00.000Z');
    const clock = spyOn(Date, 'now').mockImplementation(() => now);
    try {
      canvasState.addNode(note('a-node', 'On A'));
      canvasState.flushToDisk();
      const boardA = canvasState.activeBoardId as string;

      now += 1_000;
      const boardB = canvasState.createBoard('Board B')!;
      now += 1_000;
      expect(await openCanvasBoard(boardB.id)).toEqual({ ok: true });
      expect(await openCanvasBoard(boardA)).toEqual({ ok: true });

      expect(canvasState.listBoards().map((board) => board.id)).toEqual([boardA, boardB.id]);
    } finally {
      clock.mockRestore();
    }
  });

  test("snapshot operations cannot access another board's snapshots or snapshots from Home", async () => {
    canvasState.addNode(note('a-node', 'On A'));
    canvasState.flushToDisk();
    const boardA = canvasState.activeBoardId as string;
    const snapshot = canvasState.saveSnapshot('A snapshot')!;

    const boardB = canvasState.createBoard('Board B')!;
    expect(await openCanvasBoard(boardB.id)).toEqual({ ok: true });
    canvasState.addNode(note('b-node', 'On B'));

    expect(canvasState.getSnapshotData(snapshot.id)).toBeNull();
    expect(canvasState.restoreSnapshot(snapshot.id)).toBe(false);
    expect(canvasState.renameSnapshot(snapshot.id, 'stolen')).toBe(false);
    expect(canvasState.deleteSnapshot(snapshot.id)).toBe(false);
    expect(canvasState.getLayout().nodes.map((node) => node.id)).toEqual(['b-node']);

    // A same-board name matching a foreign ID is not ownership of that ID.
    const sameName = canvasState.saveSnapshot(snapshot.id)!;
    expect(canvasState.deleteSnapshot(snapshot.id)).toBe(false);
    expect(canvasState.deleteSnapshot(sameName.id)).toBe(true);

    expect(await openCanvasBoard(null)).toEqual({ ok: true });
    expect(canvasState.getSnapshotData(snapshot.id)).toBeNull();
    expect(canvasState.restoreSnapshot(snapshot.id)).toBe(false);
    expect(canvasState.renameSnapshot(snapshot.id, 'stolen')).toBe(false);
    expect(canvasState.deleteSnapshot(snapshot.id)).toBe(false);
    expect(canvasState.getLayout().nodes).toEqual([]);

    expect(await openCanvasBoard(boardA)).toEqual({ ok: true });
    expect(canvasState.getSnapshotData(snapshot.id)?.name).toBe('A snapshot');
    expect(canvasState.restoreSnapshot(snapshot.id)).toBe(true);
    expect(canvasState.getLayout().nodes.map((node) => node.id)).toEqual(['a-node']);
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
