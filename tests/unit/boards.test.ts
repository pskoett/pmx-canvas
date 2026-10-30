import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCanvasBoard, refreshCanvasWebpageNode } from '../../src/server/canvas-operations.ts';
import { canvasState, type CanvasNodeState } from '../../src/server/canvas-state.ts';
import { humanPresence } from '../../src/server/human-presence.ts';
import { intentRegistry } from '../../src/server/intent-registry.ts';
import type { KnowledgeResults, LifecycleResults, ReviewRecord } from '../../src/server/knowledge-lifecycle.ts';
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

test('Move to new board preserves identities, retargets third-board references and replays after restart', () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const source = canvasState.createBoard('Source', 'Planning')!;
  const third = canvasState.createBoard('Incoming')!;
  canvasState.switchBoard(source.id);
  canvasState.addNode(note('card', 'Original'));
  canvasState.addNode(note('stay', 'Stays'));
  canvasState.setContextPins(['card']);
  canvasState.setBoardReadme(source.id, 'card');
  canvasState.addEdge({ id: 'out', from: 'card', to: 'stay', type: 'references', reason: 'Source reason' });
  const validation = canvasState.knowledge.record(source.id, 'card', {
    outcome: 'retain',
    evidence: 'Checked original',
    applied: true,
    expectedContentRevision: canvasState.getNode('card')!.contentRevision,
  });
  const read = canvasState.recordContextRead({
    channel: 'operation',
    resource: 'node.get',
    source: 'api',
    consumer: 'reader',
    agentId: null,
    pinnedNodeIds: ['card'],
    deliveredNodeIds: ['card'],
    readNodeIds: ['card'],
    bytes: 20,
  })!;
  canvasState.switchBoard(third.id);
  canvasState.addNode(note('card', 'Unrelated same ID'));
  canvasState.addEdge({ id: 'in', from: 'card', to: 'card', toBoardId: source.id, type: 'references' });
  canvasState.addNode({ ...note('wiki', 'Wiki'), data: { content: '[[Original]]' } });
  canvasState.switchBoard(source.id);
  const before = canvasState.getNode('card')!;
  const snapshot = canvasState.saveSnapshot('Before move')!;
  const input = {
    sourceBoardId: source.id,
    nodeIds: ['card'],
    name: 'Moved',
    requestId: 'move-original',
    expectedRevision: canvasState.getContentRevision().revision,
  };
  const preview = canvasState.moveSelectionToNewBoard({ ...input, preview: true });
  expect('preview' in preview && preview.preview.blockers).toEqual([]);
  expect(canvasState.listBoards()).toHaveLength(2);
  expect(canvasState.getNode('card')).toEqual(before);
  const moved = canvasState.moveSelectionToNewBoard(input);
  if (!('result' in moved)) throw new Error('Expected committed move');
  const destination = moved.result.destinationBoardId;
  expect(canvasState.activeBoardId).toBe(source.id);
  expect(canvasState.getNode('card')).toBeUndefined();
  expect(canvasState.getNode(moved.result.portalId)?.data.boardId).toBe(destination);
  expect(canvasState.getNode('stay')!.data.title).toBe('Stays');
  const target = canvasState.readBoard(destination)!;
  expect(target.board.folder).toBe('Planning');
  expect(target.board.readmeNodeId).toBe('card');
  expect(canvasState.readBoard(source.id)!.board.readmeNodeId).toBeNull();
  expect(target.state.nodes[0]).toEqual(before);
  expect(target.state.edges[0]).toMatchObject({ id: 'out', to: 'stay', toBoardId: source.id, reason: 'Source reason' });
  expect(canvasState.readBoard(third.id)!.state.edges[0].toBoardId).toBe(destination);
  expect(canvasState.readBoard(third.id)!.state.nodes.find((node) => node.id === 'card')!.data.title).toBe(
    'Unrelated same ID',
  );
  expect(canvasState.knowledge.reviews(destination, 'card').lastValidation).toEqual(validation);
  expect(canvasState.getNodeReadStatus(destination)).toContainEqual({
    nodeId: 'card',
    lastReadAt: read.at,
    lastReadBy: 'reader',
    readRevision: before.contentRevision!,
    readCount: 1,
  });
  expect(canvasState.getSnapshotData(snapshot.id)!.nodes.some((node) => node.id === 'card')).toBe(true);
  expect(() => canvasState.restoreSnapshot(snapshot.id)).toThrow(/predates a move/);
  canvasState.flushToDisk();
  canvasState.close();
  canvasState.setWorkspaceRoot(root);
  canvasState.loadFromDisk();
  expect(canvasState.moveSelectionToNewBoard(input)).toEqual({ result: moved.result, replayed: true });
  expect(canvasState.listBoards()).toHaveLength(3);
  expect(() => canvasState.moveSelectionToNewBoard({ ...input, name: 'Other' })).toThrow(/different move/);
  expect(() => canvasState.restoreSnapshot(snapshot.id)).toThrow(/predates a move/);
  // A later card with the source ID must not borrow or extend the moved card's evidence.
  canvasState.addNode(note('card', 'Replacement'));
  canvasState.knowledge.record(source.id, 'card', { outcome: 'retire', applied: true, evidence: 'Replacement only' });
  expect(canvasState.knowledge.reviews(destination, 'card').records).toEqual([validation]);
  expect(canvasState.knowledge.reviews(source.id, 'card').lastValidation).toBeNull();
});

test('Move to new board rolls back a failed commit and includes pending edits on retry', () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  canvasState.switchBoard(canvasState.createBoard('Source')!.id);
  canvasState.addNode(note('card', 'Pending original'));
  const sourceBoardId = canvasState.activeBoardId!;
  const input = {
    sourceBoardId,
    nodeIds: ['card'],
    name: 'Moved',
    requestId: 'retry',
    expectedRevision: canvasState.getContentRevision().revision,
  };
  const db = new Database(canvasState.databasePath!);
  try {
    db.exec(
      "CREATE TRIGGER interrupt_move BEFORE INSERT ON board_moves BEGIN SELECT RAISE(ABORT, 'interrupted move'); END",
    );
    expect(() => canvasState.moveSelectionToNewBoard(input)).toThrow('interrupted move');
    expect(canvasState.listBoards()).toHaveLength(1);
    expect(canvasState.getNode('card')!.data.title).toBe('Pending original');
    db.exec('DROP TRIGGER interrupt_move');
    const moved = canvasState.moveSelectionToNewBoard(input);
    if (!('result' in moved)) throw new Error('Expected committed move');
    expect(canvasState.readBoard(moved.result.destinationBoardId)!.state.nodes[0].data.title).toBe('Pending original');
    expect(canvasState.moveSelectionToNewBoard(input)).toEqual({ result: moved.result, replayed: true });
    expect(canvasState.listBoards()).toHaveLength(2);
  } finally {
    db.close();
  }
});

test('Move preview is read-only and commit rechecks revisions, edit locks and affected-board fences', () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const source = canvasState.createBoard('Source')!;
  const incoming = canvasState.createBoard('Incoming')!;
  canvasState.switchBoard(source.id);
  canvasState.addNode(note('card', 'Original'));
  canvasState.switchBoard(incoming.id);
  canvasState.addNode(note('ref', 'Reference'));
  canvasState.addEdge({ id: 'incoming', from: 'ref', to: 'card', toBoardId: source.id, type: 'references' });
  canvasState.setPolicy({ scope: { nodeIds: ['ref'] } });
  canvasState.switchBoard(source.id);
  const input = {
    sourceBoardId: source.id,
    nodeIds: ['card'],
    name: 'Moved',
    requestId: 'guarded',
    expectedRevision: canvasState.getContentRevision().revision,
  };
  canvasState.flushToDisk();
  const before = canvasState.readBoard(source.id)!.state;
  const preview = canvasState.moveSelectionToNewBoard({ ...input, preview: true });
  expect('preview' in preview && preview.preview.blockers.join(' ')).toContain('scope fence');
  expect(canvasState.readBoard(source.id)!.state).toEqual(before);
  expect(canvasState.listBoards()).toHaveLength(2);
  expect(() => canvasState.moveSelectionToNewBoard(input)).toThrow('Move refused');
  canvasState.switchBoard(incoming.id);
  canvasState.setPolicy({ scope: null });
  canvasState.switchBoard(source.id);
  humanPresence.set({ clientId: 'move-editor', name: 'Editor', grabbingNodeId: 'card' });
  try {
    const held = canvasState.moveSelectionToNewBoard({ ...input, preview: true });
    expect('preview' in held && held.preview.blockers.join(' ')).toContain('being edited by Editor');
    expect(() => canvasState.moveSelectionToNewBoard(input)).toThrow('Move refused');
  } finally {
    humanPresence.set({ clientId: 'move-editor', left: true });
  }
  const ready = canvasState.moveSelectionToNewBoard({ ...input, preview: true });
  expect('preview' in ready && ready.preview.blockers).toEqual([]);
  canvasState.updateNode('card', { data: { title: 'Newer human edit' } });
  expect(() => canvasState.moveSelectionToNewBoard(input)).toThrow('source board changed');
  expect(canvasState.listBoards()).toHaveLength(2);
  expect(canvasState.getNode('card')!.data.title).toBe('Newer human edit');
});

test('Move refuses partial and pending imports, then preserves a completed attachment bundle and bytes', () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const source = canvasState.createBoard('Import source')!;
  canvasState.switchBoard(source.id);
  const bytes = new TextEncoder().encode('Original imported document');
  const attachment = canvasState.storeAttachment({
    boardId: source.id,
    name: 'source.txt',
    mime: 'text/plain',
    bytes,
  })!;
  const job = canvasState.createDocumentImport(attachment.id, { x: 20, y: 50 })!;
  canvasState.addNode({ ...note('attachment', 'Original'), type: 'file', data: { attachmentId: attachment.id } });
  canvasState.addNode({
    ...note('section', 'Section'),
    data: { content: 'Extracted content', source: { attachmentId: attachment.id } },
  });
  canvasState.updateDocumentImport(job.id, 'drafted', {
    sections: [{ title: 'Section', markdown: 'Extracted content' }],
  });
  const input = {
    sourceBoardId: source.id,
    nodeIds: ['attachment', 'section'],
    name: 'Moved import',
    requestId: 'import-move',
    expectedRevision: canvasState.getContentRevision().revision,
  };
  expect(() => canvasState.moveSelectionToNewBoard(input)).toThrow('Move refused');
  canvasState.commitDocumentImport(job.id, ['section']);
  const partial = canvasState.moveSelectionToNewBoard({ ...input, nodeIds: ['section'], preview: true });
  expect('preview' in partial && partial.preview.blockers.join(' ')).toContain('include');
  expect(() => canvasState.moveSelectionToNewBoard({ ...input, nodeIds: ['section'] })).toThrow('Move refused');
  expect(canvasState.getDocumentImport(job.id)!.boardId).toBe(source.id);
  const moved = canvasState.moveSelectionToNewBoard(input);
  if (!('result' in moved)) throw new Error('Expected move');
  expect(canvasState.getAttachment(attachment.id)!.boardId).toBe(moved.result.destinationBoardId);
  expect(canvasState.getDocumentImport(job.id)).toMatchObject({
    boardId: moved.result.destinationBoardId,
    status: 'committed',
    committedNodeIds: ['section'],
  });
  expect(canvasState.readAttachmentBytes(attachment.id)).toEqual(bytes);
  expect(canvasState.listDocumentImports(source.id)).toEqual([]);
});

test.each([
  '/api/canvas/json-render/view?v=7&nodeId=graph-target',
  '/api/canvas/surface/%67raph-target',
  '/api/canvas/file-bytes?v=7&nodeId=graph-target',
])('Move keeps both ends of local viewer URL %s together', (url) => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const source = canvasState.createBoard('Viewer source')!;
  canvasState.switchBoard(source.id);
  canvasState.addNode({
    ...note('graph-target', 'Graph'),
    type: 'graph',
    data: { spec: { root: 'text', elements: { text: { type: 'Text', props: { text: 'Report' } } } } },
  });
  canvasState.addNode({ ...note('viewer', 'Viewer'), type: 'mcp-app', data: { url } });
  canvasState.addNode({
    ...note('unrelated', 'Unrelated'),
    data: { content: 'A malformed example: /api/canvas/surface/bad%ZZ' },
  });
  const input = {
    sourceBoardId: source.id,
    name: 'Moved viewers',
    requestId: 'viewer-move',
    expectedRevision: canvasState.getContentRevision().revision,
  };
  for (const nodeIds of [['viewer'], ['graph-target']]) {
    const preview = canvasState.moveSelectionToNewBoard({ ...input, nodeIds, preview: true });
    expect('preview' in preview && preview.preview.blockers.join(' ')).toContain('include both ends');
    expect(() => canvasState.moveSelectionToNewBoard({ ...input, nodeIds })).toThrow('Move refused');
    expect(canvasState.listBoards()).toHaveLength(1);
  }
  const moved = canvasState.moveSelectionToNewBoard({ ...input, nodeIds: ['viewer', 'graph-target'] });
  if (!('result' in moved)) throw new Error('Expected move');
  const target = canvasState.readBoard(moved.result.destinationBoardId)!;
  expect(target.layout.nodes.map((node) => node.id).sort()).toEqual(['graph-target', 'viewer']);
  expect(target.layout.nodes.find((node) => node.id === 'viewer')!.data.url).toBe(url);
});

test('Move preserves review qualifications through repeated moves of sources and edge owners', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const source = canvasState.createBoard('Evidence')!;
  canvasState.switchBoard(source.id);
  for (const id of ['origin', 'derived', 'provenance']) canvasState.addNode(note(id, id));
  canvasState.addEdge({ id: 'derivation', from: 'derived', to: 'origin', type: 'relation', kind: 'depends-on' });
  canvasState.updateNode('provenance', {
    data: {
      ...canvasState.getNode('provenance')!.data,
      provenance: {
        sourceKind: 'recipe',
        sourceUri: 'recipe:evidence-summary',
        refreshStrategy: 'agent-request',
        sources: [
          {
            boardId: source.id,
            cardId: 'origin',
            contentRevision: canvasState.getNode('origin')!.contentRevision,
            observedAt: '2026-10-01T00:00:00.000Z',
          },
        ],
      },
    },
  });
  const read = (board: string, id: string) =>
    executeOperation('node.lifecycle-get', { board, id }) as Promise<LifecycleResults['get']>;
  const reviews = new Map<string, ReviewRecord | null>();
  for (const id of ['derived', 'provenance']) {
    const checked = await read(source.id, id);
    await executeOperation('node.review', {
      id,
      outcome: 'retain',
      evidence: 'Compared original sources.',
      applied: true,
      expectedContentRevision: checked.contentRevision,
      expectedSources: checked.qualification.observations,
    });
    reviews.set(id, canvasState.knowledge.reviews(source.id, id).lastValidation);
    expect((await read(source.id, id)).qualification.due).toBe(false);
  }
  const move = (nodeIds: string[], requestId: string) => {
    const result = canvasState.moveSelectionToNewBoard({
      sourceBoardId: canvasState.activeBoardId!,
      nodeIds,
      requestId,
      name: requestId,
      expectedRevision: canvasState.getContentRevision().revision,
    });
    if (!('result' in result)) throw new Error('Expected move');
    return result.result.destinationBoardId;
  };
  const evidence = move(['origin'], 'first-source-move');
  for (const id of ['derived', 'provenance']) expect((await read(source.id, id)).qualification.due).toBe(false);
  canvasState.switchBoard(evidence);
  const nextEvidence = move(['origin'], 'second-source-move');
  for (const id of ['derived', 'provenance']) expect((await read(source.id, id)).qualification.due).toBe(false);
  canvasState.switchBoard(source.id);
  const conclusions = move(['derived', 'provenance'], 'move-conclusions');
  for (const id of ['derived', 'provenance']) {
    expect((await read(conclusions, id)).qualification.due).toBe(false);
    expect(canvasState.knowledge.reviews(conclusions, id).lastValidation).toEqual(reviews.get(id)!);
  }
  canvasState.switchBoard(nextEvidence);
  canvasState.updateNode('origin', { data: { content: 'Changed evidence' } });
  for (const id of ['derived', 'provenance']) {
    const qualification = (await read(conclusions, id)).qualification;
    expect({ id, due: qualification.due }).toEqual({ id, due: true });
  }
});

test('Reusing an intermediate move location never inherits or transports the departed identity history', () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const first = canvasState.createBoard('A')!;
  canvasState.switchBoard(first.id);
  canvasState.addNode(note('x', 'Original'));
  const review = canvasState.knowledge.record(first.id, 'x', {
    outcome: 'retain',
    evidence: 'Original evidence',
    applied: true,
    expectedContentRevision: canvasState.getNode('x')!.contentRevision,
  });
  canvasState.recordContextRead({
    channel: 'operation',
    resource: 'node.get',
    source: 'api',
    consumer: 'reader',
    agentId: null,
    pinnedNodeIds: [],
    deliveredNodeIds: ['x'],
    readNodeIds: ['x'],
    bytes: 10,
  });
  const move = (name: string) => {
    const moved = canvasState.moveSelectionToNewBoard({
      sourceBoardId: canvasState.activeBoardId!,
      nodeIds: ['x'],
      name,
      requestId: name,
      expectedRevision: canvasState.getContentRevision().revision,
    });
    if (!('result' in moved)) throw new Error('Expected move');
    return moved.result.destinationBoardId;
  };
  const intermediate = move('B');
  canvasState.switchBoard(intermediate);
  const original = move('C');
  canvasState.addNode(note('x', 'Replacement'));
  expect(canvasState.knowledge.reviews(intermediate, 'x').records).toEqual([]);
  expect(canvasState.getNodeReadStatus(intermediate).filter((entry) => entry.nodeId === 'x')).toEqual([]);
  const replacementReview = canvasState.knowledge.record(intermediate, 'x', {
    outcome: 'retire',
    evidence: 'Replacement only',
    applied: true,
  });
  const replacement = move('D');
  expect(canvasState.knowledge.reviews(replacement, 'x').records).toEqual([replacementReview]);
  expect(canvasState.getNodeReadStatus(replacement)).toEqual([]);
  expect(canvasState.knowledge.reviews(original, 'x').records).toEqual([review]);
  expect(canvasState.getNodeReadStatus(original).map((entry) => entry.nodeId)).toEqual(['x']);
});

test('Move expands nested groups, preserves live task ownership and leaves unrelated runtime state alone', () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const source = canvasState.createBoard('Source')!;
  canvasState.switchBoard(source.id);
  const task = canvasState.addWorkItem({ title: 'Original task' });
  canvasState.addNode({ ...note('live', 'Presentation'), type: 'status', data: { workItemId: task.id } });
  canvasState.addNode(note('other', 'Other card'));
  const nested: CanvasNodeState = { ...note('nested', 'Nested'), type: 'group' };
  const group: CanvasNodeState = { ...note('outer', 'Outer'), type: 'group' };
  canvasState.addNode(nested);
  canvasState.addNode(group);
  canvasState.groupNodes(nested.id, ['live']);
  canvasState.groupNodes(group.id, [nested.id]);
  const before = canvasState.getLayout();
  const generation = canvasState.boardGeneration;
  const result = canvasState.moveSelectionToNewBoard({
    sourceBoardId: source.id,
    nodeIds: [group!.id, 'live'],
    requestId: 'group-move',
    name: 'Group',
    expectedRevision: canvasState.getContentRevision().revision,
  });
  if (!('result' in result)) throw new Error('Expected move');
  expect(result.result.nodeIds.sort()).toEqual([group!.id, nested!.id, 'live'].sort());
  expect(canvasState.boardGeneration).toBe(generation);
  expect(canvasState.getLayout().viewport).toEqual(before.viewport);
  expect(canvasState.getWorkItems()).toEqual([task]);
  const destination = result.result.destinationBoardId;
  const live = () => canvasState.readBoard(destination)!.layout.nodes.find((n) => n.id === 'live')!;
  expect(live().data).toMatchObject({ workItemId: task.id, workItemBoardId: source.id, workState: 'todo' });
  canvasState.updateWorkItem(task.id, { status: 'blocked', title: 'Original task updated' });
  expect(live().data).toMatchObject({ workState: 'blocked', title: 'Original task updated' });
  canvasState.switchBoard(destination);
  expect(canvasState.getWorkItems()).toEqual([]);
  expect(canvasState.getNode('live')!.data).toMatchObject({ workItemBoardId: source.id, workState: 'blocked' });
  expect(canvasState.getNode('live')!.data.parentGroup).toBe(nested!.id);
  expect(canvasState.getNode(nested!.id)!.data.parentGroup).toBe(group!.id);
});

test('knowledge inheritance resets at explicit child categories, clears overrides and survives reload without opening Home', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const lifecycle = {
    decayType: 'reality',
    rate: 'fast',
    triggers: ['source changed'],
    revalidationMethod: 'check source',
  };
  await executeOperation('knowledge.category-set', { category: { ...lifecycle, id: 'a', name: 'A', glyph: 'A' } });
  await executeOperation('knowledge.category-set', {
    category: { ...lifecycle, rate: 'durable', id: 'b', name: 'B', glyph: 'B' },
  });
  await executeOperation('knowledge.folder-set', {
    path: ' A ',
    categoryId: 'a',
    lifecycleOverride: { ...lifecycle, rate: 'slow' },
  });
  await executeOperation('knowledge.folder-set', { path: 'A/B', categoryId: 'b', lifecycleOverride: null });
  const board = canvasState.createBoard('Knowledge', 'A/B/C')!;
  canvasState.switchBoard(board.id);
  canvasState.addNode(note('shared', 'Knowledge'));
  const read = () => executeOperation('node.lifecycle-get', { id: 'shared', board: board.id });
  expect(await read()).toMatchObject({
    category: { id: 'b' },
    lifecycle: { rate: 'durable' },
    categorySourceFolder: 'A/B',
  });
  const before = structuredClone(canvasState.getNode('shared'));
  await executeOperation('node.lifecycle-set', {
    id: 'shared',
    lifecycleOverride: lifecycle,
    expectedBoardId: board.id,
  });
  expect(canvasState.getNode('shared')).toMatchObject({
    contentRevision: before!.contentRevision,
    lastEditedBy: before!.lastEditedBy,
  });
  expect(await read()).toMatchObject({ category: { id: 'b' }, lifecycle: { rate: 'fast' }, lifecycleSource: 'card' });
  await executeOperation('node.lifecycle-set', { id: 'shared', lifecycleOverride: null });
  await executeOperation('knowledge.folder-set', { path: 'A/B', categoryId: null, lifecycleOverride: null });
  expect(await read()).toMatchObject({
    category: { id: 'a' },
    lifecycle: { rate: 'slow' },
    lifecycleSourceFolder: 'A',
  });
  canvasState.switchBoard(null);
  await executeOperation('knowledge.category-set', {
    category: { ...lifecycle, id: 'a', name: 'Renamed', glyph: 'R' },
  });
  expect(canvasState.activeBoardId).toBeNull();
  canvasState.close();
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  expect(await read()).toMatchObject({ category: { name: 'Renamed' }, lifecycle: { rate: 'slow' } });
});

test('knowledge review queue joins authoritative titles and board-qualified status without reading blobs or validating', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const first = canvasState.createBoard('First', 'Projects/Child')!;
  canvasState.switchBoard(first.id);
  canvasState.addNode({
    ...note('shared', 'First title'),
    data: { title: 'First title', content: 'First title', contentOrigin: 'imported' },
  });
  const policy = {
    decayType: 'reality',
    rate: 'medium',
    cadenceDays: 7,
    triggers: [],
    revalidationMethod: 'Inspect sources',
  };
  await executeOperation('node.lifecycle-set', { id: 'shared', lifecycleOverride: policy });
  canvasState.addNode(note('retired', 'Retired title'));
  await executeOperation('node.lifecycle-set', { id: 'retired', lifecycleOverride: policy });
  await executeOperation('node.review', { id: 'retired', outcome: 'retire', applied: true, evidence: 'Superseded' });
  const second = canvasState.createBoard('Second', 'ProjectsElsewhere')!;
  canvasState.switchBoard(second.id);
  canvasState.addNode({
    ...note('shared', 'Second title'),
    data: { title: 'Second title', content: 'Second title', contentOrigin: 'imported' },
  });
  await executeOperation('node.lifecycle-set', { id: 'shared', lifecycleOverride: policy });
  await executeOperation('node.update', {
    id: 'shared',
    title: 'Live authoritative title',
    content: 'Large content not carried by the queue',
  });
  canvasState.addNode(note('neutral', 'No policy, no warning'));
  canvasState.addNode({
    ...note('portal', 'Source-only warning'),
    type: 'board',
    data: { title: 'Source-only warning', boardId: first.id },
  });
  for (let r = 0; r < 24; r++)
    canvasState.knowledge.record(second.id, 'shared', {
      outcome: r % 2 ? 'retain' : 'unresolved',
      applied: true,
      evidence: r % 2 ? '\t\n\u00a0\u2003\ufeff' : `Unresolved evidence ${r}`,
    });
  const before = await executeOperation('node.lifecycle-get', { id: 'shared', board: second.id });
  const history = spyOn(canvasState.knowledge, 'reviews');
  let catalog: KnowledgeResults['list'];
  try {
    catalog = (await executeOperation('knowledge.list', {})) as KnowledgeResults['list'];
    expect(history).not.toHaveBeenCalled();
  } finally {
    history.mockRestore();
  }
  expect(catalog.reviewCards).toHaveLength(3);
  expect(catalog.reviewCards).toEqual(
    expect.arrayContaining([
      { boardId: first.id, cardId: 'shared', boardTitle: 'First', folder: 'Projects/Child', title: 'First title' },
      {
        boardId: second.id,
        cardId: 'shared',
        boardTitle: 'Second',
        folder: 'ProjectsElsewhere',
        title: 'Live authoritative title',
      },
      {
        boardId: second.id,
        cardId: 'portal',
        boardTitle: 'Second',
        folder: 'ProjectsElsewhere',
        title: 'Source-only warning',
      },
    ]),
  );
  expect(JSON.stringify(catalog.reviewCards)).not.toContain('Large content');
  // Home's folder scope must use a path boundary, exclude retired cards, and include portal warnings.
  const counts = (folder: string) => {
    const boards = new Set(
      canvasState
        .listBoards()
        .filter((board) => !folder || board.folder === folder || board.folder?.startsWith(`${folder}/`))
        .map((board) => board.id),
    );
    const cards = Object.entries(catalog.cards)
      .filter(([key]) => boards.has(JSON.parse(key)[0]))
      .map(([, card]) => card);
    return {
      review: cards.filter((card) => !card.retired && (card.due || card.sources.length)).length,
      unknown: cards.filter((card) => card.unknown).length,
    };
  };
  expect(counts('')).toEqual({ review: 3, unknown: 2 });
  expect(counts('Projects')).toEqual({ review: 1, unknown: 0 });
  expect(counts('ProjectsElsewhere')).toEqual({ review: 2, unknown: 2 });
  expect(await executeOperation('node.lifecycle-get', { id: 'shared', board: second.id })).toEqual(before);
  expect(canvasState.activeBoardId).toBe(second.id);
});

test('category removal refuses empty-folder assignments, validates ids and persists unused deletion on Home', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const category = {
    id: 'unused',
    name: 'Unused',
    glyph: 'U',
    decayType: 'reality',
    rate: 'durable',
    triggers: [],
    revalidationMethod: 'check',
  };
  await executeOperation('knowledge.category-set', { category });
  await executeOperation('knowledge.folder-set', {
    path: 'Empty/Child',
    categoryId: category.id,
    lifecycleOverride: null,
  });
  const before = await executeOperation('knowledge.list', {});
  await expect(executeOperation('knowledge.category-remove', { id: category.id })).rejects.toThrow('Empty/Child');
  expect(await executeOperation('knowledge.list', {})).toEqual(before);
  await expect(executeOperation('knowledge.category-remove', { id: 'missing' })).rejects.toThrow(
    'Unknown knowledge category',
  );
  await expect(executeOperation('knowledge.category-remove', {})).rejects.toThrow();
  await expect(executeOperation('knowledge.category-remove', { id: ' ' })).rejects.toThrow();
  await executeOperation('knowledge.folder-set', { path: 'Empty/Child', categoryId: null, lifecycleOverride: null });
  expect(await executeOperation('knowledge.category-remove', { id: category.id }, { fromWorkbench: true })).toEqual({
    ok: true,
    id: category.id,
  });
  expect(canvasState.activeBoardId).toBeNull();
  canvasState.close();
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  expect(await executeOperation('knowledge.list', {})).toMatchObject({
    categories: [],
    folders: [{ path: 'Empty/Child', categoryId: null }],
  });
});

test('audited reviews separate application, evidence, retirement, restoration and duplicate card identities', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const a = canvasState.createBoard('A')!;
  canvasState.switchBoard(a.id);
  canvasState.addNode(note('shared', 'A'));
  const read = async () => {
    const result = (await executeOperation('node.lifecycle-get', {
      id: 'shared',
      board: a.id,
    })) as LifecycleResults['get'];
    expect(result.qualification.retired).toBe(result.retired);
    expect(result.qualification.lastValidatedAt).toBe(result.lastValidation?.when ?? null);
    return result;
  };
  const review = (outcome: string, applied: boolean, evidence: string) =>
    executeOperation(
      'node.review',
      {
        id: 'shared',
        outcome,
        applied,
        evidence,
        agentId: 'reviewer',
        expectedContentRevision: canvasState.getNode('shared')!.contentRevision,
      },
      { source: 'sdk' },
    );
  expect(await read()).toMatchObject({ lifecycle: null, lastValidation: null, retired: false });
  for (const [outcome, applied, evidence] of [
    ['retain', false, 'source'],
    ['revise', true, '  '],
    ['unresolved', true, 'source'],
  ] as const) {
    await review(outcome, applied, evidence);
    expect(await read()).toMatchObject({ lastValidation: null });
  }
  await review('retain', true, 'source v1');
  expect(await read()).toMatchObject({
    lastValidation: { evidence: 'source v1', who: { actor: 'agent', source: 'sdk', agentId: 'reviewer' } },
  });
  await review('revise', true, '\t\n\u00a0\u2003\ufeff');
  expect(await read()).toMatchObject({ lastValidation: { evidence: 'source v1' } });
  await review('retire', false, 'not applied');
  expect(await read()).toMatchObject({ retired: false });
  await review('retire', true, 'superseded');
  await review('externalize', true, 'source v2');
  expect(await read()).toMatchObject({ retired: true, lastValidation: { evidence: 'source v2' } });
  const beforeContent = canvasState.getNode('shared')!.contentRevision!;
  await executeOperation('node.update', { id: 'shared', content: 'Revised content, not validated' });
  expect(canvasState.getNode('shared')!.contentRevision!).toBeGreaterThan(beforeContent);
  await executeOperation('node.get', { id: 'shared' });
  expect(await read()).toMatchObject({ retired: true, lastValidation: { evidence: 'source v2' } });
  await executeOperation('node.lifecycle-restore', { id: 'shared', evidence: 'needed again' });
  expect(await read()).toMatchObject({ retired: false, lastValidation: { evidence: 'source v2' } });
  const b = canvasState.createBoard('B')!;
  canvasState.switchBoard(b.id);
  canvasState.addNode(note('shared', 'B'));
  expect(await executeOperation('node.lifecycle-get', { id: 'shared' })).toMatchObject({
    records: [],
    lastValidation: null,
  });
  await expect(
    executeOperation('node.review', {
      id: 'shared',
      outcome: 'retire',
      applied: true,
      evidence: '',
      expectedBoardId: a.id,
    }),
  ).rejects.toThrow('active board changed');
  canvasState.close();
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  expect(await read()).toMatchObject({ retired: false, lastValidation: { evidence: 'source v2' } });
});

test('rejected lifecycle data leaves a group patch atomic', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const original = canvasState.createBoard('Original')!;
  canvasState.switchBoard(original.id);
  canvasState.addNode(note('child', 'Original child'));
  canvasState.addNode({ ...note('group', 'Group'), type: 'group', data: { title: 'Group' } });
  canvasState.groupNodes('group', ['child']);
  const before = canvasState.getLayout();
  await expect(
    executeOperation('node.update', { id: 'group', position: { x: 500, y: 300 }, data: { lifecycleOverride: {} } }),
  ).rejects.toThrow();
  expect(canvasState.getLayout()).toEqual(before);
});

test('failed lifecycle board and snapshot loads preserve the original identity, content and persisted rows', () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const original = canvasState.createBoard('Original')!;
  canvasState.switchBoard(original.id);
  canvasState.addNode(note('child', 'Original child'));
  const before = canvasState.getLayout();
  const snapshot = canvasState.saveSnapshot('Original snapshot')!;
  const other = canvasState.createBoard('Other')!;
  canvasState.switchBoard(other.id);
  canvasState.addNode(note('other-child', 'Other child'));
  canvasState.flushToDisk();
  canvasState.switchBoard(original.id);
  const db = new Database(canvasState.databasePath!);
  try {
    db.run("UPDATE nodes SET data=json_set(data, '$.lifecycleOverride', json('{}')) WHERE board_id=?", [other.id]);
    db.run("UPDATE snapshot_nodes SET data=json_set(data, '$.lifecycleOverride', json('{}')) WHERE snapshot_id=?", [
      snapshot.id,
    ]);
    const stored = db.query('SELECT board_id,id,data FROM nodes ORDER BY board_id,id').all();
    expect(() => canvasState.switchBoard(other.id)).toThrow();
    expect(canvasState.activeBoardId).toBe(original.id);
    expect(canvasState.getLayout()).toEqual(before);
    expect(canvasState.restoreSnapshot(snapshot.id)).toBe(false);
    expect(canvasState.getLayout()).toEqual(before);
    canvasState.writeWorkspaceMeta('active_board', other.id);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(false);
    expect(canvasState.activeBoardId).toBe(original.id);
    expect(canvasState.getLayout()).toEqual(before);
    canvasState.writeWorkspaceMeta('active_board', original.id);
    canvasState.flushToDisk();
    canvasState.close();
    resetCanvasForTests(root);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    expect(canvasState.activeBoardId).toBe(original.id);
    expect(canvasState.getLayout()).toEqual(before);
    expect(db.query('SELECT board_id,id,data FROM nodes ORDER BY board_id,id').all()).toEqual(stored);
  } finally {
    db.close();
  }
});

test('a failed load after workspace rebinding never exposes or persists the previous library', () => {
  const otherRoot = createTestWorkspace('pmx-other-library-');
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const original = canvasState.createBoard('Private library')!;
  canvasState.switchBoard(original.id);
  canvasState.addNode(note('private', 'Private content from A'));
  canvasState.flushToDisk();
  try {
    canvasState.setWorkspaceRoot(otherRoot);
    canvasState.loadFromDisk({ clearExisting: true });
    const other = canvasState.createBoard('Other library')!;
    canvasState.switchBoard(other.id);
    canvasState.addNode(note('public', 'Original B content'));
    canvasState.flushToDisk();
    const db = new Database(canvasState.databasePath!);
    try {
      db.run("UPDATE nodes SET data=json_set(data, '$.lifecycleOverride', json('{}')) WHERE board_id=?", [other.id]);
      canvasState.setWorkspaceRoot(root);
      expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
      expect(canvasState.getNode('private')!.data.content).toBe('Private content from A');
      // No reset helper here: the real rebind must detach A even when B cannot load.
      canvasState.setWorkspaceRoot(otherRoot);
      expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(false);
      const exposed = canvasState.getLayout().nodes.map((node) => node.id);
      canvasState.flushToDisk();
      const leaked = db
        .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM nodes WHERE id='private'")
        .get()!.count;
      expect({ exposed, leaked }).toEqual({ exposed: [], leaked: 0 });
      expect(
        db.query<{ count: number }, [string]>('SELECT COUNT(*) AS count FROM nodes WHERE board_id=?').get(other.id)!
          .count,
      ).toBe(1);
    } finally {
      db.close();
    }
  } finally {
    canvasState.close();
    removeTestWorkspace(otherRoot);
  }
});

test.each(['group', 'wiki', 'html'])('lifecycle-only edits and undo preserve unrelated %s state', async (kind) => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const board = canvasState.createBoard('Metadata only')!;
  canvasState.switchBoard(board.id);
  const card = note('card', 'Card');
  if (kind === 'wiki') card.data.content = 'Unresolved [[Later]]';
  if (kind === 'html') {
    card.type = 'html';
    card.data = { title: 'HTML', html: `<p>${'Content '.repeat(1000)}</p>`, summary: 'Keep this summary' };
  }
  canvasState.addNode(card);
  if (kind === 'group') {
    canvasState.addNode({ ...note('group', 'Group'), type: 'group', data: { title: 'Group' } });
    canvasState.groupNodes('group', ['card']);
    canvasState.updateNode('group', { size: { width: 1600, height: 900 } });
    canvasState.setPolicy({ scope: { nodeIds: ['card'] } });
  }
  if (kind === 'wiki') canvasState.createBoard('Later');
  if (kind === 'html') {
    canvasState.close();
    resetCanvasForTests(root);
    canvasState.loadFromDisk({ clearExisting: true });
  }
  const before = canvasState.getLayout();
  canvasState.onMutation((info) => mutationHistory.record(info));
  const lifecycleOverride = { decayType: 'reality', rate: 'fast', triggers: [], revalidationMethod: 'Check source' };
  await executeOperation('node.lifecycle-set', { id: 'card', lifecycleOverride, expectedBoardId: board.id });
  const changed = canvasState.getLayout();
  expect(changed).toEqual({
    ...before,
    nodes: before.nodes.map((node) =>
      node.id === 'card' ? { ...node, data: { ...node.data, lifecycleOverride } } : node,
    ),
  });
  // Undo the metadata without replaying the card's body or its group layout.
  mutationHistory.undo();
  expect(canvasState.getLayout()).toEqual(before);
});

test('review evidence retains its content version and cannot acknowledge a stale edit or failed save', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const board = canvasState.createBoard('Evidence')!;
  canvasState.switchBoard(board.id);
  canvasState.addNode(note('card', 'Before'));
  canvasState.flushToDisk();
  const reviewed = canvasState.getNode('card')!.contentRevision!;
  const review = {
    id: 'card',
    outcome: 'retain',
    evidence: 'Checked original source',
    applied: true,
    expectedContentRevision: reviewed,
  };
  const first = await executeOperation('node.review', review);
  expect(first).toMatchObject({ record: { contentRevision: reviewed } });
  await expect(executeOperation('node.review', { ...review, expectedContentRevision: undefined })).rejects.toThrow(
    'require expectedContentRevision',
  );
  await executeOperation('node.update', { id: 'card', content: 'Changed after the source check' });
  const current = canvasState.getNode('card')!.contentRevision!;
  await expect(executeOperation('node.review', review)).rejects.toThrow('changed');
  const db = new Database(canvasState.databasePath!);
  try {
    db.exec(
      "CREATE TRIGGER reject_content_save BEFORE UPDATE ON nodes BEGIN SELECT RAISE(ABORT, 'Content save refused'); END",
    );
    await expect(executeOperation('node.review', { ...review, expectedContentRevision: current })).rejects.toThrow(
      'Content save refused',
    );
    expect(canvasState.knowledge.reviews(board.id, 'card').records).toHaveLength(1);
  } finally {
    db.exec('DROP TRIGGER reject_content_save');
    db.close();
  }
  canvasState.close();
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  expect(canvasState.knowledge.reviews(board.id, 'card').lastValidation).toMatchObject({ contentRevision: reviewed });
  expect(canvasState.getNode('card')!.contentRevision).toBe(current);
});

test('a recorded review cannot outlive the reviewed content after abrupt process exit', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const board = canvasState.createBoard('Durable evidence')!;
  canvasState.switchBoard(board.id);
  canvasState.addNode(note('card', 'Version A'));
  canvasState.close();
  const stateModule = fileURLToPath(new URL('../../src/server/canvas-state.ts', import.meta.url));
  const opsModule = fileURLToPath(new URL('../../src/server/operations/index.ts', import.meta.url));
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `
    import { canvasState } from ${JSON.stringify(stateModule)};
    import { executeOperation } from ${JSON.stringify(opsModule)};
    canvasState.setWorkspaceRoot(${JSON.stringify(root)});
    canvasState.loadFromDisk({ clearExisting: true });
    canvasState.updateNode('card', { data: { title: 'Version B', content: 'Reviewed B' } });
    await executeOperation('node.review', { id: 'card', outcome: 'revise', applied: true, evidence: 'Verified B', expectedContentRevision: canvasState.getNode('card').contentRevision });
    process.exit(0);
  `,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  expect(await child.exited).toBe(0);
  expect(await new Response(child.stderr).text()).toBe('');
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  expect(canvasState.getNode('card')!.data.content).toBe('Reviewed B');
  expect(canvasState.knowledge.reviews(board.id, 'card').lastValidation).toMatchObject({
    evidence: 'Verified B',
    contentRevision: canvasState.getNode('card')!.contentRevision,
  });
});

afterEach(() => {
  canvasState.close();
  removeTestWorkspace(root);
});

test('opening a pre-folder database preserves paths, content, pins and map positions through concurrent and contended opens', async () => {
  resetCanvasForTests(root);
  canvasState.loadFromDisk({ clearExisting: true });
  const board = canvasState.createBoard('Decisions', 'Engineering/Canvas/Decisions')!;
  canvasState.switchBoard(board.id);
  canvasState.addNode({ ...note('decision', 'Decision'), position: { x: 72, y: -36 } });
  canvasState.setBoardReadme(board.id, 'decision');
  canvasState.pinBoard(board.id, 'Keep this context');
  canvasState.updateBoard(board.id, { mapPosition: { x: -150, y: 240 } });
  canvasState.flushToDisk();
  const before = canvasState.readBoard(board.id, false)!;
  const dbPath = canvasState.databasePath!;
  canvasState.close();

  // Persist the actual pre-rename schema, with its populated category column.
  const oldDb = new Database(dbPath);
  oldDb.exec('ALTER TABLE boards RENAME COLUMN folder TO category');
  oldDb.close();

  const dbModule = fileURLToPath(new URL('../../src/server/canvas-db.ts', import.meta.url));
  const openingCode = `
    import { openCanvasDb, getBoardFromDB } from ${JSON.stringify(dbModule)};
    const db = openCanvasDb(${JSON.stringify(dbPath)});
    console.log(JSON.stringify(getBoardFromDB(db, ${JSON.stringify(board.id)})));
    db.close();
  `;
  const concurrent = [0, 1].map(() =>
    Bun.spawn([process.execPath, '--eval', openingCode], { stdout: 'pipe', stderr: 'pipe' }),
  );
  for (const result of await Promise.all(
    concurrent.map(async (child) => ({
      status: await child.exited,
      board: await new Response(child.stdout).text(),
      error: await new Response(child.stderr).text(),
    })),
  )) {
    expect(result.error).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.board)).toEqual(before.board);
  }

  // Current WAL readers must not wait for an unrelated writer's transaction.
  const writer = new Database(dbPath);
  writer.exec('BEGIN IMMEDIATE');
  try {
    const reader = Bun.spawn([process.execPath, '--eval', openingCode], { stdout: 'pipe', stderr: 'pipe' });
    expect(await reader.exited).toBe(0);
    expect(await new Response(reader.stderr).text()).toBe('');
    expect(JSON.parse(await new Response(reader.stdout).text())).toEqual(before.board);
  } finally {
    writer.exec('ROLLBACK');
    writer.close();
  }

  for (let opening = 0; opening < 2; opening++) {
    canvasState.setWorkspaceRoot(root);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    expect(canvasState.databasePath).toBe(dbPath);
    const read = canvasState.readBoard(board.id, false)!;
    expect(read.board).toEqual(before.board);
    expect(read.board.folder).toBe('Engineering/Canvas/Decisions');
    expect(read.board).not.toHaveProperty('category');
    expect(read.state).toEqual(before.state);
    const db = new Database(dbPath);
    const columns = db
      .query<{ name: string }, []>('PRAGMA table_info(boards)')
      .all()
      .map((column) => column.name);
    expect(columns).toContain('folder');
    expect(columns).not.toContain('category');
    db.close();
    canvasState.close();
  }
}, 10_000);

describe('migrating a one-board workspace', () => {
  test('the live board stays open, every old snapshot becomes its own board, and a copy is kept', async () => {
    const dbPath = writeSchema1Workspace(root);
    resetCanvasForTests(root);

    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    const boards = canvasState.listBoards();
    // Migrated snapshots are filed on their own shelf; the live board is not.
    expect(boards.map((entry) => entry.folder)).toEqual([null, 'From old snapshots', 'From old snapshots']);
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
      executeOperation('board.update', { id, name: 'Unwanted rename', folder: 'Other', readmeNodeId: 'missing' }),
    ).rejects.toThrow('README must identify');
    expect(canvasState.getActiveBoard()?.name).toBe(before.name);
    expect(canvasState.getActiveBoard()?.folder).toBe(before.folder);
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

  test('a targeted batch survives navigation and keeps identical node IDs on separate boards', async () => {
    canvasState.addNode(note('shared', 'A original'));
    canvasState.flushToDisk();
    const a = canvasState.activeBoardId!;
    const b = canvasState.createBoard('B')!;
    canvasState.switchBoard(b.id);
    canvasState.addNode(note('shared', 'B original'));
    const result = await executeOperation(
      'canvas.batch',
      {
        targetBoardId: a,
        agentId: 'amp:A',
        operations: [
          { op: 'node.update', args: { id: 'shared', content: 'A edited' } },
          { op: 'node.add', args: { type: 'markdown', title: 'A continuation' } },
        ],
      },
      {
        onProgress: async () => {
          canvasState.withVisibleBoard(() => canvasState.switchBoard(null));
          await Bun.sleep(1);
        },
      },
    );
    expect(result).toMatchObject({ ok: true });
    expect(canvasState.visibleBoardId).toBeNull();
    expect(canvasState.readBoard(a)!.layout.nodes.find((node) => node.id === 'shared')?.data.content).toBe('A edited');
    expect(canvasState.readBoard(a)!.layout.nodes.map((node) => node.data.title)).toContain('A continuation');
    expect(canvasState.readBoard(b.id)!.layout.nodes.find((node) => node.id === 'shared')?.data.title).toBe(
      'B original',
    );
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
